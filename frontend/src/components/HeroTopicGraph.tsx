/** Dynamic animated macroeconomic topic network graph for the Landing Page hero. */

import React, { useEffect, useMemo, useState } from "react";

interface GraphNode {
  id: string;
  label: string;
  x: number;
  y: number;
  r: number;
}

const NODES: GraphNode[] = [
  { id: "monetary_policy", label: "Monetary Policy", x: 185, y: 155, r: 9 },
  { id: "inflation", label: "Inflation", x: 92, y: 78, r: 7.5 },
  { id: "growth", label: "Growth", x: 278, y: 82, r: 7.5 },
  { id: "labor_market", label: "Labor Market", x: 64, y: 182, r: 7 },
  { id: "financial_conditions", label: "Fin. Conditions", x: 302, y: 196, r: 7.5 },
  { id: "communication", label: "Guidance", x: 184, y: 42, r: 6.5 },
  { id: "operations", label: "Balance Sheet", x: 112, y: 266, r: 6.5 },
  { id: "fiscal", label: "Fiscal", x: 262, y: 274, r: 6 },
  { id: "fx_international", label: "FX / Intl", x: 334, y: 130, r: 5.5 },
  { id: "monetary_aggregates", label: "Aggregates", x: 42, y: 122, r: 5.5 },
  { id: "rate_decision", label: "Rates", x: 186, y: 244, r: 5.5 },
];

const EDGES: [number, number][] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [0, 6],
  [0, 10],
  [1, 3],
  [1, 5],
  [1, 9],
  [2, 5],
  [2, 4],
  [2, 8],
  [3, 6],
  [3, 9],
  [4, 7],
  [4, 8],
  [4, 10],
  [6, 10],
  [7, 10],
  [2, 7],
];

export const HeroTopicGraph: React.FC = () => {
  const [activeSet, setActiveSet] = useState<Set<number>>(() => new Set([0, 1, 4]));
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Smoothly cycle active clusters of nodes on and off
  useEffect(() => {
    const sequences: number[][] = [
      [0, 1, 5],
      [0, 2, 4, 8],
      [1, 3, 9],
      [0, 6, 10, 4],
      [2, 7, 10],
      [0, 1, 2, 3],
      [4, 5, 8],
      [0, 3, 6, 10],
    ];
    let step = 0;
    const timer = window.setInterval(() => {
      step = (step + 1) % sequences.length;
      setActiveSet(new Set(sequences[step]));
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  const highlightedNodes = useMemo(() => {
    const next = new Set(activeSet);
    if (hoveredIdx !== null) {
      next.add(hoveredIdx);
      for (const [a, b] of EDGES) {
        if (a === hoveredIdx) next.add(b);
        if (b === hoveredIdx) next.add(a);
      }
    }
    return next;
  }, [activeSet, hoveredIdx]);

  return (
    <div
      className="relative w-full h-full min-h-[260px] flex items-center justify-center select-none"
      aria-label="Dynamic FOMC Macroeconomic Topic Network"
    >
      <svg
        viewBox="0 0 380 315"
        className="w-full max-w-[390px] h-auto overflow-visible"
        role="img"
      >
        <defs>
          <radialGradient id="heroNodeGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(var(--color-accent))" stopOpacity="0.55" />
            <stop offset="100%" stopColor="rgb(var(--color-accent))" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Edges */}
        {EDGES.map(([i, j], edgeIdx) => {
          const n1 = NODES[i];
          const n2 = NODES[j];
          const bothLit = highlightedNodes.has(i) && highlightedNodes.has(j);
          const oneLit = highlightedNodes.has(i) || highlightedNodes.has(j);
          return (
            <line
              key={edgeIdx}
              x1={n1.x}
              y1={n1.y}
              x2={n2.x}
              y2={n2.y}
              stroke={
                bothLit
                  ? "rgb(var(--color-accent))"
                  : "rgb(var(--color-muted))"
              }
              strokeOpacity={bothLit ? 0.85 : oneLit ? 0.32 : 0.14}
              strokeWidth={bothLit ? 1.7 : 1}
              style={{
                transition: "stroke-opacity 700ms ease, stroke 700ms ease, stroke-width 700ms ease",
              }}
            />
          );
        })}

        {/* Nodes */}
        {NODES.map((node, idx) => {
          const isLit = highlightedNodes.has(idx);
          const isHovered = hoveredIdx === idx;
          return (
            <g
              key={node.id}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className="cursor-pointer"
            >
              {/* Outer pulsing halo when node is lit */}
              <circle
                cx={node.x}
                cy={node.y}
                r={isLit ? node.r * 3.1 : node.r * 1.4}
                fill="url(#heroNodeGlow)"
                opacity={isLit ? 1 : 0}
                style={{
                  transition: "r 700ms ease, opacity 700ms ease",
                }}
              />

              {/* Subtle ring */}
              <circle
                cx={node.x}
                cy={node.y}
                r={isLit ? node.r + 3.5 : node.r + 1.5}
                fill="none"
                stroke="rgb(var(--color-accent))"
                strokeWidth={1}
                strokeOpacity={isLit ? 0.55 : 0.15}
                style={{
                  transition: "r 700ms ease, stroke-opacity 700ms ease",
                }}
              />

              {/* Core dot */}
              <circle
                cx={node.x}
                cy={node.y}
                r={isHovered ? node.r + 1.5 : node.r}
                fill={isLit ? "rgb(var(--color-accent))" : "rgb(var(--color-surface))"}
                stroke={isLit ? "rgb(var(--color-accent-dark))" : "rgb(var(--color-muted))"}
                strokeWidth={1.6}
                strokeOpacity={isLit ? 1 : 0.55}
                style={{
                  transition: "fill 600ms ease, stroke 600ms ease, r 300ms ease",
                }}
              />

              {/* Label */}
              <text
                x={node.x}
                y={node.y + node.r + 14}
                textAnchor="middle"
                fontSize="9.5"
                fontFamily="JetBrains Mono, ui-monospace, monospace"
                fill={isLit ? "rgb(var(--color-ink))" : "rgb(var(--color-muted))"}
                opacity={isLit ? 0.95 : 0.48}
                fontWeight={isLit ? 600 : 400}
                style={{
                  transition: "opacity 600ms ease, fill 600ms ease",
                }}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
