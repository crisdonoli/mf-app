"""Explorer, Corpus Stats, Speaker Autocomplete, Relevance, and Taxonomy API endpoints.

Landing endpoints (/health, /stats) are public; all analytical corpus endpoints
require an authenticated, active researcher session.
"""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth.security import get_current_user
from ..config import get_settings, switch_active_db_version
from ..core import (
    clear_speaker_catalog_cache,
    get_corpus_stats,
    get_document_chunks,
    get_meeting_bundle,
    get_similarity_matrix,
    get_taxonomy_payload,
    list_available_doc_types,
    search_documents,
    search_speakers,
)
from ..core.fomc_service import get_classification_inspector
from .deps_gate import corpus_query_slot

router = APIRouter(prefix="/api", tags=["Explorer & Corpus"])


class SelectDbVersionRequest(BaseModel):
    version: str


@router.get("/health")
def health_check():
    """Service liveness and full Parquet dataset discovery diagnostics."""
    cfg = get_settings()
    stats = get_corpus_stats()
    return {
        "status": "ok",
        "engine": stats["engine"],
        "parquet_files": stats["parquet_files"],
        "db_version": cfg.resolve_db_version_info(),
        "available_db_versions": cfg.discover_available_db_versions(),
        "datasets": cfg.get_dataset_diagnostics(),
    }


@router.get("/stats")
def corpus_stats(_gate: None = Depends(corpus_query_slot)):
    """Return high-level corpus statistics for the public Landing Page."""
    cfg = get_settings()
    stats = get_corpus_stats()
    stats["db_version"] = cfg.resolve_db_version_info()
    stats["available_db_versions"] = cfg.discover_available_db_versions()
    return stats


@router.get("/db-versions")
def list_db_versions():
    """Dynamically list all FOMC database versions present in the repository."""
    cfg = get_settings()
    return {
        "active": cfg.resolve_db_version_info(),
        "versions": cfg.discover_available_db_versions(),
    }


@router.post("/db-versions/select")
def select_db_version(body: SelectDbVersionRequest):
    """Switch the active FOMC database version dynamically across the application."""
    try:
        active_info = switch_active_db_version(body.version)
        clear_speaker_catalog_cache()
        cfg = get_settings()
        return {
            "active": active_info,
            "versions": cfg.discover_available_db_versions(),
            "stats": get_corpus_stats(),
        }
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/taxonomy")
def taxonomy(_user: dict = Depends(get_current_user)):
    return get_taxonomy_payload(get_settings().taxonomy_path)


@router.get("/doc-types")
def doc_types(_user: dict = Depends(get_current_user)):
    return {"doc_types": list_available_doc_types()}


@router.get("/speakers/autocomplete")
def speakers_autocomplete(
    q: str = Query(default="", max_length=120),
    limit: int = Query(default=15, ge=1, le=50),
    _user: dict = Depends(get_current_user),
):
    """Fast type-ahead speaker suggestions backed by participants.parquet & participants_report.json."""
    return search_speakers(query=q, limit=limit)


