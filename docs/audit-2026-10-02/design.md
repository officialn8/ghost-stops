# Ghost Stops - Design Audit and Proposed Direction

Date: 2026-10-02
Scope: audit + direction only. No source files were modified. One non-source file was created: `.claude/launch.json` (dev-server config for the browser preview tool).
Method: skill `design-taste-frontend` (Section 11, redesign protocol). Note that the skill declares dense data UI out of scope, so its anti-slop, typography, color, motion and a11y rules are applied, while density and encoding decisions below come from data-visualization practice rather than the landing-page rules.

**Design read:** redesign - overhaul of a civic data-journalism web app (ranked list + map + station dossier) for a design-literate audience (recruiters, transit people, Chicago readers), with a cartographic / wayfinding language, leaning toward Tailwind + Motion + a custom Mapbox style and no component kit beyond Radix primitives.

**Dials (current, inferred):** DESIGN_VARIANCE 4 (symmetrical floating panels), MOTION_INTENSITY 8 (18 infinite loops), VISUAL_DENSITY 6.
**Dials (target):** DESIGN_VARIANCE 6, MOTION_INTENSITY 4, VISUAL_DENSITY 6.

---

## 0. Screenshots

Saved to `screens/`:

| File | What it shows |
|---|---|
| `01-desktop-dark-main.jpg` | 1440x900, dark theme (system default on this machine). Ranked list, map, line filter. |
| `02-desktop-dark-detail-failed.jpg` | Halsted selected. Map flew to zoom 14, marker pill shown, detail panel rendered its header then "Failed to load station details". |
| `03-desktop-light-detail-failed.jpg` | Same state after toggling to light theme. |
| `04-mobile-light-main.jpg` | 375x812. Full-bleed map, floating search, filter row, bottom sheet peeking at 25%. |

What could not be captured and why:
- **Station detail content** (gauge, metrics, comparisons, story, chart). `src/app/api/chicago/stations/[id]/route.ts` line 43 uses Postgres-only SQL (`MAX("serviceDate") - INTERVAL '90 days'`), which fails on the local SQLite db with `no such column: INTERVAL`. The detail panel and mobile detail were therefore audited from code (`StationDetailPanel.tsx`, `MobileStationDetail.tsx`) plus the component tree, not from pixels.
- **Mobile bottom sheet expanded and mobile detail.** Under the browser tool's mouse emulation, dragging the sheet (handle or header) panned the map underneath, tapping the vaul handle did nothing, and tapping a station dot did not open the detail. `document.elementFromPoint` confirmed the drawer was the top element at the drag origin, so this may be a pointer-vs-touch quirk of vaul in the emulator rather than a real-device bug. Treat it as unverified, not as broken.
- Build note (not design): `npm run dev` uses Turbopack, which failed on `next/font/google` because Next infers the workspace root from a stray `/Users/nate/package-lock.json`. The launch config runs `npx next dev -p 3000` (webpack) instead. Removing the stray lockfile or setting `turbopack.root` would fix the default script.

---

## 1. Prior design context: planned vs shipped

| Document | What it planned | What actually shipped |
|---|---|---|
| `docs/UI Overhaul Design Audit.md` (Jan 2026) | Glass sidebar with noise, "mini bento" rows, gradient rank tiles, circular score gauge, filter pills with glow, Space Grotesk + Inter + JetBrains Mono on a perfect-fourth scale, dark mode, custom desaturated Mapbox style, concentric marker rings, clustering, infinite scroll, FAB "143 stations - 47 ghost stops", shared-element list-to-detail transitions, 2x2 stats bento with Peak Hour and Trend. | Glass everywhere (7 glass classes), bento rows, gradient rank tiles, ring in rows + gauge in detail, filter pills, dark mode, three font families loaded plus Fraunces still loaded but unused. **Not shipped:** custom Mapbox style (stock `light-v11`/`dark-v11`), clustering, infinite scroll (hard cap at 25), FAB (component exists, never mounted, its CSS class is never defined), shared-element transitions, Peak Hour. |
| `docs/design-overhaul.md` | "Design Tokens v2": Indigo #4F1271 / Wisteria / Ocean / Emerald brand set, Fraunces display + Inter UI, and a **remixed CTA line palette** ("Vibrant Coral", "Atomic Tangerine", "Chocolate Plum", "Bright Lemon") explicitly "NOT official CTA colors". | Tokens landed in `tailwind.config.ts` and `globals.css`. Fraunces was superseded by Space Grotesk in `typography.css` but never removed from `layout.tsx`. The remixed line palette is what the map and badges use today, while `src/lib/utils.ts` still carries the official CTA palette that nothing renders. |
| `docs/review-2026-02-01.md` | Verdict "not yet Awwwards". P2 "UI/UX Elevation" marked complete: motion orchestration, elevation tokens, typography standardization, premium chart and skeletons. | Motion tokens and stagger variants exist. "Typography standardized" is not true in the code: three parallel type systems coexist (Tailwind `text-ui-*`/`text-display-*` tokens, CSS classes `.stat-value-text` etc., and raw `text-2xl font-bold` / `text-[9px]` in mobile and marker components). Mobile detail uses none of the design tokens. |
| `docs/ui-review-findings.md` | P0/P1 bug list for desktop and mobile. | Most marked fixed. The "FAB requires double click" item was resolved by not rendering the FAB at all. The scroll-lock and screen-height hooks exist. |
| `docs/facts-narrative-system.md` | Facts layer + templated archetype narratives with citations; top-25 placeholder facts; quality flags. | `StationStory`, `FactCard`, `SourcesCitation` exist and are wired into both detail views. Archetypes carry emoji. Quality pills use `text-emerald-300/90` style colors tuned for a dark surface but rendered on light glass. |
| `.claude/CLAUDE.md` | Sparklines in the list via `GET /api/chicago/stations`; score thresholds 65/50/35/20; max observed ~72. | The list actually fetches `/api/chicago/stations-raw`, which returns no `sparkline` field, so **the list sparkline never renders** (confirmed in the running app; `Sparkline.tsx` is effectively dead in the list). Real score range in the local db is 22 to 67, mean 47.4. |

