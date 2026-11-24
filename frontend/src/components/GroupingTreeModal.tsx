/** Interactive Hierarchical Grouping Tree Builder Modal ("Group / Combine") for MiningFOMC V5 (Uncapped). */

import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  GitBranch,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  CompareDocumentRef,
  GroupingTreeConfig,
  GroupingTreeNode,
  PathFilterItem,
  SplitCriterion,
  SplitLevelConfig,
  TreePreviewResponse,
} from "../types/api";

interface GroupingTreeModalProps {
  open: boolean;
  onClose: () => void;
  documents: CompareDocumentRef[];
  initialConfig: GroupingTreeConfig | null;
  onApply: (config: GroupingTreeConfig) => void;
  onInspectNode: (title: string, pathFilters: PathFilterItem[]) => void;
}

const CRITERION_OPTIONS: { value: SplitCriterion; label: string }[] = [
  { value: "year", label: "Year" },
  { value: "year_range", label: "Year Range" },
  { value: "semester", label: "Semester (H1 / H2)" },
  { value: "quarter", label: "Quarter (Q1–Q4)" },
  { value: "month", label: "Month" },
  { value: "speaker", label: "Speaker" },
  { value: "speaker_role", label: "Speaker Role" },
  { value: "gender", label: "Speaker Sex" },
];

