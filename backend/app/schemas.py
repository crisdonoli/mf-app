"""Typed Pydantic request and response schemas for the MiningFOMC API."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


# ------------------------------------------------------------------ Auth & User
class UserRegisterRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255)
    username: str = Field(..., min_length=2, max_length=80)
    password: str = Field(..., min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: str  # accepts email or username
    password: str


class UserPublic(BaseModel):
    id: int
    email: str
    username: str
    role: str = "user"
    status: str = "active"
    created_at: str


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class RegistrationResponse(BaseModel):
    message: str
    status: str
    user: UserPublic


# ------------------------------------------------------------------ Admin
class AdminUserUpdateRequest(BaseModel):
    email: Optional[str] = Field(default=None, min_length=5, max_length=255)
    username: Optional[str] = Field(default=None, min_length=2, max_length=80)
    role: Optional[Literal["user", "admin"]] = None
    status: Optional[Literal["pending", "active", "disabled"]] = None
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class AdminResolveFixRequest(BaseModel):
    decision: Literal["accepted", "rejected"]
    admin_comment: str = Field(default="", max_length=1000)


# ------------------------------------------------------------------ Studies (Portfolio & Community)
StudyTypeLiteral = Literal["comparator", "explorer_search", "history"]


class StudyCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    config: dict
    is_public: bool = False
    study_type: StudyTypeLiteral = "comparator"


class StudyUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    config: Optional[dict] = None
    is_public: Optional[bool] = None
    study_type: Optional[StudyTypeLiteral] = None


class StudyForkRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    config: Optional[dict] = None


# ------------------------------------------------------------------ Custom SQL Filters
class FilterCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    sql_text: str = Field(..., min_length=1, max_length=4000)
    is_public: bool = False


class FilterUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    is_public: Optional[bool] = None


# ------------------------------------------------------------------ Feedback & Fix Requests
class FixRequestCreate(BaseModel):
    kind: Literal["feedback_chunk", "feedback_similarity", "fix_zero_shot", "fix_relevance"]
    doc_type: str = Field(default="", max_length=80)
    meeting_date: str = Field(default="", max_length=20)
    original_table_id: str = Field(default="", max_length=200)
    chunk_text: str = Field(default="", max_length=4000)
    original_distribution: dict = Field(default_factory=dict)
    proposed_distribution: dict = Field(default_factory=dict)
    user_note: str = Field(default="", max_length=2000)


# ------------------------------------------------------------------ Favorites
class FavoriteListCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)


class FavoriteListUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)


class FavoriteItemCreate(BaseModel):
    meeting_date: str = Field(..., min_length=4, max_length=20)
    doc_type: str = Field(default="transcripts", max_length=80)
    note: str = Field(default="", max_length=400)


class FavoriteItemResponse(BaseModel):
    id: int
    list_id: int
    meeting_date: str
    doc_type: str
    doc_type_label: str
    note: str
    added_at: str


class FavoriteListResponse(BaseModel):
    id: int
    name: str
    description: str
    created_at: str
    items: list[FavoriteItemResponse] = []


# ------------------------------------------------------------------ Search History
class SearchHistoryCreate(BaseModel):
    kind: Literal["search", "document"] = "search"
    label: str = Field(..., min_length=1, max_length=200)
    payload: dict = Field(default_factory=dict)


class SearchHistoryEntry(BaseModel):
    id: int
    kind: str
    label: str
    payload: dict
    created_at: str


# ------------------------------------------------------------------ Comparator & Grouping Tree
class CompareDocumentRef(BaseModel):
    doc_type: str = Field(..., min_length=1, max_length=80)
    meeting_date: str = Field(..., min_length=4, max_length=20)


SplitCriterionLiteral = Literal[
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


class CustomDateRangeSpec(BaseModel):
    start: str = Field(..., min_length=4, max_length=10)
    end: str = Field(default="-", max_length=10)
    label: Optional[str] = Field(default=None, max_length=80)


class SplitLevelConfig(BaseModel):
    criterion: SplitCriterionLiteral
    year_range_span: int = Field(default=5, ge=2, le=20)
    custom_ranges: list[CustomDateRangeSpec] = Field(default_factory=list)


class GroupingTreeConfig(BaseModel):
    split_levels: list[SplitLevelConfig] = Field(default_factory=list)
    hidden_node_ids: list[str] = Field(default_factory=list)
    node_splits: dict[str, SplitLevelConfig] = Field(default_factory=dict)


class TreePreviewRequest(BaseModel):
    documents: list[CompareDocumentRef] = Field(..., min_items=1, max_items=5000)
    split_levels: list[SplitLevelConfig] = Field(default_factory=list)
    hidden_node_ids: list[str] = Field(default_factory=list)
    node_splits: dict[str, SplitLevelConfig] = Field(default_factory=dict)


class SliceInspectRequest(BaseModel):
    documents: list[CompareDocumentRef] = Field(..., min_items=1, max_items=5000)
    path_filters: list[dict] = Field(default_factory=list)
    period_key: Optional[str] = None
    slice_index: Optional[int] = Field(default=None, ge=1, le=50)
    n_partitions: int = Field(default=1, ge=1, le=50)
    query_text: Optional[str] = None
    filter_speaker: Optional[str] = None
    data_source: Literal["similarity", "zero_shot", "relevance"] = "similarity"
    metric: Literal["cosine", "softmax", "log"] = "cosine"
    normalization: Literal["none", "topic", "slice", "time", "row", "column"] = "none"
    granularity: Literal["macro", "subclass"] = "macro"
    macro_category: Optional[str] = None
    limit: int = Field(default=40, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class CompareRequest(BaseModel):
    documents: list[CompareDocumentRef] = Field(..., min_items=1, max_items=5000)
    n_partitions: int = Field(default=1, ge=1, le=50)
    data_source: Literal["similarity", "zero_shot", "relevance"] = "similarity"
    metric: Literal["cosine", "softmax", "log"] = "cosine"
    normalization: Literal["none", "topic", "slice", "time", "row", "column"] = "none"
    granularity: Literal["macro", "subclass"] = "macro"
    macro_category: Optional[str] = None
    combine_by: Literal[
        "none",
        "year",
        "year_range",
        "month",
        "quarter",
        "semester",
        "speaker",
        "speaker_role",
        "gender",
        "tree",
    ] = "none"
    sub_group_by: Literal[
        "none",
        "year",
        "semester",
        "quarter",
        "month",
        "speaker",
        "speaker_role",
        "gender",
    ] = "none"
    agg_method: Literal["mean", "median"] = "mean"
    year_range_span: int = Field(default=5, ge=2, le=20)
    grouping_tree: Optional[GroupingTreeConfig] = None


class BasketChunksRequest(BaseModel):
    documents: list[CompareDocumentRef] = Field(..., min_items=1, max_items=5000)
    data_source: Literal["similarity", "zero_shot", "relevance"] = "zero_shot"
    limit: int = Field(default=50, ge=1, le=500)