@router.get("/explorer/search")
def explorer_search(
    date_from: Optional[str] = Query(default=None),
    date_to: Optional[str] = Query(default=None),
    meeting_date: Optional[str] = Query(default=None),
    speaker: Optional[str] = Query(default=None),
    gender: Optional[str] = Query(default=None),
    doc_type: Optional[str] = Query(default=None),
    doc_types: Optional[list[str]] = Query(default=None),
    query_text: Optional[str] = Query(default=None),
    use_regex: bool = Query(default=False),
    filter_category: Optional[str] = Query(default=None),
    filter_metric: Literal["cosine", "softmax", "log"] = Query(default="cosine"),
    filter_normalization: Literal["none", "topic", "slice", "row", "column"] = Query(default="none"),
    filter_min_score: Optional[float] = Query(default=None),
    filter_zs_category: Optional[str] = Query(default=None),
    filter_zs_min_prob: Optional[float] = Query(default=None),
    filter_rel_class: Optional[Literal["relevant", "irrelevant"]] = Query(default=None),
    filter_rel_min_prob: Optional[float] = Query(default=None),
    limit: int = Query(default=25, ge=1, le=2000),
    offset: int = Query(default=0, ge=0),
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(corpus_query_slot),
):
    parsed_doc_types: list[str] = []
    if doc_types:
        for dt in doc_types:
            for part in dt.split(","):
                clean = part.strip()
                if clean and clean not in parsed_doc_types:
                    parsed_doc_types.append(clean)
    if doc_type:
        for part in doc_type.split(","):
            clean = part.strip()
            if clean and clean not in parsed_doc_types:
                parsed_doc_types.append(clean)

    return search_documents(
        date_from=date_from,
        date_to=date_to,
        meeting_date=meeting_date,
        speaker=speaker,
        gender=gender,
        doc_type=parsed_doc_types[0] if len(parsed_doc_types) == 1 else None,
        doc_types=parsed_doc_types if parsed_doc_types else None,
        query_text=query_text,
        use_regex=use_regex,
        filter_category=filter_category,
        filter_metric=filter_metric,
        filter_normalization=filter_normalization,
        filter_min_score=filter_min_score,
        filter_zs_category=filter_zs_category,
        filter_zs_min_prob=filter_zs_min_prob,
        filter_rel_class=filter_rel_class,
        filter_rel_min_prob=filter_rel_min_prob,
        limit=limit,
        offset=offset,
    )


@router.get("/explorer/meetings/{meeting_date}")
def meeting_bundle(
    meeting_date: str,
    primary_doc_type: Optional[str] = Query(default=None),
    preview_limit: int = Query(default=80, ge=1, le=500),
    _user: dict = Depends(get_current_user),
):
    return get_meeting_bundle(
        meeting_date, primary_doc_type=primary_doc_type, preview_limit=preview_limit
    )


@router.get("/explorer/documents/{doc_type}/{meeting_date}/chunks")
def document_chunks(
    doc_type: str,
    meeting_date: str,
    speaker: Optional[str] = Query(default=None),
    chunk_ids: Optional[str] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(corpus_query_slot),
):
    parsed_ids = [c.strip() for c in chunk_ids.split(",") if c.strip()] if chunk_ids else None
    return get_document_chunks(
        doc_type,
        meeting_date,
        speaker=speaker,
        chunk_ids=parsed_ids,
        limit=limit,
        offset=offset,
    )


@router.get("/explorer/documents/{doc_type}/{meeting_date}/zero-shot")
def document_zero_shot(
    doc_type: str,
    meeting_date: str,
    speaker: Optional[str] = Query(default=None),
    chunk_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(corpus_query_slot),
):
    """Inspect zero-shot 13 macro-category and sub-class predictions."""
    return get_classification_inspector(
        doc_type, meeting_date, mode="zero_shot", speaker=speaker, chunk_id=chunk_id
    )


@router.get("/explorer/documents/{doc_type}/{meeting_date}/relevance")
def document_relevance(
    doc_type: str,
    meeting_date: str,
    speaker: Optional[str] = Query(default=None),
    chunk_id: Optional[str] = Query(default=None),
    _user: dict = Depends(get_current_user),
):
    """Inspect Relevant vs. Irrelevant probabilities (reusing the generalized inspector)."""
    return get_classification_inspector(
        doc_type, meeting_date, mode="relevance", speaker=speaker, chunk_id=chunk_id
    )


@router.get("/explorer/documents/{doc_type}/{meeting_date}/similarity")
def document_similarity(
    doc_type: str,
    meeting_date: str,
    metric: Literal["cosine", "softmax", "log"] = Query(default="cosine"),
    normalization: Literal["none", "topic", "slice", "row", "column"] = Query(default="none"),
    granularity: Literal["macro", "subclass"] = Query(default="macro"),
    macro_category: Optional[str] = Query(default=None),
    max_chunks: int = Query(default=250, ge=10, le=1000),
    _user: dict = Depends(get_current_user),
    _gate: None = Depends(corpus_query_slot),
):
    return get_similarity_matrix(
        doc_type,
        meeting_date,
        metric=metric,
        normalization=normalization,
        granularity=granularity,
        macro_category=macro_category,
        max_chunks=max_chunks,
    )
