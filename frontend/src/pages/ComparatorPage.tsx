/** Tab 3: Document Comparator V5
 *
 * Features:
 * - Uncapped document selection & uncapped Grouping Tree (no 20-leaf / 20-series cap)
 * - Chronologically flattened Time-Series: each (Cohort, Topic) renders as ONE continuous
 *   curve spanning M meetings/periods x S sequential intra-period slices
 * - 3-level Semantic Zoom on the X-axis:
 *     Macro (Years only) -> Meso (Year + Month / Meeting Date) -> Micro (Slice 1..S with period boundaries)
 * - Anti-Clutter 1-Topic Initial Default + Interactive Topic & Cohort Curve Toggles + Hover Highlighting
 * - Radar Chart synchronized cleanly with the chronological slice scrubber (Range Slider + < / > buttons)
 * - Clickable Tree Nodes & Time-Series Data Points -> Deep Drill-Down Slice & Subgroup Inspector Drawer
 * - 3 Significant Figures precision across all tooltips + CSV Export + Save/Fork Study
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type * as echarts from "echarts";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  GitBranch,
  GitFork,
  Image as ImageIcon,
  Layers,
  ListPlus,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { EChartBox } from "../components/EChartBox";
import { GroupingTreeModal } from "../components/GroupingTreeModal";
import { MultiDocTypeSelect } from "../components/MultiDocTypeSelect";
import {
  EMPTY_SCORE_THRESHOLD_FILTER,
  ScoreThresholdFilter,
  type ScoreThresholdFilterValue,
} from "../components/ScoreThresholdFilter";
import {
  SliceInspectorDrawer,
  type SliceInspectorTarget,
} from "../components/SliceInspectorDrawer";
import { SpeakerAutocomplete } from "../components/SpeakerAutocomplete";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { DOCUMENT_COLORS, useWorkspace } from "../context/WorkspaceContext";
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
  AggregationMethod,
  BasketChunksResponse,
  CompareResponse,
  CustomFilter,
  DataSourceMode,
  DocTypeOption,
  GranularityMode,
  GroupingTreeConfig,
  MacroCategoryItem,
  MetricTransform,
  NormalizationMode,
  OrderedTimeSeriesCohort,
  PathFilterItem,
  SearchDocumentItem,
  StudyConfig,
  StudyItem,
  TimeTickMeta,
} from "../types/api";

type TimeSeriesGlobalScoreMode =
  | "zero_shot"
  | "sim_softmax"
  | "sim_cosine"
  | "sim_none"
  | "relevance";

type TimeSeriesNormScope = "per_instance" | "global";
type TimeSeriesNormDimension = "value" | "time";

interface CustomTimeSeriesDef {
  id: string;
  name: string;
  cohortId: string;
  topicId: string;
  dateFrom: string;
  dateTo: string;
}

export const ComparatorPage: React.FC = () => {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const { basket, setBasket, addToBasket, addManyToBasket, removeFromBasket, clearBasket } =
    useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // Reference metadata
  const [docTypes, setDocTypes] = useState<DocTypeOption[]>([]);
  const [macroCategories, setMacroCategories] = useState<MacroCategoryItem[]>([]);

  // Basket search filters (Multi-select Document Type, Default Date Range 2000–2001, Speaker, Extended Score Thresholds)
  const [searchDocTypes, setSearchDocTypes] = useState<string[]>([]);
  const [searchDateFrom, setSearchDateFrom] = useState(DEFAULT_DATE_FROM);
  const [searchDateTo, setSearchDateTo] = useState(DEFAULT_DATE_TO);
  const [searchSpeaker, setSearchSpeaker] = useState("");
  const [searchText, setSearchText] = useState("");
  const [scoreFilter, setScoreFilter] = useState<ScoreThresholdFilterValue>(
    EMPTY_SCORE_THRESHOLD_FILTER
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sqlFilter, setSqlFilter] = useState("");
  const [savedFilters, setSavedFilters] = useState<CustomFilter[]>([]);
  const [selectedFilterId, setSelectedFilterId] = useState("");
  const [savingFilter, setSavingFilter] = useState(false);
  const [candidates, setCandidates] = useState<SearchDocumentItem[]>([]);
  const [candidatesTotal, setCandidatesTotal] = useState<number>(0);
  const [searching, setSearching] = useState(false);
  const [addingAll, setAddingAll] = useState(false);

  // Live reactive comparison controls
  const [nPartitions, setNPartitions] = useState<number>(1);
  const [radarTickIdx, setRadarTickIdx] = useState<number>(0);
  const [dataSource, setDataSource] = useState<DataSourceMode>("similarity");
  const [metric, setMetric] = useState<MetricTransform>("cosine");
  const [normalization, setNormalization] = useState<NormalizationMode>("none");
  const [granularity, setGranularity] = useState<GranularityMode>("macro");
  const [macroCategory, setMacroCategory] = useState<string>("growth");
  const [aggMethod, setAggMethod] = useState<AggregationMethod>("mean");

  // V5 Uncapped Hierarchical Grouping Tree state
  const [groupingTree, setGroupingTree] = useState<GroupingTreeConfig | null>(null);
  const [treeModalOpen, setTreeModalOpen] = useState(false);

  // Radar Document Multi-Select (Default: only 1 document plotted, dynamic legend)
  const [selectedRadarDocIds, setSelectedRadarDocIds] = useState<string[]>([]);

  // User-Defined Custom Time-Series Builder & Global Time-Series Controls (Default: empty)
  const [customTimeSeries, setCustomTimeSeries] = useState<CustomTimeSeriesDef[]>([]);
  const [addingSeriesOpen, setAddingSeriesOpen] = useState<boolean>(false);
  const [draftSeriesCohortId, setDraftSeriesCohortId] = useState<string>("");
  const [draftSeriesTopicId, setDraftSeriesTopicId] = useState<string>("");
  const [draftSeriesDateFrom, setDraftSeriesDateFrom] = useState<string>("");
  const [draftSeriesDateTo, setDraftSeriesDateTo] = useState<string>("");
  const [draftSeriesName, setDraftSeriesName] = useState<string>("");
  const [editingSeriesId, setEditingSeriesId] = useState<string | null>(null);

  // Global Time-Series Score & Normalization settings (acting strictly on defined series)
  const [tsScoreMode, setTsScoreMode] = useState<TimeSeriesGlobalScoreMode>("sim_cosine");
  const [tsNormEnabled, setTsNormEnabled] = useState<boolean>(false);
  const [tsNormScope, setTsNormScope] = useState<TimeSeriesNormScope>("per_instance");
  const [tsNormDimension, setTsNormDimension] = useState<TimeSeriesNormDimension>("value");
  const [tsComparison, setTsComparison] = useState<CompareResponse | null>(null);
  const [loadingTs, setLoadingTs] = useState<boolean>(false);
  const tsChartRef = useRef<echarts.ECharts | null>(null);

  // Exhaustive Basket Raw Chunks Table state (50-row preview + full CSV download)
  const [basketChunksData, setBasketChunksData] = useState<BasketChunksResponse | null>(null);
  const [loadingBasketChunks, setLoadingBasketChunks] = useState<boolean>(false);
  const [exportingBasketCsv, setExportingBasketCsv] = useState<boolean>(false);

  // Semantic zoom window
  const [zoomWindow, setZoomWindow] = useState<[number, number]>([0, 100]);
  const [showSplitsManual, setShowSplitsManual] = useState<boolean>(false);

  // Deep Drill-Down Slice & Subgroup Inspector Drawer
  const [inspectorTarget, setInspectorTarget] = useState<SliceInspectorTarget | null>(null);

  // Active loaded study (for Save vs Fork behavior)
  const [loadedStudy, setLoadedStudy] = useState<StudyItem | null>(null);
  const [studyModalOpen, setStudyModalOpen] = useState(false);
  const [studyTitle, setStudyTitle] = useState("");
  const [studyDesc, setStudyDesc] = useState("");
  const [studyPublic, setStudyPublic] = useState(false);
  const [savingStudy, setSavingStudy] = useState(false);
  const [studyFeedback, setStudyFeedback] = useState<string | null>(null);

  // Comparison result
  const [comparison, setComparison] = useState<CompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getDocTypes().then((r) => setDocTypes(r.doc_types)).catch(() => {});
    api.getTaxonomy().then((t) => setMacroCategories(t.macro_categories)).catch(() => {});
  }, []);

  const loadMyFilters = useCallback(async () => {
    const res = await api.listMyFilters();
    setSavedFilters(res.items);
  }, []);

  useEffect(() => {
    loadMyFilters().catch(() => {});
  }, [loadMyFilters]);

  const handleSaveSqlFilter = async () => {
    const sql = sqlFilter.trim();
    if (!sql) return;
    setSavingFilter(true);
    try {
      await api.createFilter({
        title: `Filter (${sql.slice(0, 30)})`,
        description: "",
        sql_text: sql,
        is_public: false,
      });
      await loadMyFilters();
    } finally {
      setSavingFilter(false);
    }
  };

  // Load study if ?study=<id> is present
  useEffect(() => {
    const studyIdParam = searchParams.get("study");
    if (!studyIdParam) {
      setLoadedStudy(null);
      return;
    }
    const sid = Number(studyIdParam);
    if (!sid) return;
    api
      .getStudy(sid)
      .then((st) => {
        setLoadedStudy(st);
        setStudyTitle(st.title);
        setStudyDesc(st.description);
        setStudyPublic(st.is_public);
        const cfg = st.config;
        if (cfg) {
          if (Array.isArray(cfg.basket)) setBasket(cfg.basket);
          if (cfg.n_partitions) setNPartitions(cfg.n_partitions);
          if (cfg.selected_slice) setRadarTickIdx(Math.max(0, cfg.selected_slice - 1));
          if (cfg.data_source) setDataSource(cfg.data_source);
          if (cfg.metric) setMetric(cfg.metric);
          if (cfg.normalization) setNormalization(cfg.normalization);
          if (cfg.granularity) setGranularity(cfg.granularity);
          if (cfg.macro_category) setMacroCategory(cfg.macro_category);
          if (cfg.agg_method) setAggMethod(cfg.agg_method);
          if (cfg.grouping_tree) setGroupingTree(cfg.grouping_tree);
        }
      })
      .catch(() => {});
  }, [searchParams, setBasket]);

  const buildFilterParams = (limit: number) => {
    const effFrom = clampCorpusDate(searchDateFrom);
    const effTo = clampCorpusDate(searchDateTo);
    return {
      doc_types: searchDocTypes.length > 0 ? searchDocTypes : undefined,
      date_from: effFrom || undefined,
      date_to: effTo || undefined,
      speaker: searchSpeaker || undefined,
      query_text: searchText || undefined,
      filter_category: scoreFilter.filterCategory || undefined,
      filter_metric: scoreFilter.filterCategory ? scoreFilter.filterMetric : undefined,
      filter_normalization: scoreFilter.filterCategory ? scoreFilter.filterNorm : undefined,
      filter_min_score:
        scoreFilter.filterCategory && scoreFilter.filterMinScore.trim() !== ""
          ? Number(scoreFilter.filterMinScore)
          : undefined,
      filter_zs_category: scoreFilter.filterZsCategory || undefined,
      filter_zs_min_prob:
        scoreFilter.filterZsCategory && scoreFilter.filterZsMinProb.trim() !== ""
          ? Number(scoreFilter.filterZsMinProb)
          : undefined,
      filter_rel_class: scoreFilter.filterRelClass || undefined,
      filter_rel_min_prob:
        scoreFilter.filterRelClass && scoreFilter.filterRelMinProb.trim() !== ""
          ? Number(scoreFilter.filterRelMinProb)
          : undefined,
      sql_filter: sqlFilter.trim() || undefined,
      limit,
      offset: 0,
    };
  };

  const runCandidateSearch = async () => {
    setSearching(true);
    try {
      const res = await api.searchDocuments(buildFilterParams(50));
      setCandidates(res.items);
      setCandidatesTotal(res.total);
    } finally {
      setSearching(false);
    }
  };

  const handleAddAllMatching = async () => {
    if (candidatesTotal === 0) return;
    setAddingAll(true);
    try {
      let allItems = candidates;
      if (candidatesTotal > candidates.length) {
        const res = await api.searchDocuments(
          buildFilterParams(Math.min(candidatesTotal, 2000))
        );
        allItems = res.items;
      }
      addManyToBasket(
        allItems.map((c) => ({
          doc_type: c.doc_type,
          meeting_date: c.meeting_date,
          doc_type_label: c.doc_type_label,
        }))
      );
    } finally {
      setAddingAll(false);
    }
  };

  // Auto-update candidate search whenever any filter parameter changes (debounced 220ms)
  useEffect(() => {
    const timer = window.setTimeout(() => {
      runCandidateSearch();
    }, 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchDocTypes,
    searchDateFrom,
    searchDateTo,
    searchSpeaker,
    searchText,
    scoreFilter,
    sqlFilter,
  ]);

  // Temporal Partitions (S) is ONLY available when comparing 1 distinct meeting date (Req 9)
  const distinctMeetingCount = useMemo(
    () => new Set(basket.map((d) => d.meeting_date)).size,
    [basket]
  );
  const effectiveNPartitions = distinctMeetingCount === 1 ? nPartitions : 1;

  // Group basket documents by doc_type for clean visual separation (Req 6)
  const basketByDocType = useMemo(() => {
    const map = new Map<
      string,
      { doc_type: string; doc_type_label: string; items: typeof basket }
    >();
    for (const item of basket) {
      const existing = map.get(item.doc_type);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(item.doc_type, {
          doc_type: item.doc_type,
          doc_type_label: item.doc_type_label || item.doc_type,
          items: [item],
        });
      }
    }
    return Array.from(map.values());
  }, [basket]);

  // Live reactive comparison query (uncapped for both ungrouped and tree-grouped modes)
  useEffect(() => {
    if (basket.length === 0) {
      setComparison(null);
      setError(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .compareDocuments({
          documents: basket.map((d) => ({ doc_type: d.doc_type, meeting_date: d.meeting_date })),
          n_partitions: effectiveNPartitions,
          data_source: dataSource,
          metric,
          normalization,
          granularity,
          macro_category: granularity === "subclass" ? macroCategory : null,
          combine_by: groupingTree ? "tree" : "none",
          agg_method: aggMethod,
          grouping_tree: groupingTree,
        })
        .then((res) => {
          if (cancelled) return;
          setComparison(res);
          setZoomWindow([0, 100]);
          setRadarTickIdx(0);
          const avail = (res.series || []).filter(
            (s) => s.available && Array.isArray(s.partitions) && s.partitions.length > 0
          );
          setSelectedRadarDocIds((prev) => {
            const validPrev = prev.filter((id) => avail.some((s) => s.document_id === id));
            if (validPrev.length > 0) return validPrev;
            return avail.length > 0 ? [avail[0].document_id] : [];
          });
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Comparison failed");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    basket,
    effectiveNPartitions,
    dataSource,
    metric,
    normalization,
    granularity,
    macroCategory,
    groupingTree,
    aggMethod,
  ]);

  // Dedicated Time-Series un-normalized source fetch driven by Global Time-Series Score selector
  const tsSourceAndMetric = useMemo<{
    source: DataSourceMode;
    metric: MetricTransform;
  }>(() => {
    if (tsScoreMode === "zero_shot") return { source: "zero_shot", metric: "cosine" };
    if (tsScoreMode === "relevance") return { source: "relevance", metric: "cosine" };
    if (tsScoreMode === "sim_softmax") return { source: "similarity", metric: "softmax" };
    return { source: "similarity", metric: "cosine" };
  }, [tsScoreMode]);

  useEffect(() => {
    if (basket.length === 0) {
      setTsComparison(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingTs(true);
      api
        .compareDocuments({
          documents: basket.map((d) => ({ doc_type: d.doc_type, meeting_date: d.meeting_date })),
          n_partitions: effectiveNPartitions,
          data_source: tsSourceAndMetric.source,
          metric: tsSourceAndMetric.metric,
          normalization: "none",
          granularity,
          macro_category: granularity === "subclass" ? macroCategory : null,
          combine_by: groupingTree ? "tree" : "none",
          agg_method: aggMethod,
          grouping_tree: groupingTree,
        })
        .then((res) => {
          if (!cancelled) setTsComparison(res);
        })
        .catch(() => {
          if (!cancelled) setTsComparison(null);
        })
        .finally(() => {
          if (!cancelled) setLoadingTs(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    basket,
    effectiveNPartitions,
    tsSourceAndMetric.source,
    tsSourceAndMetric.metric,
    granularity,
    macroCategory,
    groupingTree,
    aggMethod,
  ]);

  // Fetch 50-row preview of exhaustive raw basket chunks and classifier scores
  useEffect(() => {
    if (basket.length === 0) {
      setBasketChunksData(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoadingBasketChunks(true);
      api
        .getBasketChunks({
          documents: basket.map((d) => ({ doc_type: d.doc_type, meeting_date: d.meeting_date })),
          data_source: dataSource,
          limit: 50,
        })
        .then((res) => {
          if (!cancelled) setBasketChunksData(res);
        })
        .catch(() => {
          if (!cancelled) setBasketChunksData(null);
        })
        .finally(() => {
          if (!cancelled) setLoadingBasketChunks(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [basket, dataSource]);

  // Unified chronologically flattened timeline returned by backend (M meetings/periods x S slices)
  const resolvedTimeSeries = useMemo<{
    ticks: TimeTickMeta[];
    cohorts: OrderedTimeSeriesCohort[];
  }>(() => {
    if (!comparison || comparison.categories.length === 0) {
      return { ticks: [], cohorts: [] };
    }
    return {
      ticks: comparison.time_ticks || [],
      cohorts: comparison.ordered_series || [],
    };
  }, [comparison]);

  // Keep radarTickIdx within valid bounds
  const safeRadarTickIdx = useMemo(() => {
    const maxIdx = Math.max(0, resolvedTimeSeries.ticks.length - 1);
    return Math.min(Math.max(radarTickIdx, 0), maxIdx);
  }, [radarTickIdx, resolvedTimeSeries.ticks.length]);

  const activeRadarTick = resolvedTimeSeries.ticks[safeRadarTickIdx] || null;

  // Available Radar items (every valid document or tree leaf in comparison.series)
  const availableRadarSeries = useMemo(() => {
    if (!comparison) return [];
    return (comparison.series || []).filter(
      (s) => s.available && Array.isArray(s.partitions) && s.partitions.length > 0
    );
  }, [comparison]);

  // 1. Interactive Multi-Select Radar Chart: plots ONLY the documents selected in selectedRadarDocIds (default: 1st document).
  // Legend dynamically updates as documents are selected/deselected.
  const radarSummary = useMemo<{
    option: Record<string, unknown>;
    originalCount: number;
    plottedCount: number;
  }>(() => {
    if (!comparison || comparison.categories.length === 0 || availableRadarSeries.length === 0) {
      return { option: {}, originalCount: 0, plottedCount: 0 };
    }

    const selectedSet = new Set(selectedRadarDocIds);
    const chosenSeries = availableRadarSeries.filter((s) => selectedSet.has(s.document_id));

    const nCats = comparison.categories.length;
    const activeSliceNum = activeRadarTick?.slice_num || 1;
    const activePeriodKey = activeRadarTick?.period_key || activeRadarTick?.meeting_date || "";
    const activeMeetingDate = activeRadarTick?.meeting_date || "";
    const activePeriodLabel = activeRadarTick?.period_label || "";
    const sliceSuffix =
      (activeRadarTick?.total_slices || effectiveNPartitions) > 1
        ? ` · S${activeSliceNum}/${activeRadarTick?.total_slices || effectiveNPartitions}`
        : "";

    const rawTraces = chosenSeries.map((s) => {
      const globalIdx = availableRadarSeries.findIndex((a) => a.document_id === s.document_id);
      const color = DOCUMENT_COLORS[Math.max(0, globalIdx) % DOCUMENT_COLORS.length];
      // Pick the partition matching the active chronological slice (fallback to closest partition)
      const targetPart =
        s.partitions.find((p) => p.partition_index === activeSliceNum) ||
        s.partitions[Math.min(Math.max(0, activeSliceNum - 1), s.partitions.length - 1)] ||
        s.partitions[0];

      const avgVals = new Array<number>(nCats).fill(0);
      for (let c = 0; c < nCats; c++) {
        const v = targetPart?.values?.[c];
        avgVals[c] = typeof v === "number" && Number.isFinite(v) ? v : 0;
      }
      const isTreeLeaf = s.doc_type === "tree_leaf";
      const baseLabel = isTreeLeaf
        ? s.meeting_date
        : `${s.meeting_date} · ${s.doc_type_label || s.doc_type}`;
      const label = `${baseLabel}${sliceSuffix}::COLOR::${color}`;
      const yearMatch = String(s.meeting_date || "").match(/(19\d{2}|20\d{2})/);
      const yearKey = yearMatch ? yearMatch[1] : s.meeting_date || "Other";
      const isFocused =
        Boolean(activeRadarTick) &&
        (s.meeting_date === activeMeetingDate ||
          s.meeting_date === activePeriodKey ||
          s.meeting_date === activePeriodLabel ||
          (isTreeLeaf && Boolean(activePeriodLabel) && s.meeting_date.includes(activePeriodLabel)));
      const [cleanName, pickedColor] = label.split("::COLOR::");
      return {
        label: cleanName,
        yearKey,
        values: avgVals,
        isFocused,
        color: pickedColor || DOCUMENT_COLORS[0],
      };
    });

    let globalMax = 0.01;
    let globalMin = 0;
    const scaleSeries = chosenSeries.length > 0 ? chosenSeries : availableRadarSeries;
    for (const s of scaleSeries) {
      for (const p of s.partitions) {
        for (const v of p.values || []) {
          if (typeof v === "number" && Number.isFinite(v)) {
            if (v > globalMax) globalMax = v;
            if (v < globalMin) globalMin = v;
          }
        }
      }
    }
    const hasAnyFocused = rawTraces.some((tr) => tr.isFocused);
    const plotted = rawTraces.map((tr) => ({
      name: tr.label,
      value: tr.values,
      isFocused: tr.isFocused,
      color: tr.color,
    }));

    const axisMax = Number((globalMax * 1.1).toFixed(3));
    const axisMin = globalMin < 0 ? Number((globalMin * 1.1).toFixed(3)) : 0;
    const catLabels = comparison.categories.map((c) => c.label);

    const option = {
      tooltip: {
        trigger: "item",
        formatter: (params: { name: string; value: number[]; color: string }) => {
          const vals = Array.isArray(params.value) ? params.value : [];
          const lines = catLabels.map(
            (lbl, idx) =>
              `<div style="display:flex;justify-content:space-between;gap:14px;">
                <span>${lbl}</span>
                <strong>${formatSigFigs(vals[idx], 3)}</strong>
              </div>`
          );
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;min-width:220px;">
            <div style="font-weight:700;margin-bottom:4px;border-bottom:1px solid #E4E4E7;padding-bottom:3px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${params.color};margin-right:6px;"></span>
              ${params.name}
            </div>
            ${lines.join("")}
          </div>`;
        },
      },
      legend: {
        bottom: 0,
        type: "scroll",
        orient: "horizontal",
        left: "center",
        itemGap: 12,
        data: plotted.map((s) => s.name),
        textStyle: { fontFamily: "JetBrains Mono", fontSize: 11 },
      },
      radar: {
        radius: "62%",
        center: ["50%", "44%"],
        splitNumber: 4,
        axisName: { color: isDark ? "#E2E8F0" : "#0F172A", fontFamily: "JetBrains Mono", fontSize: 11 },
        splitLine: { lineStyle: { color: isDark ? "#334155" : "#E2E8F0" } },
        splitArea: { areaStyle: { color: isDark ? ["#0F172A", "#1E293B"] : ["#FFFFFF", "#F8FAFC"] } },
        axisLine: { lineStyle: { color: isDark ? "#475569" : "#CBD5E1" } },
        indicator: comparison.categories.map((c) => ({
          name: c.label,
          max: axisMax,
          min: axisMin,
        })),
      },
      series: [
        {
          type: "radar",
          symbol: "circle",
          data: plotted.map((s) => ({
            name: s.name,
            value: s.value,
            symbolSize: s.isFocused ? 7 : 5,
            z: s.isFocused ? 10 : 2,
            itemStyle: { color: s.color },
            lineStyle: {
              color: s.color,
              width: s.isFocused ? 3.2 : hasAnyFocused ? 1.8 : 2.4,
              opacity: s.isFocused ? 1 : 0.9,
            },
            areaStyle: {
              color: s.color,
              opacity: s.isFocused ? 0.24 : 0.14,
            },
          })),
        },
      ],
    };

    return {
      option,
      originalCount: availableRadarSeries.length,
      plottedCount: plotted.length,
    };
  }, [
    comparison,
    availableRadarSeries,
    selectedRadarDocIds,
    isDark,
    activeRadarTick,
    effectiveNPartitions,
  ]);

  // Active dataset for Time-Series (driven by tsComparison so Global Score selector works independently)
  const activeTsComparison = tsComparison || comparison;

  const tsResolvedTimeSeries = useMemo<{
    ticks: TimeTickMeta[];
    cohorts: OrderedTimeSeriesCohort[];
  }>(() => {
    if (!activeTsComparison || activeTsComparison.categories.length === 0) {
      return { ticks: [], cohorts: [] };
    }
    return {
      ticks: activeTsComparison.time_ticks || [],
      cohorts: activeTsComparison.ordered_series || [],
    };
  }, [activeTsComparison]);

  // Compute Meeting-Averaged Timeline (used by default when Splits are NOT expanded)
  const averagedTimeSeries = useMemo<{
    ticks: TimeTickMeta[];
    cohorts: OrderedTimeSeriesCohort[];
  }>(() => {
    const { ticks, cohorts } = tsResolvedTimeSeries;
    if (ticks.length === 0 || cohorts.length === 0) return { ticks: [], cohorts: [] };

    const periodOrder: string[] = [];
    const periodTickIndices = new Map<string, number[]>();
    ticks.forEach((tk, idx) => {
      const pk = tk.period_key || tk.meeting_date;
      if (!periodTickIndices.has(pk)) {
        periodOrder.push(pk);
        periodTickIndices.set(pk, []);
      }
      periodTickIndices.get(pk)!.push(idx);
    });

    const avgTicks: TimeTickMeta[] = periodOrder.map((pk, pIdx) => {
      const idxs = periodTickIndices.get(pk)!;
      const first = ticks[idxs[0]];
      return {
        ...first,
        index: pIdx,
        slice_num: 1,
        slice_index: 1,
        total_slices: 1,
        full_label:
          first.total_slices > 1
            ? `${first.period_label} (Avg of ${first.total_slices} splits)`
            : first.period_label,
      };
    });

    const avgCohorts: OrderedTimeSeriesCohort[] = cohorts.map((cohort) => {
      const nTopics = cohort.values_by_topic.length;
      const avgValuesByTopic: (number | null)[][] = Array.from({ length: nTopics }, () =>
        new Array<number | null>(periodOrder.length).fill(null)
      );
      const avgTickMeta = periodOrder.map((pk) => {
        const idxs = periodTickIndices.get(pk)!;
        const firstMeta = idxs.map((i) => cohort.tick_meta[i]).find(Boolean) || null;
        if (!firstMeta) return null;
        const totalChunks = idxs.reduce(
          (acc, i) => acc + (cohort.tick_meta[i]?.chunk_count || 0),
          0
        );
        return {
          ...firstMeta,
          slice_index: 0,
          n_partitions: 1,
          chunk_count: totalChunks,
        };
      });

      periodOrder.forEach((pk, pIdx) => {
        const idxs = periodTickIndices.get(pk)!;
        for (let t = 0; t < nTopics; t++) {
          let sum = 0;
          let cnt = 0;
          for (const rawIdx of idxs) {
            const v = cohort.values_by_topic[t]?.[rawIdx];
            if (typeof v === "number" && Number.isFinite(v)) {
              sum += v;
              cnt += 1;
            }
          }
          avgValuesByTopic[t][pIdx] = cnt > 0 ? sum / cnt : null;
        }
      });

      return {
        cohort_id: cohort.cohort_id,
        label: cohort.label,
        values_by_topic: avgValuesByTopic,
        tick_meta: avgTickMeta,
      };
    });

    return { ticks: avgTicks, cohorts: avgCohorts };
  }, [tsResolvedTimeSeries]);

  const hasMultipleSplits = useMemo(
    () => effectiveNPartitions > 1 && tsResolvedTimeSeries.ticks.some((t) => t.total_slices > 1),
    [effectiveNPartitions, tsResolvedTimeSeries.ticks]
  );

  // Determine semantic zoom granularity & whether atomic meeting scale has been reached
  const { zoomGranularity, isAtomicMeetingZoom } = useMemo<{
    zoomGranularity: "macro" | "meso" | "micro";
    isAtomicMeetingZoom: boolean;
  }>(() => {
    const baseTicks = averagedTimeSeries.ticks;
    if (baseTicks.length === 0) {
      return { zoomGranularity: "micro", isAtomicMeetingZoom: true };
    }
    const startIdx = Math.floor((zoomWindow[0] / 100) * Math.max(0, baseTicks.length - 1));
    const endIdx = Math.ceil((zoomWindow[1] / 100) * Math.max(0, baseTicks.length - 1));
    const visible = baseTicks.slice(startIdx, endIdx + 1);
    const distinctYears = new Set(visible.map((t) => t.year)).size;
    const distinctPeriods = visible.length;

    const atomic = distinctPeriods <= 2;
    if (atomic) return { zoomGranularity: "micro", isAtomicMeetingZoom: true };
    if (distinctYears >= 4 || distinctPeriods > 24) {
      return { zoomGranularity: "macro", isAtomicMeetingZoom: false };
    }
    return { zoomGranularity: "meso", isAtomicMeetingZoom: false };
  }, [averagedTimeSeries.ticks, zoomWindow]);

  const splitsVisible = hasMultipleSplits && (showSplitsManual || isAtomicMeetingZoom);

  // Active dataset displayed on the Time-Series chart (averaged by meeting OR expanded splits)
  const displayedTimeSeries = useMemo(
    () => (splitsVisible ? tsResolvedTimeSeries : averagedTimeSeries),
    [splitsVisible, tsResolvedTimeSeries, averagedTimeSeries]
  );

  // Keep draft builder selectors initialized to first available cohort and topic
  useEffect(() => {
    if (displayedTimeSeries.cohorts.length > 0) {
      setDraftSeriesCohortId((prev) =>
        displayedTimeSeries.cohorts.some((c) => c.cohort_id === prev)
          ? prev
          : displayedTimeSeries.cohorts[0].cohort_id
      );
    }
    if (activeTsComparison && activeTsComparison.categories.length > 0) {
      setDraftSeriesTopicId((prev) =>
        activeTsComparison.categories.some((c) => c.id === prev)
          ? prev
          : activeTsComparison.categories[0].id
      );
    }
  }, [displayedTimeSeries.cohorts, activeTsComparison]);

  // Compute raw & normalized values for each user-defined time series in customTimeSeries
  const computedCustomSeries = useMemo(() => {
    const { ticks, cohorts } = displayedTimeSeries;
    if (!activeTsComparison || ticks.length === 0 || cohorts.length === 0 || customTimeSeries.length === 0) {
      return [];
    }

    // 1. Extract raw vector for each defined series, masked by its optional date range [dateFrom..dateTo]
    const rawItems = customTimeSeries.map((def, sIdx) => {
      const cohort =
        cohorts.find((c) => c.cohort_id === def.cohortId) ||
        cohorts.find((c) => c.label === def.cohortId) ||
        cohorts[0];
      const catIdx = activeTsComparison.categories.findIndex((c) => c.id === def.topicId);
      const effCatIdx = catIdx >= 0 ? catIdx : 0;
      const catObj = activeTsComparison.categories[effCatIdx];

      const rawValues: (number | null)[] = ticks.map((tk, tIdx) => {
        const mDate = tk.meeting_date || tk.period_key;
        if (def.dateFrom && mDate < def.dateFrom) return null;
        if (def.dateTo && mDate > def.dateTo) return null;
        const v = cohort?.values_by_topic?.[effCatIdx]?.[tIdx];
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      });

      return {
        def,
        color: DOCUMENT_COLORS[sIdx % DOCUMENT_COLORS.length],
        cohortId: cohort?.cohort_id || def.cohortId,
        cohortLabel: cohort?.label || def.cohortId,
        topicId: catObj?.id || def.topicId,
        topicLabel: catObj?.label || def.topicId,
        rawValues,
      };
    });

    if (!tsNormEnabled) {
      return rawItems.map((it) => ({ ...it, values: it.rawValues }));
    }

    // 2. Apply Normalization strictly across the selected/defined series:
    //    Scope: "per_instance" (each series independently) vs "global" (across all selected series)
    //    Dimension: "value" (min-max value scaling) vs "time" (temporal share / cross-time scaling)
    const eps = 1e-8;
    if (tsNormDimension === "value") {
      if (tsNormScope === "per_instance") {
        return rawItems.map((it) => {
          const valid = it.rawValues.filter((v): v is number => v !== null);
          if (valid.length === 0) return { ...it, values: it.rawValues };
          const sMin = Math.min(...valid);
          const sMax = Math.max(...valid);
          const span = sMax - sMin;
          const values = it.rawValues.map((v) =>
            v === null ? null : span > eps ? (v - sMin) / span : 0
          );
          return { ...it, values };
        });
      } else {
        // Global value min-max across ALL selected series
        const allValid: number[] = [];
        for (const it of rawItems) {
          for (const v of it.rawValues) {
            if (v !== null) allValid.push(v);
          }
        }
        const gMin = allValid.length > 0 ? Math.min(...allValid) : 0;
        const gMax = allValid.length > 0 ? Math.max(...allValid) : 1;
        const span = gMax - gMin;
        return rawItems.map((it) => ({
          ...it,
          values: it.rawValues.map((v) =>
            v === null ? null : span > eps ? (v - gMin) / span : 0
          ),
        }));
      }
    } else {
      // Dimension == "time"
      if (tsNormScope === "per_instance") {
        // Each series normalized along its own time trajectory (sum of magnitudes = 1)
        return rawItems.map((it) => {
          const sumAbs = it.rawValues.reduce<number>(
            (acc, v) => acc + (v !== null ? Math.abs(v) : 0),
            0
          );
          return {
            ...it,
            values: it.rawValues.map((v) =>
              v === null ? null : sumAbs > eps ? v / sumAbs : 0
            ),
          };
        });
      } else {
        // Global across selected series at each time point t (min-max across selected series at tick t, or share if 2+)
        const nTicks = ticks.length;
        const normBySeries: (number | null)[][] = rawItems.map((it) => [...it.rawValues]);
        for (let t = 0; t < nTicks; t++) {
          const sliceVals = rawItems
            .map((it) => it.rawValues[t])
            .filter((v): v is number => v !== null);
          if (sliceVals.length === 0) continue;
          const tMin = Math.min(...sliceVals);
          const tMax = Math.max(...sliceVals);
          const span = tMax - tMin;
          const sumAbs = sliceVals.reduce((a, b) => a + Math.abs(b), 0);
          for (let s = 0; s < rawItems.length; s++) {
            const v = rawItems[s].rawValues[t];
            if (v === null) {
              normBySeries[s][t] = null;
            } else if (span > eps) {
              normBySeries[s][t] = (v - tMin) / span;
            } else {
              normBySeries[s][t] = sumAbs > eps ? v / sumAbs : 0;
            }
          }
        }
        return rawItems.map((it, s) => ({ ...it, values: normBySeries[s] }));
      }
    }
  }, [
    displayedTimeSeries,
    activeTsComparison,
    customTimeSeries,
    tsNormEnabled,
    tsNormScope,
    tsNormDimension,
  ]);

  // 2. Chronologically Flattened Time-Series Option rendering ONLY user-defined customTimeSeries
  const timeSeriesOption = useMemo(() => {
    const { ticks } = displayedTimeSeries;
    if (!activeTsComparison || ticks.length === 0 || computedCustomSeries.length === 0) return {};

    const xAxisLabels = ticks.map((t, idx) => {
      if (splitsVisible) {
        if (t.slice_num === 1 || idx === 0 || ticks[idx - 1].period_key !== t.period_key) {
          return `${t.period_label}
S${t.slice_num}`;
        }
        return `S${t.slice_num}`;
      }
      if (zoomGranularity === "macro") {
        if (idx === 0 || ticks[idx - 1].year !== t.year) {
          return String(t.year);
        }
        return "";
      }
      return t.period_label;
    });

    const periodDividers: Array<{ xAxis: number }> = [];
    const meetingRegions: Array<
      [
        {
          name: string;
          xAxis: number;
          itemStyle: { color: string };
          label: { show: boolean; position: string; fontSize: number; fontFamily: string; color: string };
        },
        { xAxis: number }
      ]
    > = [];

    if (splitsVisible) {
      let regionStart = 0;
      let regionIndex = 0;
      for (let i = 0; i <= ticks.length; i++) {
        const boundary =
          i === ticks.length || (i > 0 && ticks[i].period_key !== ticks[i - 1].period_key);
        if (boundary && i > regionStart) {
          if (regionStart > 0) {
            periodDividers.push({ xAxis: regionStart });
          }
          const isEven = regionIndex % 2 === 0;
          const bandColor = isDark
            ? isEven
              ? "rgba(59, 130, 246, 0.11)"
              : "rgba(148, 163, 184, 0.05)"
            : isEven
            ? "rgba(37, 99, 235, 0.065)"
            : "rgba(148, 163, 184, 0.03)";
          meetingRegions.push([
            {
              name: ticks[regionStart].period_label,
              xAxis: regionStart,
              itemStyle: { color: bandColor },
              label: {
                show: true,
                position: "insideTop",
                fontSize: 9,
                fontFamily: "JetBrains Mono, monospace",
                color: isDark ? "#94A3B8" : "#475569",
              },
            },
            { xAxis: i - 1 },
          ]);
          regionStart = i;
          regionIndex += 1;
        }
      }
    }

    const seriesLines: Record<string, unknown>[] = computedCustomSeries.map((cs, idx) => ({
      name: cs.def.name,
      type: "line",
      smooth: false,
      connectNulls: true,
      symbol: "circle",
      symbolSize: ticks.length > 80 ? 3 : 5,
      itemStyle: { color: cs.color },
      lineStyle: { width: 2.2, color: cs.color },
      emphasis: {
        focus: "series",
        lineStyle: { width: 3.5 },
        itemStyle: { borderWidth: 2, borderColor: "#09090B" },
      },
      blur: {
        lineStyle: { opacity: 0.14 },
        itemStyle: { opacity: 0.14 },
      },
      ...(idx === 0 && splitsVisible
        ? {
            markLine: {
              silent: true,
              symbol: ["none", "none"],
              label: { show: false },
              lineStyle: {
                color: isDark ? "#475569" : "#94A3B8",
                type: "dashed",
                width: 1.2,
              },
              data: periodDividers,
            },
            markArea: {
              silent: true,
              data: meetingRegions,
            },
          }
        : {}),
      data: cs.values.map((val, tIdx) => ({
        value: val,
        _cohortId: cs.cohortId,
        _cohortLabel: cs.cohortLabel,
        _topicLabel: cs.topicLabel,
        _seriesName: cs.def.name,
        _tickIndex: tIdx,
      })),
    }));

    return {
      tooltip: {
        trigger: "item",
        formatter: (p: {
          seriesName?: string;
          value?: number;
          color?: string;
          data?: {
            _cohortLabel?: string;
            _topicLabel?: string;
            _seriesName?: string;
            _tickIndex?: number;
          };
        }) => {
          const tIdx = p.data?._tickIndex ?? 0;
          const tk = ticks[tIdx];
          const hierarchy = tk
            ? splitsVisible && tk.total_slices > 1
              ? `${tk.year} · ${tk.period_label} · Split ${tk.slice_num}/${tk.total_slices}`
              : `${tk.year} · ${tk.full_label}`
            : "";
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;min-width:230px;">
            <div style="font-weight:700;margin-bottom:4px;border-bottom:1px solid #E4E4E7;padding-bottom:3px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>
              ${p.data?._seriesName || p.seriesName}
            </div>
            <div>Doc Type / Group: <strong>${p.data?._cohortLabel || ""}</strong></div>
            <div>Topic: <strong>${p.data?._topicLabel || ""}</strong></div>
            <div>Timeline: <strong>${hierarchy}</strong></div>
            <div>Value: <strong>${formatSigFigs(Number(p.value), 3)}</strong></div>
            <div style="margin-top:4px;font-size:10px;color:#71717A;">Click point to inspect underlying chunks</div>
          </div>`;
        },
      },
      legend: {
        top: 0,
        type: "scroll",
        textStyle: { fontFamily: "JetBrains Mono", fontSize: 11 },
      },
      grid: { top: splitsVisible ? 38 : 32, left: 54, right: 24, bottom: splitsVisible ? 86 : 72 },
      xAxis: {
        type: "category",
        data: xAxisLabels,
        axisLabel: {
          fontFamily: "JetBrains Mono",
          fontSize: 10,
          interval: 0,
          hideOverlap: true,
          lineHeight: 14,
        },
      },
      yAxis: {
        type: "value",
        axisLabel: {
          fontFamily: "JetBrains Mono",
          fontSize: 10,
          formatter: (val: number) => formatSigFigs(val, 3),
        },
        splitLine: { lineStyle: { color: isDark ? "#334155" : "#E2E8F0" } },
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          start: zoomWindow[0],
          end: zoomWindow[1],
          zoomOnMouseWheel: "ctrl",
          moveOnMouseWheel: false,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          bottom: 8,
          height: 22,
          start: zoomWindow[0],
          end: zoomWindow[1],
          borderColor: isDark ? "#334155" : "#E2E8F0",
          fillerColor: "rgba(37, 99, 235, 0.18)",
        },
      ],
      series: seriesLines,
    };
  }, [
    activeTsComparison,
    displayedTimeSeries,
    computedCustomSeries,
    zoomGranularity,
    splitsVisible,
    zoomWindow,
    isDark,
  ]);

  const handleTimeSeriesPointClick = useCallback(
    (params: Record<string, unknown>) => {
      const dataObj = params.data as
        | { _cohortId?: string; _cohortLabel?: string; _tickIndex?: number }
        | undefined;
      if (!dataObj || typeof dataObj._tickIndex !== "number") return;
      const cohort = displayedTimeSeries.cohorts.find((c) => c.cohort_id === dataObj._cohortId);
      const tk = displayedTimeSeries.ticks[dataObj._tickIndex];
      const meta = cohort?.tick_meta[dataObj._tickIndex];
      if (!meta || !tk) return;

      setInspectorTarget({
        title: `${cohort?.label || "Cohort"} → ${tk.full_label}`,
        documents: meta.documents,
        pathFilters: meta.path_filters,
        periodKey: meta.period_key,
        sliceIndex: meta.slice_index && meta.slice_index > 0 ? meta.slice_index : null,
        nPartitions: meta.n_partitions,
      });
    },
    [displayedTimeSeries]
  );

  const handleDataZoom = useCallback((startPct: number, endPct: number) => {
    setZoomWindow((prev) => {
      if (Math.abs(prev[0] - startPct) < 0.5 && Math.abs(prev[1] - endPct) < 0.5) {
        return prev;
      }
      return [startPct, endPct];
    });
  }, []);

  const zoomStep = (factor: number) => {
    setZoomWindow(([s, e]) => {
      const center = (s + e) / 2;
      const half = ((e - s) / 2) * factor;
      const clampedHalf = Math.max(2, Math.min(50, half));
      const ns = Math.max(0, center - clampedHalf);
      const ne = Math.min(100, center + clampedHalf);
      return [ns, ne];
    });
  };

  // Export user-defined Time-Series data to CSV
  const handleExportCustomSeriesCsv = () => {
    const { ticks } = displayedTimeSeries;
    if (ticks.length === 0 || computedCustomSeries.length === 0) return;
    const esc = (val: string | number | null | undefined) => {
      const s = val === null || val === undefined ? "" : String(val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const headers = [
      "year",
      "meeting_date",
      "period_label",
      "slice_num",
      "total_slices",
      "score_mode",
      "normalized",
      "norm_scope",
      "norm_dimension",
      ...computedCustomSeries.map((cs) => cs.def.name),
    ];
    const lines = [headers.map(esc).join(",")];
    ticks.forEach((tk, tIdx) => {
      const vals = computedCustomSeries.map((cs) => cs.values[tIdx]);
      if (vals.every((v) => v === null || v === undefined)) return;
      lines.push(
        [
          tk.year,
          tk.meeting_date,
          tk.period_label,
          tk.slice_num,
          tk.total_slices,
          tsScoreMode,
          tsNormEnabled ? "true" : "false",
          tsNormEnabled ? tsNormScope : "none",
          tsNormEnabled ? tsNormDimension : "none",
          ...vals.map((v) => (v === null || v === undefined ? "" : String(v))),
        ]
          .map(esc)
          .join(",")
      );
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `miningfomc_timeseries_${tsScoreMode}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export Time-Series ECharts canvas as PNG
  const handleExportTimeSeriesPng = () => {
    if (!tsChartRef.current) return;
    const dataUrl = tsChartRef.current.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: isDark ? "#0F172A" : "#FFFFFF",
    });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `miningfomc_timeseries_${tsScoreMode}.png`;
    a.click();
  };

  // Export full raw basket chunks table to CSV
  const handleExportBasketChunksCsv = async () => {
    if (basket.length === 0) return;
    setExportingBasketCsv(true);
    try {
      const csvText = await api.exportBasketChunksCsv({
        documents: basket.map((d) => ({ doc_type: d.doc_type, meeting_date: d.meeting_date })),
        data_source: dataSource,
      });
      const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `miningfomc_basket_raw_chunks_${dataSource}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export basket chunks CSV");
    } finally {
      setExportingBasketCsv(false);
    }
  };

  // Handlers for Custom Time-Series creation, editing, duplication, and deletion
  const handleCreateCustomSeries = () => {
    if (!activeTsComparison || displayedTimeSeries.cohorts.length === 0) return;
    const cohort =
      displayedTimeSeries.cohorts.find((c) => c.cohort_id === draftSeriesCohortId) ||
      displayedTimeSeries.cohorts[0];
    const cat =
      activeTsComparison.categories.find((c) => c.id === draftSeriesTopicId) ||
      activeTsComparison.categories[0];
    if (!cohort || !cat) return;

    const dateSuffix =
      draftSeriesDateFrom || draftSeriesDateTo
        ? ` (${draftSeriesDateFrom || "1976"}..${draftSeriesDateTo || "2020"})`
        : "";
    const autoName = `${cohort.label} · ${cat.label}${dateSuffix}`;
    const finalName = draftSeriesName.trim() || autoName;
    const newItem: CustomTimeSeriesDef = {
      id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: finalName,
      cohortId: cohort.cohort_id,
      topicId: cat.id,
      dateFrom: draftSeriesDateFrom,
      dateTo: draftSeriesDateTo,
    };
    setCustomTimeSeries((prev) => [...prev, newItem]);
    setDraftSeriesName("");
    setAddingSeriesOpen(false);
  };

  const handleUpdateCustomSeries = (id: string, patch: Partial<CustomTimeSeriesDef>) => {
    setCustomTimeSeries((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updated = { ...item, ...patch };
        // If cohortId or topicId changed and name wasn't manually overridden in this patch, refresh default name
        if ((patch.cohortId || patch.topicId) && patch.name === undefined && activeTsComparison) {
          const coh = displayedTimeSeries.cohorts.find((c) => c.cohort_id === updated.cohortId);
          const cat = activeTsComparison.categories.find((c) => c.id === updated.topicId);
          if (coh && cat) {
            const dateSuffix =
              updated.dateFrom || updated.dateTo
                ? ` (${updated.dateFrom || "1976"}..${updated.dateTo || "2020"})`
                : "";
            updated.name = `${coh.label} · ${cat.label}${dateSuffix}`;
          }
        }
        return updated;
      })
    );
  };

  const handleDuplicateCustomSeries = (item: CustomTimeSeriesDef) => {
    const copyItem: CustomTimeSeriesDef = {
      ...item,
      id: `ts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: `${item.name} (Copy)`,
    };
    setCustomTimeSeries((prev) => [...prev, copyItem]);
    setEditingSeriesId(copyItem.id);
  };

  const handleDeleteCustomSeries = (id: string) => {
    setCustomTimeSeries((prev) => prev.filter((item) => item.id !== id));
    if (editingSeriesId === id) setEditingSeriesId(null);
  };

  const toggleRadarDocSelection = (docId: string) => {
    setSelectedRadarDocIds((prev) => {
      if (prev.includes(docId)) {
        return prev.length > 1 ? prev.filter((id) => id !== docId) : prev;
      }
      return [...prev, docId];
    });
  };

  // Current snapshot config for Save / Fork Study
  const currentConfig: StudyConfig = {
    basket,
    n_partitions: nPartitions,
    selected_slice: safeRadarTickIdx + 1,
    data_source: dataSource,
    metric,
    normalization,
    granularity,
    macro_category: macroCategory,
    combine_by: groupingTree ? "tree" : "none",
    sub_group_by: "none",
    agg_method: aggMethod,
    year_range_span: 5,
    grouping_tree: groupingTree,
  };

  const isForeignPublicStudy = Boolean(
    loadedStudy && user && loadedStudy.owner_id !== user.id
  );

  const handleSaveOrForkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studyTitle.trim()) return;
    setSavingStudy(true);
    setStudyFeedback(null);
    try {
      if (isForeignPublicStudy && loadedStudy) {
        const forked = await api.forkStudy(loadedStudy.id, {
          title: studyTitle.trim(),
          description: studyDesc.trim(),
          config: currentConfig,
        });
        setLoadedStudy(forked);
        setSearchParams({ study: String(forked.id) });
        setStudyFeedback("Forked to your Portfolio.");
      } else if (loadedStudy && user && loadedStudy.owner_id === user.id) {
        const updated = await api.updateStudy(loadedStudy.id, {
          title: studyTitle.trim(),
          description: studyDesc.trim(),
          config: currentConfig,
          is_public: studyPublic,
        });
        setLoadedStudy(updated);
        setStudyFeedback("Study updated.");
      } else {
        const created = await api.createStudy({
          title: studyTitle.trim(),
          description: studyDesc.trim(),
          config: currentConfig,
          is_public: studyPublic,
        });
        setLoadedStudy(created);
        setSearchParams({ study: String(created.id) });
        setStudyFeedback("Study saved to Portfolio.");
      }
      setTimeout(() => {
        setStudyFeedback(null);
        setStudyModalOpen(false);
      }, 800);
    } catch (err) {
      setStudyFeedback(err instanceof Error ? err.message : "Failed to save study");
    } finally {
      setSavingStudy(false);
    }
  };

  const serverBlockingMessage = loading
    ? "Computing comparison & standardized partitions on server..."
    : loadingTs
    ? "Computing time-series score matrices on server..."
    : addingAll
    ? "Loading all matching documents into comparison basket..."
    : exportingBasketCsv
    ? "Generating full raw chunk classifier CSV on server..."
    : loadingBasketChunks && !basketChunksData
    ? "Loading raw chunk classifier scores from server..."
    : null;

  const nodeSplitsCount = Object.keys(groupingTree?.node_splits || {}).length;
  const treeSummaryLabel = groupingTree
    ? (groupingTree.split_levels
        .map((l) =>
          l.criterion === "year_range"
            ? `Year Range (${l.year_range_span}y)`
            : l.criterion === "custom_range"
            ? `Custom Range (${l.custom_ranges?.length || 0})`
            : l.criterion.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
        )
        .join(" → ") || "Root Cohort") +
      (nodeSplitsCount > 0 ? ` · +${nodeSplitsCount} node ${nodeSplitsCount === 1 ? "split" : "splits"}` : "")
    : null;

  const zoomBadgeLabel = splitsVisible
    ? showSplitsManual
      ? "SPLITS · MANUAL VIEW (MEETING REGIONS)"
      : "ATOMIC ZOOM · INDIVIDUAL SPLITS"
    : zoomGranularity === "macro"
    ? "MACRO · MEETING AVERAGES (YEARS)"
    : "MESO · MEETING AVERAGES";

  return (
    <div className="space-y-6 relative">
      {/* Full-Page Blocking Overlay with Blur while Server is Computing */}
      {serverBlockingMessage && (
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
                {serverBlockingMessage}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold">
            Document Comparator
          </span>
          <h1 className="text-2xl font-bold text-ink mt-0.5">
            {loadedStudy ? loadedStudy.title : "Chronological Cohort Radar & Semantic Time-Series"}
          </h1>
          {loadedStudy && (
            <p className="text-xs font-mono text-muted mt-1">
              Primary Author: <strong>{loadedStudy.primary_author}</strong>
              {loadedStudy.collaborator && (
                <>
                  {" "}
                  · Collaborator: <strong>{loadedStudy.collaborator}</strong>
                </>
              )}
              {loadedStudy.parent_study && (
                <>
                  {" "}
                  · Forked from{" "}
                  <button
                    type="button"
                    onClick={() => navigate(`/comparator?study=${loadedStudy.parent_study!.id}`)}
                    className="underline text-accent-dark"
                  >
                    {loadedStudy.parent_study.author_username}
                  </button>
                </>
              )}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={basket.length === 0}
            onClick={() => {
              if (!loadedStudy) {
                setStudyTitle(`FOMC Comparison (${basket.length} docs)`);
                setStudyDesc("");
              } else if (isForeignPublicStudy) {
                setStudyTitle(`${loadedStudy.title} (Fork)`);
              }
              setStudyModalOpen(true);
            }}
            className="btn-primary text-xs"
          >
            {isForeignPublicStudy ? (
              <>
                <GitFork className="w-3.5 h-3.5" />
                Fork Study
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                Save Study
              </>
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-col xl:flex-row gap-6 items-start">
        {/* Left Column: Sideways-Collapsible Basket (Separated by Doc Type) & Auto-Reactive Filter Builder */}
        {sidebarCollapsed ? (
          <div className="panel p-2 flex xl:flex-col items-center justify-between gap-3 w-full xl:w-12 shrink-0 bg-surface">
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              title="Expand Basket & Filters panel sideways"
              className="btn-secondary p-1.5"
            >
              <ChevronRight className="w-4 h-4 text-accent" />
            </button>
            <div
              onClick={() => setSidebarCollapsed(false)}
              className="cursor-pointer text-[11px] font-mono uppercase tracking-wider font-semibold text-ink xl:[writing-mode:vertical-rl] xl:rotate-180 py-2 select-none"
            >
              Basket ({basket.length}) &amp; Filters
            </div>
          </div>
        ) : (
        <div className="w-full xl:w-[375px] shrink-0 space-y-4">
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
                Comparison Basket ({basket.length})
              </h2>
              <div className="flex items-center gap-2">
                {basket.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      clearBasket();
                      setGroupingTree(null);
                    }}
                    className="text-xs font-mono text-zinc-400 hover:text-red-600 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  title="Collapse panel sideways to gain horizontal chart space"
                  className="btn-secondary py-1 px-2 text-[11px]"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-accent" />
                  Hide
                </button>
              </div>
            </div>

            {basket.length === 0 ? (
              <p className="text-xs text-muted py-3">
                Select documents below (or click Add All) to compare standardized topic profiles.
              </p>
            ) : (
              <div className="max-h-[220px] overflow-y-auto pr-1 space-y-2.5">
                {basketByDocType.map((group) => (
                  <div
                    key={group.doc_type}
                    className="border border-border rounded-sm bg-canvas/60 p-2 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border/60 pb-1">
                      <span className="text-[10px] font-mono uppercase font-semibold text-accent-dark">
                        {group.doc_type_label} ({group.items.length})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setBasket(basket.filter((b) => b.doc_type !== group.doc_type))
                        }
                        title={`Remove all ${group.doc_type_label} from basket`}
                        className="text-[10px] font-mono text-zinc-400 hover:text-red-600"
                      >
                        Remove type
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map((doc) => {
                        const globalIdx = basket.findIndex(
                          (b) =>
                            b.doc_type === doc.doc_type && b.meeting_date === doc.meeting_date
                        );
                        const color =
                          DOCUMENT_COLORS[Math.max(0, globalIdx) % DOCUMENT_COLORS.length];
                        return (
                          <div
                            key={`${doc.doc_type}::${doc.meeting_date}`}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 border border-border rounded-sm bg-surface text-[11px] font-mono"
                          >
                            <span
                              className="w-2 h-2 rounded-full shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <span className="font-semibold text-ink">{doc.meeting_date}</span>
                            <button
                              type="button"
                              onClick={() => removeFromBasket(doc.doc_type, doc.meeting_date)}
                              className="text-zinc-400 hover:text-ink shrink-0"
                              title="Remove document"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Advanced Basket Selector & Auto-Reactive Filters */}
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
                Add Documents to Basket
              </div>
              <button
                type="button"
                disabled={candidatesTotal === 0 || addingAll}
                onClick={handleAddAllMatching}
                className="btn-primary py-1 px-2.5 text-[11px] shrink-0"
              >
                <ListPlus className="w-3 h-3" />
                {addingAll
                  ? "Server loading all..."
                  : `Add All (${candidatesTotal.toLocaleString()})`}
              </button>
            </div>

            {searching && (
              <div className="px-2.5 py-1 rounded-sm bg-accent-soft border border-accent text-[10px] font-mono text-accent-dark animate-pulse">
                Server computing: updating matching documents...
              </div>
            )}

            <div className="space-y-2.5">
              <MultiDocTypeSelect
                options={docTypes}
                selected={searchDocTypes}
                onChange={setSearchDocTypes}
                placeholder="All 7 Active Types"
                compact
              />

              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-muted mb-0.5">
                      Date From
                    </label>
                    <input
                      type="date"
                      min={CORPUS_MIN_DATE}
                      max={CORPUS_MAX_DATE}
                      value={searchDateFrom}
                      onClick={openNativeDatePicker}
                      onChange={(e) => setSearchDateFrom(clampCorpusDate(e.target.value))}
                      className="input-field font-mono text-[11px] cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-muted mb-0.5">
                      Date To <span className="text-zinc-400 normal-case">(opt.)</span>
                    </label>
                    <input
                      type="date"
                      min={CORPUS_MIN_DATE}
                      max={CORPUS_MAX_DATE}
                      value={searchDateTo}
                      onClick={openNativeDatePicker}
                      onChange={(e) => setSearchDateTo(clampCorpusDate(e.target.value))}
                      title="Leave empty for an exact single-date match on Date From"
                      className="input-field font-mono text-[11px] cursor-pointer"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono">
                  {[
                    { label: "2000–2001", from: DEFAULT_DATE_FROM, to: DEFAULT_DATE_TO },
                    { label: "2008 Crisis", from: "2007-08-01", to: "2009-12-31" },
                    { label: "2010–2020", from: "2010-01-01", to: "2020-12-31" },
                    { label: "All 1976–2020", from: CORPUS_MIN_DATE, to: CORPUS_MAX_DATE },
                  ].map((p) => {
                    const active = searchDateFrom === p.from && searchDateTo === p.to;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setSearchDateFrom(p.from);
                          setSearchDateTo(p.to);
                        }}
                        className={`px-1.5 py-0.5 rounded-sm border transition-colors ${
                          active
                            ? "bg-ink text-white border-ink"
                            : "bg-surface text-muted border-border hover:border-ink"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SpeakerAutocomplete
                  value={searchSpeaker}
                  onChange={setSearchSpeaker}
                  placeholder="Speaker name..."
                />
                <input
                  type="text"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Keyword..."
                  className="input-field text-xs"
                />
              </div>

              <div className="pt-2 border-t border-border">
                <ScoreThresholdFilter
                  value={scoreFilter}
                  onChange={setScoreFilter}
                  macroCategories={macroCategories}
                  compact
                />
              </div>

              <div className="pt-2 border-t border-border space-y-1.5">
                <label className="block text-[10px] font-mono uppercase text-muted">
                  Custom SQL Filter <span className="text-zinc-400 normal-case">(WHERE)</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={sqlFilter}
                    onChange={(e) => {
                      setSqlFilter(e.target.value);
                      setSelectedFilterId("");
                    }}
                    placeholder="e.g., char_count > 200"
                    className="input-field font-mono text-[11px] flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    disabled={!sqlFilter.trim() || savingFilter}
                    onClick={handleSaveSqlFilter}
                    title="Save this predicate to your filters"
                    className="btn-secondary py-1 px-2 text-[11px] shrink-0"
                  >
                    <Save className="w-3 h-3" />
                  </button>
                </div>
                <select
                  value={selectedFilterId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedFilterId(id);
                    const picked = savedFilters.find((f) => String(f.id) === id);
                    if (picked) setSqlFilter(picked.sql_text);
                  }}
                  className="input-field text-xs"
                >
                  <option value="">Saved filters...</option>
                  {savedFilters.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="text-[11px] font-mono text-muted pt-1 border-t border-border flex items-center justify-between">
              <span>
                {candidatesTotal === 0
                  ? "0 matching documents"
                  : `Showing 1–${candidates.length} of ${candidatesTotal.toLocaleString()} matching documents`}
              </span>
            </div>

            <div className="divide-y divide-border max-h-[260px] overflow-y-auto border-t border-border">
              {candidates.map((c) => {
                const added = basket.some(
                  (b) => b.doc_type === c.doc_type && b.meeting_date === c.meeting_date
                );
                return (
                  <div
                    key={c.document_id}
                    className="py-2 flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-semibold text-ink">{c.meeting_date}</div>
                      <div className="text-[11px] text-muted truncate">
                        {c.doc_type_label} · {c.chunk_count} chunks
                        {c.matched_score !== undefined
                          ? ` · sim ${formatSigFigs(c.matched_score, 3)}`
                          : ""}
                        {c.matched_zs_prob !== undefined
                          ? ` · zs ${formatSigFigs(c.matched_zs_prob, 3)}`
                          : ""}
                        {c.matched_rel_prob !== undefined
                          ? ` · rel ${formatSigFigs(c.matched_rel_prob, 3)}`
                          : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() =>
                        addToBasket({
                          doc_type: c.doc_type,
                          meeting_date: c.meeting_date,
                          doc_type_label: c.doc_type_label,
                        })
                      }
                      className="btn-secondary py-1 px-2 text-[11px] shrink-0"
                    >
                      <Plus className="w-3 h-3" />
                      {added ? "Added" : "Add"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        )}

        {/* Right Column: Controls, Group/Combine Tree Bar, Radar, Flattened Time-Series & CSV Table */}
        <div className="flex-1 min-w-0 w-full space-y-4">
          {/* Live Controls */}
          <div className="panel p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted font-semibold">
                <Sliders className="w-3.5 h-3.5 text-accent" />
                Live Standardization, Grouping Tree &amp; Metric Controls
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={basket.length === 0}
                  onClick={() => setTreeModalOpen(true)}
                  className={
                    groupingTree
                      ? "btn-primary py-1.5 px-3 text-xs"
                      : "btn-secondary py-1.5 px-3 text-xs"
                  }
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  {groupingTree ? "Edit Grouping Tree" : "Group / Combine"}
                </button>
                {groupingTree && (
                  <button
                    type="button"
                    onClick={() => setGroupingTree(null)}
                    className="btn-secondary py-1.5 px-2.5 text-xs text-red-600"
                    title="Clear grouping tree"
                  >
                    <X className="w-3.5 h-3.5" />
                    Clear Tree
                  </button>
                )}
              </div>
            </div>

            {treeSummaryLabel && (
              <div className="px-3 py-2 border border-accent bg-accent-soft/70 rounded-sm flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                <span className="text-accent-dark font-semibold">
                  Active Grouping Tree: {treeSummaryLabel}
                  {groupingTree && groupingTree.hidden_node_ids.length > 0
                    ? ` (${groupingTree.hidden_node_ids.length} hidden)`
                    : ""}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase text-muted">Aggregate:</span>
                  <div className="inline-flex border border-border rounded-sm overflow-hidden bg-surface">
                    {(["mean", "median"] as AggregationMethod[]).map((am) => (
                      <button
                        key={am}
                        type="button"
                        onClick={() => setAggMethod(am)}
                        className={`px-2.5 py-0.5 text-[11px] font-mono capitalize ${
                          aggMethod === am ? "bg-ink text-white" : "text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        {am}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                  Data Source
                </label>
                <select
                  value={dataSource}
                  onChange={(e) => setDataSource(e.target.value as DataSourceMode)}
                  className="input-field py-1.5 text-xs font-mono"
                >
                  <option value="similarity">Prototype Similarity Matrix</option>
                  <option value="zero_shot">Zero-Shot Classifier Scores</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                  Metric Transform
                </label>
                <div className="flex border border-border rounded-sm overflow-hidden bg-surface">
                  {(["cosine", "softmax", "log"] as MetricTransform[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMetric(m)}
                      className={`flex-1 py-1.5 text-xs font-mono capitalize ${
                        metric === m ? "bg-ink text-white" : "text-zinc-600 hover:bg-zinc-100"
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
                <div className="flex border border-border rounded-sm overflow-hidden bg-surface">
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
                      onClick={() => setNormalization(n.id)}
                      className={`flex-1 py-1.5 text-xs font-mono ${
                        normalization === n.id
                          ? "bg-ink text-white"
                          : "text-zinc-600 hover:bg-zinc-100"
                      }`}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                  Radar Axes
                </label>
                <select
                  value={granularity === "macro" ? "macro" : `sub:${macroCategory}`}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "macro") setGranularity("macro");
                    else {
                      setGranularity("subclass");
                      setMacroCategory(val.replace("sub:", ""));
                    }
                  }}
                  className="input-field py-1.5 text-xs font-mono"
                >
                  <option value="macro">13 Macro-Categories</option>
                  <optgroup label="Sub-Class Drill-Down">
                    {macroCategories
                      .filter((c) => c.has_subclasses)
                      .map((c) => (
                        <option key={c.id} value={`sub:${c.id}`}>
                          ↳ {c.label}
                        </option>
                      ))}
                  </optgroup>
                </select>
              </div>
            </div>

            {/* Temporal Partitions (ONLY available when 1 meeting is selected, Req 9) + Synchronized Chronological Radar Scrubber */}
            {(distinctMeetingCount === 1 || resolvedTimeSeries.ticks.length > 1) && (
              <div className="pt-3 border-t border-border flex flex-wrap items-end gap-5">
                {distinctMeetingCount === 1 && (
                  <div className="w-44">
                    <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                      Temporal Partitions (S)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={nPartitions}
                      onChange={(e) => {
                        const v = Math.max(1, Math.min(50, Number(e.target.value) || 1));
                        setNPartitions(v);
                      }}
                      className="input-field py-1.5 text-xs font-mono text-center"
                    />
                  </div>
                )}

                {resolvedTimeSeries.ticks.length > 1 && (
                  <div className="flex-1 min-w-[260px]">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-muted mb-1">
                      <span>Radar Chronological Point</span>
                      <span className="font-semibold text-ink">
                        {activeRadarTick
                          ? `${activeRadarTick.full_label} (${safeRadarTickIdx + 1} / ${resolvedTimeSeries.ticks.length})`
                          : `Point ${safeRadarTickIdx + 1}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={safeRadarTickIdx <= 0}
                        onClick={() => setRadarTickIdx((idx) => Math.max(0, idx - 1))}
                        title="Previous chronological point"
                        className="btn-secondary py-1 px-2"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={resolvedTimeSeries.ticks.length - 1}
                        value={safeRadarTickIdx}
                        onChange={(e) => setRadarTickIdx(Number(e.target.value))}
                        className="flex-1 accent-ink"
                      />
                      <button
                        type="button"
                        disabled={safeRadarTickIdx >= resolvedTimeSeries.ticks.length - 1}
                        onClick={() =>
                          setRadarTickIdx((idx) =>
                            Math.min(resolvedTimeSeries.ticks.length - 1, idx + 1)
                          )
                        }
                        title="Next chronological point"
                        className="btn-secondary py-1 px-2"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="panel border-red-300 bg-red-50 p-3 text-xs font-mono text-red-700">
              {error}
            </div>
          )}

          {/* Synchronized Interactive Radar Chart with Multi-Select Document Selector (Default: 1 Document) */}
          <div className="panel p-4 relative space-y-3">
            {basket.length === 0 ? (
              <div className="h-[420px] flex flex-col items-center justify-center text-center p-6">
                <p className="text-sm font-medium text-ink">No documents in comparison basket</p>
                <p className="mt-1 text-xs text-muted max-w-sm">
                  Add documents from the left panel to plot their standardized macroeconomic radar
                  and chronological slice trajectories.
                </p>
              </div>
            ) : loading && !comparison ? (
              <div className="h-[420px] flex items-center justify-center text-xs font-mono text-muted">
                Computing chronological N-partition comparison...
              </div>
            ) : comparison && comparison.categories.length > 0 && availableRadarSeries.length > 0 ? (
              <div className="space-y-3">
                {/* Radar Document Selector */}
                <div className="border border-border rounded-sm bg-canvas/70 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-mono uppercase font-semibold text-ink">
                      Radar Plot Documents ({selectedRadarDocIds.length} / {availableRadarSeries.length} selected)
                    </span>
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRadarDocIds(
                            availableRadarSeries.length > 0
                              ? [availableRadarSeries[0].document_id]
                              : []
                          )
                        }
                        className="underline text-muted hover:text-ink"
                      >
                        1st Document Only
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedRadarDocIds(availableRadarSeries.map((s) => s.document_id))
                        }
                        className="underline text-muted hover:text-ink"
                      >
                        Select All ({availableRadarSeries.length})
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                    {availableRadarSeries.map((s, idx) => {
                      const active = selectedRadarDocIds.includes(s.document_id);
                      const color = DOCUMENT_COLORS[idx % DOCUMENT_COLORS.length];
                      const lbl =
                        s.doc_type === "tree_leaf"
                          ? s.meeting_date
                          : `${s.meeting_date} · ${s.doc_type_label || s.doc_type}`;
                      return (
                        <button
                          key={s.document_id}
                          type="button"
                          onClick={() => toggleRadarDocSelection(s.document_id)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono rounded-sm border transition-colors ${
                            active
                              ? "bg-ink text-white border-ink shadow-sm"
                              : "bg-surface text-muted border-border hover:border-ink hover:text-ink"
                          }`}
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span>{lbl}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <EChartBox option={radarSummary.option} className="w-full h-[460px]" />
              </div>
            ) : (
              <div className="h-[420px] flex items-center justify-center text-xs font-mono text-muted">
                Selected data source ({dataSource}) has no precomputed vectors for these documents.
              </div>
            )}
          </div>

          {/* User-Defined Time-Series Builder, Global Normalization/Score Controls & Chart */}
          {activeTsComparison &&
            activeTsComparison.categories.length > 0 &&
            tsResolvedTimeSeries.ticks.length > 0 && (
              <div className="panel p-4 space-y-4">
                {/* Header & Export Buttons */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <div>
                    <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
                      Custom Chronological Time-Series ({customTimeSeries.length}{" "}
                      {customTimeSeries.length === 1 ? "series" : "series"} defined ·{" "}
                      <span className="text-accent-dark">{zoomBadgeLabel}</span>)
                    </h3>
                    <p className="text-[11px] font-mono text-muted">
                      Build custom time series by Document Type, Topic, and Date Range. Click any
                      defined series name to edit, duplicate, or delete it.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={computedCustomSeries.length === 0}
                      onClick={handleExportCustomSeriesCsv}
                      title="Download plotted time-series data as CSV"
                      className="btn-secondary py-1 px-2.5 text-xs"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download CSV
                    </button>
                    <button
                      type="button"
                      disabled={computedCustomSeries.length === 0}
                      onClick={handleExportTimeSeriesPng}
                      title="Download time-series chart as PNG image"
                      className="btn-secondary py-1 px-2.5 text-xs"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Download PNG
                    </button>
                    {hasMultipleSplits && (
                      <button
                        type="button"
                        onClick={() => setShowSplitsManual((v) => !v)}
                        title="Toggle individual intra-meeting splits without zooming"
                        className={
                          showSplitsManual
                            ? "btn-primary py-1 px-2.5 text-xs"
                            : "btn-secondary py-1 px-2.5 text-xs"
                        }
                      >
                        <Layers className="w-3.5 h-3.5" />
                        {showSplitsManual ? "Hide Splits" : "Show Splits"}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => zoomStep(0.6)}
                      title="Zoom in"
                      className="btn-secondary py-1 px-2 text-xs"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => zoomStep(1.5)}
                      title="Zoom out"
                      className="btn-secondary py-1 px-2 text-xs"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoomWindow([0, 100])}
                      title="Reset zoom"
                      className="btn-secondary py-1 px-2 text-xs"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  </div>
                </div>

                {/* Global Time-Series Controls: Score Mode & Selected-Series Normalization */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-3 border border-border rounded-sm bg-canvas/60">
                  <div>
                    <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                      Global Score Source
                    </label>
                    <select
                      value={tsScoreMode}
                      onChange={(e) =>
                        setTsScoreMode(e.target.value as TimeSeriesGlobalScoreMode)
                      }
                      className="input-field py-1.5 text-xs font-mono"
                    >
                      <option value="zero_shot">Zero-Shot Probabilities</option>
                      <option value="sim_softmax">Similarity · Softmax</option>
                      <option value="sim_cosine">Similarity · Cosine</option>
                      <option value="sim_none">Similarity · None (Raw)</option>
                      <option value="relevance">Relevance Probabilities</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                      Normalize Selected Series
                    </label>
                    <div className="flex border border-border rounded-sm overflow-hidden bg-surface">
                      <button
                        type="button"
                        onClick={() => setTsNormEnabled(false)}
                        className={`flex-1 py-1.5 text-xs font-mono ${
                          !tsNormEnabled
                            ? "bg-ink text-white"
                            : "text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        Off (Raw)
                      </button>
                      <button
                        type="button"
                        onClick={() => setTsNormEnabled(true)}
                        className={`flex-1 py-1.5 text-xs font-mono ${
                          tsNormEnabled
                            ? "bg-ink text-white"
                            : "text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        Normalize On
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                      Normalization Scope
                    </label>
                    <select
                      disabled={!tsNormEnabled}
                      value={tsNormScope}
                      onChange={(e) => setTsNormScope(e.target.value as TimeSeriesNormScope)}
                      className="input-field py-1.5 text-xs font-mono disabled:opacity-50"
                    >
                      <option value="per_instance">Per Instance (Each Series)</option>
                      <option value="global">Global (Min-Max Across Selected Series)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                      Normalization Dimension
                    </label>
                    <select
                      disabled={!tsNormEnabled}
                      value={tsNormDimension}
                      onChange={(e) =>
                        setTsNormDimension(e.target.value as TimeSeriesNormDimension)
                      }
                      className="input-field py-1.5 text-xs font-mono disabled:opacity-50"
                    >
                      <option value="value">Value Dimension (Min-Max [0, 1])</option>
                      <option value="time">Time Dimension (Temporal / Cross-Series)</option>
                    </select>
                  </div>
                </div>

                {/* Add Time Series Button + Builder Card & Defined Series Cards List */}
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-mono uppercase font-semibold text-ink">
                      Defined Time Series ({customTimeSeries.length})
                    </span>
                    <button
                      type="button"
                      onClick={() => setAddingSeriesOpen((v) => !v)}
                      className="btn-primary py-1 px-3 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {addingSeriesOpen ? "Close Builder" : "Add Time Series"}
                    </button>
                  </div>

                  {/* Builder Card when "+ Add Time Series" is clicked */}
                  {addingSeriesOpen && (
                    <div className="border border-accent bg-accent-soft/40 p-3.5 rounded-sm space-y-3">
                      <div className="text-xs font-mono uppercase font-semibold text-accent-dark">
                        New Time Series Specification
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                        <div>
                          <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                            Document Type / Group
                          </label>
                          <select
                            value={draftSeriesCohortId}
                            onChange={(e) => setDraftSeriesCohortId(e.target.value)}
                            className="input-field py-1.5 text-xs font-mono"
                          >
                            {displayedTimeSeries.cohorts.map((c) => (
                              <option key={c.cohort_id} value={c.cohort_id}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                            Topic / Label
                          </label>
                          <select
                            value={draftSeriesTopicId}
                            onChange={(e) => setDraftSeriesTopicId(e.target.value)}
                            className="input-field py-1.5 text-xs font-mono"
                          >
                            {activeTsComparison.categories.map((cat) => (
                              <option key={cat.id} value={cat.id}>
                                {cat.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                            Date From (Default: All)
                          </label>
                          <input
                            type="date"
                            min={CORPUS_MIN_DATE}
                            max={CORPUS_MAX_DATE}
                            value={draftSeriesDateFrom}
                            onClick={openNativeDatePicker}
                            onChange={(e) =>
                              setDraftSeriesDateFrom(clampCorpusDate(e.target.value))
                            }
                            className="input-field py-1.5 text-xs font-mono cursor-pointer"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                            Date To (Default: All)
                          </label>
                          <input
                            type="date"
                            min={CORPUS_MIN_DATE}
                            max={CORPUS_MAX_DATE}
                            value={draftSeriesDateTo}
                            onClick={openNativeDatePicker}
                            onChange={(e) =>
                              setDraftSeriesDateTo(clampCorpusDate(e.target.value))
                            }
                            className="input-field py-1.5 text-xs font-mono cursor-pointer"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-mono uppercase text-muted mb-1">
                            Series Name (Optional)
                          </label>
                          <input
                            type="text"
                            value={draftSeriesName}
                            onChange={(e) => setDraftSeriesName(e.target.value)}
                            placeholder="Auto-named if empty"
                            className="input-field py-1.5 text-xs font-mono"
                          />
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDraftSeriesDateFrom("");
                            setDraftSeriesDateTo("");
                            setDraftSeriesName("");
                          }}
                          className="btn-secondary py-1 px-2.5 text-xs"
                        >
                          Clear Dates
                        </button>
                        <button
                          type="button"
                          onClick={handleCreateCustomSeries}
                          className="btn-primary py-1 px-3 text-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add Series to Chart
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Defined Series List (Compact cards showing only the name; click name to expand edit/duplicate/delete) */}
                  {customTimeSeries.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2">
                        {customTimeSeries.map((item, idx) => {
                          const color = DOCUMENT_COLORS[idx % DOCUMENT_COLORS.length];
                          const isEditing = editingSeriesId === item.id;
                          return (
                            <div
                              key={item.id}
                              className={`border rounded-sm transition-colors ${
                                isEditing
                                  ? "border-accent bg-accent-soft/30 w-full p-3 space-y-2.5"
                                  : "border-border bg-surface hover:border-ink px-3 py-1.5 inline-flex items-center gap-2"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingSeriesId((prev) =>
                                      prev === item.id ? null : item.id
                                    )
                                  }
                                  title="Click series name to edit, duplicate, or delete"
                                  className="inline-flex items-center gap-2 text-xs font-mono font-semibold text-ink hover:text-accent-dark text-left"
                                >
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span>{item.name}</span>
                                </button>
                                {isEditing && (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleDuplicateCustomSeries(item)}
                                      className="btn-secondary py-1 px-2 text-[11px]"
                                    >
                                      <Copy className="w-3 h-3" />
                                      Duplicate
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCustomSeries(item.id)}
                                      className="btn-secondary py-1 px-2 text-[11px] text-red-600"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                      Delete
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingSeriesId(null)}
                                      className="text-muted hover:text-ink p-1"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                )}
                              </div>

                              {isEditing && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 pt-2 border-t border-border/60">
                                  <div>
                                    <label className="block text-[10px] font-mono uppercase text-muted mb-0.5">
                                      Series Name
                                    </label>
                                    <input
                                      type="text"
                                      value={item.name}
                                      onChange={(e) =>
                                        handleUpdateCustomSeries(item.id, {
                                          name: e.target.value,
                                        })
                                      }
                                      className="input-field py-1 text-xs font-mono"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-mono uppercase text-muted mb-0.5">
                                      Document Type / Group
                                    </label>
                                    <select
                                      value={item.cohortId}
                                      onChange={(e) =>
                                        handleUpdateCustomSeries(item.id, {
                                          cohortId: e.target.value,
                                        })
                                      }
                                      className="input-field py-1 text-xs font-mono"
                                    >
                                      {displayedTimeSeries.cohorts.map((c) => (
                                        <option key={c.cohort_id} value={c.cohort_id}>
                                          {c.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-mono uppercase text-muted mb-0.5">
                                      Topic / Label
                                    </label>
                                    <select
                                      value={item.topicId}
                                      onChange={(e) =>
                                        handleUpdateCustomSeries(item.id, {
                                          topicId: e.target.value,
                                        })
                                      }
                                      className="input-field py-1 text-xs font-mono"
                                    >
                                      {activeTsComparison.categories.map((cat) => (
                                        <option key={cat.id} value={cat.id}>
                                          {cat.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-mono uppercase text-muted mb-0.5">
                                      Date From
                                    </label>
                                    <input
                                      type="date"
                                      min={CORPUS_MIN_DATE}
                                      max={CORPUS_MAX_DATE}
                                      value={item.dateFrom}
                                      onClick={openNativeDatePicker}
                                      onChange={(e) =>
                                        handleUpdateCustomSeries(item.id, {
                                          dateFrom: clampCorpusDate(e.target.value),
                                        })
                                      }
                                      className="input-field py-1 text-xs font-mono cursor-pointer"
                                    />
                                  </div>
                                  <div>
                                    <label className="block text-[10px] font-mono uppercase text-muted mb-0.5">
                                      Date To
                                    </label>
                                    <input
                                      type="date"
                                      min={CORPUS_MIN_DATE}
                                      max={CORPUS_MAX_DATE}
                                      value={item.dateTo}
                                      onClick={openNativeDatePicker}
                                      onChange={(e) =>
                                        handleUpdateCustomSeries(item.id, {
                                          dateTo: clampCorpusDate(e.target.value),
                                        })
                                      }
                                      className="input-field py-1 text-xs font-mono cursor-pointer"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Time-Series Chart Canvas or Empty Prompt (By default no time series is shown) */}
                {customTimeSeries.length === 0 ? (
                  <div className="h-[320px] border border-dashed border-border rounded-sm bg-canvas/40 flex flex-col items-center justify-center text-center p-6">
                    <p className="text-sm font-medium text-ink">
                      No time series defined yet
                    </p>
                    <p className="mt-1 text-xs text-muted max-w-md">
                      Click <strong>+ Add Time Series</strong> above to choose a Document Type,
                      Topic, and Date Range. Each added series will appear in your list and render
                      here immediately.
                    </p>
                    <button
                      type="button"
                      onClick={() => setAddingSeriesOpen(true)}
                      className="btn-primary mt-3 py-1.5 px-3.5 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Time Series
                    </button>
                  </div>
                ) : (
                  <EChartBox
                    option={timeSeriesOption}
                    className="w-full h-[440px]"
                    onChartClick={handleTimeSeriesPointClick}
                    onDataZoom={handleDataZoom}
                    onReady={(inst) => {
                      tsChartRef.current = inst;
                    }}
                  />
                )}
              </div>
            )}

          {/* Exhaustive Basket Raw Chunks & Classifier Scores Table (50-Row Preview + Full CSV Export) */}
          {basket.length > 0 && basketChunksData && (
            <div className="panel overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-zinc-50/70 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-mono uppercase text-ink font-semibold">
                    Basket Documents Raw Chunks &amp; Classifier Scores
                  </span>
                  <p className="text-[11px] font-mono text-muted">
                    Showing preview of first{" "}
                    <strong>{basketChunksData.preview_count.toLocaleString()}</strong> rows out of{" "}
                    <strong>{basketChunksData.total_chunks.toLocaleString()}</strong> total chunks
                    across <strong>{basketChunksData.total_documents}</strong> selected documents (
                    {dataSource})
                  </p>
                </div>
                <button
                  type="button"
                  disabled={exportingBasketCsv || basketChunksData.total_chunks === 0}
                  onClick={handleExportBasketChunksCsv}
                  title="Download all chunks and raw classifier scores for all selected documents as CSV"
                  className="btn-primary py-1.5 px-3 text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportingBasketCsv
                    ? "Exporting Full CSV..."
                    : `Download All Chunks CSV (${basketChunksData.total_chunks.toLocaleString()})`}
                </button>
              </div>
              <div className="overflow-x-auto max-h-[440px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border bg-surface text-muted sticky top-0 z-10">
                      <th className="py-2 px-3 whitespace-nowrap">Chunk ID</th>
                      <th className="py-2 px-3 whitespace-nowrap">Doc Type</th>
                      <th className="py-2 px-3 whitespace-nowrap">Meeting Date</th>
                      <th className="py-2 px-3 whitespace-nowrap">Speaker</th>
                      <th className="py-2 px-3 text-right whitespace-nowrap">p_relevant</th>
                      {basketChunksData.categories.map((cat) => (
                        <th key={cat.id} className="py-2 px-3 text-right whitespace-nowrap">
                          {cat.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {basketChunksData.chunks.map((row) => (
                      <tr key={`${row.doc_type}::${row.chunk_id}`} className="hover:bg-zinc-50">
                        <td className="py-2 px-3 text-zinc-500 whitespace-nowrap">
                          {row.chunk_id}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className="mono-tag">{row.doc_type_label}</span>
                        </td>
                        <td className="py-2 px-3 font-semibold text-ink whitespace-nowrap">
                          {row.meeting_date}
                        </td>
                        <td className="py-2 px-3 text-zinc-700 whitespace-nowrap">
                          {row.speaker || "—"}
                        </td>
                        <td className="py-2 px-3 text-right text-accent-dark whitespace-nowrap">
                          {row.p_relevant !== null && row.p_relevant !== undefined
                            ? formatSigFigs(row.p_relevant, 3)
                            : "—"}
                        </td>
                        {basketChunksData.categories.map((cat) => (
                          <td
                            key={cat.id}
                            className="py-2 px-3 text-right text-zinc-700 whitespace-nowrap"
                          >
                            {typeof row.scores[cat.id] === "number"
                              ? formatSigFigs(row.scores[cat.id], 3)
                              : "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Interactive Hierarchical Grouping Tree Modal (Uncapped) */}
      <GroupingTreeModal
        open={treeModalOpen}
        onClose={() => setTreeModalOpen(false)}
        documents={basket}
        initialConfig={groupingTree}
        onApply={(cfg) => setGroupingTree(cfg)}
        onInspectNode={(title: string, pathFilters: PathFilterItem[]) =>
          setInspectorTarget({
            title,
            documents: basket,
            pathFilters,
            sliceIndex: null,
            nPartitions: 1,
          })
        }
      />

      {/* Deep Drill-Down Slice & Subgroup Inspector Drawer */}
      <SliceInspectorDrawer
        target={inspectorTarget}
        onClose={() => setInspectorTarget(null)}
        dataSource={dataSource}
        metric={metric}
        normalization={normalization}
        granularity={granularity}
        macroCategory={macroCategory}
      />

      {/* Save / Fork Study Modal */}
      {studyModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="panel w-full max-w-md p-6 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <h3 className="text-base font-semibold text-ink">
                {isForeignPublicStudy ? "Fork Study to Portfolio" : "Save Comparator Study"}
              </h3>
              <button
                type="button"
                onClick={() => setStudyModalOpen(false)}
                className="text-zinc-400 hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveOrForkSubmit} className="mt-4 space-y-3">
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Study Title
                </label>
                <input
                  type="text"
                  required
                  value={studyTitle}
                  onChange={(e) => setStudyTitle(e.target.value)}
                  className="input-field text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-mono uppercase text-muted mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  value={studyDesc}
                  onChange={(e) => setStudyDesc(e.target.value)}
                  placeholder="Describe your research question or cohort comparison..."
                  className="input-field text-xs"
                />
              </div>
              {!isForeignPublicStudy && (
                <label className="inline-flex items-center gap-2 text-xs font-mono text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={studyPublic}
                    onChange={(e) => setStudyPublic(e.target.checked)}
                    className="accent-ink"
                  />
                  Publish to Community Feed (Public)
                </label>
              )}
              {studyFeedback && (
                <p className="text-xs font-mono text-accent-dark">{studyFeedback}</p>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setStudyModalOpen(false)}
                  className="btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" disabled={savingStudy} className="btn-primary text-xs">
                  {savingStudy
                    ? "Saving..."
                    : isForeignPublicStudy
                    ? "Fork Study"
                    : "Save Study"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
