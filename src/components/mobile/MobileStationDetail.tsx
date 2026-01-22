import { animated, useSpring } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import { useState, useEffect } from 'react';
import Map from 'react-map-gl/mapbox';
import { ChevronDown, Share, Navigation } from 'lucide-react';
import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";
import { CTALine, CTA_LINE_COLORS } from "@/lib/cta/explodeAndStitchSegments";
import RidershipChart from "@/components/station/RidershipChart";
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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

interface MobileStationDetailProps {
  station: Station | null;
  isOpen: boolean;
  onClose: () => void;
  ridershipData?: { date: string; entries: number }[];
}

export default function MobileStationDetail({
  station,
  isOpen,
  onClose,
  ridershipData
}: MobileStationDetailProps) {
  const haptic = useHapticFeedback();
  const [isSharing, setIsSharing] = useState(false);

  const [{ y, opacity }, api] = useSpring(() => ({
    y: window.innerHeight,
    opacity: 0,
    config: { tension: 300, friction: 30 }
  }));

  // Animate in/out based on isOpen
  useEffect(() => {
    if (isOpen && station) {
      api.start({ y: 0, opacity: 1 });
      document.body.style.overflow = 'hidden';
      // Ensure the map doesn't get stuck
      document.body.style.touchAction = 'none';
    } else {
      api.start({ y: window.innerHeight, opacity: 0 });
      // Clean up body styles
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
    };
  }, [isOpen, station, api]);

  const bind = useDrag(
    ({ down, movement: [, my], velocity: [, vy], last }) => {
      if (my > 50 && !down) {
        haptic.impact('light');
        onClose();
      } else if (!last) {
        api.start({ y: Math.max(0, my), immediate: true });
      } else {
        api.start({ y: 0 });
      }
    },
    {
      from: () => [0, 0],
      filterTaps: true,
      axis: 'y',
      bounds: { top: 0 }
    }
  );

  const handleShare = async () => {
    setIsSharing(true);
    haptic.impact('medium');

    const shareData = {
      title: `${station?.name} Station`,
      text: `Ghost Score: ${station?.ghostScore.toFixed(0)} | Daily Average: ${station?.rolling30dAvg.toFixed(0)} riders`,
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
      console.error('Share failed:', error);
    } finally {
      setIsSharing(false);
    }
  };

  const handleNavigate = () => {
    haptic.impact('medium');
    if (!station) return;

    // Determine which maps app to use based on platform
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const coords = `${station.latitude},${station.longitude}`;

    if (isIOS) {
      window.open(`maps://maps.apple.com/?q=${station.name}&ll=${coords}`, '_blank');
    } else {
      window.open(`geo:${coords}?q=${station.name}`, '_blank');
    }
  };

  if (!station) return null;

  const { lines } = normalizeStationLines({ lines: station.lines });

  return (
    <animated.div
      style={{
        y,
        opacity,
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'white',
        transform: y.to(y => `translateY(${y}px)`),
        pointerEvents: isOpen ? 'auto' : 'none'
      }}
      className="mobile-station-detail"
    >
      {/* Map Preview - 30% height */}
      <div {...bind()} className="h-[30vh] relative overflow-hidden">
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            longitude: station.longitude,
            latitude: station.latitude,
            zoom: 16
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/light-v11"
          interactive={false}
          attributionControl={false}
        >
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ pointerEvents: 'none' }}
          >
            <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
              <span className="text-white font-bold text-lg">{station.ghostScore.toFixed(0)}</span>
            </div>
          </div>
        </Map>

        {/* Gradient overlay at bottom to fade out any remaining UI elements */}
        <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-white to-transparent pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 left-4 w-10 h-10 bg-white/90 backdrop-blur rounded-full flex items-center justify-center shadow-lg"
        >
          <ChevronDown className="w-6 h-6 text-gray-700" />
        </button>

        {/* Drag Indicator */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-10 h-1 bg-white/50 rounded-full" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{station.name}</h1>
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

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-3xl font-bold text-red-600">
                {station.ghostScore.toFixed(0)}
              </div>
              <div className="text-sm text-gray-600 font-medium">Ghost Score</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-3xl font-bold text-gray-900">
                {station.rolling30dAvg.toFixed(0)}
              </div>
              <div className="text-sm text-gray-600 font-medium">Daily Average</div>
            </div>
          </div>

          {/* Ridership Chart */}
          {ridershipData && ridershipData.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-4">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Ridership Trend
              </h2>
              <div className="h-64">
                <RidershipChart
                  data={ridershipData}
                  stationName={station.name}
                  isGhostStop={station.ghostScore > 70}
                />
              </div>
            </div>
          )}

          {/* Additional Info */}
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-900 mb-2">About This Station</h3>
              <p className="text-sm text-gray-600 leading-relaxed">
                {station.dataStatus === 'missing' ? (
                  "No recent ridership data available for this station."
                ) : station.ghostScore > 70 ? (
                  "This station qualifies as a ghost stop with extremely low ridership compared to the CTA system average."
                ) : (
                  "This station maintains regular ridership levels compared to other CTA stations."
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Safe area padding */}
        <div className="h-24" />
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] flex gap-3">
        <button
          onClick={handleNavigate}
          className="flex-1 py-3 bg-gray-900 text-white rounded-lg font-semibold flex items-center justify-center gap-2"
        >
          <Navigation className="w-5 h-5" />
          Navigate
        </button>
        <button
          onClick={handleShare}
          disabled={isSharing}
          className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold flex items-center justify-center gap-2"
        >
          <Share className="w-5 h-5" />
          {isSharing ? 'Sharing...' : 'Share'}
        </button>
      </div>
    </animated.div>
  );
}