# Ghost Stops: Data Model and Ghost Score Audit

Scope: read-only review of `/Users/nate/ghost-stops` (branch `main`, HEAD `84a9400`) and the local SQLite snapshot `prisma/dev.db` (file dated 2026-02-01; **ridership data actually ends 2025-11-30**, Socrata lags about two months). All numbers below were reproduced from the snapshot with the script `scratchpad/analyze.py`; the Go algorithm was re-implemented in Python and reproduces the stored `ghostScore` for **143/143 stations with zero mismatches**, so the component tables are exact.

Files reviewed: `.claude/CLAUDE.md`, `go-etl/internal/compute/ghost_score.go`, `go-etl/internal/db/client.go`, `go-etl/internal/db/normalize.go`, `go-etl/internal/chicago/{sync,matcher,ridership,parse,gtfs}.go`, `go-etl/cmd/go-etl/main.go`, `prisma/schema.prisma` (+ sqlite/postgres variants), `src/app/api/chicago/stations/route.ts`, `src/app/api/chicago/stations/[id]/route.ts`, `src/lib/cta/stationSequences.ts`, `src/lib/utils.ts`, `src/lib/narratives/archetypes.ts`, `docs/facts-narrative-system.md`, `docs/Ghost-Stops-Transit-Project.md`.

---

## 0. Headline findings

