"""FastAPI application entrypoint for MiningFOMC V3."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes_admin import router as admin_router
from .api.routes_auth import router as auth_router
from .api.routes_comparator import router as comparator_router
from .api.routes_explorer import router as explorer_router
from .api.routes_feedback import router as feedback_router
from .api.routes_filters import router as filters_router
from .api.routes_studies import router as studies_router
from .auth.security import hash_password
from .config import get_settings
from .core.query_engine import ParquetQueryEngine
from .db.repository import get_repository

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

LOGGER = logging.getLogger("miningfomc.main")


def create_app() -> FastAPI:
    """Application factory for MiningFOMC V3 backend."""
    settings = get_settings()

    # Log detected Parquet datasets clearly on boot
    settings.log_dataset_diagnostics()

    # Warm lightweight speaker autocomplete index on startup
    try:
        catalog = ParquetQueryEngine(settings).load_speaker_catalog()
        LOGGER.info("Loaded %d unique FOMC participants for speaker autocomplete.", len(catalog))
    except Exception as exc:  # pragma: no cover
        LOGGER.warning("Speaker autocomplete warmup skipped: %s", exc)

    # Bootstrap administrator account from .env (ADMIN_USERNAME, ADMIN_EMAIL, ADMIN_PASSWORD)
    get_repository().seed_admin_user(
        email=settings.admin_email,
        username=settings.admin_username,
        password_hash=hash_password(settings.admin_password),
    )

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "High-performance, out-of-core DuckDB + PyArrow analytical API for "
            "historical Federal Open Market Committee (FOMC) documents (1976–2020)."
        ),
        docs_url="/api/docs",
        redoc_url="/api/redoc",
        openapi_url="/api/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=[
            "X-Query-Gate",
            "X-Queue-Position",
            "X-Queue-Eta-S",
            "Retry-After",
        ],
    )

    app.include_router(explorer_router)
    app.include_router(comparator_router)
    app.include_router(auth_router)
    app.include_router(studies_router)
    app.include_router(feedback_router)
    app.include_router(filters_router)
    app.include_router(admin_router)

    return app


app = create_app()
