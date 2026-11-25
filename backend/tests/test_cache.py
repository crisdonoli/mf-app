from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.cache import BoundedDict, TTLCache


def test_ttl_expiration():
    cache = TTLCache("ttl", max_entries=4, ttl_s=0.05)
    cache.set("k", "v")
    hit, value = cache.get("k")
    assert hit and value == "v"
    time.sleep(0.06)
    hit, _ = cache.get("k")
    assert not hit
    assert cache.stats()["expirations"] >= 1


def test_lru_eviction():
    cache = TTLCache("lru", max_entries=2, ttl_s=60)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("c", 3)
    hit, _ = cache.get("a")
    assert not hit
    assert cache.stats()["evictions"] >= 1


def test_max_bytes_skips_oversized():
    cache = TTLCache("bytes", max_entries=4, ttl_s=60, max_bytes=10, size_fn=len)
    cache.set("big", "x" * 20)
    hit, _ = cache.get("big")
    assert not hit


def test_bounded_dict_fifo():
    d = BoundedDict(max_entries=2)
    d["a"] = 1
    d["b"] = 2
    d["c"] = 3
    assert "a" not in d
    assert d["b"] == 2
    assert d.get("c") == 3
    d.clear()
    assert len(d) == 0


def test_get_or_compute_counts():
    cache = TTLCache("compute", max_entries=4, ttl_s=60)
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return "value"

    assert cache.get_or_compute("k", compute) == "value"
    assert cache.get_or_compute("k", compute) == "value"
    assert calls["n"] == 1
    stats = cache.stats()
    assert stats["hits"] == 1
    assert stats["misses"] == 1


def test_thread_safety_smoke():
    cache = TTLCache("threads", max_entries=100, ttl_s=60)
    counter = {"n": 0}
    lock = threading.Lock()

    def compute():
        with lock:
            counter["n"] += 1
        return counter["n"]

    def worker():
        for i in range(50):
            cache.get_or_compute(i % 10, compute)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert counter["n"] <= 400
