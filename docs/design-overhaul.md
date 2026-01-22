# Ghost Stops - Premium Design System Overhaul

## Overview

This document details the comprehensive premium glass UI design system implemented for the Ghost Stops Chicago CTA rail analytics application. The design transforms the original dark-themed interface into an award-winning 2026 light-mode aesthetic with distinctive ghost-themed branding.

## Design Philosophy

**Core Principles:**
- **Airy & Calm**: Light backgrounds with generous whitespace
- **Premium Glass**: Subtle translucency and backdrop blur effects
- **Fintech-Grade**: Professional, trustworthy, data-driven aesthetic
- **Ghost Identity**: Subtle spectral elements that enhance the brand

## Color Palette & Tokens

### Neutrals (Light Mode)
```css
--neutral-bg: #F6F7FB                    /* App background */
--neutral-surface: rgba(255,255,255,0.72) /* Glass surface */
--neutral-surface-solid: #FFFFFF          /* Solid surface */
--neutral-surface-muted: #F1F3F8          /* Muted background */
--neutral-border: rgba(15,23,42,0.08)     /* Subtle borders */
```

### Brand Accents
```css
/* Primary - Aurora Teal */
--aurora: #14B8A6
--aurora-50: #ECFDF5
--aurora-500: #14B8A6
--aurora-900: #134E4A

/* Secondary - Spectral Violet */
--spectral: #7C3AED
--spectral-50: #FAF5FF
--spectral-700: #7C3AED
--spectral-900: #581C87
```

### Ghost Theme Accents
```css
--ghost-glow: rgba(124,58,237,0.18)    /* Violet haze */
--ghost-mist: rgba(20,184,166,0.14)    /* Teal haze */
--ghost-ink: rgba(11,18,32,0.08)       /* Soft outline */
```

### Text Hierarchy
```css
--text-primary: #0B1220                  /* Main text */
--text-secondary: rgba(11,18,32,0.72)    /* Secondary text */
--text-tertiary: rgba(11,18,32,0.52)     /* Tertiary text */
```

### Ghost Score Colors
```javascript
const ghostScoreColors = {
  100: "#DC2626",  // Score 80-100: Extreme ghost (red)
  80: "#EA580C",   // Score 60-79: Very empty (orange)
  60: "#F59E0B",   // Score 40-59: Somewhat empty (amber)
  40: "#84CC16",   // Score 20-39: Moderate (lime)
  20: "#22C55E"    // Score 0-19: Normal/busy (green)
}
```

### CTA Line Colors (Tastefully Bright)
```javascript
const ctaLineColors = {
  "Red": "#C60C30",
  "Blue": "#00A1DE",
  "Brown": "#62361B",
  "Green": "#009B3A",
  "Orange": "#F9461C",
  "Purple": "#522398",
  "Purple Express": "#522398",
  "Pink": "#E27EA6",
  "Yellow": "#F9E300"
}
```

## Typography Scale

### Font Stack
- **Display Font**: Fraunces (600-700) - Headlines and hero text
- **UI Font**: Inter (400-600) - Body text and interface elements

### Type Scale
```css
/* Display */
--display-1: 3.5rem / 1.1 / -0.02em / 700    /* Page titles */
--display-2: 2.75rem / 1.2 / -0.02em / 600   /* Section headers */
--display-3: 2.25rem / 1.3 / -0.01em / 600   /* Panel titles */

/* UI */
--ui-xl: 1.5rem / 1.4 / 600      /* Large UI text */
--ui-lg: 1.25rem / 1.5 / 600     /* Medium UI text */
--ui-md: 1rem / 1.5 / 500        /* Body text */
--ui-sm: 0.875rem / 1.5 / 500    /* Small text */
--ui-xs: 0.75rem / 1.5 / 500     /* Caption text */
```

## Glass Effect System

### Standard Glass Surface
```css
.glass {
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(15, 23, 42, 0.08);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.10);
}
```

### Glass Variations
- **glass**: Standard translucent surface (72% opacity)
- **glass-solid**: Solid white with glass border/shadow
- **glass-hover**: Hover state with enhanced shadow

### Border Radius Scale
```css
--radius-ui: 14px        /* Buttons, inputs */
--radius-panel: 20px     /* Panels, cards */
--radius-pill: 999px     /* Pills, badges */
```

## Component Inventory

### Core Components

#### 1. TopBar
- Fixed glass navigation with logo and search
- Ghost logo with animated pulse effect
- Integrated search with glass styling

#### 2. StationList (Left Rail)
- Floating glass panel with collapsible state
- Ghost watermark background
- Ranked station rows with hover effects
- Smooth collapse/expand animations

#### 3. StationDetailPanel (Right Panel)
- Premium glass surface with ghost watermark
- GhostScoreHero with spectral animations
- Editorial layout with metrics grid
- Screenshot-ready design

#### 4. GhostScoreBadge
- Compact score display with glow effect
- Three sizes: sm, md, lg
- Dynamic color based on score value

