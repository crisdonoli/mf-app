from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_matrix_cache  # noqa: E402

LABELS = ["alpha", "beta", "gamma"]
CHUNKS = {
    "2020-01-29": [("m1", 100, [1.0, 0.0, 0.0]), ("m2", 200, [0.0, 1.0, 0.0])],
    "2020-03-15": [("m3", 100, [0.0, 0.0, 1.0]), ("m4", 200, [0.5, 0.5, 0.0])],
}


def _write_text_metadata(data_dir: Path) -> None:
    rows = [(cid, date, seq) for date, items in CHUNKS.items() for cid, seq, _ in items]
    table = pa.table(
        {
            "chunk_id": [r[0] for r in rows],
            "meeting_date": [r[1] for r in rows],
            "sequence_num": [r[2] for r in rows],
        }
    )
    target = data_dir / "text_metadata" / "doc_type=minutes" / "year=2020" / "part-000.parquet"
    target.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, target)


def _write_similarities(data_dir: Path) -> None:
    rows = [(cid, date, vec) for date, items in CHUNKS.items() for cid, _, vec in items]
    values = pa.array([v for r in rows for v in r[2]], type=pa.float32())
    table = pa.table(
        {
            "chunk_id": pa.array([r[0] for r in rows], pa.string()),
            "similarity": pa.FixedSizeListArray.from_arrays(values, len(LABELS)),
        }
    ).replace_schema_metadata({b"similarity": json.dumps({"labels": LABELS}).encode()})
    target = (
        data_dir
        / "similarities"
        / "model=bge-m3"
        / "pooling=chunk"
        / "doc_type=minutes"
        / "year=2020"
        / "part-000.parquet"
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, target)


def test_help():
    with pytest.raises(SystemExit) as excinfo:
        build_matrix_cache.main(["--help"])
    assert excinfo.value.code == 0


def test_builds_npz_per_meeting(tmp_path):
    _write_text_metadata(tmp_path)
    _write_similarities(tmp_path)
    out_dir = tmp_path / "out"

    rc = build_matrix_cache.main(
        ["--data-dir", str(tmp_path), "--output-dir", str(out_dir), "--overwrite"]
    )

    assert rc == 0
    assert sorted(p.name for p in out_dir.glob("minutes/*.npz")) == [
        "2020-01-29.npz",
        "2020-03-15.npz",
    ]
    with np.load(out_dir / "minutes" / "2020-01-29.npz") as data:
        assert data["chunk_ids"].tolist() == ["m1", "m2"]
        assert data["labels"].tolist() == LABELS
        assert data["matrix"].shape == (2, 3)
        assert data["matrix"].dtype == np.float32
        np.testing.assert_allclose(data["matrix"][1], [0.0, 1.0, 0.0], atol=1e-6)


def test_second_run_skips_without_overwrite(tmp_path):
    _write_text_metadata(tmp_path)
    _write_similarities(tmp_path)
    out_dir = tmp_path / "out"
    args = ["--data-dir", str(tmp_path), "--output-dir", str(out_dir)]

    assert build_matrix_cache.main(args) == 0
    target = out_dir / "minutes" / "2020-01-29.npz"
    mtime = target.stat().st_mtime_ns
    assert build_matrix_cache.main(args) == 0
    assert target.stat().st_mtime_ns == mtime


def test_no_similarities_dir_is_graceful(tmp_path):
    _write_text_metadata(tmp_path)
    out_dir = tmp_path / "out"

    rc = build_matrix_cache.main(["--data-dir", str(tmp_path), "--output-dir", str(out_dir)])

    assert rc == 0
    assert not list(out_dir.rglob("*.npz"))


def test_empty_data_dir_is_graceful(tmp_path):
    (tmp_path / "text_metadata").mkdir()

    rc = build_matrix_cache.main(["--data-dir", str(tmp_path), "--output-dir", str(tmp_path / "out")])

    assert rc == 0
    assert not list((tmp_path / "out").rglob("*.npz"))
