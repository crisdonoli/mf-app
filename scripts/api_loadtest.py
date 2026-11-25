#!/usr/bin/env python3
import argparse
import csv
import json
import random
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BACKOFF_BASE_MS = 800
BACKOFF_FACTOR = 1.7
BACKOFF_CAP_MS = 8000
JITTER_MS = 250

COMPARE_DOCUMENTS = [
    {"doc_type": "minutes", "meeting_date": "2008-01-29"},
    {"doc_type": "minutes", "meeting_date": "2008-03-18"},
    {"doc_type": "speeches", "meeting_date": "2008-01-07"},
    {"doc_type": "speeches", "meeting_date": "2008-01-08"},
]

COMPARE_BODY = {
    "documents": COMPARE_DOCUMENTS,
    "n_partitions": 2,
    "data_source": "similarity",
    "metric": "cosine",
    "normalization": "none",
    "granularity": "macro",
    "macro_category": None,
    "combine_by": "none",
    "sub_group_by": "none",
    "agg_method": "mean",
    "year_range_span": 5,
    "grouping_tree": None,
}


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def fmt_seconds(value):
    return "%g" % value


def is_timeout_error(exc):
    if isinstance(exc, (socket.timeout, TimeoutError)):
        return True
    return isinstance(exc, urllib.error.URLError) and isinstance(exc.reason, (socket.timeout, TimeoutError))


def health_probe(base_url, timeout):
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(base_url.rstrip("/") + "/api/health", timeout=min(timeout, 5.0)) as resp:
            resp.read()
            return "%d (%.0fms)" % (resp.status, (time.perf_counter() - started) * 1000)
    except Exception:
        return "timeout"


def scenario_request(name):
    if name == "health":
        return "GET", "/api/health", None
    if name == "stats":
        return "GET", "/api/stats", None
    if name == "search":
        q = "date_from=1976-01-01&date_to=2020-12-31&query_text=inflation&limit=200"
        return "GET", "/api/explorer/search?" + q, None
    if name == "compare":
        return "POST", "/api/comparator/compare", COMPARE_BODY
    raise ValueError("scenario desconocido: " + name)


def login(base_url, email, password, timeout):
    body = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(
        base_url.rstrip("/") + "/api/auth/login",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode())
    return payload["access_token"]


