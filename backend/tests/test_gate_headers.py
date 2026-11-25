"""Header contract returned when a query gate is saturated."""

from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.api import deps_gate
from app.core.query_gate import QueryGate


@pytest.fixture
def zero_grace(monkeypatch):
    monkeypatch.setattr(
        deps_gate,
        "get_settings",
        lambda: SimpleNamespace(heavy_query_grace_s=0.0, corpus_query_grace_s=0.0),
    )


def _client_with_gate(monkeypatch, gate, dependency):
    monkeypatch.setattr(deps_gate, "get_gate", lambda name: gate)
    app = FastAPI()

    @app.get("/probe")
    def _probe(_=Depends(dependency)):
        return {"ok": True}

    return TestClient(app)


def test_heavy_saturation_returns_503_with_queue_headers(monkeypatch, zero_grace):
    gate = QueryGate("heavy", limit=1, wait_timeout_s=0.05, max_queue=0)
    gate.acquire()
    try:
        response = _client_with_gate(
            monkeypatch, gate, deps_gate.heavy_query_slot
        ).get("/probe")
        assert response.status_code == 503
        assert response.headers["X-Query-Gate"] == "heavy"
        assert response.headers["X-Queue-Position"] == "0"
        assert response.headers["X-Queue-Eta-S"] == "0"
        assert response.headers["Retry-After"] == "3"
    finally:
        gate.release()


def test_corpus_saturation_returns_503_with_queue_headers(monkeypatch, zero_grace):
    gate = QueryGate("corpus", limit=1, wait_timeout_s=0.05, max_queue=0)
    gate.acquire()
    try:
        response = _client_with_gate(
            monkeypatch, gate, deps_gate.corpus_query_slot
        ).get("/probe")
        assert response.status_code == 503
        assert response.headers["X-Query-Gate"] == "corpus"
        assert response.headers["Retry-After"] == "1"
    finally:
        gate.release()
