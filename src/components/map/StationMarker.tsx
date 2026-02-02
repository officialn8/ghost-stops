"use client";

import { Marker } from "react-map-gl/mapbox";
import { motion } from "framer-motion";
import { normalizeStationLines } from "@/lib/cta/normalizeStationLines";
import { CTALine, CTA_LINE_COLORS } from "@/lib/cta/explodeAndStitchSegments";

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

interface StationMarkerProps {
  station: Station;
  onClick: (station: Station) => void;
  isSelected?: boolean;
  showGhostIcon?: boolean;
  zoomLevel?: number;
}

// Get ghost score color - from healthy green to ghostly purple/gray
function getGhostScoreColor(score: number): { bg: string; text: string; glow: string } {
  if (score >= 80) return { 
    bg: 'rgba(139, 92, 246, 0.95)',  // Purple - very ghostly
    text: '#ffffff',
    glow: 'rgba(139, 92, 246, 0.4)'
  };
  if (score >= 65) return { 
    bg: 'rgba(239, 68, 68, 0.95)',   // Red - ghost territory
    text: '#ffffff',
    glow: 'rgba(239, 68, 68, 0.3)'
  };
  if (score >= 50) return { 
    bg: 'rgba(249, 115, 22, 0.95)',  // Orange - concerning
    text: '#ffffff',
    glow: 'rgba(249, 115, 22, 0.25)'
  };
  if (score >= 35) return { 
    bg: 'rgba(234, 179, 8, 0.95)',   // Yellow - moderate
    text: '#1f2937',
    glow: 'rgba(234, 179, 8, 0.2)'
  };
  return { 
    bg: 'rgba(34, 197, 94, 0.95)',   // Green - healthy
    text: '#ffffff',
    glow: 'rgba(34, 197, 94, 0.2)'
  };
}

// Animated Ghost Icon SVG
function GhostIcon({ size = 16 }: { size?: number }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      initial={{ y: 0, opacity: 0.9 }}
      animate={{ 
        y: [-1, 1, -1],
        opacity: [0.85, 1, 0.85],
      }}
      transition={{
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut"
      }}
    >
      <path d="M12 2C8.14 2 5 5.14 5 9v9.5c0 .83 1 1.5 1.5 1.5s1-.67 1.5-1.5c.5.83 1.5 1.5 2 1.5s1.5-.67 2-1.5c.5.83 1.5 1.5 2 1.5s1.5-.67 2-1.5c.5.83 1 1.5 1.5 1.5s1.5-.67 1.5-1.5V9c0-3.86-3.14-7-7-7zm-2.5 8a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z"/>
    </motion.svg>
  );
}

// Animation variants for smooth interactions
const markerVariants = {
  initial: {
    scale: 0.8,
    opacity: 0,
    y: 10
  },
  animate: {
    scale: 1,
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 25
    }
  },
  hover: {
    scale: 1.08,
    y: -2,
    transition: {
      type: "spring" as const,
      stiffness: 400,
      damping: 20
    }
  },
  tap: {
    scale: 0.95,
    transition: { duration: 0.1 }
  },
  selected: {
    scale: 1.12,
    y: -3,
    transition: {
      type: "spring" as const,
      stiffness: 300,
      damping: 20
    }
  }
};

