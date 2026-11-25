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
  CustomFilter,
  DataSourceMode,
  DbVersionsResponse,
  DocTypeOption,
  DocumentChunk,
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
  StudyType,
  SubGroupByMode,
  TaxonomyResponse,
  TreePreviewResponse,
  UserPublic,
} from "../types/api";
import {
  isCancelled,
  pushQueueStatus,
  resetQueueStatus,
} from "./queueStatus";

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

const RETRY_MAX_ATTEMPTS = 6;
const RETRY_MIN_DELAY_MS = 800;
const RETRY_MAX_DELAY_MS = 8000;
const RETRY_JITTER_MS = 250;
const QUEUE_GATE_HEADER = "X-Query-Gate";

export class ApiError extends Error {
  status: number;
  gate?: string;
  position?: number;
  etaS?: number;

  constructor(
    message: string,
    status: number,
    meta: { gate?: string; position?: number; etaS?: number } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.gate = meta.gate;
    this.position = meta.position;
    this.etaS = meta.etaS;
  }
}

function readIntHeader(res: Response, name: string): number | undefined {
  const raw = res.headers.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function readErrorDetail(res: Response): Promise<string> {
  let detail = `Request failed (${res.status})`;
  try {
    const err = await res.json();
    if (typeof err?.detail === "string") detail = err.detail;
  } catch {
    // ignore
  }
  return detail;
}

function retryDelayMs(retryAfterS: number | undefined, attempt: number): number {
  const base = Math.max((retryAfterS ?? 0) * 1000, RETRY_MIN_DELAY_MS);
  const backoff = Math.min(base * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
  return backoff + Math.random() * RETRY_JITTER_MS;
}

async function waitBeforeRetry(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!isCancelled() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now())));
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const res = await doFetch(path, init);
    const gate = res.headers.get(QUEUE_GATE_HEADER);

    if (res.status === 503 && gate !== null) {
      const position = readIntHeader(res, "X-Queue-Position") ?? 0;
      const etaS = readIntHeader(res, "X-Queue-Eta-S") ?? 0;
      if (attempt >= RETRY_MAX_ATTEMPTS) {
        resetQueueStatus();
        throw new ApiError(
          "El servidor sigue ocupado con otros cálculos. Intenta de nuevo en unos instantes.",
          503,
          { gate, position, etaS }
        );
      }
      pushQueueStatus({
        active: true,
        gate,
        position,
        etaS,
        attempt: attempt + 1,
        maxAttempts: RETRY_MAX_ATTEMPTS,
        cancelled: false,
      });
      await waitBeforeRetry(retryDelayMs(readIntHeader(res, "Retry-After"), attempt));
      if (isCancelled()) {
        resetQueueStatus();
        throw new ApiError("Consulta cancelada por el usuario", 499);
      }
      continue;
    }

    if (!res.ok) {
      const detail = await readErrorDetail(res);
      const position = readIntHeader(res, "X-Queue-Position");
      const etaS = readIntHeader(res, "X-Queue-Eta-S");
      resetQueueStatus();
      throw new ApiError(detail, res.status, {
        gate: gate ?? undefined,
        position,
        etaS,
      });
    }

    resetQueueStatus();
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }
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
  getDbVersions: () => request<DbVersionsResponse>("/api/db-versions"),
  selectDbVersion: (version: string) =>
    request<DbVersionsResponse>("/api/db-versions/select", {
      method: "POST",
      body: JSON.stringify({ version }),
    }),
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
    doc_types?: string[];
    query_text?: string;
    use_regex?: boolean;
    filter_category?: string;
    filter_metric?: MetricTransform;
    filter_normalization?: NormalizationMode;
    filter_min_score?: number;
    filter_zs_category?: string;
    filter_zs_min_prob?: number;
    filter_rel_class?: "relevant" | "irrelevant";
    filter_rel_min_prob?: number;
    sql_filter?: string;
    limit?: number;
    offset?: number;
  }) => {
    const { doc_types, ...rest } = params;
    const effectiveDocType =
      doc_types && doc_types.length > 0 ? doc_types.join(",") : rest.doc_type;
    return request<SearchResponse>(
      `/api/explorer/search${qs({ ...rest, doc_type: effectiveDocType })}`
    );
  },

  getDocumentChunks: (
    docType: string,
    meetingDate: string,
    params?: { speaker?: string; chunk_ids?: string[]; limit?: number; offset?: number }
  ) => {
    const chunkIdsStr =
      params?.chunk_ids && params.chunk_ids.length > 0
        ? params.chunk_ids.join(",")
        : undefined;
    return request<{
      document_id: string;
      doc_type: string;
      doc_type_label: string;
      meeting_date: string;
      chunks: DocumentChunk[];
      total: number;
      limit: number;
      offset: number;
    }>(
      `/api/explorer/documents/${encodeURIComponent(docType)}/${encodeURIComponent(
        meetingDate
      )}/chunks${qs({
        speaker: params?.speaker,
        chunk_ids: chunkIdsStr,
        limit: params?.limit,
        offset: params?.offset,
      })}`
    );
  },

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
    node_splits?: Record<string, SplitLevelConfig>;
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
    config: StudyConfig | Record<string, unknown>;
    is_public?: boolean;
    study_type?: StudyType;
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
      config?: StudyConfig | Record<string, unknown>;
      is_public?: boolean;
      study_type?: StudyType;
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

  // Custom SQL Filters
  listMyFilters: () => request<{ items: CustomFilter[] }>("/api/filters/portfolio"),
  listCommunityFilters: () => request<{ items: CustomFilter[] }>("/api/filters/community"),

  createFilter: (body: {
    title: string;
    description: string;
    sql_text: string;
    is_public: boolean;
  }) =>
    request<CustomFilter>("/api/filters", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addFilterToMe: (id: number) =>
    request<CustomFilter>(`/api/filters/${id}/add`, { method: "POST" }),

  updateFilter: (
    id: number,
    patch: { title?: string; description?: string; is_public?: boolean }
  ) =>
    request<CustomFilter>(`/api/filters/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteFilter: (id: number) => request<void>(`/api/filters/${id}`, { method: "DELETE" }),

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
