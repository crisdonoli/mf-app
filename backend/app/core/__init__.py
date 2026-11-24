"""Core analytical services for MiningFOMC (Single Source of Truth)."""

from .fomc_service import (
    compare_documents,
    get_corpus_stats,
    get_document_chunks,
    get_meeting_bundle,
    get_similarity_matrix,
    get_zero_shot_classifications,
    list_available_doc_types,
    search_documents,
    search_speakers,
)
from .matrix_math import (
    MetricTransform,
    NormalizationMode,
    PartitionResult,
    partition_and_aggregate_chunks,
    project_matrix_granularity,
    transform_matrix,
)
from .query_engine import clear_speaker_catalog_cache
from .taxonomy import (
    MACRO_CATEGORIES,
    SUBCLASS_HIERARCHY,
    V5_LEAF_CLASSES,
    format_doc_type,
    format_label,
    get_taxonomy_payload,
)

__all__ = [
    "MACRO_CATEGORIES",
    "SUBCLASS_HIERARCHY",
    "V5_LEAF_CLASSES",
    "MetricTransform",
    "NormalizationMode",
    "PartitionResult",
    "compare_documents",
    "format_doc_type",
    "format_label",
    "get_corpus_stats",
    "get_document_chunks",
    "get_meeting_bundle",
    "get_similarity_matrix",
    "get_taxonomy_payload",
    "get_zero_shot_classifications",
    "list_available_doc_types",
    "partition_and_aggregate_chunks",
    "project_matrix_granularity",
    "search_documents",
    "search_speakers",
    "transform_matrix",
]