export const GroupingTreeModal: React.FC<GroupingTreeModalProps> = ({
  open,
  onClose,
  documents,
  initialConfig,
  onApply,
  onInspectNode,
}) => {
  const [splitLevels, setSplitLevels] = useState<SplitLevelConfig[]>(
    initialConfig?.split_levels?.length
      ? initialConfig.split_levels
      : [{ criterion: "year_range", year_range_span: 5 }]
  );
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>(
    initialConfig?.hidden_node_ids || []
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<TreePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialConfig && initialConfig.split_levels.length > 0) {
      setSplitLevels(initialConfig.split_levels);
      setHiddenNodeIds(initialConfig.hidden_node_ids || []);
    }
  }, [open, initialConfig]);

  useEffect(() => {
    if (!open || documents.length === 0) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .previewGroupingTree({
        documents: documents.map((d) => ({ doc_type: d.doc_type, meeting_date: d.meeting_date })),
        split_levels: splitLevels,
        hidden_node_ids: hiddenNodeIds,
      })
      .then((res) => {
        if (!cancelled) setPreview(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to compute tree");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, documents, splitLevels, hiddenNodeIds]);

  if (!open) return null;

  const toggleNodeHidden = (nodeId: string) => {
    setHiddenNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  };

  const toggleCollapsed = (nodeId: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const addSplitLevel = () => {
    const used = new Set(splitLevels.map((l) => l.criterion));
    const nextCrit =
      CRITERION_OPTIONS.find((o) => !used.has(o.value))?.value || "semester";
    setSplitLevels((prev) => [...prev, { criterion: nextCrit, year_range_span: 5 }]);
    setHiddenNodeIds([]);
  };

  const updateSplitLevel = (idx: number, patch: Partial<SplitLevelConfig>) => {
    setSplitLevels((prev) =>
      prev.map((lvl, i) => (i === idx ? { ...lvl, ...patch } : lvl))
    );
    setHiddenNodeIds([]);
  };

  const removeSplitLevel = (idx: number) => {
    setSplitLevels((prev) => prev.filter((_, i) => i !== idx));
    setHiddenNodeIds([]);
  };

  const renderTreeNode = (node: GroupingTreeNode, depth = 0): React.ReactNode => {
    const hasChildren = node.children && node.children.length > 0;
    const isCollapsed = collapsedIds.has(node.id);
    const isRoot = node.level === 0;
    const pathTitle =
      node.path_filters.length > 0
        ? node.path_filters.map((f) => f.label).join(" → ")
        : "All Selected Documents";

    return (
      <div key={node.id} className="select-none">
        <div
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          className={`flex items-center justify-between gap-2 py-1.5 pr-3 border-b border-border/60 text-xs transition-colors ${
            node.effectively_hidden
              ? "bg-zinc-100/70 text-zinc-400"
              : isRoot
              ? "bg-zinc-50 font-semibold text-ink"
              : "hover:bg-accent-soft/30 text-ink"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {hasChildren ? (
              <button
                type="button"
                onClick={() => toggleCollapsed(node.id)}
                className="p-0.5 text-zinc-400 hover:text-ink"
                title={isCollapsed ? "Expand branch" : "Collapse branch"}
              >
                {isCollapsed ? (
                  <ChevronRight className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-4 inline-block text-center text-zinc-300">•</span>
            )}

            <button
              type="button"
              onClick={() => onInspectNode(pathTitle, node.path_filters)}
              title="Click to inspect documents & chunks in this node"
              className={`truncate text-left hover:underline ${
                node.effectively_hidden ? "line-through" : ""
              }`}
            >
              {node.label}
            </button>

            <span className="mono-tag text-[10px] shrink-0">
              {node.doc_count} {node.doc_count === 1 ? "doc" : "docs"}
            </span>
            {!hasChildren && !node.effectively_hidden && (
              <span className="text-[10px] font-mono text-accent-dark shrink-0">LEAF</span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onInspectNode(pathTitle, node.path_filters)}
              title="Inspect documents & chunks"
              className="p-1 text-zinc-400 hover:text-ink rounded-sm"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            {!isRoot && (
              <button
                type="button"
                onClick={() => toggleNodeHidden(node.id)}
                title={node.hidden ? "Show branch" : "Hide branch"}
                className={`p-1 rounded-sm border transition-colors ${
                  node.hidden
                    ? "border-border bg-surface text-zinc-400 hover:text-ink"
                    : "border-transparent text-zinc-600 hover:text-ink"
                }`}
              >
                {node.hidden ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            )}
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div>{node.children.map((ch) => renderTreeNode(ch, depth + 1))}</div>
        )}
      </div>
    );
  };

  const visibleLeaves = preview?.visible_leaf_count ?? 0;
  const isValid = visibleLeaves >= 1 && !loading;

  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center p-4">
      <div className="panel w-full max-w-4xl max-h-[88vh] flex flex-col bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-zinc-50/80 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-accent" />
              <h2 className="text-base font-semibold text-ink">
                Group / Combine Hierarchical Tree Builder
              </h2>
            </div>
            <p className="text-xs font-mono text-muted mt-0.5">
              Split your {documents.length} selected documents into nested cohorts, hide branches,
              or click any node to inspect its underlying chunks.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-ink p-1"
            title="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Split Levels Builder Bar */}
        <div className="px-5 py-3.5 border-b border-border bg-canvas space-y-2.5 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase text-muted font-semibold">
              Hierarchy Split Levels ({splitLevels.length})
            </span>
            <button
              type="button"
              onClick={addSplitLevel}
              className="btn-secondary py-1 px-2.5 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Split Level
            </button>
          </div>

          {splitLevels.length === 0 ? (
            <p className="text-xs font-mono text-muted">
              No split levels configured (all selected documents aggregated into 1 root cohort).
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {splitLevels.map((lvl, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-1.5 border border-border bg-surface px-2.5 py-1.5 rounded-sm"
                >
                  <span className="text-[10px] font-mono uppercase text-muted">L{idx + 1}:</span>
                  <select
                    value={lvl.criterion}
                    onChange={(e) =>
                      updateSplitLevel(idx, {
                        criterion: e.target.value as SplitCriterion,
                      })
                    }
                    className="input-field py-0.5 px-2 text-xs font-mono w-auto"
                  >
                    {CRITERION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {lvl.criterion === "year_range" && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-mono text-muted">span</span>
                      <input
                        type="number"
                        min={2}
                        max={20}
                        value={lvl.year_range_span}
                        onChange={(e) =>
                          updateSplitLevel(idx, {
                            year_range_span: Math.max(
                              2,
                              Math.min(20, Number(e.target.value) || 5)
                            ),
                          })
                        }
                        className="input-field py-0.5 px-1.5 text-xs font-mono w-14 text-center"
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeSplitLevel(idx)}
                    title="Remove level"
                    className="text-zinc-400 hover:text-red-600 ml-0.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interactive Tree Body */}
        <div className="flex-1 overflow-y-auto bg-surface">
          {error ? (
            <div className="p-5 text-xs font-mono text-red-700 bg-red-50">{error}</div>
          ) : loading && !preview ? (
            <div className="p-8 text-center text-xs font-mono text-muted">
              Computing hierarchical tree branches...
            </div>
          ) : preview ? (
            <div>{renderTreeNode(preview.root, 0)}</div>
          ) : null}
        </div>

        {/* Footer with Live Leaf Counter & "Select Criteria" Apply Button (Uncapped, >= 1 leaf) */}
        <div className="px-5 py-3.5 border-t border-border bg-zinc-50/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`px-2.5 py-1 text-xs font-mono font-semibold rounded-sm border ${
                visibleLeaves >= 1
                  ? "border-accent bg-accent-soft text-accent-dark"
                  : "border-red-300 bg-red-50 text-red-700"
              }`}
            >
              Active Visible Leaves: {visibleLeaves.toLocaleString()}
            </span>
            {visibleLeaves === 0 && !loading && (
              <span className="text-xs font-mono text-red-600">
                At least 1 visible node is required.
              </span>
            )}
            {hiddenNodeIds.length > 0 && (
              <button
                type="button"
                onClick={() => setHiddenNodeIds([])}
                className="text-xs font-mono underline text-muted hover:text-ink"
              >
                Restore all hidden ({hiddenNodeIds.length})
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">
              Cancel
            </button>
            <button
              type="button"
              disabled={!isValid}
              onClick={() => {
                onApply({
                  split_levels: splitLevels,
                  hidden_node_ids: hiddenNodeIds,
                });
                onClose();
              }}
              className="btn-primary text-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Select Criteria
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
