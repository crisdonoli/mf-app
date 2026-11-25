"""Bounded, thread-safe in-process caches for the memory-constrained backend host."""

from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
from typing import Any, Callable, TypeVar

T = TypeVar("T")


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
