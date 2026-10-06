---
target: the landing page
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/Users/nate/ghost-stops/src/components/shell/Shell.tsx"
target_fingerprint: "sha256:71be8fdcc4afdc3adc1284e081011fb89573a58c854ab462fe341334addaf92b"
target_path: /Users/nate/ghost-stops/src/components/shell/Shell.tsx
timestamp: 2026-10-06T05-43-02Z
slug: src-components-shell-shell-tsx
closed: true
---
**Method: dual-agent (A: design-review agent · B: detector-evidence agent).** Both ran in isolation on the live dev server at http://localhost:3000; the server was started for the critique and stopped before reporting.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Freshness, pressed states, skeletons, slow and error rows are solid. The filtered match count is screen-reader only; the loading map says nothing. |
| 2 | Match System / Real World | 3 | CTA names, official colors, calendar dates. The active head reads "GHOST SCORE ↑" and is spoken as "ascending" while scores run 100 toward 0. |
| 3 | User Control and Freedom | 2 | No map reset or zoom controls; the camera stays wherever the last station left it. Filter, sort, and search are not in the URL, so Back does not undo them. |
| 4 | Consistency and Standards | 3 | One focus ring, tokens only, every number mono. "Riders/day" vs "riders per day"; the browser's native search "x" beside a custom Clear button. |
| 5 | Error Prevention | 3 | Normalized search, all-off reads as all-on, the selected row stays pinned under a filter. Escape wipes a typed query with no undo. |
| 6 | Recognition Rather Than Recall | 2 | No tier word in the row, no legend for the six marks, no tier dividers, re-click-to-flip sort, the lag explanation lives in a hover title. |
| 7 | Flexibility and Efficiency | 2 | Enter opens the first match and Escape clears. No skip link, no arrow keys in the list, no "/" to search, no URL state. |
| 8 | Aesthetic and Minimalist Design | 4 | Genuinely restrained: hairlines, two neutrals, no cards, hue only where a line runs. |
| 9 | Error Recovery | 3 | Plain sentences with Retry or Clear in every list state; the stale banner names the fix. A map that fails to load is silent. |
| 10 | Help and Documentation | 1 | Nothing on the page explains the score, the tiers, the marks, or the number on the right. The method is one click away in every dossier but never linked from here. |
| **Total** | | **26/40** | **Acceptable (65%)** |

## Design Specificity Verdict

**Authored for Chicago, not yet authored for a newcomer.**

**LLM assessment.** Once the map draws, nobody mistakes this for a generic map-plus-list product: the L in eight official colors on a black field, line bars under every name like the stripes on a platform sign, condensed station names, mono figures, "Data through 2026-07-31" as a dated sentence, the ghost glyph on the top fifteen rows, and "Not even a ghost." in the empty state. The restraint is a position, not a default. Strip the content layer and the frame is the category template: search box, filter toggles, three sort heads, a scrolling list, Mapbox dark-v11 with its stock suburb labels, a sun/moon icon. The character lives in the content and the type; the chrome is interchangeable. The missed opportunities are all about saying what the page is: the only sentence framing the ranking is a visually hidden heading, the tier word exists only in the row's accessible name, the four tier boundaries are invisible in a flat run of 143 rows, and the first viewport's best teaching moment (Monroe at rank 2 with 3,723 riders a day above Kostner at rank 6 with 242) goes unexplained. A newcomer does not learn what a ghost stop is without clicking. On a phone they learn less: the sheet's lowest snap shows the map, the search field, and eight bars, and not one station.

**Deterministic scan.** Clean. `impeccable detect --json` over src/components/{shell,ledger,map,marks,charts,theme}, src/app/(shell), src/app/layout.tsx, and src/app/globals.css, then over all of src, with and without project config: exit 0 and zero findings every time. A sanity fixture confirmed the tool fires on real slop. The documented choices (one tracked uppercase label, mono numbers, condensed uppercase names, no accent hue) produced no hits.

