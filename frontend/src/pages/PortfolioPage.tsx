/** User Portfolio Page — Manage saved Comparator studies, Explorer searches, and Search Histories. */

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ExternalLink,
  FolderKanban,
  GitCompare,
  Globe,
  History,
  Lock,
  Search,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import type { SearchHistoryItem, StudyItem, StudyType } from "../types/api";

function resolveStudyType(st: StudyItem): StudyType {
  if (st.study_type === "explorer_search" || st.study_type === "history") {
    return st.study_type;
  }
  return "comparator";
}

function studyTypeLabel(kind: StudyType): string {
  if (kind === "explorer_search") return "Explorer Search";
  if (kind === "history") return "Search History";
  return "Comparator Study";
}

export const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const { replaceHistory, setSidebarOpen } = useWorkspace();
  const [studies, setStudies] = useState<StudyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | StudyType>("all");

  const loadStudies = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listPortfolio();
      setStudies(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStudies();
  }, [loadStudies]);

  const toggleVisibility = async (st: StudyItem) => {
    await api.updateStudy(st.id, { is_public: !st.is_public });
    await loadStudies();
  };

  const handleDelete = async (studyId: number) => {
    await api.deleteStudy(studyId);
    await loadStudies();
  };

  const handleLoadItem = (st: StudyItem) => {
    const kind = resolveStudyType(st);
    if (kind === "explorer_search") {
      navigate(`/explorer?portfolio=${st.id}`);
      return;
    }
    if (kind === "history") {
      const rawEntries = Array.isArray((st.config as Record<string, unknown>)?.entries)
        ? ((st.config as Record<string, unknown>).entries as Array<{
            kind?: "search" | "document";
            label?: string;
            payload?: Record<string, unknown>;
            created_at?: string;
          }>)
        : [];
      const restored: SearchHistoryItem[] = rawEntries.map((entry, idx) => ({
        id: `portfolio-${st.id}-${idx}`,
        kind: entry.kind === "document" ? "document" : "search",
        label: entry.label || `Saved Query #${idx + 1}`,
        payload: entry.payload || {},
        created_at: entry.created_at || st.created_at,
      }));
      replaceHistory(restored);
      setSidebarOpen(true);
      navigate(`/explorer?portfolio=${st.id}`);
      return;
    }
    navigate(`/comparator?study=${st.id}`);
  };

  const visibleStudies = studies.filter(
    (st) => typeFilter === "all" || resolveStudyType(st) === typeFilter
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold flex items-center gap-1.5">
            <FolderKanban className="w-3.5 h-3.5" />
            Researcher Portfolio
          </span>
          <h1 className="text-2xl font-bold text-ink mt-0.5">
            Saved Studies, Explorer Searches &amp; Histories
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/explorer")}
            className="btn-secondary text-xs"
          >
            <Search className="w-3.5 h-3.5" />
            Explorer
          </button>
          <button
            type="button"
            onClick={() => navigate("/comparator")}
            className="btn-primary text-xs"
          >
            <GitCompare className="w-3.5 h-3.5" />
            New Comparator Study
          </button>
        </div>
      </div>

      {/* Type Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            { id: "all", label: `All (${studies.length})` },
            {
              id: "comparator",
              label: `Comparator Studies (${studies.filter((s) => resolveStudyType(s) === "comparator").length})`,
            },
            {
              id: "explorer_search",
              label: `Explorer Searches (${studies.filter((s) => resolveStudyType(s) === "explorer_search").length})`,
            },
            {
              id: "history",
              label: `Search Histories (${studies.filter((s) => resolveStudyType(s) === "history").length})`,
            },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTypeFilter(tab.id)}
            className={`px-3 py-1 text-xs font-mono rounded-sm border transition-colors ${
              typeFilter === tab.id
                ? "bg-ink text-white border-ink"
                : "bg-surface text-muted border-border hover:border-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs font-mono text-muted">Loading portfolio...</div>
      ) : visibleStudies.length === 0 ? (
        <div className="panel p-10 text-center space-y-2">
          <p className="text-sm font-medium text-ink">No saved portfolio items in this view</p>
          <p className="text-xs text-muted">
            Save a Comparator study, an Explorer search query, or your Search History to archive
            its query parameters here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleStudies.map((st) => {
            const kind = resolveStudyType(st);
            return (
              <div key={st.id} className="panel p-5 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink">{st.title}</h2>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="mono-tag text-[10px] uppercase inline-flex items-center gap-1">
                        {kind === "explorer_search" ? (
                          <Search className="w-2.5 h-2.5" />
                        ) : kind === "history" ? (
                          <History className="w-2.5 h-2.5" />
                        ) : (
                          <GitCompare className="w-2.5 h-2.5" />
                        )}
                        {studyTypeLabel(kind)}
                      </span>
                      <span
                        className={`mono-tag text-[10px] uppercase ${
                          st.is_public ? "border-accent bg-accent-soft text-accent-dark" : ""
                        }`}
                      >
                        {st.is_public ? "Public" : "Private"}
                      </span>
                    </div>
                  </div>
                  {st.description && (
                    <p className="text-xs text-muted leading-relaxed">{st.description}</p>
                  )}
                  <div className="text-[11px] font-mono text-zinc-500 space-y-0.5">
                    <div>
                      Primary Author: <strong className="text-ink">{st.primary_author}</strong>
                      {st.collaborator && (
                        <>
                          {" "}
                          · Collaborator: <strong className="text-ink">{st.collaborator}</strong>
                        </>
                      )}
                    </div>
                    {st.parent_study && (
                      <div>
                        Forked from{" "}
                        <button
                          type="button"
                          onClick={() => navigate(`/comparator?study=${st.parent_study!.id}`)}
                          className="underline text-accent-dark"
                        >
                          {st.parent_study.author_username}
                        </button>
                      </div>
                    )}
                    <div>
                      Created: {new Date(st.created_at).toLocaleDateString()} · Modified:{" "}
                      {new Date(st.last_modified).toLocaleDateString()}
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-border flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleLoadItem(st)}
                    className="btn-primary py-1.5 px-3 text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {kind === "explorer_search"
                      ? "Re-run in Explorer"
                      : kind === "history"
                      ? "Restore History"
                      : "Load Study"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleVisibility(st)}
                      className="btn-secondary py-1.5 px-2.5 text-xs"
                    >
                      {st.is_public ? (
                        <>
                          <Lock className="w-3 h-3" />
                          Make Private
                        </>
                      ) : (
                        <>
                          <Globe className="w-3 h-3" />
                          Make Public
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(st.id)}
                      className="btn-secondary py-1.5 px-2 text-xs hover:text-red-600"
                      title="Delete portfolio item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