export default function StationMarker({ 
  station, 
  onClick, 
  isSelected = false,
  showGhostIcon = false,
  zoomLevel = 14,
}: StationMarkerProps) {
  // Normalize and clean station name
  const { lines, cleanName } = normalizeStationLines({ 
    name: station.name, 
    lines: station.lines 
  });

  // Ghost score color theming
  const ghostColors = getGhostScoreColor(station.ghostScore);
  const isVeryGhostly = station.ghostScore >= 70;
  const isExtremelyGhostly = station.ghostScore >= 85;

  // Compact mode for lower zoom levels - but never for selected stations
  const isCompactMode = zoomLevel < 13.5 && !isSelected;

  return (
    <Marker
      longitude={station.longitude}
      latitude={station.latitude}
      anchor="bottom"
      onClick={(e) => {
        e.originalEvent.stopPropagation();
        onClick(station);
      }}
    >
      <motion.div
        className="station-marker cursor-pointer"
        style={{
          position: 'relative',
          zIndex: isSelected ? 100 : isVeryGhostly ? 50 : 10,
        }}
        variants={markerVariants}
        initial={false}  // Prevent re-animation on state changes
        animate={isSelected ? "selected" : "animate"}
        whileHover="hover"
        whileTap="tap"
      >
        {/* Ghost Aura - for very ghostly stations */}
        {isVeryGhostly && (!isCompactMode || isSelected) && (
          <motion.div
            className="absolute -inset-3 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${ghostColors.glow} 0%, transparent 70%)`,
            }}
            animate={{
              scale: [1, 1.15, 1],
              opacity: [0.6, 0.9, 0.6],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut"
            }}
          />
        )}

        {/* Marker Container */}
        <div className="relative flex flex-col items-center">
          
          {/* Floating Ghost Icon for ghostly stations */}
          {showGhostIcon && (!isCompactMode || isSelected) && (
            <motion.div
              className="absolute -top-5 left-1/2 -translate-x-1/2"
              style={{ color: ghostColors.bg }}
              initial={false}  // Prevent re-animation
              animate={{ opacity: 1, y: 0 }}
            >
              <GhostIcon size={isExtremelyGhostly ? 20 : 16} />
            </motion.div>
          )}

          {/* Station Label Pill - Ghost Score Colored */}
          <div
            className={`
              relative px-2.5 py-1 rounded-lg
              font-semibold leading-tight
              whitespace-nowrap truncate
              backdrop-blur-md
              transition-all duration-200 ease-out
              ${isCompactMode ? 'text-[10px] max-w-[100px]' : isSelected ? 'text-[12px] max-w-[150px]' : 'text-[11px] max-w-[130px]'}
            `}
            style={{
              backgroundColor: ghostColors.bg,
              color: ghostColors.text,
              boxShadow: isSelected
                ? `0 6px 20px -2px ${ghostColors.glow}, 0 0 0 2px rgba(255,255,255,0.9), 0 0 0 3px ${ghostColors.bg}`
                : `0 4px 16px -2px ${ghostColors.glow}, 0 2px 6px -1px rgba(0,0,0,0.15)`,
              transform: isSelected ? 'scale(1.05)' : 'scale(1)',
            }}
          >
            {/* Subtle top highlight */}
            <div 
              className="absolute inset-x-0 top-0 h-px rounded-t-lg"
              style={{ 
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
                opacity: 0.6
              }}
            />
            
            {/* Ghost Score Badge - inline */}
            {(!isCompactMode || isSelected) && station.ghostScore >= 50 && (
              <span
                className="inline-block mr-1 px-1 py-0.5 rounded text-[9px] font-bold opacity-90"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.2)',
                }}
              >
                {Math.round(station.ghostScore)}
              </span>
            )}
            
            {cleanName || station.name}
          </div>

          {/* Line Pills Row */}
          <div 
            className="flex justify-center gap-0.5 mt-1"
            style={{ marginBottom: '2px' }}
          >
            {lines.map((line) => (
              <motion.span
                key={line}
                className={`
                  rounded-full text-white font-bold 
                  flex items-center justify-center
                  ring-1 ring-white/40
                  ${isCompactMode ? 'w-[14px] h-[14px] text-[8px]' : 'w-[16px] h-[16px] text-[9px]'}
                `}
                style={{ 
                  backgroundColor: CTA_LINE_COLORS[line as CTALine],
                  boxShadow: '0 2px 4px -1px rgba(0,0,0,0.25)',
                }}
                initial={false}  // Prevent re-animation
                animate={{
                  scale: 1,
                  opacity: 1
                }}
              >
                {line.charAt(0)}
              </motion.span>
            ))}
          </div>

          {/* Pointer Triangle */}
          <div className="relative flex justify-center">
            {/* Shadow for triangle */}
            <div 
              className="absolute w-0 h-0"
              style={{
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: '5px solid rgba(0,0,0,0.15)',
                transform: 'translateY(1px)',
                filter: 'blur(1px)',
              }}
            />
            {/* Main triangle */}
            <div
              className="w-0 h-0"
              style={{
                borderLeft: '4px solid transparent',
                borderRight: '4px solid transparent',
                borderTop: `5px solid ${ghostColors.bg}`,
              }}
            />
          </div>

          {/* Extremely Ghostly Pulse Ring */}
          {isExtremelyGhostly && (!isCompactMode || isSelected) && (
            <motion.div
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{
                border: `2px solid ${ghostColors.bg}`,
              }}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ 
                opacity: [0.3, 0.6, 0.3],
                scale: [1, 1.08, 1],
              }}
              transition={{
                duration: 2.5,
                repeat: Infinity,
                ease: "easeInOut"
              }}
            />
          )}
        </div>
      </motion.div>
    </Marker>
  );
}
