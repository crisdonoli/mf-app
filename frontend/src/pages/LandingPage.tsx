/** Tab 1: Landing Page — MiningFOMC methodology, corpus stats, and taxonomy overview. */

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Database,
  GitCompare,
  Layers,
  Lock,
  Maximize2,
  Pause,
  Play,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { api } from "../lib/api";
import preview1 from "../static/previews/1.webp";
import preview2 from "../static/previews/2.webp";
import preview3 from "../static/previews/3.webp";
import preview4 from "../static/previews/4.webp";
import preview5 from "../static/previews/5.webp";
import type { CorpusStats, TaxonomyResponse } from "../types/api";

interface PreviewSlide {
  id: number;
  src: string;
  badge: string;
  title: string;
  description: string;
}

const PREVIEW_SLIDES: PreviewSlide[] = [
  {
    id: 1,
    src: preview1,
    badge: "01 · EXPLORER",
    title: "Multi-Criteria Corpus Filtering & DuckDB Pushdown",
    description:
      "Filter 1976–2020 FOMC documents by date range, multiple document types, speaker autocomplete, full-text/regex queries, and similarity, zero-shot, or relevance score thresholds.",
  },
  {
    id: 2,
    src: preview2,
    badge: "02 · CLASSIFICATION",
    title: "Topic Probability Distributions & Chunk Inspector",
    description:
      "Inspect macro-category and granular sub-class probability distributions across individual document chunks, with per-chunk confidence scores and interactive distribution review.",
  },
  {
    id: 3,
    src: preview3,
    badge: "03 · COMPARATOR",
    title: "Cross-Document Radar Plot Comparisons",
    description:
      "Overlay multiple FOMC meetings, document types, or speaker cohorts on an interactive macroeconomic radar chart to contrast thematic focus across 13 policy dimensions.",
  },
  {
    id: 4,
    src: preview4,
    badge: "04 · TIME SERIES & SPLITS",
    title: "Chronological Evolution & Intra-Document Splits",
    description:
      "Track topic dynamics over time and across standardized intra-document partitions (N-splits), enabling drill-down inspection from any time-series slice straight to the underlying text.",
  },
  {
    id: 5,
    src: preview5,
    badge: "05 · EXPORT & COLLABORATION",
    title: "Direct CSV Exports, Research Portfolio & Study Sharing",
    description:
      "Download full chronological tables directly to CSV, save reproducible study configurations to your personal Portfolio, and publish or fork shared analyses with the research community.",
  },
];

