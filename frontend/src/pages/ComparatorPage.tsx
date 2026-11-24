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
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  GitBranch,
  GitFork,
  Layers,
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

  // Basket search filters (Multi-select Document Type, Unified Date Range <= 2020, Speaker, Extended Score Thresholds)
  const [searchDocTypes, setSearchDocTypes] = useState<string[]>([]);
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [searchSpeaker, setSearchSpeaker] = useState("");
  const [searchText, setSearchText] = useState("");
  const [scoreFilter, setScoreFilter] = useState<ScoreThresholdFilterValue>(
    EMPTY_SCORE_THRESHOLD_FILTER
  );
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
    let cancelled = false;
    const timer = window.setTimeout(() => {
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
          if (cancelled) return;
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

  // 1. Fixed Radar Chart: displays EVERY selected document or group in Comparator.
  // If > 10 items are selected, auto-groups by year and triggers an informative UI banner.
  const radarSummary = useMemo<{
    option: Record<string, unknown>;
    autoGroupedByYear: boolean;
    originalCount: number;
    plottedCount: number;
  }>(() => {
    if (!comparison || comparison.categories.length === 0) {
      return { option: {}, autoGroupedByYear: false, originalCount: 0, plottedCount: 0 };
    }

    const availableSeries = (comparison.series || []).filter(
      (s) => s.available && Array.isArray(s.partitions) && s.partitions.length > 0
    );
    if (availableSeries.length === 0) {
      return { option: {}, autoGroupedByYear: false, originalCount: 0, plottedCount: 0 };
    }

    const nCats = comparison.categories.length;
    const activeSliceNum = activeRadarTick?.slice_num || 1;
    const activePeriodKey = activeRadarTick?.period_key || activeRadarTick?.meeting_date || "";
    const activeMeetingDate = activeRadarTick?.meeting_date || "";
    const activePeriodLabel = activeRadarTick?.period_label || "";
    const sliceSuffix =
      (activeRadarTick?.total_slices || nPartitions) > 1
        ? ` · S${activeSliceNum}/${activeRadarTick?.total_slices || nPartitions}`
        : "";

    const rawTraces = availableSeries.map((s) => {
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
      const label = `${baseLabel}${sliceSuffix}`;
      const yearMatch = String(s.meeting_date || "").match(/(19\d{2}|20\d{2})/);
      const yearKey = yearMatch ? yearMatch[1] : s.meeting_date || "Other";
      const isFocused =
        Boolean(activeRadarTick) &&
        (s.meeting_date === activeMeetingDate ||
          s.meeting_date === activePeriodKey ||
          s.meeting_date === activePeriodLabel ||
          (isTreeLeaf && Boolean(activePeriodLabel) && s.meeting_date.includes(activePeriodLabel)));
      return {
        label,
        yearKey,
        values: avgVals,
        isFocused,
      };
    });

    const originalCount = rawTraces.length;
    const autoGroupedByYear = originalCount > 10;
    const activeYearStr = String(activeMeetingDate || activePeriodKey);
    const activeYearKey = /^\d{4}/.test(activeYearStr) ? activeYearStr.slice(0, 4) : "";

    let finalTraces: Array<{ name: string; value: number[]; isFocused: boolean }> = [];
    if (autoGroupedByYear) {
      const byYear = new Map<string, number[][]>();
      for (const tr of rawTraces) {
        const list = byYear.get(tr.yearKey) || [];
        list.push(tr.values);
        byYear.set(tr.yearKey, list);
      }
      const sortedYears = Array.from(byYear.keys()).sort();
      finalTraces = sortedYears.map((yr) => {
        const vecs = byYear.get(yr) || [];
        const meanVec = new Array<number>(nCats).fill(0);
        for (let c = 0; c < nCats; c++) {
          let sum = 0;
          for (const v of vecs) sum += v[c] ?? 0;
          meanVec[c] = vecs.length > 0 ? sum / vecs.length : 0;
        }
        return {
          name: `${yr} (${vecs.length} ${vecs.length === 1 ? "item" : "items"})${sliceSuffix}`,
          value: meanVec,
          isFocused: yr === activeYearKey,
        };
      });

      const focusedRaw = rawTraces.filter((tr) => tr.isFocused);
      if (focusedRaw.length > 0 && activeRadarTick) {
        const pointVec = new Array<number>(nCats).fill(0);
        for (let c = 0; c < nCats; c++) {
          let sum = 0;
          for (const f of focusedRaw) sum += f.values[c] ?? 0;
          pointVec[c] = sum / focusedRaw.length;
        }
        finalTraces.unshift({
          name: `Active: ${activeRadarTick.full_label}`,
          value: pointVec,
          isFocused: true,
        });
      } else if (activeRadarTick && resolvedTimeSeries.cohorts.length > 0) {
        const pointVec = comparison.categories.map((_, catIdx) => {
          let sum = 0;
          let cnt = 0;
          for (const coh of resolvedTimeSeries.cohorts) {
            const v = coh.values_by_topic?.[catIdx]?.[safeRadarTickIdx];
            if (typeof v === "number" && Number.isFinite(v)) {
              sum += v;
              cnt += 1;
            }
          }
          return cnt > 0 ? sum / cnt : 0;
        });
        finalTraces.unshift({
          name: `Active: ${activeRadarTick.full_label}`,
          value: pointVec,
          isFocused: true,
        });
      }
    } else {
      finalTraces = rawTraces.map((tr) => ({
        name: tr.label,
        value: tr.values,
        isFocused: tr.isFocused,
      }));
    }

    let globalMax = 0.01;
    let globalMin = 0;
    for (const s of availableSeries) {
      for (const p of s.partitions) {
        for (const v of p.values || []) {
          if (typeof v === "number" && Number.isFinite(v)) {
            if (v > globalMax) globalMax = v;
            if (v < globalMin) globalMin = v;
          }
        }
      }
    }
    const hasAnyFocused = finalTraces.some((tr) => tr.isFocused);
    const plotted = finalTraces.map((tr, idx) => {
      tr.value.forEach((v) => {
        if (v > globalMax) globalMax = v;
        if (v < globalMin) globalMin = v;
      });
      return {
        name: tr.name,
        value: tr.value,
        isFocused: tr.isFocused,
        color: DOCUMENT_COLORS[idx % DOCUMENT_COLORS.length],
      };
    });

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
            symbolSize: s.isFocused ? 7 : 4,
            z: s.isFocused ? 10 : 2,
            itemStyle: { color: s.color },
            lineStyle: {
              color: s.color,
              width: s.isFocused ? 3.2 : hasAnyFocused ? 1.6 : 2.2,
              opacity: s.isFocused ? 1 : hasAnyFocused ? 0.65 : 0.9,
            },
            areaStyle: {
              color: s.color,
              opacity: s.isFocused ? 0.24 : hasAnyFocused ? 0.06 : 0.1,
            },
          })),
        },
      ],
    };

    return {
      option,
      autoGroupedByYear,
      originalCount,
      plottedCount: plotted.length,
    };
  }, [comparison, isDark, activeRadarTick, resolvedTimeSeries.cohorts, safeRadarTickIdx, nPartitions]);

  // Compute Meeting-Averaged Timeline (used by default when Splits are NOT expanded)
  const averagedTimeSeries = useMemo<{
    ticks: TimeTickMeta[];
    cohorts: OrderedTimeSeriesCohort[];
  }>(() => {
    const { ticks, cohorts } = resolvedTimeSeries;
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
  }, [resolvedTimeSeries]);

  const hasMultipleSplits = useMemo(
    () => nPartitions > 1 && resolvedTimeSeries.ticks.some((t) => t.total_slices > 1),
    [nPartitions, resolvedTimeSeries.ticks]
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
    () => (splitsVisible ? resolvedTimeSeries : averagedTimeSeries),
    [splitsVisible, resolvedTimeSeries, averagedTimeSeries]
  );

  // 2. Chronologically Flattened Time-Series Option with Semantic Zoom, Splits Toggle & Meeting Visual Regions
  const timeSeriesOption = useMemo(() => {
    const { ticks, cohorts } = displayedTimeSeries;
    if (!comparison || ticks.length === 0 || cohorts.length === 0) return {};

    const visibleCohorts = cohorts.filter((c) => !hiddenCohortIds.includes(c.cohort_id));
    const activeTopicSet = new Set(activeTopicIds);

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

    // Visual meeting regions (alternating shaded bands + vertical delimiters) when splits are displayed
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

    const seriesLines: Record<string, unknown>[] = [];
    let colorIdx = 0;

    comparison.categories.forEach((cat, catIdx) => {
      if (!activeTopicSet.has(cat.id)) return;
      visibleCohorts.forEach((cohort) => {
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
          ...(isFirstSeries && splitsVisible
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
          data: cohort.values_by_topic[catIdx].map((val, tIdx) => ({
            value: val,
            _cohortId: cohort.cohort_id,
            _cohortLabel: cohort.label,
            _topicLabel: cat.label,
            _tickIndex: tIdx,
          })),
        });
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
            ? splitsVisible && tk.total_slices > 1
              ? `${tk.year} · ${tk.period_label} · Split ${tk.slice_num}/${tk.total_slices}`
              : `${tk.year} · ${tk.full_label}`
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
      grid: { top: splitsVisible ? 30 : 20, left: 54, right: 24, bottom: splitsVisible ? 86 : 72 },
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
    comparison,
    displayedTimeSeries,
    activeTopicIds,
    hiddenCohortIds,
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
              <MultiDocTypeSelect
                options={docTypes}
                selected={searchDocTypes}
                onChange={setSearchDocTypes}
                placeholder="All Document Types"
                compact
              />

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

              <div className="pt-2 border-t border-border">
                <ScoreThresholdFilter
                  value={scoreFilter}
                  onChange={setScoreFilter}
                  macroCategories={macroCategories}
                  compact
                />
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
          <div className="panel p-4 relative">
            {loading && comparison && (
              <div className="absolute top-3 right-3 z-10 px-2.5 py-1 rounded-sm bg-surface-alt/90 border border-border text-[10px] font-mono text-muted">
                Updating partitions...
              </div>
            )}
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
            ) : comparison && comparison.categories.length > 0 ? (
              <div className="space-y-3">
                {radarSummary.autoGroupedByYear && (
                  <div className="px-3.5 py-2.5 border border-amber-400/70 bg-amber-50 dark:bg-amber-950/40 rounded-sm flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                    <div>
                      <strong className="font-semibold">Automatic Yearly Grouping Applied:</strong>{" "}
                      {radarSummary.originalCount} selected items exceed the 10-trace visual
                      clarity limit. Traces were automatically aggregated by year into{" "}
                      {radarSummary.plottedCount} yearly averages for readability.
                    </div>
                  </div>
                )}
                <EChartBox option={radarSummary.option} className="w-full h-[460px]" />
              </div>
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
                      Chronological Time-Series ({displayedTimeSeries.ticks.length} points
                      · <span className="text-accent-dark">{zoomBadgeLabel}</span>)
                    </h3>
                    <p className="text-[11px] font-mono text-muted">
                      {splitsVisible
                        ? "Shaded X-axis bands demarcate individual meetings to separate intra-meeting splits from inter-meeting gaps."
                        : "Showing meeting averages by default · Zoom into a meeting or toggle Show Splits to inspect intra-meeting splits."}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
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
