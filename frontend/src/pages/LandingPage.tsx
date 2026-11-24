/** Tab 1: Landing Page — MiningFOMC methodology, corpus stats, and taxonomy overview. */

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Database, GitCompare, Layers, Lock, Search, Sparkles } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import type { CorpusStats, TaxonomyResponse } from "../types/api";

export const LandingPage: React.FC = () => {
  const { user } = useAuth();
  const { dbVersionRevision } = useWorkspace();
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null);

  useEffect(() => {
    api.getStats().then(setStats).catch(() => {});
    if (user) {
      api.getTaxonomy().then(setTaxonomy).catch(() => {});
    }
  }, [user, dbVersionRevision]);

  const pipelineSteps = [
    {
      index: "01",
      title: "1976–2020 Federal Reserve Corpus",
      body: "Full-text and chunked interventions across FOMC Transcripts, Greenbooks/Bluebooks, Beige Books, Agendas, Memos, Policy Statements, Minutes, and Presentations stored in Hive-partitioned Apache Parquet.",
    },
    {
      index: "02",
      title: "Zero-Shot Macroeconomic Taxonomy",
      body: "Transcript interventions classified into 13 macroeconomic macro-categories, branching into granular sub-classes (e.g., Growth → GDP, Consumption, Housing; Financial Conditions → Banking Stress, Market Functioning).",
    },
    {
      index: "03",
      title: "High-Confidence Prototype Construction",
      body: "Centered unit-norm class prototypes constructed from high-confidence zero-shot BGE-M3 chunk embeddings to anchor semantic macroeconomic concepts across four decades of monetary policy.",
    },
    {
      index: "04",
      title: "Out-of-Core Similarity & Standardization",
      body: "Precomputed chunk-to-prototype cosine similarity matrices queried lazily with DuckDB predicate pushdown, supporting live Softmax/Log transforms, Topic/Slice normalization, and N-partition temporal standardization.",
    },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-12 pb-16">
      {/* Editorial Hero */}
      <section className="panel p-8 sm:p-12">
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className="mono-tag border-accent text-accent-dark bg-accent-soft">
            FEDERAL OPEN MARKET COMMITTEE
          </span>
          <span className="mono-tag">1976 — 2020 CORPUS</span>
          <span className="mono-tag">OUT-OF-CORE PARQUET · DUCKDB</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-ink max-w-3xl leading-[1.08]">
          Structured Macroeconomic Analysis of Historical FOMC Deliberations.
        </h1>

        <p className="mt-5 text-base sm:text-lg text-muted max-w-2xl leading-relaxed">
          MiningFOMC pairs zero-shot macroeconomic classification with dense BGE-M3 prototype
          similarity matrices—enabling instant inspection of meeting bundles and standardized
          cross-document comparisons without memory bloat.
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          {user ? (
            <>
              <Link to="/explorer" className="btn-primary px-5 py-2.5">
                <Search className="w-4 h-4" />
                Launch Database Explorer
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/comparator" className="btn-secondary px-5 py-2.5">
                <GitCompare className="w-4 h-4" />
                Open Document Comparator
              </Link>
            </>
          ) : (
            <Link to="/login" className="btn-primary px-5 py-2.5">
              <Lock className="w-4 h-4" />
              Sign In or Request Researcher Access
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </section>

      {/* Live Corpus Metrics Strip */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="panel p-5">
          <div className="text-xs font-mono uppercase text-muted flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-accent" />
            Indexed Chunks
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-mono font-semibold text-ink">
            {stats ? stats.total_chunks.toLocaleString() : "—"}
          </div>
          <div className="mt-1 text-xs font-mono text-zinc-400">
            {stats ? `${stats.parquet_files} Parquet partitions` : "Loading metadata..."}
          </div>
        </div>

        <div className="panel p-5">
          <div className="text-xs font-mono uppercase text-muted flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-accent" />
            Document Types
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-mono font-semibold text-ink">
            {stats ? stats.doc_types_count : "—"}
          </div>
          <div className="mt-1 text-xs font-mono text-zinc-400">
            Transcripts, Books, Memos, Agendas
          </div>
        </div>

        <div className="panel p-5">
          <div className="text-xs font-mono uppercase text-muted flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            Macro Taxonomy
          </div>
          <div className="mt-2 text-2xl sm:text-3xl font-mono font-semibold text-ink">
            {stats ? `${stats.macro_category_count} / ${stats.subclass_count}` : "13 / 24"}
          </div>
          <div className="mt-1 text-xs font-mono text-zinc-400">
            Macro-categories / Granular sub-classes
          </div>
        </div>

        <div className="panel p-5">
          <div className="text-xs font-mono uppercase text-muted">Coverage Window</div>
          <div className="mt-2 text-2xl sm:text-3xl font-mono font-semibold text-ink">
            {stats ? `${stats.year_min}–${stats.year_max}` : "1976–2020"}
          </div>
          <div className="mt-1 text-xs font-mono text-zinc-400">
            Engine: {stats ? stats.engine.toUpperCase() : "DUCKDB"}
          </div>
        </div>
      </section>

      {/* Methodology Architecture */}
      <section className="space-y-4">
        <div className="flex items-end justify-between border-b border-border pb-3">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold">
              Methodology
            </span>
            <h2 className="text-xl sm:text-2xl font-semibold text-ink mt-0.5">
              Four-Stage Analytical Pipeline
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {pipelineSteps.map((step) => (
            <div key={step.index} className="panel p-6 flex flex-col justify-between">
              <div>
                <span className="font-mono text-xs font-semibold text-accent-dark">
                  STAGE {step.index}
                </span>
                <h3 className="mt-2 text-base font-semibold text-ink">{step.title}</h3>
                <p className="mt-2 text-sm text-muted leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 13 Macro-Categories Taxonomy Grid (visible when authenticated) */}
      {taxonomy && (
        <section className="space-y-4">
          <div className="flex items-end justify-between border-b border-border pb-3">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold">
                Classification Schema
              </span>
              <h2 className="text-xl sm:text-2xl font-semibold text-ink mt-0.5">
                13 Macroeconomic Categories &amp; Sub-Class Hierarchy
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {taxonomy.macro_categories.map((cat) => (
              <div key={cat.id} className="panel p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">{cat.label}</h3>
                    <span className="font-mono text-[10px] text-zinc-400">
                      #{String(cat.index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-muted leading-relaxed">{cat.definition}</p>
                </div>

                {cat.subclasses.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-border flex flex-wrap gap-1">
                    {cat.subclasses.map((sub) => (
                      <span key={sub.id} className="mono-tag text-[10px]">
                        {sub.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
