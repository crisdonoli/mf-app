from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.query_engine import (
    ParquetQueryEngine,
    cache_stats,
    clear_speaker_catalog_cache,
)


def test_search_documents_uses_cache(monkeypatch):
    clear_speaker_catalog_cache()
    calls = {"n": 0}

    def fake_uncached(self, *args, **kwargs):
        calls["n"] += 1
        return [{"document_id": "x"}], 1

    monkeypatch.setattr(ParquetQueryEngine, "_search_documents_uncached", fake_uncached)
    engine = ParquetQueryEngine(
        settings=SimpleNamespace(resolve_db_version_info=lambda: {"version": "test"})
    )

    first = engine.search_documents(date_from="1979-01-01", date_to="1979-12-31", query_text="x")
    second = engine.search_documents(date_from="1979-01-01", date_to="1979-12-31", query_text="x")

    assert first == second
    assert calls["n"] == 1
    assert cache_stats()["search"]["hits"] >= 1


def test_empty_result_is_cached(monkeypatch):
    clear_speaker_catalog_cache()
    calls = {"n": 0}

    def fake_collect(self, **kwargs):
        calls["n"] += 1
        return []

    monkeypatch.setattr(ParquetQueryEngine, "_collect_meta_files", fake_collect)
    engine = ParquetQueryEngine(
        settings=SimpleNamespace(
            resolve_db_version_info=lambda: {"version": "v-empty"},
            resolve_text_metadata_dir=lambda: Path("/nonexistent"),
        )
    )

    first = engine.search_documents(date_from="1979-01-01", date_to="1979-12-31", query_text="y")
    second = engine.search_documents(date_from="1979-01-01", date_to="1979-12-31", query_text="y")

    assert first == ([], 0)
    assert second == ([], 0)
    assert calls["n"] == 1
