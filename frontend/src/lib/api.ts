/** Typed HTTP client for the MiningFOMC V4 FastAPI backend. */

import type {
  AdminActivityItem,
  AggregationMethod,
  AuthTokenResponse,
  ClassificationInspectorResponse,
  CombineByMode,
  CompareDocumentRef,
  CompareResponse,
  CorpusStats,
  DataSourceMode,
  DocTypeOption,
  FavoriteItem,
  FavoriteList,
  FixRequestItem,
  FixRequestKind,
  GranularityMode,
  GroupingTreeConfig,
  MeetingBundleResponse,
  MetricTransform,
  NormalizationMode,
  NotificationItem,
  PathFilterItem,
  RegistrationResponse,
  SearchHistoryItem,
  SearchResponse,
  SimilarityMatrixResponse,
  SliceInspectResponse,
  SpeakerSuggestion,
  SplitLevelConfig,
  StudyConfig,
  StudyItem,
  SubGroupByMode,
  TaxonomyResponse,
  TreePreviewResponse,
  UserPublic,
} from "../types/api";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
const TOKEN_KEY = "miningfomc_jwt_token";

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const err = await res.json();
      if (typeof err?.detail === "string") detail = err.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      sp.set(k, String(v));
    }
  });
  const encoded = sp.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  getStats: () => request<CorpusStats>("/api/stats"),
  getTaxonomy: () => request<TaxonomyResponse>("/api/taxonomy"),
  getDocTypes: () => request<{ doc_types: DocTypeOption[] }>("/api/doc-types"),

  autocompleteSpeakers: (q: string, limit = 15) =>
    request<{ query: string; items: SpeakerSuggestion[] }>(
      `/api/speakers/autocomplete${qs({ q, limit })}`
    ),

  searchDocuments: (params: {
    date_from?: string;
    date_to?: string;
    meeting_date?: string;
    speaker?: string;
    gender?: string;
    doc_type?: string;
    query_text?: string;
    use_regex?: boolean;
    filter_category?: string;
    filter_metric?: MetricTransform;
    filter_normalization?: NormalizationMode;
    filter_min_score?: number;
    limit?: number;
    offset?: number;
  }) => request<SearchResponse>(`/api/explorer/search${qs(params)}`),

  getMeetingBundle: (meetingDate: string, primaryDocType?: string) =>
    request<MeetingBundleResponse>(
      `/api/explorer/meetings/${encodeURIComponent(meetingDate)}${qs({
        primary_doc_type: primaryDocType,
      })}`
    ),

  getZeroShot: (
    docType: string,
    meetingDate: string,
    params?: { speaker?: string; chunk_id?: string }
  ) =>
    request<ClassificationInspectorResponse>(
      `/api/explorer/documents/${encodeURIComponent(docType)}/${encodeURIComponent(
        meetingDate
      )}/zero-shot${qs(params || {})}`
    ),

  getRelevance: (
    docType: string,
    meetingDate: string,
    params?: { speaker?: string; chunk_id?: string }
  ) =>
    request<ClassificationInspectorResponse>(
      `/api/explorer/documents/${encodeURIComponent(docType)}/${encodeURIComponent(
        meetingDate
      )}/relevance${qs(params || {})}`
    ),

  getSimilarityMatrix: (
    docType: string,
    meetingDate: string,
    params: {
      metric: MetricTransform;
      normalization: NormalizationMode;
      granularity: GranularityMode;
      macro_category?: string;
    }
  ) =>
    request<SimilarityMatrixResponse>(
      `/api/explorer/documents/${encodeURIComponent(docType)}/${encodeURIComponent(
        meetingDate
      )}/similarity${qs(params)}`
    ),

  previewGroupingTree: (body: {
    documents: CompareDocumentRef[];
    split_levels: SplitLevelConfig[];
    hidden_node_ids: string[];
  }) =>
    request<TreePreviewResponse>("/api/comparator/tree-preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  inspectSlice: (body: {
    documents: CompareDocumentRef[];
    path_filters?: PathFilterItem[];
    period_key?: string | null;
    slice_index?: number | null;
    n_partitions?: number;
    query_text?: string;
    filter_speaker?: string;
    data_source?: DataSourceMode;
    metric?: MetricTransform;
    normalization?: NormalizationMode;
    granularity?: GranularityMode;
    macro_category?: string | null;
    limit?: number;
    offset?: number;
  }) =>
    request<SliceInspectResponse>("/api/comparator/inspect-slice", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  compareDocuments: (body: {
    documents: CompareDocumentRef[];
    n_partitions: number;
    data_source: DataSourceMode;
    metric: MetricTransform;
    normalization: NormalizationMode;
    granularity: GranularityMode;
    macro_category?: string | null;
    combine_by?: CombineByMode;
    sub_group_by?: SubGroupByMode;
    agg_method?: AggregationMethod;
    year_range_span?: number;
    grouping_tree?: GroupingTreeConfig | null;
  }) =>
    request<CompareResponse>("/api/comparator/compare", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Collaborative Studies (Portfolio & Community)
  listPortfolio: () => request<{ items: StudyItem[] }>("/api/studies/portfolio"),
  listCommunity: () => request<{ items: StudyItem[] }>("/api/studies/community"),
  getStudy: (studyId: number) => request<StudyItem>(`/api/studies/${studyId}`),

  createStudy: (body: {
    title: string;
    description: string;
    config: StudyConfig;
    is_public?: boolean;
  }) =>
    request<StudyItem>("/api/studies", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateStudy: (
    studyId: number,
    patch: {
      title?: string;
      description?: string;
      config?: StudyConfig;
      is_public?: boolean;
    }
  ) =>
    request<StudyItem>(`/api/studies/${studyId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteStudy: (studyId: number) =>
    request<void>(`/api/studies/${studyId}`, { method: "DELETE" }),

  forkStudy: (
    studyId: number,
    body: { title?: string; description?: string; config?: StudyConfig }
  ) =>
    request<StudyItem>(`/api/studies/${studyId}/fork`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // Feedback, Fix Requests & Notifications
  submitFixRequest: (body: {
    kind: FixRequestKind;
    doc_type: string;
    meeting_date: string;
    original_table_id?: string;
    chunk_text?: string;
    original_distribution?: Record<string, unknown>;
    proposed_distribution?: Record<string, unknown>;
    user_note: string;
  }) =>
    request<FixRequestItem>("/api/feedback/requests", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listNotifications: () =>
    request<{ items: NotificationItem[]; unread_count: number }>("/api/notifications"),

  markNotificationRead: (notifId: number) =>
    request<{ ok: boolean }>(`/api/notifications/${notifId}/read`, { method: "PATCH" }),

  markAllNotificationsRead: () =>
    request<{ ok: boolean }>("/api/notifications/read-all", { method: "POST" }),

  // Auth
  register: (email: string, username: string, password: string) =>
    request<RegistrationResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, username, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthTokenResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  getMe: () => request<UserPublic>("/api/auth/me"),

  // Admin
  adminListUsers: () => request<UserPublic[]>("/api/admin/users"),

  adminUpdateUser: (
    userId: number,
    patch: {
      email?: string;
      username?: string;
      role?: "user" | "admin";
      status?: "pending" | "active" | "disabled";
      new_password?: string;
    }
  ) =>
    request<UserPublic>(`/api/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  adminDeleteUser: (userId: number) =>
    request<void>(`/api/admin/users/${userId}`, { method: "DELETE" }),

  adminGetActivity: () =>
    request<{ items: AdminActivityItem[] }>("/api/admin/activity"),

  adminListFixRequests: () =>
    request<{ items: FixRequestItem[] }>("/api/admin/fix-requests"),

  adminResolveFixRequest: (
    fixId: number,
    decision: "accepted" | "rejected",
    admin_comment: string
  ) =>
    request<{ fix_request: FixRequestItem; ledger_path: string | null }>(
      `/api/admin/fix-requests/${fixId}/resolve`,
      {
        method: "POST",
        body: JSON.stringify({ decision, admin_comment }),
      }
    ),

  // Favorite Lists
  getFavoriteLists: () => request<FavoriteList[]>("/api/favorites/lists"),

  createFavoriteList: (name: string, description = "") =>
    request<FavoriteList>("/api/favorites/lists", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),

  updateFavoriteList: (listId: number, patch: { name?: string; description?: string }) =>
    request<FavoriteList>(`/api/favorites/lists/${listId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteFavoriteList: (listId: number) =>
    request<void>(`/api/favorites/lists/${listId}`, { method: "DELETE" }),

  addFavoriteItem: (listId: number, meetingDate: string, docType: string, note = "") =>
    request<FavoriteItem>(`/api/favorites/lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify({ meeting_date: meetingDate, doc_type: docType, note }),
    }),

  removeFavoriteItem: (listId: number, itemId: number) =>
    request<void>(`/api/favorites/lists/${listId}/items/${itemId}`, { method: "DELETE" }),

  // Persistent Search History
  getHistory: () => request<SearchHistoryItem[]>("/api/history"),

  addHistory: (kind: "search" | "document", label: string, payload: Record<string, unknown>) =>
    request<SearchHistoryItem>("/api/history", {
      method: "POST",
      body: JSON.stringify({ kind, label, payload }),
    }),

  clearHistory: () => request<void>("/api/history", { method: "DELETE" }),
};
