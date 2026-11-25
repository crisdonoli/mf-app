from __future__ import annotations

import sys
import time
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core import cache as cache_module
from app.core.cache import SharedSearchCache
from app.db.repository import AppRepository
from app import config as config_module


def _make_cache(tmp_path, monkeypatch) -> tuple[SharedSearchCache, AppRepository]:
    repo = AppRepository(SimpleNamespace(database_url=f"sqlite:///{tmp_path / 'cache.db'}"))
    monkeypatch.setattr(cache_module, "get_repository", lambda: repo)
    monkeypatch.setattr(
        config_module,
        "get_settings",
        lambda: SimpleNamespace(resolve_search_cache_dir=lambda: tmp_path / "disk"),
    )
    return SharedSearchCache("search", max_entries=8, ttl_s=900, max_bytes=1024 * 1024), repo


def test_l1_hit_skips_l2(tmp_path, monkeypatch):
    cache, repo = _make_cache(tmp_path, monkeypatch)
    cache.set(("search", "v1", "q"), (["a"], 1))
    l2_reads = {"n": 0}

    def counting_read(key):
        l2_reads["n"] += 1
        return None

    monkeypatch.setattr(repo, "get_cached_search", counting_read)

    hit, value = cache.get(("search", "v1", "q"))
    assert hit
    assert value == (["a"], 1)
    assert l2_reads["n"] == 0


def test_l2_hit_repopulates_l1(tmp_path, monkeypatch):
    cache, repo = _make_cache(tmp_path, monkeypatch)
    key = ("search", "v1", "q")
    repo.set_cached_search(cache._l2_key(key), '[["a"], 1]', 10)
    cache._l1.clear()

    hit, value = cache.get(key)
    assert hit
    assert value == [["a"], 1]
    assert cache._l1.get(key)[0]


def test_miss_returns_false(tmp_path, monkeypatch):
    cache, _ = _make_cache(tmp_path, monkeypatch)
    assert cache.get(("search", "v1", "absent")) == (False, None)


def test_set_persists_in_l2(tmp_path, monkeypatch):
    cache, repo = _make_cache(tmp_path, monkeypatch)
    key = ("search", "v1", "q")
    cache.set(key, (["a"], 2))

    other = SharedSearchCache("search", max_entries=8, ttl_s=900)
    hit, value = other.get(key)
    assert hit
    assert value == [["a"], 2]
    assert repo.search_cache_stats()["entries"] == 1


def test_clear_purges_both_tiers(tmp_path, monkeypatch):
    cache, repo = _make_cache(tmp_path, monkeypatch)
    key = ("search", "v1", "q")
    cache.set(key, (["a"], 1))
    cache.clear()
    assert cache._l1.get(key) == (False, None)
    assert repo.get_cached_search(cache._l2_key(key)) is None


def test_expired_l2_entry_is_purged(tmp_path, monkeypatch):
    cache, repo = _make_cache(tmp_path, monkeypatch)
    key = ("search", "v1", "q")
    cache.set(key, (["a"], 1))
    repo.set_cached_search(cache._l2_key(key), '[["a"], 1]', 10, ttl_s=0.05)
    cache._l1.clear()
    cache._clear_disk()
    time.sleep(0.06)

    assert cache.get(key) == (False, None)
    assert repo.search_cache_stats()["entries"] == 0
