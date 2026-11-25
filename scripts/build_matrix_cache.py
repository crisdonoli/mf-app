#!/usr/bin/env python3
"""Pre-build the per-meeting similarity matrix cache consumed by the API."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import List, Optional

import numpy as np
import pyarrow.parquet as pq

BACKEND_DIR = None
for candidate in (
    Path(__file__).resolve().parents[1] / "backend",  # repo local: fomc-app/backend
    Path("/app"),  # contenedor Docker (WORKDIR)
    Path("/app/backend"),
):
    if (candidate / "app" / "config.py").is_file():
        BACKEND_DIR = candidate
        break
if BACKEND_DIR is None:
    raise SystemExit("No se encontró el directorio backend (app/config.py).")
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.config import Settings  # noqa: E402
from app.core.query_engine import ParquetQueryEngine  # noqa: E402

log = logging.getLogger("build_matrix_cache")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="/fomc-data")
    parser.add_argument(
        "--output-dir",
        help="Cache root (default: settings.resolve_matrix_cache_dir())",
    )
    parser.add_argument("--doc-types", help="Comma separated doc types (default: discover)")
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args(argv)


def discover_meeting_dates(metadata_dir: Path, doc_type: str) -> List[str]:
    dates: set[str] = set()
    for path in sorted(metadata_dir.glob(f"doc_type={doc_type}/year=*/part-*.parquet")):
        if "meeting_date" not in pq.read_schema(path).names:
            continue
        for value in pq.read_table(path, columns=["meeting_date"])["meeting_date"].to_pylist():
            if value:
                dates.add(str(value))
    return sorted(dates)


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args(argv)
    started = time.monotonic()

    settings = Settings(fomc_data_dir=Path(args.data_dir))
    engine = ParquetQueryEngine(settings)
    output_dir = Path(args.output_dir) if args.output_dir else settings.resolve_matrix_cache_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    if not os.access(output_dir, os.W_OK):
        print(f"error: matrix cache dir not writable: {output_dir}", file=sys.stderr)
        return 1
    metadata_dir = settings.resolve_text_metadata_dir()

    doc_types = (
        [d.strip() for d in args.doc_types.split(",") if d.strip()]
        if args.doc_types
        else engine.discover_doc_types()
    )

    total_dates = 0
    saved = 0
    skipped = 0
    errors = 0

    for doc_type in doc_types:
        dates = discover_meeting_dates(metadata_dir, doc_type)
        total_dates += len(dates)
        for meeting_date in dates:
            cache_path = output_dir / doc_type / f"{meeting_date}.npz"
            if cache_path.is_file():
                if not args.overwrite:
                    skipped += 1
                    log.debug("skip existing %s", cache_path)
                    continue
                cache_path.unlink()
            try:
                chunk_ids, matrix, labels = engine.load_raw_similarity_slice(doc_type, meeting_date)
                if not chunk_ids:
                    skipped += 1
                    log.debug("empty slice %s %s", doc_type, meeting_date)
                    continue
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                np.savez_compressed(
                    cache_path,
                    chunk_ids=np.array(chunk_ids),
                    matrix=matrix,
                    labels=np.array(labels),
                )
                saved += 1
            except Exception as exc:
                errors += 1
                log.warning("failed %s %s: %s", doc_type, meeting_date, exc)

    summary = {
        "doc_types": doc_types,
        "meeting_dates": total_dates,
        "saved": saved,
        "skipped": skipped,
        "errors": errors,
        "output_bytes": sum(p.stat().st_size for p in output_dir.rglob("*.npz")),
        "elapsed_s": round(time.monotonic() - started, 2),
    }
    log.info("summary %s", json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
