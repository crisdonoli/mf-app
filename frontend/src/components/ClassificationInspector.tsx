/** Generalized Probability Classification Inspector (reused by Zero-Shot & Relevance tabs). */

import React, { useMemo, useState } from "react";
import { Filter, Wrench } from "lucide-react";
import { formatSigFigs } from "../lib/format";
import type {
  ClassificationChunkItem,
  ClassificationInspectorResponse,
  MacroCategoryItem,
} from "../types/api";
import { DistributionFixModal } from "./DistributionFixModal";
import { SpeakerAutocomplete } from "./SpeakerAutocomplete";

interface ClassificationInspectorProps {
  mode: "zero_shot" | "relevance";
  docType: string;
  meetingDate: string;
  data: ClassificationInspectorResponse | null;
  speakerFilter: string;
  onSpeakerFilterChange: (v: string) => void;
  macroCategories: MacroCategoryItem[];
}

export const ClassificationInspector: React.FC<ClassificationInspectorProps> = ({
  mode,
  docType,
  meetingDate,
  data,
  speakerFilter,
  onSpeakerFilterChange,
  macroCategories,
}) => {
  const [chunkSearch, setChunkSearch] = useState("");
  const [allowFixMode, setAllowFixMode] = useState(false);
  const [activeChunkForFix, setActiveChunkForFix] = useState<ClassificationChunkItem | null>(null);

  const filteredChunks = useMemo(() => {
    if (!data) return [];
    if (!chunkSearch.trim()) return data.chunks;
    const q = chunkSearch.toLowerCase();
    return data.chunks.filter(
      (c) =>
        c.text_preview.toLowerCase().includes(q) ||
        c.chunk_id.toLowerCase().includes(q) ||
        c.predicted_macro_label.toLowerCase().includes(q)
    );
  }, [data, chunkSearch]);

  if (!data || !data.available) {
    return (
      <div className="p-6 border border-border bg-zinc-50 text-xs font-mono text-muted">
        {mode === "relevance"
          ? "Relevance probability scores are not available for this document type."
          : "Zero-shot classification scores are not available for this document type. Use the Prototype Similarity Matrix tab for dense semantic scores across all FOMC documents."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filter & Allow Fix Request Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs font-mono text-muted">
          <Filter className="w-3.5 h-3.5" />
          Filter:
        </div>
        <SpeakerAutocomplete
          value={speakerFilter}
          onChange={onSpeakerFilterChange}
          placeholder="Filter by speaker..."
          className="w-[210px]"
        />
        <input
          type="text"
          value={chunkSearch}
          onChange={(e) => setChunkSearch(e.target.value)}
          placeholder="Filter by chunk text or label..."
          className="input-field max-w-[230px] text-xs"
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="mono-tag">{data.total_classified} classified chunks</span>
          <button
            type="button"
            onClick={() => setAllowFixMode((v) => !v)}
            className={`px-3 py-1.5 text-xs font-mono rounded-sm border flex items-center gap-1.5 transition-colors ${
              allowFixMode
                ? "bg-accent text-white border-accent"
                : "bg-surface text-ink border-border hover:border-ink"
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            Allow Fix Request: {allowFixMode ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      {allowFixMode && (
        <div className="px-3.5 py-2 border border-accent bg-accent-soft text-xs font-mono text-accent-dark rounded-sm">
          Fix Request Mode active — click any chunk&apos;s predicted label badge below to open the
          interactive probability distribution editor.
        </div>
      )}

      {/* Summary Confidence Distribution Cards */}
      <div
        className={`grid grid-cols-1 ${
          mode === "relevance" ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"
        } gap-2.5`}
      >
        {data.macro_summary.map((ms) => (
          <div
            key={ms.category_id}
            title={`${ms.label} · Mean probability: ${formatSigFigs(ms.mean_score, 3)} · Share: ${formatSigFigs(ms.share, 3)}`}
            className="border border-border p-3 rounded-sm"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">{ms.label}</span>
              <span className="font-mono font-semibold text-accent-dark">
                {formatSigFigs(ms.mean_score, 3)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 bg-zinc-100 rounded-sm overflow-hidden">
              <div
                className={`h-full ${
                  ms.category_id === "irrelevant" ? "bg-zinc-400" : "bg-accent"
                }`}
                style={{ width: `${Math.min(100, ms.mean_score * 100)}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] font-mono text-zinc-400">
              Top class on {ms.chunk_count} chunks ({formatSigFigs(ms.share * 100, 3)}%)
            </div>
          </div>
        ))}
      </div>

      {/* Per-Chunk Predictions List */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {filteredChunks.map((ch) => (
          <div key={ch.chunk_id} className="border border-border p-3 rounded-sm bg-canvas">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mono-tag">#{ch.sequence_num}</span>
                {ch.speaker && <span className="text-xs font-semibold">{ch.speaker}</span>}
                <button
                  type="button"
                  disabled={!allowFixMode}
                  title={`Confidence: ${formatSigFigs(ch.confidence, 3)}`}
                  onClick={() => allowFixMode && setActiveChunkForFix(ch)}
                  className={`mono-tag border-accent bg-accent-soft text-accent-dark ${
                    allowFixMode
                      ? "cursor-pointer ring-1 ring-accent hover:bg-accent hover:text-white transition-colors"
                      : "cursor-default"
                  }`}
                >
                  {ch.predicted_macro_label} ({formatSigFigs(ch.confidence, 3)})
                </button>
                {ch.predicted_subclass_label && (
                  <span className="mono-tag">↳ {ch.predicted_subclass_label}</span>
                )}
              </div>
              {ch.p_relevant !== null && (
                <span
                  title={`p_relevant: ${formatSigFigs(ch.p_relevant, 3)}`}
                  className="text-[10px] font-mono text-zinc-500"
                >
                  p_rel: {formatSigFigs(ch.p_relevant, 3)}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-700 leading-relaxed">{ch.text_preview}</p>
          </div>
        ))}
      </div>

      <DistributionFixModal
        open={activeChunkForFix !== null}
        onClose={() => setActiveChunkForFix(null)}
        mode={mode}
        docType={docType}
        meetingDate={meetingDate}
        chunk={activeChunkForFix}
        macroCategories={macroCategories}
      />
    </div>
  );
};
