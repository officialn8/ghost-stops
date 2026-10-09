---
target: the landing page
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/Users/nate/ghost-stops/src/components/shell/Shell.tsx"
target_fingerprint: "sha256:8077e8f628e243892284209fb930a687cdaffa8543e1cef48f2ce2b5ccc9a79a"
target_path: /Users/nate/ghost-stops/src/components/shell/Shell.tsx
timestamp: 2026-10-06T07-46-13Z
slug: src-components-shell-shell-tsx
closed: true
---
**Method: dual-agent (A: design-review agent · B: detector-evidence agent).** Both ran in isolation against the merged code (e6ab1b7) on the dev server at http://localhost:3000; neither could read the first critique's snapshot.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Dated freshness, live match counts, focus rings, pressed states. The map has no loading state, and the value the list is sorted by is never shown. |
| 2 | Match System / Real World | 3 | CTA names and colors, calendar dates, plain sentences. "Ranked by Ghost score" beside a riders column breaks a newcomer's model. |
| 3 | User Control and Freedom | 4 | Escape closes and returns focus, "Whole network", "Clear search", all-off reads as all-on, selection in the URL, no modal on desktop. |
| 4 | Consistency and Standards | 2 | The type scale is stripped by cn() in every ledger element that also sets a text color; an off line bar changes size. |
| 5 | Error Prevention | 3 | Search normalizes "ohare" and "state lake"; filters cannot reach an empty state alone. Enter leaves the list without warning. |
| 6 | Recognition Rather Than Recall | 2 | Tier words vanish under the Riders and Name sorts; "Ghost score" is undefined; the sparkline has no scale. |
| 7 | Flexibility and Efficiency | 3 | "/", arrow keys through rows and bars, Home and End, Enter opens the first match. No URL state for filter, sort, or search. |
| 8 | Aesthetic and Minimalist Design | 3 | Restrained and flat. The 144 sparklines are copies of one shape; base-map labels compete with the marks. |
| 9 | Error Recovery | 3 | Retry, Clear search, and a map-failure sentence that keeps the list usable. |
| 10 | Help and Documentation | 1 | No method, no about, no dataset link; the lag sentence is a hover tooltip and a line 150 rows down. |
| **Total** | | **27/40** | **Acceptable (68%)** |

## Design Specificity Verdict

**Authored, and the authorship now stops one sentence short of the product's point.**

**LLM assessment.** Unmistakably this product: the eight line bars in the official colors with names in the condensed cut, the ghost glyph as the rank-1 mark and in "Ghost, 15 stations", "Not even a ghost." in the empty state, real track geometry with Red drawn last, hue held to the lines alone. Category-interchangeable: the ledger skeleton and the sparkline, which is scaled to each week's own low and high and, with July 25 a Saturday, shows the same wiggle in all 144 rows. The first-viewport story still fails for a newcomer: the lede says "ranked by Ghost score" and the only number in the row runs 703, 3,723, 3,047, 1,920. The number the list is sorted by appears nowhere on the page.

**Deterministic scan.** Clean: zero findings over the shell, ledger, map, marks, charts, theme, route group, root layout, and stylesheet, and over all of src, with and without project config.

**Visual overlays.** Injection succeeded on three views; four advisory rules fired. False positives against DESIGN.md: cramped-padding on Mapbox's attribution control (2 of 4 desktop passes), cream-palette on the light theme's Station Tile surface, body-text-viewport-edge on the ledger foot (its own 16px padding was not measured). Real this time: flat-type-hierarchy reported every heading at 15px, and the DOM confirms the tier group headings render at 15px, not 13px, for the reason in Priority Issue 1.

## Overall Impression

The fixes from the first critique landed: closing a station is now the best moment on the page, the tier headings carry the legend, the phone's first screen has rows. The score moved one point because the review went deeper and found two things the first run could not: cn() has been silently discarding the project's own type scale, and the list is ranked by a number it never shows.

## What's Working

1. **Closing a station is engineered as carefully as opening one.** Focus returns to the opened row, the map flies back to the network or the filtered lines' box, and search, filter, and sort survive the round trip (measured: focus on the Halsted row, query still "Halsted", lede "3 of 144 stations match").
2. **Ghostliness as ink, with the word beside it under the default sort.** The heading is the legend, the row carries only the mark, the map draws the same vocabulary at every zoom; the filter dims without removing and keeps global ranks.
3. **The line filter bars**: official colors, condensed names, off as a 30% outline with the name struck, one Tab stop with arrow keys across; the page's most Chicago element and the map's legend.

## Priority Issues

