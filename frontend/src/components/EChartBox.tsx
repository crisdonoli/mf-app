/** Responsive, theme-aware Apache ECharts container with ResizeObserver, click, and dataZoom handling. */

import React, { useEffect, useRef } from "react";
import * as echarts from "echarts";
import { useTheme } from "../context/ThemeContext";

interface EChartBoxProps {
  option: echarts.EChartsCoreOption;
  className?: string;
  style?: React.CSSProperties;
  onChartClick?: (params: Record<string, unknown>) => void;
  onDataZoom?: (startPct: number, endPct: number) => void;
}

export const EChartBox: React.FC<EChartBoxProps> = ({
  option,
  className = "",
  style,
  onChartClick,
  onDataZoom,
}) => {
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const clickCbRef = useRef(onChartClick);
  const zoomCbRef = useRef(onDataZoom);

  clickCbRef.current = onChartClick;
  zoomCbRef.current = onDataZoom;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, isDark ? "dark" : undefined, { renderer: "canvas" });
    instanceRef.current = chart;

    chart.on("click", (params: unknown) => {
      if (clickCbRef.current && params && typeof params === "object") {
        clickCbRef.current(params as Record<string, unknown>);
      }
    });

    chart.on("datazoom", (evt: unknown) => {
      if (!zoomCbRef.current || !evt || typeof evt !== "object") return;
      const e = evt as {
        start?: number;
        end?: number;
        batch?: Array<{ start?: number; end?: number }>;
      };
      const first = Array.isArray(e.batch) && e.batch.length > 0 ? e.batch[0] : e;
      if (typeof first.start === "number" && typeof first.end === "number") {
        zoomCbRef.current(first.start, first.end);
      }
    });

    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
      chart.dispose();
      instanceRef.current = null;
    };
  }, [isDark]);

  useEffect(() => {
    if (!instanceRef.current) return;
    const themedOption: echarts.EChartsCoreOption = {
      backgroundColor: "transparent",
      ...option,
    };
    instanceRef.current.setOption(themedOption, { notMerge: true });
  }, [option, isDark]);

  return <div ref={containerRef} className={className} style={style} />;
};
