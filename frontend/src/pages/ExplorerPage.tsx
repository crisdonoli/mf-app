/** Tab 2: Database File Explorer V3 — Search, 4-Col Scrollable/Maximizable Table, Meeting Bundle, Chunks, Zero-Shot, Relevance & Heatmap. */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookmarkPlus,
  CheckSquare,
  FileText,
  Flag,
  GitCompare,
  Grid,
  Layers,
  Maximize2,
  Minimize2,
  Search,
  Sparkles,
} from "lucide-react";
import { ClassificationInspector } from "../components/ClassificationInspector";
import { EChartBox } from "../components/EChartBox";
import { FeedbackModal } from "../components/FeedbackModal";
import { SaveToListModal } from "../components/SaveToListModal";
import { SpeakerAutocomplete } from "../components/SpeakerAutocomplete";
import { useTheme } from "../context/ThemeContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import {
  CORPUS_MAX_DATE,
  CORPUS_MIN_DATE,
  clampCorpusDate,
  formatSigFigs,
} from "../lib/format";
import type {
  ClassificationInspectorResponse,
  DocTypeOption,
  GranularityMode,
  MacroCategoryItem,
  MeetingBundleResponse,
  MetricTransform,
  NormalizationMode,
  SearchDocumentItem,
  SimilarityMatrixResponse,
} from "../types/api";

