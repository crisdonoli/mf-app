/** Interactive Probability Distribution & Hard-Label Fix Request Modal.
 *
 * Supports:
 * - Zero-Shot 13 Macro-Categories + synchronized Hierarchical Sub-Class Editor
 * - Relevance Probabilities (Relevant vs. Irrelevant)
 * - Auto-normalized interactive probability curve sliders (sum to 1.0)
 * - Hard Label Mode (one-click assigns 1.0 to chosen class and 0.0 to all others)
 */

import React, { useEffect, useMemo, useState } from "react";
import { CheckCircle2, SlidersHorizontal, Target, X } from "lucide-react";
import { api } from "../lib/api";
import type { ClassificationChunkItem, MacroCategoryItem } from "../types/api";
import { EChartBox } from "./EChartBox";

interface DistributionFixModalProps {
  open: boolean;
  onClose: () => void;
  mode: "zero_shot" | "relevance";
  docType: string;
  meetingDate: string;
  chunk: ClassificationChunkItem | null;
  macroCategories: MacroCategoryItem[];
}

function normalizeDist(raw: Record<string, number>): Record<string, number> {
  const keys = Object.keys(raw);
  const total = keys.reduce((acc, k) => acc + Math.max(0, raw[k] || 0), 0);
  const out: Record<string, number> = {};
  if (total <= 1e-9) {
    const eq = keys.length > 0 ? 1 / keys.length : 0;
    keys.forEach((k) => {
      out[k] = Number(eq.toFixed(4));
    });
    return out;
  }
  keys.forEach((k) => {
    out[k] = Number((Math.max(0, raw[k] || 0) / total).toFixed(4));
  });
  return out;
}

function setAdjustedValue(
  dist: Record<string, number>,
  targetKey: string,
  newValue: number
): Record<string, number> {
  const clamped = Math.max(0, Math.min(1, newValue));
  const others = Object.keys(dist).filter((k) => k !== targetKey);
  const remaining = 1 - clamped;
  const otherSum = others.reduce((acc, k) => acc + (dist[k] || 0), 0);
  const next: Record<string, number> = { ...dist, [targetKey]: Number(clamped.toFixed(4)) };

  if (others.length === 0) return next;
  if (otherSum <= 1e-9) {
    const share = remaining / others.length;
    others.forEach((k) => {
      next[k] = Number(share.toFixed(4));
    });
  } else {
    others.forEach((k) => {
      next[k] = Number(((dist[k] / otherSum) * remaining).toFixed(4));
    });
  }
  return next;
}

function makeHardLabel(dist: Record<string, number>, winner: string): Record<string, number> {
  const next: Record<string, number> = {};
  Object.keys(dist).forEach((k) => {
    next[k] = k === winner ? 1.0 : 0.0;
  });
  return next;
}

