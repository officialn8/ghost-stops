import { CTALine, CTA_LINE_ORDER, CTA_LINE_COLORS } from "@/lib/cta/explodeAndStitchSegments";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

interface MobileFilterScrollProps {
  selectedLines: string[];
  onLineToggle: (line: string) => void;
  onClearAll: () => void;
  onSelectAll: () => void;
}

export default function MobileFilterScroll({
  selectedLines,
  onLineToggle,
  onClearAll,
  onSelectAll
}: MobileFilterScrollProps) {
  const haptic = useHapticFeedback();

  const handleLineToggle = (line: string) => {
    haptic.selection();
    onLineToggle(line);
  };

  const hasActiveFilters = selectedLines.length > 0 && selectedLines.length < CTA_LINE_ORDER.length;

  return (
    <div className="mobile-filter-scroll">
      {/* All/None toggle */}
      <button
        onClick={() => {
          haptic.impact('light');
          if (selectedLines.length === CTA_LINE_ORDER.length) {
            onClearAll();
          } else {
            onSelectAll();
          }
        }}
        className={`mobile-filter-pill ${
          selectedLines.length === CTA_LINE_ORDER.length ? 'active' : ''
        }`}
      >
        {selectedLines.length === CTA_LINE_ORDER.length ? 'All Lines' : 'Select All'}
      </button>

      {/* Line filters */}
      {CTA_LINE_ORDER.map((line) => {
        const isActive = selectedLines.includes(line);
        return (
          <button
            key={line}
            onClick={() => handleLineToggle(line)}
            className={`mobile-filter-pill ${isActive ? 'active' : ''}`}
            style={isActive ? {
              backgroundColor: CTA_LINE_COLORS[line],
              borderColor: CTA_LINE_COLORS[line],
            } : undefined}
          >
            <span className="flex items-center gap-1.5">
              <span
                className="w-4 h-4 rounded-full inline-flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: isActive ? 'white' : CTA_LINE_COLORS[line],
                  color: isActive ? CTA_LINE_COLORS[line] : 'white',
                }}
              >
                {line.charAt(0)}
              </span>
              <span>{line}</span>
            </span>
          </button>
        );
      })}

      {/* Clear filters */}
      {hasActiveFilters && (
        <button
          onClick={() => {
            haptic.impact('light');
            onSelectAll();
          }}
          className="mobile-filter-pill"
        >
          Clear Filters
        </button>
      )}
    </div>
  );
}