"use client";

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

interface RidershipDataPoint {
  date: string;
  entries: number;
}

interface RidershipChartProps {
  data: RidershipDataPoint[];
  isLoading?: boolean;
}

export default function RidershipChart({
  data,
  isLoading,
}: RidershipChartProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // Theme-aware colors for chart
  const tickColor = isDark ? "rgba(255, 255, 255, 0.5)" : "rgba(11, 18, 32, 0.52)";
  const axisLineColor = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(11, 18, 32, 0.08)";

  if (isLoading) {
    return (
      <div className="glass-solid rounded-ui p-4 h-48 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-brandIndigo/30 border-t-brandIndigo animate-spin" />
      </div>
    );
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
    <div className="glass-solid rounded-ui p-4 h-48">
      <ResponsiveContainer width="100%" height="100%">
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
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