export const DistributionFixModal: React.FC<DistributionFixModalProps> = ({
  open,
  onClose,
  mode,
  docType,
  meetingDate,
  chunk,
  macroCategories,
}) => {
  const [hardLabelMode, setHardLabelMode] = useState(false);
  const [primaryDist, setPrimaryDist] = useState<Record<string, number>>({});
  const [subclassDist, setSubclassDist] = useState<Record<string, number>>({});
  const [selectedMacro, setSelectedMacro] = useState<string>("");
  const [userNote, setUserNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !chunk) return;
    const initPrimary = normalizeDist(chunk.macro_scores);
    setPrimaryDist(initPrimary);
    setHardLabelMode(false);
    setUserNote("");
    setFeedback(null);

    if (mode === "zero_shot") {
      const topMacro =
        Object.entries(initPrimary).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        chunk.predicted_macro;
      setSelectedMacro(topMacro);
    } else {
      setSelectedMacro("");
      setSubclassDist({});
    }
  }, [open, chunk, mode]);

  // Synchronize sub-class distribution whenever selectedMacro changes
  const activeMacroMeta = useMemo(
    () => macroCategories.find((m) => m.id === selectedMacro),
    [macroCategories, selectedMacro]
  );

  useEffect(() => {
    if (mode !== "zero_shot" || !activeMacroMeta || !activeMacroMeta.has_subclasses || !chunk) {
      setSubclassDist({});
      return;
    }
    const rawSub: Record<string, number> = {};
    activeMacroMeta.subclasses.forEach((s) => {
      rawSub[s.id] = chunk.subclass_scores[s.id] ?? 1 / activeMacroMeta.subclasses.length;
    });
    setSubclassDist(normalizeDist(rawSub));
  }, [mode, activeMacroMeta, chunk]);

  const primaryChartOption = useMemo(() => {
    const keys = Object.keys(primaryDist);
    const labels = keys.map((k) => {
      if (mode === "relevance") return k === "relevant" ? "Relevant" : "Irrelevant";
      return macroCategories.find((m) => m.id === k)?.short_label || k;
    });
    return {
      grid: { top: 14, left: 38, right: 14, bottom: 52 },
      xAxis: {
        type: "category",
        data: labels,
        axisLabel: { rotate: mode === "zero_shot" ? 35 : 0, fontSize: 10, fontFamily: "JetBrains Mono" },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 1,
        axisLabel: { fontSize: 10, fontFamily: "JetBrains Mono" },
      },
      series: [
        {
          type: "bar",
          data: keys.map((k) => primaryDist[k]),
          itemStyle: { color: "#00A878" },
          barMaxWidth: 28,
        },
        {
          type: "line",
          smooth: true,
          data: keys.map((k) => primaryDist[k]),
          lineStyle: { color: "#09090B", width: 2 },
          itemStyle: { color: "#09090B" },
        },
      ],
    };
  }, [primaryDist, mode, macroCategories]);

  if (!open || !chunk) return null;

  const handlePrimaryChange = (key: string, val: number) => {
    const next = hardLabelMode ? makeHardLabel(primaryDist, key) : setAdjustedValue(primaryDist, key, val);
    setPrimaryDist(next);
    if (mode === "zero_shot") {
      const winner = Object.entries(next).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (winner) setSelectedMacro(winner);
    }
  };

  const handleSubclassChange = (key: string, val: number) => {
    const next = hardLabelMode ? makeHardLabel(subclassDist, key) : setAdjustedValue(subclassDist, key, val);
    setSubclassDist(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      await api.submitFixRequest({
        kind: mode === "relevance" ? "fix_relevance" : "fix_zero_shot",
        doc_type: docType,
        meeting_date: meetingDate,
        original_table_id: chunk.chunk_id,
        chunk_text: chunk.text_preview,
        original_distribution: {
          primary: chunk.macro_scores,
          subclasses: chunk.subclass_scores,
        },
        proposed_distribution: {
          primary: primaryDist,
          selected_macro: selectedMacro || undefined,
          subclasses: Object.keys(subclassDist).length > 0 ? subclassDist : undefined,
          hard_label_mode: hardLabelMode,
        },
        user_note: userNote.trim(),
      });
      setFeedback("Fix request submitted to Admin review queue.");
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Failed to submit fix request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 overflow-y-auto">
      <div className="panel w-full max-w-3xl p-6 shadow-xl my-8 space-y-4">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
          <div>
            <h3 className="text-base font-semibold text-ink flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-accent" />
              Interactive Probability Distribution Fix Request
            </h3>
            <p className="text-xs font-mono text-muted mt-0.5">
              {chunk.chunk_id} · {meetingDate} · {mode === "relevance" ? "Relevance" : "Zero-Shot Macro & Sub-Classes"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Chunk Preview */}
        <div className="p-3 bg-canvas border border-border rounded-sm text-xs text-zinc-700 max-h-24 overflow-y-auto">
          {chunk.speaker && <strong className="mr-1.5">{chunk.speaker}:</strong>}
          {chunk.text_preview}
        </div>

        {/* Mode Toggle: Curve Edit vs Hard Label */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-50 border border-border px-3.5 py-2.5 rounded-sm">
          <span className="text-xs font-mono text-muted">
            {hardLabelMode
              ? "Hard Label Mode: click any class button to assign 100% (1.0) probability."
              : "Curve Mode: drag sliders — probabilities automatically re-normalize to 1.0."}
          </span>
          <button
            type="button"
            onClick={() => setHardLabelMode((v) => !v)}
            className={`px-3 py-1 text-xs font-mono rounded-sm border flex items-center gap-1.5 ${
              hardLabelMode
                ? "bg-ink text-white border-ink"
                : "bg-surface text-ink border-border hover:border-ink"
            }`}
          >
            <Target className="w-3.5 h-3.5" />
            Hard Label: {hardLabelMode ? "ON" : "OFF"}
          </button>
        </div>

        {/* Live Density / Bar Curve */}
        <div className="border border-border rounded-sm p-2 bg-surface">
          <EChartBox option={primaryChartOption} className="w-full h-44" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Primary Distribution Editor */}
          <div className="space-y-2">
            <div className="text-[11px] font-mono uppercase text-muted font-semibold">
              {mode === "relevance" ? "Relevance Probabilities" : "13 Macro-Categories Distribution"}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {Object.entries(primaryDist).map(([key, val]) => {
                const label =
                  mode === "relevance"
                    ? key === "relevant"
                      ? "Relevant"
                      : "Irrelevant"
                    : macroCategories.find((m) => m.id === key)?.label || key;
                return (
                  <div
                    key={key}
                    onClick={() => {
                      if (hardLabelMode) handlePrimaryChange(key, 1.0);
                      else if (mode === "zero_shot") setSelectedMacro(key);
                    }}
                    className={`border rounded-sm px-2.5 py-1.5 text-xs ${
                      hardLabelMode ? "cursor-pointer hover:border-ink" : ""
                    } ${
                      selectedMacro === key && mode === "zero_shot"
                        ? "border-accent bg-accent-soft/40"
                        : "border-border bg-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink truncate">{label}</span>
                      <span className="font-mono font-semibold text-accent-dark">
                        {(val * 100).toFixed(1)}%
                      </span>
                    </div>
                    {!hardLabelMode && (
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={val}
                        onChange={(e) => handlePrimaryChange(key, Number(e.target.value))}
                        className="w-full accent-ink mt-1"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Synchronized Hierarchical Sub-Class Editor */}
          {mode === "zero_shot" && activeMacroMeta && activeMacroMeta.has_subclasses && (
            <div className="space-y-2 pt-3 border-t border-border">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase text-accent-dark font-semibold">
                  Sub-Class Distribution for: {activeMacroMeta.label}
                </span>
                <span className="text-[10px] font-mono text-muted">
                  Synchronized with selected macro-category
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeMacroMeta.subclasses.map((sub) => {
                  const val = subclassDist[sub.id] ?? 0;
                  return (
                    <div
                      key={sub.id}
                      onClick={() => hardLabelMode && handleSubclassChange(sub.id, 1.0)}
                      className={`border border-border rounded-sm px-2.5 py-1.5 text-xs bg-canvas ${
                        hardLabelMode ? "cursor-pointer hover:border-ink" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-ink">{sub.label}</span>
                        <span className="font-mono font-semibold text-ink">
                          {(val * 100).toFixed(1)}%
                        </span>
                      </div>
                      {!hardLabelMode && (
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.01}
                          value={val}
                          onChange={(e) => handleSubclassChange(sub.id, Number(e.target.value))}
                          className="w-full accent-ink mt-1"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-mono uppercase text-muted mb-1">
              Justification / Note for Administrator
            </label>
            <input
              type="text"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="Briefly explain why this label/distribution should be updated..."
              className="input-field text-xs"
            />
          </div>

          {feedback && (
            <div className="text-xs font-mono text-accent-dark flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              {feedback}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Cancel
            </button>
            <button type="submit" disabled={submitting} className="btn-primary text-xs">
              {submitting ? "Submitting..." : "Submit Fix Request"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
