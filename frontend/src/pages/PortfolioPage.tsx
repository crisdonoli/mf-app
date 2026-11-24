/** User Portfolio Page — Manage created and forked Comparator studies. */

import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ExternalLink, FolderKanban, Globe, Lock, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { StudyItem } from "../types/api";

export const PortfolioPage: React.FC = () => {
  const navigate = useNavigate();
  const [studies, setStudies] = useState<StudyItem[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold flex items-center gap-1.5">
            <FolderKanban className="w-3.5 h-3.5" />
            Researcher Portfolio
          </span>
          <h1 className="text-2xl font-bold text-ink mt-0.5">Saved &amp; Forked Case Studies</h1>
        </div>
        <button
          type="button"
          onClick={() => navigate("/comparator")}
          className="btn-primary text-xs"
        >
          New Study in Comparator
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs font-mono text-muted">Loading portfolio...</div>
      ) : studies.length === 0 ? (
        <div className="panel p-10 text-center space-y-2">
          <p className="text-sm font-medium text-ink">No saved studies yet</p>
          <p className="text-xs text-muted">
            Configure a document comparison in the Comparator and click &ldquo;Save Study&rdquo; to
            archive it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {studies.map((st) => (
            <div key={st.id} className="panel p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink">{st.title}</h2>
                  <span
                    className={`mono-tag text-[10px] uppercase ${
                      st.is_public ? "border-accent bg-accent-soft text-accent-dark" : ""
                    }`}
                  >
                    {st.is_public ? "Public" : "Private"}
                  </span>
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
                  onClick={() => navigate(`/comparator?study=${st.id}`)}
                  className="btn-primary py-1.5 px-3 text-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Load
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
                    title="Delete study"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
