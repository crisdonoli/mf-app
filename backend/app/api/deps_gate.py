"""FastAPI dependencies that bound concurrent CPU-heavy queries per worker."""

from __future__ import annotations

from fastapi import HTTPException

from ..config import get_settings
from ..core.query_gate import GateSaturated, get_gate

_RETRY_AFTER_S = {"heavy": "3", "corpus": "1"}


def _saturated_response(gate_name: str, exc: GateSaturated) -> HTTPException:
    position = exc.queue_depth
    eta_s = int(exc.eta_s)
    detail = (
        f"Servidor ocupado: tu consulta está en cola "
        f"(posición {position}, ~{eta_s}s de espera). "
        "Reintenta en unos segundos."
    )
    return HTTPException(
        status_code=503,
        detail=detail,
        headers={
            "X-Query-Gate": gate_name,
            "X-Queue-Position": str(position),
            "X-Queue-Eta-S": str(eta_s),
            "Retry-After": _RETRY_AFTER_S[gate_name],
        },
    )


def heavy_query_slot():
    gate = get_gate("heavy")
    try:
        with gate.slot(grace_s=get_settings().heavy_query_grace_s):
            yield
    except GateSaturated as exc:
        raise _saturated_response("heavy", exc) from exc


def corpus_query_slot():
    gate = get_gate("corpus")
    try:
        with gate.slot(grace_s=get_settings().corpus_query_grace_s):
            yield
    except GateSaturated as exc:
        raise _saturated_response("corpus", exc) from exc


def gate_stats_snapshot() -> dict:
    from ..core.query_engine import cache_stats

    return {
        "heavy": get_gate("heavy").stats(),
        "corpus": get_gate("corpus").stats(),
        "caches": cache_stats(),
    }