**Visual overlays.** Injection succeeded on three views. Three advisory rules fired, each a false positive against DESIGN.md, one pointing at a real gap:
- `flat-type-hierarchy` (h1 15px, h2 13px, body 15px), desktop, both themes. The h1 is the sr-only page heading in src/app/(shell)/page.tsx:6 inheriting body size; the h2 is the documented 13px section heading on "Closed" (src/components/ledger/Ledger.tsx:198). False positive as measured; its residue is true: on `/` there is no visible heading larger than 13px.
- `cramped-padding` on Mapbox's own attribution control (div.mapboxgl-ctrl-attrib, padding 0 5px), fired in two of three desktop runs, never on the phone. Third-party markup, timing-dependent.
- `cream-palette` on the light theme's rgb(244, 243, 238): Station Tile, the documented light surface (src/app/globals.css:34). Advisory, not counted.
The phone view returned "No anti-patterns found."

## Overall Impression

A disciplined, Chicago-specific surface that has not been given a voice. The system is exactly what DESIGN.md says and the code is cleaner than almost any scan target. But the page shows a ranked list of stations and never says what the ranking is, lets the riders figure be the loudest element in every row, and ends every station visit by leaving the map zoomed into three blocks. The single biggest opportunity is the ledger itself: let it carry the tiers and one sentence of framing, and the first viewport starts doing the product's job.

## What's Working

1. **The ledger row is a timetable line.** Rank and mark in 48px, the condensed name over its line bars, a 56 by 24px sparkline, and the riders figure right-aligned in mono: five elements in 56px that align down 143 rows and never need a card. The sparkline draws in the text color, so the selected row inverts as one piece.
2. **The line-filter bars are the sign's stripes and the page's legend at once.** Eight flat bars in the official colors, off as a 30% outline with the name struck through, all-off reading as all-on so the filter can never empty the list.
3. **The accessibility baseline is real.** Composed row names carrying the tier and the rank of 143, aria-pressed on toggles and sort heads, a live region for counts, one 2px ring inset so it never clips, and focus returning to the row after close, all observed in the live page.

## Priority Issues

**[P1] The first viewport never says what a ghost stop is, and the tier is invisible in the ledger.**
- **Why it matters:** The claim is "empty for its context, never just small," and the first screen shows a 3,723-rider station outranking a 242-rider one with nothing to explain it. DESIGN.md's Ink Presence Rule ("the tier word is always written beside the mark") is unmet on this surface.
- **Fix:** Group the ranked list under tier headings in the existing "Closed" pattern: "Ghost, 15 stations", "Fading, 22", "Quiet, 35", "Healthy, 71", each carrying its 10px mark so the heading is the legend, shown when sorted by Ghost score. Add one 13px line between the search field and the bars: "143 stations, ranked by how empty each is for its own line and its own past." Move the lag sentence out of the hover title into the ledger's foot.
- **Suggested command:** /impeccable onboard

**[P1] The phone's first viewport shows zero stations, and the sheet head clips.**
- **Why it matters:** Readers arrive on a phone from a shared link. At the 25% snap (203px) the sheet holds the handle, the search field, two rows of bars, and a sort-head row cut off at the edge; the first station is below the fold. The sheet still renders as a modal dialog.
- **Fix:** Derive the lowest snap from the head's height plus two rows (about 32% at 812px), or open at 50% on first load; move the sort heads into the sticky head; carry the "143 stations" line into the sheet.
- **Suggested command:** /impeccable adapt

