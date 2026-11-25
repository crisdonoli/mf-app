"""Bounded, thread-safe in-process caches for the memory-constrained backend host."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Callable, TypeVar

T = TypeVar("T")

LOGGER = logging.getLogger(__name__)


def get_repository():
    from ..db.repository import get_repository as _get_repository

    return _get_repository()


def approx_size(obj: Any) -> int:
    try:
        import numpy as np

        if isinstance(obj, np.ndarray):
            return int(obj.nbytes)
    except ImportError:
        pass
    try:
        return len(json.dumps(obj, default=str))
    except (TypeError, ValueError):
        return 0


class TTLCache:
    def __init__(
        self,
        name: str,
        max_entries: int,
        ttl_s: float,
        max_bytes: int | None = None,
        size_fn: Callable[[Any], int] | None = None,
    ) -> None:
        self.name = name
        self.max_entries = max_entries
        self.ttl_s = ttl_s
        self.max_bytes = max_bytes
        self._size_fn = size_fn
        self._lock = threading.RLock()
        self._data: OrderedDict[Any, tuple[Any, float | None, int]] = OrderedDict()
        self._bytes = 0
        self._hits = 0
        self._misses = 0
        self._evictions = 0
        self._expirations = 0

    def get(self, key: Any) -> tuple[bool, Any]:
        with self._lock:
            entry = self._data.get(key)
            if entry is None:
                self._misses += 1
                return False, None
            value, expires_at, size = entry
            if expires_at is not None and expires_at <= time.monotonic():
                del self._data[key]
                self._bytes -= size
                self._expirations += 1
                self._misses += 1
                return False, None
            self._data.move_to_end(key)
            self._hits += 1
            return True, value

    def set(self, key: Any, value: Any) -> None:
        size = 0
        if self.max_bytes is not None:
            size = int(self._size_fn(value)) if self._size_fn else 0
            if size > self.max_bytes:
                with self._lock:
                    self._evictions += 1
                return
        expires_at = time.monotonic() + self.ttl_s if self.ttl_s > 0 else None
        with self._lock:
            old = self._data.pop(key, None)
            if old is not None:
                self._bytes -= old[2]
            self._data[key] = (value, expires_at, size)
            self._bytes += size
            self._evict_locked()

    def _evict_locked(self) -> None:
        while len(self._data) > self.max_entries:
            _, (_, _, size) = self._data.popitem(last=False)
            self._bytes -= size
            self._evictions += 1
        if self.max_bytes is not None:
            while self._bytes > self.max_bytes and self._data:
                _, (_, _, size) = self._data.popitem(last=False)
                self._bytes -= size
                self._evictions += 1

    def get_or_compute(self, key: Any, compute: Callable[[], T]) -> T:
        hit, value = self.get(key)
        if hit:
            return value
        value = compute()
        self.set(key, value)
        return value

    def clear(self) -> None:
        with self._lock:
            self._data.clear()
            self._bytes = 0

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "entries": len(self._data),
                "hits": self._hits,
                "misses": self._misses,
                "evictions": self._evictions,
                "expirations": self._expirations,
                "bytes": self._bytes,
                "name": self.name,
            }


class SharedSearchCache:
    """Three-tier cache: per-worker memory L1, shared SQL L2, on-disk JSON L3.

    L2 and L3 are best-effort. Any backend failure degrades to the remaining tiers.
    """

    def __init__(
        self,
        name: str,
        max_entries: int,
        ttl_s: float,
        max_bytes: int | None = None,
        size_fn: Callable[[Any], int] | None = None,
    ) -> None:
        self.name = name
        self.ttl_s = ttl_s
        self._disk_dir: Path | None = None
        self._l1 = TTLCache(
            name,
            max_entries=max_entries,
            ttl_s=ttl_s,
            max_bytes=max_bytes,
            size_fn=size_fn,
        )

    def _l2_key(self, key: Any) -> str:
        return f"{self.name}:{json.dumps(key, default=str, separators=(',', ':'))}"

    def _resolve_disk_dir(self) -> Path | None:
        if self._disk_dir is None:
            try:
                from ..config import get_settings

                self._disk_dir = get_settings().resolve_search_cache_dir()
            except Exception as exc:
                LOGGER.warning("Shared search cache L3 dir resolution failed: %s", exc)
                return None
        return self._disk_dir

    def _disk_path(self, key: Any) -> Path | None:
        directory = self._resolve_disk_dir()
        if directory is None:
            return None
        try:
            directory.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256(self._l2_key(key).encode()).hexdigest()
            return directory / f"{digest}.json"
        except Exception as exc:
            LOGGER.warning("Shared search cache L3 path failed: %s", exc)
            return None

    def _read_disk(self, key: Any) -> tuple[bool, Any]:
        path = self._disk_path(key)
        if path is None or not path.is_file():
            return False, None
        try:
            payload = json.loads(path.read_text())
            expires_at = payload.get("expires_at")
            if expires_at is not None and float(expires_at) <= time.time():
                path.unlink(missing_ok=True)
                return False, None
            value = payload["value"]
        except Exception as exc:
            LOGGER.warning("Shared search cache L3 read failed: %s", exc)
            return False, None
        self._l1.set(key, value)
        try:
            raw = json.dumps(value, default=str)
            get_repository().set_cached_search(self._l2_key(key), raw, len(raw.encode()), self.ttl_s)
        except Exception as exc:
            LOGGER.warning("Shared search cache L2 write failed: %s", exc)
        return True, value

    def _write_disk(self, key: Any, value: Any) -> None:
        path = self._disk_path(key)
        if path is None:
            return
        try:
            payload = {
                "value": value,
                "expires_at": time.time() + self.ttl_s if self.ttl_s > 0 else None,
            }
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload, default=str))
            os.replace(tmp, path)
        except Exception as exc:
            LOGGER.warning("Shared search cache L3 write failed: %s", exc)

    def _clear_disk(self) -> None:
        directory = self._resolve_disk_dir()
        if directory is None:
            return
        try:
            for path in directory.glob("*.json"):
                path.unlink(missing_ok=True)
        except Exception as exc:
            LOGGER.warning("Shared search cache L3 purge failed: %s", exc)

    def _disk_stats(self) -> dict[str, Any]:
        directory = self._resolve_disk_dir()
        entries = 0
        total_bytes = 0
        if directory is not None:
            try:
                for path in directory.glob("*.json"):
                    entries += 1
                    total_bytes += path.stat().st_size
            except Exception as exc:
                LOGGER.warning("Shared search cache L3 stats failed: %s", exc)
        return {"entries": entries, "bytes": total_bytes}

    def get(self, key: Any) -> tuple[bool, Any]:
        hit, value = self._l1.get(key)
        if hit:
            return True, value
        raw = None
        try:
            raw = get_repository().get_cached_search(self._l2_key(key))
        except Exception as exc:
            LOGGER.warning("Shared search cache L2 read failed: %s", exc)
        if raw is not None:
            value = json.loads(raw)
            self._l1.set(key, value)
            self._write_disk(key, value)
            return True, value
        return self._read_disk(key)

    def set(self, key: Any, value: Any) -> None:
        self._l1.set(key, value)
        try:
            raw = json.dumps(value, default=str)
            get_repository().set_cached_search(self._l2_key(key), raw, len(raw.encode()), self.ttl_s)
        except Exception as exc:
            LOGGER.warning("Shared search cache L2 write failed: %s", exc)
        self._write_disk(key, value)

    def get_or_compute(self, key: Any, compute: Callable[[], T]) -> T:
        hit, value = self.get(key)
        if hit:
            return value
        value = compute()
        self.set(key, value)
        return value

    def clear(self, prefix: str | None = None) -> None:
        self._l1.clear()
        try:
            get_repository().purge_search_cache(prefix)
        except Exception as exc:
            LOGGER.warning("Shared search cache L2 purge failed: %s", exc)
        self._clear_disk()

    def stats(self) -> dict[str, Any]:
        merged = self._l1.stats()
        try:
            merged["l2"] = get_repository().search_cache_stats()
        except Exception as exc:
            LOGGER.warning("Shared search cache L2 stats failed: %s", exc)
            merged["l2"] = {"entries": 0, "total_bytes": 0, "oldest": None, "newest": None, "error": str(exc)}
        merged["disk"] = self._disk_stats()
        return merged


class BoundedDict(OrderedDict):
    """FIFO-bounded mapping that keeps the plain dict-like interface call sites expect."""

    def __init__(self, max_entries: int) -> None:
        super().__init__()
        self.max_entries = max_entries
        self._lock = threading.RLock()

    def __setitem__(self, key: Any, value: Any) -> None:
        with self._lock:
            if key not in self and len(self) >= self.max_entries:
                super().popitem(last=False)
            super().__setitem__(key, value)

    def __getitem__(self, key: Any) -> Any:
        with self._lock:
            return super().__getitem__(key)

    def __contains__(self, key: Any) -> bool:
        with self._lock:
            return super().__contains__(key)

    def __len__(self) -> int:
        with self._lock:
            return super().__len__()

    def get(self, key: Any, default: Any = None) -> Any:
        with self._lock:
            try:
                return super().__getitem__(key)
            except KeyError:
                return default

    def clear(self) -> None:
        with self._lock:
            super().clear()
