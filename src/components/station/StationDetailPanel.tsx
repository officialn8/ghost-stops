"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { X, TrendingDown, Users, Calendar, Ghost } from "lucide-react";
import CTALineBadge from "./CTALineBadge";
import GhostScoreGauge from "@/components/ghost/GhostScoreGauge";
import RidershipChart from "./RidershipChart";
import StationDetailSkeleton from "./StationDetailSkeleton";
import { cn } from "@/lib/utils";
import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";
import { panelVariants, panelItemVariants } from "@/lib/motion/tokens";

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  lastDayEntries: number;
  dataStatus?: "available" | "missing" | "zero";
}

interface StationDetail {
  station: Station;
  ridershipSeries: { date: string; entries: number }[];
  metrics: {
    ghostScore: number;
    percentile: number;
    systemAverage: number;
    explanation: string;
  };
}

interface StationDetailPanelProps {
  station: Station;
  onClose?: () => void;
  className?: string;
}

export default function StationDetailPanel({
  station,
  onClose,
  className,
}: StationDetailPanelProps) {
  const [detail, setDetail] = useState<StationDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Normalize station lines for consistent rendering
  const { lines: normalizedLines, cleanName } = useMemo(() => {
    return normalizeStationLines(station);
  }, [station]);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/chicago/stations/${station.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.station) {
          setDetail(data);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load station details:", err);
        setLoading(false);
      });
  }, [station.id]);

  return (
    <motion.div
      className={cn("fixed right-6 top-24 bottom-6 z-40 w-[420px]", className)}
      variants={panelVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="h-full glass-panel rounded-panel flex flex-col">
        {/* Header */}
        <motion.div className="relative" variants={panelItemVariants}>
          {/* Ghost watermark */}
          <div className="absolute top-4 right-4 opacity-5 pointer-events-none">
            <Ghost className="w-24 h-24" />
          </div>

          <div className="p-6 pb-4">
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-2 rounded-ui hover:bg-white/20 transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>

            <h2 className="text-display-3 font-display font-semibold text-text-primary pr-12">
              {cleanName || station.name}
            </h2>

            <div className="flex flex-wrap gap-2 mt-3">
              {normalizedLines.map((line) => (
                <CTALineBadge key={line} line={line} size="md" />
              ))}
            </div>
          </div>
        </motion.div>

        {loading ? (
          <StationDetailSkeleton />
        ) : detail ? (
          <motion.div
            className="flex-1 overflow-y-auto station-list-scroll"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: { opacity: 1 },
              visible: {
                opacity: 1,
                transition: {
                  staggerChildren: 0.04,
                  delayChildren: 0.05,
                },
              },
            }}
          >
            {/* Ghost Score Gauge */}
            <motion.div variants={panelItemVariants} className="px-6 mb-6">
              <GhostScoreGauge
                score={station.ghostScore}
                dataStatus={station.dataStatus}
              />
            </motion.div>

            {/* Key Metrics */}
            <motion.div variants={panelItemVariants} className="px-6 mb-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-solid rounded-ui p-4">
                  <div className="flex items-center gap-2 text-text-tertiary mb-1">
                    <Users className="w-4 h-4" />
                    <span className="text-ui-xs">30-Day Average</span>
                  </div>
                  <div className="stat-value-text text-ui-xl">
                    {station.dataStatus === "missing"
                      ? "—"
                      : Math.round(station.rolling30dAvg).toLocaleString()}
                  </div>
                </div>

                <div className="glass-solid rounded-ui p-4">
                  <div className="flex items-center gap-2 text-text-tertiary mb-1">
                    <Calendar className="w-4 h-4" />
                    <span className="text-ui-xs">Yesterday</span>
                  </div>
                  <div className="stat-value-text text-ui-xl">
                    {station.dataStatus === "missing"
                      ? "—"
                      : station.lastDayEntries.toLocaleString()}
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Ghost Analysis */}
            <motion.div variants={panelItemVariants} className="px-6 mb-6">
              <div className="glass-solid rounded-ui p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brandIndigo/20 to-emerald-500/20 flex items-center justify-center">
                    <Ghost className="w-4 h-4 text-brandIndigo" />
                  </div>
                  <h3 className="font-display font-semibold text-ui-md">
                    Why is this a ghost stop?
                  </h3>
                </div>
                <p className="text-ui-sm text-text-secondary leading-relaxed mb-3">
                  {detail.metrics.explanation}
                </p>
                <div className="flex items-center gap-2 text-ui-xs text-text-tertiary">
                  <TrendingDown className="w-3 h-3" />
                  <span>
                    Bottom {100 - detail.metrics.percentile}% of all CTA
                    stations
                  </span>
                </div>
              </div>
            </motion.div>

            {/* Ridership Trend Chart */}
            <motion.div variants={panelItemVariants} className="px-6 mb-6">
              <h3 className="font-display font-semibold text-ui-md mb-3">
                90-Day Ridership Trend
              </h3>
              <RidershipChart
                data={detail.ridershipSeries}
                isLoading={false}
              />
            </motion.div>

            {/* Station Info */}
            <motion.div variants={panelItemVariants} className="px-6 pb-6">
              <div className="text-ui-xs text-text-tertiary">
                <p>Station ID: {station.id}</p>
                <p>
                  Coordinates: {station.latitude.toFixed(4)},{" "}
                  {station.longitude.toFixed(4)}
                </p>
              </div>
            </motion.div>
          </motion.div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-text-secondary">Failed to load station details</p>
          </div>
        )}
      </div>
    </motion.div>
  );
}
