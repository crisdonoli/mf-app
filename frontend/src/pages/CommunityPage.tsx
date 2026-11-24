/** Community Feed Page — Browse public studies, Explorer searches, and histories with Fork Lineage links. */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, ExternalLink, GitCompare, GitFork, History, Search } from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import type { SearchHistoryItem, StudyItem, StudyType } from "../types/api";

function resolveStudyType(st: StudyItem): StudyType {
  if (st.study_type === "explorer_search" || st.study_type === "history") {
    return st.study_type;
  }
  return "comparator";
}

export const CommunityPage: React.FC = () => {
  const navigate = useNavigate();
  const { replaceHistory, setSidebarOpen } = useWorkspace();
  const [studies, setStudies] = useState<StudyItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listCommunity()
      .then((res) => setStudies(res.items))
      .finally(() => setLoading(false));
  }, []);

  const handleOpen = (st: StudyItem) => {
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
        id: `community-${st.id}-${idx}`,
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5" />
            Community Case Studies
          </span>
          <h1 className="text-2xl font-bold text-ink mt-0.5">
            Published FOMC Research &amp; Fork Lineage
          </h1>
        </div>
        <span className="mono-tag">{studies.length} PUBLIC ITEMS</span>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs font-mono text-muted">
          Loading community studies...
        </div>
      ) : studies.length === 0 ? (
        <div className="panel p-10 text-center space-y-2">
          <p className="text-sm font-medium text-ink">No public studies published yet</p>
          <p className="text-xs text-muted">
            Mark a study, Explorer search, or history as Public in your Portfolio to share it with
            the MiningFOMC community.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {studies.map((st) => {
            const kind = resolveStudyType(st);
            const entriesCount = Array.isArray((st.config as Record<string, unknown>)?.entries)
              ? ((st.config as Record<string, unknown>).entries as unknown[]).length
              : 0;
            return (
              <div key={st.id} className="panel p-5 flex flex-col justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-base font-semibold text-ink">{st.title}</h2>
                    <span className="mono-tag text-[10px] uppercase shrink-0 inline-flex items-center gap-1">
                      {kind === "explorer_search" ? (
                        <Search className="w-2.5 h-2.5" />
                      ) : kind === "history" ? (
                        <History className="w-2.5 h-2.5" />
                      ) : (
                        <GitCompare className="w-2.5 h-2.5" />
                      )}
                      {kind === "explorer_search"
                        ? "Explorer Search"
                        : kind === "history"
                        ? "Search History"
                        : "Comparator"}
                    </span>
                  </div>
                  {st.description && (
                    <p className="text-xs text-muted leading-relaxed">{st.description}</p>
                  )}

                  <div className="text-[11px] font-mono text-zinc-600 space-y-1 pt-1">
                    <div>
                      Original Author: <strong className="text-ink">{st.primary_author}</strong>
                      {st.collaborator && (
                        <>
                          {" "}
                          · Collaborator: <strong className="text-ink">{st.collaborator}</strong>
                        </>
                      )}
                    </div>
                    <div className="text-zinc-400">
                      Created: {new Date(st.created_at).toLocaleDateString()} · Last Modified:{" "}
                      {new Date(st.last_modified).toLocaleDateString()}
                    </div>

                    {/* Clickable Fork Lineage Links */}
                    {st.parent_study && (
                      <div className="flex items-center gap-1 text-accent-dark">
                        <GitFork className="w-3 h-3" />
                        <span>Forked from</span>
                        <button
                          type="button"
                          onClick={() => navigate(`/comparator?study=${st.parent_study!.id}`)}
                          className="underline font-semibold"
                        >
                          {st.parent_study.author_username}
                        </button>
                      </div>
                    )}

                    {st.forks.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 text-zinc-600">
                        <GitFork className="w-3 h-3 text-accent" />
                        <span>Forked by:</span>
                        {st.forks.map((fk, idx) => (
                          <React.Fragment key={fk.id}>
                            <button
                              type="button"
                              onClick={() => navigate(`/comparator?study=${fk.id}`)}
                              className="underline text-accent-dark font-medium"
                            >
                              {fk.owner_username}
                            </button>
                            {idx < st.forks.length - 1 && <span>,</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-border flex items-center justify-between">
                  <span className="mono-tag">
                    {kind === "explorer_search"
                      ? "Saved Search Parameters"
                      : kind === "history"
                      ? `${entriesCount} query entries`
                      : `${st.config?.basket?.length || 0} docs · N=${st.config?.n_partitions || 1}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleOpen(st)}
                    className="btn-primary py-1.5 px-3 text-xs"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {kind === "explorer_search"
                      ? "Open in Explorer"
                      : kind === "history"
                      ? "Restore History"
                      : "Open in Comparator"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
