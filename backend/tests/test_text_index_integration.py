from __future__ import annotations

import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
APP_ROOT = BACKEND_ROOT.parent
for _root in (BACKEND_ROOT, APP_ROOT):
    if str(_root) not in sys.path:
        sys.path.insert(0, str(_root))

from app.config import Settings
from app.core import query_engine as query_engine_module
from app.core.query_engine import ParquetQueryEngine
from scripts.build_text_index import main as build_text_index


@pytest.fixture(autouse=True)
def _clear_search_cache():
    query_engine_module._SEARCH_CACHE.clear()
    yield
    query_engine_module._SEARCH_CACHE.clear()

TEXT_META_SCHEMA = pa.schema(
    [
        ("chunk_id", pa.string()),
        ("meeting_date", pa.string()),
        ("doc_type", pa.string()),
        ("year", pa.int32()),
        ("source_file", pa.string()),
        ("sequence_num", pa.int32()),
        ("speaker", pa.string()),
        ("text_content", pa.string()),
    ]
)

CHUNKS = [
    {
        "chunk_id": "transcripts_2008-09-16_0001",
        "meeting_date": "2008-09-16",
        "doc_type": "transcripts",
        "year": 2008,
        "source_file": "transcripts/2008-09-16.pdf",
        "sequence_num": 1,
        "speaker": "CHAIRMAN BERNANKE",
        "text_content": "Inflation expectations remain anchored despite energy volatility.",
    },
    {
        "chunk_id": "transcripts_2008-09-16_0002",
        "meeting_date": "2008-09-16",
        "doc_type": "transcripts",
        "year": 2008,
        "source_file": "transcripts/2008-09-16.pdf",
        "sequence_num": 2,
        "speaker": "MS. YELLEN",
        "text_content": "Labor market slack is rising and credit conditions tighten.",
    },
    {
        "chunk_id": "minutes_2009-03-18_0001",
        "meeting_date": "2009-03-18",
        "doc_type": "minutes",
        "year": 2009,
        "source_file": "minutes/2009-03-18.pdf",
        "sequence_num": 1,
        "speaker": "MR. BERNANKE",
        "text_content": "Credit conditions tightened sharply across funding markets.",
    },
    {
        "chunk_id": "minutes_2009-03-18_0002",
        "meeting_date": "2009-03-18",
        "doc_type": "minutes",
        "year": 2009,
        "source_file": "minutes/2009-03-18.pdf",
        "sequence_num": 2,
        "speaker": "MS. YELLEN",
        "text_content": "Housing starts declined further as unemployment climbed.",
    },
]


def build_corpus(root: Path) -> Path:
    meta_dir = root / "text_metadata"
    by_partition: dict[tuple[str, int], list[dict]] = {}
    for row in CHUNKS:
        by_partition.setdefault((row["doc_type"], row["year"]), []).append(row)
    for (doc_type, year), rows in by_partition.items():
        target = meta_dir / f"doc_type={doc_type}" / f"year={year}"
        target.mkdir(parents=True, exist_ok=True)
        pq.write_table(
            pa.Table.from_pylist(rows, schema=TEXT_META_SCHEMA),
            target / "part-000.parquet",
        )
    assert build_text_index(["--data-dir", str(root), "--overwrite"]) == 0
    return root / "text_index"


def test_indexed_search_uses_inverted_index(tmp_path, monkeypatch):
    index_dir = build_corpus(tmp_path)

    monkeypatch.setattr(ParquetQueryEngine, "_index_available", lambda self: True)
    monkeypatch.setattr(Settings, "resolve_text_index_dir", lambda self: index_dir)

    def fail_scan(self, **kwargs):
        raise AssertionError("duckdb scan must not run when the inverted index is available")

    monkeypatch.setattr(ParquetQueryEngine, "_search_documents_duckdb", fail_scan)

    engine = ParquetQueryEngine(settings=Settings(fomc_data_dir=tmp_path))
    results, total = engine.search_documents(
        date_from="2008-01-01", date_to="2009-12-31", query_text="inflation", limit=10
    )

    assert total == 1
    assert len(results) == 1
    assert results[0]["meeting_date"] == "2008-09-16"
    assert results[0]["doc_type"] == "transcripts"
    assert results[0]["chunk_count"] == 1


def test_regex_query_falls_back_to_scan(tmp_path, monkeypatch):
    index_dir = build_corpus(tmp_path)

    monkeypatch.setattr(ParquetQueryEngine, "_index_available", lambda self: True)
    monkeypatch.setattr(Settings, "resolve_text_index_dir", lambda self: index_dir)

    calls = {"n": 0}
    original = ParquetQueryEngine._search_documents_duckdb

    def counting_scan(self, **kwargs):
        calls["n"] += 1
        return original(self, **kwargs)

    monkeypatch.setattr(ParquetQueryEngine, "_search_documents_duckdb", counting_scan)

    engine = ParquetQueryEngine(settings=Settings(fomc_data_dir=tmp_path))
    results, total = engine.search_documents(
        date_from="2008-01-01", date_to="2009-12-31", query_text="infl.*", use_regex=True, limit=10
    )

    assert calls["n"] > 0
    assert total == 1
    assert results[0]["meeting_date"] == "2008-09-16"


def test_missing_index_falls_back_to_scan(tmp_path, monkeypatch):
    build_corpus(tmp_path)

    monkeypatch.setattr(ParquetQueryEngine, "_index_available", lambda self: False)

    calls = {"n": 0}
    original = ParquetQueryEngine._search_documents_duckdb

    def counting_scan(self, **kwargs):
        calls["n"] += 1
        return original(self, **kwargs)

    monkeypatch.setattr(ParquetQueryEngine, "_search_documents_duckdb", counting_scan)

    engine = ParquetQueryEngine(settings=Settings(fomc_data_dir=tmp_path))
    results, total = engine.search_documents(
        date_from="2008-01-01", date_to="2009-12-31", query_text="inflation", limit=10
    )

    assert calls["n"] > 0
    assert total == 1


def test_index_zero_matches_skips_scan(tmp_path, monkeypatch):
    index_dir = build_corpus(tmp_path)

    monkeypatch.setattr(ParquetQueryEngine, "_index_available", lambda self: True)
    monkeypatch.setattr(Settings, "resolve_text_index_dir", lambda self: index_dir)

    def fail_scan(self, **kwargs):
        raise AssertionError("scan must not run when the index reports zero matches")

    monkeypatch.setattr(ParquetQueryEngine, "_search_documents_duckdb", fail_scan)

    engine = ParquetQueryEngine(settings=Settings(fomc_data_dir=tmp_path))
    results, total = engine.search_documents(
        date_from="2008-01-01", date_to="2009-12-31", query_text="zzzznomatch", limit=10
    )

    assert (results, total) == ([], 0)