**[P1] Closing a station strands the map at street zoom with no way back.**
- **Why it matters:** It is the last impression of every station visit. After Escape the camera sits on three blocks of the Green Line, there are no zoom or reset controls, and wheel zoom is the only recovery.
- **Fix:** On close, fly back to SYSTEM_BOUNDS (or the active lines' bounds under a filter) with the existing 900ms fly-to. Add a 32px outline "Whole network" button at the map's top-left and Mapbox's navigation control in the token styles globals.css already defines for .mapboxgl-ctrl-group.
- **Suggested command:** /impeccable harden

**[P2] The sort head's spoken direction contradicts the visible order, and the filtered count is invisible.**
- **Why it matters:** A screen-reader user hears "ascending" for a list that runs 100 toward 0; sighted readers see an up arrow meaning "highest first" here and "lowest first" on the riders head; nobody sighted knows how many rows a filter left.
- **Fix:** Name the head by what it sorts ("Rank", spoken "1 first" / "last first") or speak "highest first" / "lowest first" and draw the arrow to match. Spell "Riders per day". Render the live-region sentence visibly in the head whenever the list is narrowed: "27 of 143 match".
- **Suggested command:** /impeccable clarify

**[P2] Keyboard reach is correct but slow.**
- **Why it matters:** The first row is the 15th Tab stop and the last row the 157th. A keyboard reader pays eight presses to cross the bars on every pass.
- **Fix:** A "Skip to stations" link as the first focusable; arrow keys, Home, and End inside the ranked list with a roving tab index; "/" focuses search; make the filter group one Tab stop with arrows between bars.
- **Suggested command:** /impeccable harden

## Persona Red Flags

**Alex (power user):** 14 Tab stops before row 1, eight of them line bars Alex never toggles by keyboard. No arrow keys down 8,000px of rows. Re-click-to-flip sort is undocumented, and the riders head starts "fewest first". Escape clears the field but closes the drawer everywhere else. Cmd+R loses filter, sort, and query.

**Jordan (first-timer):** "GHOST SCORE" is the only occurrence of the term, at 11px, and nothing says what it scores. Monroe above Kostner looks wrong with no sentence to resolve it. The 10px ghost glyph at 52% ink reads as a smudge, and ring versus dot versus 72% ring has no legend. The lag explanation is a hover title that never fires on a phone. A struck-through "Red" bar could read as "the Red Line is closed".

**Sam (screen reader, keyboard, 200% zoom):** The spoken sort label is false for the score. At 200% zoom on a 1280px laptop Sam lands in the phone layout, where the sheet is a modal dialog that removes the top bar and the map from the accessibility tree and traps focus. No skip link. The no-data dotted ring at 44% ink sits near 2.9:1 on the light surface, under the 3:1 non-text floor.

**Morgan (the enthusiast reader, from PRODUCT.md):** One figure per station and a 7-day sparkline scaled to its own week; no score value, no change since 2019, no peers, no column choice, so Morgan opens 143 drawers to compare components. No "How the score works" link on this surface. Three sort keys when Morgan wants "by line, then rank" and "by change since 2019". No tier counts anywhere. The public API exists and nothing says so.

## Minor Observations

- The browser's native search "x" renders in its own style beside the tokenized "Clear search" button.
- The map's loading state is a bare second-surface rectangle with no text for as long as tiles take (8 to 17 seconds on the dev server).
- At 1440px the network sits in a central band with empty suburbs to the west; the opening fit could pad for the 440px drawer.
- Base-map suburb labels share the station labels' grey and compete above zoom 12.5.
- Long names truncate with an ellipsis in a roughly 144px name column with no title attribute.
- The row hover wash at 4% ink was not perceptible in any capture.
- The phone's top bar drops "Chicago L", so the phone never says Chicago.
- "outside filter" on a pinned selected row is implementation vocabulary.

**Review limits:** the phone sheet could not be dragged open by synthetic pointer events (judged from the accessibility tree); the stale-data banner and the list's slow and error rows never rendered (judged from source); the mobile emulation rendered the light theme by the pane's preference.

## Questions to Consider

1. What changes if the ranked list is grouped under Ghost, Fading, Quiet, and Healthy with counts, so the first thing a reader counts is tiers, not riders?
2. What if the first row of the ledger were a sentence, not a station: "Oak Park on the Green Line gets 703 riders a day, about a fifth of what its neighbors get", with the station row beneath it?
3. Should the map camera be a function of state (the active lines' bounds under a filter, the whole network on close, the station when open) rather than a one-time fit at load?
4. On a phone, is the map the right first screen? What if the sheet opened at 50% with the top three ghost stops visible?
5. What would the scan feel like if the rank column read "1 ghost" in Ink 3, within the type scale and the One Caps Rule?
