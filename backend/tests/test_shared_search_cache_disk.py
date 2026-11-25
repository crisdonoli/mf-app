from __future__ import annotations

import sys
import time
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app import config as config_module
from app.core import cache as cache_module
from app.core.cache import SharedSearchCache
from app.db.repository import AppRepository

DISK_SUBDIR = "disk"


def _disk_dir(tmp_path) -> Path:
    return tmp_path / DISK_SUBDIR


def _patch_settings(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        config_module,
        "get_settings",
        lambda: SimpleNamespace(resolve_search_cache_dir=lambda: _disk_dir(tmp_path)),
    )


def _make_cache(tmp_path, monkeypatch, ttl_s: float = 900) -> tuple[SharedSearchCache, AppRepository]:
    repo = AppRepository(SimpleNamespace(database_url=f"sqlite:///{tmp_path / 'cache.db'}"))
    monkeypatch.setattr(cache_module, "get_repository", lambda: repo)
    _patch_settings(tmp_path, monkeypatch)
    return SharedSearchCache("search", max_entries=8, ttl_s=ttl_s), repo


def _disk_files(tmp_path) -> list[Path]:
    directory = _disk_dir(tmp_path)
    return sorted(directory.glob("*.json")) if directory.is_dir() else []


def test_disk_persists_across_instances(tmp_path, monkeypatch):
    cache, _ = _make_cache(tmp_path, monkeypatch)
    key = ("search", "v1", "persisted")
    cache.set(key, ["a", 1])
    assert _disk_files(tmp_path)

    fresh_repo = AppRepository(SimpleNamespace(database_url=f"sqlite:///{tmp_path / 'fresh.db'}"))
    monkeypatch.setattr(cache_module, "get_repository", lambda: fresh_repo)
    fresh = SharedSearchCache("search", max_entries=8, ttl_s=900)

    hit, value = fresh.get(key)
    assert hit
    assert value == ["a", 1]


def test_l1_hit_skips_l2_and_disk(tmp_path, monkeypatch):
    cache, repo = _make_cache(tmp_path, monkeypatch)
    key = ("search", "v1", "l1")
    cache.set(key, ["a", 1])
    l2_reads = {"n": 0}

    def counting_read(cache_key):
        l2_reads["n"] += 1
        return None

    monkeypatch.setattr(repo, "get_cached_search", counting_read)

    hit, value = cache.get(key)
    assert hit
    assert value == ["a", 1]
    assert l2_reads["n"] == 0


def test_l2_hit_repopulates_disk(tmp_path, monkeypatch):
    cache, repo = _make_cache(tmp_path, monkeypatch)
    key = ("search", "v1", "l2")
    repo.set_cached_search(cache._l2_key(key), '["x", 2]', 8)
    assert not _disk_files(tmp_path)

    hit, value = cache.get(key)
    assert hit
    assert value == ["x", 2]
    assert _disk_files(tmp_path)


def test_expired_disk_entry_is_deleted(tmp_path, monkeypatch):
    cache, _ = _make_cache(tmp_path, monkeypatch, ttl_s=0.05)
    key = ("search", "v1", "expired")
    cache.set(key, ["a"])
    assert _disk_files(tmp_path)

    cache._l1.clear()
    time.sleep(0.06)

    assert cache.get(key) == (False, None)
    assert not _disk_files(tmp_path)


def test_clear_purges_disk(tmp_path, monkeypatch):
    cache, _ = _make_cache(tmp_path, monkeypatch)
    cache.set(("search", "v1", "a"), ["a"])
    cache.set(("search", "v1", "b"), ["b"])
    assert _disk_files(tmp_path)

    cache.clear()
    assert not _disk_files(tmp_path)
    assert cache.get(("search", "v1", "a")) == (False, None)


def test_stats_includes_disk(tmp_path, monkeypatch):
    cache, _ = _make_cache(tmp_path, monkeypatch)
    cache.set(("search", "v1", "stats"), ["a"])

    stats = cache.stats()
    assert stats["disk"]["entries"] == 1
    assert stats["disk"]["bytes"] > 0
