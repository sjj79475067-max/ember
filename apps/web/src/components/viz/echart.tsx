"use client";
import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart, GaugeChart, FunnelChart, HeatmapChart } from "echarts/charts";
import { GridComponent, TooltipComponent, LegendComponent, CalendarComponent, VisualMapComponent } from "echarts/components";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsCoreOption } from "echarts/core";

// 按需引入：只注册用到的图表类型，避免整包 ~360 kB
echarts.use([BarChart, LineChart, PieChart, GaugeChart, FunnelChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, CalendarComponent, VisualMapComponent, SVGRenderer]);

/** 读取 CSS 变量，让图表跟随明暗主题 */
export function themeColors() {
  if (typeof window === "undefined") return { fg: "#222", muted: "#888", line: "#e5e5e5", brand: "#d9622b", ok: "#2f9e6e", warn: "#d99a1e", danger: "#d64545", card: "#fff" };
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    fg: v("--color-fg", "#222"), muted: v("--color-muted", "#888"), line: v("--color-line", "#e5e5e5"),
    brand: v("--color-brand", "#d9622b"), ok: v("--color-ok", "#2f9e6e"), warn: v("--color-warn", "#d99a1e"),
    danger: v("--color-danger", "#d64545"), card: v("--color-card", "#fff"),
  };
}

export function EChart({ option, height = 220, className, onClick }: { option: EChartsCoreOption; height?: number; className?: string; onClick?: (p: unknown) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "svg", locale: "ZH" });
    inst.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); inst.current = null; };
  }, []);

  useEffect(() => {
    inst.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const c = inst.current;
    if (!c || !onClick) return;
    c.on("click", onClick);
    return () => { c.off("click", onClick); };
  }, [onClick]);

  return <div ref={ref} className={className} style={{ height, width: "100%" }} />;
}