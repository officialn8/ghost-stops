import { useEffect, useRef } from 'react';

/**
 * Centralized body scroll lock management.
 * Multiple components can request locks, and the body stays locked
 * until all locks are released.
 */

// Track active locks globally
const activeLocks = new Set<string>();

// Store original body styles
let originalStyles: {
  overflow: string;
  touchAction: string;
  position: string;
  width: string;
  top: string;
} | null = null;
let scrollY = 0;

function lockBody() {
  if (activeLocks.size === 1 && originalStyles === null) {
    // First lock - save original styles and lock
    scrollY = window.scrollY;
    originalStyles = {
      overflow: document.body.style.overflow,
      touchAction: document.body.style.touchAction,
      position: document.body.style.position,
      width: document.body.style.width,
      top: document.body.style.top,
    };
    
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    // Prevent layout shift on iOS
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;
  }
}

function unlockBody() {
  if (activeLocks.size === 0 && originalStyles !== null) {
    // All locks released - restore original styles
    document.body.style.overflow = originalStyles.overflow;
    document.body.style.touchAction = originalStyles.touchAction;
    document.body.style.position = originalStyles.position;
    document.body.style.width = originalStyles.width;
    document.body.style.top = originalStyles.top;
    originalStyles = null;
    
    // Restore scroll position
    window.scrollTo(0, scrollY);
  }
}

/**
 * Hook to manage body scroll lock.
 * @param id - Unique identifier for this lock (e.g., 'bottom-sheet', 'modal')
 * @param shouldLock - Whether the lock should be active
 */
export function useBodyScrollLock(id: string, shouldLock: boolean) {
  const wasLockedRef = useRef(false);

  useEffect(() => {
    if (shouldLock && !wasLockedRef.current) {
      // Acquiring lock
      activeLocks.add(id);
      wasLockedRef.current = true;
      lockBody();
    } else if (!shouldLock && wasLockedRef.current) {
      // Releasing lock
      activeLocks.delete(id);
      wasLockedRef.current = false;
      unlockBody();
    }

    // Cleanup on unmount
    return () => {
      if (wasLockedRef.current) {
        activeLocks.delete(id);
        wasLockedRef.current = false;
        unlockBody();
      }
    };
  }, [id, shouldLock]);
}

/**
 * Simple hook to get consistent screen height.
 * Handles SSR and resize events.
 */
export function useScreenHeight() {
  const getHeight = () => (typeof window !== 'undefined' ? window.innerHeight : 0);
  
  // Use a ref to avoid re-renders on every resize
  const heightRef = useRef(getHeight());

  useEffect(() => {
    const updateHeight = () => {
      heightRef.current = window.innerHeight;
    };
    
    updateHeight();
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);
    
    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
    };
  }, []);

  return heightRef.current;
}
