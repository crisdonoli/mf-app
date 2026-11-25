/** Strict TypeScript API interfaces for MiningFOMC V4. */

export type MetricTransform = "cosine" | "softmax" | "log";
export type NormalizationMode = "none" | "topic" | "slice";
export type GranularityMode = "macro" | "subclass";
export type DataSourceMode = "similarity" | "zero_shot";
export type CombineByMode =
  | "none"
  | "year"
  | "year_range"
  | "month"
  | "quarter"
  | "semester"
  | "speaker"
  | "speaker_role"
  | "gender"
  | "tree";
export type SubGroupByMode =
  | "none"
  | "year"
  | "semester"
  | "quarter"
  | "month"
  | "speaker"
  | "speaker_role"
  | "gender";
export type SplitCriterion =
  | "year"
  | "year_range"
  | "custom_range"
  | "semester"
  | "quarter"
  | "month"
  | "speaker"
  | "speaker_role"
  | "gender";
export type AggregationMethod = "mean" | "median";

export interface CustomDateRangeSpec {
  start: string;
  end: string;
  label?: string;
}

export interface SplitLevelConfig {
  criterion: SplitCriterion;
  year_range_span: number;
  custom_ranges?: CustomDateRangeSpec[];
}

export interface GroupingTreeConfig {
  split_levels: SplitLevelConfig[];
  hidden_node_ids: string[];
  node_splits?: Record<string, SplitLevelConfig>;
}

export interface PathFilterItem {
  criterion: SplitCriterion;
  value: string;
  label: string;
  year_range_span?: number;
}

export interface GroupingTreeNode {
  id: string;
  label: string;
  criterion: string;
  value: string;
  level: number;
  doc_count: number;
  hidden: boolean;
  effectively_hidden: boolean;
  path_filters: PathFilterItem[];
  children: GroupingTreeNode[];
}

export interface TreePreviewResponse {
  root: GroupingTreeNode;
  total_documents: number;
  total_leaves: number;
  visible_leaf_count: number;
  valid_for_compare: boolean;
  min_available_date?: string;
  max_available_date?: string;
}

export interface TimeTickMeta {
  index: number;
  year: number;
  month: string;
  meeting_date: string;
  period_key: string;
  period_label: string;
  slice_num: number;
  slice_index: number;
  total_slices: number;
  full_label: string;
}

export interface TickInspectMeta {
  documents: CompareDocumentRef[];
  path_filters: PathFilterItem[];
  period_key: string;
  slice_index: number;
  n_partitions: number;
  doc_count?: number;
  chunk_count?: number;
}

export interface OrderedTimeSeriesCohort {
  cohort_id: string;
  label: string;
  values_by_topic: (number | null)[][]; // [topicIdx][tickIdx]
  tick_meta: (TickInspectMeta | null)[];
}

export interface SliceInspectChunk {
  chunk_id: string;
  meeting_date: string;
  doc_type: string;
  doc_type_label: string;
  sequence_num: number;
  speaker: string;
  speaker_role: string;
  text_content: string;
  p_relevant: number | null;
  top_topic_label: string | null;
  top_topic_score: number | null;
}

export interface SliceInspectResponse {
  doc_count: number;
  total_chunks_matched: number;
  slice_index: number | null;
  n_partitions: number;
  top_categories: { id: string; label: string; score: number }[];
  documents: {
    document_id: string;
    doc_type: string;
    doc_type_label: string;
    meeting_date: string;
    chunk_count: number;
  }[];
  chunks: SliceInspectChunk[];
  limit: number;
  offset: number;
}

export interface SpeakerSuggestion {
  name: string;
  search_value: string;
  role: string;
  affiliation: string;
  gender: string;
  n_turns: number;
}

export interface DocTypeOption {
  id: string;
  label: string;
  chunk_count?: number;
}

export interface DbVersionInfo {
  version: string;
  tag: string;
  fingerprint: string;
  generated_at: string;
  total_indexed_chunks?: number;
  total_human_size?: string;
  notes?: string;
  path?: string;
  active?: boolean;
}

export interface DbVersionsResponse {
  active: DbVersionInfo;
  versions: DbVersionInfo[];
  stats?: CorpusStats;
}

