import { animated, useSpring } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import { useState, useEffect, useRef } from 'react';
import Map from 'react-map-gl/mapbox';
import { ChevronDown, Share, Navigation, BarChart3, Ghost, TrendingDown, TrendingUp, Users, MapPin } from 'lucide-react';
import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";
import { CTALine, CTA_LINE_COLORS } from "@/lib/cta/explodeAndStitchSegments";
import RidershipChart from "@/components/station/RidershipChart";
import { StationComparison } from "@/components/comparison/ComparisonBars";
import GhostScoreGauge from "@/components/ghost/GhostScoreGauge";
import NeighborPills from "@/components/station/NeighborPills";
import { StationStory } from "@/components/narrative";
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { clampGhostScore, normalizeDataStatus } from "@/lib/utils";
import { useTheme } from '@/components/theme';
import type { FactMap, StationNarrativeData, DataSourceInfo } from "@/types/narrative";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  trend: number | null;
  dataStatus?: 'available' | 'missing' | 'zero';
}

interface NeighborStation {
  id: string;
  name: string;
  rolling30dAvg: number;
  ghostScore: number;
}

interface Comparisons {
  systemMedian: number;
  primaryLine: string | null;
  lineMedian: number;
  neighbors: {
    prev: NeighborStation | null;
    next: NeighborStation | null;
    neighborAvg: number;
  };
  vsSystemMedian: number;
  vsLineMedian: number;
  vsNeighbors: number;
}

interface Metrics {
  ghostScore: number;
  percentile: number;
  systemAverage: number;
  systemMedian?: number;
  explanation: string;
}

interface MobileStationDetailProps {
  station: Station | null;
  isOpen: boolean;
  onClose: () => void;
  ridershipData?: { date: string; entries: number }[];
  comparisons?: Comparisons;
  metrics?: Metrics;
  onStationSelect?: (stationId: string) => void;
  // Facts + Narrative system
  facts?: FactMap | null;
  narrative?: StationNarrativeData | null;
  sources?: DataSourceInfo[] | null;
}

