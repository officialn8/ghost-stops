import { List } from 'lucide-react';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';

interface MobileViewListFABProps {
  stationCount: number;
  ghostStopCount: number;
  onClick: () => void;
}

export default function MobileViewListFAB({
  stationCount,
  ghostStopCount,
  onClick
}: MobileViewListFABProps) {
  const haptic = useHapticFeedback();

  const handleClick = () => {
    haptic.impact('light');
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      className="mobile-view-list-fab"
      aria-label="View station list"
    >
      <List className="w-5 h-5" />
      <span>{stationCount} stations • {ghostStopCount} ghost stops</span>
    </button>
  );
}