/** Tab 2: Database File Explorer — Multi-Select Filters, Extended Score/Classifier Thresholds,
 * Vertically Resizable & Locally Filterable Table, CSV Export, Portfolio Save/Restore,
 * Meeting Bundle, Chunks, Zero-Shot, Relevance & Interactive Similarity Matrix (Multi/Range Select + Text + Histogram). */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { EChartsCoreOption } from "echarts";
import {
  BookmarkPlus,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Filter,
  Flag,
  GitCompare,
  Globe,
  Grid,
  GripHorizontal,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { ClassificationInspector } from "../components/ClassificationInspector";
import { EChartBox } from "../components/EChartBox";
import { FeedbackModal } from "../components/FeedbackModal";
import { MultiDocTypeSelect } from "../components/MultiDocTypeSelect";
import { SaveToListModal } from "../components/SaveToListModal";
import {
  EMPTY_SCORE_THRESHOLD_FILTER,
  ScoreThresholdFilter,
  type ScoreThresholdFilterValue,
} from "../components/ScoreThresholdFilter";
import { SpeakerAutocomplete } from "../components/SpeakerAutocomplete";
import { useTheme } from "../context/ThemeContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import {
  CORPUS_MAX_DATE,
  CORPUS_MIN_DATE,
  DEFAULT_DATE_FROM,
  DEFAULT_DATE_TO,
  clampCorpusDate,
  formatSigFigs,
  openNativeDatePicker,
} from "../lib/format";
import type {
  ClassificationInspectorResponse,
  CustomFilter,
  DocTypeOption,
  DocumentChunk,
  GranularityMode,
  MacroCategoryItem,
  MeetingBundleResponse,
  MetricTransform,
  NormalizationMode,
  SearchDocumentItem,
  SimilarityMatrixResponse,
} from "../types/api";

const NUMERIC_DIST_COLUMNS: Array<{ key: keyof SearchDocumentItem; label: string }> = [
  { key: "chunk_count", label: "chunk_count" },
  { key: "year", label: "year" },
  { key: "speaker_count", label: "speaker_count" },
  { key: "matched_score", label: "matched_score" },
  { key: "matched_zs_prob", label: "matched_zs_prob" },
  { key: "matched_rel_prob", label: "matched_rel_prob" },
];

function binValues(values: number[], bins: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { labels: [String(min)], counts: [values.length] };
  const step = (max - min) / bins;
  const counts = Array.from({ length: bins }, () => 0);
  for (const v of values) {
    counts[Math.min(bins - 1, Math.floor((v - min) / step))] += 1;
  }
  const labels = counts.map((_, i) => String(Number((min + step * i).toPrecision(3))));
  return { labels, counts };
}

function movingAverage(counts: number[], window = 3) {
  const half = Math.floor(window / 2);
  return counts.map((_, i) => {
    const slice = counts.slice(Math.max(0, i - half), Math.min(counts.length, i + half + 1));
    return Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(2));
  });
}