#### 5. GhostScoreHero
- Large animated score display
- Shimmer effect on value change
- Ghost pulse background animation
- Mist drift effect at bottom

#### 6. CTALineBadge
- Pill-shaped line indicators
- Correct CTA brand colors
- Subtle glow shadow
- Three sizes: sm, md, lg

#### 7. MapTooltip
- Glass tooltip on station hover
- Ghost mist background effect
- Fade-in animation

#### 8. GhostWatermark
- SVG ghost illustration
- Float animation
- Ultra-subtle opacity (2-3%)
- Brand reinforcement

## Ghost-Themed Features

### 1. Ghost Score Animation (GhostScoreHero)
- **Spectral fade-in**: Smooth opacity transition
- **Shimmer sweep**: Gradient animation on change
- **Mist pulse**: Radial gradient animation
- **Float effect**: Subtle vertical movement

### 2. Map Ghost Effects
- **Station halos**: Ghost score intensity rings
- **Hover whisper**: Glass tooltip with mist
- **Light theme**: Clean light-v11 Mapbox style
- **Selection pulse**: Selected station animation

### 3. Ghost Branding
- **Logo**: Ghost icon with gradient background
- **Watermarks**: Ultra-subtle ghost shapes
- **Empty states**: "No riders detected" messaging
- **Animations**: Float, pulse, shimmer, drift

## Animation Patterns

### Defined Animations
```css
/* Ghost-themed animations */
@keyframes ghost-fade { /* Fade in with upward movement */ }
@keyframes ghost-shimmer { /* Gradient sweep effect */ }
@keyframes ghost-pulse { /* Scale and opacity pulse */ }
@keyframes ghost-float { /* Gentle vertical float */ }
@keyframes mist-drift { /* Horizontal mist movement */ }
```

### Usage Guidelines
- **Transitions**: 200-300ms for interactions
- **Animations**: 2-3s for ambient effects
- **Easing**: ease-out for natural movement

## Layout Architecture

### Desktop Layout
```
┌─────────────────────────────────────────────────┐
│                   TopBar (glass)                 │
├─────────────────────────────────────────────────┤
│ ┌────────┐                          ┌─────────┐ │
│ │Station  │      Map Background      │Station  │ │
│ │List     │         (light)          │Detail   │ │
│ │(glass)  │                          │(glass)  │ │
│ └────────┘                          └─────────┘ │
└─────────────────────────────────────────────────┘
```

### Mobile Layout (Planned)
- TopBar remains fixed
- Station list becomes bottom sheet
- Detail panel as full-screen modal
- Touch-optimized interactions

## Performance Optimizations

1. **Dynamic Imports**: Map loaded with Next.js dynamic imports
2. **Memoization**: GeoJSON data cached with useMemo
3. **Debouncing**: Search and hover interactions
4. **Glass Effects**: CSS-based for GPU acceleration
5. **Font Loading**: next/font for optimized web fonts

## Browser Compatibility

### Full Support
- Chrome/Edge (latest)
- Safari 15+ (webkit prefixes included)
- Firefox (latest)

### Glass Effects
- Backdrop-filter supported in all modern browsers
- Fallback to semi-transparent backgrounds

## Screenshot Checklist

### Key Views for Portfolio
1. **Hero View**: Full layout with all panels visible
2. **Station Selected**: Detail panel with GhostScoreHero
3. **Map Interaction**: Tooltip and station halos
4. **Collapsed State**: Minimized station list
5. **Empty State**: No data ghost illustration

### Optimal Screenshots
- Browser: Chrome/Safari for best glass rendering
- Resolution: 1440x900 or higher
- Selected station with high ghost score
- Multiple CTA lines visible

## Remaining Polish Backlog

### High Priority
- [ ] Mobile responsive bottom sheets
- [ ] Search functionality integration
- [ ] Loading skeletons
- [ ] Error states with ghost theme

### Medium Priority
- [ ] Line filter controls
- [ ] Time range selector
- [ ] Keyboard navigation
- [ ] Accessibility improvements

### Nice to Have
- [ ] Dark mode variant
- [ ] Advanced ghost cursor effects
- [ ] Real-time arrival integration
- [ ] Data visualization charts

## Usage Examples

### Glass Panel
```jsx
<div className="glass-panel">
  <GhostWatermark />
  {/* Panel content */}
</div>
```

### CTA Line Badge
```jsx
<CTALineBadge line="Red" size="md" />
```

### Ghost Score Display
```jsx
<GhostScoreBadge score={85} size="lg" showLabel />
<GhostScoreHero score={92} label="Ghost Score" />
```

## Design Token Reference

All design tokens are defined in:
- `/tailwind.config.ts` - Tailwind theme extensions
- `/src/app/globals.css` - CSS custom properties
- `/src/lib/utils.ts` - Color mapping utilities

## Conclusion

This design system delivers a premium, cohesive experience that transforms Ghost Stops into a portfolio-worthy application. The light-mode aesthetic with glass effects and ghost-themed branding creates a memorable, professional interface that stands out in 2026 design trends.