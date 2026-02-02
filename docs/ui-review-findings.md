# Ghost Stops UI Review Findings

**Review Date:** February 1, 2026  
**Status:** In Progress — Some bugs fixed, some remain

---

## Executive Summary

This document contains findings from a comprehensive code review of the Ghost Stops application, evaluating both desktop and mobile UI/UX against the design audit standards in `docs/UI Overhaul Design Audit.md`.

### Critical Issues Found

| Category | P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low) |
|----------|--------------|-----------|-------------|----------|
| Desktop | ~~1~~ 0 ✅ | 2 | 2 | 1 |
| Mobile | 1 ❌ | 2 | 3 | 2 |
| **Total** | **1 ❌** | **4** | **5** | **3** |

### Key Findings

1. ~~**StationMarker disappears when clicked**~~ ✅ **FIXED** - Selected marker now rendered separately and unconditionally
2. **MobileViewListFAB requires double-click** ❌ **NOT FIXED** - FAB takes two clicks to open the bottom sheet
3. ~~**MobileStationCard buttons don't work**~~ ✅ **FIXED** - Removed conflicting onTouchEnd handler
4. ~~**MobileStationDetail slides up then back down**~~ ✅ **FIXED** - Split useEffect to prevent re-trigger

### Additional Fixes Implemented

5. ✅ Created `useBodyScrollLock` hook for coordinated scroll management across mobile components
6. ✅ Fixed `MobileStationDetail` drag handler to respect scroll position
7. ✅ Fixed velocity direction logic in `useMobileSheet` for proper swipe behavior
8. ✅ Fixed console errors (Share AbortError, geo: URI scheme)
9. ✅ Fixed touch-action warning in MobileStationDetail
10. ✅ Removed unused refresh functionality from MobileBottomSheet

---

## P0 — Critical Bugs

### 1. StationMarker Disappears When Selected (Desktop)

**Location:** `src/components/map/MapContainer.tsx` (lines 497-567)

**Symptoms:**
- Click a station in `StationRow` → The selected `StationMarker` disappears from the map
- All other station markers remain visible
- The marker should NOT disappear when selected

**Root Cause Analysis:**

The marker filtering logic excludes the selected station due to multiple filtering stages:

```typescript
// MapContainer.tsx - The filtering pipeline
{viewState.zoom >= MARKER_ZOOM_THRESHOLD && (() => {
  // 1. Filter by active lines
  const activeStations = filteredStations
    .filter(station => isStationActiveByLineFilter(station.lines, activeLines));
  
  // 2. Filter by viewport bounds
  const bounds = mapRef.current?.getBounds();
  const visibleStations = bounds 
    ? activeStations.filter(station => 
        bounds.contains([station.longitude, station.latitude])
      )
    : activeStations;
  
  // 3. Selected station added AFTER filtering (too late!)
  if (selectedStation) {
    const selectedInList = stationsToShow.some(s => s.id === selectedStation.id);
    if (!selectedInList) {
      // This addition comes after bounds check - may fail
    }
  }
})()}
```

**Issues Identified:**

1. **Viewport bounds race condition:** When selecting a station, `viewState` updates and the map pans. `getBounds()` returns stale bounds before the map finishes panning, excluding the selected station from the visible list.

2. **Line filter exclusion:** If the selected station's line is filtered out (not in `activeLines`), it gets excluded before the "always include selected" logic runs.

3. **Timing issue:** The selected station check happens after all filters, but by then the station data might not be in the filtered pool.

**Recommended Fix:**

```typescript
// Ensure selected station is ALWAYS included at every filtering stage
const stationsToShow = (() => {
  // Start with all filtered stations
  let candidates = filteredStations;
  
  // Ensure selected station is in the candidate pool FIRST
  if (selectedStation && !candidates.some(s => s.id === selectedStation.id)) {
    candidates = [...candidates, selectedStation];
  }
  
  // Apply line filter - but ALWAYS include selected station
  let activeStations = candidates.filter(station => 
    isStationActiveByLineFilter(station.lines, activeLines) || 
    station.id === selectedStation?.id  // <-- Always include
  );
  
  // Viewport bounds - but ALWAYS include selected station
  const bounds = mapRef.current?.getBounds();
  const visibleStations = bounds 
    ? activeStations.filter(station => 
        station.id === selectedStation?.id ||  // <-- Always include
        bounds.contains([station.longitude, station.latitude])
      )
    : activeStations;
  
  // ... zoom-based filtering with same protection ...
  
  // Final guarantee
  if (selectedStation && !finalList.some(s => s.id === selectedStation.id)) {
    finalList.unshift(selectedStation);
  }
  
  return finalList;
})();
```

