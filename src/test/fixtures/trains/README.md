# Train Tracker fixtures

Recorded Train Tracker responses for `src/lib/live/trainTracker.ts` (live Ghost score plan U1).
Every file holds a response body only, re-serialized, with every occurrence of the key replaced:
no file carries a request, a URL, or a `key=` parameter, and `src/test/train-fixtures.test.ts`
checks that on every run (gitleaks covers the same files in CI).

| File | Origin | What it shows |
|---|---|---|
| `positions-2026-10-09.json` | recorded by `scripts/sample-train-tracker.ts` at 22:27 Chicago | all eight routes; Purple with one train, answered as an object rather than a one-element array; Yellow with no train in service, answered with no `train` field |
| `arrivals-2026-10-09.json` | recorded in the same run, stations 40900, 40380, 40830, 41680 | 51 predictions; Howard with several schedule-only entries (`isSch` "1") on one platform at once; Oakton-Skokie with `isFlt` "1"; mixed-case `rt` values |
| `arrivals-single-eta.json` | one entry of the recording, hand-wrapped | a station with one prediction, as the single-object quirk would answer it |
| `error-102.json` | hand-written from the documented error table | the daily quota stop: the `ctatt` envelope with `errCd` "102" and no data |

To record a new pair, export `CTA_TRAIN_TRACKER_KEY` in the shell and run the script; it writes
`<endpoint>-<Chicago date>.json` here and prints the sizes. Each run costs two transactions.
