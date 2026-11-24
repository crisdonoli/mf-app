/** Public Team Page (/team) — MiningFOMC Research & Engineering Team. */

import React from "react";
import { ExternalLink, GraduationCap, Users } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
import carlosImg from "../static/carlos.webp";
import cristobalImg from "../static/cristobal.webp";
import fenDarkLogo from "../static/fen-dark.webp";
import fenLightLogo from "../static/fen-light.webp";
import humbertoImg from "../static/humberto.webp";

interface TeamMember {
  name: string;
  role: string;
  affiliation: string;
  summary: string;
  photo: string;
  profileUrl: string;
  profileLabel: string;
}

const TEAM_MEMBERS: TeamMember[] = [
  {
    name: "Humberto Martínez",
    role: "Principal Investigator / Researcher",
    affiliation: "Monetary Economics & Text-as-Data Research",
    summary:
      "Co-leads the conceptual methodology, zero-shot classification evaluation, and cross-document empirical analysis of Federal Reserve deliberations.",
    photo: humbertoImg,
    profileUrl: "https://www.humbertomartinezb.com/",
    profileLabel: "Website / Profile",
  },
  {
    name: "Carlos Rondón",
    role: "Principal Investigator / Researcher",
    affiliation: "Central Bank of Chile · Economic Research",
    summary:
      "Co-leads the macroeconomic research agenda, monetary policy taxonomy design, and historical FOMC empirical framework behind MiningFOMC.",
    photo: carlosImg,
    profileUrl: "https://www.bcentral.cl/en/web/banco-central/investigators/carlos-rondon",
    profileLabel: "Website / Profile",
  },
  {
    name: "Cristóbal Donoso-Oliva",
    role: "Lead Developer & Research Assistant",
    affiliation: "Ph.D. Student in Economics (FEN, Universidad de Chile)",
    summary:
      "Architects and develops the MiningFOMC full-stack analytical platform, Machine/Deep Learning Pipeline for Classification, and Text as Data Economics.",
    photo: cristobalImg,
    profileUrl:
      "https://crisdonoli.com/",
    profileLabel: "Website / Profile",
  }
];

export const TeamPage: React.FC = () => {
  const { isDark } = useTheme();

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-16">
      {/* Header Banner */}
      <section className="panel p-8 sm:p-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2.5 max-w-2xl">
          <div className="inline-flex items-center gap-2">
            <span className="mono-tag border-accent text-accent-dark bg-accent-soft">
              <Users className="w-3 h-3 mr-1" />
              RESEARCH &amp; ENGINEERING TEAM
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
            The Team Behind MiningFOMC
          </h1>
          <p className="text-sm sm:text-base text-muted leading-relaxed">
            MiningFOMC is an academic research platform combining natural language processing,
            out-of-core data engineering, and macroeconomic analysis to study four decades of
            Federal Open Market Committee deliberations (1976–2020).
          </p>
        </div>

        <div className="shrink-0 flex flex-col items-start md:items-end gap-2 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-6">
          <img
            src={isDark ? fenDarkLogo : fenLightLogo}
            alt="FEN — Facultad de Economía y Negocios, Universidad de Chile"
            className="h-12 w-auto object-contain"
          />
          <span className="text-[11px] font-mono text-muted flex items-center gap-1.5">
            <GraduationCap className="w-3.5 h-3.5 text-accent" />
            FEN · Universidad de Chile
          </span>
        </div>
      </section>

      {/* Team Member Profile Grid */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {TEAM_MEMBERS.map((member) => (
          <article
            key={member.name}
            className="panel overflow-hidden flex flex-col justify-between transition-colors hover:border-accent"
          >
            <div>
              <div className="aspect-[4/4] w-full bg-canvas border-b border-border overflow-hidden">
                <img
                  src={member.photo}
                  alt={member.name}
                  className="w-full h-full object-cover object-top"
                />
              </div>

              <div className="p-6 space-y-2.5">
                <div>
                  <h2 className="text-lg font-bold text-ink">{member.name}</h2>
                  <p className="text-xs font-mono font-semibold text-accent-dark mt-0.5">
                    {member.role}
                  </p>
                  <p className="text-xs font-mono text-muted mt-0.5">{member.affiliation}</p>
                </div>

                <p className="text-sm text-muted leading-relaxed pt-1">{member.summary}</p>
              </div>
            </div>

            <div className="px-6 pb-6 pt-2">
              <a
                href={member.profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary w-full text-xs"
              >
                <ExternalLink className="w-3.5 h-3.5 text-accent" />
                {member.profileLabel}
              </a>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
};