**Priority:** P0 — Breaks core functionality

---

### 2. MobileBottomSheet Moves Around and Gets Stuck (Mobile)

**Location:** `src/components/mobile/MobileBottomSheet.tsx`, `src/hooks/useMobileSheet.ts`

**Symptoms:**
- Sheet jumps around during drag
- Sheet gets stuck between snap points
- Sheet doesn't respond to backdrop clicks
- Erratic behavior when scrolling content inside sheet

**Root Cause Analysis:**

**Issue A: Drag handle area too large** (Lines 74-90)

The entire header section is wrapped in the drag handler, including text content that users try to interact with:

```tsx
// PROBLEM: Entire header is draggable
<div {...bind()} style={{ touchAction: 'none' }}>
  <div className="py-3">...</div>
  <div className="px-4 pb-3 border-b border-gray-100">
    <h2>...</h2>  {/* Users try to tap this but trigger drag */}
  </div>
</div>
```

**Issue B: Scroll vs drag conflict** (Lines 117-128)

The `onTouchMove` handler on the scrollable content conflicts with drag gestures:

```tsx
// PROBLEM: Touch handler conflicts with sheet drag
<div
  ref={scrollRef}
  onTouchMove={(e) => {
    // This fires during sheet drag, causing conflicts
    if (scrollRef.current && scrollRef.current.scrollTop === 0) {
      const touch = e.touches[0];
      if (touch.clientY > 100 && !isRefreshing) {
        handleRefresh();
      }
    }
  }}
>
```

**Issue C: Stale memo in drag handler** (`useMobileSheet.ts` Line 110)

```tsx
// PROBLEM: memo captures stale position
const bind = useDrag(
  ({ movement: [, my], velocity: [, vy], last, canceled, memo = y.get() }) => {
    const newY = memo + my;  // memo can be stale, causing jumps
  },
```

**Issue D: Transform not applied correctly** (`MobileBottomSheet.tsx` Line 70)

```tsx
// PROBLEM: y style isn't automatically translated
<animated.div
  style={{ y }}  // Should be transform: translateY(...)
  className="fixed inset-x-0 top-0 h-[90vh]..."
>
```

**Issue E: Empty backdrop click handler** (Lines 62-64)

```tsx
// PROBLEM: Backdrop doesn't close the sheet
onClick={() => {
  // Empty - does nothing!
}}
```

**Issue F: Screen height race condition** (`useMobileSheet.ts` Lines 155-158)

```tsx
// PROBLEM: screenHeight might be 0 on initial render
bounds: {
  top: screenHeight * (1 - SNAP_POINTS[SNAP_POINTS.length - 1]),
  bottom: screenHeight * (1 - SNAP_POINTS[0]),
},
// If screenHeight is 0, bounds are invalid, sheet gets stuck
```

**Recommended Fix:**

