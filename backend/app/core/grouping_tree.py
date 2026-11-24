"""Hierarchical Grouping Tree, Chronological Intra-Subgroup Slicing & Slice Drill-Down Engine.

Modular core engine for MiningFOMC V5:
- Removes artificial 20-leaf caps: supports arbitrarily deep grouping trees and any
  number of selected documents (>= 1 visible leaf).
- Flattens intra-meeting and intra-subgroup S slices strictly chronologically along
  the X-axis so each (Cohort, Topic) pair renders as ONE continuous chronological curve
  of length (M periods x S slices).
- Purely temporal trees merge into one continuous chronological curve per active topic;
  non-temporal splits (Speaker, Speaker Role, Speaker Sex) define distinct cohort curves.
- Attaches full semantic zoom metadata (index, year, month, meeting_date, period_key,
  period_label, slice_num, slice_index, total_slices, full_label) to every X-axis point.
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from typing import Any, Literal

import numpy as np

from ..config import Settings, get_settings
from .fomc_service import _extract_raw_matrix_for_source, _participant_group_key
from .matrix_math import (
    MetricTransform,
    NormalizationMode,
    normalize_mode_alias,
    partition_and_aggregate_chunks,
    project_matrix_granularity,
    transform_matrix,
)
from .query_engine import ParquetQueryEngine
from .taxonomy import format_doc_type, format_label

SplitCriterion = Literal[
    "year",
    "year_range",
    "custom_range",
    "semester",
    "quarter",
    "month",
    "speaker",
    "speaker_role",
    "gender",
]

TEMPORAL_CRITERIA = {"year", "year_range", "custom_range", "semester", "quarter", "month"}
PARTICIPANT_CRITERIA = {"speaker", "speaker_role", "gender"}


def _temporal_value(meeting_date: str, criterion: str, year_range_span: int = 5) -> tuple[str, str, int]:
    """Return ``(sort_key, display_label, year)`` for a meeting_date under a temporal criterion."""
    yr = int(meeting_date[:4]) if len(meeting_date) >= 4 else 1976
    mo = int(meeting_date[5:7]) if len(meeting_date) >= 7 else 1
    if criterion == "year":
        return f"{yr:04d}", str(yr), yr
    if criterion == "year_range":
        span = max(2, int(year_range_span))
        start = (yr // span) * span
        end = start + span - 1
        return f"{start:04d}-{end:04d}", f"{start}–{end}", yr
    if criterion == "semester":
        h = 1 if mo <= 6 else 2
        return f"{yr:04d}-H{h}", f"{yr} H{h}", yr
    if criterion == "quarter":
        q = (mo - 1) // 3 + 1
        return f"{yr:04d}-Q{q}", f"{yr} Q{q}", yr
    if criterion == "month":
        return f"{yr:04d}-{mo:02d}", f"{yr}-{mo:02d}", yr
    return meeting_date, meeting_date, yr



def _normalize_range_bound(raw: str, *, is_end: bool, max_available_date: str) -> str:
    """Normalize a custom range bound ('1976', '1979-06', '1979-06-15', or '-' for dynamic latest)."""
    val = (raw or "").strip()
    if not val or val == "-":
        return max_available_date if is_end else "1976-01-01"
    if len(val) == 4 and val.isdigit():
        return f"{val}-12-31" if is_end else f"{val}-01-01"
    if len(val) == 7 and val[4] == "-":
        return f"{val}-31" if is_end else f"{val}-01"
    return val


def _bucket_custom_ranges(
    docs_subset: list[dict[str, str]],
    custom_ranges: list[dict[str, Any]],
    max_available_date: str,
) -> tuple[dict[str, list[dict[str, str]]], dict[str, str], list[str]]:
    """Assign documents into user-defined custom date ranges (supports dynamic '-' latest date)."""
    buckets: dict[str, list[dict[str, str]]] = defaultdict(list)
    labels_map: dict[str, str] = {}
    ordered_keys: list[str] = []

    if not custom_ranges:
        return buckets, labels_map, ordered_keys

    resolved_specs: list[tuple[str, str, str, str]] = []
    for idx, spec in enumerate(custom_ranges):
        raw_start = str(spec.get("start") or "").strip()
        raw_end = str(spec.get("end") or "-").strip() or "-"
        if not raw_start:
            continue
        norm_start = _normalize_range_bound(raw_start, is_end=False, max_available_date=max_available_date)
        norm_end = _normalize_range_bound(raw_end, is_end=True, max_available_date=max_available_date)
        if norm_start > norm_end:
            norm_start, norm_end = norm_end, norm_start
        b_key = f"{norm_start}..{norm_end}"
        end_disp = max_available_date[:4] if raw_end == "-" and len(raw_start) == 4 else (max_available_date if raw_end == "-" else raw_end)
        custom_lbl = str(spec.get("label") or "").strip()
        disp = custom_lbl or f"{raw_start}–{end_disp}"
        if b_key not in labels_map:
            ordered_keys.append(b_key)
        labels_map[b_key] = disp
        resolved_specs.append((b_key, norm_start, norm_end, disp))

    for d in docs_subset:
        md = d["meeting_date"]
        for b_key, norm_start, norm_end, _ in resolved_specs:
            if norm_start <= md <= norm_end:
                buckets[b_key].append(d)

    return buckets, labels_map, [k for k in ordered_keys if buckets.get(k)]


def _match_temporal_filter(meeting_date: str, period_key: str, year_range_span: int = 5) -> bool:
    """Check whether ``meeting_date`` belongs to a canonical ``period_key``."""
    if not period_key:
        return True
    pk = period_key.strip()
    if ".." in pk:
        start_s, end_s = pk.split("..", 1)
        start_norm = _normalize_range_bound(start_s, is_end=False, max_available_date="9999-12-31")
        end_norm = _normalize_range_bound(end_s, is_end=True, max_available_date="9999-12-31")
        return start_norm <= meeting_date <= end_norm
    if len(pk) == 10 and pk[4] == "-" and pk[7] == "-":
        return meeting_date == pk
    if "-H" in pk:
        sk, _, _ = _temporal_value(meeting_date, "semester")
        return sk == pk
    if "-Q" in pk:
        sk, _, _ = _temporal_value(meeting_date, "quarter")
        return sk == pk
    if len(pk) == 7 and pk[4] == "-":
        sk, _, _ = _temporal_value(meeting_date, "month")
        return sk == pk
    if len(pk) == 9 and pk[4] == "-":
        start_s, end_s = pk.split("-", 1)
        if start_s.isdigit() and end_s.isdigit():
            yr = int(meeting_date[:4])
            return int(start_s) <= yr <= int(end_s)
    if len(pk) == 4 and pk.isdigit():
        return meeting_date.startswith(pk)
    return True


def _load_doc_participant_values(
    eng: ParquetQueryEngine,
    documents: list[dict[str, str]],
    needed_criteria: set[str],
    roster: dict[str, dict[str, str]],
) -> dict[tuple[str, str], dict[str, set[str]]]:
    """Return ``(doc_type, meeting_date) -> {criterion: set_of_values}`` out-of-core."""
    if not needed_criteria:
        return {}
    out: dict[tuple[str, str], dict[str, set[str]]] = {}
    for doc in documents:
        dt = doc["doc_type"]
        md = doc["meeting_date"]
        chunks = eng.get_document_speaker_meta(dt, md)
        vals: dict[str, set[str]] = {c: set() for c in needed_criteria}
        for ch in chunks:
            for c in needed_criteria:
                vals[c].add(_participant_group_key(ch, c, roster))
        out[(dt, md)] = vals
    return out


def build_grouping_tree_preview(
    documents: list[dict[str, str]],
    split_levels: list[dict[str, Any]],
    *,
    hidden_node_ids: list[str] | None = None,
    node_splits: dict[str, dict[str, Any]] | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Build the interactive hierarchical Grouping Tree with exact doc counts (uncapped)."""
    eng = ParquetQueryEngine(settings or get_settings())
    hidden_set = set(hidden_node_ids or [])
    per_node_splits = node_splits or {}

    seen_docs: set[tuple[str, str]] = set()
    unique_docs: list[dict[str, str]] = []
    for d in sorted(documents, key=lambda x: (x["meeting_date"], x["doc_type"])):
        key = (d["doc_type"], d["meeting_date"])
        if key not in seen_docs:
            seen_docs.add(key)
            unique_docs.append({"doc_type": d["doc_type"], "meeting_date": d["meeting_date"]})

    min_available_date = unique_docs[0]["meeting_date"] if unique_docs else "1976-01-01"
    max_available_date = unique_docs[-1]["meeting_date"] if unique_docs else "2020-12-31"

    all_cfgs = [*split_levels, *per_node_splits.values()]
    used_participant_criteria = {
        lvl["criterion"] for lvl in all_cfgs if lvl.get("criterion") in PARTICIPANT_CRITERIA
    }
    roster: dict[str, dict[str, str]] = {}
    if used_participant_criteria & {"speaker_role", "gender"}:
        yrs = {int(d["meeting_date"][:4]) for d in unique_docs if len(d["meeting_date"]) >= 4}
        roster = eng.load_participants_roster(years=yrs)

    doc_part_vals = _load_doc_participant_values(eng, unique_docs, used_participant_criteria, roster)

    def _build_node(
        node_id: str,
        label: str,
        criterion: str,
        value: str,
        level: int,
        docs_subset: list[dict[str, str]],
        path_filters: list[dict[str, Any]],
        ancestor_hidden: bool,
    ) -> dict[str, Any]:
        is_hidden = node_id in hidden_set
        eff_hidden = ancestor_hidden or is_hidden

        node: dict[str, Any] = {
            "id": node_id,
            "label": label,
            "criterion": criterion,
            "value": value,
            "level": level,
            "doc_count": len(docs_subset),
            "hidden": is_hidden,
            "effectively_hidden": eff_hidden,
            "path_filters": path_filters,
            "children": [],
        }

        lvl_cfg = per_node_splits.get(node_id) or (
            split_levels[level] if level < len(split_levels) else None
        )
        if not lvl_cfg or not docs_subset:
            return node

        crit = str(lvl_cfg["criterion"])
        span = int(lvl_cfg.get("year_range_span") or 5)

        buckets: dict[str, list[dict[str, str]]] = defaultdict(list)
        labels_map: dict[str, str] = {}
        ordered_keys: list[str] = []

        if crit == "custom_range":
            buckets, labels_map, ordered_keys = _bucket_custom_ranges(
                docs_subset, lvl_cfg.get("custom_ranges") or [], max_available_date
            )
        elif crit in TEMPORAL_CRITERIA:
            for d in docs_subset:
                sk, disp, _ = _temporal_value(d["meeting_date"], crit, span)
                buckets[sk].append(d)
                labels_map[sk] = disp
            ordered_keys = sorted(buckets.keys())
        else:
            for d in docs_subset:
                vals = doc_part_vals.get((d["doc_type"], d["meeting_date"]), {}).get(crit, set())
                for v in vals:
                    buckets[v].append(d)
                    labels_map[v] = v
            ordered_keys = sorted(buckets.keys())

        for b_key in ordered_keys:
            child_id = f"{node_id}/{crit}:{b_key}"
            child_filters = [
                *path_filters,
                {"criterion": crit, "value": b_key, "label": labels_map[b_key], "year_range_span": span},
            ]
            node["children"].append(
                _build_node(
                    node_id=child_id,
                    label=labels_map[b_key],
                    criterion=crit,
                    value=b_key,
                    level=level + 1,
                    docs_subset=buckets[b_key],
                    path_filters=child_filters,
                    ancestor_hidden=eff_hidden,
                )
            )
        return node

    root = _build_node(
        node_id="root",
        label="All Selected Documents",
        criterion="root",
        value="all",
        level=0,
        docs_subset=unique_docs,
        path_filters=[],
        ancestor_hidden=False,
    )

    visible_leaves_count = 0
    total_leaves = 0

    def _count_leaves(node: dict[str, Any]) -> None:
        nonlocal total_leaves, visible_leaves_count
        if not node["children"]:
            total_leaves += 1
            if not node["effectively_hidden"]:
                visible_leaves_count += 1
        else:
            for ch in node["children"]:
                _count_leaves(ch)

    _count_leaves(root)

    return {
        "root": root,
        "total_documents": len(unique_docs),
        "total_leaves": total_leaves,
        "visible_leaf_count": visible_leaves_count,
        "valid_for_compare": visible_leaves_count >= 1,
        "min_available_date": min_available_date,
        "max_available_date": max_available_date,
    }


