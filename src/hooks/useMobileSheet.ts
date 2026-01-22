import { useState, useCallback, useEffect } from 'react';
import { useSpring, SpringValue } from '@react-spring/web';
import { useDrag } from '@use-gesture/react';
import { useHapticFeedback } from './useHapticFeedback';

export interface MobileSheetState {
  isOpen: boolean;
  snapIndex: number;
  y: SpringValue<number>;
  opacity: SpringValue<number>;
  bind: (...args: any[]) => any;
  openTo: (index: number) => void;
  close: () => void;
  toggle: () => void;
}

const SNAP_POINTS = [0.25, 0.5, 0.9]; // Percentage of screen height

export function useMobileSheet(): MobileSheetState {
  const haptic = useHapticFeedback();
  const [isOpen, setIsOpen] = useState(false);
  const [snapIndex, setSnapIndex] = useState(0);
  const [screenHeight, setScreenHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );

  // Update screen height on resize
  useEffect(() => {
    const handleResize = () => {
      setScreenHeight(window.innerHeight);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [{ y, opacity }, api] = useSpring(() => ({
    y: screenHeight * (1 - SNAP_POINTS[0]),
    opacity: 0,
    config: { tension: 300, friction: 30 },
  }));

  const openTo = useCallback(
    (index: number) => {
      const clampedIndex = Math.max(0, Math.min(index, SNAP_POINTS.length - 1));
      const snapY = screenHeight * (1 - SNAP_POINTS[clampedIndex]);

      api.start({
        y: snapY,
        opacity: clampedIndex > 0 ? 1 : 0,
      });

      setSnapIndex(clampedIndex);
      setIsOpen(clampedIndex > 0);
      haptic.impact('light');
    },
    [api, haptic, screenHeight]
  );

  const close = useCallback(() => {
    openTo(0);
  }, [openTo]);

  const toggle = useCallback(() => {
    if (snapIndex === 0) {
      openTo(1);
    } else {
      close();
    }
  }, [snapIndex, openTo, close]);

  const bind = useDrag(
    ({ down, movement: [, my], velocity: [, vy], last, cancel, canceled, memo = y.get() }) => {
      if (canceled) return;

      if (last) {
        const currentY = y.get();

        // Find nearest snap point
        let nearestIndex = 0;
        let nearestDistance = Infinity;

        SNAP_POINTS.forEach((point, index) => {
          const snapY = screenHeight * (1 - point);
          const distance = Math.abs(snapY - currentY);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
          }
        });

        // Velocity-based adjustment
        const velocityThreshold = 0.5;
        if (Math.abs(vy) > velocityThreshold) {
          if (vy > 0 && nearestIndex < SNAP_POINTS.length - 1) {
            nearestIndex++;
          } else if (vy < 0 && nearestIndex > 0) {
            nearestIndex--;
          }
        }

        openTo(nearestIndex);
      } else {
        // While dragging
        const newY = memo + my;
        api.start({
          y: newY,
          immediate: true,
          opacity: newY < screenHeight * 0.75 ? 1 : 0,
        });
      }

      return memo;
    },
    {
      from: () => [0, y.get()],
      filterTaps: true,
      bounds: {
        top: screenHeight * (1 - SNAP_POINTS[SNAP_POINTS.length - 1]),
        bottom: screenHeight * (1 - SNAP_POINTS[0]),
      },
      rubberband: true,
    }
  );

  return {
    isOpen,
    snapIndex,
    y,
    opacity,
    bind,
    openTo,
    close,
    toggle,
  };
}