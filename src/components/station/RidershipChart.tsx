"use client";

import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { useTheme } from "@/components/theme";
import { Skeleton } from "@/components/ui/Skeleton";

interface RidershipDataPoint {
  date: string;
  entries: number;
}

interface RidershipChartProps {
  data: RidershipDataPoint[];
  isLoading?: boolean;
}

// Premium chart skeleton component
function ChartSkeleton() {
  return (
    <div className="glass-solid rounded-ui p-4 h-48 relative overflow-hidden">
      {/* Chart area skeleton with wave pattern */}
      <div className="absolute bottom-8 left-10 right-4 h-24">
        <div className="relative h-full">
          {/* Simulated chart line skeleton */}
          <svg className="w-full h-full" viewBox="0 0 300 100" preserveAspectRatio="none">
            <path
              d="M0,80 Q30,60 60,65 T120,55 T180,70 T240,50 T300,60 L300,100 L0,100 Z"
              fill="url(#skeleton-gradient)"
              className="animate-pulse"
            />
            <defs>
              <linearGradient id="skeleton-gradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(79, 18, 113, 0.15)" />
                <stop offset="100%" stopColor="rgba(79, 18, 113, 0.03)" />
              </linearGradient>
            </defs>
          </svg>
        </div>
      </div>
      {/* X-axis skeleton */}
      <div className="absolute bottom-2 left-10 right-4 flex justify-between">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
      </div>
      {/* Y-axis skeleton */}
      <div className="absolute top-4 bottom-8 left-0 flex flex-col justify-between">
        <Skeleton className="h-3 w-6" />
        <Skeleton className="h-3 w-8" />
        <Skeleton className="h-3 w-6" />
      </div>
    </div>
  );
}

export default function RidershipChart({
  data,
  isLoading,
}: RidershipChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isAnimated, setIsAnimated] = useState(false);

  // Trigger animation after mount
  useEffect(() => {
    if (!isLoading && data?.length > 0) {
      const timer = setTimeout(() => setIsAnimated(true), 100);
      return () => clearTimeout(timer);
    }
  }, [isLoading, data]);

  // Theme-aware colors for chart
  const tickColor = isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(11, 18, 32, 0.52)";
  const axisLineColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(11, 18, 32, 0.08)";

  if (isLoading) {
    return <ChartSkeleton />;
  }

  if (!data || data.length === 0) {
    return (
      <div className="glass-solid rounded-ui p-4 h-48 flex items-center justify-center">
        <p className="text-ui-sm text-text-tertiary">
          No ridership data available
        </p>
      </div>
    );
  }

  // Deduplicate and format data for chart (API returns duplicates)
  const seenDates = new Set<string>();
  const chartData = data
    .filter((d) => {
      if (seenDates.has(d.date)) return false;
      seenDates.add(d.date);
      return true;
    })
    .map((d) => ({
      date: d.date,
      entries: d.entries,
      formattedDate: format(parseISO(d.date), "MMM d"),
    }));

  return (
    <div className="glass-solid rounded-ui p-4">
      <ResponsiveContainer width="100%" height={160} minWidth={200}>
        <AreaChart
          data={chartData}
          margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id="ridershipGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F1271" stopOpacity={0.3} />
              <stop offset="100%" stopColor="#4F1271" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          <XAxis
            dataKey="formattedDate"
            tick={{ fontSize: 10, fill: tickColor }}
            axisLine={{ stroke: axisLineColor }}
            tickLine={false}
            interval="preserveStartEnd"
          />

          <YAxis
            tick={{ fontSize: 10, fill: tickColor }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(value) =>
              value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value
            }
            width={35}
          />

          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const dataPoint = payload[0].payload as {
                date: string;
                entries: number;
              };
              return (
                <div className="glass-solid rounded-ui px-3 py-2 shadow-md">
                  <p className="text-ui-xs text-text-tertiary">
                    {format(parseISO(dataPoint.date), "MMM d, yyyy")}
                  </p>
                  <p className="stat-value-text text-lg text-text-primary">
                    {dataPoint.entries.toLocaleString()}
                  </p>
                  <p className="text-ui-xs text-text-tertiary">entries</p>
                </div>
              );
            }}
          />

          <Area
            type="monotone"
            dataKey="entries"
            stroke="#4F1271"
            strokeWidth={2}
            fill="url(#ridershipGradient)"
            isAnimationActive={true}
            animationDuration={1200}
            animationEasing="ease-out"
            animationBegin={isAnimated ? 0 : 300}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