**[P1] cn() strips the type-scale tokens, so the ledger's type is wrong.**
- **Why it matters:** cn() = twMerge(clsx()) without extendTailwindMerge, so tailwind-merge treats text-11..text-56 as colors and drops them when a text-ink class follows. Measured: sort heads 15px (spec 11), tier headings 15px (spec 13), rank numerals 15px (spec 13), "closed Jan 2026" 15px (spec 13), an off line bar 11px to 15px. The same bug reaches every cn() call in the dossier. Pre-existing for sort heads and ranks; the headings are new.
- **Fix:** In src/lib/utils.ts build cn on extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["11","13","15","18","24","36","56"] }] } } }); add a unit test that cn("text-13 text-ink-2") keeps both; re-read the ledger and dossier against DESIGN.md.
- **Suggested command:** /impeccable typeset

**[P1] The list is ranked by a number it never shows.**
- **Why it matters:** The Ghost score appears only in the dossier; rank 1 shows 703 riders, rank 2 shows 3,723. The product's idea, empty for its context rather than small, is invisible on the surface that claims it.
- **Fix:** The score as a 13px mono figure beside the rank in the 48px column, or in place of the sparkline with "of 100" in Ink 2. Riders per day stays the right column at its current weight.
- **Suggested command:** /impeccable clarify

**[P1] No method, no about, no way out for a surprised reader.**
- **Why it matters:** The primary reader wants the method within reach. The lag sentence is a hover title and a foot 150 rows down; nothing links to how the score is built or to the dataset.
- **Fix:** A 13px link in the ledger foot ("How the Ghost score works") to a short method page, a one-line definition beside it, the dataset linked by name. The lede stays one line.
- **Suggested command:** /impeccable onboard, then /impeccable shape methodology page

**[P1] The phone's first screen shows one full station row.**
- **Why it matters:** At 375x812 the sheet opens with 341px visible; head 165px, handle 20px, group heading 44px leave room for one 56px row.
- **Fix:** On the phone set the eight bars in one row (43px each), make the group heading sticky rather than row-consuming, raise the open snap so at least four rows show; keep the lowest snap as the head alone.
- **Suggested command:** /impeccable layout

**[P2] Tier words disappear under the Riders and Name sorts.**
- **Why it matters:** Only the rank sort groups rows under tier headings; under the other sorts rows carry only the mark, against DESIGN.md's Ink Presence Rule.
- **Fix:** Under non-rank sorts write the tier word in 13px Ink 2 on the row's second line, or keep a one-line legend under the sort heads.
- **Suggested command:** /impeccable clarify

## Persona Red Flags

**Alex (power user):** filter, sort, and search live only in React state; no URL for a view. No shortcut for sort or "Whole network". From the search field the first row is 11 Tab stops away.

**Jordan (first-timer):** "Ghost score" and "Rank" undefined; "RANK ↑" has no on-screen word for "most ghostly first". Rank 2 at 3,723 beside rank 1 at 703 looks like a bug. No legend under the Name sort. The theme switch is the only icon-only control.

**Sam (screen reader, keyboard, 200% zoom):** at 200% zoom a 1280px window becomes the phone layout, where the sheet aria-hides the top bar and the map (known gap). Row names, sort labels, and the live region are complete. Ghost-tier names at 52% ink pass AA at about 5.1:1 but are the faintest text on the page.

**Morgan (the enthusiast reader):** no score in the row, no method link, no peers, no 2019 or year-over-year figure; the only trend is a 7-day sparkline. No sort by the score's parts, no shareable filtered view, no mention of the public API, five Westerns told apart by a 16x3px bar.

## Minor Observations

- [P2, /impeccable quieter] Mapbox's "Chicago" label sits on the Loop cluster at the network zoom in both themes; suburb labels stay at full opacity. Subdue settlement labels and hide them inside the system bounds above zoom 11.
- The sparklines spend 56px per row on a day-of-week artifact.
- "144 stations" in the lede against "of 143 ranked" in the rows; "143 ranked of 144" would close the gap.
- The top-bar date tooltip repeats the foot sentence and never fires on touch.
- The map region is a bare surface while tiles load; a 13px "Loading the map" line would match the list's skeleton language.
- For the first seconds every mark draws as a solid dot before the ring and ghost images arrive.
- The light theme's Lake Michigan is pale blue, the only non-line hue on the page.
- The browser's native search cancel button renders unstyled beside "Clear search".
- The known track-stitching warning logged on every view; no error-level console entries.

**Review limits:** the pane's default width is 1024px, so the 1100-and-up layout was checked at an emulated 1280; the stale banner and the list error row were judged from source; tablet and phone captures rendered in the light theme (the pane's stored preference).

## Questions to Consider

1. If the list is ranked by a number, why is that number the one thing the list never shows?
2. What if the row's second line were the why card's residual sentence instead of line bars plus a wiggle that looks the same in every row?
3. On a phone, should the map be the first screen at all?
4. Is "144 stations, ranked by Ghost score" the lede, or is "15 ghost stops on the L" the lede?
