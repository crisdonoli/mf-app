"""Isolated Parquet ledger writer for accepted user label/distribution fix requests.

Appends accepted fixes to ``${DATA_DIR}/corrections/accepted_fixes.parquet``
using atomic temp-file replacement so raw source Parquet files are never mutated.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq

from ..config import Settings, get_settings

CORRECTIONS_SCHEMA = pa.schema(
    [
        ("username", pa.string()),
        ("timestamp", pa.string()),
        ("doc_type", pa.string()),
        ("original_table_id", pa.string()),
        ("corrected_value", pa.string()),
    ]
)


def append_accepted_fix(
    *,
    username: str,
    doc_type: str,
    original_table_id: str,
    corrected_value: dict[str, Any] | str,
    timestamp: str | None = None,
    settings: Settings | None = None,
) -> Path:
    """Append an accepted fix record to ``accepted_fixes.parquet`` atomically."""
    cfg = settings or get_settings()
    ledger_path = cfg.resolve_corrections_parquet()
    ledger_path.parent.mkdir(parents=True, exist_ok=True)

    ts = timestamp or datetime.now(timezone.utc).isoformat()
    serialized = (
        corrected_value
        if isinstance(corrected_value, str)
        else json.dumps(corrected_value, sort_keys=True)
    )

    new_row = pa.Table.from_pylist(
        [
            {
                "username": str(username),
                "timestamp": str(ts),
                "doc_type": str(doc_type),
                "original_table_id": str(original_table_id),
                "corrected_value": serialized,
            }
        ],
        schema=CORRECTIONS_SCHEMA,
    )

    if ledger_path.is_file():
        existing = pq.read_table(ledger_path)
        combined = pa.concat_tables([existing, new_row], promote_options="default")
    else:
        combined = new_row

    tmp_path = ledger_path.with_name(f"{ledger_path.name}.tmp")
    pq.write_table(combined, str(tmp_path), compression="zstd")
    os.replace(tmp_path, ledger_path)
    return ledger_path
