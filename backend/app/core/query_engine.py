"""Out-of-core Parquet query engine powered by DuckDB with PyArrow pushdown fallback.

Strictly adheres to zero-RAM-bloat principles:
- Never loads full Parquet datasets into Pandas/Polars DataFrames.
- Uses DuckDB ``read_parquet(..., union_by_name=true)`` with SQL projection
  and predicate pushdown.
- Supports text_metadata, agenda_items, flat participants.parquet +
  participants_report.json (plus legacy yearly partitions), speeches,
  similarities, zero-shot labels, and model/relevance_score.parquet.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as ds
import pyarrow.parquet as pq

from ..config import CORPUS_MAX_DATE, CORPUS_MAX_YEAR, CORPUS_MIN_YEAR, Settings, get_settings
from .cache import BoundedDict, SharedSearchCache, approx_size
from .taxonomy import resolve_column_labels

try:
    import duckdb  # type: ignore

    HAS_DUCKDB = True
except ImportError:  # pragma: no cover
    duckdb = None
    HAS_DUCKDB = False

_YEAR_RE = re.compile(r"year=(\d{4})")
_SUBCHUNK_RE = re.compile(r"_s\d+$")

LOGGER = logging.getLogger(__name__)

# Bounded module-level caches keyed by source paths. Hard caps keep the 1.86 GiB host safe.
_SPEAKER_CATALOG_CACHE: BoundedDict = BoundedDict(max_entries=8)
_CORPUS_STATS_CACHE: BoundedDict = BoundedDict(max_entries=8)
_DOC_IDS_BY_YEAR_CACHE: BoundedDict = BoundedDict(max_entries=8)
_DOC_SPEAKER_META_CACHE: BoundedDict = BoundedDict(max_entries=8)
_SIM_YEAR_CACHE: BoundedDict = BoundedDict(max_entries=4)
_ZS_YEAR_CACHE: BoundedDict = BoundedDict(max_entries=4)
_SEARCH_CACHE = SharedSearchCache(
    "search",
    max_entries=48,
    ttl_s=900,
    max_bytes=64 * 1024 * 1024,
    size_fn=approx_size,
)


def cache_stats() -> dict[str, Any]:
    return {
        "search": _SEARCH_CACHE.stats(),
        "speaker_catalog": {"entries": len(_SPEAKER_CATALOG_CACHE), "max_entries": _SPEAKER_CATALOG_CACHE.max_entries},
        "corpus_stats": {"entries": len(_CORPUS_STATS_CACHE), "max_entries": _CORPUS_STATS_CACHE.max_entries},
        "doc_ids": {"entries": len(_DOC_IDS_BY_YEAR_CACHE), "max_entries": _DOC_IDS_BY_YEAR_CACHE.max_entries},
        "doc_speaker_meta": {"entries": len(_DOC_SPEAKER_META_CACHE), "max_entries": _DOC_SPEAKER_META_CACHE.max_entries},
        "sim_year": {"entries": len(_SIM_YEAR_CACHE), "max_entries": _SIM_YEAR_CACHE.max_entries},
        "zs_year": {"entries": len(_ZS_YEAR_CACHE), "max_entries": _ZS_YEAR_CACHE.max_entries},
    }


def clear_speaker_catalog_cache() -> None:
    """Reset the cached speaker autocomplete catalog, corpus stats, partition caches, and search results."""
    _SPEAKER_CATALOG_CACHE.clear()
    _CORPUS_STATS_CACHE.clear()
    _DOC_IDS_BY_YEAR_CACHE.clear()
    _DOC_SPEAKER_META_CACHE.clear()
    _SIM_YEAR_CACHE.clear()
    _ZS_YEAR_CACHE.clear()
    _SEARCH_CACHE.clear()
    try:
        for npz_path in get_settings().resolve_matrix_cache_dir().rglob("*.npz"):
            npz_path.unlink(missing_ok=True)
    except Exception as exc:
        LOGGER.warning("Could not purge similarity disk cache: %s", exc)


def _norm_speaker(name: str) -> str:
    """Normalize speaker string for matching against participant rosters."""
    cleaned = re.sub(r"[^a-z0-9\s]", " ", (name or "").lower())
    return " ".join(cleaned.split())


_SPEAKER_TITLES = {
    "mr",
    "ms",
    "mrs",
    "dr",
    "messrs",
    "mister",
    "madam",
    "chairman",
    "chair",
    "vice",
    "president",
    "governor",
}


def _speaker_surname_key(name: str) -> str:
    """Return the normalized surname token, dropping honorifics and title suffixes."""
    primary = (name or "").split(",", 1)[0]
    tokens = [
        token
        for token in _norm_speaker(primary).split()
        if token not in _SPEAKER_TITLES
    ]
    return tokens[-1] if tokens else ""


def _normalize_gender(value: Any) -> str:
    """Canonicalize gender values from flat/legacy participant sources."""
    norm = str(value or "").strip().lower()
    if norm in {"m", "male"}:
        return "Male"
    if norm in {"f", "female"}:
        return "Female"
    return ""


def _normalize_date_bounds(
    date_from: str | None,
    date_to: str | None,
    meeting_date: str | None,
) -> tuple[str | None, str | None, str | None, bool]:
    """Normalize unified date filters and enforce the 2020-12-31 upper bound.

    Rule:
    - If ``meeting_date`` is explicitly set, match that single date (if <= 2020-12-31).
    - If ``date_from`` is set and ``date_to`` is empty/None, treat ``date_from`` as
      an exact single-date match.
    - Clamp ``date_to`` to ``2020-12-31``.
    - Returns ``(eff_from, eff_to, eff_meeting, out_of_range)``.
    """
    m_date = (meeting_date or "").strip() or None
    d_from = (date_from or "").strip() or None
    d_to = (date_to or "").strip() or None

    if m_date:
        if m_date > CORPUS_MAX_DATE:
            return None, None, m_date, True
        return None, None, m_date, False

    if d_from and not d_to:
        if d_from > CORPUS_MAX_DATE:
            return None, None, d_from, True
        return None, None, d_from, False

    if d_from and d_from > CORPUS_MAX_DATE:
        return d_from, d_to, None, True

    if d_to and d_to > CORPUS_MAX_DATE:
        d_to = CORPUS_MAX_DATE

    if d_from and d_to and d_from > d_to:
        return d_from, d_to, None, True

    return d_from, d_to, None, False


class ParquetQueryEngine:
    """Lazy, out-of-core Parquet query engine over ``DATA_DIR``."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    def _connect_duckdb(self):
        conn = duckdb.connect(database=":memory:")
        conn.execute(f"SET memory_limit = '{self.settings.duckdb_memory_limit}'")
        conn.execute(f"SET threads = {int(self.settings.duckdb_threads)}")
        return conn

    # ------------------------------------------------------------------ Discovery
    def discover_doc_types(self) -> list[str]:
        meta_dir = self.settings.resolve_text_metadata_dir()
        found: set[str] = set()
        if meta_dir.is_dir():
            for entry in meta_dir.glob("doc_type=*"):
                if entry.is_dir():
                    found.add(entry.name.split("=", 1)[1])
        if self.settings.resolve_agenda_items_dir().is_dir():
            found.add("agenda_items")
        if self.settings.resolve_speeches_parquet().is_file():
            found.add("speeches")
        return sorted(found)

    def _collect_meta_files(
        self,
        doc_type: str | None = None,
        doc_types: list[str] | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        meeting_date: str | None = None,
    ) -> list[Path]:
        meta_dir = self.settings.resolve_text_metadata_dir()
        if not meta_dir.is_dir():
            return []

        min_year: int | None = None
        max_year: int | None = CORPUS_MAX_YEAR
        if meeting_date and len(meeting_date) >= 4:
            min_year = max_year = min(int(meeting_date[:4]), CORPUS_MAX_YEAR)
        else:
            if date_from and len(date_from) >= 4:
                min_year = int(date_from[:4])
            if date_to and len(date_to) >= 4:
                max_year = min(int(date_to[:4]), CORPUS_MAX_YEAR)

        eff_types: list[str] = []
        if doc_types:
            eff_types = [d.strip() for d in doc_types if d and d.strip()]
        elif doc_type:
            eff_types = [d.strip() for d in doc_type.split(",") if d.strip()]

        dt_dirs = (
            [meta_dir / f"doc_type={dt}" for dt in eff_types]
            if eff_types
            else sorted(p for p in meta_dir.glob("doc_type=*") if p.is_dir())
        )

        files: list[Path] = []
        for dt_dir in dt_dirs:
            if not dt_dir.is_dir():
                continue
            for year_dir in sorted(dt_dir.glob("year=*")):
                match = _YEAR_RE.search(year_dir.name)
                if match:
                    yr = int(match.group(1))
                    if min_year is not None and yr < min_year:
                        continue
                    if max_year is not None and yr > max_year:
                        continue
                files.extend(sorted(year_dir.glob("part-*.parquet")))
        return files

    # ------------------------------------------------------------------ Participants Roster & Autocomplete
    def _ingest_participant_parquet(
        self,
        pq_path: Path,
        roster: dict[str, dict[str, str]],
        catalog_by_key: dict[str, dict[str, Any]] | None = None,
        surname_genders: dict[str, set[str]] | None = None,
    ) -> None:
        """Read participant metadata columns from a single Parquet file."""
        try:
            schema_names = set(pq.read_schema(pq_path).names)
            desired = (
                "name_norm",
                "name_raw",
                "board_member_name",
                "gender",
                "role",
                "role_category",
                "affiliation",
                "institution",
                "n_turns",
            )
            cols = [c for c in desired if c in schema_names]
            if not cols:
                return
            table = pq.read_table(pq_path, columns=cols)
            for r in table.to_pylist():
                gender = _normalize_gender(r.get("gender"))
                role = str(r.get("role_category") or r.get("role") or "").strip()
                affiliation = str(r.get("institution") or r.get("affiliation") or "").strip()
                n_turns = int(r.get("n_turns") or 0)
                info = {"gender": gender, "role": role, "affiliation": affiliation}

                board_name = str(r.get("board_member_name") or "").strip()
                name_raw = str(r.get("name_raw") or "").strip()
                name_norm = str(r.get("name_norm") or "").strip()

                keys: set[str] = set()
                surname_keys: set[str] = set()
                for raw_k in (name_norm, name_raw, board_name):
                    if not raw_k:
                        continue
                    norm_k = _norm_speaker(raw_k)
                    if norm_k:
                        keys.add(norm_k)
                    surname_k = _speaker_surname_key(raw_k)
                    if surname_k:
                        keys.add(surname_k)
                        surname_keys.add(surname_k)

                for key in keys:
                    existing = roster.get(key)
                    if existing is None:
                        roster[key] = dict(info)
                    elif not existing.get("gender") and gender:
                        existing["gender"] = gender

                if surname_genders is not None and gender:
                    for surname_k in surname_keys:
                        surname_genders.setdefault(surname_k, set()).add(gender)

                if catalog_by_key is not None:
                    display_name = board_name or name_raw or name_norm
                    if not display_name:
                        continue
                    # For search matching in text_metadata, raw/norm surname or full name works well;
                    # prefer board_member_name for display and keep search_value clean.
                    canonical_key = _norm_speaker(display_name)
                    if not canonical_key:
                        continue
                    aliases = {
                        a for a in (board_name, name_raw, name_norm) if a
                    }
                    existing = catalog_by_key.get(canonical_key)
                    if existing is None:
                        catalog_by_key[canonical_key] = {
                            "name": display_name,
                            "search_value": name_raw or display_name,
                            "role": role,
                            "affiliation": affiliation,
                            "gender": gender,
                            "n_turns": n_turns,
                            "aliases": aliases,
                            "search_blob": " ".join(_norm_speaker(a) for a in aliases),
                        }
                    else:
                        existing["n_turns"] = max(existing["n_turns"], n_turns)
                        if not existing["role"] and role:
                            existing["role"] = role
                        if not existing["affiliation"] and affiliation:
                            existing["affiliation"] = affiliation
                        if not existing["gender"] and gender:
                            existing["gender"] = gender
                        existing["aliases"].update(aliases)
                        existing["search_blob"] = " ".join(
                            _norm_speaker(a) for a in existing["aliases"]
                        )
        except Exception:
            return

    def load_participants_roster(
        self,
        years: set[int] | None = None,
    ) -> dict[str, dict[str, str]]:
        """Load lightweight speaker -> {gender, role} map from participants.parquet or partitions."""
        roster: dict[str, dict[str, str]] = {}
        surname_genders: dict[str, set[str]] = {}

        # 1. Flat participants.parquet (produced by fomc-data/scripts/process-participants.py)
        flat_file = self.settings.resolve_participants_file()
        if flat_file.is_file():
            self._ingest_participant_parquet(flat_file, roster, surname_genders=surname_genders)

        # 2. Legacy yearly partitions participants/year=*/part-*.parquet
        part_dir = self.settings.resolve_participants_dir()
        if part_dir.is_dir():
            for year_dir in sorted(part_dir.glob("year=*")):
                m = _YEAR_RE.search(year_dir.name)
                if years and m and int(m.group(1)) not in years:
                    continue
                for pq_path in sorted(year_dir.glob("part-*.parquet")):
                    self._ingest_participant_parquet(
                        pq_path, roster, surname_genders=surname_genders
                    )

        # 3. Ambiguous surnames are not attributed to a single gender.
        for surname_k, genders in surname_genders.items():
            if len(genders) > 1 and surname_k in roster:
                roster[surname_k]["gender"] = ""
        return roster

    def load_speaker_catalog(self) -> list[dict[str, Any]]:
        """Load and cache the deduplicated FOMC participant catalog for fast autocomplete.

        Backed by ``participants.parquet`` (flat or partitioned) and ``participants_report.json``
        in the same folder as ``data-processed``.
        """
        flat_file = self.settings.resolve_participants_file()
        report_file = self.settings.resolve_participants_report_json()
        part_dir = self.settings.resolve_participants_dir()
        cache_key = (str(flat_file), str(report_file), str(part_dir))
        if cache_key in _SPEAKER_CATALOG_CACHE:
            return _SPEAKER_CATALOG_CACHE[cache_key]

        roster: dict[str, dict[str, str]] = {}
        catalog_by_key: dict[str, dict[str, Any]] = {}

        if flat_file.is_file():
            self._ingest_participant_parquet(flat_file, roster, catalog_by_key)

        if part_dir.is_dir():
            for pq_path in sorted(part_dir.glob("year=*/part-*.parquet")):
                self._ingest_participant_parquet(pq_path, roster, catalog_by_key)

        # Supplement / fallback from participants_report.json
        if report_file.is_file():
            try:
                report_data = json.loads(report_file.read_text(encoding="utf-8"))
                json_names: list[tuple[str, str]] = []
                bm_names = report_data.get("board_members", {}).get("matched_names") or []
                for nm in bm_names:
                    if isinstance(nm, str) and nm.strip():
                        json_names.append((nm.strip(), "Board Member"))
                rescued_names = report_data.get("roster", {}).get("rescued_names") or []
                for nm in rescued_names:
                    if isinstance(nm, str) and nm.strip():
                        json_names.append((nm.strip(), "FOMC Participant"))

                for nm, default_role in json_names:
                    ck = _norm_speaker(nm)
                    if not ck:
                        continue
                    if ck not in catalog_by_key:
                        catalog_by_key[ck] = {
                            "name": nm,
                            "search_value": nm,
                            "role": default_role,
                            "affiliation": "",
                            "gender": "",
                            "n_turns": 0,
                            "aliases": {nm},
                            "search_blob": ck,
                        }
            except Exception:
                pass

        items = sorted(
            [
                {
                    "name": entry["name"],
                    "search_value": entry["search_value"],
                    "role": entry["role"],
                    "affiliation": entry["affiliation"],
                    "gender": entry["gender"],
                    "n_turns": entry["n_turns"],
                    "_norm": _norm_speaker(entry["name"]),
                    "_blob": entry["search_blob"],
                }
                for entry in catalog_by_key.values()
            ],
            key=lambda x: (-x["n_turns"], x["name"].lower()),
        )
        _SPEAKER_CATALOG_CACHE[cache_key] = items
        return items

    def search_speakers(self, query: str = "", limit: int = 15) -> list[dict[str, Any]]:
        """Instant type-ahead search over the cached FOMC participant catalog."""
        catalog = self.load_speaker_catalog()
        q_norm = _norm_speaker(query)
        if not q_norm:
            return [
                {
                    "name": item["name"],
                    "search_value": item["search_value"],
                    "role": item["role"],
                    "affiliation": item["affiliation"],
                    "gender": item["gender"],
                    "n_turns": item["n_turns"],
                }
                for item in catalog[:limit]
            ]

        prefix_matches: list[dict[str, Any]] = []
        word_matches: list[dict[str, Any]] = []
        sub_matches: list[dict[str, Any]] = []

        for item in catalog:
            norm = item["_norm"]
            blob = item["_blob"]
            if norm.startswith(q_norm):
                prefix_matches.append(item)
            elif any(tok.startswith(q_norm) for tok in blob.split()):
                word_matches.append(item)
            elif q_norm in blob:
                sub_matches.append(item)

        ranked = (prefix_matches + word_matches + sub_matches)[:limit]
        return [
            {
                "name": item["name"],
                "search_value": item["search_value"],
                "role": item["role"],
                "affiliation": item["affiliation"],
                "gender": item["gender"],
                "n_turns": item["n_turns"],
            }
            for item in ranked
        ]

    def speakers_matching_gender(self, gender: str) -> set[str]:
        g_low = gender.strip().lower()
        roster = self.load_participants_roster()
        matched: set[str] = set()
        for sp_norm, info in roster.items():
            rg = info.get("gender", "").lower()
            if (
                rg == g_low
                or (g_low in ("female", "f") and rg in ("f", "female"))
                or (g_low in ("male", "m") and rg in ("m", "male"))
            ):
                matched.add(sp_norm)
        return matched

    # ------------------------------------------------------------------ Corpus Stats
    def get_corpus_stats(self) -> dict[str, Any]:
        meta_dir = self.settings.resolve_text_metadata_dir()
        sim_dir = self.settings.resolve_similarities_dir()
        cache_key = (str(meta_dir), str(sim_dir))
        if cache_key in _CORPUS_STATS_CACHE:
            return dict(_CORPUS_STATS_CACHE[cache_key])

        total_chunks = 0
        years: set[int] = set()
        doc_type_counts: dict[str, int] = {}
        parquet_files = 0

        if meta_dir.is_dir():
            for dt_dir in sorted(p for p in meta_dir.glob("doc_type=*") if p.is_dir()):
                dt = dt_dir.name.split("=", 1)[1]
                dt_rows = 0
                for pq_path in dt_dir.glob("year=*/part-*.parquet"):
                    m = _YEAR_RE.search(pq_path.parent.name)
                    if m:
                        yr = int(m.group(1))
                        if yr < CORPUS_MIN_YEAR or yr > CORPUS_MAX_YEAR:
                            continue
                        years.add(yr)
                    parquet_files += 1
                    try:
                        pf = pq.ParquetFile(pq_path)
                        dt_rows += pf.metadata.num_rows
                    except Exception:
                        continue
                if dt_rows > 0:
                    doc_type_counts[dt] = dt_rows
                    total_chunks += dt_rows

        if "agenda_items" not in doc_type_counts:
            agenda_dir = self.settings.resolve_agenda_items_dir()
            if agenda_dir.is_dir():
                agenda_rows = 0
                for pq_path in agenda_dir.glob("year=*/part-*.parquet"):
                    m = _YEAR_RE.search(pq_path.parent.name)
                    if m and (int(m.group(1)) < CORPUS_MIN_YEAR or int(m.group(1)) > CORPUS_MAX_YEAR):
                        continue
                    parquet_files += 1
                    try:
                        agenda_rows += pq.ParquetFile(pq_path).metadata.num_rows
                    except Exception:
                        continue
                if agenda_rows:
                    doc_type_counts["agenda_items"] = agenda_rows
                    total_chunks += agenda_rows

        if "speeches" not in doc_type_counts:
            speeches_file = self.settings.resolve_speeches_parquet()
            if speeches_file.is_file():
                parquet_files += 1
                try:
                    s_rows = pq.ParquetFile(speeches_file).metadata.num_rows
                    doc_type_counts["speeches"] = s_rows
                    total_chunks += s_rows
                except Exception:
                    pass

        sim_files = (
            len(list(sim_dir.glob("doc_type=*/year=*/part-*.parquet")))
            if sim_dir.is_dir()
            else 0
        )

        stats = {
            "total_chunks": total_chunks,
            "doc_types_count": len(doc_type_counts),
            "doc_type_chunk_counts": doc_type_counts,
            "year_min": max(min(years), CORPUS_MIN_YEAR) if years else CORPUS_MIN_YEAR,
            "year_max": min(max(years), CORPUS_MAX_YEAR) if years else CORPUS_MAX_YEAR,
            "parquet_files": parquet_files,
            "similarity_partitions": sim_files,
            "engine": "duckdb" if HAS_DUCKDB else "pyarrow",
        }
        _CORPUS_STATS_CACHE[cache_key] = stats
        return dict(stats)

    # ------------------------------------------------------------------ Document Search
    def search_documents(
        self,
        *,
        date_from: str | None = None,
        date_to: str | None = None,
        meeting_date: str | None = None,
        speaker: str | None = None,
        gender: str | None = None,
        doc_type: str | None = None,
        doc_types: list[str] | None = None,
        query_text: str | None = None,
        use_regex: bool = False,
        sql_filter: str | None = None,
        limit: int = 25,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        eff_from, eff_to, eff_meeting, out_of_range = _normalize_date_bounds(
            date_from, date_to, meeting_date
        )
        if out_of_range:
            return [], 0

        eff_types: list[str] = []
        if doc_types:
            eff_types = [d.strip() for d in doc_types if d and d.strip()]
        elif doc_type:
            eff_types = [d.strip() for d in doc_type.split(",") if d.strip()]

        # Skip caching oversized pages: they are rare and would blow the 64 MiB byte budget.
        if limit > 500:
            return self._search_documents_uncached(
                eff_from,
                eff_to,
                eff_meeting,
                speaker,
                gender,
                eff_types,
                query_text,
                use_regex,
                sql_filter,
                limit,
                offset,
            )

        key = (
            "search",
            self.settings.resolve_db_version_info().get("version") or "",
            eff_from,
            eff_to,
            eff_meeting,
            tuple(eff_types),
            speaker,
            gender,
            query_text,
            use_regex,
            sql_filter,
            limit,
            offset,
        )
        return _SEARCH_CACHE.get_or_compute(
            key,
            lambda: self._search_documents_uncached(
                eff_from,
                eff_to,
                eff_meeting,
                speaker,
                gender,
                eff_types,
                query_text,
                use_regex,
                sql_filter,
                limit,
                offset,
            ),
        )

    def _search_documents_uncached(
        self,
        eff_from: str | None,
        eff_to: str | None,
        eff_meeting: str | None,
        speaker: str | None,
        gender: str | None,
        eff_types: list[str],
        query_text: str | None,
        use_regex: bool,
        sql_filter: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        meta_dir = self.settings.resolve_text_metadata_dir()
        if eff_types == ["agenda_items"] and not (meta_dir / "doc_type=agenda_items").is_dir():
            return self._search_agendas(
                date_from=eff_from,
                date_to=eff_to,
                meeting_date=eff_meeting,
                query_text=query_text,
                use_regex=use_regex,
                limit=limit,
                offset=offset,
            )

        files = self._collect_meta_files(
            doc_types=eff_types if eff_types else None,
            date_from=eff_from,
            date_to=eff_to,
            meeting_date=eff_meeting,
        )
        if not files:
            return [], 0

        gender_speakers: set[str] | None = None
        if gender:
            gender_speakers = self.speakers_matching_gender(gender)
            if not gender_speakers:
                return [], 0

        if HAS_DUCKDB and gender_speakers is None:
            if not sql_filter and query_text and not use_regex and self._index_available():
                indexed = self._search_documents_indexed(
                    files=files,
                    date_from=eff_from,
                    date_to=eff_to,
                    meeting_date=eff_meeting,
                    speaker=speaker,
                    query_text=query_text,
                    use_regex=use_regex,
                    limit=limit,
                    offset=offset,
                    doc_types=eff_types,
                )
                if indexed is not None:
                    return indexed
            return self._search_documents_duckdb(
                files=files,
                date_from=eff_from,
                date_to=eff_to,
                meeting_date=eff_meeting,
                speaker=speaker,
                query_text=query_text,
                use_regex=use_regex,
                sql_filter=sql_filter,
                limit=limit,
                offset=offset,
            )
        return self._search_documents_pyarrow(
            files=files,
            date_from=eff_from,
            date_to=eff_to,
            meeting_date=eff_meeting,
            speaker=speaker,
            gender_speakers=gender_speakers,
            query_text=query_text,
            use_regex=use_regex,
            limit=limit,
            offset=offset,
        )

    def _search_documents_duckdb(
        self,
        *,
        files: list[Path],
        date_from: str | None,
        date_to: str | None,
        meeting_date: str | None,
        speaker: str | None,
        query_text: str | None,
        use_regex: bool,
        sql_filter: str | None = None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        file_list = [str(p) for p in files]
        where_clauses = [
            "meeting_date IS NOT NULL AND meeting_date != ''",
            f"meeting_date <= '{CORPUS_MAX_DATE}'",
        ]
        params: list[Any] = []

        if meeting_date:
            where_clauses.append("meeting_date = ?")
            params.append(meeting_date)
        else:
            if date_from:
                where_clauses.append("meeting_date >= ?")
                params.append(date_from)
            if date_to:
                where_clauses.append("meeting_date <= ?")
                params.append(date_to)

        if speaker:
            where_clauses.append("speaker ILIKE ?")
            params.append(f"%{speaker}%")

        if query_text:
            if use_regex:
                where_clauses.append("regexp_matches(COALESCE(text_content, ''), ?, 'i')")
                params.append(query_text)
            else:
                where_clauses.append("text_content ILIKE ?")
                params.append(f"%{query_text}%")

        if sql_filter:
            where_clauses.append(f"({sql_filter})")

        where_sql = " AND ".join(where_clauses)

        conn = self._connect_duckdb()
        try:
            count_sql = f"""
                SELECT COUNT(*) FROM (
                    SELECT meeting_date, doc_type
                    FROM read_parquet(?, union_by_name=true)
                    WHERE {where_sql}
                    GROUP BY meeting_date, doc_type
                ) sub
            """
            total = int(conn.execute(count_sql, [file_list, *params]).fetchone()[0])
            if total == 0:
                return [], 0

            query_sql = f"""
                SELECT
                    meeting_date,
                    doc_type,
                    MIN(year) AS year,
                    COUNT(*) AS matched_chunks,
                    COUNT(DISTINCT CASE WHEN speaker IS NOT NULL AND speaker != '' THEN speaker END) AS speaker_count,
                    ANY_VALUE(source_file) AS source_file,
                    FIRST(LEFT(COALESCE(text_content, ''), 260) ORDER BY sequence_num) AS snippet,
                    LIST(DISTINCT speaker) FILTER (WHERE speaker IS NOT NULL AND speaker != '')[:5] AS top_speakers
                FROM read_parquet(?, union_by_name=true)
                WHERE {where_sql}
                GROUP BY meeting_date, doc_type
                ORDER BY meeting_date DESC, doc_type ASC
                LIMIT ? OFFSET ?
            """
            rows = conn.execute(query_sql, [file_list, *params, limit, offset]).fetchall()
            results = [
                {
                    "document_id": f"{r[1]}::{r[0]}",
                    "meeting_date": str(r[0]),
                    "doc_type": str(r[1]),
                    "year": int(r[2]) if r[2] is not None else int(str(r[0])[:4]),
                    "chunk_count": int(r[3]),
                    "speaker_count": int(r[4]),
                    "source_file": str(r[5] or ""),
                    "snippet": str(r[6] or "").strip(),
                    "top_speakers": [str(s) for s in (r[7] or [])],
                }
                for r in rows
            ]
            return results, total
        finally:
            conn.close()

    def _index_available(self) -> bool:
        index_dir = self.settings.resolve_text_index_dir()
        if not index_dir.is_dir():
            return False
        return any(index_dir.glob("year=*/token_postings.parquet")) or (
            index_dir / "token_postings.parquet"
        ).is_file()

    def _search_documents_indexed(
        self,
        *,
        files: list[Path],
        date_from: str | None,
        date_to: str | None,
        meeting_date: str | None,
        speaker: str | None,
        query_text: str | None,
        use_regex: bool,
        limit: int,
        offset: int,
        doc_types: list[str],
    ) -> tuple[list[dict[str, Any]], int] | None:
        if use_regex or not query_text:
            return None
        token = query_text.strip().lower()
        if len(token) < 3 or any(ch.isspace() for ch in token):
            return None

        index_dir = self.settings.resolve_text_index_dir()
        if not index_dir.is_dir():
            return None

        if meeting_date and len(meeting_date) >= 4:
            years = [int(meeting_date[:4])]
        else:
            year_from = int(date_from[:4]) if date_from and len(date_from) >= 4 else CORPUS_MIN_YEAR
            year_to = int(date_to[:4]) if date_to and len(date_to) >= 4 else CORPUS_MAX_YEAR
            years = list(range(year_from, year_to + 1))

        shards = [index_dir / f"year={year}" / "token_postings.parquet" for year in years]
        shards = [path for path in shards if path.is_file()]
        if not shards and (index_dir / "token_postings.parquet").is_file():
            shards = [index_dir / "token_postings.parquet"]
        if not shards:
            return None

        index_files = [str(path) for path in shards]
        file_list = [str(path) for path in files]

        matched_clauses = ["token = ?"]
        matched_params: list[Any] = [token]
        if doc_types:
            placeholders = ", ".join("?" for _ in doc_types)
            matched_clauses.append(f"doc_type IN ({placeholders})")
            matched_params.extend(doc_types)
        if meeting_date:
            matched_clauses.append("meeting_date = ?")
            matched_params.append(meeting_date)
        else:
            if date_from:
                matched_clauses.append("meeting_date >= ?")
                matched_params.append(date_from)
            if date_to:
                matched_clauses.append("meeting_date <= ?")
                matched_params.append(date_to)
        matched_sql = " AND ".join(matched_clauses)

        outer_clauses = [
            "d.meeting_date IS NOT NULL AND d.meeting_date != ''",
            f"d.meeting_date <= '{CORPUS_MAX_DATE}'",
        ]
        outer_params: list[Any] = []
        if meeting_date:
            outer_clauses.append("d.meeting_date = ?")
            outer_params.append(meeting_date)
        else:
            if date_from:
                outer_clauses.append("d.meeting_date >= ?")
                outer_params.append(date_from)
            if date_to:
                outer_clauses.append("d.meeting_date <= ?")
                outer_params.append(date_to)
        if speaker:
            outer_clauses.append("d.speaker ILIKE ?")
            outer_params.append(f"%{speaker}%")
        outer_sql = " AND ".join(outer_clauses)

        join_sql = (
            "JOIN matched m ON d.doc_type = m.doc_type "
            "AND d.meeting_date = m.meeting_date AND d.sequence_num = m.seq"
        )
        matched_cte = f"""
            WITH matched AS (
                SELECT DISTINCT doc_type, meeting_date, seq
                FROM read_parquet(?, union_by_name=true)
                WHERE {matched_sql}
            )
        """

        conn = self._connect_duckdb()
        try:
            count_sql = matched_cte + f"""
                SELECT COUNT(*) FROM (
                    SELECT d.meeting_date, d.doc_type
                    FROM read_parquet(?, union_by_name=true) d
                    {join_sql}
                    WHERE {outer_sql}
                    GROUP BY d.meeting_date, d.doc_type
                ) sub
            """
            total = int(
                conn.execute(
                    count_sql, [index_files, *matched_params, file_list, *outer_params]
                ).fetchone()[0]
            )
            if total == 0:
                return [], 0

            query_sql = matched_cte + f"""
                SELECT
                    d.meeting_date,
                    d.doc_type,
                    MIN(d.year) AS year,
                    COUNT(*) AS matched_chunks,
                    COUNT(DISTINCT CASE WHEN d.speaker IS NOT NULL AND d.speaker != '' THEN d.speaker END) AS speaker_count,
                    ANY_VALUE(d.source_file) AS source_file,
                    FIRST(LEFT(COALESCE(d.text_content, ''), 260) ORDER BY d.sequence_num) AS snippet,
                    LIST(DISTINCT d.speaker) FILTER (WHERE d.speaker IS NOT NULL AND d.speaker != '')[:5] AS top_speakers
                FROM read_parquet(?, union_by_name=true) d
                {join_sql}
                WHERE {outer_sql}
                GROUP BY d.meeting_date, d.doc_type
                ORDER BY d.meeting_date DESC, d.doc_type ASC
                LIMIT ? OFFSET ?
            """
            rows = conn.execute(
                query_sql,
                [index_files, *matched_params, file_list, *outer_params, limit, offset],
            ).fetchall()
            results = [
                {
                    "document_id": f"{r[1]}::{r[0]}",
                    "meeting_date": str(r[0]),
                    "doc_type": str(r[1]),
                    "year": int(r[2]) if r[2] is not None else int(str(r[0])[:4]),
                    "chunk_count": int(r[3]),
                    "speaker_count": int(r[4]),
                    "source_file": str(r[5] or ""),
                    "snippet": str(r[6] or "").strip(),
                    "top_speakers": [str(s) for s in (r[7] or [])],
                }
                for r in rows
            ]
            return results, total
        except Exception:
            return None
        finally:
            conn.close()

    def _search_documents_pyarrow(
        self,
        *,
        files: list[Path],
        date_from: str | None,
        date_to: str | None,
        meeting_date: str | None,
        speaker: str | None,
        gender_speakers: set[str] | None,
        query_text: str | None,
        use_regex: bool,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        needed_cols = ["meeting_date", "doc_type", "year", "speaker", "source_file", "sequence_num", "text_content"]
        grouped: dict[tuple[str, str], dict[str, Any]] = {}

        for pq_path in files:
            schema_names = set(pq.read_schema(pq_path).names)
            cols = [c for c in needed_cols if c in schema_names]
            dset = ds.dataset(pq_path, format="parquet")

            expr = pc.is_valid(ds.field("meeting_date")) & (ds.field("meeting_date") <= CORPUS_MAX_DATE)
            if meeting_date:
                expr = expr & (ds.field("meeting_date") == meeting_date)
            else:
                if date_from:
                    expr = expr & (ds.field("meeting_date") >= date_from)
                if date_to:
                    expr = expr & (ds.field("meeting_date") <= date_to)

            table = dset.to_table(columns=cols, filter=expr)
            if table.num_rows == 0:
                continue

            mask = None
            if speaker and "speaker" in table.column_names:
                sp_col = pc.fill_null(table["speaker"], "")
                m = pc.match_substring(sp_col, speaker, ignore_case=True)
                mask = m if mask is None else pc.and_(mask, m)
            if query_text and "text_content" in table.column_names:
                tx_col = pc.fill_null(table["text_content"], "")
                if use_regex:
                    m = pc.match_substring_regex(tx_col, query_text, ignore_case=True)
                else:
                    m = pc.match_substring(tx_col, query_text, ignore_case=True)
                mask = m if mask is None else pc.and_(mask, m)

            if mask is not None:
                table = table.filter(mask)
            if table.num_rows == 0:
                continue

            for r in table.to_pylist():
                raw_sp = str(r.get("speaker") or "").strip()
                if gender_speakers is not None:
                    norm_sp = _norm_speaker(raw_sp)
                    if not norm_sp or not any(
                        norm_sp == gs or gs in norm_sp or norm_sp in gs for gs in gender_speakers
                    ):
                        continue
                m_date = str(r.get("meeting_date") or "")
                d_type = str(r.get("doc_type") or "")
                if not m_date or not d_type:
                    continue
                key = (m_date, d_type)
                entry = grouped.get(key)
                if entry is None:
                    entry = {
                        "document_id": f"{d_type}::{m_date}",
                        "meeting_date": m_date,
                        "doc_type": d_type,
                        "year": int(r.get("year") or int(m_date[:4])),
                        "chunk_count": 0,
                        "speakers": set(),
                        "source_file": str(r.get("source_file") or ""),
                        "snippet": str(r.get("text_content") or "")[:260].strip(),
                        "_min_seq": int(r.get("sequence_num") or 0),
                    }
                    grouped[key] = entry
                entry["chunk_count"] += 1
                if raw_sp:
                    entry["speakers"].add(raw_sp)
                seq = int(r.get("sequence_num") or 0)
                if seq < entry["_min_seq"]:
                    entry["_min_seq"] = seq
                    entry["snippet"] = str(r.get("text_content") or "")[:260].strip()

        ordered = sorted(grouped.values(), key=lambda x: (x["meeting_date"], x["doc_type"]), reverse=True)
        total = len(ordered)
        sliced = ordered[offset : offset + limit]
        results = [
            {
                "document_id": item["document_id"],
                "meeting_date": item["meeting_date"],
                "doc_type": item["doc_type"],
                "year": item["year"],
                "chunk_count": item["chunk_count"],
                "speaker_count": len(item["speakers"]),
                "source_file": item["source_file"],
                "snippet": item["snippet"],
                "top_speakers": sorted(item["speakers"])[:5],
            }
            for item in sliced
        ]
        return results, total

    def _search_agendas(
        self,
        *,
        date_from: str | None,
        date_to: str | None,
        meeting_date: str | None,
        query_text: str | None,
        use_regex: bool,
        limit: int,
        offset: int,
    ) -> tuple[list[dict[str, Any]], int]:
        agenda_dir = self.settings.resolve_agenda_items_dir()
        if not agenda_dir.is_dir():
            return [], 0
        files = sorted(agenda_dir.glob("year=*/part-*.parquet"))
        grouped: dict[str, dict[str, Any]] = {}
        for pq_path in files:
            m = _YEAR_RE.search(pq_path.parent.name)
            if m:
                yr = int(m.group(1))
                if yr > CORPUS_MAX_YEAR:
                    continue
                if meeting_date and yr != int(meeting_date[:4]):
                    continue
                if date_from and yr < int(date_from[:4]):
                    continue
                if date_to and yr > int(date_to[:4]):
                    continue
            table = pq.read_table(pq_path, columns=["date", "sec_n", "subsec_n", "text", "source_file"])
            for r in table.to_pylist():
                d = str(r.get("date") or "")
                if not d or d > CORPUS_MAX_DATE:
                    continue
                if meeting_date and d != meeting_date:
                    continue
                if date_from and d < date_from:
                    continue
                if date_to and d > date_to:
                    continue
                txt = str(r.get("text") or "")
                if query_text:
                    if use_regex:
                        if not re.search(query_text, txt, re.IGNORECASE):
                            continue
                    elif query_text.lower() not in txt.lower():
                        continue
                entry = grouped.setdefault(
                    d,
                    {
                        "document_id": f"agenda_items::{d}",
                        "meeting_date": d,
                        "doc_type": "agenda_items",
                        "year": int(d[:4]),
                        "chunk_count": 0,
                        "speaker_count": 0,
                        "source_file": str(r.get("source_file") or ""),
                        "snippet": txt[:260].strip(),
                        "top_speakers": [],
                    },
                )
                entry["chunk_count"] += 1
        ordered = sorted(grouped.values(), key=lambda x: x["meeting_date"], reverse=True)
        return ordered[offset : offset + limit], len(ordered)

    # ------------------------------------------------------------------ Document Chunks
    def get_document_chunks(
        self,
        doc_type: str,
        meeting_date: str,
        *,
        speaker: str | None = None,
        chunk_ids: list[str] | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        meta_dir = self.settings.resolve_text_metadata_dir()
        if doc_type == "agenda_items" and not (meta_dir / "doc_type=agenda_items").is_dir():
            rows, total = self._get_agenda_chunks(meeting_date, limit=50000 if chunk_ids else limit, offset=0 if chunk_ids else offset)
            if chunk_ids:
                cid_set = set(chunk_ids)
                filtered = [r for r in rows if r["chunk_id"] in cid_set]
                return filtered[offset : offset + limit], len(filtered)
            return rows, total

        files = self._collect_meta_files(doc_type=doc_type, meeting_date=meeting_date)
        if not files:
            return [], 0

        if HAS_DUCKDB:
            file_list = [str(p) for p in files]
            where = ["meeting_date = ?"]
            params: list[Any] = [meeting_date]
            if speaker:
                where.append("speaker ILIKE ?")
                params.append(f"%{speaker}%")
            if chunk_ids:
                placeholders = ", ".join(["?"] * len(chunk_ids))
                where.append(f"chunk_id IN ({placeholders})")
                params.extend(chunk_ids)
            where_sql = " AND ".join(where)

            conn = self._connect_duckdb()
            try:
                total = int(
                    conn.execute(
                        f"SELECT COUNT(*) FROM read_parquet(?, union_by_name=true) WHERE {where_sql}",
                        [file_list, *params],
                    ).fetchone()[0]
                )
                rows = conn.execute(
                    f"""
                    SELECT
                        chunk_id, meeting_date, doc_type, sequence_num, section,
                        speaker, speaker_role, district, text_content, char_count
                    FROM read_parquet(?, union_by_name=true)
                    WHERE {where_sql}
                    ORDER BY sequence_num ASC, COALESCE(chunk_sub_id, 0) ASC
                    LIMIT ? OFFSET ?
                    """,
                    [file_list, *params, limit, offset],
                ).fetchall()
                chunks = [
                    {
                        "chunk_id": str(r[0]),
                        "meeting_date": str(r[1]),
                        "doc_type": str(r[2]),
                        "sequence_num": int(r[3] or 0),
                        "section": str(r[4] or ""),
                        "speaker": str(r[5] or ""),
                        "speaker_role": str(r[6] or ""),
                        "district": str(r[7] or ""),
                        "text_content": str(r[8] or ""),
                        "char_count": int(r[9] or 0),
                    }
                    for r in rows
                ]
                return chunks, total
            finally:
                conn.close()

        all_rows: list[dict[str, Any]] = []
        cols = [
            "chunk_id", "meeting_date", "doc_type", "sequence_num", "chunk_sub_id",
            "section", "speaker", "speaker_role", "district", "text_content", "char_count",
        ]
        for pq_path in files:
            avail = [c for c in cols if c in pq.read_schema(pq_path).names]
            dset = ds.dataset(pq_path, format="parquet")
            table = dset.to_table(columns=avail, filter=(ds.field("meeting_date") == meeting_date))
            cid_set = set(chunk_ids) if chunk_ids else None
            for r in table.to_pylist():
                if speaker and speaker.lower() not in str(r.get("speaker") or "").lower():
                    continue
                if cid_set is not None and str(r.get("chunk_id") or "") not in cid_set:
                    continue
                all_rows.append(
                    {
                        "chunk_id": str(r.get("chunk_id") or ""),
                        "meeting_date": str(r.get("meeting_date") or meeting_date),
                        "doc_type": str(r.get("doc_type") or doc_type),
                        "sequence_num": int(r.get("sequence_num") or 0),
                        "_sub": int(r.get("chunk_sub_id") or 0),
                        "section": str(r.get("section") or ""),
                        "speaker": str(r.get("speaker") or ""),
                        "speaker_role": str(r.get("speaker_role") or ""),
                        "district": str(r.get("district") or ""),
                        "text_content": str(r.get("text_content") or ""),
                        "char_count": int(r.get("char_count") or len(str(r.get("text_content") or ""))),
                    }
                )
        all_rows.sort(key=lambda x: (x["sequence_num"], x["_sub"]))
        total = len(all_rows)
        sliced = [{k: v for k, v in row.items() if k != "_sub"} for row in all_rows[offset : offset + limit]]
        return sliced, total

    def _get_agenda_chunks(
        self, meeting_date: str, *, limit: int = 200, offset: int = 0
    ) -> tuple[list[dict[str, Any]], int]:
        agenda_dir = self.settings.resolve_agenda_items_dir()
        yr = meeting_date[:4]
        year_dir = agenda_dir / f"year={yr}"
        if not year_dir.is_dir():
            return [], 0
        rows: list[dict[str, Any]] = []
        for pq_path in sorted(year_dir.glob("part-*.parquet")):
            table = ds.dataset(pq_path, format="parquet").to_table(
                filter=(ds.field("date") == meeting_date)
            )
            for r in table.to_pylist():
                sec = int(r.get("sec_n") or 0)
                sub = int(r.get("subsec_n") or 0)
                raw_id = str(r.get("id_agenda") or "").strip()
                cid = (
                    raw_id
                    if re.search(r"_\d{2}_\d{2}$", raw_id)
                    else f"agendas_{meeting_date}_{sec:02d}_{sub:02d}"
                )
                rows.append(
                    {
                        "chunk_id": cid,
                        "meeting_date": meeting_date,
                        "doc_type": "agenda_items",
                        "sequence_num": sec * 100 + sub,
                        "section": f"Item {sec}" + (f".{sub}" if sub > 0 else ""),
                        "speaker": "FOMC Secretariat",
                        "speaker_role": "Agenda",
                        "district": "",
                        "text_content": str(r.get("text") or ""),
                        "char_count": len(str(r.get("text") or "")),
                    }
                )
        rows.sort(key=lambda x: x["sequence_num"])
        return rows[offset : offset + limit], len(rows)

    # ------------------------------------------------------------------ Meeting Bundle
    def get_meeting_sibling_doc_types(self, meeting_date: str) -> list[dict[str, Any]]:
        siblings: list[dict[str, Any]] = []
        year = meeting_date[:4]
        meta_dir = self.settings.resolve_text_metadata_dir()

        if meta_dir.is_dir():
            for dt_dir in sorted(p for p in meta_dir.glob("doc_type=*") if p.is_dir()):
                dt = dt_dir.name.split("=", 1)[1]
                year_dir = dt_dir / f"year={year}"
                if not year_dir.is_dir():
                    continue
                files = sorted(year_dir.glob("part-*.parquet"))
                if not files:
                    continue
                count = 0
                source_file = ""
                if HAS_DUCKDB:
                    conn = self._connect_duckdb()
                    try:
                        row = conn.execute(
                            """
                            SELECT COUNT(*), ANY_VALUE(source_file)
                            FROM read_parquet(?, union_by_name=true)
                            WHERE meeting_date = ?
                            """,
                            [[str(p) for p in files], meeting_date],
                        ).fetchone()
                        count = int(row[0] or 0)
                        source_file = str(row[1] or "")
                    finally:
                        conn.close()
                else:
                    for pq_path in files:
                        tbl = ds.dataset(pq_path, format="parquet").to_table(
                            columns=["meeting_date", "source_file"],
                            filter=(ds.field("meeting_date") == meeting_date),
                        )
                        if tbl.num_rows > 0:
                            count += tbl.num_rows
                            if not source_file:
                                source_file = str(tbl["source_file"][0].as_py() or "")
                if count > 0:
                    siblings.append(
                        {
                            "document_id": f"{dt}::{meeting_date}",
                            "doc_type": dt,
                            "meeting_date": meeting_date,
                            "chunk_count": count,
                            "source_file": source_file,
                        }
                    )

        if not any(s["doc_type"] == "agenda_items" for s in siblings):
            _, agenda_total = self._get_agenda_chunks(meeting_date, limit=1)
            if agenda_total > 0:
                siblings.append(
                    {
                        "document_id": f"agenda_items::{meeting_date}",
                        "doc_type": "agenda_items",
                        "meeting_date": meeting_date,
                        "chunk_count": agenda_total,
                        "source_file": "",
                    }
                )
        return siblings

    # ------------------------------------------------------------------ Fast Ordered Chunk IDs (No text_content I/O)
    def get_ordered_chunk_ids(self, doc_type: str, meeting_date: str) -> list[str]:
        """Return ordered ``chunk_id`` list for ``(doc_type, meeting_date)`` without reading ``text_content``."""
        year = meeting_date[:4]
        meta_dir = self.settings.resolve_text_metadata_dir()
        cache_key = (str(meta_dir), doc_type, year)

        if cache_key not in _DOC_IDS_BY_YEAR_CACHE:
            by_date: dict[str, list[tuple[int, int, str]]] = defaultdict(list)
            if doc_type == "agenda_items" and not (meta_dir / "doc_type=agenda_items").is_dir():
                ag_dir = self.settings.resolve_agenda_items_dir() / f"year={year}"
                if ag_dir.is_dir():
                    for pq_path in sorted(ag_dir.glob("part-*.parquet")):
                        tbl = pq.read_table(pq_path, columns=["id_agenda", "date", "sec_n", "subsec_n"])
                        for r in tbl.to_pylist():
                            d = str(r.get("date") or "")
                            if not d:
                                continue
                            sec = int(r.get("sec_n") or 0)
                            sub = int(r.get("subsec_n") or 0)
                            raw_id = str(r.get("id_agenda") or "").strip()
                            cid = (
                                raw_id
                                if re.search(r"_\d{2}_\d{2}$", raw_id)
                                else f"agendas_{d}_{sec:02d}_{sub:02d}"
                            )
                            by_date[d].append((sec * 100 + sub, 0, cid))
            else:
                yr_dir = meta_dir / f"doc_type={doc_type}" / f"year={year}"
                if yr_dir.is_dir():
                    for pq_path in sorted(yr_dir.glob("part-*.parquet")):
                        schema_names = set(pq.read_schema(pq_path).names)
                        cols = [c for c in ("chunk_id", "meeting_date", "sequence_num", "chunk_sub_id") if c in schema_names]
                        tbl = pq.read_table(pq_path, columns=cols)
                        cids = tbl["chunk_id"].to_pylist() if "chunk_id" in cols else []
                        mdates = tbl["meeting_date"].to_pylist() if "meeting_date" in cols else [""] * len(cids)
                        seqs = tbl["sequence_num"].to_pylist() if "sequence_num" in cols else [0] * len(cids)
                        subs = tbl["chunk_sub_id"].to_pylist() if "chunk_sub_id" in cols else [0] * len(cids)
                        for cid, md, seq, sub in zip(cids, mdates, seqs, subs):
                            if md and cid:
                                by_date[str(md)].append((int(seq or 0), int(sub or 0), str(cid)))

            ordered_by_date: dict[str, list[str]] = {}
            for d, items in by_date.items():
                items.sort(key=lambda x: (x[0], x[1]))
                ordered_by_date[d] = [x[2] for x in items]
            if len(_DOC_IDS_BY_YEAR_CACHE) > 256:
                _DOC_IDS_BY_YEAR_CACHE.clear()
            _DOC_IDS_BY_YEAR_CACHE[cache_key] = ordered_by_date

        return _DOC_IDS_BY_YEAR_CACHE[cache_key].get(meeting_date, [])

    def get_document_speaker_meta(self, doc_type: str, meeting_date: str) -> list[dict[str, Any]]:
        """Return ordered lightweight chunk metadata (without ``text_content``) for speaker/role grouping."""
        year = meeting_date[:4]
        meta_dir = self.settings.resolve_text_metadata_dir()
        cache_key = (str(meta_dir), doc_type, year)

        if cache_key not in _DOC_SPEAKER_META_CACHE:
            by_date: dict[str, list[tuple[int, int, dict[str, Any]]]] = defaultdict(list)
            if doc_type == "agenda_items" and not (meta_dir / "doc_type=agenda_items").is_dir():
                for cid in self.get_ordered_chunk_ids(doc_type, meeting_date):
                    by_date[meeting_date].append(
                        (0, 0, {"chunk_id": cid, "speaker": "", "speaker_role": ""})
                    )
            else:
                yr_dir = meta_dir / f"doc_type={doc_type}" / f"year={year}"
                if yr_dir.is_dir():
                    for pq_path in sorted(yr_dir.glob("part-*.parquet")):
                        schema_names = set(pq.read_schema(pq_path).names)
                        cols = [
                            c
                            for c in (
                                "chunk_id",
                                "meeting_date",
                                "sequence_num",
                                "chunk_sub_id",
                                "speaker",
                                "speaker_role",
                            )
                            if c in schema_names
                        ]
                        tbl = pq.read_table(pq_path, columns=cols)
                        cids = tbl["chunk_id"].to_pylist() if "chunk_id" in cols else []
                        mdates = tbl["meeting_date"].to_pylist() if "meeting_date" in cols else [""] * len(cids)
                        seqs = tbl["sequence_num"].to_pylist() if "sequence_num" in cols else [0] * len(cids)
                        subs = tbl["chunk_sub_id"].to_pylist() if "chunk_sub_id" in cols else [0] * len(cids)
                        spkrs = tbl["speaker"].to_pylist() if "speaker" in cols else [""] * len(cids)
                        roles = tbl["speaker_role"].to_pylist() if "speaker_role" in cols else [""] * len(cids)
                        for cid, md, seq, sub, sp, rl in zip(cids, mdates, seqs, subs, spkrs, roles):
                            if md and cid:
                                by_date[str(md)].append(
                                    (
                                        int(seq or 0),
                                        int(sub or 0),
                                        {
                                            "chunk_id": str(cid),
                                            "speaker": str(sp or ""),
                                            "speaker_role": str(rl or ""),
                                        },
                                    )
                                )
            ordered_meta: dict[str, list[dict[str, Any]]] = {}
            for d, items in by_date.items():
                items.sort(key=lambda x: (x[0], x[1]))
                ordered_meta[d] = [x[2] for x in items]
            if len(_DOC_SPEAKER_META_CACHE) > 256:
                _DOC_SPEAKER_META_CACHE.clear()
            _DOC_SPEAKER_META_CACHE[cache_key] = ordered_meta

        return _DOC_SPEAKER_META_CACHE[cache_key].get(meeting_date, [])

    # ------------------------------------------------------------------ Similarity Matrix
    def load_raw_similarity_slice(
        self,
        doc_type: str,
        meeting_date: str,
    ) -> tuple[list[str], np.ndarray, list[str]]:
        year = meeting_date[:4]
        sim_root = self.settings.resolve_similarities_dir()
        sim_year_dir = sim_root / f"doc_type={doc_type}" / f"year={year}"
        cache_dir = self.settings.resolve_matrix_cache_dir()
        cache_path = cache_dir / doc_type / f"{meeting_date}.npz"

        ordered_ids = self.get_ordered_chunk_ids(doc_type, meeting_date)
        cache_key = (str(sim_root), doc_type, year)

        if cache_key not in _SIM_YEAR_CACHE and sim_year_dir.is_dir() and cache_path.is_file():
            try:
                with np.load(cache_path) as data:
                    disk_ids = [str(c) for c in data["chunk_ids"]]
                    disk_matrix = data["matrix"].astype(np.float32, copy=False)
                    disk_labels = [str(l) for l in data["labels"]]
                if (
                    disk_matrix.shape[0] == len(disk_ids)
                    and disk_matrix.shape[1] == len(disk_labels)
                    and (not ordered_ids or disk_ids == ordered_ids)
                ):
                    vec_map = {cid: disk_matrix[i] for i, cid in enumerate(disk_ids)}
                    _SIM_YEAR_CACHE[cache_key] = (vec_map, disk_labels)
                    return disk_ids, disk_matrix, disk_labels
                cache_path.unlink(missing_ok=True)
            except Exception as exc:
                LOGGER.warning("Discarding unreadable similarity cache %s: %s", cache_path, exc)
                try:
                    cache_path.unlink(missing_ok=True)
                except Exception:
                    pass

        if not sim_year_dir.is_dir():
            return [], np.empty((0, 0), dtype=np.float32), []

        if cache_key not in _SIM_YEAR_CACHE:
            sim_files = sorted(sim_year_dir.glob("part-*.parquet"))
            if not sim_files:
                return [], np.empty((0, 0), dtype=np.float32), []

            raw_labels: list[str] | None = None
            vec_lists: dict[str, list[np.ndarray]] = defaultdict(list)

            for pq_path in sim_files:
                pf = pq.ParquetFile(pq_path)
                meta = pf.schema_arrow.metadata or {}
                if b"similarity" in meta and raw_labels is None:
                    try:
                        info = json.loads(meta[b"similarity"].decode("utf-8"))
                        if isinstance(info.get("labels"), list):
                            raw_labels = [str(x) for x in info["labels"]]
                    except Exception:
                        pass

                table = pf.read(columns=["chunk_id", "similarity"])
                if table.num_rows == 0:
                    continue

                cids = table["chunk_id"].to_pylist()
                sim_col = table["similarity"].combine_chunks()
                if pa.types.is_fixed_size_list(sim_col.type):
                    width = sim_col.type.list_size
                    vals = sim_col.values.to_numpy(zero_copy_only=False).astype(np.float32, copy=False)
                    mat = vals.reshape(len(cids), width)
                else:
                    mat = np.asarray(sim_col.to_pylist(), dtype=np.float32)

                for idx, cid in enumerate(cids):
                    cid_str = str(cid)
                    vec_lists[cid_str].append(mat[idx])
                    base_cid = _SUBCHUNK_RE.sub("", cid_str)
                    if base_cid != cid_str:
                        vec_lists[base_cid].append(mat[idx])

            vec_map: dict[str, np.ndarray] = {
                cid: (vecs[0] if len(vecs) == 1 else np.mean(np.vstack(vecs), axis=0, dtype=np.float32))
                for cid, vecs in vec_lists.items()
            }
            sample_width = next(iter(vec_map.values())).shape[0] if vec_map else 13
            col_labels = resolve_column_labels(raw_labels, sample_width)
            if len(_SIM_YEAR_CACHE) > 128:
                _SIM_YEAR_CACHE.clear()
            _SIM_YEAR_CACHE[cache_key] = (vec_map, col_labels)

        vec_map, col_labels = _SIM_YEAR_CACHE[cache_key]
        if not vec_map:
            return [], np.empty((0, 0), dtype=np.float32), []

        final_ids = (
            [cid for cid in ordered_ids if cid in vec_map]
            if ordered_ids
            else [cid for cid in sorted(vec_map.keys()) if meeting_date in cid]
        )
        if not final_ids:
            return [], np.empty((0, 0), dtype=np.float32), []
        matrix = np.vstack([vec_map[cid] for cid in final_ids]).astype(np.float32)
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            np.savez_compressed(
                cache_path,
                chunk_ids=np.array(final_ids),
                matrix=matrix,
                labels=np.array(col_labels),
            )
        except Exception as exc:
            LOGGER.warning("Could not persist similarity cache %s: %s", cache_path, exc)
        return final_ids, matrix, col_labels

    # ------------------------------------------------------------------ Zero-Shot Labels
    def load_zero_shot_slice(
        self,
        doc_type: str,
        meeting_date: str,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        labels_dir = self.settings.resolve_labels_dir()
        if not labels_dir.is_dir():
            return [], []

        chunks, _ = self.get_document_chunks(doc_type, meeting_date, limit=50000, offset=0)
        if not chunks:
            return [], []
        chunk_lookup = {c["chunk_id"]: c for c in chunks}
        id_list = list(chunk_lookup.keys())

        year = meeting_date[:4]
        part_dir = labels_dir / f"doc_type={doc_type}" / f"year={year}"
        if part_dir.is_dir():
            candidates = sorted(part_dir.glob("part-*.parquet"))
        else:
            candidates = sorted(labels_dir.glob("labels_all_subclasses.parquet"))
            if not candidates:
                candidates = sorted(labels_dir.glob("labels-*.parquet"))
            if not candidates:
                candidates = sorted(labels_dir.glob("*.parquet"))
        if not candidates:
            return [], []

        target_file = max(candidates, key=lambda p: p.stat().st_mtime)
        schema_names = pq.read_schema(target_file).names
        if "chunk_id" not in schema_names:
            return [], []

        table = ds.dataset(target_file, format="parquet").to_table(
            filter=ds.field("chunk_id").isin(id_list)
        )
        if table.num_rows == 0:
            return [], []

        reserved = {
            "chunk_id", "doc_type", "model", "label", "label_name", "prob_max",
            "subclass_label_name", "subclass_prob_max",
            "p_relevant", "p_irrelevant",
            "relevance_prob", "meeting_date", "speaker", "text_content",
            "human_relevance_label", "human_topic_label",
        }
        score_cols = [c for c in schema_names if c not in reserved]

        raw_by_id: dict[str, dict[str, Any]] = {}
        for r in table.to_pylist():
            cid = str(r["chunk_id"])
            scores: dict[str, float] = {}
            for col in score_cols:
                val = r.get(col)
                if val is not None:
                    fval = float(val)
                    if not np.isnan(fval):
                        scores[col] = fval
            if "monetary_aggregates" not in scores and "gdp_activity" in scores:
                scores["monetary_aggregates"] = scores["gdp_activity"]
            elif scores.get("monetary_aggregates", 0.0) == 0.0 and scores.get("gdp_activity", 0.0) > 0.0:
                scores["monetary_aggregates"] = scores["gdp_activity"]
            raw_by_id[cid] = {
                "label_name": str(r.get("label_name") or ""),
                "subclass_label_name": str(r.get("subclass_label_name") or "") or None,
                "p_relevant": float(r["p_relevant"]) if r.get("p_relevant") is not None else None,
                "scores": scores,
            }

        ordered: list[dict[str, Any]] = []
        for cid in id_list:
            matched = raw_by_id.get(cid)
            if matched is None:
                continue
            chunk_meta = chunk_lookup.get(cid, {})
            ordered.append(
                {
                    "chunk_id": cid,
                    "sequence_num": chunk_meta.get("sequence_num", 0),
                    "speaker": chunk_meta.get("speaker", ""),
                    "speaker_role": chunk_meta.get("speaker_role", ""),
                    "text_content": chunk_meta.get("text_content", ""),
                    "label_name": matched["label_name"],
                    "subclass_label_name": matched["subclass_label_name"],
                    "p_relevant": matched["p_relevant"],
                    "scores": matched["scores"],
                }
            )
        return ordered, score_cols

    def load_raw_zero_shot_matrix(
        self,
        doc_type: str,
        meeting_date: str,
    ) -> tuple[np.ndarray, list[str]]:
        """Fast cached zero-shot probability matrix loader for Comparator (avoids reading text_content)."""
        labels_dir = self.settings.resolve_labels_dir()
        if not labels_dir.is_dir():
            return np.empty((0, 0), dtype=np.float32), []

        ordered_ids = self.get_ordered_chunk_ids(doc_type, meeting_date)
        if not ordered_ids:
            return np.empty((0, 0), dtype=np.float32), []

        year = meeting_date[:4]
        part_dir = labels_dir / f"doc_type={doc_type}" / f"year={year}"
        cache_key = (str(labels_dir), doc_type, year if part_dir.is_dir() else "_flat_")

        if cache_key not in _ZS_YEAR_CACHE:
            if part_dir.is_dir():
                candidates = sorted(part_dir.glob("part-*.parquet"))
            else:
                candidates = sorted(labels_dir.glob("labels_all_subclasses.parquet"))
                if not candidates:
                    candidates = sorted(labels_dir.glob("labels-*.parquet"))
                if not candidates:
                    candidates = sorted(labels_dir.glob("*.parquet"))
            if not candidates:
                return np.empty((0, 0), dtype=np.float32), []

            target_file = max(candidates, key=lambda p: p.stat().st_mtime)
            schema_names = pq.read_schema(target_file).names
            if "chunk_id" not in schema_names:
                return np.empty((0, 0), dtype=np.float32), []

            reserved = {
                "chunk_id", "doc_type", "model", "label", "label_name", "prob_max",
                "subclass_label_name", "subclass_prob_max",
                "p_relevant", "p_irrelevant",
                "relevance_prob", "meeting_date", "speaker", "text_content",
                "human_relevance_label", "human_topic_label",
            }
            score_cols = [c for c in schema_names if c not in reserved]
            if not score_cols:
                return np.empty((0, 0), dtype=np.float32), []

            table = pq.read_table(target_file, columns=["chunk_id", *score_cols])
            if table.num_rows == 0:
                _ZS_YEAR_CACHE[cache_key] = ({}, score_cols)
            else:
                cids = table["chunk_id"].to_pylist()
                col_arrays = [
                    np.nan_to_num(
                        table[col].to_numpy(zero_copy_only=False).astype(np.float32, copy=False),
                        nan=0.0,
                    )
                    for col in score_cols
                ]
                mat_all = np.column_stack(col_arrays) if col_arrays else np.empty((len(cids), 0), dtype=np.float32)
                if "monetary_aggregates" in score_cols and "gdp_activity" in score_cols:
                    ma_idx = score_cols.index("monetary_aggregates")
                    gdp_idx = score_cols.index("gdp_activity")
                    zero_mask = (mat_all[:, ma_idx] == 0.0) & (mat_all[:, gdp_idx] > 0.0)
                    mat_all[zero_mask, ma_idx] = mat_all[zero_mask, gdp_idx]

                vec_lists: dict[str, list[np.ndarray]] = defaultdict(list)
                for idx, cid in enumerate(cids):
                    cid_str = str(cid)
                    vec_lists[cid_str].append(mat_all[idx])
                    base_cid = _SUBCHUNK_RE.sub("", cid_str)
                    if base_cid != cid_str:
                        vec_lists[base_cid].append(mat_all[idx])

                vec_map: dict[str, np.ndarray] = {
                    cid: (vecs[0] if len(vecs) == 1 else np.mean(np.vstack(vecs), axis=0, dtype=np.float32))
                    for cid, vecs in vec_lists.items()
                }
                if len(_ZS_YEAR_CACHE) > 64:
                    _ZS_YEAR_CACHE.clear()
                _ZS_YEAR_CACHE[cache_key] = (vec_map, score_cols)

        vec_map, score_cols = _ZS_YEAR_CACHE[cache_key]
        matched_vecs = [vec_map[cid] for cid in ordered_ids if cid in vec_map]
        if not matched_vecs:
            return np.empty((0, 0), dtype=np.float32), []
        return np.vstack(matched_vecs).astype(np.float32), score_cols

    # ------------------------------------------------------------------ Relevance Scores
    def load_relevance_slice(
        self,
        doc_type: str,
        meeting_date: str,
    ) -> list[dict[str, Any]]:
        """Load per-chunk ``p_relevant`` / ``p_irrelevant`` probabilities out-of-core.

        Reads ``model/relevance_score.parquet`` (primary) or ``relevance_scores.parquet``
        using DuckDB / PyArrow pushdown on ``chunk_id``, with flexible schema detection.
        """
        chunks, _ = self.get_document_chunks(doc_type, meeting_date, limit=50000, offset=0)
        if not chunks:
            return []
        chunk_lookup = {c["chunk_id"]: c for c in chunks}
        id_list = list(chunk_lookup.keys())

        rel_file = self.settings.resolve_relevance_file()
        year = meeting_date[:4]
        part_rel = rel_file.parent / f"doc_type={doc_type}" / f"year={year}" / "part-000.parquet"
        target_rel_file = part_rel if part_rel.is_file() else rel_file
        rel_map: dict[str, float] = {}

        if target_rel_file.is_file():
            schema_names = pq.read_schema(target_rel_file).names
            cols_low = {c.lower(): c for c in schema_names}
            id_col = cols_low.get("chunk_id") or cols_low.get("chunk")
            p_col = (
                cols_low.get("p_relevant")
                or cols_low.get("relevance_prob")
                or cols_low.get("prob")
                or cols_low.get("p")
                or cols_low.get("score")
            )
            if id_col and p_col:
                base_ids = {_SUBCHUNK_RE.sub("", cid) for cid in id_list}
                query_rel_ids = list({*id_list, *base_ids})
                table = ds.dataset(target_rel_file, format="parquet").to_table(
                    columns=[id_col, p_col],
                    filter=ds.field(id_col).isin(query_rel_ids),
                )
                for r in table.to_pylist():
                    val = r.get(p_col)
                    if val is not None and not np.isnan(float(val)):
                        rel_map[str(r[id_col])] = float(val)

        # Fallback: extract p_relevant from zero-shot labels if standalone file absent
        if not rel_map:
            zs_rows, _ = self.load_zero_shot_slice(doc_type, meeting_date)
            for r in zs_rows:
                if r.get("p_relevant") is not None:
                    rel_map[r["chunk_id"]] = float(r["p_relevant"])

        if not rel_map:
            return []

        ordered = []
        for cid in id_list:
            raw_p = rel_map.get(cid)
            if raw_p is None:
                raw_p = rel_map.get(_SUBCHUNK_RE.sub("", cid))
            if raw_p is None:
                continue
            p_rel = max(0.0, min(1.0, raw_p))
            p_irr = max(0.0, min(1.0, 1.0 - p_rel))
            ch = chunk_lookup[cid]
            ordered.append(
                {
                    "chunk_id": cid,
                    "sequence_num": ch.get("sequence_num", 0),
                    "speaker": ch.get("speaker", ""),
                    "text_content": ch.get("text_content", ""),
                    "p_relevant": round(p_rel, 4),
                    "p_irrelevant": round(p_irr, 4),
                    "scores": {
                        "relevant": round(p_rel, 4),
                        "irrelevant": round(p_irr, 4),
                    },
                }
            )
        return ordered