export const LandingPage: React.FC = () => {
  const { user } = useAuth();
  const { dbVersionRevision } = useWorkspace();
  const [stats, setStats] = useState<CorpusStats | null>(null);
  const [taxonomy, setTaxonomy] = useState<TaxonomyResponse | null>(null);
  const [activeSlide, setActiveSlide] = useState<number>(0);
  const [autoPlay, setAutoPlay] = useState<boolean>(true);
  const [lightboxOpen, setLightboxOpen] = useState<boolean>(false);

  const goPrev = useCallback(() => {
    setActiveSlide((idx) => (idx === 0 ? PREVIEW_SLIDES.length - 1 : idx - 1));
  }, []);

  const goNext = useCallback(() => {
    setActiveSlide((idx) => (idx === PREVIEW_SLIDES.length - 1 ? 0 : idx + 1));
  }, []);

  useEffect(() => {
    if (!autoPlay || lightboxOpen) return;
    const timer = window.setInterval(goNext, 6500);
    return () => window.clearInterval(timer);
  }, [autoPlay, lightboxOpen, goNext]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen, goPrev, goNext]);

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

      {/* Interactive Platform Preview Carousel */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <div>
            <span className="text-xs font-mono uppercase tracking-wider text-accent-dark font-semibold">
              Platform Tour
            </span>
            <h2 className="text-xl sm:text-2xl font-semibold text-ink mt-0.5">
              Interactive Analytical Capabilities
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="mono-tag">
              {String(activeSlide + 1).padStart(2, "0")} / {String(PREVIEW_SLIDES.length).padStart(2, "0")}
            </span>
            <button
              type="button"
              onClick={() => setAutoPlay((v) => !v)}
              title={autoPlay ? "Pause autoplay" : "Resume autoplay"}
              className="btn-secondary py-1.5 px-2.5 text-xs"
            >
              {autoPlay ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{autoPlay ? "Pause" : "Play"}</span>
            </button>
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              title="Expand full-screen preview"
              className="btn-secondary py-1.5 px-2.5 text-xs"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Expand</span>
            </button>
          </div>
        </div>

        <div
          className="panel overflow-hidden"
          onMouseEnter={() => setAutoPlay(false)}
          onMouseLeave={() => setAutoPlay(true)}
        >
          {/* Slide Viewport */}
          <div className="relative bg-canvas border-b border-border overflow-hidden aspect-[16/9] max-h-[560px] w-full flex items-center justify-center">
            {PREVIEW_SLIDES.map((slide, idx) => {
              const isCurrent = idx === activeSlide;
              return (
                <img
                  key={slide.id}
                  src={slide.src}
                  alt={slide.title}
                  loading={idx === 0 ? "eager" : "lazy"}
                  decoding="async"
                  onClick={() => setLightboxOpen(true)}
                  className={`absolute inset-0 w-full h-full object-contain cursor-zoom-in transition-opacity duration-300 ${
                    isCurrent ? "opacity-100 z-10" : "opacity-0 pointer-events-none z-0"
                  }`}
                />
              );
            })}

            {/* Left / Right Navigation Arrows */}
            <button
              type="button"
              onClick={goPrev}
              aria-label="Previous preview"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-sm bg-surface/90 hover:bg-surface border border-border hover:border-accent text-ink flex items-center justify-center shadow-md transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={goNext}
              aria-label="Next preview"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-sm bg-surface/90 hover:bg-surface border border-border hover:border-accent text-ink flex items-center justify-center shadow-md transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Active Slide Caption & Selector Pills */}
          <div className="p-5 sm:p-6 bg-surface space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div className="space-y-1.5">
                <span className="mono-tag border-accent text-accent-dark bg-accent-soft">
                  {PREVIEW_SLIDES[activeSlide].badge}
                </span>
                <h3 className="text-base sm:text-lg font-semibold text-ink">
                  {PREVIEW_SLIDES[activeSlide].title}
                </h3>
                <p className="text-sm text-muted leading-relaxed max-w-3xl">
                  {PREVIEW_SLIDES[activeSlide].description}
                </p>
              </div>
            </div>

            {/* Thumbnail / Step Selector Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2 border-t border-border">
              {PREVIEW_SLIDES.map((slide, idx) => {
                const isCurrent = idx === activeSlide;
                return (
                  <button
                    key={slide.id}
                    type="button"
                    onClick={() => setActiveSlide(idx)}
                    className={`text-left p-2 rounded-sm border transition-colors ${
                      isCurrent
                        ? "border-accent bg-accent-soft/60"
                        : "border-border bg-canvas hover:border-accent/60"
                    }`}
                  >
                    <div className="text-[10px] font-mono font-semibold text-accent-dark truncate">
                      {slide.badge}
                    </div>
                    <div className="text-xs font-medium text-ink truncate mt-0.5">
                      {slide.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Fullscreen Lightbox Modal for Active Preview */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          onClick={() => setLightboxOpen(false)}
        >
          <div
            className="relative max-w-6xl w-full panel bg-surface overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="mono-tag border-accent text-accent-dark bg-accent-soft shrink-0">
                  {PREVIEW_SLIDES[activeSlide].badge}
                </span>
                <span className="text-sm font-semibold text-ink truncate">
                  {PREVIEW_SLIDES[activeSlide].title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                aria-label="Close fullscreen preview"
                className="h-8 w-8 inline-flex items-center justify-center text-muted hover:text-ink border border-border rounded-sm hover:border-accent"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="relative bg-canvas flex items-center justify-center max-h-[75vh] overflow-hidden">
              <img
                src={PREVIEW_SLIDES[activeSlide].src}
                alt={PREVIEW_SLIDES[activeSlide].title}
                className="max-h-[75vh] w-auto object-contain"
              />
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous preview"
                className="absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-sm bg-surface/90 hover:bg-surface border border-border hover:border-accent text-ink flex items-center justify-center shadow-md"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next preview"
                className="absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-sm bg-surface/90 hover:bg-surface border border-border hover:border-accent text-ink flex items-center justify-center shadow-md"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-3.5 border-t border-border bg-surface text-xs sm:text-sm text-muted">
              {PREVIEW_SLIDES[activeSlide].description}
            </div>
          </div>
        </div>
      )}

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