```tsx
// MobileBottomSheet.tsx - Restrict drag to indicator only
<div className="flex-shrink-0">
  {/* Only indicator is draggable */}
  <div
    {...bind()}
    style={{ touchAction: 'none' }}
    className="py-3 cursor-grab active:cursor-grabbing"
  >
    <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto" />
  </div>
  
  {/* Header is NOT draggable */}
  <div className="px-4 pb-3 border-b border-gray-100">
    <h2>{stations.length} Stations • {ghostStopCount} Ghost Stops</h2>
  </div>
</div>

// Remove onTouchMove, allow natural scrolling
<div
  ref={scrollRef}
  className="flex-1 overflow-y-auto overscroll-contain"
  style={{ touchAction: 'pan-y' }}
>
  {/* Content */}
</div>

// useMobileSheet.ts - Fix drag handler
const bind = useDrag(
  ({ movement: [, my], velocity: [, vy], last, canceled, first, memo }) => {
    if (canceled) return;
    
    // Capture initial position on first drag frame
    if (first) {
      memo = y.get();
    }
    
    if (last) {
      // Snap logic...
    } else {
      const newY = memo + my;
      api.start({ y: newY, immediate: true });
    }
    
    return memo;  // Return memo to persist it
  },
  {
    from: () => [0, y.get()],
    bounds: screenHeight > 0 ? {
      top: screenHeight * (1 - SNAP_POINTS[SNAP_POINTS.length - 1]),
      bottom: screenHeight * (1 - SNAP_POINTS[0]),
    } : undefined,
  }
);

// Fix transform application
<animated.div
  style={{
    transform: y.to(yVal => `translateY(${yVal}px)`),
  }}
>

// Implement backdrop close
onClick={() => sheet.close()}
```

**Priority:** P0 — Core mobile navigation is broken

---

### 3. MobileStationCard Buttons Don't Work (Mobile)

**Location:** `src/components/mobile/MobileStationCard.tsx` (Lines 29-42)

**Symptoms:**
- Tapping on station cards doesn't reliably trigger click
- Sometimes requires multiple taps
- Buttons feel unresponsive

**Root Cause Analysis:**

```tsx
// PROBLEM: Double event handlers with conflicting preventDefault
<button
  type="button"
  onClick={handleClick}
  onTouchEnd={(e) => {
    e.preventDefault();  // This BLOCKS the click event from firing!
    handleClick(e);
  }}
>
```

The `onTouchEnd` handler calls `e.preventDefault()` which prevents the `onClick` from firing. The intention was to prevent double-firing, but the implementation is backwards.

**Additional Issue:** `stopPropagation()` may be too aggressive:

```tsx
const handleClick = (e: React.MouseEvent | React.TouchEvent) => {
  e.stopPropagation();  // Might interfere with sheet interactions
  onClick();
};
```

**Recommended Fix:**

```tsx
// Option 1: Remove onTouchEnd entirely (recommended for most cases)
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    onClick();
  }}
  className="mobile-station-card w-full text-left"
  style={{ touchAction: 'manipulation' }}  // Optimize for touch
>

// Option 2: Use a more robust touch handler
const handleInteraction = useCallback((e: React.MouseEvent | React.TouchEvent) => {
  e.stopPropagation();
  
  // Debounce to prevent double-firing
  if (e.type === 'touchend') {
    // Mark that touch just fired
    touchFiredRef.current = true;
    setTimeout(() => { touchFiredRef.current = false; }, 100);
    onClick();
  } else if (e.type === 'click' && !touchFiredRef.current) {
    onClick();
  }
}, [onClick]);
```

**Priority:** P0 — Primary interaction is broken

---

## P1 — High Priority Issues

### 4. Close Button Hit Area Too Small (Desktop)

**Location:** `src/components/station/StationDetailPanel.tsx` (Line 131)

**Issue:** The close button is too small for comfortable clicking. Design audit specifies 40x40px hit area.

**Recommended Fix:**

```tsx
<button
  onClick={onClose}
  className="absolute top-4 right-4 p-2 w-10 h-10 flex items-center justify-center
             rounded-full hover:bg-gray-100 transition-colors"
>
  <X className="w-5 h-5" />
</button>
```

**Priority:** P1 — Poor usability

---

### 5. StationRow Hover Elevation Too Subtle (Desktop)

**Location:** `src/components/station/StationRow.tsx` (Lines 50-62)

**Current State:**

```tsx
<div
  className={cn(
    "group relative p-4 cursor-pointer transition-all duration-200",
    "hover:translate-y-[-2px] hover:shadow-lg rounded-lg",  // Too subtle
    selected && "bg-white/60 backdrop-blur-sm shadow-md",
  )}
>
```

**Recommended Fix:**

```tsx
<div
  className={cn(
    "group relative p-4 cursor-pointer transition-all duration-200",
    "hover:translate-y-[-4px] hover:shadow-xl hover:shadow-black/10 rounded-lg",
    selected && "bg-white/60 backdrop-blur-sm shadow-lg ring-2 ring-primary/20",
  )}
>
```