def compare_ungrouped_chronological(
    documents: list[dict[str, str]],
    *,
    n_partitions: int = 1,
    data_source: Literal["similarity", "zero_shot"] = "similarity",
    metric: MetricTransform = "cosine",
    normalization: NormalizationMode = "none",
    granularity: Literal["macro", "subclass"] = "macro",
    macro_category: str | None = None,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Flatten ungrouped selected documents strictly chronologically across M meetings x S slices.

    Produces ONE continuous chronological cohort curve per active topic:
    (Meeting_1, Slice_1) .. (Meeting_1, Slice_S) -> (Meeting_2, Slice_1) .. (Meeting_M, Slice_S).
    """
    if not (1 <= n_partitions <= 50):
        raise ValueError("n_partitions must be between 1 and 50")

    norm_clean = normalize_mode_alias(normalization)

    # Deduplicate and sort strictly chronologically (earliest to latest)
    seen: set[tuple[str, str]] = set()
    ordered_docs: list[dict[str, str]] = []
    for d in sorted(documents, key=lambda x: (x["meeting_date"], x["doc_type"])):
        k = (d["doc_type"], d["meeting_date"])
        if k not in seen:
            seen.add(k)
            ordered_docs.append({"doc_type": d["doc_type"], "meeting_date": d["meeting_date"]})

    canonical_categories: list[dict[str, str]] = []
    series_out: list[dict[str, Any]] = []
    time_ticks: list[dict[str, Any]] = []
    tick_vectors: list[np.ndarray] = []
    tick_meta: list[dict[str, Any]] = []

    for doc in ordered_docs:
        dt = doc["doc_type"]
        md = doc["meeting_date"]
        doc_id = f"{dt}::{md}"
        raw_mat, raw_labels, actual_source = _extract_raw_matrix_for_source(
            dt, md, data_source, settings=settings
        )
        if raw_mat.size == 0:
            series_out.append(
                {
                    "document_id": doc_id,
                    "doc_type": dt,
                    "doc_type_label": format_doc_type(dt),
                    "meeting_date": md,
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
        transformed = transform_matrix(part_res.matrix, metric=metric, normalization=norm_clean)

        yr = int(md[:4]) if len(md) >= 4 and md[:4].isdigit() else 1976
        mo_str = md[:7] if len(md) >= 7 else f"{yr:04d}-01"

        partitions_payload = []
        for idx, (start, end) in enumerate(part_res.partition_ranges):
            s_num = idx + 1
            vals_list = np.round(transformed[idx], 4).tolist()
            partitions_payload.append(
                {
                    "partition_index": s_num,
                    "label": (
                        f"Full Doc ({part_res.total_chunks} chunks)"
                        if part_res.n_actual == 1
                        else f"Slice {s_num}/{part_res.n_actual} (chunks {start + 1}–{end})"
                    ),
                    "chunk_start": start + 1,
                    "chunk_end": end,
                    "values": vals_list,
                }
            )

            t_idx = len(time_ticks)
            time_ticks.append(
                {
                    "index": t_idx,
                    "year": yr,
                    "month": mo_str,
                    "meeting_date": md,
                    "period_key": md,
                    "period_label": md,
                    "slice_num": s_num,
                    "slice_index": s_num,
                    "total_slices": part_res.n_actual,
                    "full_label": (
                        f"{md} ({format_doc_type(dt)})"
                        if part_res.n_actual == 1
                        else f"{md} · Slice {s_num}/{part_res.n_actual}"
                    ),
                }
            )
            tick_vectors.append(transformed[idx])
            tick_meta.append(
                {
                    "documents": [{"doc_type": dt, "meeting_date": md}],
                    "path_filters": [],
                    "period_key": md,
                    "slice_index": s_num,
                    "n_partitions": part_res.n_actual,
                    "doc_count": 1,
                    "chunk_count": int(end - start),
                }
            )

        series_out.append(
            {
                "document_id": doc_id,
                "doc_type": dt,
                "doc_type_label": format_doc_type(dt),
                "meeting_date": md,
                "available": True,
                "data_source": actual_source,
                "total_chunks": part_res.total_chunks,
                "n_partitions": part_res.n_actual,
                "partitions": partitions_payload,
            }
        )

    n_cats = len(canonical_categories)
    ordered_series: list[dict[str, Any]] = []
    if tick_vectors and n_cats > 0:
        stacked = np.vstack(tick_vectors)  # shape (T, C)
        values_by_topic = [
            [float(stacked[t, c]) for t in range(stacked.shape[0])]
            for c in range(n_cats)
        ]
        ordered_series.append(
            {
                "cohort_id": "all_selected",
                "label": "All Selected Meetings",
                "values_by_topic": values_by_topic,
                "tick_meta": tick_meta,
            }
        )

    return {
        "n_partitions_requested": n_partitions,
        "data_source": data_source,
        "metric": metric,
        "normalization": norm_clean,
        "granularity": granularity,
        "macro_category": macro_category,
        "combine_by": "none",
        "sub_group_by": "none",
        "agg_method": "mean",
        "categories": canonical_categories,
        "series": series_out,
        "time_ticks": time_ticks,
        "ordered_series": ordered_series,
    }


def compare_with_grouping_tree(
    documents: list[dict[str, str]],
    split_levels: list[dict[str, Any]],
    *,
    hidden_node_ids: list[str] | None = None,
    node_splits: dict[str, dict[str, Any]] | None = None,
    n_partitions: int = 1,
    data_source: Literal["similarity", "zero_shot"] = "similarity",
    metric: MetricTransform = "cosine",
    normalization: NormalizationMode = "none",
    granularity: Literal["macro", "subclass"] = "macro",
    macro_category: str | None = None,
    agg_method: Literal["mean", "median"] = "mean",
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Compute Radar + Chronologically Flattened Intra-Subgroup Time-Series (uncapped).

    - Non-temporal splits (Speaker, Speaker Role, Speaker Sex) define distinct Cohort Curves.
    - Temporal splits (Year Range, Year, Semester, Quarter, Month) define ordered chronological
      buckets along the X-axis, each subdivided into S sequential slices (Slice 1..S).
    - Purely temporal trees merge into ONE continuous chronological curve per active topic.
    """
    if not (1 <= n_partitions <= 50):
        raise ValueError("n_partitions must be between 1 and 50")

    eng = ParquetQueryEngine(settings or get_settings())
    norm_clean = normalize_mode_alias(normalization)

    hidden_set = set(hidden_node_ids or [])
    per_node_splits = node_splits or {}
    seen_docs: set[tuple[str, str]] = set()
    unique_docs: list[dict[str, str]] = []
    for d in sorted(documents, key=lambda x: (x["meeting_date"], x["doc_type"])):
        key = (d["doc_type"], d["meeting_date"])
        if key not in seen_docs:
            seen_docs.add(key)
            unique_docs.append({"doc_type": d["doc_type"], "meeting_date": d["meeting_date"]})

    max_available_date = unique_docs[-1]["meeting_date"] if unique_docs else "2020-12-31"
    all_cfgs = [*split_levels, *per_node_splits.values()]
    used_participant_criteria = {
        lvl["criterion"] for lvl in all_cfgs if lvl.get("criterion") in PARTICIPANT_CRITERIA
    }
    roster: dict[str, dict[str, str]] = {}
    if used_participant_criteria & {"speaker_role", "gender"}:
        yrs = {int(d["meeting_date"][:4]) for d in unique_docs if len(d["meeting_date"]) >= 4}
        roster = eng.load_participants_roster(years=yrs)

    doc_part_vals = _load_doc_participant_values(eng, unique_docs, used_participant_criteria, roster)

    visible_leaves: list[dict[str, Any]] = []

    def _walk(
        node_id: str,
        level: int,
        docs_subset: list[dict[str, str]],
        path_filters: list[dict[str, Any]],
        ancestor_hidden: bool,
    ) -> None:
        eff_hidden = ancestor_hidden or (node_id in hidden_set)
        lvl_cfg = per_node_splits.get(node_id) or (
            split_levels[level] if level < len(split_levels) else None
        )
        if not lvl_cfg or not docs_subset:
            if not eff_hidden and docs_subset:
                visible_leaves.append(
                    {
                        "node_id": node_id,
                        "path_filters": path_filters,
                        "documents": docs_subset,
                    }
                )
            return

        crit = str(lvl_cfg["criterion"])
        span = int(lvl_cfg.get("year_range_span") or 5)
        buckets: dict[str, list[dict[str, str]]] = defaultdict(list)
        labels_map: dict[str, str] = {}
        ordered_keys: list[str] = []

        if crit == "custom_range":
            buckets, labels_map, ordered_keys = _bucket_custom_ranges(
                docs_subset, lvl_cfg.get("custom_ranges") or [], max_available_date
            )
        elif crit in TEMPORAL_CRITERIA:
            for d in docs_subset:
                sk, disp, _ = _temporal_value(d["meeting_date"], crit, span)
                buckets[sk].append(d)
                labels_map[sk] = disp
            ordered_keys = sorted(buckets.keys())
        else:
            for d in docs_subset:
                vals = doc_part_vals.get((d["doc_type"], d["meeting_date"]), {}).get(crit, set())
                for v in vals:
                    buckets[v].append(d)
                    labels_map[v] = v
            ordered_keys = sorted(buckets.keys())

        for b_key in ordered_keys:
            child_id = f"{node_id}/{crit}:{b_key}"
            child_filters = [
                *path_filters,
                {"criterion": crit, "value": b_key, "label": labels_map[b_key], "year_range_span": span},
            ]
            _walk(child_id, level + 1, buckets[b_key], child_filters, eff_hidden)

    _walk("root", 0, unique_docs, [], False)

    if not visible_leaves:
        raise ValueError("At least 1 visible leaf node is required to compare.")

    doc_matrix_cache: dict[tuple[str, str], tuple[np.ndarray, list[str]]] = {}
    doc_chunks_cache: dict[tuple[str, str], list[dict[str, Any]]] = {}
    canonical_categories: list[dict[str, str]] = []

    def _get_doc_proj(doc_type: str, meeting_date: str) -> tuple[np.ndarray, list[str]]:
        nonlocal canonical_categories
        k = (doc_type, meeting_date)
        if k not in doc_matrix_cache:
            raw_mat, raw_labels, _ = _extract_raw_matrix_for_source(
                doc_type, meeting_date, data_source, settings=settings
            )
            if raw_mat.size == 0:
                doc_matrix_cache[k] = (np.empty((0, 0), dtype=np.float32), [])
            else:
                proj_mat, proj_labels = project_matrix_granularity(
                    raw_mat, raw_labels, granularity=granularity, macro_category=macro_category
                )
                if not canonical_categories:
                    canonical_categories = [{"id": c, "label": format_label(c)} for c in proj_labels]
                doc_matrix_cache[k] = (proj_mat, proj_labels)
        return doc_matrix_cache[k]

    def _get_doc_chunks(doc_type: str, meeting_date: str) -> list[dict[str, Any]]:
        k = (doc_type, meeting_date)
        if k not in doc_chunks_cache:
            doc_chunks_cache[k] = eng.get_document_speaker_meta(doc_type, meeting_date)
        return doc_chunks_cache[k]

    radar_series: list[dict[str, Any]] = []
    ts_cohorts: dict[str, dict[str, Any]] = {}
    period_meta: dict[str, dict[str, Any]] = {}

    for leaf in visible_leaves:
        p_filters = leaf["path_filters"]
        part_filters = [f for f in p_filters if f["criterion"] in PARTICIPANT_CRITERIA]
        temp_filters = [f for f in p_filters if f["criterion"] in TEMPORAL_CRITERIA]

        leaf_label = " · ".join(f["label"] for f in p_filters) if p_filters else "All Selected"

        # Non-temporal splits define Cohort Curves; purely temporal trees form ONE chronological curve
        if part_filters:
            cohort_key = " · ".join(f["label"] for f in part_filters)
            cohort_filters = part_filters
        else:
            cohort_key = "All Selected (Chronological)"
            cohort_filters = []

        first_md = leaf["documents"][0]["meeting_date"]
        first_mo = first_md[:7] if len(first_md) >= 7 else f"{first_md[:4]}-01"

        if temp_filters:
            finest_t = temp_filters[-1]
            p_key = str(finest_t["value"])
            p_label = str(finest_t["label"])
            p_year = int(p_key[:4]) if len(p_key) >= 4 and p_key[:4].isdigit() else int(first_md[:4])
            p_month = p_key if len(p_key) == 7 and p_key[4] == "-" else first_mo
        else:
            # No temporal split in tree -> break down by individual meeting dates chronologically
            # inside this cohort so slices still follow meeting progression!
            p_key = "all"
            p_label = "Full Span"
            p_year = int(first_md[:4])
            p_month = first_mo

        # If there are NO temporal splits in the tree (e.g., Speaker only), expand each meeting
        # chronologically inside that cohort so X-axis is Meeting_1..Meeting_M x Slice 1..S
        if not temp_filters and len(leaf["documents"]) > 1:
            per_doc_entries: list[tuple[str, str, int, str, str, list[dict[str, str]]]] = []
            for d in leaf["documents"]:
                md = d["meeting_date"]
                yr = int(md[:4]) if len(md) >= 4 else 1976
                mo = md[:7] if len(md) >= 7 else f"{yr:04d}-01"
                per_doc_entries.append((md, md, yr, mo, md, [d]))
        else:
            per_doc_entries = [(p_key, p_label, p_year, p_month, first_md, leaf["documents"])]

        leaf_all_slice_buckets: dict[int, list[np.ndarray]] = defaultdict(list)
        leaf_total_chunks = 0

        for sub_pkey, sub_plabel, sub_pyr, sub_pmo, sub_md, sub_docs in per_doc_entries:
            slice_buckets: dict[int, list[np.ndarray]] = defaultdict(list)
            slice_chunk_counts: dict[int, int] = defaultdict(int)
            slice_doc_counts: dict[int, int] = defaultdict(int)
            sub_chunks = 0

            for doc in sub_docs:
                dt = doc["doc_type"]
                md = doc["meeting_date"]
                proj_mat, _ = _get_doc_proj(dt, md)
                if proj_mat.size == 0:
                    continue

                if part_filters:
                    chs = _get_doc_chunks(dt, md)
                    n_rows = min(len(chs), proj_mat.shape[0])
                    selected_rows = []
                    for i in range(n_rows):
                        ok = True
                        for pf in part_filters:
                            if _participant_group_key(chs[i], pf["criterion"], roster) != pf["value"]:
                                ok = False
                                break
                        if ok:
                            selected_rows.append(proj_mat[i])
                    if not selected_rows:
                        continue
                    doc_mat = np.vstack(selected_rows)
                else:
                    doc_mat = proj_mat

                part_res = partition_and_aggregate_chunks(doc_mat, n_partitions=n_partitions)
                sub_chunks += part_res.total_chunks
                for s_idx in range(part_res.n_actual):
                    start_c, end_c = part_res.partition_ranges[s_idx]
                    slice_buckets[s_idx].append(part_res.matrix[s_idx])
                    slice_chunk_counts[s_idx] += int(end_c - start_c)
                    slice_doc_counts[s_idx] += 1
                    leaf_all_slice_buckets[s_idx].append(part_res.matrix[s_idx])

            if not slice_buckets:
                continue

            leaf_total_chunks += sub_chunks
            sorted_s_idxs = sorted(slice_buckets.keys())
            agg_rows = []
            for s_idx in sorted_s_idxs:
                stacked = np.vstack(slice_buckets[s_idx])
                vec = (
                    np.nanmedian(stacked, axis=0).astype(np.float32)
                    if agg_method == "median"
                    else np.nanmean(stacked, axis=0).astype(np.float32)
                )
                agg_rows.append(vec)
            transformed = transform_matrix(
                np.vstack(agg_rows), metric=metric, normalization=norm_clean
            )

            period_meta[sub_pkey] = {
                "period_key": sub_pkey,
                "period_label": sub_plabel,
                "year": sub_pyr,
                "month": sub_pmo,
                "meeting_date": sub_md,
            }
            c_entry = ts_cohorts.setdefault(
                cohort_key,
                {
                    "cohort_id": cohort_key,
                    "label": cohort_key,
                    "cohort_filters": cohort_filters,
                    "periods": {},
                },
            )
            c_entry["periods"][sub_pkey] = {
                "matrix": transformed,
                "documents": sub_docs,
                "path_filters": p_filters,
                "total_chunks": sub_chunks,
                "slice_chunk_counts": dict(slice_chunk_counts),
                "slice_doc_counts": dict(slice_doc_counts),
            }

        if not leaf_all_slice_buckets:
            continue

        sorted_leaf_s = sorted(leaf_all_slice_buckets.keys())
        leaf_agg_rows = [
            (
                np.nanmedian(np.vstack(leaf_all_slice_buckets[s_idx]), axis=0).astype(np.float32)
                if agg_method == "median"
                else np.nanmean(np.vstack(leaf_all_slice_buckets[s_idx]), axis=0).astype(np.float32)
            )
            for s_idx in sorted_leaf_s
        ]
        leaf_trans = transform_matrix(np.vstack(leaf_agg_rows), metric=metric, normalization=norm_clean)
        n_act = leaf_trans.shape[0]
        radar_series.append(
            {
                "document_id": leaf["node_id"],
                "doc_type": "tree_leaf",
                "doc_type_label": f"Tree Cohort ({len(leaf['documents'])} docs)",
                "meeting_date": leaf_label,
                "available": True,
                "data_source": data_source,
                "total_chunks": leaf_total_chunks,
                "n_partitions": n_act,
                "path_filters": p_filters,
                "documents": leaf["documents"],
                "partitions": [
                    {
                        "partition_index": idx + 1,
                        "label": (
                            f"{leaf_label} ({len(leaf['documents'])} docs)"
                            if n_act == 1
                            else f"{leaf_label} · Slice {idx + 1}/{n_act}"
                        ),
                        "chunk_start": idx + 1,
                        "chunk_end": idx + 1,
                        "values": np.round(leaf_trans[idx], 4).tolist(),
                    }
                    for idx in range(n_act)
                ],
            }
        )

    # Build master strictly chronological X-axis: ordered periods x S slices
    ordered_periods = sorted(period_meta.values(), key=lambda x: (x["year"], x["period_key"]))
    time_ticks: list[dict[str, Any]] = []
    tick_lookup: dict[tuple[str, int], int] = {}

    for pm in ordered_periods:
        for s_num in range(1, n_partitions + 1):
            t_idx = len(time_ticks)
            tick_lookup[(pm["period_key"], s_num)] = t_idx
            time_ticks.append(
                {
                    "index": t_idx,
                    "year": pm["year"],
                    "month": pm["month"],
                    "meeting_date": pm["meeting_date"],
                    "period_key": pm["period_key"],
                    "period_label": pm["period_label"],
                    "slice_num": s_num,
                    "slice_index": s_num,
                    "total_slices": n_partitions,
                    "full_label": (
                        pm["period_label"]
                        if n_partitions == 1
                        else f"{pm['period_label']} · Slice {s_num}/{n_partitions}"
                    ),
                }
            )

    n_ticks = len(time_ticks)
    n_cats = len(canonical_categories)
    ordered_ts_series: list[dict[str, Any]] = []

    for c_key in sorted(ts_cohorts.keys()):
        c_data = ts_cohorts[c_key]
        values_by_topic: list[list[float | None]] = [[None] * n_ticks for _ in range(n_cats)]
        tick_inspect_meta: list[dict[str, Any] | None] = [None] * n_ticks

        for p_key, p_payload in c_data["periods"].items():
            mat = p_payload["matrix"]
            for s_idx in range(mat.shape[0]):
                t_idx = tick_lookup.get((p_key, s_idx + 1))
                if t_idx is None:
                    continue
                for cat_idx in range(min(n_cats, mat.shape[1])):
                    values_by_topic[cat_idx][t_idx] = float(mat[s_idx, cat_idx])
                tick_inspect_meta[t_idx] = {
                    "documents": p_payload["documents"],
                    "path_filters": p_payload["path_filters"],
                    "period_key": p_key,
                    "slice_index": s_idx + 1,
                    "n_partitions": n_partitions,
                    "doc_count": int(p_payload["slice_doc_counts"].get(s_idx, len(p_payload["documents"]))),
                    "chunk_count": int(p_payload["slice_chunk_counts"].get(s_idx, 0)),
                }

        ordered_ts_series.append(
            {
                "cohort_id": c_data["cohort_id"],
                "label": c_data["label"],
                "values_by_topic": values_by_topic,
                "tick_meta": tick_inspect_meta,
            }
        )

    return {
        "n_partitions_requested": n_partitions,
        "data_source": data_source,
        "metric": metric,
        "normalization": norm_clean,
        "granularity": granularity,
        "macro_category": macro_category,
        "combine_by": "tree",
        "sub_group_by": "none",
        "agg_method": agg_method,
        "categories": canonical_categories,
        "series": radar_series,
        "time_ticks": time_ticks,
        "ordered_series": ordered_ts_series,
    }


def inspect_slice_or_node(
    documents: list[dict[str, str]],
    *,
    path_filters: list[dict[str, Any]] | None = None,
    period_key: str | None = None,
    slice_index: int | None = None,
    n_partitions: int = 1,
    query_text: str | None = None,
    filter_speaker: str | None = None,
    data_source: Literal["similarity", "zero_shot"] = "similarity",
    metric: MetricTransform = "cosine",
    normalization: NormalizationMode = "none",
    granularity: Literal["macro", "subclass"] = "macro",
    macro_category: str | None = None,
    limit: int = 40,
    offset: int = 0,
    settings: Settings | None = None,
) -> dict[str, Any]:
    """Deep drill-down inspector for any clicked Grouping Tree node or Time-Series point."""
    eng = ParquetQueryEngine(settings or get_settings())
    norm_clean = normalize_mode_alias(normalization)
    filters = path_filters or []
    part_filters = [f for f in filters if f.get("criterion") in PARTICIPANT_CRITERIA]
    temp_filters = [f for f in filters if f.get("criterion") in TEMPORAL_CRITERIA]

    matched_docs: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for d in sorted(documents, key=lambda x: (x["meeting_date"], x["doc_type"])):
        k = (d["doc_type"], d["meeting_date"])
        if k in seen:
            continue
        ok = True
        for tf in temp_filters:
            if not _match_temporal_filter(
                d["meeting_date"], str(tf.get("value") or ""), int(tf.get("year_range_span") or 5)
            ):
                ok = False
                break
        if ok and period_key and period_key != "all":
            if not _match_temporal_filter(d["meeting_date"], period_key):
                ok = False
        if ok:
            seen.add(k)
            matched_docs.append(d)

    roster: dict[str, dict[str, str]] = {}
    if any(pf.get("criterion") in ("speaker_role", "gender") for pf in part_filters):
        yrs = {int(d["meeting_date"][:4]) for d in matched_docs if len(d["meeting_date"]) >= 4}
        roster = eng.load_participants_roster(years=yrs)

    q_low = (query_text or "").strip().lower()
    sp_low = (filter_speaker or "").strip().lower()

    doc_summaries: list[dict[str, Any]] = []
    all_chunks: list[dict[str, Any]] = []
    slice_vectors: list[np.ndarray] = []
    cat_labels: list[str] = []

    for doc in matched_docs:
        dt = doc["doc_type"]
        md = doc["meeting_date"]
        chunks, _ = eng.get_document_chunks(dt, md, limit=50000, offset=0)
        if not chunks:
            continue

        rel_rows = eng.load_relevance_slice(dt, md)
        rel_by_id = {r["chunk_id"]: r["p_relevant"] for r in rel_rows}

        raw_mat, raw_labels, _ = _extract_raw_matrix_for_source(
            dt, md, data_source, settings=settings
        )
        proj_mat = np.empty((0, 0), dtype=np.float32)
        if raw_mat.size > 0:
            proj_mat, proj_labels = project_matrix_granularity(
                raw_mat, raw_labels, granularity=granularity, macro_category=macro_category
            )
            if not cat_labels:
                cat_labels = proj_labels

        indexed_chunks: list[tuple[int, dict[str, Any]]] = []
        for idx, ch in enumerate(chunks):
            ok = True
            for pf in part_filters:
                if _participant_group_key(ch, str(pf["criterion"]), roster) != str(pf["value"]):
                    ok = False
                    break
            if ok:
                indexed_chunks.append((idx, ch))

        if not indexed_chunks:
            continue

        if slice_index is not None and n_partitions > 1:
            total_n = len(indexed_chunks)
            edges = np.linspace(0, total_n, n_partitions + 1, dtype=int)
            s_i = min(max(slice_index - 1, 0), n_partitions - 1)
            start_i = int(edges[s_i])
            end_i = int(edges[s_i + 1])
            if end_i <= start_i and start_i < total_n:
                end_i = start_i + 1
            indexed_chunks = indexed_chunks[start_i:end_i]

        if not indexed_chunks:
            continue

        if proj_mat.size > 0:
            valid_rows = [proj_mat[idx] for idx, _ in indexed_chunks if idx < proj_mat.shape[0]]
            if valid_rows:
                slice_vectors.append(np.mean(np.vstack(valid_rows), axis=0).astype(np.float32))

        doc_matched_count = 0
        for idx, ch in indexed_chunks:
            sp_name = ch.get("speaker") or ""
            txt = ch.get("text_content") or ""
            if sp_low and sp_low not in sp_name.lower():
                continue
            if q_low and q_low not in txt.lower() and q_low not in sp_name.lower():
                continue

            top_topic_label = None
            top_topic_score = None
            if proj_mat.size > 0 and idx < proj_mat.shape[0] and cat_labels:
                row_vec = proj_mat[idx]
                best_j = int(np.argmax(row_vec))
                top_topic_label = format_label(cat_labels[best_j])
                top_topic_score = round(float(row_vec[best_j]), 4)

            doc_matched_count += 1
            all_chunks.append(
                {
                    "chunk_id": ch["chunk_id"],
                    "meeting_date": md,
                    "doc_type": dt,
                    "doc_type_label": format_doc_type(dt),
                    "sequence_num": ch.get("sequence_num", 0),
                    "speaker": sp_name,
                    "speaker_role": ch.get("speaker_role", ""),
                    "text_content": txt,
                    "p_relevant": rel_by_id.get(ch["chunk_id"]),
                    "top_topic_label": top_topic_label,
                    "top_topic_score": top_topic_score,
                }
            )

        if doc_matched_count > 0:
            doc_summaries.append(
                {
                    "document_id": f"{dt}::{md}",
                    "doc_type": dt,
                    "doc_type_label": format_doc_type(dt),
                    "meeting_date": md,
                    "chunk_count": doc_matched_count,
                }
            )

    top_categories: list[dict[str, Any]] = []
    if slice_vectors and cat_labels:
        mean_vec = np.mean(np.vstack(slice_vectors), axis=0, keepdims=True)
        trans_vec = transform_matrix(mean_vec, metric=metric, normalization=norm_clean)[0]
        ranked = sorted(
            [
                {
                    "id": cat_labels[i],
                    "label": format_label(cat_labels[i]),
                    "score": round(float(trans_vec[i]), 4),
                }
                for i in range(len(cat_labels))
            ],
            key=lambda x: x["score"],
            reverse=True,
        )
        top_categories = ranked[:6]

    total_chunks_matched = len(all_chunks)
    paged_chunks = all_chunks[offset : offset + limit]

    return {
        "doc_count": len(doc_summaries),
        "total_chunks_matched": total_chunks_matched,
        "slice_index": slice_index,
        "n_partitions": n_partitions,
        "top_categories": top_categories,
        "documents": doc_summaries,
        "chunks": paged_chunks,
        "limit": limit,
        "offset": offset,
    }


def format_chronological_csv(compare_payload: dict[str, Any]) -> str:
    """Serialize a full chronological comparison payload to research-ready CSV.

    Exports all cohorts, all chronological meetings/periods, and all sequential
    slices (1..S) in strict chronological order with full floating-point precision.
    """
    categories = compare_payload.get("categories") or []
    ticks = compare_payload.get("time_ticks") or []
    cohorts = compare_payload.get("ordered_series") or []
    metric_transform = str(compare_payload.get("metric") or "cosine")
    normalization = str(compare_payload.get("normalization") or "none")

    buf = io.StringIO()
    writer = csv.writer(buf)
    header = [
        "cohort",
        "year",
        "period_or_date",
        "slice_index",
        "total_slices",
        "doc_count",
        "chunk_count",
        "metric_transform",
        "normalization",
        *[str(c["id"]) for c in categories],
    ]
    writer.writerow(header)

    sorted_cohorts = sorted(cohorts, key=lambda c: str(c.get("label") or ""))
    indexed_ticks = sorted(
        enumerate(ticks),
        key=lambda pair: (
            int(pair[1].get("year") or 0),
            str(pair[1].get("period_key") or ""),
            int(pair[1].get("slice_index") or 1),
        ),
    )

    for cohort in sorted_cohorts:
        c_label = str(cohort.get("label") or "All Selected Meetings")
        vals_by_topic = cohort.get("values_by_topic") or []
        t_meta_list = cohort.get("tick_meta") or []

        for t_idx, tk in indexed_ticks:
            row_scores = [
                vals_by_topic[c_i][t_idx]
                if c_i < len(vals_by_topic) and t_idx < len(vals_by_topic[c_i])
                else None
                for c_i in range(len(categories))
            ]
            if all(v is None for v in row_scores):
                continue

            meta = t_meta_list[t_idx] if t_idx < len(t_meta_list) and t_meta_list[t_idx] else {}
            doc_count = int(meta.get("doc_count") or len(meta.get("documents") or []))
            chunk_count = int(meta.get("chunk_count") or 0)
            period_or_date = str(tk.get("period_key") or tk.get("meeting_date") or tk.get("period_label") or "")

            writer.writerow(
                [
                    c_label,
                    int(tk.get("year") or 0),
                    period_or_date,
                    int(tk.get("slice_index") or 1),
                    int(tk.get("total_slices") or 1),
                    doc_count,
                    chunk_count,
                    metric_transform,
                    normalization,
                    *["" if v is None else repr(float(v)) for v in row_scores],
                ]
            )

    return buf.getvalue()