export interface CorpusStats {
  total_chunks: number;
  doc_types_count: number;
  doc_type_chunk_counts: Record<string, number>;
  doc_types: DocTypeOption[];
  year_min: number;
  year_max: number;
  parquet_files: number;
  similarity_partitions: number;
  macro_category_count: number;
  subclass_count: number;
  engine: string;
  db_version?: DbVersionInfo;
  available_db_versions?: DbVersionInfo[];
}

export interface SubclassItem {
  id: string;
  label: string;
  parent_id: string;
}

export interface MacroCategoryItem {
  index: number;
  id: string;
  label: string;
  short_label: string;
  definition: string;
  subclasses: SubclassItem[];
  has_subclasses: boolean;
}

export interface TaxonomyResponse {
  macro_categories: MacroCategoryItem[];
  leaf_classes: SubclassItem[];
  source_labels: string[];
}

export interface SearchDocumentItem {
  document_id: string;
  meeting_date: string;
  doc_type: string;
  doc_type_label: string;
  year: number;
  chunk_count: number;
  speaker_count: number;
  source_file: string;
  snippet: string;
  top_speakers: string[];
  matched_score?: number;
  matched_zs_prob?: number;
  matched_rel_prob?: number;
}

export interface SearchResponse {
  items: SearchDocumentItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface DocumentChunk {
  chunk_id: string;
  meeting_date: string;
  doc_type: string;
  sequence_num: number;
  section: string;
  speaker: string;
  speaker_role: string;
  district: string;
  text_content: string;
  char_count: number;
}

export interface MeetingSibling {
  document_id: string;
  doc_type: string;
  doc_type_label: string;
  meeting_date: string;
  chunk_count: number;
  source_file: string;
}

export interface MeetingBundleResponse {
  meeting_date: string;
  siblings: MeetingSibling[];
  active_doc_type: string | null;
  chunks: DocumentChunk[];
  total_chunks: number;
  speakers: string[];
}

export interface ClassificationSummaryItem {
  category_id: string;
  label: string;
  mean_score: number;
  chunk_count: number;
  share: number;
}

export interface ClassificationChunkItem {
  chunk_id: string;
  sequence_num: number;
  speaker: string;
  text_preview: string;
  predicted_macro: string;
  predicted_macro_label: string;
  predicted_subclass: string | null;
  predicted_subclass_label: string | null;
  confidence: number;
  p_relevant: number | null;
  macro_scores: Record<string, number>;
  subclass_scores: Record<string, number>;
}

export interface ClassificationInspectorResponse {
  document_id: string;
  mode: "zero_shot" | "relevance";
  available: boolean;
  total_classified: number;
  macro_summary: ClassificationSummaryItem[];
  subclass_summary: Record<string, { subclass_id: string; label: string; mean_score: number }[]>;
  chunks: ClassificationChunkItem[];
}

export interface CategoryAxis {
  id: string;
  label: string;
}

export interface SimilarityMatrixResponse {
  document_id: string;
  doc_type: string;
  doc_type_label: string;
  meeting_date: string;
  available: boolean;
  total_chunks: number;
  displayed_slices?: number;
  downsampled?: boolean;
  metric: MetricTransform;
  normalization: NormalizationMode;
  granularity: GranularityMode;
  macro_category?: string | null;
  categories: CategoryAxis[];
  chunk_ids: string[];
  matrix: number[][]; // [topicIdx][sliceIdx]
  min_value: number;
  max_value: number;
}

export interface CompareDocumentRef {
  doc_type: string;
  meeting_date: string;
  doc_type_label?: string;
}

export interface ComparePartitionSlice {
  partition_index: number;
  label: string;
  chunk_start: number;
  chunk_end: number;
  values: number[];
}

export interface CompareSeriesItem {
  document_id: string;
  doc_type: string;
  doc_type_label: string;
  meeting_date: string;
  available: boolean;
  data_source: DataSourceMode;
  total_chunks: number;
  n_partitions: number;
  path_filters?: PathFilterItem[];
  documents?: CompareDocumentRef[];
  partitions: ComparePartitionSlice[];
}

export interface CompareResponse {
  n_partitions_requested: number;
  data_source: DataSourceMode;
  metric: MetricTransform;
  normalization: NormalizationMode;
  granularity: GranularityMode;
  macro_category: string | null;
  combine_by: CombineByMode;
  sub_group_by?: SubGroupByMode;
  agg_method: AggregationMethod;
  categories: CategoryAxis[];
  series: CompareSeriesItem[];
  time_ticks?: TimeTickMeta[];
  ordered_series?: OrderedTimeSeriesCohort[];
}

export interface StudyConfig {
  basket: CompareDocumentRef[];
  n_partitions: number;
  selected_slice: number;
  data_source: DataSourceMode;
  metric: MetricTransform;
  normalization: NormalizationMode;
  granularity: GranularityMode;
  macro_category: string;
  combine_by: CombineByMode;
  sub_group_by?: SubGroupByMode;
  agg_method: AggregationMethod;
  year_range_span: number;
  grouping_tree?: GroupingTreeConfig | null;
}

export type StudyType = "comparator" | "explorer_search" | "history";

export interface ExplorerSearchConfig {
  date_from?: string;
  date_to?: string;
  doc_types?: string[];
  speaker?: string;
  query_text?: string;
  use_regex?: boolean;
  filter_category?: string;
  filter_metric?: MetricTransform;
  filter_normalization?: NormalizationMode;
  filter_min_score?: number | null;
  filter_zs_category?: string;
  filter_zs_min_prob?: number | null;
  filter_rel_class?: "" | "relevant" | "irrelevant";
  filter_rel_min_prob?: number | null;
  sql_filter?: string;
}

export interface HistoryPortfolioConfig {
  entries: Array<{
    kind: "search" | "document";
    label: string;
    payload: Record<string, unknown>;
    created_at?: string;
  }>;
}

export interface StudyItem {
  id: number;
  owner_id: number;
  owner_username: string;
  primary_author_id: number;
  primary_author: string;
  collaborator: string | null;
  parent_study_id: number | null;
  parent_study: { id: number; title: string; author_username: string } | null;
  forks: { id: number; title: string; owner_username: string; is_public: boolean }[];
  title: string;
  description: string;
  config: StudyConfig & Record<string, unknown>;
  is_public: boolean;
  study_type?: StudyType;
  created_at: string;
  last_modified: string;
}

export type FixRequestKind =
  | "feedback_chunk"
  | "feedback_similarity"
  | "fix_zero_shot"
  | "fix_relevance";

export interface FixRequestItem {
  id: number;
  user_id: number;
  username: string;
  user_email: string;
  kind: FixRequestKind;
  doc_type: string;
  meeting_date: string;
  original_table_id: string;
  chunk_text: string;
  original_distribution: Record<string, unknown>;
  proposed_distribution: Record<string, unknown>;
  user_note: string;
  status: "pending" | "accepted" | "rejected";
  admin_comment: string;
  created_at: string;
  resolved_at: string | null;
}

export interface NotificationItem {
  id: number;
  title: string;
  message: string;
  status_tag: string;
  is_read: boolean;
  created_at: string;
}

export interface UserPublic {
  id: number;
  email: string;
  username: string;
  role: "user" | "admin";
  status: "pending" | "active" | "disabled";
  created_at: string;
}

export interface AuthTokenResponse {
  access_token: string;
  token_type: string;
  user: UserPublic;
}

export interface RegistrationResponse {
  message: string;
  status: string;
  user: UserPublic;
}

export interface AdminActivityItem {
  id: string;
  user_id: number;
  user_email: string;
  username: string;
  kind: string;
  label: string;
  created_at: string;
}

export interface FavoriteItem {
  id: number;
  list_id: number;
  meeting_date: string;
  doc_type: string;
  doc_type_label: string;
  note: string;
  added_at: string;
}

export interface FavoriteList {
  id: number;
  name: string;
  description: string;
  created_at: string;
  items: FavoriteItem[];
}

export interface SearchHistoryItem {
  id: number | string;
  kind: "search" | "document";
  label: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface CustomFilter {
  id: number;
  owner_id: number;
  owner_username: string;
  title: string;
  description: string;
  sql_text: string;
  is_public: boolean;
  created_at: string;
  filter_def_id: number;
}