export const ExplorerPage: React.FC = () => {
  const { isDark } = useTheme();
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

  // Unified Date Range (Date From + optional Date To, capped at 2020-12-31)
  const [dateFrom, setDateFrom] = useState(CORPUS_MIN_DATE);
  const [dateTo, setDateTo] = useState(CORPUS_MAX_DATE);
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [queryText, setQueryText] = useState("");
  const [useRegex, setUseRegex] = useState(false);

  const [results, setResults] = useState<SearchDocumentItem[]>([]);
  const [totalResults, setTotalResults] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [tableMaximized, setTableMaximized] = useState(false);

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

  // Allow Escape key to exit maximized table view
  useEffect(() => {
    if (!tableMaximized) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTableMaximized(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tableMaximized]);

  const executeSearch = useCallback(
    async (
      overrides?: {
        date_from?: string;
        date_to?: string;
        speaker?: string;
        doc_type?: string;
        query_text?: string;
        use_regex?: boolean;
      },
      shouldRecord = true
    ) => {
      setSearching(true);
      setSearchError(null);
      const effFrom = clampCorpusDate(overrides?.date_from ?? dateFrom);
      const effTo = clampCorpusDate(overrides?.date_to ?? dateTo);
      const params = {
        date_from: effFrom || undefined,
        date_to: effTo || undefined,
        speaker: overrides?.speaker ?? (speakerFilter || undefined),
        doc_type: overrides?.doc_type ?? (docTypeFilter || undefined),
        query_text: overrides?.query_text ?? (queryText || undefined),
        use_regex: overrides?.use_regex ?? useRegex,
        limit: 30,
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
            params.doc_type || "All types",
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
    [dateFrom, dateTo, speakerFilter, docTypeFilter, queryText, useRegex, recordHistory]
  );

  useEffect(() => {
    executeSearch(undefined, false);
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
      const restoredTo = p.meeting_date
        ? ""
        : clampCorpusDate(String(p.date_to ?? ""));
      setDateFrom(restoredFrom);
      setDateTo(restoredTo);
      setSpeakerFilter(String(p.speaker || ""));
      setDocTypeFilter(String(p.doc_type || ""));
      setQueryText(String(p.query_text || ""));
      setUseRegex(Boolean(p.use_regex));
      executeSearch(
        {
          date_from: restoredFrom || undefined,
          date_to: restoredTo || undefined,
          speaker: p.speaker as string | undefined,
          doc_type: p.doc_type as string | undefined,
          query_text: p.query_text as string | undefined,
          use_regex: Boolean(p.use_regex),
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

  // Heatmap: Y-Axis = Topics, X-Axis = Chunk Sequence (Slices), 3 sig figs on hover
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

    return {
      tooltip: {
        position: "top",
        formatter: (p: { value: [number, number, number] }) => {
          const [sliceIdx, topicIdx, val] = p.value;
          const chunkId = simData.chunk_ids[sliceIdx] || `Slice ${sliceIdx + 1}`;
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;">
            <strong>${yTopicLabels[topicIdx]}</strong><br/>
            ${chunkId}<br/>
            Score: <strong>${formatSigFigs(val, 3)}</strong>
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
        inRange: { color: isDark ? ["#0F172A", "#1E3A8A", "#2563EB", "#60A5FA", "#DBEAFE"] : ["#F8FAFC", "#BFDBFE", "#3B82F6", "#1D4ED8", "#1E3A8A"] },
      },
      series: [
        {
          type: "heatmap",
          data: dataPoints,
          emphasis: { itemStyle: { borderColor: "#09090B", borderWidth: 1 } },
        },
      ],
    };
  }, [simData, isDark]);

  const activeSibling = bundle?.siblings.find((s) => s.doc_type === activeDocType);
  const isInBasket = (dt: string, mDate: string) =>
    basket.some((d) => d.doc_type === dt && d.meeting_date === mDate);

  // Reusable Matching Documents Table (4-column viewport + horizontal scroll in default view; full-width when maximized)
  const renderMatchingDocumentsPanel = (maximized: boolean) => (
    <div
      className={
        maximized
          ? "fixed inset-4 z-50 panel bg-surface shadow-2xl flex flex-col overflow-hidden"
          : "panel overflow-hidden"
      }
    >
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-2 bg-zinc-50/70 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono uppercase text-muted font-semibold">
            Matching Documents ({totalResults.toLocaleString()})
          </span>
          <span className="text-[11px] font-mono text-zinc-400 hidden sm:inline">
            {maximized
              ? "Expanded view · Click any row to load its FOMC Meeting Bundle"
              : "Scroll horizontally to inspect all metadata columns · Click any row to load bundle"}
          </span>
        </div>
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

      {/* Horizontal scroll viewport: in default view, 4 columns fill the width and remaining columns scroll smoothly */}
      <div className={`overflow-x-auto overflow-y-auto ${maximized ? "flex-1" : "max-h-[212px]"}`}>
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
            {results.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-xs font-mono text-zinc-400">
                  {searching ? "Scanning Parquet partitions..." : "No matching documents found."}
                </td>
              </tr>
            ) : (
              results.map((item) => {
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
                      {item.meeting_date}
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
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold">
            Database File Explorer
          </span>
          <h1 className="text-2xl font-bold text-ink mt-0.5">
            FOMC Corpus Search &amp; Meeting Inspector
          </h1>
        </div>
        <span className="mono-tag">DUCKDB PUSHDOWN · 1976–2020 CORPUS</span>
      </div>

      {/* Multi-Criteria Search Bar (Unified Date Range + Speaker Autocomplete) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          executeSearch();
        }}
        className="panel p-5 space-y-4"
      >
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
              onChange={(e) => setDateFrom(clampCorpusDate(e.target.value))}
              className="input-field font-mono text-xs"
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
              onChange={(e) => setDateTo(clampCorpusDate(e.target.value))}
              title="Leave empty to match Date From as an exact single date"
              className="input-field font-mono text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Document Type
            </label>
            <select
              value={docTypeFilter}
              onChange={(e) => setDocTypeFilter(e.target.value)}
              className="input-field text-xs"
            >
              <option value="">All Document Types</option>
              {docTypes.map((dt) => (
                <option key={dt.id} value={dt.id}>
                  {dt.label}
                </option>
              ))}
            </select>
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
              Leave Date To empty for an exact single-date match (max 2020-12-31).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDateFrom(CORPUS_MIN_DATE);
                setDateTo(CORPUS_MAX_DATE);
                setSpeakerFilter("");
                setDocTypeFilter("");
                setQueryText("");
                setUseRegex(false);
              }}
              className="btn-secondary text-xs"
            >
              Reset
            </button>
            <button type="submit" disabled={searching} className="btn-primary text-xs">
              <Search className="w-3.5 h-3.5" />
              {searching ? "Querying Parquet..." : "Search Corpus"}
            </button>
          </div>
        </div>
      </form>

      {searchError && (
        <div className="panel border-red-300 bg-red-50 p-3 text-xs font-mono text-red-700">
          {searchError}
        </div>
      )}

      {/* Search Results Table (Default 4-col horizontal scroll or Full-Screen Maximized Modal) */}
      {tableMaximized && (
        <div
          className="fixed inset-0 z-40 bg-black/45"
          onClick={() => setTableMaximized(false)}
        />
      )}
      {renderMatchingDocumentsPanel(tableMaximized)}

      {/* Meeting Bundle & Analytical Inspector */}
      {selectedMeeting && (
        <section className="panel p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="mono-tag border-ink bg-ink text-white">MEETING {selectedMeeting}</span>
                <span className="text-xs font-mono text-muted">
                  {bundle ? `${bundle.siblings.length} sibling ${bundle.siblings.length === 1 ? "doc" : "docs"}` : "Loading bundle..."}
                </span>
              </div>
              <h2 className="text-xl font-semibold text-ink mt-1.5">
                {activeSibling?.doc_type_label || activeDocType}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
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
                {isInBasket(activeDocType, selectedMeeting) ? "Added to Comparator" : "Add to Comparator"}
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
                Sibling Documents in This FOMC Meeting Bundle ({bundle.siblings.length} {bundle.siblings.length === 1 ? "doc" : "docs"})
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
                    {sib.doc_type_label} <span className="opacity-65">({sib.chunk_count} {sib.chunk_count === 1 ? "chunk" : "chunks"})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Inspector Mode Tabs (4 tabs: Chunks, Zero-Shot, Relevance, Similarity Matrix) */}
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

          {/* Tab Panel 1: Document Chunks + Report Error/Feedback */}
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

          {/* Tab Panel 2: Zero-Shot Inspector (Generalized Component) */}
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

          {/* Tab Panel 3: Relevance Probabilities (Reusing Exact Same Component) */}
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

          {/* Tab Panel 4: Prototype Similarity Matrix Heatmap */}
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
                        { id: "slice", label: "Slice" },
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
                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-muted mb-2">
                    <span>
                      Y-Axis: Topics ({simData.categories.length}) · X-Axis: Chunk Sequence (
                      {simData.displayed_slices || simData.chunk_ids.length} slices)
                    </span>
                    <span>
                      Range: [{formatSigFigs(simData.min_value, 3)},{" "}
                      {formatSigFigs(simData.max_value, 3)}]
                    </span>
                  </div>
                  <EChartBox option={heatmapOption} className="w-full h-[460px]" />
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
