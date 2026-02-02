"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showTrend?: boolean;
  className?: string;
}

export default function Sparkline({
  data,
  width = 56,
  height = 24,
  color = "#6366f1",
  showTrend = false,
  className,
}: SparklineProps) {
  const { points, trend } = useMemo(() => {
    if (!data || data.length === 0) {
      return { points: "", trend: "flat" as const };
    }

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    // Padding for the line
    const padding = 2;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // Generate SVG polyline points
    const pts = data
      .map((value, i) => {
        const x = padding + (i / (data.length - 1)) * chartWidth;
        const y = padding + chartHeight - ((value - min) / range) * chartHeight;
        return `${x},${y}`;
      })
      .join(" ");

    // Calculate trend
    const first = data[0];
    const last = data[data.length - 1];
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    const t = pct > 5 ? "up" : pct < -5 ? "down" : "flat";

    return { points: pts, trend: t };
  }, [data, width, height]);

  if (!data || data.length < 2) {
    return (
      <div
        className={cn("flex items-center justify-center text-text-tertiary", className)}
        style={{ width, height }}
      >
        <Minus className="w-4 h-4" />
      </div>
    );
  }

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="overflow-visible"
      >
        {/* Gradient fill under the line */}
        <defs>
          <linearGradient id={`sparkline-gradient-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <polygon
          points={`2,${height - 2} ${points} ${width - 2},${height - 2}`}
          fill={`url(#sparkline-gradient-${color.replace("#", "")})`}
        />

        {/* Line */}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-all duration-300"
        />

        {/* End dot */}
        <circle
          cx={width - 2}
          cy={points.split(" ").pop()?.split(",")[1] || height / 2}
          r={2}
          fill={color}
        />
      </svg>

      {showTrend && (
        <div
          className={cn(
            "flex items-center text-ui-xs font-mono",
            trend === "up" && "text-emerald-500",
            trend === "down" && "text-red-500",
            trend === "flat" && "text-text-tertiary"
          )}
        >
          {trend === "up" && <TrendingUp className="w-3 h-3" />}
          {trend === "down" && <TrendingDown className="w-3 h-3" />}
          {trend === "flat" && <Minus className="w-3 h-3" />}
        </div>
      )}
    </div>
  );
}
