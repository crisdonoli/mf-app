"""Process-local concurrency gate for CPU-heavy query endpoints."""

from __future__ import annotations

import logging
import math
import threading
import time
from contextlib import contextmanager

from ..config import get_settings

LOGGER = logging.getLogger("miningfomc.query_gate")

_HOLD_EMA_ALPHA = 0.3


class GateSaturated(RuntimeError):
    def __init__(
        self,
        name: str,
        waited_s: float,
        queue_depth: int,
        eta_s: float = 0.0,
    ):
        super().__init__(
            f"query gate '{name}' saturated after {waited_s:.2f}s "
            f"with {queue_depth} requests queued (eta {eta_s:.0f}s)"
        )
        self.name = name
        self.waited_s = waited_s
        self.queue_depth = queue_depth
        self.eta_s = eta_s


class QueryGate:
    def __init__(
        self,
        name: str,
        limit: int,
        wait_timeout_s: float,
        max_queue: int,
    ):
        self.name = name
        self.limit = limit
        self.wait_timeout_s = wait_timeout_s
        self.max_queue = max_queue
        self._sem = threading.Semaphore(limit)
        self._state = threading.Lock()
        self._waiting = 0
        self._acquired = 0
        self._rejected = 0
        self._saturations = 0
        self._holds = 0
        self._ema_hold_s: float | None = None
        self._total_wait_s = 0.0

    @contextmanager
    def slot(self, grace_s: float = 0.0):
        self.acquire(grace_s=grace_s)
        started = time.monotonic()
        try:
            yield self
        finally:
            self._record_hold(time.monotonic() - started)
            self.release()

    def acquire(self, grace_s: float = 0.0) -> None:
        if self._sem.acquire(blocking=False):
            with self._state:
                self._acquired += 1
                depth = self._waiting
            self._log_slow(0.0, depth)
            return

        if grace_s > 0:
            started = time.monotonic()
            if self._sem.acquire(timeout=grace_s):
                waited = time.monotonic() - started
                with self._state:
                    self._acquired += 1
                    self._total_wait_s += waited
                    depth = self._waiting
                self._log_slow(waited, depth)
                return

        with self._state:
            if self._waiting >= self.max_queue:
                self._rejected += 1
                self._saturations += 1
                depth = self._waiting
                raise GateSaturated(self.name, 0.0, depth, self._eta_locked(depth))
            self._waiting += 1

        started = time.monotonic()
        try:
            acquired = self._sem.acquire(timeout=self.wait_timeout_s)
        except BaseException:
            with self._state:
                self._waiting -= 1
            raise
        waited = time.monotonic() - started

        with self._state:
            self._waiting -= 1
            depth = self._waiting
            if acquired:
                self._acquired += 1
                self._total_wait_s += waited
            else:
                self._rejected += 1
                self._saturations += 1
                eta = self._eta_locked(depth)

        if not acquired:
            raise GateSaturated(self.name, waited, depth, eta)
        self._log_slow(waited, depth)

    def release(self) -> None:
        self._sem.release()

    def _record_hold(self, hold_s: float) -> None:
        with self._state:
            self._holds += 1
            if self._ema_hold_s is None:
                self._ema_hold_s = hold_s
            else:
                self._ema_hold_s = (
                    _HOLD_EMA_ALPHA * hold_s
                    + (1.0 - _HOLD_EMA_ALPHA) * self._ema_hold_s
                )

    def _eta_locked(self, queue_depth: int) -> int:
        base = (
            self._ema_hold_s
            if self._ema_hold_s is not None
            else self.wait_timeout_s / 2
        )
        return math.ceil(max(queue_depth, 0) / max(self.limit, 1) * base)

    def _log_slow(self, waited_s: float, queue_depth: int) -> None:
        if waited_s > 1.0:
            LOGGER.warning(
                "query gate '%s' slow acquire: waited %.2fs, %d still queued",
                self.name,
                waited_s,
                queue_depth,
            )

    def stats(self) -> dict:
        with self._state:
            acquired = self._acquired
            rejected = self._rejected
            waiting = self._waiting
            saturations = self._saturations
            ema_hold = self._ema_hold_s
            total_wait = self._total_wait_s
        return {
            "limit": self.limit,
            "waiting": waiting,
            "total_acquired": acquired,
            "total_rejected": rejected,
            "saturations": saturations,
            "avg_wait_s": round(total_wait / acquired, 4) if acquired else 0.0,
            "avg_hold_s": round(ema_hold, 4) if ema_hold is not None else 0.0,
        }


_GATES: dict[str, QueryGate] = {}
_GATES_LOCK = threading.Lock()


def _build_gate(name: str) -> QueryGate:
    cfg = get_settings()
    if name == "heavy":
        return QueryGate(
            name,
            cfg.heavy_query_max_concurrency,
            cfg.heavy_query_wait_timeout_s,
            cfg.heavy_query_max_queue,
        )
    if name == "corpus":
        return QueryGate(
            name,
            cfg.corpus_query_max_concurrency,
            cfg.heavy_query_wait_timeout_s,
            cfg.heavy_query_max_queue,
        )
    raise ValueError(f"unknown query gate: {name}")


def get_gate(name: str) -> QueryGate:
    gate = _GATES.get(name)
    if gate is not None:
        return gate
    with _GATES_LOCK:
        gate = _GATES.get(name)
        if gate is None:
            gate = _build_gate(name)
            _GATES[name] = gate
    return gate
