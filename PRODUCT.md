# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary (confirmed by Nate, 2026-10-05): transit enthusiasts and urbanists.** They browse the whole ranking, compare lines, read many station stories, and want the method, the peers used, and the long-run numbers within reach. They arrive on a phone or a laptop, often from a shared link, and come back when CTA publishes a new month. This narrows the revival plan's "a Chicagoan who opens Ghost Stops" to the reader who goes deep.

Secondary, from the February 2026 launch and the revival plan:

- A curious Chicagoan from a shared link (Reddit, a text, a search) who checks a station they know and reads its story if it holds them. r/chicago and r/cta readers were the first audience.
- Nate, as operator: the data must keep itself current, and Nate must be told when the sync stops (the health check and its daily GitHub Actions email).

Portfolio viewers are not a design target. The plan records the decision that the design stands on its own and reads as Chicago, not as a portfolio piece.

## Product Purpose

Ghost Stops ranks Chicago's 144 CTA "L" stations by how empty each one is for its context and explains every ranking in plain words. Every station has a shareable page (`/station/[slug]`) with its riders per day, its tier, a "why this score" card, a story, and the stations beside it on the line. Each open station with recent riders gets a Ghost score and a tier. Closed stations and stations without recent data are shown but not ranked.

It exists because a raw ridership list says nothing about whether a station is dying: a small station on a quiet branch can be healthy, and a big station can be fading. The job is to tell those apart and say why.

**Success over the next year (confirmed by Nate, 2026-10-05): the site is a base for more data and cities.** Ghost trains, bus and Pace connections, and other cities are real intentions, and future work leaves room for them. The site must also remain a living public reference: current within CTA's own publishing lag, shareable per station, and correct.

## Positioning

**The score finds it, the story explains it, in that order** (confirmed by Nate, 2026-10-05). The ranking tells a reader which stations are empty for their context, and each station's sourced story says why. Neither ships without the other.

What a neighboring product cannot truthfully copy:

- The Ghost score is a percentile over the ranked stations built from four components: riders against the nearest peers along the station's own line (45%), change from the same period last year (25%), change since 2019 (20%), and day-to-day swings (10%). It never ranks by raw ridership. A component whose window overlaps a closure is set aside and the card states the reason.
- Every station carries a plain-words story and sourced facts reaching back to 2001, generated from the same numbers the score card shows, so the two never disagree. Healthy stations get a growth or stability story and are never called a ghost.
- The network map shows ghost stations fading off the L in ink, with hue reserved for the official CTA line colors.

## Operating Context

- Ridership is CTA's daily station entries (fare-gate entries) on the Chicago Data Portal, dataset `5neh-572f`, read over Socrata's SODA API. CTA publishes in roughly monthly batches, about two months behind, with no announced schedule. Data through 2026-07-31 was current in October 2026.
- A TypeScript sync on Vercel Cron refetches a trailing 60-day window daily and reconciles every station-month against upstream weekly. The site states the data-through date as a calendar date and explains CTA's lag separately from refresh failure. A last successful refresh older than 10 days shows a banner in the UI and turns `/api/health` red, which emails Nate through GitHub Actions.
- Production is Vercel (Fluid compute) and a Neon Postgres project on the Free plan with a 1 GB storage cap, holding the full 2001-to-present history. Migrations run from an operator machine, never in the build.
- The product is Chicago-only today. The `City` model exists and only Chicago is populated.
- Readers arrive by direct station links on phones and laptops. The mobile layout is first-class; the launch posts' "best viewed on desktop" caveat is retired.
- Stations are keyed by their five-digit CTA station id, never by name. Five stations are named Western.

## Capabilities and Constraints

Confirmed functionality:

- `/`: a map of the whole network with tracks in official line colors, and a ledger of every station with sort (Ghost score, riders per day, name), a multi-toggle line filter, and live search. Closed and no-data stations sit in a trailing section.
- `/station/[slug]`: a sign header with the tier word and the rank among ranked stations; riders per day (the 12-month average); the why card with one row per component stating the plain sentence and the real numbers, the peers used, "small but steady" and "small but growing" badges, and data-quality chips; comparisons against the system median, the line median, and the neighbors; a 91-day chart; the story and its facts; along-the-line rows; and sources with the data-through date.
- Themes: dark by default, light available, applied before first paint.
- Public API: `GET /api/chicago/stations`, `GET /api/chicago/stations/{slug}`, `GET /api/health`. Retired slugs redirect to the current one.

Terminology (binding):

- "Ghost score": 0 to 100, where 100 is the most ghost-like. "Rank": 1 is the most ghost-like among ranked stations.
- Tiers: ghost (90 and up), fading (75 to 89), quiet (50 to 74), healthy (under 50). A healthy station is never called a ghost. Headings follow the tier: "Why it's a ghost stop", "Why it's fading", "Why it's quiet", "Why it's healthy".
- "Ranked" means open with recent riders. "Closed" and "no recent data" stations are shown, not ranked.
- "Riders per day" is the 12-month average, the same number the residual component uses.
- "Data through YYYY-MM-DD" is CTA's latest published day, not the refresh date.
- Ghost stops are stations, not ghost trains (scheduled runs that never arrive). Readers conflated the two at launch, so copy says the ranking is by station entries.
- Line names are CTA's: Red, Blue, Brown, Green, Orange, Purple, Pink, Yellow.

