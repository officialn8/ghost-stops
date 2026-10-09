---
name: Ghost Stops
description: Chicago's L stations ranked by how empty they are for their context, set like a CTA platform sign.
colors:
  tunnel-black: "#141518"
  mezzanine-gray: "#1C1D21"
  platform-chalk: "#F2F1EC"
  station-tile: "#F4F3EE"
  glazed-tile: "#FBFBF8"
  lake-light: "#E7E6E1"
  cta-red: "#C60C30"
  cta-blue: "#00A1DE"
  cta-brown: "#62361B"
  cta-green: "#009B3A"
  cta-orange: "#F9461C"
  cta-purple: "#522398"
  cta-pink: "#E27EA6"
  cta-yellow: "#F9E300"
typography:
  display:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "56px"
    fontWeight: 400
    lineHeight: "56px"
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: "38px"
    letterSpacing: "normal"
    fontVariation: "'wdth' 75"
  title:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "24px"
    fontVariation: "'wdth' 75"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
  label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  caps-label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "0.08em"
  line-label:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
    fontVariation: "'wdth' 75"
  numeral:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: "24px"
    fontFeature: "tnum"
rounded:
  none: "0"
  control: "4px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "8": "32px"
components:
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.platform-chalk}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "rgb(242 241 236 / 0.06)"
  button-icon:
    backgroundColor: "transparent"
    textColor: "rgb(242 241 236 / 0.68)"
    rounded: "{rounded.control}"
    size: "40px"
  button-icon-hover:
    backgroundColor: "rgb(242 241 236 / 0.06)"
    textColor: "{colors.platform-chalk}"
  input-search:
    backgroundColor: "{colors.mezzanine-gray}"
    textColor: "{colors.platform-chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "36px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.platform-chalk}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "2px 8px"
  tag:
    backgroundColor: "transparent"
    textColor: "rgb(242 241 236 / 0.68)"
    typography: "{typography.caps-label}"
    rounded: "{rounded.control}"
    padding: "0 6px"
  line-bar-on:
    backgroundColor: "{colors.cta-green}"
    textColor: "{colors.tunnel-black}"
    typography: "{typography.line-label}"
    rounded: "{rounded.none}"
    height: "24px"
  line-bar-off:
    backgroundColor: "transparent"
    textColor: "rgb(242 241 236 / 0.68)"
    typography: "{typography.line-label}"
    rounded: "{rounded.none}"
    height: "24px"
  sort-head:
    backgroundColor: "transparent"
    textColor: "rgb(242 241 236 / 0.68)"
    typography: "{typography.caps-label}"
    rounded: "{rounded.control}"
    padding: "0 4px"
    height: "24px"
  sort-head-active:
    textColor: "{colors.platform-chalk}"
  ledger-row:
    backgroundColor: "transparent"
    textColor: "{colors.platform-chalk}"
    rounded: "{rounded.none}"
    padding: "0 16px"
    height: "56px"
  ledger-row-hover:
    backgroundColor: "rgb(242 241 236 / 0.04)"
  ledger-row-selected:
    backgroundColor: "{colors.platform-chalk}"
    textColor: "{colors.tunnel-black}"
  neighbor-row:
    backgroundColor: "transparent"
    textColor: "{colors.platform-chalk}"
    rounded: "{rounded.none}"
    padding: "12px 8px"
    height: "64px"
  method-key-row:
    backgroundColor: "transparent"
    textColor: "{colors.platform-chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "12px 0"
  section-heading:
    textColor: "rgb(242 241 236 / 0.68)"
    typography: "{typography.label}"
  top-bar:
    backgroundColor: "{colors.tunnel-black}"
    textColor: "{colors.platform-chalk}"
    height: "56px"
    padding: "0 20px"
  drawer:
    backgroundColor: "{colors.tunnel-black}"
    textColor: "{colors.platform-chalk}"
    rounded: "{rounded.none}"
    padding: "0 20px 64px"
    width: "440px"
---

# Design System: Ghost Stops

The frontmatter is written in the dark theme, the default. The light theme swaps the same tokens: Tunnel Black becomes the ink, Station Tile the surface, Glazed Tile the second surface, and the ink opacities step up (Ink 2 to 72%, Ink 3 to 62%). In code the tokens are `surface`, `surface-2`, `ink`, `ink-2`, `ink-3`, and `rule`, defined in `src/app/globals.css` and the only colors Tailwind knows.

