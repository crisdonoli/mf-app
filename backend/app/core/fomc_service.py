"""Unified analytical use-case service (Single Source of Truth).

Both the Document Explorer and Document Comparator consume these exact atomic
functions. Supports:
- Multi-criteria search with unified Date Range (date_from + optional date_to <= 2020)
  and score-threshold filtering
- Cached FOMC speaker autocomplete backed by participants.parquet & participants_report.json
- Meeting bundle discovery
- Generalized classification probability inspector (powering BOTH Zero-Shot
  13-class/sub-class inspection AND Relevance Probabilities inspection)
- Prototype similarity heatmap (Topics on Y-axis, Slices on X-axis)
- N-partition temporal standardization & Combine grouping (Year, Year Range with
  optional hierarchical Sub-Grouping, Month, Quarter, Semester, Speaker, Speaker Role,
  Speaker Sex) with Mean/Median
"""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any, Literal

import numpy as np

from ..config import Settings, get_settings
from .matrix_math import (
    MetricTransform,
    NormalizationMode,
    normalize_mode_alias,
    partition_and_aggregate_chunks,
    project_matrix_granularity,
    transform_matrix,
)
from .query_engine import ParquetQueryEngine, _norm_speaker, _speaker_surname_key
from .taxonomy import (
    LEAF_TO_MACRO,
    MACRO_CATEGORIES,
    SUBCLASS_HIERARCHY,
    format_doc_type,
    format_label,
)

CombineByMode = Literal[
    "none",
    "year",
    "year_range",
    "month",
    "quarter",
    "semester",
    "speaker",
    "speaker_role",
    "gender",
]
SubGroupByMode = Literal[
    "none",
    "year",
    "semester",
    "quarter",
    "month",
    "speaker",
    "speaker_role",
    "gender",
]
AggregationMethod = Literal["mean", "median"]
InspectorMode = Literal["zero_shot", "relevance"]


def _engine(settings: Settings | None = None) -> ParquetQueryEngine:
    return ParquetQueryEngine(settings or get_settings())


def list_available_doc_types(settings: Settings | None = None) -> list[dict[str, str]]:
    dts = _engine(settings).discover_doc_types()
    return [{"id": dt, "label": format_doc_type(dt)} for dt in dts]