Technical constraints:

- Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 3 with the theme replaced by design tokens, Mapbox GL through react-map-gl, `motion` for animation, Prisma 7 over Neon. Tailwind 4 is out of scope. react-spring, use-gesture, recharts, and date-fns are retired and a test keeps them out.
- Dates are calendar strings (YYYY-MM-DD) end to end.
- Components never import server-only modules; UI data comes from the API routes or the server-rendered page.
- No em dashes in rendered text; no emoji in rendered stories.
- Performance and Lighthouse work is out of scope (plan decision, 2026-10-02).

Explicitly undecided or deferred:

- Which growth intention comes first, and when: ghost trains (a different data source), bus and Pace connections (GTFS facts), or other cities (a roster, line sequences, closures, and sources per city). Nate confirmed the direction, not the order.
- Open Graph images per station (text metadata ships; images deferred).
- Event markers for openings and closures on the 90-day chart (deferred).
- A walkshed population and jobs baseline for the residual component (deferred).
- Fare evasion: CTA counts fare-gate entries, so stations in areas with more evasion may undercount. Raised at launch, not addressed in the method.

## Brand Commitments

- Name: Ghost Stops. Wordmark "GHOST STOPS" with "Chicago L" beside it. The logo and the tab icon are a ghost.
- The ghost theme is the frame: the score is the "Ghost score", the top tier is "ghost", and ghostliness reads as fading presence. The register is wayfinding, not Halloween.
- Voice: plain, declarative sentences with real numbers and dates. Freshness is a dated sentence, never a status dot or a "Live" badge. Change words follow the sign of the number, so a growing station is never described as falling.
- Binding visual decisions Nate approved in the revival plan, recorded here without expansion: Direction A "Wayfinding" from `docs/audit-2026-10-02/design.md`; the official CTA line colors are the only hues and appear only on lines; ghostliness is ink presence and mark shape, never a hue; no looping motion; the design reads as Chicago, not as a portfolio piece. The tokens, type, and components as built live in the code and belong in DESIGN.md, not here.

## Evidence on Hand

- Real ridership for every station from 2001-01-02 through the latest CTA publication, deduplicated and reconciled with upstream, in production.
- Station facts and sourced narratives (`StationFact`, `DataSource`, `StationNarrative`), with the richer copy in production. The 95th/Dan Ryan story (11,884 to 3,570 daily riders; jobs within walking distance down 83%) was the most quoted at launch.
- Launch reception, February 2026: the r/chicago post reached 205 points and 37 comments, the r/cta post 59 points and 23 comments. `docs/audit-2026-10-02/reddit-feedback.md` summarizes both. Commenters praised the stories and the 2001 comparisons. These are public comments, not testimonials to quote by name.
- The October 2026 audit and screenshots of the pre-revival UI in `docs/audit-2026-10-02/`.
- Official CTA line colors in `src/lib/utils.ts`; track geometry in `public/data/cta/chicago_track_segments.geojson`.
- Vercel Analytics is installed. No traffic figures are recorded here.
- Absent, do not fabricate: press coverage, named testimonials, user counts, any partnership with or endorsement by CTA or the City of Chicago, and per-station Open Graph images.

## Product Principles

1. **The score finds it, the story explains it.** A ranking without a reason is a leaderboard; a story without a ranking is an essay. Every surface shows both, in that order.
2. **Empty for its context, never just small.** Compare a station with its own line neighbors and its own past. A small, steady station is not a ghost, and the product says so.
3. **The numbers are honest about their age and their gaps.** State the data-through date as a calendar date, explain CTA's lag, say why a component is missing, and never let a refresh failure pass for a quiet station.
4. **Depth is for the enthusiast.** The primary reader wants the method, the peers used, the long-run series, and the sources in reach, not behind a tooltip.
5. **Built to take the next dataset and the next city.** Keep what is Chicago-specific in data rather than in layout, so ghost trains, bus connections, or another system can land without a redesign.

## Accessibility & Inclusion

- Every text token passes WCAG AA on both themes at 13px and above, and no text is under 11px. `src/test/contrast.test.ts` enforces it.
- All motion respects the user's reduced-motion preference; nothing loops.
- Every station row and along-the-line entry is a real button or link with visible focus. Focus moves into the drawer on open and back to the row on close, Escape closes, and a live region announces result counts.
- Ghostliness is never a hue, so the encoding reads the same for color-blind readers. The launch's traffic-light ramp was reported as indistinguishable.
- Known gap: on a phone's map page the bottom sheet (vaul) runs as a modal dialog, hiding the top bar and the map from screen readers. Replacing vaul with a non-modal sheet is the fix.
