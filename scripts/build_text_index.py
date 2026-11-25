#!/usr/bin/env python3
"""Build a per-year inverted index (token -> document postings) from text_metadata."""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

import pyarrow as pa
import pyarrow.parquet as pq

TOKEN_RE = re.compile(r"\w+")
REQUIRED_COLUMNS = ("text_content", "meeting_date", "doc_type", "sequence_num")
WRITE_BATCH_ROWS = 200_000

Posting = Tuple[str, str, int]
YearPostings = Dict[str, Set[Posting]]

log = logging.getLogger("build_text_index")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", default="/fomc-data")
    parser.add_argument("--text-metadata-dir")
    parser.add_argument("--output-dir")
    parser.add_argument("--batch-size", type=int, default=5000)
    parser.add_argument("--min-token-len", type=int, default=3)
    parser.add_argument("--overwrite", action="store_true")
    return parser.parse_args(argv)


def resolve_text_metadata_dir(data_dir: Path, explicit: Optional[str]) -> Optional[Path]:
    if explicit:
        path = Path(explicit)
        return path if path.is_dir() else None
    candidates = [
        data_dir / "text_metadata",
        data_dir / "data-processed" / "text_metadata",
        data_dir / "data" / "output" / "data-processed" / "text_metadata",
        data_dir / "output" / "data-processed" / "text_metadata",
    ]
    for path in candidates:
        if path.is_dir() and any(path.glob("doc_type=*")):
            return path
    return None


def discover_files(root: Path) -> List[Path]:
    files = sorted(root.glob("doc_type=*/year=*/*.parquet"))
    if not files:
        files = sorted(root.rglob("*.parquet"))
    return files


def partition_year(path: Path, root: Path) -> Optional[str]:
    for parent in path.parents:
        if parent == root:
            break
        if parent.name.startswith("year="):
            value = parent.name[len("year="):]
            return value if value.isdigit() else None
    return None


def tokenize(text: object, min_len: int) -> Set[str]:
    return {tok for tok in TOKEN_RE.findall(str(text).lower()) if len(tok) >= min_len}


def accumulate_file(
    path: Path,
    batch_size: int,
    min_len: int,
    buckets: Dict[str, YearPostings],
    tokens_seen: Set[str],
) -> int:
    parquet = pq.ParquetFile(path)
    available = set(parquet.schema_arrow.names)
    missing = [col for col in REQUIRED_COLUMNS if col not in available]
    if missing:
        log.warning("skip %s: missing columns %s", path, missing)
        return 0

    chunks = 0
    columns = list(REQUIRED_COLUMNS)
    for batch in parquet.iter_batches(batch_size=batch_size, columns=columns):
        data = batch.to_pydict()
        for text, meeting_date, doc_type, sequence_num in zip(
            data["text_content"],
            data["meeting_date"],
            data["doc_type"],
            data["sequence_num"],
        ):
            chunks += 1
            date = "" if meeting_date is None else str(meeting_date)
            year = date[:4]
            if not year.isdigit():
                continue
            tokens = tokenize(text, min_len)
            if not tokens:
                continue
            tokens_seen.update(tokens)
            year_bucket = buckets.setdefault(year, {})
            posting: Posting = (str(doc_type), date, int(sequence_num))
            for token in tokens:
                year_bucket.setdefault(token, set()).add(posting)
    return chunks


def write_shard(output_dir: Path, year: str, postings: YearPostings) -> bool:
    target = output_dir / f"year={year}" / "token_postings.parquet"
    target.parent.mkdir(parents=True, exist_ok=True)
    writer = None
    buffer: List[Tuple[str, str, str, int, int]] = []

    def flush() -> None:
        nonlocal writer
        if not buffer:
            return
        table = pa.table(
            {
                "token": pa.array([row[0] for row in buffer], pa.string()),
                "doc_type": pa.array([row[1] for row in buffer], pa.string()),
                "meeting_date": pa.array([row[2] for row in buffer], pa.string()),
                "seq": pa.array([row[3] for row in buffer], pa.int64()),
                "year": pa.array([row[4] for row in buffer], pa.int32()),
            }
        )
        if writer is None:
            writer = pq.ParquetWriter(target, table.schema, compression="zstd")
        writer.write_table(table)
        buffer.clear()

    for token in sorted(postings):
        for doc_type, meeting_date, seq in sorted(postings[token]):
            buffer.append((token, doc_type, meeting_date, seq, int(year)))
            if len(buffer) >= WRITE_BATCH_ROWS:
                flush()
    flush()
    if writer is None:
        return False
    writer.close()
    return True


def process_group(
    files: List[Path],
    root: Path,
    output_dir: Path,
    batch_size: int,
    min_len: int,
    overwrite: bool,
    tokens_seen: Set[str],
) -> Tuple[int, int, int]:
    files_read = 0
    chunks = 0
    shards = 0
    buckets: Dict[str, YearPostings] = {}
    for path in files:
        read = accumulate_file(path, batch_size, min_len, buckets, tokens_seen)
        if read:
            files_read += 1
            chunks += read
    for year in sorted(buckets, key=int):
        target = output_dir / f"year={year}" / "token_postings.parquet"
        if target.exists() and not overwrite:
            log.info("skip existing shard %s", target)
            continue
        if write_shard(output_dir, year, buckets[year]):
            log.info("wrote shard %s", target)
            shards += 1
    buckets.clear()
    return files_read, chunks, shards


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    args = parse_args(argv)
    data_dir = Path(args.data_dir)
    metadata_dir = resolve_text_metadata_dir(data_dir, args.text_metadata_dir)
    if metadata_dir is None:
        log.error("text_metadata directory not found under %s", data_dir)
        return 1

    files = discover_files(metadata_dir)
    if not files:
        log.error("no parquet files found under %s", metadata_dir)
        return 1

    output_dir = Path(args.output_dir) if args.output_dir else data_dir / "text_index"
    output_dir.mkdir(parents=True, exist_ok=True)

    grouped: Dict[Optional[str], List[Path]] = {}
    for path in files:
        grouped.setdefault(partition_year(path, metadata_dir), []).append(path)

    tokens_seen: Set[str] = set()
    files_read = 0
    chunks = 0
    shards = 0
    for year in sorted((y for y in grouped if y is not None), key=int):
        shard = output_dir / f"year={year}" / "token_postings.parquet"
        if shard.exists() and not args.overwrite:
            log.info("skip existing shard %s", shard)
            continue
        read, processed, written = process_group(
            grouped[year],
            metadata_dir,
            output_dir,
            args.batch_size,
            args.min_token_len,
            args.overwrite,
            tokens_seen,
        )
        files_read += read
        chunks += processed
        shards += written
    if None in grouped:
        read, processed, written = process_group(
            grouped[None],
            metadata_dir,
            output_dir,
            args.batch_size,
            args.min_token_len,
            args.overwrite,
            tokens_seen,
        )
        files_read += read
        chunks += processed
        shards += written

    total_bytes = sum(p.stat().st_size for p in output_dir.rglob("*.parquet"))
    summary = {
        "files_read": files_read,
        "chunks_processed": chunks,
        "unique_tokens": len(tokens_seen),
        "shards_written": shards,
        "output_bytes": total_bytes,
    }
    log.info("summary %s", json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