def search_speakers(
    query: str = "",
    *,
    limit: int = 15,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Return instant type-ahead FOMC participant suggestions."""
    items = _engine(settings).search_speakers(query=query, limit=limit)
    return {"query": query, "items": items}


def get_corpus_stats(settings: Settings | None = None) -> dict[str, Any]:
    stats = _engine(settings).get_corpus_stats()
    stats["doc_types"] = [
        {
            "id": dt,
            "label": format_doc_type(dt),
            "chunk_count": count,
        }
        for dt, count in sorted(
            stats["doc_type_chunk_counts"].items(), key=lambda kv: kv[1], reverse=True
        )
    ]
    stats["macro_category_count"] = len(MACRO_CATEGORIES)
    stats["subclass_count"] = sum(len(v) for v in SUBCLASS_HIERARCHY.values())
    return stats


_SQL_FILTER_COLUMNS = frozenset({
    "chunk_id",
    "meeting_date",
    "doc_type",
    "year",
    "source_file",
    "sequence_num",
    "section",
    "speaker",
    "speaker_role",
    "district",
    "dialogue_id",
    "chunk_sub_id",
    "text_content",
    "char_count",
    "extraction_method",
})
_SQL_FILTER_DENY_WORDS = (
    "drop",
    "insert",
    "update",
    "delete",
    "alter",
    "create",
    "exec",
    "union",
    "attach",
    "detach",
    "pragma",
)
_SQL_FILTER_DENY_SYMBOLS = (";", "--", "/*", "*/")
_SQL_FILTER_COMPARATOR = re.compile(
    r"([A-Za-z_][A-Za-z0-9_]*)\s*"
    r"(?:>=|<=|<>|!=|=|<|>|\bNOT\s+ILIKE\b|\bNOT\s+LIKE\b|\bNOT\s+IN\b"
    r"|\bILIKE\b|\bLIKE\b|\bBETWEEN\b|\bIN\b|\bIS\b)",
    re.IGNORECASE,
)


def _validate_sql_filter(sql: str) -> str:
    cleaned = sql.strip()
    if not cleaned:
        raise ValueError("Invalid SQL filter")
    without_literals = re.sub(r"'(?:[^']|'')*'", "''", cleaned)
    without_literals = re.sub(r'"(?:[^"]|"")*"', '""', without_literals)
    lowered = without_literals.lower()
    for word in _SQL_FILTER_DENY_WORDS:
        if re.search(rf"\b{word}\b", lowered):
            raise ValueError("Invalid SQL filter")
    for symbol in _SQL_FILTER_DENY_SYMBOLS:
        if symbol in without_literals:
            raise ValueError("Invalid SQL filter")
    for match in _SQL_FILTER_COMPARATOR.finditer(without_literals):
        if match.group(1).lower() not in _SQL_FILTER_COLUMNS:
            raise ValueError("Invalid SQL filter")
    return cleaned


def search_documents(
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
    filter_category: str | None = None,
    filter_metric: MetricTransform = "cosine",
    filter_normalization: NormalizationMode = "none",
    filter_min_score: float | None = None,
    filter_zs_category: str | None = None,
    filter_zs_min_prob: float | None = None,
    filter_rel_class: Literal["relevant", "irrelevant"] | None = None,
    filter_rel_min_prob: float | None = None,
    limit: int = 25,
    offset: int = 0,
    settings: Settings | None = None,
) -> dict[str, Any]:
    eng = _engine(settings)
    validated_sql_filter = _validate_sql_filter(sql_filter) if sql_filter else None
    has_sim_filter = bool(filter_category and filter_min_score is not None)
    has_zs_filter = bool(filter_zs_category and filter_zs_min_prob is not None)
    has_rel_filter = bool(filter_rel_class and filter_rel_min_prob is not None)
    has_any_score_filter = has_sim_filter or has_zs_filter or has_rel_filter
    fetch_limit = max(limit * 4, 200) if has_any_score_filter else limit
    fetch_offset = 0 if has_any_score_filter else offset

    items, total = eng.search_documents(
        date_from=date_from,
        date_to=date_to,
        meeting_date=meeting_date,
        speaker=speaker,
        gender=gender,
        doc_type=doc_type,
        doc_types=doc_types,
        query_text=query_text,
        use_regex=use_regex,
        sql_filter=validated_sql_filter,
        limit=fetch_limit,
        offset=fetch_offset,
    )

    if has_any_score_filter and items:
        filtered: list[dict[str, Any]] = []
        for item in items:
            dt = item["doc_type"]
            md = item["meeting_date"]
            passed = True

            if has_sim_filter:
                _, raw_mat, raw_labels = eng.load_raw_similarity_slice(dt, md)
                if raw_mat.size == 0:
                    passed = False
                else:
                    proj_mat, proj_labels = project_matrix_granularity(raw_mat, raw_labels, "macro")
                    if filter_category not in proj_labels:
                        passed = False
                    else:
                        col_idx = proj_labels.index(filter_category)
                        part = partition_and_aggregate_chunks(proj_mat, n_partitions=1)
                        trans = transform_matrix(
                            part.matrix, metric=filter_metric, normalization=filter_normalization
                        )
                        score_val = float(trans[0, col_idx])
                        if score_val >= float(filter_min_score):
                            item["matched_score"] = round(score_val, 4)
                        else:
                            passed = False

            if passed and has_zs_filter:
                zs_rows, _ = eng.load_zero_shot_slice(dt, md)
                if not zs_rows:
                    passed = False
                else:
                    zs_vals: list[float] = []
                    for r in zs_rows:
                        scores = r.get("scores") or {}
                        if filter_zs_category in scores:
                            zs_vals.append(float(scores[filter_zs_category]))
                        else:
                            subs = [
                                float(scores[s])
                                for s in SUBCLASS_HIERARCHY.get(filter_zs_category, [])
                                if s in scores
                            ]
                            if subs:
                                zs_vals.append(float(np.mean(subs)))
                    mean_zs = float(np.mean(zs_vals)) if zs_vals else 0.0
                    if mean_zs >= float(filter_zs_min_prob):
                        item["matched_zs_prob"] = round(mean_zs, 4)
                    else:
                        passed = False

            if passed and has_rel_filter:
                rel_rows = eng.load_relevance_slice(dt, md)
                if not rel_rows:
                    passed = False
                else:
                    rel_vals = [
                        float((r.get("scores") or {}).get(filter_rel_class, 0.0))
                        for r in rel_rows
                    ]
                    mean_rel = float(np.mean(rel_vals)) if rel_vals else 0.0
                    if mean_rel >= float(filter_rel_min_prob):
                        item["matched_rel_prob"] = round(mean_rel, 4)
                    else:
                        passed = False

            if passed:
                filtered.append(item)
        total = len(filtered)
        items = filtered[offset : offset + limit]

    for item in items:
        item["doc_type_label"] = format_doc_type(item["doc_type"])

    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_document_chunks(
    doc_type: str,
    meeting_date: str,
    *,
    speaker: str | None = None,
    chunk_ids: list[str] | None = None,
    limit: int = 200,
    offset: int = 0,
    settings: Settings | None = None,
) -> dict[str, Any]:
    chunks, total = _engine(settings).get_document_chunks(
        doc_type, meeting_date, speaker=speaker, chunk_ids=chunk_ids, limit=limit, offset=offset
    )
    return {
        "document_id": f"{doc_type}::{meeting_date}",
        "doc_type": doc_type,
        "doc_type_label": format_doc_type(doc_type),
        "meeting_date": meeting_date,
        "chunks": chunks,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_meeting_bundle(
    meeting_date: str,
    *,
    primary_doc_type: str | None = None,
    preview_limit: int = 50,
    settings: Settings | None = None,
) -> dict[str, Any]:
    eng = _engine(settings)
    siblings = eng.get_meeting_sibling_doc_types(meeting_date)
    for sib in siblings:
        sib["doc_type_label"] = format_doc_type(sib["doc_type"])

    available_types = [s["doc_type"] for s in siblings]
    active_type = (
        primary_doc_type
        if primary_doc_type in available_types
        else (
            "transcripts"
            if "transcripts" in available_types
            else (available_types[0] if available_types else None)
        )
    )

    chunks: list[dict[str, Any]] = []
    total_chunks = 0
    speakers: list[str] = []
    if active_type:
        chunks, total_chunks = eng.get_document_chunks(
            active_type, meeting_date, limit=preview_limit, offset=0
        )
        speakers = sorted({c["speaker"] for c in chunks if c.get("speaker")})

    return {
        "meeting_date": meeting_date,
        "siblings": siblings,
        "active_doc_type": active_type,
        "chunks": chunks,
        "total_chunks": total_chunks,
        "speakers": speakers,
    }


def get_classification_inspector(
    doc_type: str,
    meeting_date: str,
    *,
    mode: InspectorMode = "zero_shot",
    speaker: str | None = None,
    chunk_id: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Generalized probability classification inspector.

    Powers BOTH:
    - ``mode == "zero_shot"``: 13 macro-categories + granular sub-classes
    - ``mode == "relevance"``: Binary ``relevant`` vs ``irrelevant`` probabilities
    """
    eng = _engine(settings)
    if mode == "relevance":
        rows = eng.load_relevance_slice(doc_type, meeting_date)
        class_keys = ["relevant", "irrelevant"]
        class_labels = {"relevant": "Relevant", "irrelevant": "Irrelevant"}
    else:
        rows, _ = eng.load_zero_shot_slice(doc_type, meeting_date)
        class_keys = list(MACRO_CATEGORIES)
        class_labels = {m: format_label(m) for m in MACRO_CATEGORIES}

    if not rows:
        return {
            "document_id": f"{doc_type}::{meeting_date}",
            "mode": mode,
            "available": False,
            "total_classified": 0,
            "macro_summary": [],
            "subclass_summary": {},
            "chunks": [],
        }

    if speaker:
        sp_low = speaker.lower()
        rows = [r for r in rows if sp_low in (r.get("speaker") or "").lower()]
    if chunk_id:
        rows = [r for r in rows if r["chunk_id"] == chunk_id]

    if not rows:
        return {
            "document_id": f"{doc_type}::{meeting_date}",
            "mode": mode,
            "available": True,
            "total_classified": 0,
            "macro_summary": [],
            "subclass_summary": {},
            "chunks": [],
        }

    class_sums: dict[str, float] = {k: 0.0 for k in class_keys}
    class_counts: dict[str, int] = {k: 0 for k in class_keys}
    subclass_sums: dict[str, dict[str, list[float]]] = (
        {m: {s: [] for s in subs} for m, subs in SUBCLASS_HIERARCHY.items() if subs}
        if mode == "zero_shot"
        else {}
    )

    formatted_chunks = []
    for r in rows:
        scores = r["scores"]
        chunk_primary: dict[str, float] = {}
        for k in class_keys:
            if k in scores:
                val = float(scores[k])
            elif mode == "zero_shot":
                subs = [scores[s] for s in SUBCLASS_HIERARCHY.get(k, []) if s in scores]
                val = float(np.mean(subs)) if subs else 0.0
            else:
                val = 0.0
            chunk_primary[k] = round(val, 4)
            class_sums[k] += val

        if mode == "zero_shot":
            for m, sub_dict in subclass_sums.items():
                for s in sub_dict:
                    if s in scores:
                        sub_dict[s].append(float(scores[s]))

        if mode == "relevance":
            top_key = "relevant" if chunk_primary["relevant"] >= chunk_primary["irrelevant"] else "irrelevant"
            mapped_primary = top_key
            sub_scores: dict[str, float] = {}
            top_sub = None
        else:
            top_macro = r.get("label_name") or max(chunk_primary, key=chunk_primary.get)
            mapped_primary = LEAF_TO_MACRO.get(top_macro, top_macro)
            sub_scores = {
                s: round(float(scores[s]), 4)
                for s in scores
                if s not in MACRO_CATEGORIES and s != "gdp_activity"
            }
            positive_subs = {k: v for k, v in sub_scores.items() if v > 0.0}
            top_sub = r.get("subclass_label_name") or (
                max(positive_subs, key=positive_subs.get) if positive_subs else None
            )

        if mapped_primary in class_counts:
            class_counts[mapped_primary] += 1

        formatted_chunks.append(
            {
                "chunk_id": r["chunk_id"],
                "sequence_num": r["sequence_num"],
                "speaker": r["speaker"],
                "text_preview": r["text_content"][:320],
                "predicted_macro": mapped_primary,
                "predicted_macro_label": class_labels.get(mapped_primary, format_label(mapped_primary)),
                "predicted_subclass": top_sub,
                "predicted_subclass_label": format_label(top_sub) if top_sub else None,
                "confidence": round(chunk_primary.get(mapped_primary, 0.0), 4),
                "p_relevant": round(r["p_relevant"], 4) if r.get("p_relevant") is not None else None,
                "macro_scores": chunk_primary,
                "subclass_scores": sub_scores,
            }
        )

    n = len(rows)
    macro_summary = [
        {
            "category_id": k,
            "label": class_labels[k],
            "mean_score": round(class_sums[k] / n, 4),
            "chunk_count": class_counts[k],
            "share": round(class_counts[k] / n, 4),
        }
        for k in class_keys
    ]

    subclass_summary: dict[str, list[dict[str, Any]]] = {}
    for m, sub_dict in subclass_sums.items():
        items = []
        for s, vals in sub_dict.items():
            if vals:
                items.append(
                    {
                        "subclass_id": s,
                        "label": format_label(s),
                        "mean_score": round(float(np.mean(vals)), 4),
                    }
                )
        if items:
            subclass_summary[m] = items

    return {
        "document_id": f"{doc_type}::{meeting_date}",
        "mode": mode,
        "available": True,
        "total_classified": n,
        "macro_summary": macro_summary,
        "subclass_summary": subclass_summary,
        "chunks": formatted_chunks[:250],
    }


def get_zero_shot_classifications(
    doc_type: str,
    meeting_date: str,
    *,
    speaker: str | None = None,
    chunk_id: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    return get_classification_inspector(
        doc_type,
        meeting_date,
        mode="zero_shot",
        speaker=speaker,
        chunk_id=chunk_id,
        settings=settings,
    )


def get_similarity_matrix(
    doc_type: str,
    meeting_date: str,
    *,
    metric: MetricTransform = "cosine",
    normalization: NormalizationMode = "none",
    granularity: Literal["macro", "subclass"] = "macro",
    macro_category: str | None = None,
    max_chunks: int = 300,
    settings: Settings | None = None,
) -> dict[str, Any]:
    eng = _engine(settings)
    chunk_ids, raw_mat, raw_labels = eng.load_raw_similarity_slice(doc_type, meeting_date)
    norm_clean = normalize_mode_alias(normalization)

    if raw_mat.size == 0:
        return {
            "document_id": f"{doc_type}::{meeting_date}",
            "doc_type": doc_type,
            "doc_type_label": format_doc_type(doc_type),
            "meeting_date": meeting_date,
            "available": False,
            "total_chunks": 0,
            "metric": metric,
            "normalization": norm_clean,
            "granularity": granularity,
            "categories": [],
            "chunk_ids": [],
            "matrix": [],
            "min_value": 0.0,
            "max_value": 0.0,
        }

    proj_mat, proj_labels = project_matrix_granularity(
        raw_mat, raw_labels, granularity=granularity, macro_category=macro_category
    )
    transformed = transform_matrix(proj_mat, metric=metric, normalization=norm_clean)

    total_chunks = transformed.shape[0]
    display_ids = chunk_ids
    display_mat = transformed
    downsampled = False

    if max_chunks > 0 and total_chunks > max_chunks:
        part = partition_and_aggregate_chunks(transformed, n_partitions=max_chunks)
        display_mat = part.matrix
        display_ids = [
            f"chunks_{start + 1}-{end}" for start, end in part.partition_ranges
        ]
        downsampled = True

    # Transpose to (n_topics, n_slices): Topics on Y-axis, Chunk Sequence on X-axis
    topic_by_slice = display_mat.T

    return {
        "document_id": f"{doc_type}::{meeting_date}",
        "doc_type": doc_type,
        "doc_type_label": format_doc_type(doc_type),
        "meeting_date": meeting_date,
        "available": True,
        "total_chunks": total_chunks,
        "displayed_slices": topic_by_slice.shape[1],
        "downsampled": downsampled,
        "metric": metric,
        "normalization": norm_clean,
        "granularity": granularity,
        "macro_category": macro_category,
        "categories": [{"id": c, "label": format_label(c)} for c in proj_labels],
        "chunk_ids": display_ids,
        "matrix": np.round(topic_by_slice, 4).tolist(),
        "min_value": round(float(np.min(topic_by_slice)), 4),
        "max_value": round(float(np.max(topic_by_slice)), 4),
    }


def _extract_raw_matrix_for_source(
    doc_type: str,
    meeting_date: str,
    data_source: Literal["similarity", "zero_shot"],
    settings: Settings | None = None,
) -> tuple[np.ndarray, list[str], str]:
    eng = _engine(settings)
    if data_source == "zero_shot":
        mat, score_cols = eng.load_raw_zero_shot_matrix(doc_type, meeting_date)
        return mat, score_cols, "zero_shot"

    _, raw_mat, raw_labels = eng.load_raw_similarity_slice(doc_type, meeting_date)
    return raw_mat, raw_labels, "similarity"


def _date_group_key(meeting_date: str, mode: str, year_range_span: int) -> str:
    yr = int(meeting_date[:4])
    mo = int(meeting_date[5:7]) if len(meeting_date) >= 7 else 1
    if mode == "year":
        return str(yr)
    if mode == "year_range":
        span = max(2, int(year_range_span))
        start = (yr // span) * span
        return f"{start}-{start + span - 1}"
    if mode == "month":
        return f"{yr}-{mo:02d}"
    if mode == "quarter":
        q = (mo - 1) // 3 + 1
        return f"{yr}-Q{q}"
    if mode == "semester":
        s = 1 if mo <= 6 else 2
        return f"{yr}-S{s}"
    return meeting_date


def _roster_lookup(roster: dict[str, dict[str, str]], speaker: str) -> dict[str, str]:
    for key in (_norm_speaker(speaker), _speaker_surname_key(speaker)):
        if key and key in roster:
            return roster[key]
    return {}


def _participant_group_key(
    chunk: dict[str, Any],
    mode: str,
    roster: dict[str, dict[str, str]],
) -> str:
    sp = (chunk.get("speaker") or "").strip() or "Unattributed"
    if mode == "speaker":
        return sp
    if mode == "speaker_role":
        role = (chunk.get("speaker_role") or "").strip()
        if not role and sp != "Unattributed":
            role = _roster_lookup(roster, sp).get("role", "")
        return role or "Unknown Role"
    g_val = ""
    if sp != "Unattributed":
        g_val = _roster_lookup(roster, sp).get("gender", "")
    return g_val or "Unknown Gender"


def _aggregate_group_vectors(vectors: list[np.ndarray], method: AggregationMethod) -> np.ndarray:
    stacked = np.vstack(vectors)
    if method == "median":
        return np.nanmedian(stacked, axis=0).astype(np.float32)
    return np.nanmean(stacked, axis=0).astype(np.float32)


def compare_documents(
    documents: list[dict[str, str]],
    *,
    n_partitions: int = 1,
    data_source: Literal["similarity", "zero_shot"] = "similarity",
    metric: MetricTransform = "cosine",
    normalization: NormalizationMode = "none",
    granularity: Literal["macro", "subclass"] = "macro",
    macro_category: str | None = None,
    combine_by: CombineByMode = "none",
    sub_group_by: SubGroupByMode = "none",
    agg_method: AggregationMethod = "mean",
    year_range_span: int = 5,
    settings: Settings | None = None,
) -> dict[str, Any]:
    if not (1 <= n_partitions <= 50):
        raise ValueError("n_partitions must be between 1 and 50")

    eng = _engine(settings)
    norm_clean = normalize_mode_alias(normalization)
    eff_sub_group: SubGroupByMode = sub_group_by if combine_by == "year_range" else "none"
    canonical_categories: list[dict[str, str]] = []

    if combine_by == "none":
        series_out: list[dict[str, Any]] = []
        for doc in documents:
            doc_type = doc["doc_type"]
            meeting_date = doc["meeting_date"]
            doc_id = f"{doc_type}::{meeting_date}"

            raw_mat, raw_labels, actual_source = _extract_raw_matrix_for_source(
                doc_type, meeting_date, data_source, settings=settings
            )
            if raw_mat.size == 0:
                series_out.append(
                    {
                        "document_id": doc_id,
                        "doc_type": doc_type,
                        "doc_type_label": format_doc_type(doc_type),
                        "meeting_date": meeting_date,
                        "available": False,
                        "data_source": actual_source,
                        "total_chunks": 0,
                        "n_partitions": 0,
                        "partitions": [],
                    }
                )
                continue

            proj_mat, proj_labels = project_matrix_granularity(
                raw_mat, raw_labels, granularity=granularity, macro_category=macro_category
            )
            if not canonical_categories:
                canonical_categories = [{"id": c, "label": format_label(c)} for c in proj_labels]

            part_res = partition_and_aggregate_chunks(proj_mat, n_partitions=n_partitions)
            transformed = transform_matrix(
                part_res.matrix, metric=metric, normalization=norm_clean
            )

            partitions_payload = [
                {
                    "partition_index": idx + 1,
                    "label": (
                        f"Full Doc ({part_res.total_chunks} chunks)"
                        if part_res.n_actual == 1
                        else f"Slice {idx + 1}/{part_res.n_actual} (chunks {start + 1}–{end})"
                    ),
                    "chunk_start": start + 1,
                    "chunk_end": end,
                    "values": np.round(transformed[idx], 4).tolist(),
                }
                for idx, (start, end) in enumerate(part_res.partition_ranges)
            ]

            series_out.append(
                {
                    "document_id": doc_id,
                    "doc_type": doc_type,
                    "doc_type_label": format_doc_type(doc_type),
                    "meeting_date": meeting_date,
                    "available": True,
                    "data_source": actual_source,
                    "total_chunks": part_res.total_chunks,
                    "n_partitions": part_res.n_actual,
                    "partitions": partitions_payload,
                }
            )

        return {
            "n_partitions_requested": n_partitions,
            "data_source": data_source,
            "metric": metric,
            "normalization": norm_clean,
            "granularity": granularity,
            "macro_category": macro_category,
            "combine_by": combine_by,
            "sub_group_by": eff_sub_group,
            "agg_method": agg_method,
            "categories": canonical_categories,
            "series": series_out,
        }

    # Combine mode (with optional hierarchical sub_group_by when combine_by == "year_range")
    needs_roster = combine_by in ("speaker_role", "gender") or eff_sub_group in (
        "speaker_role",
        "gender",
    )
    roster: dict[str, dict[str, str]] = {}
    if needs_roster:
        yrs = {int(d["meeting_date"][:4]) for d in documents if len(d["meeting_date"]) >= 4}
        roster = eng.load_participants_roster(years=yrs)

    grouped_partitions: dict[str, dict[int, list[np.ndarray]]] = defaultdict(lambda: defaultdict(list))
    group_chunk_counts: dict[str, int] = defaultdict(int)
    group_doc_counts: dict[str, int] = defaultdict(int)

    for doc in documents:
        doc_type = doc["doc_type"]
        meeting_date = doc["meeting_date"]
        raw_mat, raw_labels, _ = _extract_raw_matrix_for_source(
            doc_type, meeting_date, data_source, settings=settings
        )
        if raw_mat.size == 0:
            continue

        proj_mat, proj_labels = project_matrix_granularity(
            raw_mat, raw_labels, granularity=granularity, macro_category=macro_category
        )
        if not canonical_categories:
            canonical_categories = [{"id": c, "label": format_label(c)} for c in proj_labels]

        # Determine whether grouping is purely document-level (temporal) or chunk-level (participant)
        is_participant_level = combine_by in ("speaker", "speaker_role", "gender") or (
            combine_by == "year_range" and eff_sub_group in ("speaker", "speaker_role", "gender")
        )

        if not is_participant_level:
            primary_key = _date_group_key(meeting_date, combine_by, year_range_span)
            if combine_by == "year_range" and eff_sub_group != "none":
                sub_key = _date_group_key(meeting_date, eff_sub_group, year_range_span)
                gkey = f"{primary_key} · {sub_key}"
            else:
                gkey = primary_key

            part_res = partition_and_aggregate_chunks(proj_mat, n_partitions=n_partitions)
            group_chunk_counts[gkey] += part_res.total_chunks
            group_doc_counts[gkey] += 1
            for p_idx in range(part_res.n_actual):
                grouped_partitions[gkey][p_idx].append(part_res.matrix[p_idx])
        else:
            prefix = (
                f"{_date_group_key(meeting_date, 'year_range', year_range_span)} · "
                if combine_by == "year_range"
                else ""
            )
            part_mode = eff_sub_group if combine_by == "year_range" else combine_by
            chunks = eng.get_document_speaker_meta(doc_type, meeting_date)
            n_rows = min(len(chunks), proj_mat.shape[0])
            per_group_rows: dict[str, list[np.ndarray]] = defaultdict(list)
            for i in range(n_rows):
                p_key = _participant_group_key(chunks[i], part_mode, roster)
                per_group_rows[f"{prefix}{p_key}"].append(proj_mat[i])

            for gkey, vecs in per_group_rows.items():
                sub_mat = np.vstack(vecs)
                part_res = partition_and_aggregate_chunks(sub_mat, n_partitions=n_partitions)
                group_chunk_counts[gkey] += part_res.total_chunks
                group_doc_counts[gkey] += 1
                for p_idx in range(part_res.n_actual):
                    grouped_partitions[gkey][p_idx].append(part_res.matrix[p_idx])

    group_label_suffix = (
        f"{combine_by.replace('_', ' ').title()} / {eff_sub_group.replace('_', ' ').title()}"
        if eff_sub_group != "none"
        else combine_by.replace("_", " ").title()
    )

    combined_series: list[dict[str, Any]] = []
    for gkey in sorted(grouped_partitions.keys()):
        p_map = grouped_partitions[gkey]
        sorted_p_idxs = sorted(p_map.keys())
        agg_rows = np.vstack(
            [_aggregate_group_vectors(p_map[p_idx], agg_method) for p_idx in sorted_p_idxs]
        )
        transformed = transform_matrix(agg_rows, metric=metric, normalization=norm_clean)
        n_act = len(sorted_p_idxs)

        partitions_payload = [
            {
                "partition_index": idx + 1,
                "label": (
                    f"{gkey} ({group_doc_counts[gkey]} docs)"
                    if n_act == 1
                    else f"{gkey} · Slice {idx + 1}/{n_act}"
                ),
                "chunk_start": idx + 1,
                "chunk_end": idx + 1,
                "values": np.round(transformed[idx], 4).tolist(),
            }
            for idx in range(n_act)
        ]

        combined_series.append(
            {
                "document_id": f"group::{combine_by}::{eff_sub_group}::{gkey}",
                "doc_type": combine_by,
                "doc_type_label": f"Grouped ({group_label_suffix})",
                "meeting_date": gkey,
                "available": True,
                "data_source": data_source,
                "total_chunks": group_chunk_counts[gkey],
                "n_partitions": n_act,
                "partitions": partitions_payload,
            }
        )

    return {
        "n_partitions_requested": n_partitions,
        "data_source": data_source,
        "metric": metric,
        "normalization": norm_clean,
        "granularity": granularity,
        "macro_category": macro_category,
        "combine_by": combine_by,
        "sub_group_by": eff_sub_group,
        "agg_method": agg_method,
        "categories": canonical_categories,
        "series": combined_series,
    }