**Priority:** P1 — Doesn't meet design standards

---

### 6. Body Touch-Action Conflicts (Mobile)

**Location:** `src/components/mobile/MobileStationDetail.tsx` (Lines 121, 128, 134)

**Issue:** Both `MobileBottomSheet` and `MobileStationDetail` manipulate `document.body.style.touchAction`. When both are open/transitioning, they conflict.

```tsx
// MobileStationDetail sets:
document.body.style.touchAction = 'none';

// MobileBottomSheet also sets body styles
// Not coordinated = conflicts
```

**Recommended Fix:**

Create a centralized body style manager:

```tsx
// hooks/useBodyScrollLock.ts
const lockStack = new Set<string>();

export function useBodyScrollLock(id: string, shouldLock: boolean) {
  useEffect(() => {
    if (shouldLock) {
      lockStack.add(id);
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    } else {
      lockStack.delete(id);
      if (lockStack.size === 0) {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
      }
    }
    
    return () => {
      lockStack.delete(id);
      if (lockStack.size === 0) {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
      }
    };
  }, [id, shouldLock]);
}
```

**Priority:** P1 — Causes cascading mobile issues

---

### 7. Screen Height Initialization Race Condition (Mobile)

**Location:** `src/hooks/useMobileSheet.ts`, `src/components/mobile/MobileStationDetail.tsx`

**Issue:** Both components independently calculate screen height, and initial renders can have `screenHeight = 0`, causing incorrect positioning.

**Recommended Fix:**

Create a shared hook:

```tsx
// hooks/useScreenHeight.ts
export function useScreenHeight() {
  const [height, setHeight] = useState(
    typeof window !== 'undefined' ? window.innerHeight : 0
  );
  
  useEffect(() => {
    const updateHeight = () => setHeight(window.innerHeight);
    updateHeight();  // Ensure we have correct value after hydration
    
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', updateHeight);
    
    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
    };
  }, []);
  
  return height;
}
```

**Priority:** P1 — Causes positioning bugs

---

### 8. Missing Scroll Lock Coordination (Mobile)

**Location:** `src/components/mobile/MobileBottomSheet.tsx` (Lines 38-48)

**Issue:** Body overflow is set based on `snapIndex >= 2` without checking if the detail panel is also open, causing double scroll locks or incorrect unlocking.

**Priority:** P1 — Causes scroll issues

---

## P2 — Medium Priority Issues

### 9. Pull-to-Refresh Conflicts with Drag (Mobile)

**Location:** `src/components/mobile/MobileBottomSheet.tsx` (Lines 120-127)

**Issue:** The `onTouchMove` handler for pull-to-refresh interferes with sheet dragging.

**Recommended Fix:** Use proper scroll detection or a pull-to-refresh library.

**Priority:** P2 — Occasional UX issues

---

### 10. Detail Panel Drag Handler Issues (Mobile)

**Location:** `src/components/mobile/MobileStationDetail.tsx` (Lines 145-162)

**Issue:** Drag handler doesn't check scroll position, so users can accidentally close the detail panel while scrolling content.

**Priority:** P2 — Occasional accidental closes

---

### 11. Motion Token Stiffness May Be Too High (Desktop)

**Location:** `src/lib/motion/tokens.ts` (Lines 106-120)

**Current:**

```typescript
stiffness: 500,  // Might feel too snappy
damping: 30,
```

**Consideration:** Test with lower stiffness (400) for smoother feel per design audit.

**Priority:** P2 — Polish

---

### 12. Dark Mode Verification Needed (Desktop)

**Location:** Multiple files

**Issue:** Dark mode CSS variables exist, but some components may not fully respect them.

**Priority:** P2 — Incomplete feature

---

### 13. Haptic Feedback Spam (Mobile)

**Location:** Various mobile components

**Issue:** Haptic feedback fires on every drag movement instead of only on snap point changes.

**Recommended Fix:**

```tsx
const prevSnapIndex = useRef(snapIndex);

useEffect(() => {
  if (prevSnapIndex.current !== snapIndex) {
    haptic.impact('light');
    prevSnapIndex.current = snapIndex;
  }
}, [snapIndex, haptic]);
```