Summary: the January plan was executed as a *skin* (glass, gradients, loops, four fonts) on top of an unchanged information architecture. The things that would have changed how the product reads (custom map style, score encoding, routing, mobile detail hierarchy) were not done.

---

## 2. Inventory of the current UI

### 2.1 Typography
- Loaded via `next/font/google` in `layout.tsx`: **Inter** (body), **Fraunces** (unused), **Space Grotesk** (display: logo, station names, scores), **JetBrains Mono** (numbers). Four families, three in use.
- Scales defined three times: Tailwind `fontSize` (`display-1..3`, `ui-xl..xs`), `typography.css` CSS variables (perfect fourth, 12 to 67px), and ad-hoc pixel sizes (`text-[9px]`, `text-[10px]`, `text-[11px]`, `text-[12px]`) in `NeighborPills`, `StationMarker`, `FactCard`, `SourcesCitation`, `CTALineBadge`.
- Smallest live text: 9px (neighbor score chips, quality pills), 10px (compact markers, source status). Uppercase 0.08em tracked micro-labels on quality pills and source status (the skill's eyebrow tell, in miniature).
- Station name in list: 16px/600 Space Grotesk; in detail header: 36px/600; in mobile detail: 24px/700 Inter (different family, no token).
- Numbers: mono in list and desktop stats; proportional bold in mobile cards (`.ghost-score-value` 24px/800 red).

### 2.2 Color
- Four overlapping token systems in `globals.css` + `tailwind.config.ts`: shadcn HSL vars (`--primary` Indigo, `--secondary` Emerald, `--accent` Ocean), "Design Tokens v2" named colors, legacy `--bg-primary`/`--dm-text-*` dark-mode vars, and glass/skeleton/scrollbar vars.
- **Three CTA line palettes** in code: official (`src/lib/utils.ts`), remix (`src/lib/ctaLineColors.ts`), remix duplicate (`src/lib/cta/explodeSegments.ts`). Map tracks, badges, filter pills and rank tiles use the remix. The Green line renders as mint #06D6A0, Red as coral #F25757, Purple as the brand Indigo (so brand color = Purple line color).
- **Five ghost-score scales**: `getGhostScoreColor` in `utils.ts` (red/orange/amber/lime/green at 65/50/35/20), `StationRow` ring (Tailwind class thresholds 65/50/35), `StationMarker` (adds purple at 80+, which never occurs), desktop map circle interpolate (stops 0/20/40/60/80), mobile map circle interpolate (stops 0/50/70). None agree.
- Score distribution in the db: 22 to 67. With thresholds at 35 and 50, **117 of 143 stations fall in the amber/orange bands**; only 9 are "red" and 17 "green". On screen the whole system reads amber. The traffic-light scale has no dynamic range and collides with the Red, Orange, Yellow and Green line colors.
- Dark mode is implemented three ways: `[data-theme="dark"]` (globals, glassmorphism), `.dark` class (Tailwind `dark:` in NeighborPills, ComparisonBars, FilterScroll), and `@media (prefers-color-scheme: dark)` in `mobile.css`. The last one ignores the in-app toggle: in screenshot 04 the app is in light theme but the mobile search bar is dark because the OS is dark.
- Selection color emerald, focus ring ocean, logo gradient indigo to wisteria to emerald, section-header icon circles in indigo/emerald, blue/purple, amber/orange. Accent count is effectively six.

### 2.3 Spacing, radius, surfaces
- Radius tokens: `ui` 14, `ui-sm` 12, `ui-lg` 16, `panel` 18/20/22, `--radius` 16 (so Tailwind `rounded-lg` = 16, `rounded-md` = 14, `rounded-sm` = 12), plus `rounded-full` pills and `rounded-lg` marker labels. Mobile uses `rounded-lg` boxes and a `rounded-t-[20px]` sheet. Consistent-ish by accident, not by rule.
- Surfaces: `.glass`, `.glass-solid`, `.glass-sidebar`, `.glass-panel`, `.glass-card`, `.glass-button`, `.glass-overlay`, plus `.noise-texture`, `.gradient-overlay-top`, `.gradient-overlay-edge`. Three separate inline-SVG `feTurbulence` noise data URIs. Cards inside glass panels inside a glass app (`glass-solid` metric cards inside `glass-panel` detail).
- Desktop layout: fixed `TopBar` 64px; list panel `fixed left-6 top-24 bottom-6 w-96`; detail `fixed right-6 top-24 bottom-6 w-[420px]`; filter `absolute top-20 right-4`. At 1440px the map gets roughly 560px of unobstructed width when a station is open.
- Padding rhythm: `p-6 pb-4` headers, `px-6 mb-6` sections, `p-4`/`p-5` cards, `gap-3`/`gap-4`. Reasonable, but every section is boxed so rhythm comes from borders, not space.

### 2.4 Component patterns
- `StationRow`: rank tile (gradient fill of line color), name, line pills, user icon + mono count, (sparkline slot, never populated), 56px circular ring with number and a floating ghost icon. Hover: CSS `translateY(-4px)` + `shadow-xl` AND Framer `whileHover { scale 1.02, x 8, boxShadow }` on the wrapper, so two transforms animate at once.
- `StationDetailPanel`: header (name, badges, 96px ghost icon at 5% opacity), then 8 stacked sections: gauge, 2x2 metrics, "Why is this a ghost stop?", "How It Compares", story, neighbors, 90-day chart, station ID + coordinates. Three sections open with an icon in a tinted gradient circle next to a title (the shadcn/Linear-clone section header).
- `GhostScoreGauge`: 128px ring, count-up, blurred radial glow, second glow ring, gradient-clipped number, three floating ghost "particles" above 65, pulsing border ring above 55.
- `ComparisonBars`: filled track bars (`bg-neutral-100` with colored fill), percent deltas colored red/green.
- `StationMarker` (DOM `<Marker>` per station, up to 25 at a time): score-colored label pill with inline score chip, line initial dots, triangle pointer, radial aura loop above 70, floating ghost SVG above 65, pulse ring above 85. Each marker carries 1 to 3 infinite Framer loops.
- `MapTooltip`: hover-only glass card below zoom 12.
- `LineFilter`: 8 pills in a glass box, active = filled with line color + glow.
- Mobile: `MobileSearchBar` (pill), `MobileFilterScroll` (pills with initial-in-circle), vaul `MobileBottomSheet` (25/50/90 snap), `MobileStationCard` (rank 18px/800, name 14px, initial dots, red 24px score), `MobileStationDetail` (30vh static map with a **hard-coded red** score disc regardless of score, then eight `bg-muted rounded-lg` gray boxes in a column, fixed Navigate/Share bar).

### 2.5 Motion
- Runtimes: Framer Motion, React Spring, CSS keyframes (`animations.css`, `globals.css`, Tailwind `animation`), vaul, `@use-gesture`. Five.
- Infinite loops counted in components and styles: 18 definitions. Live on the default desktop screen: logo pulse + ring pulse + float (3), 25 list rows each with a floating ghost icon (25), watermark float (1), filter pill shimmer hooks, skeleton shimmer. After selecting a station add: gauge pulse, glow pulse, up to 3 particles, pulse ring, and per-marker aura/ghost/ring loops. Roughly 30 to 50 concurrent infinite animations is normal operating state.
- `prefers-reduced-motion` is handled only in `mobile.css` for pill/card transitions. No `useReducedMotion` anywhere. Every loop above runs for users who asked for reduced motion.
- Motivated motion that exists and is worth keeping: list stagger on load, panel enter/exit, score count-up, gauge fill, chart draw, map flyTo (currently a hard `setViewState` to zoom 14 with no padding, so the selected station lands under the detail panel's left edge).

### 2.6 Iconography and illustration
- `lucide-react` (20 glyphs) at mixed stroke widths. Acceptable per the skill since it is an existing dependency, but see below.
- Three different hand-rolled ghost SVG paths (TopBar logo, `GhostWatermark`, `StationMarker` `GhostIcon`) plus the lucide `Ghost` glyph: four ghost shapes in one product.
- Emoji as archetype icon in `StationStory` (`narrative.archetype.emoji`).

### 2.7 States
- Loading: list skeleton (10 rows), detail skeleton, chart skeleton with a fake wave, map loading = pulsing gradient disc + "Loading stations...". Fine.
- **Empty search is broken**: `StationList` shows the skeleton whenever `loading || topStations.length === 0`, so searching for a non-matching string shows an infinite shimmer instead of "No stations match".
- **Fetch failure for the station list** also shows the skeleton forever (same condition). No error state exists for the primary data load.
- Detail error: a single centered sentence, no retry, no cause.
- Missing data: em dash "—" used as the placeholder value in 23 places.
- Data freshness: TopBar shows a green dot + "Live Data" while the list says "Updated: 11/29/2025" (ten months old on the day of this audit). The two claims are side by side on screen 01.

### 2.8 Accessibility
- `StationRow` is a `div` with `onClick` wrapped in a `motion.div` with `onClick`: not focusable, not a button, no keyboard path to the primary action. Neither the list nor the map is keyboard operable.
- List collapse button has no `aria-label`. Filter pills have no `aria-pressed`. Sort is not exposed at all.
- Touch targets: neighbor pills are ~28px tall with 11px text and a 20px score chip; `FactCard` info button is `opacity-0 group-hover:opacity-100`, so it does not exist on touch devices; `MapTooltip` is hover-only.
- Contrast (light theme, computed from token values): `text-tertiary` rgba(11,18,32,0.52) on #F6F7FB is about 4.0:1 and is used at 12px and 10px (fails AA for small text). White on Yellow line #F7E733 is about 1.3:1 (the "Yellow" filter pill is unreadable in screenshot 01, and every Yellow badge in the list). White on Orange #F58549 about 2.6:1. White on amber #F59E0B score chips in `NeighborPills` about 2.1:1. Quality pills use `text-emerald-300/90` on light glass, well under 3:1.
- `mobile.css` disables text selection on all interactive content and forces `background-color: inherit !important` on `:active`, removing the system pressed state. It does set a visible `:focus-visible` outline, which is good.
- No `prefers-reduced-motion` coverage for 18 looping animations.

### 2.9 Mobile
- Map-first with a peeking sheet is the right model. Problems: the filter row scrolls off the right edge with no affordance at the first paint; the sheet header title duplicates the desktop "Ghostiest Stations" label plus a sub-line; the sheet only becomes scrollable at the 90% snap (content locked at 25% and 50%), which is a documented choice but surprising.
- `MobileStationDetail` has no design-token usage: it is a stack of eight identical gray boxes, the hero disc is always red, the chart lives inside a box inside a box (the `RidershipChart` already renders its own `glass-solid` box), and the fixed bottom action bar (Navigate / Share) steals 80px for two actions that are secondary to the content.
- Theme mismatch (section 2.2) makes the search bar dark on a light app when the OS is dark.
- `h-screen` is used on the root (`page.tsx`), which the skill flags for iOS Safari; mobile layout itself uses `fixed inset-0`, which is fine.

### 2.10 Map styling
- Stock Mapbox `light-v11` / `dark-v11` with full POI and road labels competing with station labels ("Kennedy-King College", "Hamburger Heaven" in screenshot 02).
- Track rendering (`explodeAndStitchSegments`) with per-line offsets and casing is genuinely good and is the strongest visual asset in the product. It is undersold by the stock basemap and by the amber dot soup on top of it.
- Station encoding: fill = ghost score (amber soup), halo = ghost score, stroke = selection. Line membership is only visible via label pills at zoom 12+. So at the default zoom the map tells you nothing about *which line* a ghost station is on, which is the first question a Chicago reader asks.
- Marker labels are DOM elements (25 at a time, each with loops). A Mapbox `symbol` layer with collision detection would be cheaper and would look like a map instead of a dashboard pinned to a map.
- Camera: `setViewState` jump to zoom 14 with no `padding`, so the selected station sits under the detail panel's edge (visible in 02).

### 2.11 Dead or half-finished UI
- `MobileViewListFAB.tsx` (unused; class `.mobile-view-list-fab` never defined).
- `GhostScoreHero.tsx` (unused; superseded by `GhostScoreGauge`).
- `GhostScoreBadge.tsx` used only in the hover tooltip.
- Fraunces font loaded, never used. `--font-fraunces` listed as a fallback only.
- `src/lib/ctaLineColors.ts` `getMockLinesForStation` deprecated stub.
- `animations.css`: `.stagger-list`, `.panel-enter`, `.panel-content-item`, `.breathe`, `.ghost-score-number`, `.map-marker-*` classes are defined and never applied (Framer does this work now).
- `glassmorphism.css`: `.glass-button`, `.glass-overlay` unused.
- Sparkline slot in `StationRow` (never receives data from `stations-raw`).
- `GhostScoreGauge` purple band and `StationMarker` 80+/85+ states are unreachable (max score 67).
- List footer "Showing top 25 of 143 stations" with no way to see the other 118.
- "Station ID: 4735d059..." and raw coordinates at the bottom of the detail panel (debug output shipped as content).
- `console.log("API Response", ...)` and track-segment logs run in production.
- No URL state: selecting a station changes nothing in the address bar, so no station is linkable or shareable (the mobile Share button shares the homepage).

---

## 3. Audit verdicts

### 3.1 What reads as generic / templated AI design
1. **Glass + noise + gradient on every surface.** Seven glass classes, three noise overlays, gradient rank tiles, gradient line badges, gradient-clipped score numbers, gradient logo text. This is the 2024 "premium SaaS" skin and it hides the data.
2. **Icon-in-tinted-circle section headers** ("Why is this a ghost stop?", "How It Compares", archetype emoji disc). Linear/shadcn clone pattern.
3. **Traffic-light score semantics** (red = bad) on a product whose own brand colors are Red, Orange, Yellow and Green *lines*. Semantic collision plus zero dynamic range.
4. **Decorative status dots** in the nav ("143 Stations", "Live Data"), and the second one is false.
5. **Ambient infinite loops as personality**: floating ghosts in every row, pulsing rings, particles, shimmer sweeps. Motion that communicates nothing, and it is unmotivated per the skill's own rule.
6. **Four font families**, Inter for body, a "display" grotesk for emphasis, a serif loaded for nothing.
7. **Cards inside cards** in both detail views; eight boxes in a column on mobile.
8. **Remixed brand palette** ("Vibrant Coral", "Atomic Tangerine", "Lavender Blush") that makes the CTA lines look like a fintech app rather than Chicago. The real CTA palette is already a strong, recognizable identity; replacing it is the single biggest self-inflicted loss of distinctiveness.
9. Filled-track progress bars as comparison visuals (explicitly flagged in the skill's tell list).
10. Debug output (IDs, coordinates, console logs) shipped as UI.

### 3.2 What is distinctive and must survive
1. **The concept and name.** "Ghost stop" is a sticky editorial framing. The score explanation + percentile + context type (terminal / transfer / normal) is real analysis, not a vanity metric.
2. **The narrative system**: archetypes ("The Suburban Shift", "Car Culture Won") backed by cited facts with methodology and source links. This is the journalism layer and nobody else's transit viz has it. It is currently buried in the seventh box of a side panel.
3. **The network rendering**: offset parallel tracks, Loop stitching, casing. Keep `explodeAndStitchSegments` and the GeoJSON pipeline untouched.
4. **Line-sequence navigation** (`stationSequences.ts`, `NeighborPills`): moving along the line to the previous/next station is a transit-native interaction. Keep the data, redesign the control.
5. **Comparisons** vs system median, line median, neighbor average: the right three baselines. Keep the calculation, change the visual (no tracks).
6. **The 90-day chart and the 7-day sparkline** (once the list is fed from the right endpoint).
7. **Mobile model**: full-bleed map, peeking sheet, detail with a map preview at the top. Keep the skeleton of `MobileLayout`.
8. Chicago itself: the `L` is one of the few transit systems whose signage, map and colors are globally recognizable. Lean into it instead of away from it.

### 3.3 Hierarchy and density problems
- The product has one hero number (ghost score) repeated five ways (dot color, halo, ring, gauge, marker pill) while the actual observation (riders per day) is 11px mono next to a user icon. Flip this: ridership is the fact, ghost score is the index.
- The ranked list is the primary navigation but it is a floating card over the map, cut to 25 rows, with a footer that admits there are 118 more. It should be a first-class column with sort, filter and full scroll.
- The detail panel treats every section equally (same box, same header style). A dossier needs an order: who/where (sign), how empty (the number vs baselines), why (story + evidence), trend (chart), then neighbors.
- Three floating panels plus a filter box all fight the map; nothing is anchored. The map ends up ~560px wide on a 1440px screen while surrounded by 450px of chrome on each side.
- Density is actually right for a data product (6/10). The problem is not amount, it is that everything is boxed and glowing, so there is no quiet.

### 3.4 Accessibility issues (prioritized)
1. Primary action (select a station) is not keyboard reachable. P0.
2. White text on Yellow / Orange / amber chips fails contrast badly. P0.
3. 18 infinite animations with no reduced-motion gate. P1.
4. 9 to 12px tertiary text below AA. P1.
5. Hover-only affordances (fact methodology, map tooltip) on touch. P1.
6. No `aria-pressed` on filters, no `aria-label` on collapse, no live region when the list changes. P2.
7. Global `user-select: none` and suppressed `:active` on mobile. P2.

### 3.5 Mobile problems (prioritized)
1. Detail view has no hierarchy and no tokens; hero disc hard-coded red. P0 for a redesign.
2. Theme mechanism mismatch (OS vs app toggle) in `mobile.css`. P1.
3. No shareable station URL, so the Share button is meaningless. P1.
4. Fixed 80px action bar for two secondary actions. P2.
5. Filter row lacks an overflow affordance at first paint; sheet header text duplicates. P2.
6. Sheet gesture could not be verified in emulation; verify on device before trusting vaul config. Unknown.

---

## 4. Design directions

All three share the following non-negotiables, which fall directly out of the audit:

- **Official CTA line colors only** (`src/lib/utils.ts` values: Red #C60C30, Blue #00A1DE, Brown #62361B, Green #009B3A, Orange #F9461C, Purple #522398, Pink #E27EA6, Yellow #F9E300). One table, one import. Yellow and Pink always carry dark text. Delete the remix tables.
- **Ghost score is not a hue.** Line colors already occupy every hue family a sequential scale could use. The ghost index becomes a *presence* ramp in the UI's own ink: busy station = solid ink, ghost station = faded ink and a hollow / dashed mark. The metaphor is literal (the station is fading), it cannot collide with a line color, and it works identically in light and dark. Buckets are quantile-based (top 10% = "ghost", next 25% = "fading", rest = "present"), not fixed at 65/50/35, so the encoding has range whatever the ETL produces.
- **One interaction accent, and it is inversion, not a hue.** Selected row, selected marker, focused control invert ink and surface. No emerald, no ocean, no indigo. The only colors on screen are the eight CTA lines.
- **Zero infinite loops.** Motion is enter, exit, count-once, draw-once, fly-to. `useReducedMotion` gates all of it.
- **Two typefaces, max.** One sans with a width or weight axis for display and UI, one mono for numbers (JetBrains Mono is already loaded and fine). Remove Inter, Fraunces, Space Grotesk.
- **No glass, no noise, no gradient fills.** Surfaces are flat; depth is one 1px rule or one tinted shadow at most.
- **Stations get URLs** (`/station/[slug]`). Selection state lives in the route. Share works. Direct links render the full dossier.
- **Feed the list from `/api/chicago/stations`** so sparklines render; fix or remove the Postgres-only raw SQL so the detail route works on both databases.

### Direction A - "Wayfinding" (recommended)

**Concept in one line:** The app is a CTA platform sign that happens to be interactive: black field, white type, colored line bars, and a monochrome map where ghost stations are literally fading off the network.

**Typography:** `Archivo` (Google, variable width + weight) for display and UI. Narrow width at 600/700 for station names (the condensed signage feel), normal width at 400/500 for UI. `JetBrains Mono` 400/500 tabular for every number. Scale: 11 / 13 / 15 / 18 / 24 / 36 / 56. Station names on the sign header at 36 to 56px narrow, uppercase is allowed only there.

**Palette:**
- Dark (default): surface #141518, surface-2 #1C1D21, rule rgba(255,255,255,0.12), ink #F2F1EC, ink-2 rgba(242,241,236,0.68), ink-3 rgba(242,241,236,0.44).
- Light: surface #F4F3EE, surface-2 #FFFFFF, rule rgba(20,21,24,0.12), ink #141518, ink-2 at 0.70, ink-3 at 0.48 (ink-3 only at 13px and above).
- Lines: official CTA set, used for track strokes, line bars under station names, line chips, filter bars. Never for UI chrome.
- Ghost presence ramp: ink at 100% / 72% / 44% for present / fading / ghost; ghost marks are hollow with a 1.5px dashed stroke.
- No other colors. Error and warning states use ink + an icon, not red/amber.

**Layout model (desktop, map-first with an anchored ledger):**
- Top bar 56px: wordmark "GHOST STOPS" (Archivo narrow 700) + "Chicago L", search, "Data through Nov 29, 2025" as plain text (no dots, no "Live"), theme toggle.
- Left ledger 360px, flush to the edge, full height, scrolls all 143 stations. Sticky header: sort (Ghost index / Riders per day / Name) and the line filter rendered as eight colored bars that dim to 30% when off. Rows: rank (mono, ink-3), station name (narrow 600), line bars (3px tall stripes under the name, official colors), riders/day (mono, right-aligned, the most prominent number), 7-day sparkline (ink), ghost presence shown by the row's own ink level and a hollow/solid dot. No ring, no ghost icon. Row height 56px. Divider: one hairline every row is fine in a ledger of this density, but only bottom borders.
- Map fills the remainder. Custom Mapbox style (Studio, or `dark-v11` with POI/transit/road-label layers hidden and water/land desaturated). Tracks in official colors on top (unchanged pipeline). Stations as a `circle` layer: solid ink dots for present, hollow dashed for ghost, radius by zoom only. Station names as a `symbol` layer with ink halo from zoom 12.5, collision-managed. Selected station: inverted dot with a 2px ring. No DOM markers, no pills.
- Detail is a 440px drawer sliding over the map's right edge, and the same content is the page at `/station/[slug]`. Camera flies with `padding.right = 440`.
- Drawer / dossier order: (1) **Sign header**: station name large, line bars beneath, "Terminal" / "Transfer" tag if applicable. (2) **The number**: riders per day at 56px mono, with ghost index and percentile at 18px beside it, count once. (3) **Against baselines**: three rows (system median, line median, neighbors) as number + small inline delta mark, no tracks. (4) **Why**: archetype title as a run-in heading, story paragraphs at 15px/1.6, evidence facts as a two-column definition list, sources as a disclosure. (5) **90 days**: chart in ink with the primary line color as the stroke, no box. (6) **Along the line**: previous / next station as two full-width rows with the line bar, not pills. Nothing else; no ID, no coordinates.
- Mobile: full-bleed map; search as a plain bar; filter row as eight colored bars that wrap to two rows (no horizontal scroll); vaul sheet keeps 25/50/90 but with the ledger rows above; detail is the `/station/[slug]` page with a 28vh map, sign header, then the same order. Share is the URL. Navigate becomes a text link under the header.

**Motion philosophy:** 4/10. Drawer 240ms ease-out; ledger rows 120ms fade in with 15ms stagger on sort/filter; number counts once over 600ms; chart path draws once; map `flyTo` 900ms with easing; selected dot ring scales in 200ms. Everything behind `useReducedMotion`. Framer Motion only; drop `@react-spring/web` (gauge count-up moves to Framer's `animate`). vaul stays for the sheet; `@use-gesture` goes once the detail is a route.

**Components that survive:** `MapContainer` data flow and track pipeline (`explodeAndStitchSegments`, `stationSequences`, `normalizeStationLines`), `RidershipChart` (restyle), `Sparkline` (restyle, feed it), `ComparisonBars` logic (new presentation), `NeighborPills` logic (new presentation), `StationStory` / `FactCard` / `SourcesCitation` (restyle, drop emoji and quality pills in favor of a one-line quality note), `MobileLayout` / `MobileBottomSheet` / `MobileFilterScroll` skeletons, `ThemeProvider` (collapse to `data-theme` only), skeletons. **Retired:** every glass class, `GhostScoreGauge`, `GhostScoreHero`, `GhostScoreBadge`, `GhostWatermark`, `StationMarker` DOM markers, `MapTooltip` (replaced by symbol labels + hover state on the circle layer), `LineFilter` box, `TopBar` logo animation, `MobileViewListFAB`, `animations.css`, `glassmorphism.css`, `ctaLineColors.ts`, `explodeSegments.ts` color table.

### Direction B - "The Dossier" (editorial, light, list-first)

**Concept:** A data-journalism feature, in the register of a long-form newsroom interactive: the ranked list is the article, each station is a dossier page, the map is an illustration that follows you.

**Typography:** `Schibsted Grotesk` (free, designed for a news group, has real editorial texture) at 400/500/700 for everything, `JetBrains Mono` for numbers. Scale 12 / 14 / 16 / 20 / 28 / 40 / 64. Body 16px/1.65 at max 64ch on the dossier page.

**Palette:** Cool paper #F1F2F4 (zinc, not cream; the skill's beige family is avoided), ink #121417, rules at 10% ink. Lines in official CTA colors as 4px bars and as the chart stroke. Ghost presence as the same ink ramp (solid / 70% / 45% plus hollow marks). Dark mode is the inversion with surface #15171A.

**Layout model:** List-first. Home is a two-column page: left 60% is the ranked ledger with a sticky sort/filter strip and a short standfirst explaining the ghost index in two sentences; right 40% is a sticky, half-height map that highlights the row under the cursor and dims the rest of the network. Clicking a row navigates to `/station/[slug]`, a full page: sign-style header (name, line bars), a three-up fact row (riders/day, ghost index + percentile, trend), a 60/40 split of story + evidence list vs a tall map crop, the 90-day chart full width, then "Along the line" as a horizontal strip of the five nearest stations with their ink levels. Mobile is the same pages stacked; no bottom sheet (the map becomes a 40vh block that pins while the list scrolls under it).

**Motion:** 3/10. Page transitions via `layoutId` on the station name from row to header (the one shared-element move the January plan promised and never shipped). Chart draws once. Map dims/highlights in 150ms. Nothing loops.

**Survives:** everything in A's list plus `StationList`/`StationRow` as the base of the ledger. **Retired:** the floating-panel model, the bottom sheet, the same glass/gauge/marker set as A.

Why not recommended: it demotes the strongest asset (the network map) to an illustration and loses the map-first mobile behavior that already works. It is the better choice only if the owner wants this to read as writing first and tool second.

### Direction C - "Ledger" (monochrome, variance 7, brutalist-adjacent)

**Concept:** A single dense table of all 143 stations is the whole product; the map is a toggle. Square corners, hairlines, mono numbers, uppercase 11px column heads (the one place the skill's eyebrow budget is spent), huge station names on the dossier page.

**Typography:** `IBM Plex Sans` (civic/signage DNA, excellent at small sizes) + `IBM Plex Mono`. Scale 11 / 13 / 15 / 20 / 32 / 72.

**Palette:** Near-black #0F1012 and off-white #ECEBE6 only, plus official line colors as 2px bars. Ghost presence as ink ramp and dashed marks, as above.

**Layout:** Home is a full-width table with inline sparklines and inline comparison numbers, sortable by any column, filterable by line via colored tabs. A "Map" toggle swaps the table for a full-bleed monochrome map with the same ink encoding. Station detail is a 72px-name dossier page. Mobile: the table collapses to two-line rows; the map is a separate tab.

**Motion:** 2/10. Sort reorders with `layout` animation (300ms), nothing else.

Why not recommended: it is the most distinctive on a screenshot and the easiest to build, but it throws away the parallel-track map as a primary surface and the narrative gets the least room. Good fallback if time is short.

---

## 5. Recommendation

**Build Direction A, "Wayfinding", and borrow the `/station/[slug]` dossier page from B.**

Reasons:
1. It converts the project's two real assets, the network rendering and the narrative system, into the two primary surfaces (map + dossier) instead of burying them under chrome.
2. It resolves the color problem structurally. Reserving hue for the eight official CTA lines and expressing ghostliness as fading ink is a rule a build agent can apply mechanically, it is on-concept, and it is accessible in both themes by construction.
3. It is unmistakably Chicago without using a single brand asset beyond the public line colors, so it stands on its own rather than echoing a portfolio or a SaaS template.
4. It keeps the mobile model that already works (map + sheet) and fixes the part that does not (the detail) by making it a page.
5. It deletes more than it adds: roughly 1,400 lines of glass CSS, animation CSS, duplicate palettes and dead components go away, which lowers maintenance and bundle size.

### Build order for an implementing agent
1. **Foundations (no visual change yet):** single line-color table; quantile-based presence buckets in `utils.ts`; `/station/[slug]` route with the drawer as an intercepting route; list fed from `/api/chicago/stations`; make the detail SQL database-agnostic (Prisma `gte` on a computed date instead of `INTERVAL`); `data-theme` as the only theme mechanism.
2. **Tokens:** replace `globals.css` variables with the Wayfinding set above; `tailwind.config.ts` fonts to Archivo + JetBrains Mono, radius to 4px/0, remove glass/noise/ghost keyframes; delete `glassmorphism.css`, `animations.css`, `typography.css` utilities.
3. **Map:** custom style or layer hiding; circle + symbol layers replace `StationMarker` and `MapTooltip`; `flyTo` with padding; remove halo layer.
4. **Ledger:** rebuild `StationRow` as a `<button>` row with the spec in Direction A; sort + filter bars in a sticky header; full scroll.
5. **Dossier:** rebuild `StationDetailPanel` and `MobileStationDetail` as one `StationDossier` component rendered in the drawer and the page; restyle `ComparisonBars`, `NeighborPills`, `StationStory`, `FactCard`, `RidershipChart`.
6. **Motion and a11y pass:** `useReducedMotion` gate, focus order, `aria-pressed`, contrast check on Yellow/Pink chips, remove `user-select: none` overrides.
7. **Cleanup:** delete unused components and docs that describe the old skin; update `.claude/CLAUDE.md` to the new token and color rules.

### Pre-flight items from the skill that this direction must honor
- Zero em dashes in visible strings (replace the "—" data placeholder with a mono "n/a" or "no data").
- No decorative status dots; freshness is a dated sentence.
- No section-header icon discs; headings are type only.
- Max one uppercase tracked label style (column heads in the ledger).
- Buttons and rows are real `<button>` / `<a>` elements with visible focus.
- Both themes shipped and checked; no section inverts mid-page.
- One corner radius rule (4px for controls, 0 for panels and bars), documented in the config.