## Overview

**Creative North Star: "The Platform Sign"**

Ghost Stops is set like a CTA platform sign that happens to be interactive. The field is black, the type is white, and the only color on it is the bar that says which line runs here. Station names are set in Archivo's condensed cut, in capitals, the way they are on the sign; every number is set in a monospaced face so columns of riders line up like a timetable. The light theme is the same sign printed on tile: Tunnel Black becomes the ink, Station Tile the field, and nothing else changes.

The mood is quiet and evidentiary. Chrome recedes to hairlines and secondary ink so the content carries the page, and every figure stands next to its date, its method, and its source. The ghost is a wayfinding glyph, not a costume: a station fades off the network by losing ink, and the word for its tier is always written beside it. Hue belongs to the lines, ghostliness belongs to ink, and selection belongs to inversion.

The one confirmed anti-reference is the retired SaaS dashboard skin: glass panels, gradient fills, five disagreeing score color scales, traffic-light badges, status dots, and a "Live" pill. None of it returns.

**Key Characteristics:**
- Two neutrals per theme and the eight official CTA line colors; no other color exists.
- Ghostliness is ink presence and mark shape (solid, hollow, 72% hollow, ghost glyph), never a hue.
- Selection and focus invert ink and surface; there is no accent color.
- Archivo for words, with the condensed width for station names; JetBrains Mono, tabular, for every number.
- Flat surfaces, hairline rules, square panels, 4px controls; one structural shadow on the drawer.
- Motion is enter, count-once, draw-once, and fly-to, each gated by the reader's reduced-motion preference; nothing loops.

## Colors

Two neutrals that trade places between themes, and the eight CTA line colors as the only hue.

### Primary

There is no brand accent. The interaction accent is inversion: a selected ledger row, a selected map mark, and the text selection all swap ink and surface. The only hues on screen are the eight official CTA line colors, and each is data: it appears only where that line runs.