1. **The composite is 98% the ridership percentile.** `corr(ghostScore, ridershipComponent) = 0.98`; `corr(ghostScore, log(30d avg)) = -0.97`. Trend contributes a near-constant 13.6-19.2 points, variability 1.4-4.9 points, context 6/10/14. The score is effectively `0.4 x (inverted percentile) + ~27 +/- 4`. That is why the range is 22-67.
2. **The trend component is pure seasonality.** 143/143 stations have a negative 30d-vs-90d trend (Nov vs Sep-Nov; system ridership fell 17% from Sep-Oct to Nov). `corr(30v90 trend, true YoY) = 0.02`. It carries no station-specific information.
3. **The variability component measures commuter-ness, not erraticness.** `corr(CV, weekend/weekday ratio) = -0.72`. The highest-variability stations are Washington/Wells, Quincy, LaSalle/Van Buren, Merchandise Mart, UIC-Halsted: downtown weekday-commuter stations, not ghosts.
4. **Serious data-integrity bugs in the snapshot** that corrupt both the score inputs and the facts system:
   - 32,388 duplicate `(station, date)` rows (94 stations, 2024-11-30 to 2025-11-30) because `ridership` (CSV) writes `"2006-01-02 15:04:05"` and `sync-ridership` writes RFC3339 `...T00:00:00Z`; the unique index is on the raw text so both survive. 366 of the pairs have different `entries`. In the 30-day window stations have 30-62 rows.
   - **Western (Blue - O'Hare) and Western (Orange) have swapped `ctaStationId`** (DB: Blue-O'Hare=40310, Orange=40670; CTA/GTFS: Blue-O'Hare=40670, Orange=40310, which is what `externalId` says). `MatchStation` tries `ctaStationId` first, so Western (Blue-O'Hare) is showing Orange-line ridership and Western (Orange) is a mix of both (verified against Socrata for 2025-11-03: 40670=3,476, 40310=2,617; DB Western (Blue-O'Hare)=2,478, Western (Orange)=2,478 and 3,424 on the same date).
   - **State/Lake (Loop, Socrata 40260) is not in the `Station` table**; alias `State/Lake -> Lake (Subway)` folds its rows into the Red Line Lake station, last-write-wins per date.
   - `Washington` (Blue) has `ctaStationId = 40500` (the Red Line Washington/State station closed in 2006) and aliases for both; its 2007 yearly average is 2,977 vs 11,444 in 2019, i.e. the closed station's rows overwrote the Blue station's history. `Washington/State` is also aliased to `Washington/Wabash`.
   - Alias collisions mapping one normalized Socrata name to two stations: `central lake`, `kedzie lake`, `oak park lake`, `washington state`. `GetAllStationAliases` loads these into a Go map, so which station wins is load-order dependent.
5. **`Station.lines` is wrong for 5 stations**: Green is listed on Quincy, LaSalle/Van Buren, Washington/Wells and Harold Washington Library (Green does not serve the Wells/Van Buren legs); Wilson lacks Purple (Purple Express stops there).
6. **Neighbor lookup is wrong or nondeterministic for about half of all stations.** The detail API resolves sequence names with Prisma `name: { contains }` + `findFirst` with no ordering; 132 of 286 prev/next lookups match 2-5 stations ("Western" matches 5, "Kedzie" 5, "Chicago" 3). The sequence file also lacks Damen (Green, opened 2024), Halsted (Green) and the Ashland/63rd branch, and Blue Line duplicates ("Harlem", "Western") always resolve to the O'Hare branch.
7. **The 7-day sparkline is always empty** in the list API: it filters `serviceDate >= now() - 7 days` on wall-clock time while the data lags 2+ months.

---

## 1. Algorithm as implemented vs as documented

### 1.1 What matches
| Claim in CLAUDE.md | Code (`ghost_score.go`) | Status |
|---|---|---|
| Weights 40 / 25 / 15 / 20 | `WeightRidership=0.40, WeightTrend=0.25, WeightVariability=0.15, WeightContext=0.20` | Matches |
| Terminal=30, Transfer=70, Normal=50 | `case ContextTerminal: 30; case ContextTransfer: 70; default: 50` | Matches |
| Ridership percentile inverted | `(1 - percentile) * 100`, upper-bound tie rank, min->0 max->1 | Matches |
| Trend = 30d vs 90d | `(r30 - r90)/r90`, mapped `(0.5 - trend)*100`, clamped | Matches (mapping undocumented) |
| Variability = CV | `std30 / max(r30, 50)`, capped at CV=2.0 | Matches (floor and cap undocumented) |

### 1.2 Divergences and undocumented behavior
- **Terminal + transfer => Normal (50).** Howard (Red/Purple/Yellow terminal) is scored as Normal. Not documented in CLAUDE.md.
- **"Transfer" is not a list; it is `len(lines) > 1`.** It therefore depends on the (partly wrong) `Station.lines` JSON, and it flags every Loop elevated station and the Red/Brown/Purple trunk (Belmont, Fullerton) as transfers (19 stations). Physical transfers that are single-line in GTFS (Jackson Red<->Blue, Lake Red<->State/Lake, Washington Blue<->Washington/Wabash) are Normal.
- **Terminal list** (12 names, hardcoded by display name): Howard, 95th/Dan Ryan, O'Hare, Forest Park, Kimball, Harlem/Lake, Cottage Grove, Ashland/63rd, Midway, Linden, 54th/Cermak, Dempster-Skokie. This is **complete and current** for CTA (Brown/Orange/Pink/Purple Express terminate in the Loop, which has no terminal station). It is fragile: a rename (e.g. the DB already uses `"Jefferson Park Transit Center"`) silently drops a flag. 11 stations end up Terminal (Howard is demoted to Normal).
- **Magic numbers:**
  - Trend mapping: -50% => 100, +50% => 0. Observed trends span -27% to -4%, so the component only ever uses 54-77.
  - `CVMeanFloor = 50`: never binds (minimum 30d avg is 220).
  - `CVMax = 2.0`: observed max CV is 0.66, so the variability component is effectively capped at 33/100 and typically 9-20.
  - Windows are inclusive of the boundary day: `>= date(max, '-30 days')` gives a **31-day** window, 90 => 91 days.
  - `MaxDate` is `MAX(serviceDate)` over the whole table, not per city.
  - `int(clamp(...))` truncates rather than rounds.
  - Missing-data stations get `ghostScore = -1`, but the UI's `clampGhostScore` turns that into 0 (reads as "healthy").
- **Score percentiles are computed over `Rolling30dAvg` including stations that may be `zero`**; there is no `zero` status in the ETL (`dataStatus` is only `normal | missing`), although the UI and CLAUDE.md expect `available | missing | zero`.
- **Component scores are computed but never persisted** (`RidershipScore`, `TrendScore`, ... are printed to stdout only). The UI therefore cannot show "why".

### 1.3 Documentation drift
- CLAUDE.md: `cd go-etl && go run cmd/etl/main.go ghost-scores chicago`. Actual: `go run ./cmd/go-etl compute --city chicago` (`cmd/go-etl/main.go`, cobra `compute` command).
- `docs/Ghost-Stops-Transit-Project.md` still defines ghost score as a plain inverted percentile (v1) and states a 365-day rolling window; the snapshot holds **1,296,490 rows back to 2001-01-02** (prune is skipped in backfill mode and was evidently never run), which is actually good news for a YoY model.
- CLAUDE.md API docs list a `dataStatus` field on the list endpoint; `route.ts` does not return it, so `StationRow` falls back to `'available'`.
- CLAUDE.md says `prisma/schema.prisma` is SQLite; it is now `postgresql` (there are `schema.sqlite.prisma` / `schema.postgres.prisma` variants). The detail route uses `INTERVAL '90 days'` in `$queryRaw`, which only works on Postgres.

---

## 2. Statistical critique

### 2.1 Score distribution (prisma/dev.db, 143 stations, data through 2025-11-30)

| Statistic | Value |
|---|---|
| min | 22 (O'Hare) |
| p10 | 32 |
| p25 | 38 |
| median | 48 |
| mean | 47.4 |
| p75 | 57 |
| p90 | 62 |
| max | 67 (Halsted-Green, Harlem-Forest Park, Oakton-Skokie) |

Histogram by tens:

| Bucket | n | |
|---|---|---|
| 20-29 | 8 | `########` |
| 30-39 | 35 | `###################################` |
| 40-49 | 37 | `#####################################` |
| 50-59 | 37 | `#####################################` |
| 60-69 | 26 | `##########################` |
| 70+ | 0 | |

Current color tiers (`getGhostScoreColor`): critical 65+ = **9** stations; warning 50-64 = **54**; moderate 35-49 = **63**; lime 20-34 = **17**; green <20 = **0**. Nothing is ever green, and 38% of the network is "warning" or worse.

Component ranges and weighted contribution:

| Component | min | median | max | weighted contribution range |
|---|---|---|---|---|
| Ridership (inverted percentile) | 0 | 50 | 100 | 0.0 - 40.0 |
| Trend | 54 | 60 | 77 | 13.6 - 19.2 |
| Variability | 9 | 15 | 33 | 1.4 - 4.9 |
| Context | 30 | 50 | 70 | 6.0 - 14.0 |

Theoretical floor is about 21 and ceiling about 78 given the observed inputs, which explains the 22-67 range. Correlations: `corr(composite, ridership comp) = 0.98`; `corr(trend comp, ridership comp) = -0.07`; `corr(variability comp, ridership comp) = -0.04`.

### 2.2 Top 15 (as stored) with component inputs

| # | Station | Lines | Score | 30d avg | Ridership comp | 30v90 trend | Trend comp | CV | Variab comp | Context | True YoY (Nov25 vs Nov24) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Halsted (Green) | Green | 67 | 248 | 99 | -12.3% | 62 | 0.35 | 17 | Normal (50) | -16.6% |
| 2 | Harlem (Blue - Forest Park) | Blue | 67 | 300 | 98 | -12.8% | 63 | 0.35 | 17 | Normal (50) | -10.0% |
| 3 | Oakton-Skokie | Yellow | 67 | 393 | 95 | -13.1% | 63 | 0.44 | 22 | Normal (50) | -0.2% |
| 4 | King Drive | Green | 66 | 220 | 100 | -8.1% | 58 | 0.26 | 13 | Normal (50) | -11.1% |
| 5 | Kostner | Pink | 66 | 231 | 99 | -9.0% | 59 | 0.31 | 15 | Normal (50) | -15.0% |
| 6 | Indiana | Green | 66 | 320 | 97 | -9.5% | 60 | 0.30 | 15 | Normal (50) | -10.4% |
| 7 | South Boulevard | Purple | 65 | 343 | 96 | -7.1% | 57 | 0.30 | 15 | Normal (50) | **+7.9%** |
| 8 | Central (Purple) | Purple | 65 | 390 | 96 | -7.9% | 58 | 0.35 | 18 | Normal (50) | **+9.5%** |
| 9 | Oak Park (Blue) | Blue | 65 | 456 | 90 | -12.3% | 62 | 0.45 | 23 | Normal (50) | -1.7% |
| 10 | 51st | Green | 64 | 415 | 94 | -10.8% | 61 | 0.25 | 13 | Normal (50) | -12.7% |
| 11 | 43rd | Green | 64 | 433 | 92 | -12.9% | 63 | 0.30 | 15 | Normal (50) | -8.5% |
| 12 | Linden | Purple | 63 | 421 | 94 | -19.3% | 69 | 0.38 | 19 | Terminal (30) | **+9.0%** |
| 13 | Foster | Purple | 63 | 426 | 93 | -4.3% | 54 | 0.36 | 18 | Normal (50) | **+7.2%** |
| 14 | Dempster | Purple | 62 | 439 | 92 | -8.1% | 58 | 0.22 | 11 | Normal (50) | **+10.9%** |
| 15 | Conservatory-Central Park Dr | Green | 62 | 448 | 91 | -8.7% | 59 | 0.19 | 10 | Normal (50) | -5.3% |

### 2.3 Bottom 10

| # | Station | Lines | Score | 30d avg | Ridership comp | 30v90 trend | Trend comp | CV | Variab comp | Context | True YoY |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 134 | Wilson | Red | 30 | 3,932 | 9 | -9.4% | 59 | 0.27 | 14 | Normal (50) | -20.5% |
| 135 | Logan Square | Blue | 30 | 3,947 | 8 | -9.3% | 59 | 0.27 | 14 | Normal (50) | +8.6% |
| 136 | Clark/Division | Red | 29 | 4,531 | 7 | -11.2% | 61 | 0.24 | 12 | Normal (50) | +2.7% |
| 137 | Grand (Red) | Red | 29 | 5,763 | 6 | -12.1% | 62 | 0.25 | 13 | Normal (50) | -0.6% |
| 138 | 95th/Dan Ryan | Red | 27 | 3,570 | 13 | -5.4% | 55 | 0.25 | 12 | Terminal (30) | -9.3% |
| 139 | Midway | Orange | 27 | 3,868 | 10 | -10.1% | 60 | 0.33 | 16 | Terminal (30) | -11.3% |
| 140 | Washington (Blue) | Blue | 27 | 6,899 | 3 | -6.9% | 57 | 0.27 | 13 | Normal (50) | +3.9% |
| 141 | Chicago (Red) | Red | 27 | 7,271 | 2 | -8.3% | 58 | 0.23 | 12 | Normal (50) | +3.9% |
| 142 | Lake (Subway) | Red | 26 | 9,383 | 0 | -10.0% | 60 | 0.22 | 11 | Normal (50) | -0.0% |
| 143 | O'Hare | Blue | 22 | 8,580 | 1 | -9.3% | 59 | 0.18 | 9 | Terminal (30) | -1.2% |

### 2.4 Does the ranking match Chicago intuition?

| Station | Rank | Score | 30d avg | Comment |
|---|---|---|---|---|
| Halsted (Green) | 1 | 67 | 248 | Correct: Englewood branch stub, the system's quietest. |
| King Drive | 4 | 66 | 220 | Correct. |
| Kostner | 5 | 66 | 231 | Correct. |
| Indiana | 6 | 66 | 320 | Correct. |
| Oakton-Skokie | 3 | 67 | 393 | Plausible, but its YoY is flat (-0.2%); the "declining" trend score is seasonal. |
| Conservatory-Central Park Dr | 15 | 62 | 448 | Plausible. |
| Ashland/63rd | 31 | 58 | 457 | Terminal penalty (-4) pushes it below similar-volume Green stations. |
| Cicero (Pink) | 35 | 57 | 618 | Mid-pack; reasonable. |
| Kedzie-Homan | 46 | 54 | 701 | Mid-pack; reasonable. |
| Linden, Central, Foster, Dempster, South Boulevard, Noyes (Purple) | 7-14 | 61-65 | 343-510 | **Questionable.** Five of the top 14 are Evanston Purple stations whose ridership is *growing* 7-11% YoY. They are small suburban stations with stable demand: "small", not "ghost". |
| Harlem (Blue - Forest Park) | 2 | 67 | 300 | Data is real (Socrata 40980), but one of only three stations with declining YoY in the top 3; defensible. |
| Loop: Clark/Lake 131, Washington/Wabash 128, Adams/Wabash 110, Quincy 100, Washington/Wells 98 | | 32-41 | 3,439-7,424 | Busy Loop stations correctly score low. **But** LaSalle/Van Buren (#43, 56) and Harold Washington Library (#74, 48) land in "warning" purely because they are the quietest Loop stations and get the +4 transfer bump. |
| O'Hare, Lake, Chicago (Red), Washington (Blue) | 140-143 | 22-27 | 6,899-9,383 | Correct. |

Net: the top of the list is right because low ridership is right; everything else the model claims to add (trend, erraticness, context) is noise or bias.

### 2.5 (a) Low percentile is conflated with "ghost"
Yes. There is no expected-ridership model at all. The percentile is against the whole system, so a 400-rider Evanston stop and a 400-rider Englewood stop are identical to the model, even though the former sits among 400-600-rider neighbors (normal for its branch) and the latter sits on a line whose median is 761 with 2001 ridership several times higher. The context adjustment is the only nod to context and it is a constant per category. The facts system already stores `population_change`, `jobs_walkshed_change`, `vehicle_ownership_pct` for 142 stations, but none of it feeds the score.

A quick residual sketch (station 12-month avg vs its primary line's median) shows a different failure: using *line* as the baseline makes Purple stations look even worse (ratios 0.14-0.24) because the DB's Purple line includes the Loop and the Brown trunk (median 2,431). The baseline must be the **branch/segment neighbors**, not the line.

### 2.6 (b) Trend is seasonally confounded
Confirmed empirically. Window = Nov 2025 (31 days) vs Sep-Nov 2025 (91 days). System ridership: Sep-Oct 344,690/day, Nov 284,811/day (-17%, Thanksgiving week plus normal autumn decline). Result: **every one of 143 stations gets a "declining" trend score (54-77)**, median -10.3%. True YoY (Nov 2025 vs Nov 2024, deduplicated) is median -2.1% with 86/141 negative and a range of -32% to +53%; the two have correlation 0.02. The trend component is thus a constant offset of ~15 points with +/-3 of seasonal noise, and it actively hides real stories (Wilson -20.5% YoY scores the same trend as Logan Square +8.6%).

### 2.7 (c) CV rewards weekday/weekend swing
Confirmed. Over the 30-day window, median weekend/weekday ratio is 0.62 (range 0.19-1.23). All-day CV median is 0.30; weekday-only CV median is 0.21. `corr(all-day CV, weekend/weekday ratio) = -0.72`. The eight highest variability scores are Washington/Wells (we/wd 0.19), Quincy (0.28), LaSalle/Van Buren (0.27), Polk, Merchandise Mart, UIC-Halsted, Monroe (Blue), Racine: commuter and campus stations with very regular weekly cycles. A genuinely erratic station (service disruptions, special events) is indistinguishable. The duplicated rows (30-62 per station in-window) also distort the standard deviation.

### 2.8 (d) Context adjustment only shifts, never re-ranks within category
Correct, and it is a very small shift: +/-4 points (0.2 x 20). It cannot re-rank anything *across* categories meaningfully either, since the ridership component spans 40 points. In practice it: demotes Linden/Ashland/63rd/Cottage Grove/Dempster-Skokie by 4 (arguably right), and promotes every Loop station and Belmont/Fullerton by 4 (not a signal: these are the busiest stations and the bump is invisible at that end). If the intent is "a quiet transfer station is more surprising than a quiet terminal", that belongs in the *expected ridership baseline*, not in an additive constant. Recommendation: remove it as a score term; keep terminal/transfer as metadata used to pick the comparison peer group.

### 2.9 (e) Range compression and normalization
Observed 22-67, theoretical ~21-78; thresholds at 65/50/35/20 produce 0 green stations and 9 red. Options, in order of preference:
1. **Build v2 so each component is a percentile (0-100) and the output is itself re-ranked to a percentile.** Then "80" means "ghostlier than 80% of stations" and the tier boundaries become quantiles by construction (e.g. >=90 critical, 75-89 warning, 50-74 moderate, <50 fine). Explainable in one sentence.
2. If v1 must stay: rescale `score' = clamp((score - 21) / (78 - 21) * 100)` using the *theoretical* bounds (so a future data refresh cannot push it outside 0-100), and move thresholds to 80/60/40/20.
3. Avoid min-max against the *observed* min/max: it makes every station's color change when any single station changes.

---

## 3. Neighbor and line comparisons

### 3.1 Sequence accuracy vs the current CTA map
Checked `CTA_STATION_SEQUENCES` station by station.

| Line | Verdict |
|---|---|
| Red | Correct (33 stations, Howard -> 95th/Dan Ryan). Lawrence/Berwyn reopened 2025; fine. |
| Blue | Correct order (33). But "Harlem" and "Western" appear twice (O'Hare and Forest Park branches) and `findNeighbors` uses `findIndex`, so **Harlem (Blue - Forest Park) and Western (Blue - Forest Park) always get the O'Hare-branch neighbors** (verified: Western-FP's neighbors resolve to California/Damen). |
| Brown | Correct, including counterclockwise Loop order (Washington/Wells -> Quincy -> LaSalle/VB -> Library -> Adams/Wabash -> Washington/Wabash -> State/Lake -> Clark/Lake). |
| Orange | Correct, clockwise Loop. |
| Pink | Correct, clockwise Loop. |
| Purple | Correct Evanston order and Purple Express stops (Wilson included; clockwise Loop). Note DB `Station.lines` for Wilson omits Purple, so the Purple sequence entry is never used for it. |
| Yellow | Correct. |
| Green | **Incomplete.** Missing Damen (opened Aug 2024, between California and Ashland). The Ashland/63rd branch (Halsted, Ashland/63rd) is omitted ("mostly similar" comment) and the branches are linearized: Garfield -> King Drive -> Cottage Grove, so Garfield's "next" is King Drive and the Englewood branch has no neighbors at all. Worse, **Ashland/63rd substring-matches "Ashland" (Lake St) and receives California/Morgan as neighbors.** Halsted (Green) and Damen (Green) are found in no sequence. |
| Loop | Sequences include State/Lake, but **State/Lake is absent from the DB**, so Washington/Wabash's next and Clark/Lake's prev return nothing. |

### 3.2 Join failures between sequences and DB names
`stationSequences.ts` uses bare names ("Western", "Chicago"); the DB uses disambiguated names ("Western (Blue - O'Hare Branch)", "Chicago (Red)"). The detail route bridges them with `prisma.station.findFirst({ where: { name: { contains: prev } } })` and no `orderBy`:

- **132 of 286 prev/next lookups (46%) match more than one station** (or zero). Examples: "Western" -> 5 stations, "Kedzie" -> 5, "Pulaski" -> 4, "Damen" -> 4, "Central" -> 4 (Central (Green), Central (Purple), Central Park, Conservatory-Central Park Drive), "Washington" -> 4, "Chicago" -> 3, "Lake" -> 3 (Clark/Lake, Harlem/Lake, Lake (Subway)), "63rd" -> 2 (63rd, Ashland/63rd), "Division" -> 2 (Division, Clark/Division), "Dempster" -> 2 (Dempster, Dempster-Skokie), "LaSalle" -> 2, "Halsted" -> 3 (incl. UIC-Halsted), "O'Hare" -> 3. `findFirst` returns whatever the engine yields first, so the neighbor panel and `vsNeighbors` are wrong or nondeterministic for roughly half the network, and differ between SQLite (case-insensitive LIKE) and Postgres (case-sensitive).
- Full list of ambiguous lookups is in the `analyze.py` output (section "SEQUENCE CHECK").

### 3.3 `Station.lines` errors that feed line medians and "transfer" status
- Green wrongly on Quincy, LaSalle/Van Buren, Washington/Wells, Harold Washington Library (DB Green membership = 34; should be 30 incl. State/Lake). Green line median therefore includes 3,400-3,500-rider Loop stations.
- Wilson missing Purple.
- No "Purple Express" distinction anywhere (gtfs.go maps `Pexp` -> "Purple Express" but no station carries it; `utils.ts` has a color for it).
- Primary line = first in Red, Blue, Brown, Green, Orange, Purple, Pink, Yellow order. For Loop stations that means Brown (or Blue for Clark/Lake), for Belmont/Fullerton Red, for Howard Red. Line medians for comparison therefore mix branch populations: Purple median 2,431 (Loop + trunk), Green 761, Yellow 797 (3 stations incl. Howard).

### 3.4 Recommendation for this layer
Replace the sequence strings with a `StationLineSequence` table (`stationId`, `line`, `branch`, `seq`) keyed by station UUID (seeded once from GTFS `stop_times`/`shapes` or by hand), eliminate substring joins, and store `prevStationId/nextStationId` per (station, line, branch). Add State/Lake and Damen (Green); model Green branches explicitly (Harlem-Garfield trunk, Ashland/63rd branch, Cottage Grove branch) and Blue branches.

---

## 4. Data model

### 4.1 Schema review (`prisma/schema.prisma`)
- `Station`: `lines String` is a JSON-encoded array. Consequences: the detail route pulls **all** `StationMetrics` with `include: { station: true }` and `JSON.parse`s every station's `lines` in memory on every request to compute one line median; `getStationContext` in Go does the same. No way to index "stations on line X". Fix: `StationLine` junction (`stationId`, `line`, `branch`, `seq`) or a Postgres `text[]`.
- `Station` has both `externalId` (GTFS parent, unique with city) and `ctaStationId` (Socrata) with no constraint that they agree; the Western swap shows why that matters. `ctaStationId` should be unique per city.
- `Station` lacks: `openedDate` (Oakton 2012, Morgan 2012, Cermak-McCormick 2015, Washington/Wabash 2017, Damen-Green 2024, Conservatory 2001-06; needed to suppress YoY/2001 comparisons), `closedRanges` (RPM closures of Lawrence/Berwyn 2021-2025, Argyle/Bryn Mawr temporary stations), `isTerminal`, `structureType` (elevated/subway/at-grade/embankment), `ada`, `parkAndRide`, `communityArea`/neighborhood, `fareZone`, `branch`.
- `RidershipDaily`: `serviceDate DateTime` but SQLite stores whatever text the writer formats; this is the root of the 32,388 duplicates. Also missing `dayType` (Socrata provides `W/A/U` for weekday/Saturday/Sunday-holiday: exactly what the weekday/weekend split needs). `id` is a random UUID TEXT PK plus a separate unique index on `(stationId, serviceDate)` and a redundant non-unique index on the same columns: three b-trees over 1.3M rows. Use `(stationId, serviceDate)` as the PK and drop the uuid.
- `StationMetrics`: stores only `rolling30dAvg`, `rolling90dAvg`, `lastDayEntries`, `ghostScore`, `dataStatus`. Missing: the four component scores, `rank`, `weekdayAvg`, `weekendAvg`, `yoyPct`, `vs2019Pct`, `baselineAvg` + `baselineKind`, `lineMedian`, `neighborAvg`, `daysInWindow`, `dataQuality`. `dataStatus` has no `zero` value although UI expects it.
- Facts system (`DataSource`, `StationFact`, `StationNarrative`): sound design (unique `(stationId, factKey)`, sources, quality enum). Observations from the snapshot: 455 facts; `population_change`, `vehicle_ownership_pct`, `jobs_walkshed_change` for 142 stations; `ridership_decline_pct` for only 25; **no `ridership_2001_avg`/`ridership_latest_avg` facts although every archetype in `archetypes.ts` lists them as required**; all 25 narratives are `suburban_shift` at confidence 0.9 (the doc's own checklist "archetypes distribute reasonably" fails). Facts store `population_change` but not the population *level*, which is what a riders-per-resident baseline needs.

### 4.2 Indexes vs actual queries
| Query | Index used | Gap |
|---|---|---|
| `SELECT MAX(serviceDate) FROM RidershipDaily` (Go `MaxDate` CTE, every ETL run) | none usable (composite index leads with `stationId`) | full scan of 1.3M rows; add index on `(serviceDate)` or compute max per station via the existing index |
| `GetStationMetrics` LEFT JOIN all `RidershipDaily` with CASE windows | `(stationId, serviceDate)` for the join | scans all 25 years per station; filter `serviceDate >= max - 91d` in the JOIN |
| detail: ridership last 90 days for one station | `(stationId, serviceDate)` | fine |
| detail: `station.count where metrics.rolling30dAvg < x` | `StationMetrics(stationId)` unique | fine at 143 rows; becomes a per-request aggregate at multi-city scale |
| detail: `findFirst name contains` x2 | `Station(cityId, name)` cannot serve `LIKE '%x%'` | correctness problem more than performance |
| list: `ridershipDaily where stationId IN (...) and serviceDate >= now-7d` | `(stationId, serviceDate)` | fine, but returns nothing (wall-clock bug) and would return duplicates (14 points) when it does |
| `StationFact where stationId` | `StationFact(stationId)` | fine |
| `StationAlias where normalized` | `StationAlias(normalized)` | fine; but normalized is not unique across stations (4 collisions) |

### 4.3 N+1 / in-memory work
- List route: 1 + 1 + 1 queries, in-memory join and sort over all stations; acceptable for 143, not for multi-city. Should read a precomputed `rank` and page in SQL.
- Detail route: ~9 queries including the all-metrics scan + JSON parsing; the line median and neighbor average should be precomputed in the ETL and stored on `StationMetrics`.
- `prisma.$disconnect()` in `finally` on every request creates a new connection pool per request.

### 4.4 Fields the redesign needs (summary)
`Station`: `branch`, `openedDate`, `closures`, `isTerminal`, `structureType`, `ada`, `parkAndRide`, `communityArea`, `walkshedPopulation`, `walkshedJobs`.
`StationLine`: `stationId, line, branch, seq, prevStationId, nextStationId`.
`RidershipDaily`: `dayType`, date-typed `serviceDate`, composite PK.
`StationMetrics` (or new `StationScoreV2`): component scores and inputs listed in 4.1, plus `scoreVersion`.

---

## 5. Recommendations

### 5.1 Prerequisite data fixes (do these before any re-scoring; all are ETL-side)
1. Normalize `serviceDate` to a date (`YYYY-MM-DD`) in both writers (`ridership.go` line 145, `sync.go` line 156) and dedupe existing rows (keep the RFC3339/latest row).
2. Make `Station.ctaStationId` unique per city; fix Western (Blue-O'Hare)=40670 / Western (Orange)=40310 and Washington (Blue)=40370; re-import those stations' history.
3. Add State/Lake (40260) as a station; delete the `State/Lake -> Lake (Subway)` alias; re-import both.
4. Resolve alias collisions (`central lake`, `kedzie lake`, `oak park lake`, `washington state`); add a unique constraint on `StationAlias.normalized` per city.
5. Fix `Station.lines`: remove Green from Quincy, LaSalle/Van Buren, Washington/Wells, Library; add Purple to Wilson.
6. Store Socrata `daytype`.
7. Fix the list-route sparkline to use `MAX(serviceDate)` rather than `new Date()`.

### 5.2 Ghost Score v2 (implementable in `go-etl/internal/compute` in a day)
All components are computed on deduplicated daily rows and expressed as **percentile ranks 0-100 across scored stations**, then combined and re-ranked so the final score is also a percentile. Stations with `openedDate` inside a comparison window get that component set to the median (50) and flagged.

| Component | Weight | Definition | Lay explanation |
|---|---|---|---|
| **Residual from expected ridership** | 45% | `log(station 12-month avg / baseline)`, baseline = median of the 12-month avgs of the 2 stations either side on the same line/branch (from `StationLine`), excluding Loop and multi-line hubs from the peer set; fall back to branch median when <2 neighbors (terminals). Percentile of the (negative) residual. | "Gets X% of the riders its neighbors get." |
| **Year-over-year change** | 25% | trailing 90-day avg vs the same 90 calendar days one year earlier, weekday and weekend averaged separately then recombined with fixed 5:2 weights (removes day-mix and seasonal effects). Percentile of decline. | "Down X% from the same period last year." |
| **Long-run decline** | 20% | 12-month avg vs 2019 average (pre-pandemic); the DB already holds 2001-2025, so 2001 can be a secondary fact. Percentile of decline. | "Carries X% fewer riders than in 2019." |
| **Erraticness (day-type separated)** | 10% | median absolute deviation / median, computed within weekdays and within weekends (Sunday/holiday via `dayType`) over 90 days, averaged. Percentile. | "Weekday ridership swings +/-X% day to day." |

Rules: drop the constant context term; terminal/transfer flags only choose the peer set. `dataStatus = zero` when 30-day avg < 1 (closed), `missing` when no rows in 60 days: both excluded from percentiles and shown neutrally. Persist all four component percentiles, the raw inputs (baseline value, peer station ids, yoy %, vs-2019 %, weekday/weekend avgs) and `scoreVersion = 2` on `StationMetrics`. Tiers: >=90 "ghost", 75-89 "fading", 50-74 "quiet", <50 "healthy"; these are quantiles by construction and need no recalibration when data refreshes.

Sanity expectations with this design, from the snapshot: Halsted (Green), King Drive, Kostner, Indiana stay at the top (low vs neighbors, -10 to -17% YoY, large 2019 decline); Evanston Purple stations drop out of the top tier (in line with neighbors, growing YoY); LaSalle/Van Buren and Library leave "warning" (expected low relative to Loop peers only, no decline); Wilson surfaces as "fading" (-20% YoY) despite high volume, which is a story the current model cannot tell.

Later (not day-one): add `walkshedPopulation + walkshedJobs` levels to the facts pipeline and switch the baseline to riders per 1,000 residents+jobs; the residual component then controls for density directly rather than through neighbors.

### 5.3 How the UI should explain "why"
- Replace the single `metrics.explanation` sentence with a **"Why this score" card of four rows**, one per component: a 0-100 bar, the plain-English sentence from the table above with the real numbers, and the peers used ("vs Garfield 557 and Ashland/63rd 457"). Each row links the exact `StationFact`/source behind it (CTA Socrata, dayType rules, 2019 baseline).
- Show a **stacked contribution bar** that sums to the headline score so the arithmetic is visible, and a "what would move this" hint ("would fall to 'quiet' if ridership returned to 2019 levels").
- Add a **"small but steady" badge** when the residual component is high but YoY and long-run are low: this is the explicit answer to "a small neighborhood station isn't a ghost".
- Surface **data-quality chips** from the new fields: "opened 2024, no YoY yet", "neighbor comparison unavailable (branch terminus)", "data through 2025-11-30".
- Tie the narrative archetypes to components: `suburban_shift` and `jobs_exodus` should be selected from the long-run component plus census facts, and the archetype card should quote the same numbers the score card shows, so the two never disagree.
- Keep the gauge but drive color from the percentile tier, and show the rank ("12th quietest of 144") next to it; a rank is the most intuitive single number for a lay audience.

---

## Appendix A. Reproduction notes
- Script: `scratchpad/analyze.py` (read-only, `mode=ro`). It re-implements `calculateCompositeScores` including the inclusive 31/91-day windows, upper-bound tie percentile, CV floor/cap, and context rules; 0 mismatches against `StationMetrics.ghostScore`, 0 mismatches on `rolling30dAvg`.
- Socrata spot-check (2025-11-03): 40670 Western/Milwaukee 3,476; 40310 Western-Orange 2,617; 41660 Lake/State 9,683; 40260 State/Lake 7,878; 40370 Washington/Dearborn 8,067; 40500 (Washington/State) no rows.
- Snapshot facts: 143 stations, 1,296,490 ridership rows 2001-01-02..2025-11-30, 32,844 rows in `"YYYY-MM-DD HH:MM:SS"` format vs 1,263,646 RFC3339; 278 aliases; 455 facts; 25 narratives (all `suburban_shift`).
