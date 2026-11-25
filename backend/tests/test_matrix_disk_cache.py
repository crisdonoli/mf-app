from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
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

TEXT_META_SCHEMA = pa.schema(
    [
        ("chunk_id", pa.string()),
        ("meeting_date", pa.string()),
        ("doc_type", pa.string()),
        ("year", pa.int32()),
        ("sequence_num", pa.int32()),
    ]
)

CHUNKS = [
    {"chunk_id": "transcripts_2008-09-16_0001", "meeting_date": "2008-09-16", "doc_type": "transcripts", "year": 2008, "sequence_num": 1},
    {"chunk_id": "transcripts_2008-09-16_0002", "meeting_date": "2008-09-16", "doc_type": "transcripts", "year": 2008, "sequence_num": 2},
    {"chunk_id": "transcripts_2008-09-17_0001", "meeting_date": "2008-09-17", "doc_type": "transcripts", "year": 2008, "sequence_num": 1},
    {"chunk_id": "transcripts_2008-09-17_0002", "meeting_date": "2008-09-17", "doc_type": "transcripts", "year": 2008, "sequence_num": 2},
]

LABELS = ["alpha", "beta", "gamma"]


@pytest.fixture(autouse=True)
def _clear_memory_caches():
    query_engine_module._SIM_YEAR_CACHE.clear()
    query_engine_module._DOC_IDS_BY_YEAR_CACHE.clear()
    yield
    query_engine_module._SIM_YEAR_CACHE.clear()
    query_engine_module._DOC_IDS_BY_YEAR_CACHE.clear()


def build_dataset(root: Path) -> Path:
    meta_dir = root / "text_metadata" / "doc_type=transcripts" / "year=2008"
    meta_dir.mkdir(parents=True, exist_ok=True)
    pq.write_table(pa.Table.from_pylist(CHUNKS, schema=TEXT_META_SCHEMA), meta_dir / "part-000.parquet")

    sim_dir = root / "similarities" / "model=bge-m3" / "pooling=chunk" / "doc_type=transcripts" / "year=2008"
    sim_dir.mkdir(parents=True, exist_ok=True)
    sim_type = pa.list_(pa.float32(), len(LABELS))
    sim_schema = pa.schema(
        [("chunk_id", pa.string()), ("similarity", sim_type)]
    ).with_metadata({b"similarity": json.dumps({"labels": LABELS}).encode("utf-8")})
    rows = [
        {"chunk_id": row["chunk_id"], "similarity": [float(i), float(i + 1), float(i + 2)]}
        for i, row in enumerate(CHUNKS)
    ]
    pq.write_table(pa.Table.from_pylist(rows, schema=sim_schema), sim_dir / "part-000.parquet")
    return sim_dir


def cache_file(root: Path, meeting_date: str) -> Path:
    return root / "similarities" / "model=bge-m3" / "matrix_cache" / "transcripts" / f"{meeting_date}.npz"


def test_first_call_persists_and_second_reads_disk(tmp_path):
    sim_dir = build_dataset(tmp_path)
    engine = ParquetQueryEngine(settings=Settings(fomc_data_dir=tmp_path))
    target = cache_file(tmp_path, "2008-09-16")

    ids_first, matrix_first, labels_first = engine.load_raw_similarity_slice("transcripts", "2008-09-16")
    assert target.is_file()
    assert ids_first == ["transcripts_2008-09-16_0001", "transcripts_2008-09-16_0002"]
    assert labels_first == LABELS
    assert matrix_first.shape == (2, len(LABELS))

    query_engine_module._SIM_YEAR_CACHE.clear()
    for parquet_path in sim_dir.glob("part-*.parquet"):
        parquet_path.unlink()

    ids_second, matrix_second, labels_second = engine.load_raw_similarity_slice("transcripts", "2008-09-16")
    assert ids_second == ids_first
    assert labels_second == labels_first
    np.testing.assert_allclose(matrix_second, matrix_first)


def test_corrupt_cache_is_discarded_and_recomputed(tmp_path):
    build_dataset(tmp_path)
    engine = ParquetQueryEngine(settings=Settings(fomc_data_dir=tmp_path))
    target = cache_file(tmp_path, "2008-09-16")

    engine.load_raw_similarity_slice("transcripts", "2008-09-16")
    assert target.is_file()
    target.write_bytes(b"not an npz payload")

    query_engine_module._SIM_YEAR_CACHE.clear()
    ids, matrix, labels = engine.load_raw_similarity_slice("transcripts", "2008-09-16")

    assert ids == ["transcripts_2008-09-16_0001", "transcripts_2008-09-16_0002"]
    assert labels == LABELS
    with np.load(target) as data:
        assert data["matrix"].shape == (2, len(LABELS))


def test_clear_speaker_catalog_cache_purges_disk_cache(tmp_path, monkeypatch):
    build_dataset(tmp_path)
    engine = ParquetQueryEngine(settings=Settings(fomc_data_dir=tmp_path))
    target = cache_file(tmp_path, "2008-09-16")

    engine.load_raw_similarity_slice("transcripts", "2008-09-16")
    assert target.is_file()

    monkeypatch.setattr(query_engine_module, "get_settings", lambda: engine.settings)
    query_engine_module.clear_speaker_catalog_cache()

    assert not target.exists()