**Priority:** P2 — Battery drain, vibration fatigue

---

## P3 — Low Priority / Polish

### 14. Mobile Filter Scroll Has No Indicators

**Location:** `src/components/mobile/MobileFilterScroll.tsx`

**Issue:** No visual indication that the filter bar is horizontally scrollable.

**Recommended Fix:** Add gradient fade on edges.

**Priority:** P3 — Polish

---

### 15. Typography Font Loading Verification

**Location:** `src/app/globals.css`

**Issue:** Need to verify fonts are properly loaded and applied.

**Priority:** P3 — Polish

---

### 16. Mobile Keyboard Handling

**Location:** `src/components/mobile/MobileSearchBar.tsx`

**Issue:** Search bar doesn't handle mobile keyboard properly (no blur on scroll, keyboard can cover content).

**Priority:** P3 — Edge case

---

## Design Audit Compliance Summary

| Requirement | Status | Notes |
|-------------|--------|-------|
| Snap points (25%, 50%, 90%) | ✅ Implemented | |
| Spring physics animations | ✅ Implemented | Using React Spring |
| Pull-to-refresh | ❌ Removed | Was causing conflicts, removed entirely |
| Haptic feedback | ✅ Implemented | But fires too often |
| Floating search bar | ✅ Implemented | |
| Condensed station cards | ✅ Implemented | |
| Ghost Score animation | ✅ Implemented | Gauge with react-spring |
| Custom scrollbars | ✅ Implemented | In glassmorphism.css |
| Skeleton loading | ✅ Implemented | StationCardSkeleton.tsx |
| Dark mode | ⚠️ Partial | CSS vars exist, needs verification |
| Station hover effects | ⚠️ Subtle | Needs enhancement |
| Map marker selected state | ✅ Fixed | Marker now always visible when selected |
| FAB opens sheet | ❌ Broken | Requires double-click |

---

## Recommended Implementation Order

### Week 1 — P0 Critical Bugs

1. **Fix StationMarker disappearing** (`MapContainer.tsx`)
   - Ensure selected station is included at every filter stage
   - Add protection against bounds race condition
   - Estimated effort: 2-3 hours

2. **Fix MobileBottomSheet instability** (`MobileBottomSheet.tsx`, `useMobileSheet.ts`)
   - Restrict drag handle to indicator only
   - Fix memo pattern in drag handler
   - Fix transform application
   - Implement backdrop close
   - Guard screen height initialization
   - Estimated effort: 4-6 hours

3. **Fix MobileStationCard clicks** (`MobileStationCard.tsx`)
   - Remove conflicting `onTouchEnd` handler
   - Add `touchAction: manipulation` style
   - Estimated effort: 1 hour

### Week 2 — P1 High Priority

4. **Centralize body style management**
   - Create `useBodyScrollLock` hook
   - Update both sheet components to use it
   - Estimated effort: 2-3 hours

5. **Create shared screen height hook**
   - Implement `useScreenHeight` hook
   - Update all components using window.innerHeight
   - Estimated effort: 1-2 hours

6. **Fix close button hit area**
   - Increase to 40x40px
   - Estimated effort: 30 minutes

7. **Enhance StationRow hover**
   - Increase elevation and shadow
   - Add ring for selected state
   - Estimated effort: 30 minutes

### Week 3 — P2 Medium Priority

8. **Fix pull-to-refresh conflicts**
9. **Fix detail panel drag handler**
10. **Optimize haptic feedback**
11. **Verify dark mode**
12. **Tune motion token stiffness**

### Week 4 — P3 Polish

13. **Add scroll indicators to filters**
14. **Verify typography loading**
15. **Improve keyboard handling**

---

## Files Requiring Changes

### Priority Order

