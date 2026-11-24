/** Shared Score & Classifier Probability Threshold Filter (Prototype Similarity, Zero-Shot, Relevance). */

import React, { useState } from "react";
import { RotateCcw } from "lucide-react";
import type { MacroCategoryItem, MetricTransform, NormalizationMode } from "../types/api";

export interface ScoreThresholdFilterValue {
  // Prototype Similarity score filter
  filterCategory: string;
  filterMetric: MetricTransform;
  filterNorm: NormalizationMode;
  filterMinScore: string;
  // Zero-Shot Classifier probability filter
  filterZsCategory: string;
  filterZsMinProb: string;
  // Relevance Classifier probability filter
  filterRelClass: "" | "relevant" | "irrelevant";
  filterRelMinProb: string;
}

export const EMPTY_SCORE_THRESHOLD_FILTER: ScoreThresholdFilterValue = {
  filterCategory: "",
  filterMetric: "cosine",
  filterNorm: "none",
  filterMinScore: "",
  filterZsCategory: "",
  filterZsMinProb: "",
  filterRelClass: "",
  filterRelMinProb: "",
};

interface ScoreThresholdFilterProps {
  value: ScoreThresholdFilterValue;
  onChange: (next: ScoreThresholdFilterValue) => void;
  macroCategories: MacroCategoryItem[];
  compact?: boolean;
}

export const ScoreThresholdFilter: React.FC<ScoreThresholdFilterProps> = ({
  value,
  onChange,
  macroCategories,
  compact = false,
}) => {
  const [activeTab, setActiveTab] = useState<"similarity" | "zero_shot" | "relevance">("similarity");

  const simActive = Boolean(value.filterCategory && value.filterMinScore.trim() !== "");
  const zsActive = Boolean(value.filterZsCategory && value.filterZsMinProb.trim() !== "");
  const relActive = Boolean(value.filterRelClass && value.filterRelMinProb.trim() !== "");
  const activeCount = Number(simActive) + Number(zsActive) + Number(relActive);

  const patch = (partial: Partial<ScoreThresholdFilterValue>) =>
    onChange({ ...value, ...partial });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-mono uppercase text-muted font-semibold">
          Score &amp; Classifier Threshold Filter (Optional)
          {activeCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-sm bg-accent text-white text-[9px]">
              {activeCount} active
            </span>
          )}
        </span>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_SCORE_THRESHOLD_FILTER)}
            className="text-[10px] font-mono text-muted hover:text-ink inline-flex items-center gap-1"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            Clear thresholds
          </button>
        )}
      </div>

      {/* Mode Switcher Tabs (independent thresholds can be combined across all three) */}
      <div className="flex border border-border rounded-sm overflow-hidden bg-surface text-[11px] font-mono">
        <button
          type="button"
          onClick={() => setActiveTab("similarity")}
          className={`flex-1 py-1 px-2 transition-colors flex items-center justify-center gap-1 ${
            activeTab === "similarity"
              ? "bg-ink text-white"
              : "text-muted hover:text-ink hover:bg-zinc-50"
          }`}
        >
          <span>Similarity</span>
          {simActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("zero_shot")}
          className={`flex-1 py-1 px-2 border-l border-border transition-colors flex items-center justify-center gap-1 ${
            activeTab === "zero_shot"
              ? "bg-ink text-white"
              : "text-muted hover:text-ink hover:bg-zinc-50"
          }`}
        >
          <span>Zero-Shot</span>
          {zsActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("relevance")}
          className={`flex-1 py-1 px-2 border-l border-border transition-colors flex items-center justify-center gap-1 ${
            activeTab === "relevance"
              ? "bg-ink text-white"
              : "text-muted hover:text-ink hover:bg-zinc-50"
          }`}
        >
          <span>Relevance</span>
          {relActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
        </button>
      </div>

      {/* Tab 1: Prototype Similarity Score */}
      {activeTab === "similarity" && (
        <div className={compact ? "space-y-1.5" : "grid grid-cols-1 sm:grid-cols-4 gap-2"}>
          <select
            value={value.filterCategory}
            onChange={(e) => patch({ filterCategory: e.target.value })}
            className="input-field text-xs"
          >
            <option value="">No Similarity Topic Filter</option>
            {macroCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {value.filterCategory && (
            <div className={compact ? "grid grid-cols-3 gap-1.5" : "sm:col-span-3 grid grid-cols-3 gap-2"}>
              <select
                value={value.filterMetric}
                onChange={(e) => patch({ filterMetric: e.target.value as MetricTransform })}
                className="input-field text-[11px] font-mono"
              >
                <option value="cosine">Cosine</option>
                <option value="softmax">Softmax</option>
                <option value="log">Log</option>
              </select>
              <select
                value={value.filterNorm}
                onChange={(e) => patch({ filterNorm: e.target.value as NormalizationMode })}
                className="input-field text-[11px] font-mono"
              >
                <option value="none">None</option>
                <option value="topic">Topic</option>
                <option value="slice">Slice</option>
              </select>
              <input
                type="number"
                step="0.05"
                value={value.filterMinScore}
                onChange={(e) => patch({ filterMinScore: e.target.value })}
                placeholder="Min score"
                className="input-field text-[11px] font-mono"
              />
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Zero-Shot Classifier Probability */}
      {activeTab === "zero_shot" && (
        <div className={compact ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-1 sm:grid-cols-2 gap-2"}>
          <select
            value={value.filterZsCategory}
            onChange={(e) => patch({ filterZsCategory: e.target.value })}
            className="input-field text-xs"
          >
            <option value="">No Zero-Shot Category Filter</option>
            {macroCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={1}
            step="0.05"
            disabled={!value.filterZsCategory}
            value={value.filterZsMinProb}
            onChange={(e) => patch({ filterZsMinProb: e.target.value })}
            placeholder="Min probability (0–1)"
            className="input-field text-xs font-mono disabled:opacity-50"
          />
        </div>
      )}

      {/* Tab 3: Relevance Classifier Probability */}
      {activeTab === "relevance" && (
        <div className={compact ? "grid grid-cols-2 gap-1.5" : "grid grid-cols-1 sm:grid-cols-2 gap-2"}>
          <select
            value={value.filterRelClass}
            onChange={(e) =>
              patch({
                filterRelClass: e.target.value as "" | "relevant" | "irrelevant",
              })
            }
            className="input-field text-xs"
          >
            <option value="">No Relevance Filter</option>
            <option value="relevant">Relevant Probability</option>
            <option value="irrelevant">Irrelevant Probability</option>
          </select>
          <input
            type="number"
            min={0}
            max={1}
            step="0.05"
            disabled={!value.filterRelClass}
            value={value.filterRelMinProb}
            onChange={(e) => patch({ filterRelMinProb: e.target.value })}
            placeholder="Min probability (0–1)"
            className="input-field text-xs font-mono disabled:opacity-50"
          />
        </div>
      )}
    </div>
  );
};
