/** Interactive Obsidian-Style Graph View & Recursive Grouping Tree Builder ("Group / Combine").
 *
 * Features:
 * - Obsidian-style interactive force-directed graph (plus optional hierarchical tree layout)
 * - Custom Range criterion supporting multiple custom date ranges (e.g. 1976..1979, 1979..-)
 *   where "-" dynamically resolves to the latest available date in the dataset
 * - Recursive per-node partitioning: click ANY node in the graph to open a contextual floating
 *   panel to sub-group/partition that specific node independently, hide/show it, or inspect chunks
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  GitBranch,
  Network,
  Plus,
  Search,
  Sparkles,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { EChartBox } from "./EChartBox";
import { useTheme } from "../context/ThemeContext";
import { api } from "../lib/api";
import type {
  CompareDocumentRef,
  CustomDateRangeSpec,
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
  { value: "custom_range", label: "Custom Range" },
  { value: "year", label: "Year" },
  { value: "year_range", label: "Year Range" },
  { value: "semester", label: "Semester (H1 / H2)" },
  { value: "quarter", label: "Quarter (Q1–Q4)" },
  { value: "month", label: "Month" },
  { value: "speaker", label: "Speaker" },
  { value: "speaker_role", label: "Speaker Role" },
  { value: "gender", label: "Speaker Sex" },
];

const DEFAULT_CUSTOM_RANGES: CustomDateRangeSpec[] = [
  { start: "1976", end: "1979" },
  { start: "1979", end: "-" },
];

const LEVEL_COLORS = [
  "#1D4ED8",
  "#0EA5E9",
  "#7C3AED",
  "#D97706",
  "#059669",
  "#DB2777",
];

function flattenNodes(root: GroupingTreeNode): Map<string, GroupingTreeNode> {
  const map = new Map<string, GroupingTreeNode>();
  const walk = (n: GroupingTreeNode) => {
    map.set(n.id, n);
    for (const ch of n.children || []) walk(ch);
  };
  walk(root);
  return map;
}

/** Reusable inline editor for Custom Date Ranges (supports "-" as dynamic latest date). */
const CustomRangesEditor: React.FC<{
  ranges: CustomDateRangeSpec[];
  onChange: (next: CustomDateRangeSpec[]) => void;
  maxAvailableDate?: string;
  compact?: boolean;
}> = ({ ranges, onChange, maxAvailableDate, compact = false }) => {
  const safeRanges = ranges.length > 0 ? ranges : DEFAULT_CUSTOM_RANGES;

  const updateRange = (idx: number, patch: Partial<CustomDateRangeSpec>) => {
    onChange(safeRanges.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRange = () => {
    const lastEnd = safeRanges[safeRanges.length - 1]?.end;
    const nextStart = lastEnd && lastEnd !== "-" ? lastEnd : "2000";
    onChange([...safeRanges, { start: nextStart, end: "-" }]);
  };

  const removeRange = (idx: number) => {
    if (safeRanges.length <= 1) return;
    onChange(safeRanges.filter((_, i) => i !== idx));
  };

  return (
    <div className={`space-y-1.5 ${compact ? "pt-1" : "mt-1.5"}`}>
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-muted">
        <span>
          Custom Ranges (use <code className="px-1 bg-canvas border border-border">-</code> for
          latest: <strong>{maxAvailableDate || "latest"}</strong>)
        </span>
        <button
          type="button"
          onClick={addRange}
          className="text-accent-dark hover:underline inline-flex items-center gap-0.5 font-semibold"
        >
          <Plus className="w-3 h-3" />
          Add Range
        </button>
      </div>
      <div className="space-y-1">
        {safeRanges.map((r, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <input
              type="text"
              value={r.start}
              onChange={(e) => updateRange(idx, { start: e.target.value })}
              placeholder="1976"
              title="Start year or YYYY-MM-DD"
              className="input-field py-0.5 px-2 text-xs font-mono w-24"
            />
            <span className="text-[11px] font-mono text-muted">to</span>
            <input
              type="text"
              value={r.end}
              onChange={(e) => updateRange(idx, { end: e.target.value })}
              placeholder="-"
              title="End year, YYYY-MM-DD, or '-' for latest available date"
              className="input-field py-0.5 px-2 text-xs font-mono w-24"
            />
            <input
              type="text"
              value={r.label || ""}
              onChange={(e) => updateRange(idx, { label: e.target.value || undefined })}
              placeholder="Label (opt.)"
              className="input-field py-0.5 px-2 text-xs font-mono flex-1 min-w-[80px]"
            />
            {safeRanges.length > 1 && (
              <button
                type="button"
                onClick={() => removeRange(idx)}
                title="Remove range"
                className="text-zinc-400 hover:text-red-600 p-0.5"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const GroupingTreeModal: React.FC<GroupingTreeModalProps> = ({
  open,
  onClose,
  documents,
  initialConfig,
  onApply,
  onInspectNode,
}) => {
  const { isDark } = useTheme();
  const [splitLevels, setSplitLevels] = useState<SplitLevelConfig[]>(
    initialConfig?.split_levels?.length
      ? initialConfig.split_levels
      : [{ criterion: "year_range", year_range_span: 5 }]
  );
  const [hiddenNodeIds, setHiddenNodeIds] = useState<string[]>(
    initialConfig?.hidden_node_ids || []
  );
  const [nodeSplits, setNodeSplits] = useState<Record<string, SplitLevelConfig>>(
    initialConfig?.node_splits || {}
  );
  const [graphLayout, setGraphLayout] = useState<"force" | "tree" | "table">("force");
  const [tableFilter, setTableFilter] = useState<string>("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Draft sub-group configuration inside the floating node context panel
  const [draftNodeCriterion, setDraftNodeCriterion] = useState<SplitCriterion>("year");
  const [draftNodeSpan, setDraftNodeSpan] = useState<number>(5);
  const [draftNodeRanges, setDraftNodeRanges] = useState<CustomDateRangeSpec[]>(
    DEFAULT_CUSTOM_RANGES
  );

  const [preview, setPreview] = useState<TreePreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (
      initialConfig &&
      (initialConfig.split_levels.length > 0 ||
        Object.keys(initialConfig.node_splits || {}).length > 0)
    ) {
      setSplitLevels(initialConfig.split_levels);
      setHiddenNodeIds(initialConfig.hidden_node_ids || []);
      setNodeSplits(initialConfig.node_splits || {});
    }
    setSelectedNodeId(null);
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
        node_splits: nodeSplits,
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
  }, [open, documents, splitLevels, hiddenNodeIds, nodeSplits]);

  const nodesById = useMemo(() => {
    if (!preview?.root) return new Map<string, GroupingTreeNode>();
    return flattenNodes(preview.root);
  }, [preview]);

  const orderedNodesList = useMemo(() => {
    if (!preview?.root) return [] as GroupingTreeNode[];
    const list: GroupingTreeNode[] = [];
    const walk = (n: GroupingTreeNode) => {
      list.push(n);
      for (const ch of n.children || []) walk(ch);
    };
    walk(preview.root);
    return list;
  }, [preview]);

  const filteredTableNodes = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return orderedNodesList;
    return orderedNodesList.filter((n) => {
      const pathStr = n.path_filters.map((f) => f.label).join(" ").toLowerCase();
      return (
        n.label.toLowerCase().includes(q) ||
        n.criterion.toLowerCase().includes(q) ||
        pathStr.includes(q)
      );
    });
  }, [orderedNodesList, tableFilter]);

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) || null : null;

  // Sync draft node split editor whenever user clicks a node in the Obsidian graph
  useEffect(() => {
    if (!selectedNodeId) return;
    const existing = nodeSplits[selectedNodeId];
    if (existing) {
      setDraftNodeCriterion(existing.criterion);
      setDraftNodeSpan(existing.year_range_span || 5);
      setDraftNodeRanges(
        existing.custom_ranges?.length ? existing.custom_ranges : DEFAULT_CUSTOM_RANGES
      );
    } else {
      setDraftNodeCriterion("year");
      setDraftNodeSpan(5);
      setDraftNodeRanges(DEFAULT_CUSTOM_RANGES);
    }
  }, [selectedNodeId, nodeSplits]);

  // Build Obsidian-style Interactive Graph ECharts option
  const graphOption = useMemo(() => {
    if (!preview?.root) return {};

    const graphNodes: Array<Record<string, unknown>> = [];
    const graphLinks: Array<Record<string, unknown>> = [];
    const maxDocs = Math.max(1, preview.root.doc_count);

    // Compute clean initial coordinates for smooth settling & hierarchical layout
    const levelBuckets = new Map<number, GroupingTreeNode[]>();
    const collectLevels = (n: GroupingTreeNode) => {
      const arr = levelBuckets.get(n.level) || [];
      arr.push(n);
      levelBuckets.set(n.level, arr);
      for (const ch of n.children || []) collectLevels(ch);
    };
    collectLevels(preview.root);

    const coords = new Map<string, { x: number; y: number }>();
    levelBuckets.forEach((arr, lvl) => {
      const count = arr.length;
      arr.forEach((n, idx) => {
        const x = (idx - (count - 1) / 2) * 150;
        const y = lvl * 130;
        coords.set(n.id, { x, y });
      });
    });

    const walkGraph = (n: GroupingTreeNode) => {
      const isSelected = n.id === selectedNodeId;
      const hasCustomSplit = Boolean(nodeSplits[n.id]);
      const isLeaf = !n.children || n.children.length === 0;
      const baseColor = n.effectively_hidden
        ? isDark
          ? "#475569"
          : "#CBD5E1"
        : LEVEL_COLORS[n.level % LEVEL_COLORS.length];

      const sizeRatio = Math.sqrt(Math.max(1, n.doc_count) / maxDocs);
      const symbolSize = Math.round(18 + sizeRatio * 34);
      const pos = coords.get(n.id) || { x: 0, y: 0 };

      graphNodes.push({
        id: n.id,
        name: n.label,
        value: n.doc_count,
        x: pos.x,
        y: pos.y,
        symbolSize,
        draggable: true,
        itemStyle: {
          color: baseColor,
          borderColor: isSelected
            ? "#F59E0B"
            : hasCustomSplit
            ? "#10B981"
            : isDark
            ? "#E2E8F0"
            : "#FFFFFF",
          borderWidth: isSelected ? 4 : hasCustomSplit ? 3 : 2,
          shadowBlur: isSelected ? 18 : 8,
          shadowColor: isSelected
            ? "rgba(245, 158, 11, 0.65)"
            : isDark
            ? "rgba(59, 130, 246, 0.35)"
            : "rgba(30, 58, 138, 0.2)",
          opacity: n.effectively_hidden ? 0.45 : 1,
        },
        label: {
          show: true,
          position: "bottom",
          distance: 6,
          formatter: () => `${n.label}\n(${n.doc_count})`,
          color: n.effectively_hidden
            ? isDark
              ? "#64748B"
              : "#94A3B8"
            : isDark
            ? "#E2E8F0"
            : "#0F172A",
          fontFamily: "JetBrains Mono, monospace",
          fontSize: isSelected ? 11 : 10,
          fontWeight: isSelected || n.level === 0 ? "bold" : "normal",
        },
        _nodeId: n.id,
        _isLeaf: isLeaf,
      });

      for (const ch of n.children || []) {
        graphLinks.push({
          source: n.id,
          target: ch.id,
          lineStyle: {
            color: ch.effectively_hidden
              ? isDark
                ? "#334155"
                : "#E2E8F0"
              : isDark
              ? "#475569"
              : "#94A3B8",
            width: ch.id === selectedNodeId || n.id === selectedNodeId ? 2.5 : 1.5,
            curveness: graphLayout === "force" ? 0.08 : 0.12,
            opacity: ch.effectively_hidden ? 0.35 : 0.75,
          },
        });
        walkGraph(ch);
      }
    };
    walkGraph(preview.root);

    return {
      tooltip: {
        trigger: "item",
        formatter: (p: { dataType?: string; data?: { _nodeId?: string } }) => {
          if (p.dataType !== "node" || !p.data?._nodeId) return "";
          const node = nodesById.get(p.data._nodeId);
          if (!node) return "";
          const splitNote = nodeSplits[node.id]
            ? `<div style="color:#10B981;">Custom node split: ${nodeSplits[node.id].criterion}</div>`
            : "";
          return `<div style="font-family:JetBrains Mono,monospace;font-size:11px;min-width:180px;">
            <div style="font-weight:700;margin-bottom:3px;">${node.label}</div>
            <div>Documents: <strong>${node.doc_count}</strong></div>
            <div>Status: <strong>${node.effectively_hidden ? "Hidden" : node.children.length === 0 ? "Active Leaf" : "Branch"}</strong></div>
            ${splitNote}
            <div style="margin-top:4px;font-size:10px;color:#94A3B8;">Click node to partition, hide, or inspect</div>
          </div>`;
        },
      },
      series: [
        {
          type: "graph",
          layout: graphLayout === "force" ? "force" : "none",
          roam: true,
          draggable: true,
          edgeSymbol: ["none", "arrow"],
          edgeSymbolSize: [4, 7],
          force: {
            repulsion: 360,
            gravity: 0.08,
            edgeLength: [85, 145],
            friction: 0.6,
            layoutAnimation: true,
          },
          emphasis: {
            focus: "adjacency",
            lineStyle: { width: 3 },
          },
          data: graphNodes,
          links: graphLinks,
        },
      ],
    };
  }, [preview, selectedNodeId, nodeSplits, graphLayout, isDark, nodesById]);

  if (!open) return null;

  const toggleNodeHidden = (nodeId: string) => {
    setHiddenNodeIds((prev) =>
      prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]
    );
  };

  const addSplitLevel = () => {
    const used = new Set(splitLevels.map((l) => l.criterion));
    const nextCrit =
      CRITERION_OPTIONS.find((o) => !used.has(o.value))?.value || "semester";
    setSplitLevels((prev) => [
      ...prev,
      {
        criterion: nextCrit,
        year_range_span: 5,
        custom_ranges: nextCrit === "custom_range" ? DEFAULT_CUSTOM_RANGES : [],
      },
    ]);
    setHiddenNodeIds([]);
  };

  const updateSplitLevel = (idx: number, patch: Partial<SplitLevelConfig>) => {
    setSplitLevels((prev) =>
      prev.map((lvl, i) => {
        if (i !== idx) return lvl;
        const merged = { ...lvl, ...patch };
        if (merged.criterion === "custom_range" && (!merged.custom_ranges || merged.custom_ranges.length === 0)) {
          merged.custom_ranges = DEFAULT_CUSTOM_RANGES;
        }
        return merged;
      })
    );
    setHiddenNodeIds([]);
  };

  const removeSplitLevel = (idx: number) => {
    setSplitLevels((prev) => prev.filter((_, i) => i !== idx));
    setHiddenNodeIds([]);
  };

  const applyNodeSplit = () => {
    if (!selectedNode) return;
    setNodeSplits((prev) => ({
      ...prev,
      [selectedNode.id]: {
        criterion: draftNodeCriterion,
        year_range_span: draftNodeSpan,
        custom_ranges: draftNodeCriterion === "custom_range" ? draftNodeRanges : [],
      },
    }));
  };

  const removeNodeSplit = (nodeId: string) => {
    setNodeSplits((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      // Also clean up any descendant node_splits under this branch
      Object.keys(next).forEach((k) => {
        if (k.startsWith(`${nodeId}/`)) delete next[k];
      });
      return next;
    });
  };

  const visibleLeaves = preview?.visible_leaf_count ?? 0;
  const isValid = visibleLeaves >= 1 && !loading;

  const selectedPathTitle = selectedNode
    ? selectedNode.path_filters.length > 0
      ? selectedNode.path_filters.map((f) => f.label).join(" → ")
      : "All Selected Documents"
    : "";

  return (
    <div className="fixed inset-0 z-40 bg-black/55 flex items-center justify-center p-3 sm:p-4">
      <div className="panel w-full max-w-6xl h-[90vh] flex flex-col bg-surface shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-border flex flex-wrap items-center justify-between gap-2 bg-zinc-50/80 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-accent" />
              <h2 className="text-base font-semibold text-ink">
                Group / Combine Interactive Graph Builder
              </h2>
            </div>
            <p className="text-xs font-mono text-muted mt-0.5">
              Drag nodes, scroll to zoom, or click any node to independently partition, hide, or
              inspect its {documents.length} selected documents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex border border-border rounded-sm overflow-hidden bg-surface text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setGraphLayout("force")}
                className={`px-2.5 py-1 ${
                  graphLayout === "force" ? "bg-ink text-white" : "text-muted hover:text-ink"
                }`}
              >
                Graph
              </button>
              <button
                type="button"
                onClick={() => setGraphLayout("tree")}
                className={`px-2.5 py-1 border-l border-border ${
                  graphLayout === "tree" ? "bg-ink text-white" : "text-muted hover:text-ink"
                }`}
              >
                Hierarchical
              </button>
              <button
                type="button"
                onClick={() => setGraphLayout("table")}
                className={`px-2.5 py-1 border-l border-border inline-flex items-center gap-1 ${
                  graphLayout === "table" ? "bg-ink text-white" : "text-muted hover:text-ink"
                }`}
              >
                <Table2 className="w-3 h-3" />
                Table
              </button>
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
        </div>

        {/* Global Split Levels Bar */}
        <div className="px-5 py-3 border-b border-border bg-canvas space-y-2 shrink-0 max-h-44 overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-mono uppercase text-muted font-semibold">
              Global Split Levels ({splitLevels.length})
              {Object.keys(nodeSplits).length > 0 && (
                <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                  · {Object.keys(nodeSplits).length} custom per-node{" "}
                  {Object.keys(nodeSplits).length === 1 ? "split" : "splits"}
                </span>
              )}
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
              No global split levels. Click any node in the graph below to partition it
              individually, or add a global level above.
            </p>
          ) : (
            <div className="space-y-2">
              {splitLevels.map((lvl, idx) => (
                <div
                  key={idx}
                  className="border border-border bg-surface px-3 py-2 rounded-sm space-y-1.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono uppercase text-muted font-semibold">
                      L{idx + 1}:
                    </span>
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
                      className="text-zinc-400 hover:text-red-600 ml-auto"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {lvl.criterion === "custom_range" && (
                    <CustomRangesEditor
                      ranges={lvl.custom_ranges || DEFAULT_CUSTOM_RANGES}
                      onChange={(nextRanges) =>
                        updateSplitLevel(idx, { custom_ranges: nextRanges })
                      }
                      maxAvailableDate={preview?.max_available_date}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Interactive Graph Canvas / Table View + Floating Contextual Node Menu */}
        <div className="flex-1 relative bg-canvas overflow-hidden flex flex-col">
          {error ? (
            <div className="p-5 text-xs font-mono text-red-700 bg-red-50">{error}</div>
          ) : loading && !preview ? (
            <div className="h-full flex items-center justify-center text-xs font-mono text-muted">
              Computing interactive partition graph...
            </div>
          ) : preview && graphLayout === "table" ? (
            <div className="flex-1 flex flex-col overflow-hidden bg-surface">
              <div className="px-4 py-2.5 border-b border-border bg-canvas flex flex-wrap items-center justify-between gap-2 shrink-0">
                <input
                  type="text"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  placeholder="Filter tree nodes by label, path, or criterion..."
                  className="input-field py-1 px-2.5 text-xs max-w-sm"
                />
                <span className="text-[11px] font-mono text-muted">
                  Showing {filteredTableNodes.length} of {orderedNodesList.length} nodes · Click a
                  row to partition independently
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border bg-canvas sticky top-0 z-10 text-[10px] font-mono uppercase text-muted">
                      <th className="py-2 px-3">Hierarchy / Node</th>
                      <th className="py-2 px-3">Criterion</th>
                      <th className="py-2 px-3 text-right">Docs</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredTableNodes.map((n) => {
                      const isSelected = n.id === selectedNodeId;
                      const isLeaf = !n.children || n.children.length === 0;
                      const hasCustomSplit = Boolean(nodeSplits[n.id]);
                      const pathTitle =
                        n.path_filters.length > 0
                          ? n.path_filters.map((f) => f.label).join(" → ")
                          : "All Selected Documents";
                      return (
                        <tr
                          key={n.id}
                          onClick={() => setSelectedNodeId(n.id)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? "bg-accent-soft/70"
                              : n.effectively_hidden
                              ? "opacity-50 hover:bg-canvas"
                              : "hover:bg-canvas"
                          }`}
                        >
                          <td className="py-2 px-3 font-medium text-ink">
                            <div
                              className="flex items-center gap-1.5"
                              style={{ paddingLeft: `${n.level * 18}px` }}
                            >
                              <span
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{
                                  backgroundColor: n.effectively_hidden
                                    ? "#94A3B8"
                                    : LEVEL_COLORS[n.level % LEVEL_COLORS.length],
                                }}
                              />
                              <span className="truncate">{n.label}</span>
                              {hasCustomSplit && (
                                <span className="mono-tag text-[9px] border-emerald-500/60 text-emerald-700 dark:text-emerald-300">
                                  split: {nodeSplits[n.id].criterion}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-muted">
                            L{n.level} · {n.criterion}
                          </td>
                          <td className="py-2 px-3 font-mono text-right font-semibold text-ink">
                            {n.doc_count}
                          </td>
                          <td className="py-2 px-3 font-mono text-[10px]">
                            {n.effectively_hidden ? (
                              <span className="mono-tag text-zinc-500">Hidden</span>
                            ) : isLeaf ? (
                              <span className="mono-tag border-accent text-accent-dark bg-accent-soft">
                                Active Leaf
                              </span>
                            ) : (
                              <span className="mono-tag">Branch ({n.children.length})</span>
                            )}
                          </td>
                          <td
                            className="py-2 px-3 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedNodeId(n.id)}
                                title="Partition / Sub-Group this node"
                                className="btn-secondary py-0.5 px-2 text-[11px]"
                              >
                                <GitBranch className="w-3 h-3" />
                                Split
                              </button>
                              <button
                                type="button"
                                onClick={() => onInspectNode(pathTitle, n.path_filters)}
                                title="Inspect chunks in this node"
                                className="btn-secondary py-0.5 px-2 text-[11px]"
                              >
                                <Search className="w-3 h-3" />
                              </button>
                              {n.level > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleNodeHidden(n.id)}
                                  title={n.hidden ? "Show branch" : "Hide branch"}
                                  className="btn-secondary py-0.5 px-2 text-[11px]"
                                >
                                  {n.hidden ? (
                                    <Eye className="w-3 h-3" />
                                  ) : (
                                    <EyeOff className="w-3 h-3" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : preview ? (
            <EChartBox
              option={graphOption}
              className="w-full h-full"
              onChartClick={(params) => {
                if (params.dataType === "node") {
                  const data = params.data as { _nodeId?: string } | undefined;
                  if (data?._nodeId) {
                    setSelectedNodeId(data._nodeId);
                  }
                }
              }}
            />
          ) : null}

          {/* Floating Contextual Panel when a Node is Clicked */}
          {selectedNode && (
            <div className="absolute top-3 right-3 w-80 sm:w-96 max-h-[calc(100%-24px)] overflow-y-auto panel bg-surface/95 backdrop-blur shadow-2xl border border-accent/60 p-4 space-y-3 z-20">
              <div className="flex items-start justify-between gap-2 border-b border-border pb-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase text-accent-dark font-semibold">
                    <Sparkles className="w-3 h-3" />
                    Selected Node · Level {selectedNode.level}
                  </div>
                  <h3 className="text-sm font-semibold text-ink truncate mt-0.5">
                    {selectedNode.label}
                  </h3>
                  <p className="text-[11px] font-mono text-muted truncate">
                    {selectedPathTitle} · {selectedNode.doc_count}{" "}
                    {selectedNode.doc_count === 1 ? "doc" : "docs"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="text-muted hover:text-ink p-0.5 shrink-0"
                  title="Close node menu"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Independent Recursive Partitioning Controls for THIS Node */}
              <div className="space-y-2">
                <label className="block text-[10px] font-mono uppercase text-muted font-semibold">
                  Partition / Sub-Group This Node Independently
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={draftNodeCriterion}
                    onChange={(e) =>
                      setDraftNodeCriterion(e.target.value as SplitCriterion)
                    }
                    className="input-field py-1 px-2 text-xs font-mono flex-1"
                  >
                    {CRITERION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  {draftNodeCriterion === "year_range" && (
                    <input
                      type="number"
                      min={2}
                      max={20}
                      value={draftNodeSpan}
                      onChange={(e) =>
                        setDraftNodeSpan(
                          Math.max(2, Math.min(20, Number(e.target.value) || 5))
                        )
                      }
                      title="Year range span"
                      className="input-field py-1 px-1.5 text-xs font-mono w-14 text-center"
                    />
                  )}
                </div>

                {draftNodeCriterion === "custom_range" && (
                  <CustomRangesEditor
                    ranges={draftNodeRanges}
                    onChange={setDraftNodeRanges}
                    maxAvailableDate={preview?.max_available_date}
                    compact
                  />
                )}

                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={applyNodeSplit}
                    className="btn-primary py-1 px-2.5 text-xs flex-1"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    {nodeSplits[selectedNode.id] ? "Update Sub-Group" : "Partition Node"}
                  </button>
                  {nodeSplits[selectedNode.id] && (
                    <button
                      type="button"
                      onClick={() => removeNodeSplit(selectedNode.id)}
                      className="btn-secondary py-1 px-2 text-xs text-red-600"
                      title="Remove custom split from this node"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Node Actions: Inspect & Hide/Show */}
              <div className="pt-2.5 border-t border-border flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onInspectNode(selectedPathTitle, selectedNode.path_filters)}
                  className="btn-secondary py-1 px-2.5 text-xs flex-1"
                >
                  <Search className="w-3.5 h-3.5" />
                  Inspect Chunks
                </button>
                {selectedNode.level > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleNodeHidden(selectedNode.id)}
                    className="btn-secondary py-1 px-2.5 text-xs"
                  >
                    {selectedNode.hidden ? (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        Show
                      </>
                    ) : (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        Hide
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Subtle Graph Controls Legend */}
          {graphLayout !== "table" && (
            <div className="absolute bottom-3 left-3 px-2.5 py-1.5 rounded-sm bg-surface/90 border border-border text-[10px] font-mono text-muted pointer-events-none">
              Scroll to zoom · Drag background to pan · Click any node for partition menu
            </div>
          )}
        </div>

        {/* Footer with Live Leaf Counter & Apply Button */}
        <div className="px-5 py-3 border-t border-border bg-zinc-50/80 flex flex-wrap items-center justify-between gap-3 shrink-0">
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
                Restore hidden ({hiddenNodeIds.length})
              </button>
            )}
            {Object.keys(nodeSplits).length > 0 && (
              <button
                type="button"
                onClick={() => setNodeSplits({})}
                className="text-xs font-mono underline text-muted hover:text-ink"
              >
                Clear per-node splits ({Object.keys(nodeSplits).length})
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
                  node_splits: nodeSplits,
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
