// src/lib/motion/tokens.ts
// Motion token system for Ghost Stops UI
// Based on Phase 1 UI Overhaul specifications

import type { Transition, Variants } from "framer-motion";

// ═══════════════════════════════════════════════════════════════
// SPRING CONFIGURATIONS
// ═══════════════════════════════════════════════════════════════

export const springs = {
  // Micro-interactions (buttons, hover states)
  micro: {
    type: "spring" as const,
    stiffness: 500,
    damping: 30,
  },

  // Panel entrances (sidebars, modals)
  panel: {
    type: "spring" as const,
    stiffness: 300,
    damping: 30,
    mass: 1,
  },

  // Snappy interactions (list items)
  snappy: {
    type: "spring" as const,
    stiffness: 400,
    damping: 25,
  },

  // Smooth entrances (content reveal)
  smooth: {
    type: "spring" as const,
    stiffness: 260,
    damping: 25,
  },
} satisfies Record<string, Transition>;

// ═══════════════════════════════════════════════════════════════
// TRANSITION PRESETS
// ═══════════════════════════════════════════════════════════════

export const transitions = {
  // List stagger timing
  stagger: {
    staggerChildren: 0.05,
    delayChildren: 0.1,
  },

  // Enhanced stagger for longer lists
  staggerSlow: {
    staggerChildren: 0.06,
    delayChildren: 0.2,
  },

  // Map animation (CSS easing for Mapbox)
  map: {
    duration: 1.2,
    ease: [0.25, 0.1, 0.25, 1],
  },

  // Quick exit
  exit: {
    duration: 0.2,
    ease: "easeIn",
  },
};

// ═══════════════════════════════════════════════════════════════
// EXIT ANIMATIONS
// ═══════════════════════════════════════════════════════════════

export const exitTransitions = {
  panel: {
    opacity: 0,
    x: 50,
    transition: { duration: 0.2, ease: "easeIn" },
  },
  listItem: {
    opacity: 0,
    x: -20,
    transition: { duration: 0.15 },
  },
};

// ═══════════════════════════════════════════════════════════════
// COMPONENT VARIANTS
// ═══════════════════════════════════════════════════════════════

// Station List Container - optimized for faster perceived load
export const listContainerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.025, // Faster stagger (was 0.06)
      delayChildren: 0.05,    // Shorter delay (was 0.2)
    },
  },
};

// Station List Item - removed blur filter for performance
export const listItemVariants: Variants = {
  hidden: {
    opacity: 0,
    x: -20, // Reduced distance (was -30)
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring",
      stiffness: 500, // Snappier (was 400)
      damping: 30,    // Increased damping (was 25)
    },
  },
};

// Detail Panel Container - optimized, removed blur for performance
export const panelVariants: Variants = {
  hidden: {
    opacity: 0,
    x: 60, // Reduced distance (was 100)
    scale: 0.98, // Subtle scale (was 0.95)
  },
  visible: {
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      type: "spring",
      stiffness: 350, // Faster (was 260)
      damping: 30,    // More damped (was 25)
      staggerChildren: 0.04, // Faster stagger (was 0.08)
      delayChildren: 0.05,   // Shorter delay (was 0.15)
    },
  },
  exit: {
    opacity: 0,
    x: 30, // Reduced (was 50)
    transition: { duration: 0.15 }, // Faster exit (was 0.2)
  },
};

// Detail Panel Child Items
export const panelItemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 400,
      damping: 30,
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// HOVER STATES (for whileHover prop)
// ═══════════════════════════════════════════════════════════════

export const hoverStates = {
  listItem: {
    scale: 1.02,
    x: 8,
    boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
  },
  listItemTap: {
    scale: 0.98,
  },
};

// ═══════════════════════════════════════════════════════════════
// REACT-SPRING CONFIGS (for count-up animations)
// ═══════════════════════════════════════════════════════════════

export const springConfigs = {
  // Ghost score count-up
  countUp: {
    mass: 1,
    tension: 20,
    friction: 10,
  },
  // Faster count-up variant
  countUpFast: {
    mass: 1,
    tension: 40,
    friction: 12,
  },
};