- **CTA Red** (#C60C30), **CTA Blue** (#00A1DE), **CTA Brown** (#62361B), **CTA Green** (#009B3A), **CTA Orange** (#F9461C), **CTA Purple** (#522398), **CTA Pink** (#E27EA6), **CTA Yellow** (#F9E300): the track strokes on the map, the line bars under a station name, the line filter bars, the small bar beside a line median, and the stroke of the 90-day chart. Text set on a line color takes whichever theme ink contrasts more; Yellow, Pink, Blue, Green, and Orange all take Tunnel Black. The Purple Express draws as Purple. An unknown line falls back to a neutral gray (#6B6B6B), which should never be seen.

### Neutral

- **Tunnel Black** (#141518): the dark theme's surface, and the light theme's ink. The field of the sign.
- **Mezzanine Gray** (#1C1D21): the dark theme's second surface: the search field, the map's field before tiles load, Mapbox's controls.
- **Platform Chalk** (#F2F1EC): the dark theme's ink, the white of the type on the sign. Full ink is for names, primary numbers, and body text.
- **Station Tile** (#F4F3EE): the light theme's surface, a warm tile white.
- **Glazed Tile** (#FBFBF8): the light theme's second surface.
- **Lake** (#E7E6E1): the light theme's water on the map, ink at 6% over Station Tile, so Lake Michigan carries no hue. The dark map's near-black water needs nothing.

The quieter inks are the theme's ink at an opacity, never a separate gray, so they sit correctly on either surface:

- **Ink 2**: ink at 68% (dark) or 72% (light). Secondary text, captions, section headings, icon buttons at rest, fading station names.
- **Ink 3**: ink at 52% (dark) or 62% (light). The faintest text, held at the lowest opacity that still passes WCAG AA at 13px; ghost station names, ranks, placeholders. Never under 13px.
- **Rule**: ink at 12%. Every hairline: borders, row dividers, chart gridlines, the outlined tag.
- **Washes**: ink at 6% for a hovered button or neighbor row, 4% for a hovered ledger row, 8% for a pressed row and for skeleton blocks, 24% for the scrollbar thumb, 25% for the sheet handle.

### Named Rules

**The Line-Only Hue Rule.** A hue appears only where a CTA line runs: tracks, line bars, filter bars, the chart stroke. Chrome, states, errors, and warnings are ink on a surface with an icon, never red or amber.

**The Ink Presence Rule.** Ghostliness is ink and shape, never a hue: healthy is a solid dot at full ink, quiet a hollow ring at full ink, fading a hollow ring at 72%, ghost a small ghost glyph at Ink 3. The tier word is always written beside the mark.

**The Inversion Rule.** The one interaction accent is inversion. Selected rows, selected map marks, and text selection swap ink and surface; nothing is ever highlighted with a color.

## Typography

**Display Font:** Archivo (variable width axis, with system-ui fallback)
**Body Font:** Archivo
**Label/Mono Font:** JetBrains Mono (400 and 500, with ui-monospace fallback)

**Character:** Signage and timetable. Archivo at its condensed width (wdth 75) gives station names the narrow capitals of a platform sign; at normal width it is a plain, unassuming UI face. JetBrains Mono carries every figure, tabular, so riders, ranks, dates, and percentiles line up in columns. There is no serif anywhere.

### Hierarchy

- **Display** (JetBrains Mono 400, 56px/56px, tracking -0.025em, tabular): one number per station, riders per day on the sign header. It counts up once when the dossier opens.
- **Headline** (Archivo wdth 75, 700, 36px/38px, uppercase): the station name on the sign header, the only text set in capitals at size.
- **Title** (Archivo wdth 75, 600, 18px/24px): neighbor names along the line. At 15px/24px semibold it is every station name in the ledger. The wordmark is this cut at 700, uppercase, tracked 0.06em (15px on a phone, 18px from 768px). The method page's title is the plain width at 24px/28px, 600.
- **Body** (Archivo 400, 15px/24px): sentences, story paragraphs, score-part labels, baseline labels. Bold runs in a story are 600; a bold figure switches to the mono face at 500.
- **Label** (Archivo 400, 13px/20px): the workhorse secondary size in Ink 2: captions, section headings (at 500), chips, tier ranges, sources, the data-through sentence.
- **Caps label** (Archivo 400, 11px/16px, uppercase, tracked 0.08em): the ledger's sort heads only. This is the single tracked uppercase style in the system.
- **Line label** (Archivo wdth 75, 600, 11px/16px): the line name inside a filter bar.
- **Numeral** (JetBrains Mono 400, tabular, at 11, 13, 15, 18, or 36px): every number inline, from chart ticks (11px) to the Ghost score (36px). A number in running text keeps the mono face at the surrounding size.

Scale: 11, 13, 15, 18, 24, 36, 56, with line heights 16, 20, 24, 24, 28, 38, 56. Nothing smaller than 11px exists, and Ink 3 is never used below 13px. Body copy sits at 15px/24px with no explicit measure; the 440px drawer and its 20px gutters hold it near 55 characters.

### Named Rules

**The Mono Numbers Rule.** Every number on screen is set in JetBrains Mono with tabular figures, whatever its size or context, including dates (2026-07-31) and percentages inside a sentence.

**The One Caps Rule.** Uppercase is the station name on the sign, the wordmark, and the 11px sort heads. Nowhere else.

**The Sentence Case Rule.** Headings are sentence case and type only: no icons, no discs, no rules through them. "Why it's fading", "Along the Green Line", "Sources".

## Layout

The shell is one persistent frame: a 56px top bar (wordmark, data-through date, theme switch) over a row holding the ledger, the map, and the station drawer. Nothing scrolls but the ledger and the drawer; the page itself is the viewport height.

- **1100px and up:** a 360px ledger column flush to the left edge, the map filling the rest, and the 440px drawer laid over the map's right edge. The map camera pads 440px on the right so a selected station stays clear of the drawer.
- **768 to 1100px:** the same, but the drawer replaces the ledger column while a station is open.
- **Under 768px:** the map is full-bleed under a bottom sheet holding the ledger. The sheet opens at 55% of the viewport, so the first screen shows the ledger's head, the first tier's heading, and four station rows; its lowest snap is the head alone, measured, and its top snap 92%, with a 40 by 4px handle at 25% ink. A station page shrinks the same map to 28vh and the dossier scrolls below it as a page, with "Back to map" where the close button would be.

Breakpoints are 768 (md), 1100 (lg), and 1440 (xl). Z-order, bottom to top: map 0, chrome 10, drawer 20, sheet 30, banner 40; nothing else sets a z-index.

**Density and rhythm.** Spacing runs on 4px steps; 12px and 16px are the common gaps, 20px is the dossier gutter, and 32px separates dossier sections. The ledger row is 56px tall (rank, score, and mark in a 64px column, the name over its line bars, a 56 by 24px sparkline, riders right-aligned in a 64px column), with a hairline under every row. The dossier is one column at the drawer's width, with 20px gutters and 64px of bottom padding, ordered the same everywhere: sign header, baselines, why, last 90 days, along the line, sources. Each section opens with a hairline, 16px, a 13px heading in Ink 2, 12px, then content. Tables are definition lists with a hairline between rows and 10 to 12px of vertical padding; the number sits in a fixed right column so figures align down the page.

**The map.** Mapbox's monochrome base (dark-v11 or light-v11) with its POI, transit, and road labels hidden. Tracks are a surface-colored casing at 85% under each line's core stroke (1.8px at zoom 10 to 3.8px at zoom 14, Loop tracks slightly thinner), offset so parallel lines sit side by side, Red drawn last. Stations are circle layers with a radius from 2px at zoom 9 to 7px at zoom 17 over a transparent hit circle of 8 to 16px. Names are DIN Pro Medium at 12 to 14px with a 1.5px surface halo from zoom 12.5, the ghostliest kept first when they collide; the hovered or selected name shows at any zoom. Of the base style's own labels, suburb and neighborhood names stay at 60% and the city's own name is hidden: "Chicago" would sit on the Loop cluster. A line filtered out keeps its tracks at 20%, its marks at 30%, and its labels at 40%; nothing is removed. Closing a station flies the camera back to the whole network, or to the box around the lines a filter keeps, and a "Whole network" button at the map's top-left does the same at any time.

## Elevation & Depth

Flat. Surfaces are a single field; depth comes from hairlines at 12% ink, from the second surface (Mezzanine Gray or Glazed Tile) for recessed fields like the search box, and from inversion for the selected element. There is one shadow in the system, and it is structural: the drawer's left edge over the map, a wide soft shadow tinted to the theme's ink so a panel visibly lies over the map rather than beside it. Nothing else casts a shadow, and no surface uses blur, noise, gradient, or glass.

### Shadow Vocabulary

- **Panel edge** (`box-shadow: -16px 0 40px -24px rgb(var(--shadow) / 0.5)`, where `--shadow` is black in the dark theme and Tunnel Black in the light): the drawer's left edge over the map, from 768px. Not for cards, chips, buttons, or the bottom sheet, which uses a hairline top border instead.

### Named Rules

**The One Shadow Rule.** The drawer's edge is the only shadow. Anything else that needs separation gets a hairline or the second surface.

## Shapes

Square. Panels, bars, rows, the drawer, the sheet, section rules, and the line bars have no radius; the drawer meets the map with a hairline and a straight edge. Controls (buttons, inputs, chips, tags, sort heads, the theme switch) take a 4px radius, just enough to read as pressable. Only dots are round: the presence marks, the sparkline's last-day dot, the sheet handle.

Borders are hairlines at 12% ink. A chip's outline uses Ink 2, and the strong chip (the small-station badge) uses full ink. Focus is a 2px ink outline offset 2px, inset 4px on ledger rows so it never clips. Line bars are flat rectangles in the line's color: 16 by 3px in the ledger, 32 by 4px on the sign header, 12 by 3px beside a line median, and 4 by 36px upright beside a neighbor row. The presence marks are a 10px vocabulary at a 1.5px stroke: a solid dot, a ring, a 72% ring, a 15px ghost glyph whose body is the surface, a ring crossed by a bar for closed, and a dotted ring for no data. The map draws the same shapes at every zoom.

## Components

Printed and precise: hairline rules, outlined chips, flat fills, inversion for selection. Controls read as parts of a printed sign, not raised hardware. Every row that opens something is a real button or link with the shared focus ring, and no control is shorter than 32px. Icons are Lucide at a 1.75 stroke, 14 to 20px, and always sit beside a word or carry an accessible name.

### Buttons

- **Shape:** 4px radius, hairline border, no fill at rest.
- **Outline (the only text button):** 36px tall, 12px side padding, a 13px label in full ink, an optional 14px icon; 32px tall when it sits in a ledger row ("Clear search", "Retry"). Hover washes the fill to 6% ink; active nudges it down 1px.
- **Icon:** 40 by 40px, 4px radius, an 18px icon in Ink 2; hover washes 6% ink and lifts the icon to full ink. The theme switch and the drawer's close.
- **Text link:** 13px or 15px in ink, underlined at 40% ink, the underline darkening to full on hover. "Back to map" is a text button with a left arrow, Ink 2 to ink on hover, phone only.
- There is no filled, primary, or colored button anywhere.

### Line filter bars

- **Style:** eight 24px-tall bars in one row of eight everywhere (4px gaps; about 43px each on a phone), square corners, the line name at 11px in the condensed cut.
- **On:** filled with the line color, a 1px border of the same color, the name in the contrasting theme ink (Tunnel Black on Yellow, Pink, Blue, Green, and Orange), semibold.
- **Off:** the fill empties to a 30% outline of the line color and the name is struck through in Ink 2, so off is never color alone. All off reads as all on.

### Ledger head and group headings

- **Lede:** one 13px line in Ink 2 above the search field, set like a sign: "144 stations, 143 ranked by Ghost score", both counts in mono. While a search or filter narrows the list it reads "27 of 144 stations match". Never a second sentence.
- **Group headings:** under the rank sort the ranked rows sit in four tier groups, and the closed and no-data rows in their sections, each under a 13px Ink 2 heading on a hairline: the group's 10px mark, its word, and its count in mono ("Ghost, 15 stations"). The heading is the legend and sticks to the top of the list while its rows scroll; the row carries only the mark. Under the riders and name sorts, where there are no tier groups, the tier word sits in the row's second line after the line bars, 13px Ink 2.
- **Foot:** two 13px Ink 2 lines under the rows: CTA's lag with the data-through date in mono, then the score's one-line definition with a text link, "How it works", to the method page.
- **Skip link:** "Skip to stations" is the page's first Tab stop, visible only on focus as an inverted 4px-radius pill at the top left. It focuses the list, whose rows share one Tab stop with the arrow keys, Home, and End between them; the eight line bars do the same; "/" focuses the search.

### Sort heads

- **Style:** 11px uppercase tracked labels ("Rank", "Name", "Riders per day"), 24px tall, 4px side padding, 4px radius; Ink 2 at rest, full ink when active with a 12px arrow for direction. `aria-pressed` carries the state, and the spoken label says what the column shows: "Sort by rank, 1 first", "fewest first", "A to Z".

### Chips and tags

- **Chip:** an outlined 13px text chip, 8px side and 2px vertical padding, 4px radius, Ink 2 border, full-ink text; used for data-quality notes and for the reason a score part has no value. Long text wraps inside it.
- **Strong chip:** the same with a full-ink border and 500 weight; the "Small but steady" and "Small but growing" badge.
- **Tag:** "Transfer" or "Terminal" beside the line bars: 11px in Ink 2, 6px side padding, hairline border, 4px radius, sentence case.

### Inputs

- **Search:** 36px tall, 4px radius, hairline border, the second surface as fill, 12px side padding, 15px type (18px in the phone sheet so iOS does not zoom), placeholder in Ink 3. Escape clears a non-empty query; Enter opens the first match.
- **Focus:** the shared 2px ink outline, offset 2px. No glow, no border color change.
- **Error / Disabled:** not used; the list falls back to a status row with a retry button.

### Ledger row

- **Shape:** 56px tall, full width, 16px side padding, hairline bottom border, square.
- **Content:** a 64px column of three fixed cells, the rank and the Ghost score each right-aligned in 3ch of 13px mono in Ink 3 and the presence mark after them; the name (15px semibold, condensed) over 16 by 3px line bars; a 56 by 24px sparkline in the current text color with a dot on the last day; riders per day (15px mono) right-aligned in a 64px column. The score sits beside the rank, small, so the sort is legible without outranking the riders figure. A closed or no-data station shows "closed Jan 2026" or "no recent data" in Ink 2 in place of the numbers.
- **Presence:** the name's ink follows the tier (ghost and excluded names in Ink 3, fading in Ink 2, quiet and healthy in full ink); numbers stay at full ink.
- **Hover:** a 4% ink wash. **Selected:** inverted, a full-ink fill with surface-colored text and a surface-colored focus ring; the sparkline inverts with it.

### Dossier sections

- There are no cards. The dossier is one column of sections, each a hairline, a 13px heading in Ink 2 at 500, and content; sub-tables are definition lists with hairline rows. Containers never get a fill, a border box, or a radius.
- **Sign header:** the name (36px condensed capitals, takes focus on open), the line bars with the line names in 13px Ink 2 and any tag, then the 56px mono number with the tier word (18px, 500, with its 12px mark) and "24th of 143 ranked" beside it, and two 13px lines explaining the number and the tiers.
- **Why card:** the Ghost score at 36px mono with "of 100" and the 30-day average beside it; a tier sentence with the mark; the badge and chips; then one row per score part with its label (15px), weight (13px mono, Ink 2), percentile (15px mono), and plain sentence (15px, Ink 2), under an 11px column-head row; then the peers sentence with linked names.
- **Story:** the archetype title as a bold run-in heading, paragraphs at 15px/24px, bold figures in mono; the evidence as a definition list of facts, each with a "Method and source" disclosure (chevron, 13px, Ink 2).
- **Along the line:** two full-width rows of at least 64px, an upright 4 by 36px line bar, "Previous stop" in 13px Ink 2 over the name at 18px condensed, the neighbor's tier word and mark on the right, a chevron, and a 6% hover wash. Every row is a link.

### Navigation

- **Top bar:** 56px, hairline bottom border, the ghost glyph (20px) and wordmark as one link home, "Chicago L" in 13px Ink 2 from 768px, "Data through 2026-07-31" with the date in mono, and the theme switch. No status dots; freshness is a dated sentence. A refresh older than ten days adds a 13px banner on the second surface with a triangle icon, under the bar.
- **Drawer:** 440px wide from 768px, the surface color, a hairline left border, the panel-edge shadow, its own scroll; it slides in 24px from the right over 240ms. A sticky 56px control row holds the close button on the right or, on a phone, "Back to map" on the left. Escape closes.
- **Bottom sheet (phone):** the surface color with a hairline top border, 92vh tall, opening at 55% with the head's measured height as its lowest snap and 92% as its top; always open on the map page, unmounted on a station page.
- **Map controls:** a "Whole network" outline button (32px, second-surface fill, hairline border, 13px) at the map's top-left, beneath Mapbox's zoom buttons from 768px; both in the token styles the stylesheet defines for Mapbox's controls. Hidden on a phone station page, where the small map is a locator.

### Presence marks (signature)

The one vocabulary shared by the ledger, the dossier, and the map: 10px marks at a 1.5px stroke. Healthy is a solid ink dot; quiet a hollow ring; fading a hollow ring at 72% ink; ghost a 15px ghost glyph, its body in the surface and its outline at Ink 3, never animated; closed a ring at 52% crossed by a bar; no data a dotted ring at 44%. The map's circle layers draw the rings and dots, and three small rasterized images draw the dotted ring, the bar, and the ghost so they scale in step with the circles. A selected mark inverts and gains a 2px ring; a hovered mark gains a 1px ring.

### Charts (signature)

- **Sparkline:** seven days as one 1.25px stroke in the current text color, scaled to the week's own low and high, with a 1.75px dot on the last day; a gap lifts the pen and never dips to zero; "n/a" in mono where there is no week.
- **90-day chart:** a 140px-tall plot with no box: three hairline gridlines labeled in 11px mono Ink 2, the series as a 1.75px round-capped stroke in the station's primary line color, the start and end dates under it, and a caption stating the range and any gaps. It draws once, left to right, over 800ms when the dossier opens.

### Loading, empty, and error states

- **Skeletons:** static blocks at 8% ink, 4px radius, laid out in the shape of the content they replace (nine ledger rows; the dossier section by section). No shimmer. The map says "Loading the map" in 13px Ink 2 at its center until its tiles first draw.
- **Empty:** "No stations match "xyz". Not even a ghost." as a 13px row in Ink 2 with a "Clear search" outline button; "This stop doesn't exist. Not even as a ghost." on an unknown station, with a search field.
- **Error:** a 15px sentence, a 13px explanation in Ink 2, and a "Try again" outline button with a rotate icon; the way back to the map stays.

### The method page (a reading surface)

`/method` is the one page outside the shell, in the same world. It reuses the top bar's anatomy without the shell (wordmark link, "Chicago L", the data-through date, the theme switch) over one centered reading column, 640px wide with 16px gutters (608px of text, about 70 characters), that every section shares: the page has one left edge from the title to the last link, and nothing steps out of it. A 24px semibold sentence-case title, a 15px Ink 2 lede, then dossier sections 48px apart, with 64px where a new chapter starts (the score's four parts; the data). The first section holds the real ledger row at the column's full width, its riders figure on the text's right edge, pinned to the top of the viewport over the surface color while its key reads beneath it; the key is a definition list in the row's reading order. Pointing at an entry of the key lights the cell it explains: every other cell of the row fades to 35% over 150ms, the Ink Presence Rule as an interaction, and a 13px Ink 2 line above the row says so. The mark's entry draws each tier's mark beside the words that name it, and the sign excerpt's number counts up once, as on the station page. Under the lede, a 13px line of text links ("On this page") names the seven sections. Every key sets each term (15px at 500) on its own line over its meaning (15px at full ink, 4px below, with the station's own value in mono), so a sentence runs the whole column, with a hairline between entries. Only a one-phrase key, the tiers, keeps the term in a 7rem column with the phrase beside it. Explanations and paragraphs sit at full ink, 16px apart; Ink 2 is kept for the lede, the headings, the weights, and the card quotes. The score's four parts and the exclusions use the same term-over-meaning list, with the presence marks as their only glyphs; the API routes are set in 15px mono. External links carry the 12px external-link icon; no other icons.

### Motion

All motion is enter, count-once, draw-once, or fly-to, under `MotionConfig reducedMotion="user"`, with a global rule that collapses CSS transitions to 0.01ms under `prefers-reduced-motion`. Nothing loops, and nothing exits with animation.

- The drawer enters 24px from the right over 240ms with the ease-out curve (0.16, 1, 0.3, 1); a server-rendered drawer does not animate.
- Ledger rows fade in over 120ms with a 15ms stagger (at most 20 rows, only those on screen) on a sort or filter change; a search keystroke does not animate.
- The riders-per-day number counts up once over 600ms with the same curve; screen readers get the final value only.
- The 90-day chart draws once over 800ms (0.33, 1, 0.68, 1).
- The map flies to a selected station over 900ms; the selection ring scales in from 50% over 200ms.
- Hover and theme changes transition color over 150ms; a pressed control moves down 1px.

## Do's and Don'ts

### Do:
- **Do** set every number in JetBrains Mono with tabular figures, including dates and percentages inside sentences.
- **Do** write the tier word beside every presence mark; the mark is decorative and the word is the meaning.
- **Do** use inversion (ink fill, surface text) for the selected row, the selected map mark, and text selection.
- **Do** separate sections with a hairline at 12% ink and a 13px sentence-case heading in Ink 2; group with rules and spacing, not boxes.
- **Do** state freshness as a dated sentence ("Data through 2026-07-31") and explain CTA's lag separately from a failed refresh.
- **Do** keep text at 11px or larger and Ink 3 at 13px or larger, and check both themes against WCAG AA.
- **Do** make every row that opens something a real button or link with the shared 2px focus ring.
- **Do** take line colors from the one table and set text on a line color in whichever theme ink contrasts more.

### Don't:
- **Don't** introduce a hue for anything other than a CTA line: no accent color, no red errors, no amber warnings, no score color scales.
- **Don't** express ghostliness or a score as a color, a gradient, a gauge, or a progress track.
- **Don't** add shadows, blur, glass, gradients, noise, or cards; the drawer's edge is the only shadow.
- **Don't** animate anything on a loop, animate an exit, or float the ghost.
- **Don't** use a status dot, a "Live" badge, or a colored pill for freshness.
- **Don't** call a healthy station a ghost, or use decline verbs on a growing number.
- **Don't** add a third typeface, a serif, or a second uppercase tracked style.
- **Don't** round a panel, a bar, or a row; only controls take the 4px radius and only dots are round.
- **Don't** write an em dash in rendered text.
