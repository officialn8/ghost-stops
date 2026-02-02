'use client';

import { Drawer } from 'vaul';
import { useState, useEffect, useRef } from 'react';
import MobileStationCard from './MobileStationCard';

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

interface MobileBottomSheetProps {
  stations: Station[];
  onStationClick: (station: Station) => void;
  isHidden?: boolean;
}

// Snap points: 25% visible (peek), 50% visible, 90% visible (full)
const SNAP_POINTS: (number | string)[] = [0.25, 0.5, 0.9];

export default function MobileBottomSheet({
  stations,
  onStationClick,
  isHidden = false
}: MobileBottomSheetProps) {
  // Track internal open state to allow animation
  const [isOpen, setIsOpen] = useState(true);
  const [shouldRender, setShouldRender] = useState(true);
  const [activeSnap, setActiveSnap] = useState<number | string | null>(SNAP_POINTS[0]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check if we're at the highest snap point where scrolling should be enabled
  const isAtFullHeight = activeSnap === 0.9;

  // When isHidden changes, animate the drawer closed/open
  useEffect(() => {
    if (isHidden) {
      // Close the drawer (will animate)
      setIsOpen(false);
    } else {
      // Re-render and open
      setShouldRender(true);
      // Small delay to ensure DOM is ready
      requestAnimationFrame(() => {
        setIsOpen(true);
      });
    }
  }, [isHidden]);

  // Handle animation end - stop rendering after close animation
  const handleAnimationEnd = (open: boolean) => {
    if (!open && isHidden) {
      setShouldRender(false);
    }
  };

  // Reset scroll position when not at full height
  useEffect(() => {
    if (!isAtFullHeight && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [isAtFullHeight]);

  if (!shouldRender) {
    return null;
  }

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={setIsOpen}
      onAnimationEnd={handleAnimationEnd}
      modal={false}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={activeSnap}
      setActiveSnapPoint={setActiveSnap}
      fadeFromIndex={2}
      dismissible={false}
    >
      <Drawer.Portal>
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-background rounded-t-[20px] shadow-[0_-4px_30px_rgba(0,0,0,0.15)] outline-none"
          style={{ height: '90vh' }}
        >
          {/* Drag Handle */}
          <Drawer.Handle className="mx-auto mt-3 mb-2 h-1 w-10 rounded-full bg-border" />

          {/* Header */}
          <div className="px-4 pb-3 border-b border-border flex-shrink-0">
            <Drawer.Title className="text-lg font-semibold text-foreground">
              Ghostiest Stations
            </Drawer.Title>
            <Drawer.Description className="text-sm text-muted-foreground">
              Top {stations.length} stations by ghost score
            </Drawer.Description>
          </div>

          {/* Scrollable Content - only scrollable at full height */}
          <div
            ref={scrollRef}
            data-vaul-no-drag
            className={`flex-1 overscroll-contain ${
              isAtFullHeight ? 'overflow-y-auto' : 'overflow-hidden'
            }`}
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
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
