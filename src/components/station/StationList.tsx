"use client";

import { useState, useEffect } from "react";
import { ChevronLeft, ChevronRight, Ghost } from "lucide-react";
import StationRow from "./StationRow";
import GhostWatermark from "@/components/ghost/GhostWatermark";
import { cn } from "@/lib/utils";

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  lastDayEntries: number;
  dataStatus?: 'available' | 'missing' | 'zero';
}

interface StationListProps {
  stations: Station[];
  selectedStationId?: string;
  onStationSelect?: (station: Station) => void;
  dataAsOf?: string;
  className?: string;
}

export default function StationList({
  stations,
  selectedStationId,
  onStationSelect,
  dataAsOf,
  className,
}: StationListProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  // For now, showing top 25 ghost stations
  const topStations = stations.slice(0, 25);

  return (
    <div
      className={cn(
        "fixed left-6 top-24 bottom-6 z-40 transition-all duration-300",
        isCollapsed ? "w-14" : "w-96",
        className
      )}
    >
      <div className="h-full glass rounded-panel overflow-hidden flex flex-col relative">
        {/* Ghost Watermark */}
        <GhostWatermark opacity={0.02} />

        {/* Header */}
        <div className="relative p-6 pb-4 border-b border-neutral-border z-10">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute right-4 top-4 p-2 rounded-ui hover:bg-white/20 transition-colors"
          >
            {isCollapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>

          {!isCollapsed && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <Ghost className="w-5 h-5 text-spectral-600" />
                <h2 className="text-ui-lg font-display font-semibold">
                  Ghostiest Stations
                </h2>
              </div>
              <p className="text-ui-sm text-text-secondary">
                Chicago's emptiest CTA rail stops
              </p>
              {dataAsOf && (
                <p className="text-ui-xs text-text-tertiary mt-1">
                  Updated: {new Date(dataAsOf).toLocaleDateString()}
                </p>
              )}
            </>
          )}
        </div>

        {/* Station List */}
        {!isCollapsed && (
          <div className="flex-1 overflow-y-auto no-scrollbar">
            <div className="divide-y divide-neutral-border">
              {topStations.map((station, idx) => (
                <StationRow
                  key={station.id}
                  rank={idx + 1}
                  name={station.name}
                  lines={station.lines}
                  ghostScore={station.ghostScore}
                  dailyAverage={station.rolling30dAvg}
                  dataStatus={station.dataStatus}
                  selected={selectedStationId === station.id}
                  onClick={() => onStationSelect?.(station)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Collapsed State */}
        {isCollapsed && (
          <div className="flex-1 flex items-center justify-center">
            <Ghost className="w-6 h-6 text-ghost-glow animate-ghost-float" />
          </div>
        )}

        {/* Footer */}
        {!isCollapsed && (
          <div className="p-4 border-t border-neutral-border bg-white/30">
            <div className="text-center text-ui-xs text-text-secondary">
              Showing top 25 of {stations.length} stations
            </div>
          </div>
        )}
      </div>
    </div>
  );
}