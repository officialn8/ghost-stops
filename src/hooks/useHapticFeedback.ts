import { useCallback } from 'react';

type HapticStyle = 'light' | 'medium' | 'heavy' | 'soft' | 'rigid';
type NotificationFeedback = 'success' | 'warning' | 'error';

interface HapticFeedback {
  impact: (style?: HapticStyle) => void;
  notification: (type?: NotificationFeedback) => void;
  selection: () => void;
}

// Check if the Vibration API is available
const hasVibrationAPI = () => {
  return typeof window !== 'undefined' && 'vibrate' in navigator;
};

// Map haptic styles to vibration patterns (milliseconds)
const VIBRATION_PATTERNS: Record<HapticStyle, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 30,
  soft: [10, 10, 10],
  rigid: 50,
};

const NOTIFICATION_PATTERNS: Record<NotificationFeedback, number[]> = {
  success: [10, 30, 10],
  warning: [20, 10, 20],
  error: [30, 10, 30, 10, 30],
};

export function useHapticFeedback(): HapticFeedback {
  const impact = useCallback((style: HapticStyle = 'medium') => {
    if (!hasVibrationAPI()) return;

    try {
      const pattern = VIBRATION_PATTERNS[style];
      navigator.vibrate(pattern);
    } catch (error) {
      console.debug('Haptic feedback not supported:', error);
    }
  }, []);

  const notification = useCallback((type: NotificationFeedback = 'success') => {
    if (!hasVibrationAPI()) return;

    try {
      const pattern = NOTIFICATION_PATTERNS[type];
      navigator.vibrate(pattern);
    } catch (error) {
      console.debug('Haptic feedback not supported:', error);
    }
  }, []);

  const selection = useCallback(() => {
    if (!hasVibrationAPI()) return;

    try {
      navigator.vibrate(5);
    } catch (error) {
      console.debug('Haptic feedback not supported:', error);
    }
  }, []);

  return {
    impact,
    notification,
    selection,
  };
}