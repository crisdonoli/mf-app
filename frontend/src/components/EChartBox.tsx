/** Responsive, theme-aware Apache ECharts container with ResizeObserver, click, dataZoom, and Ctrl+Scroll guard. */

import React, { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { useTheme } from "../context/ThemeContext";

interface EChartBoxProps {
  option: echarts.EChartsCoreOption;
  className?: string;
  style?: React.CSSProperties;
  onChartClick?: (params: Record<string, unknown>) => void;
  onDataZoom?: (startPct: number, endPct: number) => void;
  onReady?: (instance: echarts.ECharts | null) => void;
}

export const EChartBox: React.FC<EChartBoxProps> = ({
  option,
  className = "",
  style,
  onChartClick,
  onDataZoom,
  onReady,
}) => {
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const clickCbRef = useRef(onChartClick);
  const zoomCbRef = useRef(onDataZoom);
  const readyCbRef = useRef(onReady);
  const hintTimerRef = useRef<number | null>(null);
  const [showCtrlHint, setShowCtrlHint] = useState(false);

  clickCbRef.current = onChartClick;
  zoomCbRef.current = onDataZoom;
  readyCbRef.current = onReady;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, isDark ? "dark" : undefined, { renderer: "canvas" });
    instanceRef.current = chart;
    if (readyCbRef.current) readyCbRef.current(chart);

    // Block ECharts wheel zoom/roam unless Ctrl is held so normal page scrolling works smoothly
    const handleWheelCapture = (evt: WheelEvent) => {
      if (evt.ctrlKey) {
        // Prevent browser page zoom while allowing ECharts canvas to receive Ctrl+Wheel zoom
        evt.preventDefault();
        setShowCtrlHint(false);
        return;
      }
      // Stop event from reaching ECharts inner canvas so browser scrolls the page normally
      evt.stopPropagation();
      setShowCtrlHint(true);
      if (hintTimerRef.current) {
        window.clearTimeout(hintTimerRef.current);
      }
      hintTimerRef.current = window.setTimeout(() => {
        setShowCtrlHint(false);
      }, 1100);
    };

    el.addEventListener("wheel", handleWheelCapture, { capture: true, passive: false });

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
      el.removeEventListener("wheel", handleWheelCapture, { capture: true });
      if (hintTimerRef.current) {
        window.clearTimeout(hintTimerRef.current);
      }
      observer.disconnect();
      chart.dispose();
      instanceRef.current = null;
      if (readyCbRef.current) readyCbRef.current(null);
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

  return (
    <div className={`relative ${className}`} style={style}>
      <div ref={containerRef} className="w-full h-full" />
      {showCtrlHint && (
        <div className="pointer-events-none absolute top-2.5 right-2.5 z-20 px-2.5 py-1 rounded-sm bg-ink/80 text-surface text-[10px] font-mono shadow-sm transition-opacity">
          Hold Ctrl + Scroll to zoom chart
        </div>
      )}
    </div>
  );
};
