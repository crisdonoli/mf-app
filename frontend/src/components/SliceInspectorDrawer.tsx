/** Deep Drill-Down Slice & Subgroup Inspector Drawer for MiningFOMC V4. */

import React, { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, FileText, Search, X } from "lucide-react";
import { api } from "../lib/api";
import { formatSigFigs } from "../lib/format";
import type {
  CompareDocumentRef,
  DataSourceMode,
  GranularityMode,
  MetricTransform,
  NormalizationMode,
  PathFilterItem,
  SliceInspectResponse,
} from "../types/api";
import { SpeakerAutocomplete } from "./SpeakerAutocomplete";

export interface SliceInspectorTarget {
  title: string;
  documents: CompareDocumentRef[];
  pathFilters: PathFilterItem[];
  periodKey?: string | null;
  sliceIndex?: number | null;
  nPartitions: number;
}

interface SliceInspectorDrawerProps {
  target: SliceInspectorTarget | null;
  onClose: () => void;
  dataSource: DataSourceMode;
  metric: MetricTransform;
  normalization: NormalizationMode;
  granularity: GranularityMode;
  macroCategory: string;
}

const PAGE_SIZE = 25;

export const SliceInspectorDrawer: React.FC<SliceInspectorDrawerProps> = ({
  target,
  onClose,
  dataSource,
  metric,
  normalization,
  granularity,
  macroCategory,
}) => {
  const [queryText, setQueryText] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState("");
  const [focusedDocId, setFocusedDocId] = useState<string>("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<SliceInspectResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset filters when opening a new target
  useEffect(() => {
    if (!target) return;
    setQueryText("");
    setSpeakerFilter("");
    setFocusedDocId("");
    setOffset(0);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const docsToQuery = focusedDocId
      ? target.documents.filter((d) => `${d.doc_type}::${d.meeting_date}` === focusedDocId)
      : target.documents;

    api
      .inspectSlice({
        documents: docsToQuery.map((d) => ({
          doc_type: d.doc_type,
          meeting_date: d.meeting_date,
        })),
        path_filters: target.pathFilters,
        period_key: target.periodKey || undefined,
        slice_index: target.sliceIndex || undefined,
        n_partitions: target.nPartitions,
        query_text: queryText.trim() || undefined,
        filter_speaker: speakerFilter.trim() || undefined,
        data_source: dataSource,
        metric,
        normalization,
        granularity,
        macro_category: granularity === "subclass" ? macroCategory : null,
        limit: PAGE_SIZE,
        offset,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load slice details");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    target,
    queryText,
    speakerFilter,
    focusedDocId,
    offset,
    dataSource,
    metric,
    normalization,
    granularity,
    macroCategory,
  ]);

  if (!target) return null;

  const totalMatched = data?.total_chunks_matched ?? 0;
  const pageStart = totalMatched === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + PAGE_SIZE, totalMatched);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45">
      <div className="flex-1" onClick={onClose} />
      <aside className="w-full max-w-3xl h-full bg-surface border-l border-border shadow-2xl flex flex-col overflow-hidden">
        {/* Header Summary */}
        <div className="px-5 py-4 border-b border-border bg-zinc-50/90 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <span className="text-[10px] font-mono uppercase tracking-wider text-accent-dark font-semibold">
              Slice &amp; Subgroup Drill-Down Inspector
            </span>
            <h2 className="text-base font-bold text-ink mt-0.5 break-words">{target.title}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px] font-mono text-muted">
              <span className="mono-tag">
                {data ? `${data.doc_count} docs` : `${target.documents.length} docs`}
              </span>
              <span className="mono-tag">{totalMatched.toLocaleString()} chunks</span>
              {target.sliceIndex && (
                <span className="mono-tag border-ink bg-ink text-white">
                  Slice {target.sliceIndex} / {target.nPartitions}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-ink p-1"
            title="Close inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Top Macro-Category Scores Strip */}
        {data && data.top_categories.length > 0 && (
          <div className="px-5 py-2.5 border-b border-border bg-canvas shrink-0">
            <div className="text-[10px] font-mono uppercase text-muted mb-1.5">
              Top Macro-Category Scores ({metric} · {normalization})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.top_categories.map((cat) => (
                <span
                  key={cat.id}
                  className="px-2 py-0.5 text-[11px] font-mono border border-border bg-surface rounded-sm text-ink"
                >
                  {cat.label}:{" "}
                  <strong className="text-accent-dark">{formatSigFigs(cat.score, 3)}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Filter Bar + Matched Documents Pills */}
        <div className="px-5 py-3 border-b border-border bg-surface space-y-2.5 shrink-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={queryText}
                onChange={(e) => {
                  setQueryText(e.target.value);
                  setOffset(0);
                }}
                placeholder="Filter chunks by keyword..."
                className="input-field text-xs pl-8"
              />
            </div>
            <SpeakerAutocomplete
              value={speakerFilter}
              onChange={(v) => {
                setSpeakerFilter(v);
                setOffset(0);
              }}
              placeholder="Filter chunks by speaker..."
            />
          </div>

          {data && data.documents.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => {
                  setFocusedDocId("");
                  setOffset(0);
                }}
                className={`px-2.5 py-1 text-[11px] font-mono rounded-sm border whitespace-nowrap ${
                  focusedDocId === ""
                    ? "bg-ink text-white border-ink"
                    : "bg-surface text-muted border-border hover:border-ink"
                }`}
              >
                All Docs ({data.documents.length})
              </button>
              {data.documents.map((doc) => (
                <button
                  key={doc.document_id}
                  type="button"
                  onClick={() => {
                    setFocusedDocId(doc.document_id);
                    setOffset(0);
                  }}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-sm border whitespace-nowrap ${
                    focusedDocId === doc.document_id
                      ? "bg-ink text-white border-ink"
                      : "bg-surface text-zinc-700 border-border hover:border-ink"
                  }`}
                >
                  {doc.meeting_date} · {doc.doc_type_label} ({doc.chunk_count} chunks)
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Paginated Chunk Excerpts */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5 bg-canvas">
          {error ? (
            <div className="p-4 border border-red-300 bg-red-50 text-xs font-mono text-red-700">
              {error}
            </div>
          ) : loading ? (
            <div className="py-12 text-center text-xs font-mono text-muted">
              Loading underlying documents and chunks...
            </div>
          ) : data && data.chunks.length > 0 ? (
            data.chunks.map((ch) => (
              <div key={ch.chunk_id} className="border border-border bg-surface p-3.5 rounded-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="mono-tag flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {ch.meeting_date}
                    </span>
                    <span className="mono-tag">#{ch.sequence_num}</span>
                    {ch.speaker && (
                      <span className="text-xs font-semibold text-ink">{ch.speaker}</span>
                    )}
                    {ch.speaker_role && (
                      <span className="text-[10px] font-mono text-muted">({ch.speaker_role})</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ch.top_topic_label && ch.top_topic_score !== null && (
                      <span className="mono-tag border-accent bg-accent-soft text-accent-dark">
                        {ch.top_topic_label}: {formatSigFigs(ch.top_topic_score, 3)}
                      </span>
                    )}
                    {ch.p_relevant !== null && (
                      <span className="mono-tag">
                        p_rel: {formatSigFigs(ch.p_relevant, 3)}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-zinc-700 leading-relaxed whitespace-pre-wrap">
                  {ch.text_content}
                </p>
              </div>
            ))
          ) : (
            <div className="py-12 text-center text-xs font-mono text-muted">
              No chunks match the current filter inside this subgroup/slice.
            </div>
          )}
        </div>

        {/* Pagination Footer */}
        <div className="px-5 py-3 border-t border-border bg-zinc-50/90 flex items-center justify-between text-xs font-mono shrink-0">
          <span className="text-muted">
            Showing {pageStart}–{pageEnd} of {totalMatched.toLocaleString()} chunks
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="btn-secondary py-1 px-2 text-xs"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <button
              type="button"
              disabled={offset + PAGE_SIZE >= totalMatched || loading}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="btn-secondary py-1 px-2 text-xs"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
