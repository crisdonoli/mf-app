"""Document Comparator, Grouping Tree Preview, and Slice Drill-Down API endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse

from ..auth.security import get_current_user
from ..core import compare_documents
from ..core.grouping_tree import (
    build_grouping_tree_preview,
    compare_ungrouped_chronological,
    compare_with_grouping_tree,
    format_chronological_csv,
    inspect_slice_or_node,
)
from ..schemas import CompareRequest, SliceInspectRequest, SplitLevelConfig, TreePreviewRequest
from .deps_gate import heavy_query_slot

router = APIRouter(prefix="/api/comparator", tags=["Comparator"])


def _serialize_split_level(lvl: SplitLevelConfig) -> dict:
    return {
        "criterion": lvl.criterion,
        "year_range_span": lvl.year_range_span,
        "custom_ranges": [
            {"start": r.start, "end": r.end, "label": r.label}
            for r in (lvl.custom_ranges or [])
        ],
    }


@router.post("/tree-preview")
def preview_grouping_tree(
    body: TreePreviewRequest,
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(heavy_query_slot),
):
    """Compute hierarchical Grouping Tree counts and visible leaf availability (>= 1)."""
    docs = [{"doc_type": d.doc_type, "meeting_date": d.meeting_date} for d in body.documents]
    levels = [_serialize_split_level(lvl) for lvl in body.split_levels]
    node_splits = {
        nid: _serialize_split_level(cfg)
        for nid, cfg in (body.node_splits or {}).items()
    }
    return build_grouping_tree_preview(
        docs,
        levels,
        hidden_node_ids=body.hidden_node_ids,
        node_splits=node_splits,
    )


@router.post("/inspect-slice")
def inspect_comparator_slice(
    body: SliceInspectRequest,
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(heavy_query_slot),
):
    """Inspect documents and chunks belonging to any clicked tree node or time-series point."""
    docs = [{"doc_type": d.doc_type, "meeting_date": d.meeting_date} for d in body.documents]
    return inspect_slice_or_node(
        docs,
        path_filters=body.path_filters,
        period_key=body.period_key,
        slice_index=body.slice_index,
        n_partitions=body.n_partitions,
        query_text=body.query_text,
        filter_speaker=body.filter_speaker,
        data_source=body.data_source,
        metric=body.metric,
        normalization=body.normalization,
        granularity=body.granularity,
        macro_category=body.macro_category,
        limit=body.limit,
        offset=body.offset,
    )


@router.post("/compare")
def compare_fomc_documents(
    body: CompareRequest,
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(heavy_query_slot),
):
    """Standardize, optionally combine via Grouping Tree, and flatten chronologically across M x S slices."""
    docs = [
        {"doc_type": d.doc_type, "meeting_date": d.meeting_date}
        for d in body.documents
    ]
    has_tree_config = body.grouping_tree is not None and (
        body.combine_by == "tree"
        or len(body.grouping_tree.split_levels) > 0
        or len(body.grouping_tree.node_splits) > 0
    )
    if has_tree_config and body.grouping_tree is not None:
        levels = [_serialize_split_level(lvl) for lvl in body.grouping_tree.split_levels]
        node_splits = {
            nid: _serialize_split_level(cfg)
            for nid, cfg in (body.grouping_tree.node_splits or {}).items()
        }
        try:
            return compare_with_grouping_tree(
                docs,
                levels,
                hidden_node_ids=body.grouping_tree.hidden_node_ids,
                node_splits=node_splits,
                n_partitions=body.n_partitions,
                data_source=body.data_source,
                metric=body.metric,
                normalization=body.normalization,
                granularity=body.granularity,
                macro_category=body.macro_category,
                agg_method=body.agg_method,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if body.combine_by in ("none", "tree"):
        return compare_ungrouped_chronological(
            docs,
            n_partitions=body.n_partitions,
            data_source=body.data_source,
            metric=body.metric,
            normalization=body.normalization,
            granularity=body.granularity,
            macro_category=body.macro_category,
        )

    return compare_documents(
        docs,
        n_partitions=body.n_partitions,
        data_source=body.data_source,
        metric=body.metric,
        normalization=body.normalization,
        granularity=body.granularity,
        macro_category=body.macro_category,
        combine_by=body.combine_by,
        sub_group_by=body.sub_group_by,
        agg_method=body.agg_method,
        year_range_span=body.year_range_span,
    )


@router.post("/export-csv")
def export_comparator_csv(
    body: CompareRequest,
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(heavy_query_slot),
):
    """Export the full flattened chronological dataset across all cohorts, periods, and slices as CSV."""
    payload = compare_fomc_documents(body, _user)
    csv_text = format_chronological_csv(payload)
    fname = f"miningfomc_chronological_{body.metric}_{body.normalization}.csv"
    return PlainTextResponse(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