export const ExplorerPage: React.FC = () => {
  const { isDark } = useTheme();
  const [searchParams] = useSearchParams();
  const {
    recordHistory,
    restoreRequest,
    clearRestoreRequest,
    addToBasket,
    basket,
    dbVersionRevision,
  } = useWorkspace();

  const [docTypes, setDocTypes] = useState<DocTypeOption[]>([]);
  const [macroCategories, setMacroCategories] = useState<MacroCategoryItem[]>([]);

  // Unified Date Range (Date From + optional Date To, default 2000-01-01 to 2001-12-31) + Multi-select Doc Types + Extended Score Thresholds
  const [dateFrom, setDateFrom] = useState(DEFAULT_DATE_FROM);
  const [dateTo, setDateTo] = useState(DEFAULT_DATE_TO);
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [docTypeFilters, setDocTypeFilters] = useState<string[]>([]);
  const [queryText, setQueryText] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [scoreFilter, setScoreFilter] = useState<ScoreThresholdFilterValue>(
    EMPTY_SCORE_THRESHOLD_FILTER
  );
  const [downloadingMeetingCsv, setDownloadingMeetingCsv] = useState<"single" | "all" | null>(null);

  const [results, setResults] = useState<SearchDocumentItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [tableMaximized, setTableMaximized] = useState(false);

  // Req 3.1: Vertically resizable results table + local table filters
  const [tableHeight, setTableHeight] = useState<number>(240);
  const resizingRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [localTableQuery, setLocalTableQuery] = useState("");
  const [localTableDocType, setLocalTableDocType] = useState("");
  const [localTableMinChunks, setLocalTableMinChunks] = useState("");

  // Req 4.4: Save Explorer Search to Portfolio Modal
  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [savedSearchTitle, setSavedSearchTitle] = useState("");
  const [savedSearchDesc, setSavedSearchDesc] = useState("");
  const [savedSearchPublic, setSavedSearchPublic] = useState(false);
  const [savingSearch, setSavingSearch] = useState(false);
  const [saveSearchMsg, setSaveSearchMsg] = useState<string | null>(null);
  const [loadedPortfolioTitle, setLoadedPortfolioTitle] = useState<string | null>(null);

  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [sqlFilter, setSqlFilter] = useState("");
  const [savedFilters, setSavedFilters] = useState<CustomFilter[]>([]);
  const [selectedFilterId, setSelectedFilterId] = useState("");
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterTitle, setFilterTitle] = useState("");
  const [filterDesc, setFilterDesc] = useState("");
  const [filterPublic, setFilterPublic] = useState(false);
  const [savingFilter, setSavingFilter] = useState(false);
  const [filterModalMsg, setFilterModalMsg] = useState<string | null>(null);
  const [distCollapsed, setDistCollapsed] = useState(true);

  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [activeDocType, setActiveDocType] = useState<string>("transcripts");
  const [bundle, setBundle] = useState<MeetingBundleResponse | null>(null);
  const [loadingBundle, setLoadingBundle] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<
    "chunks" | "zeroshot" | "relevance" | "heatmap"
  >("chunks");

  // Generalized inspector data (shared by Zero-Shot and Relevance tabs)
  const [zeroShot, setZeroShot] = useState<ClassificationInspectorResponse | null>(null);
  const [relevance, setRelevance] = useState<ClassificationInspectorResponse | null>(null);
  const [inspectorSpeaker, setInspectorSpeaker] = useState("");

  // Similarity matrix reactive controls (None / Topic / Slice)
  const [simMetric, setSimMetric] = useState<MetricTransform>("cosine");
  const [simNorm, setSimNorm] = useState<NormalizationMode>("none");
  const [simGranularity, setSimGranularity] = useState<GranularityMode>("macro");
  const [simMacroDrill, setSimMacroDrill] = useState<string>("growth");
  const [simData, setSimData] = useState<SimilarityMatrixResponse | null>(null);
  const [loadingSim, setLoadingSim] = useState(false);

  // Req 3.2: Similarity Matrix multi-select & range selection + fetched full chunk texts
  const [selectedSimSlices, setSelectedSimSlices] = useState<number[]>([]);
  const [lastClickedSlice, setLastClickedSlice] = useState<number | null>(null);
  const [rangeStartInput, setRangeStartInput] = useState<string>("");
  const [rangeEndInput, setRangeEndInput] = useState<string>("");
  const [selectedChunksMap, setSelectedChunksMap] = useState<Record<string, DocumentChunk>>({});
  const [loadingSelectedChunks, setLoadingSelectedChunks] = useState(false);

  // Modals
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{
    open: boolean;
    kind: "feedback_chunk" | "feedback_similarity";
    originalTableId?: string;
    chunkText?: string;
  }>({ open: false, kind: "feedback_chunk" });

  useEffect(() => {
    api.getDocTypes().then((r) => setDocTypes(r.doc_types)).catch(() => {});
    api.getTaxonomy().then((t) => setMacroCategories(t.macro_categories)).catch(() => {});
  }, [dbVersionRevision]);

  const loadMyFilters = useCallback(async () => {
    const res = await api.listMyFilters();
    setSavedFilters(res.items);
  }, []);

  useEffect(() => {
    loadMyFilters().catch(() => {});
  }, [loadMyFilters]);

  // Allow Escape key to exit maximized table view
  useEffect(() => {
    if (!tableMaximized) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTableMaximized(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tableMaximized]);

  // Vertical resize mouse listeners for Results Table bottom handle
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = e.clientY - resizingRef.current.startY;
      const next = Math.max(140, Math.min(820, resizingRef.current.startHeight + delta));
      setTableHeight(next);
    };
    const onMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const startTableResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { startY: e.clientY, startHeight: tableHeight };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  const executeSearch = useCallback(
    async (
      overrides?: {
        date_from?: string;
        date_to?: string;
        speaker?: string;
        doc_types?: string[];
        doc_type?: string;
        query_text?: string;
        use_regex?: boolean;
        score?: ScoreThresholdFilterValue;
        sql_filter?: string;
      },
      shouldRecord = true
    ) => {
      setSearching(true);
      setSearchError(null);
      const effFrom = clampCorpusDate(overrides?.date_from ?? dateFrom);
      const effTo = clampCorpusDate(overrides?.date_to ?? dateTo);
      const effDocTypes =
        overrides?.doc_types !== undefined
          ? overrides.doc_types
          : overrides?.doc_type
          ? overrides.doc_type
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : docTypeFilters;
      const sf = overrides?.score ?? scoreFilter;

      const params = {
        date_from: effFrom || undefined,
        date_to: effTo || undefined,
        speaker: overrides?.speaker ?? (speakerFilter || undefined),
        doc_types: effDocTypes.length > 0 ? effDocTypes : undefined,
        query_text: overrides?.query_text ?? (queryText || undefined),
        use_regex: overrides?.use_regex ?? useRegex,
        filter_category: sf.filterCategory || undefined,
        filter_metric: sf.filterCategory ? sf.filterMetric : undefined,
        filter_normalization: sf.filterCategory ? sf.filterNorm : undefined,
        filter_min_score:
          sf.filterCategory && sf.filterMinScore.trim() !== ""
            ? Number(sf.filterMinScore)
            : undefined,
        filter_zs_category: sf.filterZsCategory || undefined,
        filter_zs_min_prob:
          sf.filterZsCategory && sf.filterZsMinProb.trim() !== ""
            ? Number(sf.filterZsMinProb)
            : undefined,
        filter_rel_class: sf.filterRelClass || undefined,
        filter_rel_min_prob:
          sf.filterRelClass && sf.filterRelMinProb.trim() !== ""
            ? Number(sf.filterRelMinProb)
            : undefined,
        sql_filter: overrides?.sql_filter ?? (sqlFilter.trim() || undefined),
        limit: 50,
        offset: 0,
      };
      try {
        const res = await api.searchDocuments(params);
        setResults(res.items);
        setTotalResults(res.total);
        if (shouldRecord) {
          const dateLabel =
            params.date_from && !params.date_to
              ? params.date_from
              : `${params.date_from || "1976"}..${params.date_to || "2020"}`;
          const summaryParts = [
            effDocTypes.length > 0 ? effDocTypes.join("+") : "All types",
            dateLabel,
            params.speaker ? `spk:${params.speaker}` : null,
            params.query_text ? `"${params.query_text}"` : null,
          ].filter(Boolean);
          recordHistory("search", summaryParts.join(" · "), params);
        }
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setSearching(false);
      }
    },
    [dateFrom, dateTo, speakerFilter, docTypeFilters, queryText, useRegex, scoreFilter, sqlFilter, recordHistory]
  );

  // Load saved Explorer search from Portfolio if ?portfolio=<id> is present
  useEffect(() => {
    const pid = searchParams.get("portfolio");
    if (!pid) {
      setLoadedPortfolioTitle(null);
      return;
    }
    const studyId = Number(pid);
    if (!studyId) return;
    api
      .getStudy(studyId)
      .then((st) => {
        setLoadedPortfolioTitle(st.title);
        const cfg = (st.config || {}) as Record<string, unknown>;
        if (st.study_type === "history" && Array.isArray(cfg.entries) && cfg.entries.length > 0) {
          const firstSearch = (cfg.entries as Array<{ kind?: string; payload?: Record<string, unknown> }>).find(
            (e) => e.kind === "search"
          );
          if (firstSearch?.payload) {
            const p = firstSearch.payload;
            const restoredFrom = clampCorpusDate(String(p.date_from || CORPUS_MIN_DATE));
            const restoredTo = clampCorpusDate(String(p.date_to ?? ""));
            const restoredTypes = Array.isArray(p.doc_types)
              ? (p.doc_types as string[])
              : typeof p.doc_type === "string" && p.doc_type
              ? p.doc_type.split(",").map((s) => s.trim()).filter(Boolean)
              : [];
            setDateFrom(restoredFrom);
            setDateTo(restoredTo);
            setDocTypeFilters(restoredTypes);
            setSpeakerFilter(String(p.speaker || ""));
            setQueryText(String(p.query_text || ""));
            setUseRegex(Boolean(p.use_regex));
            setSqlFilter(String(p.sql_filter || ""));
            executeSearch(
              {
                date_from: restoredFrom,
                date_to: restoredTo,
                doc_types: restoredTypes,
                speaker: String(p.speaker || ""),
                query_text: String(p.query_text || ""),
                use_regex: Boolean(p.use_regex),
                sql_filter: String(p.sql_filter || "") || undefined,
              },
              false
            );
          }
          return;
        }
        // Reconstruct Explorer search strictly from stored parameters & filters
        const restoredFrom = clampCorpusDate(String(cfg.date_from || CORPUS_MIN_DATE));
        const restoredTo = clampCorpusDate(String(cfg.date_to ?? ""));
        const restoredTypes = Array.isArray(cfg.doc_types)
          ? (cfg.doc_types as string[])
          : [];
        const restoredScore: ScoreThresholdFilterValue = {
          filterCategory: String(cfg.filter_category || ""),
          filterMetric: (cfg.filter_metric as MetricTransform) || "cosine",
          filterNorm: (cfg.filter_normalization as NormalizationMode) || "none",
          filterMinScore:
            cfg.filter_min_score !== undefined && cfg.filter_min_score !== null
              ? String(cfg.filter_min_score)
              : "",
          filterZsCategory: String(cfg.filter_zs_category || ""),
          filterZsMinProb:
            cfg.filter_zs_min_prob !== undefined && cfg.filter_zs_min_prob !== null
              ? String(cfg.filter_zs_min_prob)
              : "",
          filterRelClass: (cfg.filter_rel_class as "" | "relevant" | "irrelevant") || "",
          filterRelMinProb:
            cfg.filter_rel_min_prob !== undefined && cfg.filter_rel_min_prob !== null
              ? String(cfg.filter_rel_min_prob)
              : "",
        };
        setDateFrom(restoredFrom);
        setDateTo(restoredTo);
        setDocTypeFilters(restoredTypes);
        setSpeakerFilter(String(cfg.speaker || ""));
        setQueryText(String(cfg.query_text || ""));
        setUseRegex(Boolean(cfg.use_regex));
        setScoreFilter(restoredScore);
        setSqlFilter(String(cfg.sql_filter || ""));
        executeSearch(
          {
            date_from: restoredFrom,
            date_to: restoredTo,
            doc_types: restoredTypes,
            speaker: String(cfg.speaker || ""),
            query_text: String(cfg.query_text || ""),
            use_regex: Boolean(cfg.use_regex),
            score: restoredScore,
            sql_filter: String(cfg.sql_filter || "") || undefined,
          },
          false
        );
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Auto-update search whenever any filter parameter changes (debounced 220ms)
  useEffect(() => {
    if (searchParams.get("portfolio")) return;
    const timer = window.setTimeout(() => {
      executeSearch(undefined, false);
    }, 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dateFrom,
    dateTo,
    speakerFilter,
    docTypeFilters,
    queryText,
    useRegex,
    scoreFilter,
    sqlFilter,
    dbVersionRevision,
  ]);

  useEffect(() => {
    if (selectedMeeting && activeDocType) {
      openDocument(selectedMeeting, activeDocType, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbVersionRevision]);

  const openDocument = useCallback(
    async (meetingDate: string, docType: string, shouldRecord = true) => {
      setSelectedMeeting(meetingDate);
      setActiveDocType(docType);
      setTableMaximized(false);
      setSelectedSimSlices([]);
      setLastClickedSlice(null);
      setSelectedChunksMap({});
      setLoadingBundle(true);
      try {
        const b = await api.getMeetingBundle(meetingDate, docType);
        setBundle(b);
        const resolvedType = b.active_doc_type || docType;
        setActiveDocType(resolvedType);
        if (shouldRecord) {
          recordHistory("document", `${meetingDate} · ${resolvedType}`, {
            meeting_date: meetingDate,
            doc_type: resolvedType,
          });
        }
      } finally {
        setLoadingBundle(false);
      }
    },
    [recordHistory]
  );

  useEffect(() => {
    if (!restoreRequest) return;
    if (restoreRequest.kind === "search") {
      const p = restoreRequest.payload;
      const restoredFrom = clampCorpusDate(String(p.date_from || p.meeting_date || CORPUS_MIN_DATE));
      const restoredTo = p.meeting_date ? "" : clampCorpusDate(String(p.date_to ?? ""));
      const restoredTypes = Array.isArray(p.doc_types)
        ? (p.doc_types as string[])
        : typeof p.doc_type === "string" && p.doc_type
        ? p.doc_type.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      const restoredScore: ScoreThresholdFilterValue = {
        filterCategory: String(p.filter_category || ""),
        filterMetric: (p.filter_metric as MetricTransform) || "cosine",
        filterNorm: (p.filter_normalization as NormalizationMode) || "none",
        filterMinScore:
          p.filter_min_score !== undefined && p.filter_min_score !== null
            ? String(p.filter_min_score)
            : "",
        filterZsCategory: String(p.filter_zs_category || ""),
        filterZsMinProb:
          p.filter_zs_min_prob !== undefined && p.filter_zs_min_prob !== null
            ? String(p.filter_zs_min_prob)
            : "",
        filterRelClass: (p.filter_rel_class as "" | "relevant" | "irrelevant") || "",
        filterRelMinProb:
          p.filter_rel_min_prob !== undefined && p.filter_rel_min_prob !== null
            ? String(p.filter_rel_min_prob)
            : "",
      };
      setDateFrom(restoredFrom);
      setDateTo(restoredTo);
      setSpeakerFilter(String(p.speaker || ""));
      setDocTypeFilters(restoredTypes);
      setQueryText(String(p.query_text || ""));
      setUseRegex(Boolean(p.use_regex));
      setScoreFilter(restoredScore);
      setSqlFilter(String(p.sql_filter || ""));
      executeSearch(
        {
          date_from: restoredFrom || undefined,
          date_to: restoredTo || undefined,
          speaker: p.speaker as string | undefined,
          doc_types: restoredTypes,
          query_text: p.query_text as string | undefined,
          use_regex: Boolean(p.use_regex),
          score: restoredScore,
          sql_filter: String(p.sql_filter || "") || undefined,
        },
        false
      );
    } else if (restoreRequest.kind === "document") {
      const m = String(restoreRequest.payload.meeting_date || "");
      const dt = String(restoreRequest.payload.doc_type || "transcripts");
      if (m) openDocument(m, dt, false);
    }
    clearRestoreRequest();
  }, [restoreRequest, clearRestoreRequest, executeSearch, openDocument]);

  // Fetch Zero-Shot & Relevance probabilities in parallel when document, speaker filter, or DB version changes
  useEffect(() => {
    if (!selectedMeeting || !activeDocType) return;
    const params = { speaker: inspectorSpeaker || undefined };
    api.getZeroShot(activeDocType, selectedMeeting, params).then(setZeroShot).catch(() => setZeroShot(null));
    api.getRelevance(activeDocType, selectedMeeting, params).then(setRelevance).catch(() => setRelevance(null));
  }, [selectedMeeting, activeDocType, inspectorSpeaker, dbVersionRevision]);

  // Reactive Similarity Matrix fetch
  useEffect(() => {
    if (!selectedMeeting || !activeDocType) return;
    setLoadingSim(true);
    setSelectedSimSlices([]);
    setLastClickedSlice(null);
    api
      .getSimilarityMatrix(activeDocType, selectedMeeting, {
        metric: simMetric,
        normalization: simNorm,
        granularity: simGranularity,
        macro_category: simGranularity === "subclass" ? simMacroDrill : undefined,
      })
      .then(setSimData)
      .catch(() => setSimData(null))
      .finally(() => setLoadingSim(false));
  }, [selectedMeeting, activeDocType, simMetric, simNorm, simGranularity, simMacroDrill, dbVersionRevision]);

  // Fetch full text for selected Similarity Matrix chunks
  useEffect(() => {
    if (!selectedMeeting || !activeDocType || !simData || selectedSimSlices.length === 0) {
      return;
    }
    const targetIds = selectedSimSlices
      .map((idx) => simData.chunk_ids[idx])
      .filter((cid): cid is string => Boolean(cid) && !cid.startsWith("chunks_"));

    const missingIds = targetIds.filter((cid) => !selectedChunksMap[cid]);
    if (missingIds.length === 0) return;

    let cancelled = false;
    setLoadingSelectedChunks(true);
    api
      .getDocumentChunks(activeDocType, selectedMeeting, {
        chunk_ids: missingIds,
        limit: Math.max(missingIds.length, 50),
      })
      .then((res) => {
        if (cancelled) return;
        setSelectedChunksMap((prev) => {
          const next = { ...prev };
          for (const ch of res.chunks) {
            next[ch.chunk_id] = ch;
          }
          return next;
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSelectedChunks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSimSlices, simData, selectedMeeting, activeDocType, selectedChunksMap]);

  // Locally filtered results table (Req 3.1)
  const locallyFilteredResults = useMemo(() => {
    const q = localTableQuery.trim().toLowerCase();
    const minCh = localTableMinChunks.trim() !== "" ? Number(localTableMinChunks) : null;
    return results.filter((item) => {
      if (localTableDocType && item.doc_type !== localTableDocType) return false;
      if (minCh !== null && Number.isFinite(minCh) && item.chunk_count < minCh) return false;
      if (q) {
        const hay = [
          item.meeting_date,
          item.doc_type_label,
          item.doc_type,
          ...(item.top_speakers || []),
          item.snippet || "",
          item.source_file || "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [results, localTableQuery, localTableDocType, localTableMinChunks]);

  const hasLocalTableFilters = Boolean(
    localTableQuery.trim() || localTableDocType || localTableMinChunks.trim()
  );

  const localDocTypeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) map.set(r.doc_type, r.doc_type_label);
    return Array.from(map.entries());
  }, [results]);

  const columnDistributions = useMemo(() => {
    const charts: Array<{ key: string; title: string; option: EChartsCoreOption }> = [];
    if (results.length === 0) return charts;
    const axisColor = isDark ? "#94A3B8" : "#64748B";
    const gridColor = isDark ? "#334155" : "#E2E8F0";
    const barColor = isDark ? "#3B82F6" : "#1D4ED8";
    const lineColor = isDark ? "#F59E0B" : "#B45309";

    for (const { key, label } of NUMERIC_DIST_COLUMNS) {
      const values = results
        .map((r) => r[key])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (values.length === 0) continue;
      const { labels, counts } = binValues(values, 12);
      charts.push({
        key: String(key),
        title: label,
        option: {
          animation: false,
          tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
          grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
          xAxis: {
            type: "category",
            data: labels,
            axisTick: { show: false },
            axisLabel: { color: axisColor, fontSize: 9 },
          },
          yAxis: {
            type: "value",
            axisLabel: { color: axisColor, fontSize: 9 },
            splitLine: { lineStyle: { color: gridColor } },
          },
          series: [
            {
              name: "frequency",
              type: "bar",
              data: counts,
              barCategoryGap: "15%",
              itemStyle: { color: barColor, opacity: 0.75 },
            },
            {
              name: "density",
              type: "line",
              data: movingAverage(counts),
              smooth: true,
              symbol: "none",
              lineStyle: { color: lineColor, width: 1.5 },
              itemStyle: { color: lineColor },
            },
          ],
        },
      });
    }

    const horizontalBars = (title: string, entries: [string, number][]): EChartsCoreOption => ({
      animation: false,
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { color: axisColor, fontSize: 9 },
        splitLine: { lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: "category",
        inverse: true,
        data: entries.map(([name]) => name),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: axisColor, fontSize: 9, width: 92, overflow: "truncate" },
      },
      series: [
        {
          name: title,
          type: "bar",
          data: entries.map(([, count]) => count),
          barMaxWidth: 14,
          itemStyle: { color: barColor, borderRadius: [0, 2, 2, 0] },
        },
      ],
    });

    const docTypeCounts = new Map<string, number>();
    for (const r of results) {
      const label = r.doc_type_label || r.doc_type;
      docTypeCounts.set(label, (docTypeCounts.get(label) || 0) + 1);
    }
    const docTypeEntries = Array.from(docTypeCounts.entries()).sort((a, b) => b[1] - a[1]);
    if (docTypeEntries.length > 0) {
      charts.push({
        key: "doc_type",
        title: "doc_type",
        option: horizontalBars("documents", docTypeEntries),
      });
    }

    const speakerCounts = new Map<string, number>();
    for (const r of results) {
      for (const speaker of r.top_speakers || []) {
        speakerCounts.set(speaker, (speakerCounts.get(speaker) || 0) + 1);
      }
    }
    const speakerEntries = Array.from(speakerCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);
    if (speakerEntries.length > 0) {
      charts.push({
        key: "top_speakers",
        title: "top_speakers",
        option: horizontalBars("documents", speakerEntries),
      });
    }

    return charts;
  }, [results, isDark]);

  // Export Explorer results table to CSV (Req 4.4)
  const handleExportExplorerCsv = () => {
    if (locallyFilteredResults.length === 0) return;
    const esc = (val: string | number | undefined) => {
      const s = val === undefined || val === null ? "" : String(val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "meeting_date",
      "doc_type",
      "doc_type_label",
      "year",
      "chunk_count",
      "speaker_count",
      "top_speakers",
      "matched_score",
      "matched_zs_prob",
      "matched_rel_prob",
      "source_file",
      "excerpt",
    ];
    const lines = [headers.join(",")];
    for (const item of locallyFilteredResults) {
      lines.push(
        [
          item.meeting_date,
          item.doc_type,
          item.doc_type_label,
          item.year,
          item.chunk_count,
          item.speaker_count,
          (item.top_speakers || []).join("; "),
          item.matched_score,
          item.matched_zs_prob,
          item.matched_rel_prob,
          item.source_file,
          item.snippet,
        ]
          .map(esc)
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `miningfomc_explorer_results_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Save Explorer Search parameters (ONLY query parameters & filters) to Portfolio (Req 4.4)
  const handleSaveSearchToPortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!savedSearchTitle.trim()) return;
    setSavingSearch(true);
    setSaveSearchMsg(null);
    try {
      const paramsOnly = {
        date_from: clampCorpusDate(dateFrom) || undefined,
        date_to: clampCorpusDate(dateTo) || undefined,
        doc_types: docTypeFilters,
        speaker: speakerFilter || undefined,
        query_text: queryText || undefined,
        use_regex: useRegex,
        filter_category: scoreFilter.filterCategory || undefined,
        filter_metric: scoreFilter.filterCategory ? scoreFilter.filterMetric : undefined,
        filter_normalization: scoreFilter.filterCategory ? scoreFilter.filterNorm : undefined,
        filter_min_score:
          scoreFilter.filterCategory && scoreFilter.filterMinScore.trim() !== ""
            ? Number(scoreFilter.filterMinScore)
            : null,
        filter_zs_category: scoreFilter.filterZsCategory || undefined,
        filter_zs_min_prob:
          scoreFilter.filterZsCategory && scoreFilter.filterZsMinProb.trim() !== ""
            ? Number(scoreFilter.filterZsMinProb)
            : null,
        filter_rel_class: scoreFilter.filterRelClass || undefined,
        filter_rel_min_prob:
          scoreFilter.filterRelClass && scoreFilter.filterRelMinProb.trim() !== ""
            ? Number(scoreFilter.filterRelMinProb)
            : null,
        sql_filter: sqlFilter.trim() || undefined,
      };
      await api.createStudy({
        title: savedSearchTitle.trim(),
        description: savedSearchDesc.trim(),
        config: paramsOnly,
        is_public: savedSearchPublic,
        study_type: "explorer_search",
      });
      setSaveSearchMsg("Explorer search saved to Portfolio.");
      setTimeout(() => {
        setSaveSearchMsg(null);
        setSaveSearchOpen(false);
      }, 900);
    } catch (err) {
      setSaveSearchMsg(err instanceof Error ? err.message : "Failed to save search");
    } finally {
      setSavingSearch(false);
    }
  };

  const handleCreateFilter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!filterTitle.trim() || !sqlFilter.trim()) return;
    setSavingFilter(true);
    setFilterModalMsg(null);
    try {
      await api.createFilter({
        title: filterTitle.trim(),
        description: filterDesc.trim(),
        sql_text: sqlFilter.trim(),
        is_public: filterPublic,
      });
      await loadMyFilters();
      setFilterModalOpen(false);
    } catch (err) {
      setFilterModalMsg(err instanceof Error ? err.message : "Failed to save filter");
    } finally {
      setSavingFilter(false);
    }
  };

  // Heatmap: Y-Axis = Topics, X-Axis = Chunk Sequence (Slices), interactive multi-select & Shift+Click range highlight
  const heatmapOption = useMemo(() => {
    if (!simData || !simData.available || simData.matrix.length === 0) return {};
    const yTopicLabels = simData.categories.map((c) => c.label);
    const xSliceLabels = simData.chunk_ids.map((_, i) => `#${i + 1}`);
    const dataPoints: [number, number, number][] = [];

    simData.matrix.forEach((topicRow, topicIdx) => {
      topicRow.forEach((val, sliceIdx) => {
        dataPoints.push([sliceIdx, topicIdx, Number(val)]);
      });
    });

    const selectedAreas = selectedSimSlices.map((sIdx) => [
      {
        xAxis: sIdx,
        itemStyle: {
          color: "rgba(245, 158, 11, 0.22)",
          borderColor: "#F59E0B",
          borderWidth: 1.5,
        },
      },
      { xAxis: sIdx },
    ]);

    return {
      tooltip: {
        position: "top",
        formatter: (p: { value: [number, number, number] }) => {
          const [sliceIdx, topicIdx, val] = p.value;
          const chunkId = simData.chunk_ids[sliceIdx] || `Slice ${sliceIdx + 1}`;
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;">
            <strong>${yTopicLabels[topicIdx]}</strong><br/>
            #${sliceIdx + 1} · ${chunkId}<br/>
            Score: <strong>${formatSigFigs(val, 3)}</strong><br/>
            <span style="font-size:10px;color:#94A3B8;">Click to toggle · Shift+Click for range</span>
          </div>`;
        },
      },
      grid: { top: 20, left: 165, right: 24, bottom: 72 },
      xAxis: {
        type: "category",
        data: xSliceLabels,
        name: "Chunk Sequence (Slices)",
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { fontSize: 10, fontFamily: "JetBrains Mono" },
        axisLabel: { fontSize: 10, fontFamily: "JetBrains Mono" },
      },
      yAxis: {
        type: "category",
        data: yTopicLabels,
        inverse: true,
        axisLabel: { fontSize: 10, fontFamily: "JetBrains Mono" },
      },
      visualMap: {
        min: simData.min_value,
        max: simData.max_value === simData.min_value ? simData.min_value + 0.01 : simData.max_value,
        calculable: true,
        orient: "horizontal",
        left: "center",
        bottom: 4,
        inRange: {
          color: isDark
            ? ["#0F172A", "#1E3A8A", "#2563EB", "#60A5FA", "#DBEAFE"]
            : ["#F8FAFC", "#BFDBFE", "#3B82F6", "#1D4ED8", "#1E3A8A"],
        },
      },
      series: [
        {
          type: "heatmap",
          data: dataPoints,
          emphasis: { itemStyle: { borderColor: "#09090B", borderWidth: 1 } },
          ...(selectedAreas.length > 0
            ? {
                markArea: {
                  silent: true,
                  data: selectedAreas,
                },
              }
            : {}),
        },
      ],
    };
  }, [simData, isDark, selectedSimSlices]);

  const handleHeatmapClick = useCallback(
    (params: Record<string, unknown>) => {
      const val = params.value as [number, number, number] | undefined;
      if (!Array.isArray(val) || typeof val[0] !== "number") return;
      const sliceIdx = val[0];
      const nativeEvt = (params.event as { event?: MouseEvent } | undefined)?.event;
      const isShift = Boolean(nativeEvt?.shiftKey);

      if (isShift && lastClickedSlice !== null) {
        const lo = Math.min(lastClickedSlice, sliceIdx);
        const hi = Math.max(lastClickedSlice, sliceIdx);
        setSelectedSimSlices((prev) => {
          const next = new Set(prev);
          for (let i = lo; i <= hi; i++) next.add(i);
          return Array.from(next).sort((a, b) => a - b);
        });
      } else {
        setSelectedSimSlices((prev) =>
          prev.includes(sliceIdx)
            ? prev.filter((x) => x !== sliceIdx)
            : [...prev, sliceIdx].sort((a, b) => a - b)
        );
      }
      setLastClickedSlice(sliceIdx);
    },
    [lastClickedSlice]
  );

  const handleApplySliceRange = () => {
    if (!simData) return;
    const maxN = simData.chunk_ids.length;
    const s = Math.max(1, Math.min(maxN, Number(rangeStartInput) || 1));
    const e = Math.max(1, Math.min(maxN, Number(rangeEndInput) || s));
    const lo = Math.min(s, e) - 1;
    const hi = Math.max(s, e) - 1;
    setSelectedSimSlices((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i++) next.add(i);
      return Array.from(next).sort((a, b) => a - b);
    });
  };

  const buildChunkHistogramOption = useCallback(
    (sliceIdx: number) => {
      if (!simData) return {};
      const labels = simData.categories.map((c) => c.label);
      const values = simData.matrix.map((row) => Number(row[sliceIdx] ?? 0));
      return {
        tooltip: {
          trigger: "axis",
          axisPointer: { type: "shadow" },
          formatter: (items: Array<{ name: string; value: number }>) => {
            const first = items[0];
            if (!first) return "";
            return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;">
              <strong>${first.name}</strong><br/>Score: <strong>${formatSigFigs(first.value, 3)}</strong>
            </div>`;
          },
        },
        grid: { top: 10, left: 130, right: 18, bottom: 24 },
        xAxis: {
          type: "value",
          axisLabel: {
            fontSize: 9,
            fontFamily: "JetBrains Mono",
            formatter: (v: number) => formatSigFigs(v, 2),
          },
          splitLine: { lineStyle: { color: isDark ? "#334155" : "#E2E8F0" } },
        },
        yAxis: {
          type: "category",
          data: labels,
          inverse: true,
          axisLabel: { fontSize: 9, fontFamily: "JetBrains Mono" },
        },
        series: [
          {
            type: "bar",
            data: values,
            barMaxWidth: 14,
            itemStyle: {
              color: isDark ? "#3B82F6" : "#1D4ED8",
              borderRadius: [0, 2, 2, 0],
            },
          },
        ],
      };
    },
    [simData, isDark]
  );

  const activeSibling = bundle?.siblings.find((s) => s.doc_type === activeDocType);
  const isInBasket = (dt: string, mDate: string) =>
    basket.some((d) => d.doc_type === dt && d.meeting_date === mDate);

  // Download CSV of currently selected document or all documents matching the selected meeting (Req 4)
  const downloadMeetingChunksCsv = async (mode: "single" | "all") => {
    if (!selectedMeeting) return;
    setDownloadingMeetingCsv(mode);
    try {
      const esc = (val: string | number | undefined | null) => {
        const s = val === undefined || val === null ? "" : String(val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const targetDocs =
        mode === "all" && bundle && bundle.siblings.length > 0
          ? bundle.siblings.map((s) => ({
              doc_type: s.doc_type,
              doc_type_label: s.doc_type_label || s.doc_type,
            }))
          : [
              {
                doc_type: activeDocType,
                doc_type_label: activeSibling?.doc_type_label || activeDocType,
              },
            ];

      const headers = [
        "meeting_date",
        "doc_type",
        "doc_type_label",
        "sequence_num",
        "chunk_id",
        "section",
        "speaker",
        "speaker_role",
        "char_count",
        "text_content",
      ];
      const lines = [headers.join(",")];

      const chunkResponses = await Promise.all(
        targetDocs.map((d) =>
          api
            .getDocumentChunks(d.doc_type, selectedMeeting, { limit: 50000, offset: 0 })
            .then((res) => ({ ...d, chunks: res.chunks || [] }))
        )
      );

      for (const docGroup of chunkResponses) {
        for (const ch of docGroup.chunks) {
          lines.push(
            [
              selectedMeeting,
              docGroup.doc_type,
              docGroup.doc_type_label,
              ch.sequence_num,
              ch.chunk_id,
              ch.section,
              ch.speaker,
              ch.speaker_role,
              ch.char_count,
              ch.text_content,
            ]
              .map(esc)
              .join(",")
          );
        }
      }

      const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        mode === "all"
          ? `miningfomc_meeting_${selectedMeeting}_all_documents.csv`
          : `miningfomc_${selectedMeeting}_${activeDocType}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingMeetingCsv(null);
    }
  };

  // Reusable Matching Documents Table (Vertically Resizable + Locally Filterable + CSV Export)
  const renderMatchingDocumentsPanel = (maximized: boolean) => (
    <div
      className={
        maximized
          ? "fixed inset-4 z-50 panel bg-surface shadow-2xl flex flex-col overflow-hidden"
          : "panel overflow-hidden flex flex-col"
      }
    >
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2 bg-zinc-50/70 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono uppercase text-muted font-semibold">
            Matching Documents (
            {hasLocalTableFilters
              ? `${locallyFilteredResults.length} / ${results.length} shown · ${totalResults.toLocaleString()} total`
              : totalResults.toLocaleString()}
            )
          </span>
          <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
            {maximized
              ? "Expanded view · Click any row to load its FOMC Meeting Bundle"
              : "Drag bottom handle to resize · Click any row to load bundle"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={locallyFilteredResults.length === 0}
            onClick={handleExportExplorerCsv}
            title="Export search results table to CSV"
            className="btn-secondary py-1 px-2.5 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setTableMaximized((v) => !v)}
            className="btn-secondary py-1 px-2.5 text-xs"
            title={maximized ? "Restore normal view" : "Maximize table view"}
          >
            {maximized ? (
              <>
                <Minimize2 className="w-3.5 h-3.5" />
                Restore
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                Maximize
              </>
            )}
          </button>
        </div>
      </div>

      {/* Local Results Table Filter Bar + Visible Reset Button (Req 3.1) */}
      <div className="px-4 py-2 border-b border-border bg-canvas flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-muted font-semibold">
          <Filter className="w-3 h-3 text-accent" />
          Table Filter:
        </div>
        <input
          type="text"
          value={localTableQuery}
          onChange={(e) => setLocalTableQuery(e.target.value)}
          placeholder="Filter date, speaker, excerpt, file..."
          className="input-field py-1 px-2.5 text-xs flex-1 min-w-[180px]"
        />
        <select
          value={localTableDocType}
          onChange={(e) => setLocalTableDocType(e.target.value)}
          className="input-field py-1 px-2 text-xs w-auto min-w-[140px]"
        >
          <option value="">All Result Types</option>
          {localDocTypeOptions.map(([id, lbl]) => (
            <option key={id} value={id}>
              {lbl}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={0}
          value={localTableMinChunks}
          onChange={(e) => setLocalTableMinChunks(e.target.value)}
          placeholder="Min chunks"
          className="input-field py-1 px-2 text-xs font-mono w-28"
        />
        <button
          type="button"
          disabled={!hasLocalTableFilters}
          onClick={() => {
            setLocalTableQuery("");
            setLocalTableDocType("");
            setLocalTableMinChunks("");
          }}
          className="btn-secondary py-1 px-2.5 text-xs"
          title="Clear local table filters"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      {/* Scrollable Results Viewport (Vertically resizable in default view) */}
      <div
        className={`overflow-x-auto overflow-y-auto ${maximized ? "flex-1" : ""}`}
        style={maximized ? undefined : { height: `${tableHeight}px` }}
      >
        <table
          className={`text-left border-collapse ${
            maximized ? "w-full min-w-[1040px]" : "w-[165%] min-w-[1320px]"
          }`}
        >
          <thead>
            <tr className="border-b border-border text-[11px] font-mono uppercase text-muted bg-surface sticky top-0 z-10">
              <th className="py-2.5 px-4 w-[180px] whitespace-nowrap">Meeting Date</th>
              <th className="py-2.5 px-4 w-[210px] whitespace-nowrap">Document Type</th>
              <th className="py-2.5 px-4 w-[130px] whitespace-nowrap">Chunks</th>
              <th className="py-2.5 px-4 w-[240px] whitespace-nowrap">Top Speakers</th>
              <th className="py-2.5 px-4 w-[360px] whitespace-nowrap">Excerpt</th>
              <th className="py-2.5 px-4 w-[180px] whitespace-nowrap">Source File</th>
              <th className="py-2.5 px-4 w-[140px] text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-sm">
            {locallyFilteredResults.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs font-mono text-zinc-400">
                  {searching
                    ? "Scanning Parquet partitions..."
                    : hasLocalTableFilters
                    ? "No rows match the local table filters. Click Reset to view all results."
                    : "No matching documents found."}
                </td>
              </tr>
            ) : (
              locallyFilteredResults.map((item) => {
                const isSelected =
                  selectedMeeting === item.meeting_date && activeDocType === item.doc_type;
                return (
                  <tr
                    key={item.document_id}
                    onClick={() => openDocument(item.meeting_date, item.doc_type)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? "bg-accent-soft/60" : "hover:bg-zinc-50"
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono text-xs font-semibold whitespace-nowrap">
                      <div>{item.meeting_date}</div>
                      {(item.matched_score !== undefined ||
                        item.matched_zs_prob !== undefined ||
                        item.matched_rel_prob !== undefined) && (
                        <div className="text-[10px] font-normal text-accent-dark">
                          {item.matched_score !== undefined
                            ? `sim:${formatSigFigs(item.matched_score, 3)} `
                            : ""}
                          {item.matched_zs_prob !== undefined
                            ? `zs:${formatSigFigs(item.matched_zs_prob, 3)} `
                            : ""}
                          {item.matched_rel_prob !== undefined
                            ? `rel:${formatSigFigs(item.matched_rel_prob, 3)}`
                            : ""}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span className="mono-tag">{item.doc_type_label}</span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-muted whitespace-nowrap">
                      {item.chunk_count}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-zinc-700 whitespace-nowrap">
                      {item.top_speakers && item.top_speakers.length > 0
                        ? item.top_speakers.slice(0, 3).join(", ")
                        : "—"}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-zinc-600 max-w-[360px] truncate">
                      {item.snippet || "—"}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-zinc-500 max-w-[180px] truncate">
                      {item.source_file || "—"}
                    </td>
                    <td
                      className="py-2.5 px-4 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          addToBasket({
                            doc_type: item.doc_type,
                            meeting_date: item.meeting_date,
                            doc_type_label: item.doc_type_label,
                          })
                        }
                        disabled={isInBasket(item.doc_type, item.meeting_date)}
                        className="btn-secondary py-1 px-2.5 text-xs"
                      >
                        <GitCompare className="w-3 h-3" />
                        {isInBasket(item.doc_type, item.meeting_date) ? "In Basket" : "Compare"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Vertical Drag Resize Handle (Req 3.1) */}
      {!maximized && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Drag to resize results table vertically"
          onMouseDown={startTableResize}
          title="Drag up or down to resize results table"
          className="h-3 bg-zinc-50 border-t border-border hover:bg-accent-soft/70 cursor-ns-resize flex items-center justify-center transition-colors select-none"
        >
          <GripHorizontal className="w-4 h-3 text-muted" />
        </div>
      )}
    </div>
  );

  const explorerBlockingMessage =
    downloadingMeetingCsv === "all"
      ? `Downloading all documents for meeting ${selectedMeeting}...`
      : downloadingMeetingCsv === "single"
      ? `Downloading ${activeDocType} CSV for meeting ${selectedMeeting}...`
      : loadingBundle
      ? `Loading meeting bundle & chunks for ${selectedMeeting}...`
      : loadingSim
      ? `Computing prototype similarity matrix on server...`
      : searching
      ? `Filtering FOMC Parquet partitions on server...`
      : null;

  return (
    <div className="space-y-6 relative">
      {explorerBlockingMessage && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 bg-canvas/60 backdrop-blur-sm flex items-center justify-center p-4 cursor-wait select-none"
        >
          <div className="panel bg-surface border-accent px-6 py-4 shadow-2xl max-w-md w-full flex items-center gap-3.5">
            <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin shrink-0" />
            <div className="min-w-0">
              <div className="text-xs font-mono uppercase tracking-wider font-semibold text-accent-dark">
                Server Computing · Please Wait
              </div>
              <div className="text-xs font-mono text-ink mt-0.5 truncate">
                {explorerBlockingMessage}
              </div>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold">
            Database File Explorer
          </span>
          <h1 className="text-2xl font-bold text-ink mt-0.5">
            {loadedPortfolioTitle
              ? `Portfolio Query: ${loadedPortfolioTitle}`
              : "FOMC Corpus Search & Meeting Inspector"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const dtPart =
                docTypeFilters.length > 0 ? docTypeFilters.join(", ") : "All Types";
              setSavedSearchTitle(`Explorer Search (${dtPart} · ${dateFrom || "1976"}..${dateTo || "2020"})`);
              setSavedSearchDesc("");
              setSavedSearchPublic(false);
              setSaveSearchMsg(null);
              setSaveSearchOpen(true);
            }}
            className="btn-primary text-xs"
          >
            <Save className="w-3.5 h-3.5" />
            Save Search to Portfolio
          </button>
          <span className="mono-tag hidden md:inline-flex">DUCKDB PUSHDOWN · 1976–2020</span>
        </div>
      </div>

      {/* Multi-Criteria Search Bar (Auto-Reactive + Predefined Date Picker + Multi-Select Doc Types + Speaker + Extended Score Thresholds) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          executeSearch();
        }}
        className="panel p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setFiltersCollapsed((v) => !v)}
            aria-expanded={!filtersCollapsed}
            className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider font-semibold text-ink hover:text-accent-dark transition-colors"
          >
            {filtersCollapsed ? (
              <ChevronDown className="w-4 h-4 text-accent" />
            ) : (
              <ChevronUp className="w-4 h-4 text-accent" />
            )}
            <span>Multi-Criteria Search (Auto-Reactive)</span>
          </button>
          <div className="flex items-center gap-2">
            {searching && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-sm bg-accent-soft border border-accent text-[11px] font-mono text-accent-dark animate-pulse">
                Server computing: filtering Parquet partitions...
              </span>
            )}
            <span className="text-[10px] font-mono text-zinc-400 hidden sm:inline">
              {filtersCollapsed ? "Expand filters" : "Collapse filters"}
            </span>
          </div>
        </div>

        {!filtersCollapsed && (
          <>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Date From
            </label>
            <input
              type="date"
              min={CORPUS_MIN_DATE}
              max={CORPUS_MAX_DATE}
              value={dateFrom}
              onClick={openNativeDatePicker}
              onChange={(e) => setDateFrom(clampCorpusDate(e.target.value))}
              className="input-field font-mono text-xs cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Date To <span className="text-zinc-400 normal-case">(optional)</span>
            </label>
            <input
              type="date"
              min={CORPUS_MIN_DATE}
              max={CORPUS_MAX_DATE}
              value={dateTo}
              onClick={openNativeDatePicker}
              onChange={(e) => setDateTo(clampCorpusDate(e.target.value))}
              title="Leave empty to match Date From as an exact single date"
              className="input-field font-mono text-xs cursor-pointer"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Document Type (Multi-Select)
            </label>
            <MultiDocTypeSelect
              options={docTypes}
              selected={docTypeFilters}
              onChange={setDocTypeFilters}
              placeholder="All 7 Active Types"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Speaker Name
            </label>
            <SpeakerAutocomplete
              value={speakerFilter}
              onChange={setSpeakerFilter}
              placeholder="e.g., Bernanke, Volcker"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Full-Text / Substring
            </label>
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="e.g., inflation expectations"
              className="input-field text-xs"
            />
          </div>
        </div>

        {/* Quick Date Presets */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
          <span className="text-muted uppercase text-[10px] mr-1">Quick Periods:</span>
          {[
            { label: "2000–2001 (Default)", from: DEFAULT_DATE_FROM, to: DEFAULT_DATE_TO },
            { label: "1990–1999", from: "1990-01-01", to: "1999-12-31" },
            { label: "2000–2009", from: "2000-01-01", to: "2009-12-31" },
            { label: "2008 Crisis", from: "2007-08-01", to: "2009-12-31" },
            { label: "2010–2020", from: "2010-01-01", to: "2020-12-31" },
            { label: "Full Corpus (1976–2020)", from: CORPUS_MIN_DATE, to: CORPUS_MAX_DATE },
          ].map((preset) => {
            const active = dateFrom === preset.from && dateTo === preset.to;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setDateFrom(preset.from);
                  setDateTo(preset.to);
                }}
                className={`px-2 py-0.5 rounded-sm border transition-colors ${
                  active
                    ? "bg-ink text-white border-ink"
                    : "bg-surface text-muted border-border hover:border-ink hover:text-ink"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Extended Shared Score & Classifier Probability Threshold Filter (Req 2.2) */}
        <div className="pt-3 border-t border-border">
          <ScoreThresholdFilter
            value={scoreFilter}
            onChange={setScoreFilter}
            macroCategories={macroCategories}
          />
        </div>

        {/* Custom SQL Filter over text_metadata columns (server-side WHERE predicate) */}
        <div className="pt-3 border-t border-border space-y-2">
          <label className="block text-[11px] font-mono uppercase text-muted">
            Custom SQL Filter <span className="text-zinc-400 normal-case">(WHERE predicate)</span>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={sqlFilter}
              onChange={(e) => {
                setSqlFilter(e.target.value);
                setSelectedFilterId("");
              }}
              placeholder="e.g., char_count > 200"
              className="input-field font-mono text-xs flex-1 min-w-[220px]"
            />
            <select
              value={selectedFilterId}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedFilterId(id);
                const picked = savedFilters.find((f) => String(f.id) === id);
                if (picked) setSqlFilter(picked.sql_text);
              }}
              className="input-field text-xs w-auto min-w-[200px]"
            >
              <option value="">Saved filters...</option>
              {savedFilters.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.title}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!sqlFilter.trim()}
              onClick={() => {
                setFilterTitle("");
                setFilterDesc("");
                setFilterPublic(false);
                setFilterModalMsg(null);
                setFilterModalOpen(true);
              }}
              className="btn-secondary text-xs"
            >
              <Save className="w-3.5 h-3.5" />
              Save Filter
            </button>
          </div>
          <p className="text-[10px] font-mono text-zinc-400">
            Applied server-side over text_metadata columns (e.g. char_count &gt; 200).
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs font-mono text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
                className="accent-ink"
              />
              Enable Regex Pushdown
            </label>
            <span className="text-[11px] font-mono text-zinc-400">
              Results update automatically as you adjust any parameter.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDateFrom(DEFAULT_DATE_FROM);
                setDateTo(DEFAULT_DATE_TO);
                setSpeakerFilter("");
                setDocTypeFilters([]);
                setQueryText("");
                setUseRegex(false);
                setScoreFilter(EMPTY_SCORE_THRESHOLD_FILTER);
                setSqlFilter("");
                setSelectedFilterId("");
              }}
              className="btn-secondary text-xs"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset to Default (2000–2001)
            </button>
          </div>
        </div>
          </>
        )}
      </form>

      {searchError && (
        <div className="panel border-red-300 bg-red-50 p-3 text-xs font-mono text-red-700">
          {searchError}
        </div>
      )}

      {/* Search Results Table (Vertically Resizable + Locally Filterable + Maximizable) */}
      {tableMaximized && (
        <div
          className="fixed inset-0 z-40 bg-black/45"
          onClick={() => setTableMaximized(false)}
        />
      )}
      {renderMatchingDocumentsPanel(tableMaximized)}

      {/* Column Distributions: client-side histograms & categorical frequencies over current results */}
      <div className="panel overflow-hidden">
        <button
          type="button"
          onClick={() => setDistCollapsed((v) => !v)}
          aria-expanded={!distCollapsed}
          className="w-full px-4 py-3 flex items-center justify-between gap-2 bg-zinc-50/70 hover:bg-zinc-100 transition-colors text-left"
        >
          <span className="text-xs font-mono uppercase text-muted font-semibold">
            Column Distributions ({results.length} documents)
          </span>
          <span className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-400">
            {distCollapsed ? "Expand" : "Collapse"}
            {distCollapsed ? (
              <ChevronDown className="w-4 h-4 text-accent" />
            ) : (
              <ChevronUp className="w-4 h-4 text-accent" />
            )}
          </span>
        </button>
        {!distCollapsed && (
          <div className="p-4 border-t border-border">
            {columnDistributions.length === 0 ? (
              <p className="text-xs font-mono text-zinc-400">
                No results to summarize. Run a search first.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                {columnDistributions.map((chart) => (
                  <div key={chart.key} className="border border-border rounded-sm bg-canvas p-2">
                    <div className="text-[10px] font-mono uppercase text-muted mb-1 truncate">
                      {chart.title}
                    </div>
                    <EChartBox option={chart.option} className="h-40" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Meeting Bundle & Analytical Inspector */}
      {selectedMeeting && (
        <section className="panel p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="mono-tag border-ink bg-ink text-white">MEETING {selectedMeeting}</span>
                <span className="text-xs font-mono text-muted">
                  {bundle
                    ? `${bundle.siblings.length} sibling ${bundle.siblings.length === 1 ? "doc" : "docs"}`
                    : "Loading bundle..."}
                </span>
              </div>
              <h2 className="text-xl font-semibold text-ink mt-1.5">
                {activeSibling?.doc_type_label || activeDocType}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={downloadingMeetingCsv !== null}
                onClick={() => downloadMeetingChunksCsv("single")}
                title="Download CSV of the selected document in this meeting"
                className="btn-secondary text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                {downloadingMeetingCsv === "single"
                  ? "Downloading Doc CSV..."
                  : `Download ${activeSibling?.doc_type_label || activeDocType} CSV`}
              </button>
              <button
                type="button"
                disabled={downloadingMeetingCsv !== null}
                onClick={() => downloadMeetingChunksCsv("all")}
                title="Download CSV with all documents matching this meeting date"
                className="btn-secondary text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                {downloadingMeetingCsv === "all"
                  ? "Downloading All Meeting Docs..."
                  : `Download All Meeting Docs CSV (${bundle?.siblings.length || 1})`}
              </button>
              <button
                type="button"
                onClick={() =>
                  addToBasket({
                    doc_type: activeDocType,
                    meeting_date: selectedMeeting,
                    doc_type_label: activeSibling?.doc_type_label || activeDocType,
                  })
                }
                disabled={isInBasket(activeDocType, selectedMeeting)}
                className="btn-secondary text-xs"
              >
                <GitCompare className="w-3.5 h-3.5" />
                {isInBasket(activeDocType, selectedMeeting)
                  ? "Added to Comparator"
                  : "Add to Comparator"}
              </button>
              <button
                type="button"
                onClick={() => setSaveModalOpen(true)}
                className="btn-primary text-xs"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                Save Meeting to List
              </button>
            </div>
          </div>

          {/* Sibling Documents Tabs */}
          {bundle && bundle.siblings.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-mono uppercase text-muted flex items-center gap-1.5">
                <Layers className="w-3 h-3" />
                Sibling Documents in This FOMC Meeting Bundle ({bundle.siblings.length}{" "}
                {bundle.siblings.length === 1 ? "doc" : "docs"})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {bundle.siblings.map((sib) => (
                  <button
                    key={sib.document_id}
                    type="button"
                    onClick={() => openDocument(selectedMeeting, sib.doc_type, false)}
                    className={`px-3 py-1.5 text-xs font-mono rounded-sm border transition-colors ${
                      sib.doc_type === activeDocType
                        ? "bg-ink text-white border-ink"
                        : "bg-surface text-zinc-700 border-border hover:border-ink"
                    }`}
                  >
                    {sib.doc_type_label}{" "}
                    <span className="opacity-65">
                      ({sib.chunk_count} {sib.chunk_count === 1 ? "chunk" : "chunks"})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Inspector Mode Tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b border-border">
            <button
              type="button"
              onClick={() => setInspectorTab("chunks")}
              className={`px-3.5 py-2 text-xs font-mono uppercase border-b-2 transition-colors flex items-center gap-1.5 ${
                inspectorTab === "chunks"
                  ? "border-ink text-ink font-semibold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Document Chunks
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab("zeroshot")}
              className={`px-3.5 py-2 text-xs font-mono uppercase border-b-2 transition-colors flex items-center gap-1.5 ${
                inspectorTab === "zeroshot"
                  ? "border-ink text-ink font-semibold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Zero-Shot Inspector
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab("relevance")}
              className={`px-3.5 py-2 text-xs font-mono uppercase border-b-2 transition-colors flex items-center gap-1.5 ${
                inspectorTab === "relevance"
                  ? "border-ink text-ink font-semibold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Relevance Probabilities
            </button>
            <button
              type="button"
              onClick={() => setInspectorTab("heatmap")}
              className={`px-3.5 py-2 text-xs font-mono uppercase border-b-2 transition-colors flex items-center gap-1.5 ${
                inspectorTab === "heatmap"
                  ? "border-ink text-ink font-semibold"
                  : "border-transparent text-muted hover:text-ink"
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              Prototype Similarity Matrix
            </button>
          </div>

          {/* Tab Panel 1: Document Chunks */}
          {inspectorTab === "chunks" && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    setFeedbackModal({
                      open: true,
                      kind: "feedback_chunk",
                      originalTableId: `${activeDocType}::${selectedMeeting}`,
                    })
                  }
                  className="btn-secondary py-1 px-2.5 text-xs"
                >
                  <Flag className="w-3.5 h-3.5 text-accent" />
                  Report Error / Feedback
                </button>
              </div>

              <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
                {loadingBundle ? (
                  <p className="text-xs font-mono text-muted py-6">Loading chunks...</p>
                ) : bundle && bundle.chunks.length > 0 ? (
                  bundle.chunks.map((ch) => (
                    <div key={ch.chunk_id} className="border border-border p-3.5 rounded-sm bg-canvas">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="mono-tag">#{ch.sequence_num}</span>
                          {ch.speaker && (
                            <span className="text-xs font-semibold text-ink">{ch.speaker}</span>
                          )}
                          {ch.section && (
                            <span className="text-[11px] font-mono text-muted">{ch.section}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-zinc-400">{ch.chunk_id}</span>
                          <button
                            type="button"
                            title="Report error on this chunk"
                            onClick={() =>
                              setFeedbackModal({
                                open: true,
                                kind: "feedback_chunk",
                                originalTableId: ch.chunk_id,
                                chunkText: ch.text_content.slice(0, 400),
                              })
                            }
                            className="text-zinc-400 hover:text-ink"
                          >
                            <Flag className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
                        {ch.text_content}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs font-mono text-muted py-6">
                    No text chunks available for this document slice.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Tab Panel 2: Zero-Shot Inspector */}
          {inspectorTab === "zeroshot" && (
            <ClassificationInspector
              mode="zero_shot"
              docType={activeDocType}
              meetingDate={selectedMeeting}
              data={zeroShot}
              speakerFilter={inspectorSpeaker}
              onSpeakerFilterChange={setInspectorSpeaker}
              macroCategories={macroCategories}
            />
          )}

          {/* Tab Panel 3: Relevance Probabilities */}
          {inspectorTab === "relevance" && (
            <ClassificationInspector
              mode="relevance"
              docType={activeDocType}
              meetingDate={selectedMeeting}
              data={relevance}
              speakerFilter={inspectorSpeaker}
              onSpeakerFilterChange={setInspectorSpeaker}
              macroCategories={macroCategories}
            />
          )}

          {/* Tab Panel 4: Interactive Prototype Similarity Matrix (Multi-Select & Range + Text + Histogram) */}
          {inspectorTab === "heatmap" && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-4 p-3.5 border border-border bg-zinc-50/70 rounded-sm">
                <div>
                  <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                    Metric Transform
                  </label>
                  <div className="inline-flex border border-border rounded-sm overflow-hidden bg-surface">
                    {(["cosine", "softmax", "log"] as MetricTransform[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setSimMetric(m)}
                        className={`px-3 py-1 text-xs font-mono capitalize ${
                          simMetric === m ? "bg-ink text-white" : "text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                    Normalization
                  </label>
                  <div className="inline-flex border border-border rounded-sm overflow-hidden bg-surface">
                    {(
                      [
                        { id: "none", label: "None" },
                        { id: "topic", label: "Topic" },
                        { id: "slice", label: "Time" },
                      ] as { id: NormalizationMode; label: string }[]
                    ).map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSimNorm(n.id)}
                        className={`px-3 py-1 text-xs font-mono ${
                          simNorm === n.id ? "bg-ink text-white" : "text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        {n.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                    Taxonomy Level
                  </label>
                  <select
                    value={simGranularity}
                    onChange={(e) => setSimGranularity(e.target.value as GranularityMode)}
                    className="input-field py-1 text-xs font-mono"
                  >
                    <option value="macro">13 Macro-Categories</option>
                    <option value="subclass">Sub-Class Drill-Down</option>
                  </select>
                </div>

                {simGranularity === "subclass" && (
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                      Parent Category
                    </label>
                    <select
                      value={simMacroDrill}
                      onChange={(e) => setSimMacroDrill(e.target.value)}
                      className="input-field py-1 text-xs font-mono"
                    >
                      {macroCategories
                        .filter((c) => c.has_subclasses)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setFeedbackModal({
                      open: true,
                      kind: "feedback_similarity",
                      originalTableId: `${activeDocType}::${selectedMeeting}::${simMetric}::${simNorm}`,
                    })
                  }
                  className="btn-secondary py-1 px-2.5 text-xs ml-auto"
                >
                  <Flag className="w-3.5 h-3.5 text-accent" />
                  Report Error / Feedback
                </button>
              </div>

              {loadingSim ? (
                <p className="text-xs font-mono text-muted py-10 text-center">
                  Computing similarity heatmap...
                </p>
              ) : simData && simData.available ? (
                <div className="space-y-4">
                  {/* Selection Controls Bar (Click multi-select, Shift+Click range, explicit range input & Clean/Reset) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-muted">
                    <span>
                      Y-Axis: Topics ({simData.categories.length}) · X-Axis: Chunk Sequence (
                      {simData.displayed_slices || simData.chunk_ids.length} slices) ·{" "}
                      <strong className="text-ink">
                        Click cells to multi-select · Shift+Click for range
                      </strong>
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        max={simData.chunk_ids.length}
                        value={rangeStartInput}
                        onChange={(e) => setRangeStartInput(e.target.value)}
                        placeholder="From #"
                        className="input-field py-0.5 px-2 text-[11px] font-mono w-20"
                      />
                      <span>–</span>
                      <input
                        type="number"
                        min={1}
                        max={simData.chunk_ids.length}
                        value={rangeEndInput}
                        onChange={(e) => setRangeEndInput(e.target.value)}
                        placeholder="To #"
                        className="input-field py-0.5 px-2 text-[11px] font-mono w-20"
                      />
                      <button
                        type="button"
                        onClick={handleApplySliceRange}
                        className="btn-secondary py-0.5 px-2 text-[11px]"
                      >
                        Select Range
                      </button>
                      {selectedSimSlices.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSimSlices([]);
                            setLastClickedSlice(null);
                          }}
                          className="btn-secondary py-0.5 px-2.5 text-[11px] text-red-600"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Clean / Reset ({selectedSimSlices.length})
                        </button>
                      )}
                    </div>
                  </div>

                  <EChartBox
                    option={heatmapOption}
                    className="w-full h-[460px]"
                    onChartClick={handleHeatmapClick}
                  />

                  {/* Bottom Panel: Selected Chunks Full Text + Synchronized Category Score Histograms (Req 3.2) */}
                  {selectedSimSlices.length > 0 && (
                    <div className="border border-accent/50 rounded-sm bg-canvas overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-border bg-accent-soft/50 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-mono uppercase font-semibold text-accent-dark">
                          Selected Similarity Chunks ({selectedSimSlices.length}) · Full Text &amp;
                          Category Score Histograms
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSimSlices([]);
                            setLastClickedSlice(null);
                          }}
                          className="btn-secondary py-1 px-2.5 text-xs"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Clean / Reset
                        </button>
                      </div>

                      <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto">
                        {loadingSelectedChunks && (
                          <p className="text-xs font-mono text-muted">
                            Loading full text for selected chunks...
                          </p>
                        )}
                        {selectedSimSlices.map((sliceIdx) => {
                          const cid = simData.chunk_ids[sliceIdx] || `Slice #${sliceIdx + 1}`;
                          const chunkObj =
                            selectedChunksMap[cid] ||
                            bundle?.chunks.find((c) => c.chunk_id === cid) ||
                            null;
                          return (
                            <div
                              key={sliceIdx}
                              className="panel p-4 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start"
                            >
                              <div className="lg:col-span-6 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span className="mono-tag border-accent text-accent-dark bg-accent-soft">
                                      Slice #{sliceIdx + 1}
                                    </span>
                                    {chunkObj?.speaker && (
                                      <span className="text-xs font-semibold text-ink">
                                        {chunkObj.speaker}
                                      </span>
                                    )}
                                    {chunkObj?.section && (
                                      <span className="text-[11px] font-mono text-muted">
                                        {chunkObj.section}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-mono text-muted">{cid}</span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedSimSlices((prev) =>
                                          prev.filter((x) => x !== sliceIdx)
                                        )
                                      }
                                      title="Remove from selection"
                                      className="text-muted hover:text-ink"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="text-sm text-ink leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto pr-1 border-t border-border/60 pt-2">
                                  {chunkObj?.text_content ||
                                    (simData.downsampled
                                      ? `Aggregated slice (${cid}) representing multiple downsampled chunks.`
                                      : "Loading chunk text...")}
                                </div>
                              </div>

                              <div className="lg:col-span-6">
                                <div className="text-[10px] font-mono uppercase text-muted mb-1">
                                  Category Score Histogram ({simMetric} · {simNorm})
                                </div>
                                <EChartBox
                                  option={buildChunkHistogramOption(sliceIdx)}
                                  className="w-full h-[260px]"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 border border-border bg-zinc-50 text-xs font-mono text-muted">
                  Prototype similarity vectors are not available for this document slice.
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Save Explorer Search to Portfolio Modal (Req 4.4) */}
      {saveSearchOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="panel w-full max-w-md bg-surface shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-zinc-50 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono uppercase font-semibold text-ink">
                <Save className="w-3.5 h-3.5 text-accent" />
                Save Explorer Search to Portfolio
              </div>
              <button
                type="button"
                onClick={() => setSaveSearchOpen(false)}
                className="text-muted hover:text-ink p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSearchToPortfolio} className="p-4 space-y-3">
              <p className="text-[11px] font-mono text-muted">
                Stores only the search parameters and applied filters (no full text or raw results).
                Loading from Portfolio reconstructs the view by re-running the query.
              </p>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={savedSearchTitle}
                  onChange={(e) => setSavedSearchTitle(e.target.value)}
                  className="input-field text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={savedSearchDesc}
                  onChange={(e) => setSavedSearchDesc(e.target.value)}
                  className="input-field text-xs"
                  placeholder="Describe this search query..."
                />
              </div>
              <div className="flex items-center justify-between border border-border rounded-sm px-3 py-2 bg-canvas">
                <span className="text-xs font-mono text-ink flex items-center gap-1.5">
                  {savedSearchPublic ? (
                    <Globe className="w-3.5 h-3.5 text-accent" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-muted" />
                  )}
                  Visibility: <strong>{savedSearchPublic ? "Public" : "Private"}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setSavedSearchPublic((v) => !v)}
                  className="btn-secondary py-1 px-2.5 text-[11px]"
                >
                  Switch to {savedSearchPublic ? "Private" : "Public"}
                </button>
              </div>
              {saveSearchMsg && (
                <div className="text-xs font-mono text-accent-dark">{saveSearchMsg}</div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSaveSearchOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingSearch} className="btn-primary text-xs">
                  <Save className="w-3.5 h-3.5" />
                  {savingSearch ? "Saving..." : "Save to Portfolio"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Save Custom SQL Filter Modal */}
      {filterModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="panel w-full max-w-md bg-surface shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border bg-zinc-50 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono uppercase font-semibold text-ink">
                <Filter className="w-3.5 h-3.5 text-accent" />
                Save Custom SQL Filter
              </div>
              <button
                type="button"
                onClick={() => setFilterModalOpen(false)}
                className="text-muted hover:text-ink p-0.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateFilter} className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={filterTitle}
                  onChange={(e) => setFilterTitle(e.target.value)}
                  className="input-field text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={filterDesc}
                  onChange={(e) => setFilterDesc(e.target.value)}
                  className="input-field text-xs"
                  placeholder="What does this predicate select?"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  SQL Predicate
                </label>
                <code className="block px-2 py-1.5 border border-border rounded-sm bg-canvas font-mono text-[11px] text-ink break-all">
                  {sqlFilter}
                </code>
              </div>
              <div className="flex items-center justify-between border border-border rounded-sm px-3 py-2 bg-canvas">
                <span className="text-xs font-mono text-ink flex items-center gap-1.5">
                  {filterPublic ? (
                    <Globe className="w-3.5 h-3.5 text-accent" />
                  ) : (
                    <Lock className="w-3.5 h-3.5 text-muted" />
                  )}
                  Visibility: <strong>{filterPublic ? "Public" : "Private"}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setFilterPublic((v) => !v)}
                  className="btn-secondary py-1 px-2.5 text-[11px]"
                >
                  Switch to {filterPublic ? "Private" : "Public"}
                </button>
              </div>
              {filterModalMsg && (
                <div className="text-xs font-mono text-red-600">{filterModalMsg}</div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setFilterModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingFilter} className="btn-primary text-xs">
                  <Save className="w-3.5 h-3.5" />
                  {savingFilter ? "Saving..." : "Save Filter"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedMeeting && (
        <SaveToListModal
          open={saveModalOpen}
          onClose={() => setSaveModalOpen(false)}
          meetingDate={selectedMeeting}
          docType={activeDocType}
          docTypeLabel={activeSibling?.doc_type_label || activeDocType}
        />
      )}

      {selectedMeeting && (
        <FeedbackModal
          open={feedbackModal.open}
          onClose={() => setFeedbackModal((prev) => ({ ...prev, open: false }))}
          kind={feedbackModal.kind}
          docType={activeDocType}
          meetingDate={selectedMeeting}
          originalTableId={feedbackModal.originalTableId}
          chunkText={feedbackModal.chunkText}
        />
      )}
    </div>
  );
};
