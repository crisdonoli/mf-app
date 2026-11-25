"""Unit tests for the process-local query concurrency gates."""

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.query_gate import GateSaturated, QueryGate


def test_queue_full_rejects_second_acquire():
    gate = QueryGate("test", limit=1, wait_timeout_s=0.5, max_queue=0)
    gate.acquire()
    try:
        with pytest.raises(GateSaturated) as exc_info:
            gate.acquire()
        assert exc_info.value.name == "test"
        assert exc_info.value.queue_depth == 0
    finally:
        gate.release()


def test_repeated_acquire_release_no_deadlock():
    gate = QueryGate("test", limit=1, wait_timeout_s=0.5, max_queue=2)
    for _ in range(10):
        gate.acquire()
        gate.release()
    stats = gate.stats()
    assert stats["waiting"] == 0
    assert stats["total_acquired"] == 10
    assert stats["total_rejected"] == 0


def test_wait_timeout_rejects_and_clears_waiting():
    gate = QueryGate("test", limit=1, wait_timeout_s=0.1, max_queue=5)
    gate.acquire()
    entered = threading.Event()
    errors: list[BaseException] = []

    def contender():
        entered.set()
        try:
            gate.acquire()
        except BaseException as exc:
            errors.append(exc)

    worker = threading.Thread(target=contender)
    worker.start()
    entered.wait(timeout=0.2)
    worker.join(timeout=1.0)

    try:
        assert len(errors) == 1
        assert isinstance(errors[0], GateSaturated)
        assert errors[0].waited_s >= 0.05
        assert gate.stats()["waiting"] == 0
        assert gate.stats()["total_rejected"] == 1
    finally:
        gate.release()


def test_stats_keys():
    gate = QueryGate("test", limit=2, wait_timeout_s=0.1, max_queue=1)
    stats = gate.stats()
    assert set(stats) == {
        "limit",
        "waiting",
        "total_acquired",
        "total_rejected",
        "saturations",
        "avg_wait_s",
        "avg_hold_s",
    }
    assert stats["limit"] == 2
    assert stats["avg_wait_s"] == 0.0


def test_grace_absorbs_momentary_contention():
    gate = QueryGate("test", limit=1, wait_timeout_s=0.5, max_queue=2)
    gate.acquire()
    worker = threading.Thread(target=lambda: (time.sleep(0.02), gate.release()))
    worker.start()
    try:
        gate.acquire(grace_s=0.2)
        gate.release()
    finally:
        worker.join(timeout=1.0)


def test_grace_saturation_reports_queue_depth():
    gate = QueryGate("test", limit=1, wait_timeout_s=0.05, max_queue=2)
    gate.acquire()
    try:
        with pytest.raises(GateSaturated) as exc_info:
            gate.acquire(grace_s=0.02)
        assert exc_info.value.queue_depth >= 0
    finally:
        gate.release()


def test_eta_positive_when_contended():
    gate = QueryGate("test", limit=1, wait_timeout_s=0.2, max_queue=1)
    gate.acquire()

    def contender():
        try:
            gate.acquire()
        except BaseException:
            pass

    worker = threading.Thread(target=contender)
    worker.start()
    try:
        deadline = time.monotonic() + 0.2
        while gate.stats()["waiting"] == 0 and time.monotonic() < deadline:
            time.sleep(0.005)
        with pytest.raises(GateSaturated) as exc_info:
            gate.acquire()
        assert exc_info.value.eta_s > 0
    finally:
        worker.join(timeout=1.0)
        gate.release()


def test_ema_hold_tracks_slot_duration():
    gate = QueryGate("test", limit=1, wait_timeout_s=0.5, max_queue=0)
    for _ in range(2):
        with gate.slot():
            time.sleep(0.02)
    assert gate.stats()["avg_hold_s"] > 0