def get_json(base_url, path, token, timeout):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(base_url.rstrip("/") + path, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def record(scenario, status, wall_ms, queue_wait_ms, retries, gate, position, eta_s, error):
    return {
        "ts": now_iso(),
        "scenario": scenario,
        "status": status,
        "wall_ms": round(wall_ms, 1),
        "queue_wait_ms": round(queue_wait_ms, 1),
        "retries": retries,
        "gate": gate or "",
        "position": position if position is not None else "",
        "eta_s": eta_s if eta_s is not None else "",
        "error": error or "",
    }


def execute(base_url, scenario, token, timeout, max_retries):
    method, path, body = scenario_request(scenario)
    url = base_url.rstrip("/") + path
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"

    started = time.perf_counter()
    queue_wait_ms = 0.0
    retries = 0
    last_status = 0
    last_gate = ""
    last_position = None
    last_eta = None
    last_error = ""

    while True:
        attempt_started = time.perf_counter()
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                resp.read()
                last_status = resp.status
            wall_ms = (time.perf_counter() - started) * 1000
            return record(scenario, last_status, wall_ms, queue_wait_ms, retries,
                          last_gate, last_position, last_eta, last_error)
        except urllib.error.HTTPError as exc:
            last_status = exc.code
            last_gate = exc.headers.get("X-Query-Gate", "") or ""
            pos = exc.headers.get("X-Queue-Position")
            eta = exc.headers.get("X-Queue-Eta-S")
            last_position = int(pos) if pos is not None else None
            last_eta = int(eta) if eta is not None else None
            body_text = ""
            try:
                body_text = exc.read().decode(errors="replace")[:200]
            except Exception:
                pass
            last_error = "HTTP %s %s" % (exc.code, body_text.strip())
            if exc.code == 503 and last_gate and retries < max_retries:
                retry_after = float(exc.headers.get("Retry-After", "1"))
                delay = max(retry_after * 1000.0, BACKOFF_BASE_MS) * (BACKOFF_FACTOR ** retries)
                delay = min(delay, BACKOFF_CAP_MS) + random.uniform(0, JITTER_MS)
                time.sleep(delay / 1000.0)
                queue_wait_ms += delay
                retries += 1
                continue
            wall_ms = (time.perf_counter() - started) * 1000
            return record(scenario, last_status, wall_ms, queue_wait_ms, retries,
                          last_gate, last_position, last_eta, last_error)
        except Exception as exc:
            wall_ms = (time.perf_counter() - started) * 1000
            if is_timeout_error(exc):
                last_error = "TIMEOUT %ss" % fmt_seconds(timeout)
            else:
                last_error = "EXC %s: %s" % (type(exc).__name__, exc)
            return record(scenario, 0, wall_ms, queue_wait_ms, retries,
                          last_gate, last_position, last_eta, last_error)


def percentile(values, pct):
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (len(ordered) - 1) * (pct / 100.0)
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    frac = rank - low
    return ordered[low] + (ordered[high] - ordered[low]) * frac


def summarize(rows, elapsed_s):
    wall = [r["wall_ms"] for r in rows]
    ok = sum(1 for r in rows if 200 <= r["status"] < 300)
    err = len(rows) - ok
    retries = sum(r["retries"] for r in rows)
    return {
        "n": len(rows),
        "ok": ok,
        "err": err,
        "retries": retries,
        "p50": percentile(wall, 50),
        "p95": percentile(wall, 95),
        "p99": percentile(wall, 99),
        "max": max(wall) if wall else 0.0,
        "rps": len(rows) / elapsed_s if elapsed_s > 0 else 0.0,
    }


def print_summary(title, s):
    print(title)
    print("  n=%d ok=%d err=%d retries=%d p50=%.0fms p95=%.0fms p99=%.0fms max=%.0fms rps=%.2f"
          % (s["n"], s["ok"], s["err"], s["retries"], s["p50"], s["p95"], s["p99"], s["max"], s["rps"]))


def progress_line(index, total, row):
    if row["status"] == 0:
        label = "TIMEOUT" if row["error"].startswith("TIMEOUT") else "ERR"
        return "[%d/%d] %s %.0fms error=%s" % (index, total, label, row["wall_ms"], row["error"])
    line = "[%d/%d] %d %.0fms retries=%d gate=%s pos=%s eta=%s" % (
        index, total, row["status"], row["wall_ms"], row["retries"],
        row["gate"] or "-", row["position"] if row["position"] != "" else "-",
        row["eta_s"] if row["eta_s"] != "" else "-")
    if row["error"]:
        line += " error=" + row["error"]
    return line


def write_csv(path, rows):
    fields = ["ts", "scenario", "status", "wall_ms", "queue_wait_ms", "retries",
              "gate", "position", "eta_s", "error"]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    print("csv: " + path)


def pick_scenario(index, scenario):
    if scenario != "mixed":
        return scenario
    return ("search", "stats", "compare")[index % 3]


def gates_snapshot(base_url, token, timeout):
    try:
        return get_json(base_url, "/api/admin/query-gates", token, timeout)
    except Exception as exc:
        return {"error": "%s: %s" % (type(exc).__name__, exc)}


def print_gates(label, snapshot):
    print("%s: %s" % (label, json.dumps(snapshot, ensure_ascii=False)))


def main():
    ap = argparse.ArgumentParser(description="Load test for the FOMC API (stdlib only).")
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--email")
    ap.add_argument("--password")
    ap.add_argument("--scenario", required=True,
                    choices=["search", "compare", "stats", "health", "mixed"])
    ap.add_argument("--warmup", type=int, default=0)
    ap.add_argument("--requests", type=int, default=10)
    ap.add_argument("--concurrency", type=int, default=1)
    ap.add_argument("--out")
    ap.add_argument("--admin", action="store_true")
    ap.add_argument("--timeout", type=float, default=20.0)
    ap.add_argument("--max-retries", type=int, default=2)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.dry_run:
        names = ["search", "stats", "compare"] if args.scenario == "mixed" else [args.scenario]
        for name in names:
            method, path, body = scenario_request(name)
            print("%s %s%s" % (method, args.base_url.rstrip("/"), path))
            if body is not None:
                print("  body=" + json.dumps(body, ensure_ascii=False))
        return 0

    if args.scenario == "mixed":
        target = "MIXED " + args.base_url.rstrip("/")
    else:
        method, path, _ = scenario_request(args.scenario)
        target = "%s %s%s" % (method, args.base_url.rstrip("/"), path)
    print("%s timeout=%ss requests=%d concurrency=%d"
          % (target, fmt_seconds(args.timeout), args.requests, args.concurrency), flush=True)
    print("health=" + health_probe(args.base_url, args.timeout), flush=True)

    token = None
    if args.scenario != "health":
        if not args.email or not args.password:
            print("ERR: se requiere --email y --password para scenario " + args.scenario, file=sys.stderr)
            return 2
        token = login(args.base_url, args.email, args.password, args.timeout)

    gates_before = None
    if args.admin:
        gates_before = gates_snapshot(args.base_url, token, args.timeout)
        print_gates("gates_before", gates_before)

    warmup_wall = []
    for i in range(max(args.warmup, 0)):
        r = execute(args.base_url, pick_scenario(i, args.scenario), token, args.timeout, args.max_retries)
        warmup_wall.append(r["wall_ms"])
    if warmup_wall:
        print("warmup: n=%d avg=%.0fms min=%.0fms max=%.0fms"
              % (len(warmup_wall), statistics.mean(warmup_wall),
                 min(warmup_wall), max(warmup_wall)))

    rows = []
    total = args.requests
    completed = 0
    interrupted = False
    load_started = time.perf_counter()
    pool = ThreadPoolExecutor(max_workers=args.concurrency)
    try:
        futures = [
            pool.submit(execute, args.base_url, pick_scenario(i, args.scenario), token,
                        args.timeout, args.max_retries)
            for i in range(total)
        ]
        for fut in as_completed(futures):
            row = fut.result()
            rows.append(row)
            completed += 1
            print(progress_line(completed, total, row), flush=True)
    except KeyboardInterrupt:
        interrupted = True
        pool.shutdown(wait=False, cancel_futures=True)
    else:
        pool.shutdown(wait=True)
    elapsed = time.perf_counter() - load_started

    print_summary("load (parcial)" if interrupted else "load", summarize(rows, elapsed))

    if args.admin and not interrupted:
        print_gates("gates_after", gates_snapshot(args.base_url, token, args.timeout))

    if args.out:
        write_csv(args.out, rows)

    if interrupted:
        print("Interrumpido por el usuario: %d/%d requests completados" % (completed, total))
        return 130

    fatal = [r for r in rows if r["status"] == 0 or (not (200 <= r["status"] < 300) and not r["gate"])]
    return 1 if fatal else 0


if __name__ == "__main__":
    sys.exit(main())
