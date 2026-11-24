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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  GitBranch,
  GitFork,
  ListPlus,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sliders,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { EChartBox } from "../components/EChartBox";
import { GroupingTreeModal } from "../components/GroupingTreeModal";
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
  clampCorpusDate,
  formatSigFigs,
} from "../lib/format";
import type {
  AggregationMethod,
  CompareResponse,
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

  // Basket search filters (Unified Date Range <= 2020, Speaker Autocomplete, uncapped Add All)
  const [searchDocType, setSearchDocType] = useState("");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [searchSpeaker, setSearchSpeaker] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterMetric, setFilterMetric] = useState<MetricTransform>("cosine");
  const [filterNorm, setFilterNorm] = useState<NormalizationMode>("none");
  const [filterMinScore, setFilterMinScore] = useState("");
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

  // Anti-clutter Time-Series controls (1 topic active by default, cohort toggles, semantic zoom window)
  const [activeTopicIds, setActiveTopicIds] = useState<string[]>([]);
  const [hiddenCohortIds, setHiddenCohortIds] = useState<string[]>([]);
  const [zoomWindow, setZoomWindow] = useState<[number, number]>([0, 100]);

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
      doc_type: searchDocType || undefined,
      date_from: effFrom || undefined,
      date_to: effTo || undefined,
      speaker: searchSpeaker || undefined,
      query_text: searchText || undefined,
      filter_category: filterCategory || undefined,
      filter_metric: filterCategory ? filterMetric : undefined,
      filter_normalization: filterCategory ? filterNorm : undefined,
      filter_min_score:
        filterCategory && filterMinScore.trim() !== ""
          ? Number(filterMinScore)
          : undefined,
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

  useEffect(() => {
    runCandidateSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live reactive comparison query (uncapped for both ungrouped and tree-grouped modes)
  useEffect(() => {
    if (basket.length === 0) {
      setComparison(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .compareDocuments({
        documents: basket.map((d) => ({ doc_type: d.doc_type, meeting_date: d.meeting_date })),
        n_partitions: nPartitions,
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
        setComparison(res);
        setZoomWindow([0, 100]);
        setHiddenCohortIds([]);
        setRadarTickIdx(0);
        if (res.categories.length > 0) {
          setActiveTopicIds((prev) => {
            const validPrev = prev.filter((id) => res.categories.some((c) => c.id === id));
            return validPrev.length > 0 ? validPrev : [res.categories[0].id];
          });
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Comparison failed"))
      .finally(() => setLoading(false));
  }, [
    basket,
    nPartitions,
    dataSource,
    metric,
    normalization,
    granularity,
    macroCategory,
    groupingTree,
    aggMethod,
  ]);

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

  // 1. Synchronized Radar Chart Option (plots all visible cohorts at the active chronological tick)
  const radarOption = useMemo(() => {
    if (!comparison || comparison.categories.length === 0 || resolvedTimeSeries.cohorts.length === 0) {
      return {};
    }

    const visibleCohorts = resolvedTimeSeries.cohorts.filter(
      (c) => !hiddenCohortIds.includes(c.cohort_id)
    );
    const plotted: { name: string; value: number[]; color: string }[] = [];
    let globalMax = 0.01;
    let globalMin = 0;

    visibleCohorts.forEach((cohort, cIdx) => {
      const vals = comparison.categories.map((_, catIdx) => {
        const v = cohort.values_by_topic[catIdx]?.[safeRadarTickIdx];
        return typeof v === "number" ? v : 0;
      });
      const hasData = comparison.categories.some(
        (_, catIdx) => typeof cohort.values_by_topic[catIdx]?.[safeRadarTickIdx] === "number"
      );
      if (!hasData) return;

      vals.forEach((v) => {
        if (v > globalMax) globalMax = v;
        if (v < globalMin) globalMin = v;
      });

      const color = DOCUMENT_COLORS[cIdx % DOCUMENT_COLORS.length];
      plotted.push({
        name: activeRadarTick ? `${cohort.label} (${activeRadarTick.full_label})` : cohort.label,
        value: vals,
        color,
      });
    });

    const axisMax = Number((globalMax * 1.1).toFixed(3));
    const axisMin = globalMin < 0 ? Number((globalMin * 1.1).toFixed(3)) : 0;
    const catLabels = comparison.categories.map((c) => c.label);

    return {
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
        type: "plain",
        orient: "horizontal",
        left: "center",
        itemGap: 12,
        textStyle: { fontFamily: "JetBrains Mono", fontSize: 11 },
      },
      radar: {
        radius: "62%",
        center: ["50%", "45%"],
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
          symbolSize: 5,
          data: plotted.map((s) => ({
            name: s.name,
            value: s.value,
            itemStyle: { color: s.color },
            lineStyle: { color: s.color, width: 2.2 },
            areaStyle: { color: s.color, opacity: 0.12 },
          })),
        },
      ],
    };
  }, [comparison, resolvedTimeSeries.cohorts, hiddenCohortIds, safeRadarTickIdx, activeRadarTick, isDark]);

  // 3-Level Hierarchical Semantic Zoom Granularity: MACRO (Year) -> MESO (Month/Meeting) -> MICRO (Slices)
  const zoomGranularity = useMemo<"macro" | "meso" | "micro">(() => {
    const ticks = resolvedTimeSeries.ticks;
    if (ticks.length === 0) return "micro";
    const startIdx = Math.floor((zoomWindow[0] / 100) * Math.max(0, ticks.length - 1));
    const endIdx = Math.ceil((zoomWindow[1] / 100) * Math.max(0, ticks.length - 1));
    const visible = ticks.slice(startIdx, endIdx + 1);
    const visibleCount = visible.length;
    const distinctYears = new Set(visible.map((t) => t.year)).size;
    const distinctPeriods = new Set(visible.map((t) => t.period_key)).size;
    const hasSlices = visible.some((t) => t.total_slices > 1);

    if (distinctYears >= 4 || visibleCount > 48) return "macro";
    if (distinctPeriods > 3 || (visibleCount > 18 && hasSlices)) return "meso";
    return "micro";
  }, [resolvedTimeSeries.ticks, zoomWindow]);

  // 2. Chronologically Flattened Time-Series Option (ONE continuous curve per Cohort x Topic)
  const timeSeriesOption = useMemo(() => {
    const { ticks, cohorts } = resolvedTimeSeries;
    if (!comparison || ticks.length === 0 || cohorts.length === 0) return {};

    const visibleCohorts = cohorts.filter((c) => !hiddenCohortIds.includes(c.cohort_id));
    const activeTopicSet = new Set(activeTopicIds);

    // Format X-axis labels cleanly according to the 3 semantic zoom levels
    const xAxisLabels = ticks.map((t, idx) => {
      if (zoomGranularity === "macro") {
        // Level 1: Years only at the start of each year
        if (idx === 0 || ticks[idx - 1].year !== t.year) {
          return String(t.year);
        }
        return "";
      }
      if (zoomGranularity === "meso") {
        // Level 2: Year + Month / Meeting Date / Period at start of each period
        if (idx === 0 || ticks[idx - 1].period_key !== t.period_key) {
          return t.period_label;
        }
        return "";
      }
      // Level 3 (Micro): Individual Slices with parent period header on Slice 1
      if (t.total_slices > 1) {
        if (t.slice_num === 1 || idx === 0 || ticks[idx - 1].period_key !== t.period_key) {
          return `${t.period_label}\nSlice ${t.slice_num}`;
        }
        return `Slice ${t.slice_num}`;
      }
      return t.period_label;
    });

    // Subtle vertical dividers between meetings/periods in Micro zoom mode
    const periodDividers: Array<{ xAxis: number }> = [];
    if (zoomGranularity === "micro") {
      ticks.forEach((t, idx) => {
        if (idx > 0 && ticks[idx - 1].period_key !== t.period_key) {
          periodDividers.push({ xAxis: idx });
        }
      });
    }

    const seriesLines: Record<string, unknown>[] = [];
    let colorIdx = 0;

    comparison.categories.forEach((cat, catIdx) => {
      if (!activeTopicSet.has(cat.id)) return;
      visibleCohorts.forEach((cohort, cLocalIdx) => {
        const seriesName =
          visibleCohorts.length === 1 ? cat.label : `${cohort.label} · ${cat.label}`;
        const color = DOCUMENT_COLORS[colorIdx % DOCUMENT_COLORS.length];
        colorIdx += 1;

        const isFirstSeries = seriesLines.length === 0;
        seriesLines.push({
          name: seriesName,
          type: "line",
          smooth: false,
          connectNulls: true,
          symbol: "circle",
          symbolSize: ticks.length > 80 ? 3 : 5,
          itemStyle: { color },
          lineStyle: { width: 2, color },
          emphasis: {
            focus: "series",
            lineStyle: { width: 3.5 },
            itemStyle: { borderWidth: 2, borderColor: "#09090B" },
          },
          blur: {
            lineStyle: { opacity: 0.14 },
            itemStyle: { opacity: 0.14 },
          },
          ...(isFirstSeries && periodDividers.length > 0
            ? {
                markLine: {
                  silent: true,
                  symbol: ["none", "none"],
                  label: { show: false },
                  lineStyle: { color: "#D4D4D8", type: "dashed", width: 1 },
                  data: periodDividers,
                },
              }
            : {}),
          data: cohort.values_by_topic[catIdx].map((val, tIdx) => ({
            value: val,
            _cohortId: cohort.cohort_id,
            _cohortLabel: cohort.label,
            _topicLabel: cat.label,
            _tickIndex: tIdx,
          })),
        });
        void cLocalIdx;
      });
    });

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
            _tickIndex?: number;
          };
        }) => {
          const tIdx = p.data?._tickIndex ?? 0;
          const tk = ticks[tIdx];
          const hierarchy = tk
            ? `${tk.year} · ${tk.period_label}${
                tk.total_slices > 1 ? ` · Slice ${tk.slice_num}/${tk.total_slices}` : ""
              }`
            : "";
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;min-width:230px;">
            <div style="font-weight:700;margin-bottom:4px;border-bottom:1px solid #E4E4E7;padding-bottom:3px;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:6px;"></span>
              ${p.data?._cohortLabel || p.seriesName}
            </div>
            <div>Topic: <strong>${p.data?._topicLabel || ""}</strong></div>
            <div>Timeline: <strong>${hierarchy}</strong></div>
            <div>Value: <strong>${formatSigFigs(Number(p.value), 3)}</strong></div>
            <div style="margin-top:4px;font-size:10px;color:#71717A;">Click point to inspect underlying chunks</div>
          </div>`;
        },
      },
      grid: { top: 20, left: 54, right: 24, bottom: zoomGranularity === "micro" ? 84 : 72 },
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
    comparison,
    resolvedTimeSeries,
    activeTopicIds,
    hiddenCohortIds,
    zoomGranularity,
    zoomWindow,
    isDark,
  ]);

  const handleTimeSeriesPointClick = useCallback(
    (params: Record<string, unknown>) => {
      const dataObj = params.data as
        | { _cohortId?: string; _cohortLabel?: string; _tickIndex?: number }
        | undefined;
      if (!dataObj || typeof dataObj._tickIndex !== "number") return;
      const cohort = resolvedTimeSeries.cohorts.find((c) => c.cohort_id === dataObj._cohortId);
      const tk = resolvedTimeSeries.ticks[dataObj._tickIndex];
      const meta = cohort?.tick_meta[dataObj._tickIndex];
      if (!meta || !tk) return;

      // Also sync Radar scrubber to the clicked chronological point
      setRadarTickIdx(dataObj._tickIndex);

      setInspectorTarget({
        title: `${cohort?.label || "Cohort"} → ${tk.full_label}`,
        documents: meta.documents,
        pathFilters: meta.path_filters,
        periodKey: meta.period_key,
        sliceIndex: meta.slice_index,
        nPartitions: meta.n_partitions,
      });
    },
    [resolvedTimeSeries]
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

  // Full Chronological CSV Export (All Cohorts, All Meetings/Periods, All Slices 1..S, Full Precision)
  const handleExportCsv = () => {
    if (!comparison || comparison.categories.length === 0 || resolvedTimeSeries.ticks.length === 0) {
      return;
    }
    const esc = (val: string | number) => {
      const s = String(val);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const categories = comparison.categories;
    const ticks = resolvedTimeSeries.ticks;
    const sortedCohorts = [...resolvedTimeSeries.cohorts].sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    const indexedTicks = ticks
      .map((tk, idx) => ({ tk, idx }))
      .sort((a, b) => {
        if (a.tk.year !== b.tk.year) return a.tk.year - b.tk.year;
        const pCmp = a.tk.period_key.localeCompare(b.tk.period_key);
        if (pCmp !== 0) return pCmp;
        return a.tk.slice_index - b.tk.slice_index;
      });

    const headers = [
      "cohort",
      "year",
      "period_or_date",
      "slice_index",
      "total_slices",
      "doc_count",
      "chunk_count",
      "metric_transform",
      "normalization",
      ...categories.map((c) => c.id),
    ];

    const lines: string[] = [headers.map(esc).join(",")];

    for (const cohort of sortedCohorts) {
      for (const { tk, idx } of indexedTicks) {
        const scores = categories.map((_, cIdx) => {
          const v = cohort.values_by_topic[cIdx]?.[idx];
          return typeof v === "number" && Number.isFinite(v) ? v : null;
        });
        if (scores.every((v) => v === null)) continue;

        const meta = cohort.tick_meta[idx];
        const docCount = meta?.doc_count ?? meta?.documents?.length ?? 0;
        const chunkCount = meta?.chunk_count ?? 0;
        const periodOrDate = tk.period_key || tk.meeting_date || tk.period_label;

        const row: (string | number)[] = [
          cohort.label,
          tk.year,
          periodOrDate,
          tk.slice_index,
          tk.total_slices,
          docCount,
          chunkCount,
          comparison.metric,
          comparison.normalization,
          ...scores.map((v) => (v === null ? "" : String(v))),
        ];
        lines.push(row.map(esc).join(","));
      }
    }

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `miningfomc_chronological_${comparison.metric}_${comparison.normalization}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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

  const toggleTopic = (topicId: string) => {
    setActiveTopicIds((prev) =>
      prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId]
    );
  };

  const toggleCohort = (cohortId: string) => {
    setHiddenCohortIds((prev) =>
      prev.includes(cohortId) ? prev.filter((id) => id !== cohortId) : [...prev, cohortId]
    );
  };

  const treeSummaryLabel = groupingTree
    ? groupingTree.split_levels
        .map((l) =>
          l.criterion === "year_range"
            ? `Year Range (${l.year_range_span}y)`
            : l.criterion.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())
        )
        .join(" → ") || "Root Cohort"
    : null;

  const zoomBadgeLabel =
    zoomGranularity === "macro"
      ? "MACRO · YEARS"
      : zoomGranularity === "meso"
      ? "MESO · MONTHS / MEETINGS"
      : "MICRO · INTRA-PERIOD SLICES";

  return (
    <div className="space-y-6">
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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: Compact 3-Row Scrollable Basket + Uncapped Filter & Add All */}
        <div className="xl:col-span-4 space-y-4">
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
                Comparison Basket ({basket.length})
              </h2>
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
            </div>

            {basket.length === 0 ? (
              <p className="text-xs text-muted py-3">
                Select documents below (or click Add All) to compare standardized topic profiles.
              </p>
            ) : (
              <div className="max-h-[152px] overflow-y-auto pr-1 flex flex-wrap gap-1.5 content-start">
                {basket.map((doc, idx) => {
                  const color = DOCUMENT_COLORS[idx % DOCUMENT_COLORS.length];
                  return (
                    <div
                      key={`${doc.doc_type}::${doc.meeting_date}`}
                      className="inline-flex items-center gap-1.5 px-2 py-1 border border-border rounded-sm bg-canvas text-[11px] font-mono max-w-full"
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-semibold text-ink">{doc.meeting_date}</span>
                      <span className="text-muted truncate max-w-[90px]">
                        {doc.doc_type_label || doc.doc_type}
                      </span>
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
            )}
          </div>

          {/* Advanced Basket Selector & Filters */}
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
                Add Documents to Basket
              </h2>
              <button
                type="button"
                disabled={candidatesTotal === 0 || addingAll}
                onClick={handleAddAllMatching}
                className="btn-primary py-1 px-2.5 text-[11px] shrink-0"
              >
                <ListPlus className="w-3 h-3" />
                {addingAll
                  ? "Adding..."
                  : `Add All (${candidatesTotal.toLocaleString()})`}
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                runCandidateSearch();
              }}
              className="space-y-2.5"
            >
              <select
                value={searchDocType}
                onChange={(e) => setSearchDocType(e.target.value)}
                className="input-field text-xs"
              >
                <option value="">All Document Types</option>
                {docTypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>
                    {dt.label}
                  </option>
                ))}
              </select>

              <div className="space-y-1">
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
                      onChange={(e) => setSearchDateFrom(clampCorpusDate(e.target.value))}
                      className="input-field font-mono text-[11px]"
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
                      onChange={(e) => setSearchDateTo(clampCorpusDate(e.target.value))}
                      title="Leave empty for an exact single-date match on Date From"
                      className="input-field font-mono text-[11px]"
                    />
                  </div>
                </div>
                <p className="text-[10px] font-mono text-zinc-400">
                  Leave Date To empty for an exact single-date match (max 2020).
                </p>
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

              <div className="pt-2 border-t border-border space-y-1.5">
                <div className="text-[10px] font-mono uppercase text-muted">
                  Score Threshold Filter (Optional)
                </div>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="input-field text-xs"
                >
                  <option value="">No Topic Score Filter</option>
                  {macroCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                {filterCategory && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <select
                      value={filterMetric}
                      onChange={(e) => setFilterMetric(e.target.value as MetricTransform)}
                      className="input-field text-[11px] font-mono"
                    >
                      <option value="cosine">Cosine</option>
                      <option value="softmax">Softmax</option>
                      <option value="log">Log</option>
                    </select>
                    <select
                      value={filterNorm}
                      onChange={(e) => setFilterNorm(e.target.value as NormalizationMode)}
                      className="input-field text-[11px] font-mono"
                    >
                      <option value="none">None</option>
                      <option value="topic">Topic</option>
                      <option value="slice">Slice</option>
                    </select>
                    <input
                      type="number"
                      step="0.05"
                      value={filterMinScore}
                      onChange={(e) => setFilterMinScore(e.target.value)}
                      placeholder=">= val"
                      className="input-field text-[11px] font-mono"
                    />
                  </div>
                )}
              </div>

              <button type="submit" disabled={searching} className="btn-secondary w-full text-xs">
                <Search className="w-3.5 h-3.5" />
                {searching ? "Filtering..." : "Apply Filters"}
              </button>
            </form>

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
                          ? ` · score ${formatSigFigs(c.matched_score, 3)}`
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

        {/* Right Column: Controls, Group/Combine Tree Bar, Radar, Flattened Time-Series & CSV Table */}
        <div className="xl:col-span-8 space-y-4">
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
                      { id: "slice", label: "Slice" },
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

            {/* Temporal Partitions (numeric input ONLY) + Synchronized Chronological Radar Scrubber */}
            <div className="pt-3 border-t border-border flex flex-wrap items-end gap-5">
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
          </div>

          {error && (
            <div className="panel border-red-300 bg-red-50 p-3 text-xs font-mono text-red-700">
              {error}
            </div>
          )}

          {/* Synchronized Interactive Radar Chart */}
          <div className="panel p-4">
            {basket.length === 0 ? (
              <div className="h-[420px] flex flex-col items-center justify-center text-center p-6">
                <p className="text-sm font-medium text-ink">No documents in comparison basket</p>
                <p className="mt-1 text-xs text-muted max-w-sm">
                  Add documents from the left panel to plot their standardized macroeconomic radar
                  and chronological slice trajectories.
                </p>
              </div>
            ) : loading ? (
              <div className="h-[420px] flex items-center justify-center text-xs font-mono text-muted">
                Computing chronological N-partition comparison...
              </div>
            ) : comparison && comparison.categories.length > 0 ? (
              <EChartBox option={radarOption} className="w-full h-[460px]" />
            ) : (
              <div className="h-[420px] flex items-center justify-center text-xs font-mono text-muted">
                Selected data source ({dataSource}) has no precomputed vectors for these documents.
              </div>
            )}
          </div>

          {/* Chronologically Flattened Time-Series Chart with 3-Level Semantic Zoom & Anti-Clutter Toggles */}
          {comparison &&
            comparison.categories.length > 0 &&
            resolvedTimeSeries.ticks.length > 0 && (
              <div className="panel p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-mono uppercase tracking-wider font-semibold text-ink">
                      Chronological Time-Series ({resolvedTimeSeries.ticks.length} sequential points
                      · <span className="text-accent-dark">{zoomBadgeLabel}</span>)
                    </h3>
                    <p className="text-[11px] font-mono text-muted">
                      Scroll or drag to zoom (Years → Months/Meetings → Slices) · Hover to highlight
                      · Click any point to inspect chunks &amp; sync Radar.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
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

                {/* Anti-Clutter Topic Pills (1 primary topic active by default) */}
                <div className="space-y-1.5 pt-2 border-t border-border">
                  <div className="flex items-center justify-between text-[10px] font-mono uppercase text-muted">
                    <span>Topics ({activeTopicIds.length} active)</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveTopicIds([comparison.categories[0].id])}
                        className="underline hover:text-ink"
                      >
                        1 Topic
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTopicIds(comparison.categories.map((c) => c.id))}
                        className="underline hover:text-ink"
                      >
                        All Topics
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {comparison.categories.map((cat) => {
                      const active = activeTopicIds.includes(cat.id);
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => toggleTopic(cat.id)}
                          className={`px-2 py-0.5 text-[11px] font-mono rounded-sm border transition-colors ${
                            active
                              ? "bg-ink text-white border-ink"
                              : "bg-surface text-muted border-border hover:border-ink"
                          }`}
                        >
                          {cat.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cohort Series Toggles (when multiple non-temporal cohorts exist) */}
                {resolvedTimeSeries.cohorts.length > 1 && (
                  <div className="space-y-1.5 pt-2 border-t border-border">
                    <div className="text-[10px] font-mono uppercase text-muted">
                      Cohort Curves ({resolvedTimeSeries.cohorts.length - hiddenCohortIds.length} /{" "}
                      {resolvedTimeSeries.cohorts.length} visible)
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {resolvedTimeSeries.cohorts.map((cohort, idx) => {
                        const visible = !hiddenCohortIds.includes(cohort.cohort_id);
                        const color = DOCUMENT_COLORS[idx % DOCUMENT_COLORS.length];
                        return (
                          <button
                            key={cohort.cohort_id}
                            type="button"
                            onClick={() => toggleCohort(cohort.cohort_id)}
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-mono rounded-sm border transition-colors ${
                              visible
                                ? "bg-surface text-ink border-ink"
                                : "bg-zinc-100 text-zinc-400 border-border line-through"
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: visible ? color : "#D4D4D8" }}
                            />
                            {cohort.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <EChartBox
                  option={timeSeriesOption}
                  className="w-full h-[440px]"
                  onChartClick={handleTimeSeriesPointClick}
                  onDataZoom={handleDataZoom}
                />
              </div>
            )}

          {/* Standardized Category Scores Table + Export CSV (synced with active chronological point) */}
          {comparison && comparison.categories.length > 0 && resolvedTimeSeries.cohorts.length > 0 && (
            <div className="panel overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-zinc-50/70 flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase text-muted font-semibold">
                  Standardized Category Scores ({metric} · {normalization}
                  {activeRadarTick ? ` · ${activeRadarTick.full_label}` : ""})
                </span>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  title="Downloads all cohorts, meetings/periods, and slices in chronological order"
                  className="btn-secondary py-1 px-2.5 text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export Full Chronological CSV
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-border bg-surface text-muted">
                      <th className="py-2 px-3">Topic / Category</th>
                      {resolvedTimeSeries.cohorts.map((c) => (
                        <th key={c.cohort_id} className="py-2 px-3 text-right whitespace-nowrap">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {comparison.categories.map((cat, cIdx) => (
                      <tr key={cat.id} className="hover:bg-zinc-50">
                        <td className="py-2 px-3 font-sans font-medium text-ink">{cat.label}</td>
                        {resolvedTimeSeries.cohorts.map((c) => {
                          const val = c.values_by_topic[cIdx]?.[safeRadarTickIdx];
                          return (
                            <td key={c.cohort_id} className="py-2 px-3 text-right text-zinc-700">
                              {typeof val === "number" ? formatSigFigs(val, 3) : "—"}
                            </td>
                          );
                        })}
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
