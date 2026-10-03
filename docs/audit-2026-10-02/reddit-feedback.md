# Reddit feedback, February 2026 launch posts

Source threads (posted 2 Feb 2026 by the author as u/SignalBar):

- r/chicago: "Built a site mapping Chicago's emptiest CTA stations" — 205 points, 37 comments
- r/cta: "Ghost Stops - Mapping every CTA station by ridership" — 59 points, 23 comments

Read on 2 Oct 2026. Two collapsed sub-threads in r/chicago (one below score threshold, one three-reply thread under "Even in areas where there has been substantial population and job growth") were not expanded.

## Actionable feedback

### Bugs

| # | Report | Commenter | Plan phase |
|---|---|---|---|
| B1 | On mobile, the first tap on a station opens the detail then immediately closes back to the map. A second tap works. | junktrunk909 (r/chicago) | Phase 4 redesign: detail becomes a route, which removes the sheet open/close race |
| B2 | List has scrolling problems on mobile (author acknowledged). | author reply | Phase 4 |
| B3 | Growth stations get decline language. Logan Square shows "fallen to just 3,947, a -4% drop" when it grew from 3,796. Sign and verb are wrong. | junktrunk909 | Phase 3 (narrative selection by component) and Phase 4 (copy) |
| B4 | "Why this is a ghost stop" appears on every station, including healthy ones. | junktrunk909 | Phase 3/4: tier-aware heading; healthy stations get a different frame |

### Comprehension problems

| # | Report | Commenter | Plan phase |
|---|---|---|---|
| C1 | No visible definition of the ghost score, what is a good or bad value. Needs a tooltip or explainer. | junktrunk909 | Phase 4: one-sentence definition in the header and the "why this score" card |
| C2 | "O'Hare has a ghost score of 22?? What would be a 0?" The floor of the scale is unintuitive. | chilinux (r/cta) | Phase 3: v2 percentile score runs 0–100 by construction; show rank ("12th quietest of 144") |
| C3 | Readers conflate "ghost" with ghost trains (missed scheduled runs). Asked twice. | BunkMoreland1017 (r/chicago), _AlexanderPI2 (r/cta) | Phase 4: subtitle states "ranked by station entries" up front |
| C4 | How is ridership measured? Fare entries would miss fare evasion in low-income areas. | warhugger | Phase 4: methodology note in sources disclosure (CTA counts station entries via fare gates) |

### Design

| # | Report | Commenter | Plan phase |
|---|---|---|---|
| D1 | The red and green extremes make the intermediate shades nearly indistinguishable, even for a non-colorblind viewer. | cjx_p1 (r/cta) | Phase 4: design audit already replaces the traffic-light ramp with an ink presence ramp |
| D2 | "Best viewed on Desktop" caveat in both posts. | author | Phase 4: mobile is first-class in the Wayfinding direction |

### Methodology and feature requests

| # | Request | Commenter | Disposition |
|---|---|---|---|
| M1 | Green Line "worst scores" are exactly where development is landing (43rd, Bronzeville, Damen, Fulton Market). A low-but-growing station should not read as a ghost. | SlabFork (69 points) | Phase 3: v2 year-over-year component plus a "small but growing" badge |
| M2 | Longitudinal impact of station openings and closures on neighbors (Washington, Morgan named). | juniperesque | Partly in Phase 1 (opened/closed dates on stations); chart event markers deferred |
| M3 | Correlate ridership with service frequency, crime, and development over time; predictive model. | junktrunk909 | Deferred. Out of scope for this cycle |
| M4 | Ghost trains feature (trains on trackers that never arrive). Author said "looking into adding". | author, Dionysius00 | Deferred. Different data source; the mock arrivals route is deleted in this cycle |
| M5 | Purple Line stations with bus and Pace connections outperform; "ridership follows connectivity". | author, paulindy2000 | Deferred. Would need GTFS bus connections as a fact |

## Praise worth preserving

The narrative facts landed. Commenters quoted the 95th/Dan Ryan story (11,884 to 3,570 daily riders, jobs within walking distance down 83%) and the 2001 comparisons as the most interesting part. The ranked list and the long-term decline framing drove most of the discussion. Keep the story-per-station model central in the redesign.