| File | Changes | Priority |
|------|---------|----------|
| `src/components/map/MapContainer.tsx` | Fix marker filtering | P0 |
| `src/components/mobile/MobileBottomSheet.tsx` | Multiple fixes | P0 |
| `src/hooks/useMobileSheet.ts` | Fix drag handler | P0 |
| `src/components/mobile/MobileStationCard.tsx` | Fix click handler | P0 |
| `src/components/mobile/MobileStationDetail.tsx` | Fix body styles, drag | P1 |
| `src/components/station/StationDetailPanel.tsx` | Close button size | P1 |
| `src/components/station/StationRow.tsx` | Hover enhancement | P1 |
| `src/hooks/useBodyScrollLock.ts` | New file | P1 |
| `src/hooks/useScreenHeight.ts` | New file | P1 |
| `src/lib/motion/tokens.ts` | Tune stiffness | P2 |
| `src/components/mobile/MobileFilterScroll.tsx` | Scroll indicators | P3 |

---

## Fixes Implemented (February 1, 2026)

### Desktop Fixes

| File | Change | Status |
|------|--------|--------|
| `src/components/map/MapContainer.tsx` | Selected station marker now rendered **separately and unconditionally** - guaranteed to always show when a station is selected | ✅ Fixed |

### Mobile Fixes

| File | Change | Status |
|------|--------|--------|
| `src/components/mobile/MobileStationCard.tsx` | Removed conflicting onTouchEnd handler, added touchAction: manipulation | ✅ Fixed |
| `src/components/mobile/MobileStationDetail.tsx` | Split useEffect to prevent animation re-trigger, uses useBodyScrollLock, drag respects scroll position, fixed console errors (Share AbortError, geo: URI), added touch-action: none to drag target | ✅ Fixed |
| `src/components/mobile/MobileBottomSheet.tsx` | Drag restricted to indicator only, backdrop close works, removed unused refresh code | ✅ Fixed |
| `src/hooks/useMobileSheet.ts` | Fixed memo pattern, fixed velocity direction, guarded bounds, openTo() now sets isHidden=false | ✅ Fixed (partial) |
| `src/hooks/useBodyScrollLock.ts` | New hook for coordinated scroll lock management | ✅ Created |
| `src/components/mobile/MobileLayout.tsx` | Changed to show top 25 ghostiest stations (matching desktop behavior) | ✅ Fixed |
| `src/components/mobile/MobileViewListFAB.tsx` | Updated display text to "Top {count}" | ✅ Fixed |

---

## Testing Checklist

After implementing fixes:

- [x] Desktop: Click station in list → marker stays visible on map ✅
- [ ] Desktop: Hover station card → visible elevation change
- [ ] Desktop: Close button on detail panel → easy to click
- [ ] Mobile: Drag sheet by indicator → smooth, snaps correctly
- [ ] Mobile: Drag sheet by header text → doesn't drag
- [x] Mobile: Tap station card → responds on first tap ✅
- [ ] Mobile: Scroll content in sheet → doesn't move sheet
- [ ] Mobile: Tap backdrop → closes sheet
- [ ] Mobile: FAB click → opens sheet on FIRST click ❌ **NOT WORKING**
- [ ] Mobile: Click station → detail opens and stays open ✅
- [ ] Mobile: Test on iOS Safari and Chrome Android
- [ ] Mobile: Test in landscape orientation

---

## Remaining Work

### P0 Critical (Still Broken)

| Priority | Task | Status |
|----------|------|--------|
| P0 | **MobileViewListFAB requires double-click to open sheet** | ❌ Not Fixed |

**Root Cause Analysis Needed:** The `openTo()` function in `useMobileSheet.ts` was updated to set `isHidden = false`, but the issue persists. Further investigation required into:
- The interaction between `isHidden` state and the animation
- Possible race condition between state updates and spring animation
- Whether the sheet is actually hidden or just positioned off-screen on first click

### P1-P3 (Pending)

| Priority | Task | Status |
|----------|------|--------|
| P1 | Increase close button hit area (StationDetailPanel) | Pending |
| P1 | Enhance StationRow hover effects | Pending |
| P2 | Tune motion token stiffness | Pending |
| P2 | Verify dark mode | Pending |
| P2 | Optimize haptic feedback | Pending |
| P3 | Add scroll indicators to filters | Pending |
| P3 | Verify typography loading | Pending |
| P3 | Improve keyboard handling | Pending |

---

**Document Version:** 1.2  
**Prepared By:** AI Code Review  
**Last Updated:** February 1, 2026  
**Status:** 1 P0 bug remaining (FAB double-click)
