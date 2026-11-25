from __future__ import annotations

import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import build_text_index  # noqa: E402


def _write_fixture(meta_dir: Path) -> None:
    table = pa.table(
        {
            "text_content": [
                "Inflation inflation risks remain elevated",
                "Inflation expectations and inflation risks",
                "Policy statement on inflation and growth",
                "Growth outlook with inflation pressures",
            ],
            "meeting_date": [
                "2020-01-29",
                "2020-01-29",
                "2020-03-15",
                "2020-03-15",
            ],
            "doc_type": ["minutes", "minutes", "statements", "statements"],
            "sequence_num": [100, 200, 100, 200],
        }
    )
    for doc_type in ("minutes", "statements"):
        target = meta_dir / f"doc_type={doc_type}" / "year=2020" / "part-000.parquet"
        target.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(table.filter(pc.equal(table["doc_type"], doc_type)), target)


def test_build_text_index(tmp_path):
    meta_dir = tmp_path / "text_metadata"
    out_dir = tmp_path / "text_index"
    _write_fixture(meta_dir)

    rc = build_text_index.main(
        [
            "--text-metadata-dir",
            str(meta_dir),
            "--output-dir",
            str(out_dir),
            "--overwrite",
        ]
    )

    assert rc == 0
    shards = sorted(out_dir.glob("year=*/token_postings.parquet"))
    assert shards
    table = pq.read_table(shards[0])
    for column in ("token", "doc_type", "meeting_date", "seq"):
        assert column in table.column_names
    tokens = table.column("token").to_pylist()
    assert tokens.count("inflation") >= 1
