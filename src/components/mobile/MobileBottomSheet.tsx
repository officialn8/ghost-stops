import { animated } from '@react-spring/web';
import { useState, useRef, useEffect } from 'react';
import { useMobileSheet } from '@/hooks/useMobileSheet';
import MobileStationCard from './MobileStationCard';

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

interface MobileBottomSheetProps {
  stations: Station[];
  onStationClick: (station: Station) => void;
  sheetState: ReturnType<typeof useMobileSheet>;
}

export default function MobileBottomSheet({ stations, onStationClick, sheetState }: MobileBottomSheetProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { y, opacity, bind, snapIndex } = sheetState;

  // Pull to refresh handling
  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Simulate refresh - in real app this would refetch data
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsRefreshing(false);
  };

  // Lock body scroll only when sheet is mostly open
  useEffect(() => {
    if (snapIndex >= 2) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [snapIndex]);

  // Count ghost stops
  const ghostStopCount = stations.filter(s => s.ghostScore > 70).length;

  return (
    <>
      {/* Backdrop - only visible when sheet is more than half open */}
      {snapIndex >= 2 && (
        <animated.div
          className="fixed inset-0 bg-black/20 z-40"
          style={{
            opacity,
          }}
          onClick={() => {
            // Close sheet when backdrop clicked
          }}
        />
      )}

      {/* Sheet */}
      <animated.div
        {...bind()}
        style={{
          y,
          touchAction: 'none',
        }}
        className="fixed inset-x-0 top-0 h-[90vh] bg-white rounded-t-[20px] shadow-[0_-4px_30px_rgba(0,0,0,0.15)] z-50 flex flex-col"
      >
        {/* Drag Indicator */}
        <div className="flex-shrink-0 py-3">
          <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto" />
        </div>

        {/* Header */}
        <div className="flex-shrink-0 px-4 pb-3 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">
            {stations.length} Stations • {ghostStopCount} Ghost Stops
          </h2>
        </div>

        {/* Pull to Refresh Indicator */}
        {isRefreshing && (
          <div className="flex-shrink-0 py-2 px-4 bg-gray-50 border-b border-gray-100">
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span>Refreshing...</span>
            </div>
          </div>
        )}

        {/* Scrollable Content */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overscroll-contain"
          onTouchMove={(e) => {
            // Allow scrolling only when at top and pulling down
            if (scrollRef.current && scrollRef.current.scrollTop === 0) {
              const touch = e.touches[0];
              if (touch.clientY > 100 && !isRefreshing) {
                handleRefresh();
              }
            }
          }}
        >
          {stations.map((station, index) => (
            <MobileStationCard
              key={station.id}
              rank={index + 1}
              station={station}
              onClick={() => onStationClick(station)}
            />
          ))}

          {/* Bottom padding for safe area */}
          <div className="h-8" />
        </div>
      </animated.div>
    </>
  );
}