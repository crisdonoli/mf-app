"""Vectorized NumPy matrix transformation and temporal chunk partitioning engine.

Single source of truth for all similarity/score transformations and N-partition
chunk standardization shared between the Document Explorer and Document Comparator.
All operations run strictly on the queried document slice (zero full-corpus RAM load).

Matrix Orientation Convention:
- Input ``matrix`` has shape ``(n_slices, n_topics)``.
- ``normalization == "slice"`` normalizes across topics within each slice (axis=1).
- ``normalization == "topic"`` normalizes across slices within each topic (axis=0).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

import numpy as np

from .taxonomy import (
    LEAF_TO_MACRO,
    MACRO_CATEGORIES,
    SUBCLASS_HIERARCHY,
)

MetricTransform = Literal["cosine", "softmax", "log"]
NormalizationMode = Literal["none", "topic", "slice", "time", "row", "column"]

_EPS = 1e-8


@dataclass(frozen=True)
class PartitionResult:
    """Result of dividing sequential chunks into N equal temporal partitions."""

    matrix: np.ndarray  # shape: (n_actual_partitions, n_classes)
    n_requested: int
    n_actual: int
    total_chunks: int
    partition_ranges: list[tuple[int, int]]  # inclusive-start, exclusive-end chunk indices


def normalize_mode_alias(normalization: str) -> Literal["none", "topic", "slice"]:
    """Map legacy ``row``/``column`` and ``time`` aliases to canonical ``slice``/``topic`` names."""
    if normalization in ("slice", "time", "row"):
        return "slice"
    if normalization in ("topic", "column"):
        return "topic"
    return "none"


def transform_matrix(
    matrix: np.ndarray,
    metric: MetricTransform = "cosine",
    normalization: NormalizationMode = "none",
    temperature: float = 0.25,
) -> np.ndarray:
    """Apply metric transformation and optional Topic or Slice normalization.

    Parameters
    ----------
    matrix:
        2D array of shape ``(n_slices, n_topics)`` containing raw cosine
        similarities (typically in ``[-1, 1]``) or classifier probabilities.
    metric:
        - ``"cosine"``: Identity (preserves raw cosine similarity / score).
        - ``"softmax"``: Numerically stable softmax across topics per slice (axis=1).
        - ``"log"``: Smooth monotonic log transform ``log1p(clip((x + 1) / 2, 0, None))``.
    normalization:
        - ``"none"``: No additional normalization.
        - ``"slice"`` (alias ``"row"``): Min-max normalization across topics within each slice (axis=1).
        - ``"topic"`` (alias ``"column"``): Min-max normalization across slices within each topic (axis=0).
    temperature:
        Positive temperature scalar for ``softmax`` (default ``0.25``).

    Returns
    -------
    np.ndarray
        Transformed ``float32`` matrix of shape ``(n_slices, n_topics)``.
    """
    arr = np.asarray(matrix, dtype=np.float64)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)
    if arr.size == 0:
        return arr.astype(np.float32)

    arr = np.nan_to_num(arr, nan=0.0, posinf=1.0, neginf=-1.0)

    # Step 1: Metric transform
    if metric == "cosine":
        out = arr
    elif metric == "softmax":
        if temperature <= 0:
            raise ValueError(f"temperature must be > 0, got {temperature}")
        scaled = arr / float(temperature)
        shifted = scaled - np.max(scaled, axis=1, keepdims=True)
        exp_vals = np.exp(shifted)
        denom = np.sum(exp_vals, axis=1, keepdims=True)
        out = exp_vals / np.maximum(denom, _EPS)
    elif metric == "log":
        shifted_pos = np.clip((arr + 1.0) * 0.5, 0.0, None)
        out = np.log1p(shifted_pos)
    else:
        raise ValueError(f"Unsupported metric transform: {metric!r}")

    # Step 2: Topic or Slice normalization
    norm = normalize_mode_alias(normalization)
    if norm == "none":
        pass
    elif norm == "slice":
        s_min = np.min(out, axis=1, keepdims=True)
        s_max = np.max(out, axis=1, keepdims=True)
        span = s_max - s_min
        out = np.where(span > _EPS, (out - s_min) / np.maximum(span, _EPS), 0.0)
    elif norm == "topic":
        if out.shape[0] > 1:
            t_min = np.min(out, axis=0, keepdims=True)
            t_max = np.max(out, axis=0, keepdims=True)
            span = t_max - t_min
            out = np.where(span > _EPS, (out - t_min) / np.maximum(span, _EPS), 0.0)
    else:
        raise ValueError(f"Unsupported normalization mode: {normalization!r}")

    return out.astype(np.float32, copy=False)


def partition_and_aggregate_chunks(
    matrix: np.ndarray,
    n_partitions: int = 1,
) -> PartitionResult:
    """Standardize a variable-length chunk matrix into N equal temporal partitions."""
    if n_partitions < 1:
        raise ValueError(f"n_partitions must be >= 1, got {n_partitions}")

    arr = np.asarray(matrix, dtype=np.float32)
    if arr.ndim == 1:
        arr = arr.reshape(1, -1)

    total_chunks, n_cols = arr.shape
    if total_chunks == 0:
        return PartitionResult(
            matrix=np.empty((0, n_cols), dtype=np.float32),
            n_requested=n_partitions,
            n_actual=0,
            total_chunks=0,
            partition_ranges=[],
        )

    effective_n = min(int(n_partitions), total_chunks)
    indices = np.array_split(np.arange(total_chunks), effective_n)

    aggregated = np.empty((effective_n, n_cols), dtype=np.float32)
    ranges: list[tuple[int, int]] = []
    for p_idx, idx_slice in enumerate(indices):
        start_i = int(idx_slice[0])
        end_i = int(idx_slice[-1]) + 1
        ranges.append((start_i, end_i))
        aggregated[p_idx] = np.nanmean(arr[start_i:end_i], axis=0)

    return PartitionResult(
        matrix=aggregated,
        n_requested=int(n_partitions),
        n_actual=effective_n,
        total_chunks=total_chunks,
        partition_ranges=ranges,
    )


def project_matrix_granularity(
    matrix: np.ndarray,
    column_labels: Sequence[str],
    granularity: Literal["macro", "subclass"] = "macro",
    macro_category: str | None = None,
) -> tuple[np.ndarray, list[str]]:
    """Aggregate or slice a chunk-by-class matrix to macro or sub-class granularity."""
    arr = np.asarray(matrix, dtype=np.float32)
    labels = list(column_labels)
    if arr.size == 0 or not labels:
        return arr, labels

    label_to_idx = {lbl: i for i, lbl in enumerate(labels)}

    if labels == ["relevant", "irrelevant"]:
        return arr, ["relevant", "irrelevant"]

    if granularity == "macro":
        if labels == MACRO_CATEGORIES:
            return arr, list(MACRO_CATEGORIES)

        n_rows = arr.shape[0]
        macro_mat = np.zeros((n_rows, len(MACRO_CATEGORIES)), dtype=np.float32)
        for m_idx, macro in enumerate(MACRO_CATEGORIES):
            if macro in label_to_idx:
                macro_mat[:, m_idx] = arr[:, label_to_idx[macro]]
            elif macro == "monetary_aggregates" and "gdp_activity" in label_to_idx:
                macro_mat[:, m_idx] = arr[:, label_to_idx["gdp_activity"]]
            else:
                child_indices = [
                    i for i, lbl in enumerate(labels) if LEAF_TO_MACRO.get(lbl) == macro
                ]
                if child_indices:
                    macro_mat[:, m_idx] = np.nanmean(arr[:, child_indices], axis=1)
        return macro_mat, list(MACRO_CATEGORIES)

    if macro_category:
        wanted_subs = SUBCLASS_HIERARCHY.get(macro_category, [])
        present_subs = [s for s in wanted_subs if s in label_to_idx]
        if present_subs:
            idxs = [label_to_idx[s] for s in present_subs]
            return arr[:, idxs], present_subs
        if macro_category == "monetary_aggregates" and "gdp_activity" in label_to_idx:
            return arr[:, [label_to_idx["gdp_activity"]]], ["gdp_activity"]
        if macro_category in label_to_idx:
            return arr[:, [label_to_idx[macro_category]]], [macro_category]
        mapped = [i for i, lbl in enumerate(labels) if LEAF_TO_MACRO.get(lbl) == macro_category]
        if mapped:
            return arr[:, mapped], [labels[i] for i in mapped]

    return arr, labels