export default function MobileStationDetail({
  station,
  isOpen,
  onClose,
  ridershipData,
  comparisons,
  metrics,
  onStationSelect,
  facts,
  narrative,
  sources
}: MobileStationDetailProps) {
  const haptic = useHapticFeedback();
  const { theme } = useTheme();
  const [isSharing, setIsSharing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Use centralized body scroll lock - only when actually visible
  useBodyScrollLock('station-detail', isOpen && !!station && shouldRender);

  const [{ y }, api] = useSpring(() => ({
    y: 100, // Start off-screen (100% down)
    config: { tension: 300, friction: 30 }
  }));

  // Handle opening - separate effect without shouldRender dependency
  useEffect(() => {
    if (isOpen && station) {
      setShouldRender(true);
      setIsLoading(!metrics && !comparisons);
      // Animate in after render
      requestAnimationFrame(() => {
        api.start({ y: 0 });
      });
    }
  }, [isOpen, station, api, metrics, comparisons]);

  // Handle closing - separate effect
  useEffect(() => {
    if (!isOpen && shouldRender) {
      // Animate out, then stop rendering
      api.start({ 
        y: 100,
        onRest: () => {
          setShouldRender(false);
        }
      });
    }
  }, [isOpen, shouldRender, api]);

  // Update loading state when data arrives
  useEffect(() => {
    if (metrics || comparisons) {
      setIsLoading(false);
    }
  }, [metrics, comparisons]);

  const bind = useDrag(
    ({ down, movement: [, my], last, first, velocity: [, vy], memo }) => {
      // On first touch, check if we're at the top of scroll
      if (first) {
        const scrollTop = scrollContainerRef.current?.scrollTop ?? 0;
        memo = scrollTop === 0; // true = can drag to close
      }
      
      // Only allow drag-to-close if we started at scroll top
      if (!memo) return memo;
      
      // Convert pixel movement to percentage of screen
      const screenHeight = window.innerHeight;
      const percentMoved = (my / screenHeight) * 100;
      
      if (last) {
        // Close if dragged down more than 15% or with velocity
        if (percentMoved > 15 || (percentMoved > 5 && vy > 0.5)) {
          haptic.impact('light');
          onClose();
        } else {
          api.start({ y: 0 });
        }
      } else if (!down) {
        api.start({ y: 0 });
      } else {
        api.start({ y: Math.max(0, percentMoved), immediate: true });
      }
      
      return memo;
    },
    {
      from: () => [0, 0],
      filterTaps: true,
      axis: 'y',
      bounds: { top: 0 },
      threshold: 10,
    }
  );

  // Don't render if not needed
  if (!station || !shouldRender) return null;

  const { lines } = normalizeStationLines({ lines: station.lines });
  const resolvedStatus = normalizeDataStatus(station.dataStatus);
  const safeScore = clampGhostScore(station.ghostScore);
  const showData = resolvedStatus !== "missing";
  const scoreLabel = showData ? safeScore.toFixed(0) : "—";
  const avgLabel = showData && station.rolling30dAvg != null
    ? station.rolling30dAvg.toFixed(0)
    : "—";

  const handleShare = async () => {
    setIsSharing(true);
    haptic.impact('medium');

    const shareData = {
      title: `${station.name} Station`,
      text: showData
        ? `Ghost Score: ${safeScore.toFixed(0)} | Daily Average: ${avgLabel} riders`
        : "Ghost Score: No data available",
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        // Fallback to copy to clipboard
        await navigator.clipboard.writeText(
          `${shareData.title}\n${shareData.text}\n${shareData.url}`
        );
        haptic.notification('success');
      }
    } catch (error) {
      // Ignore AbortError (user canceled share dialog)
      if (error instanceof Error && error.name === 'AbortError') {
        // User canceled - this is normal, not an error
        return;
      }
      // Log other actual errors
      console.error('Share failed:', error);
    } finally {
      setIsSharing(false);
    }
  };

  const handleNavigate = () => {
    haptic.impact('medium');
    if (!station) return;

    const coords = `${station.latitude},${station.longitude}`;
    const encodedName = encodeURIComponent(station.name);
    
    // Use Google Maps URL which works universally on web and mobile
    // On mobile devices, this will open the Google Maps app if installed
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords}&query_place_id=${encodedName}`;
    
    // Alternative: Apple Maps URL for iOS (opens in browser or Maps app)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    if (isIOS) {
      // Apple Maps URL - works in browser and opens Maps app on iOS
      window.open(`https://maps.apple.com/?q=${encodedName}&ll=${coords}`, '_blank');
    } else {
      // Google Maps URL - works everywhere
      window.open(googleMapsUrl, '_blank');
    }
  };

  return (
    <animated.div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'hsl(var(--background))',
        transform: y.to(yPercent => `translateY(${yPercent}%)`),
      }}
      className="mobile-station-detail"
    >
      {/* Map Preview - 30% height, draggable to dismiss */}
      <div {...bind()} className="h-[30vh] relative overflow-hidden" style={{ touchAction: 'none' }}>
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            longitude: station.longitude,
            latitude: station.latitude,
            zoom: 16
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={theme === "dark" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11"}
          interactive={false}
          attributionControl={false}
        >
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ pointerEvents: 'none' }}
          >
            <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">{scoreLabel}</span>
            </div>
          </div>
        </Map>

        {/* Gradient overlay at bottom to fade out any remaining UI elements */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white dark:from-gray-900 to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 w-10 h-10 bg-background/90 backdrop-blur rounded-full flex items-center justify-center shadow-lg"
        >
          <ChevronDown className="w-6 h-6 text-foreground" />
        </button>

        {/* Drag Indicator */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-white/50 rounded-full" />
      </div>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-5">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">{station.name}</h1>
            <div className="flex gap-2 mt-2">
              {lines.map((line) => (
                <span
                  key={line}
                  className="px-3 py-1 rounded-full text-sm text-white font-semibold"
                  style={{ backgroundColor: CTA_LINE_COLORS[line as CTALine] }}
                >
                  {line} Line
                </span>
              ))}
            </div>
          </div>

          {/* Ghost Score Gauge */}
          <div className="bg-muted rounded-lg p-4">
            {isLoading ? (
              <div className="h-40 flex items-center justify-center">
                <div className="animate-pulse w-32 h-32 rounded-full bg-muted-foreground/20" />
              </div>
            ) : (
              <GhostScoreGauge
                score={station.ghostScore}
                dataStatus={station.dataStatus}
                className="scale-90"
              />
            )}
          </div>

          {/* Key Metrics */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Users className="w-4 h-4" />
                <span className="text-xs font-medium">30-Day Average</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {station.dataStatus === "missing"
                  ? "—"
                  : Math.round(station.rolling30dAvg).toLocaleString()}
              </div>
            </div>
            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                {station.trend != null && station.trend >= 0 ? (
                  <TrendingUp className="w-4 h-4" />
                ) : (
                  <TrendingDown className="w-4 h-4" />
                )}
                <span className="text-xs font-medium">30-Day Trend</span>
              </div>
              <div className="text-2xl font-bold text-foreground">
                {station.dataStatus === "missing" || station.trend == null
                  ? "—"
                  : `${station.trend >= 0 ? "+" : ""}${station.trend.toFixed(1)}%`}
              </div>
            </div>
          </div>

          {/* Ghost Analysis */}
          {isLoading ? (
            <div className="bg-muted rounded-lg p-4">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-muted-foreground/20 rounded w-3/4" />
                <div className="h-4 bg-muted-foreground/20 rounded" />
                <div className="h-4 bg-muted-foreground/20 rounded w-5/6" />
              </div>
            </div>
          ) : metrics ? (
            <div className="bg-muted/50 backdrop-blur-sm rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-full bg-white/80 flex items-center justify-center">
                  <Ghost className="w-4 h-4 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-foreground">
                  Why is this a ghost stop?
                </h3>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed mb-3">
                {metrics.explanation}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingDown className="w-3 h-3" />
                <span>
                  {metrics.percentile <= 50
                    ? `Bottom ${metrics.percentile || 1}% of all CTA stations`
                    : `Top ${100 - metrics.percentile}% of all CTA stations`}
                </span>
              </div>
            </div>
          ) : null}

          {/* How It Compares */}
          {comparisons && (
            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center">
                  <BarChart3 className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="font-semibold text-foreground">
                  How It Compares
                </h3>
              </div>
              <StationComparison
                stationAvg={station.rolling30dAvg || 0}
                systemMedian={comparisons.systemMedian}
                lineMedian={comparisons.lineMedian}
                neighborAvg={comparisons.neighbors.neighborAvg}
                primaryLine={comparisons.primaryLine}
                vsSystemMedian={comparisons.vsSystemMedian}
                vsLineMedian={comparisons.vsLineMedian}
                vsNeighbors={comparisons.vsNeighbors}
              />
            </div>
          )}

          {/* Story & Evidence */}
          {narrative && (
            <StationStory
              narrative={narrative}
              facts={facts ?? null}
              sources={sources ?? null}
              className="bg-muted"
            />
          )}

          {/* Neighbor Stations */}
          {comparisons && (comparisons.neighbors.prev || comparisons.neighbors.next) && (
            <div className="space-y-2">
              <div className="px-1">
                <span className="text-xs text-muted-foreground font-medium">
                  Nearby on {comparisons.primaryLine}
                </span>
              </div>
              <NeighborPills
                primaryLine={comparisons.primaryLine}
                prevStation={comparisons.neighbors.prev}
                nextStation={comparisons.neighbors.next}
                onStationClick={(id) => onStationSelect?.(id)}
              />
            </div>
          )}

          {/* Ridership Chart */}
          {ridershipData && ridershipData.length > 0 && (
            <div className="bg-muted rounded-lg p-4">
              <h3 className="font-semibold text-foreground mb-4">
                90-Day Ridership Trend
              </h3>
              <RidershipChart
                data={ridershipData}
              />
            </div>
          )}

          {/* Station Info */}
          <div className="bg-muted rounded-lg p-4">
            <h3 className="font-semibold text-foreground mb-2">Station Information</h3>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <MapPin className="w-3 h-3" />
                <span>ID: {station.id}</span>
              </div>
              <div className="flex items-center gap-2 ml-5">
                <span>
                  {station.latitude.toFixed(4)}, {station.longitude.toFixed(4)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Safe area padding */}
        <div className="h-32" />
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex gap-3">
        <button
          onClick={handleNavigate}
          className="flex-1 py-3 bg-foreground text-background rounded-lg font-semibold flex items-center justify-center gap-2"
        >
          <Navigation className="w-5 h-5" />
          Navigate
        </button>
        <button
          onClick={handleShare}
          disabled={isSharing}
          className="flex-1 py-3 border border-border rounded-lg font-semibold flex items-center justify-center gap-2"
        >
          <Share className="w-5 h-5" />
          {isSharing ? 'Sharing...' : 'Share'}
        </button>
      </div>
    </animated.div>
  );
}