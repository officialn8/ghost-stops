# Live Ghost score fixtures

## `gtfs-rail-slice/` and `gtfs-rail-slice.zip`

A trimmed copy of CTA's static GTFS (`google_transit.zip`, Last-Modified 2026-09-14), cut by
`scripts/cut-gtfs-slice.ts` on 2026-10-09: the six entries `src/lib/live/gtfs.ts` reads, with
every rail platform and parent station, the eight rail routes, and 55 rail trips (per route and
direction: the weekday service's earliest trip, trip nearest 08:00, and latest-ending trip, and
the Saturday and Sunday services' trips nearest 08:00), with every stop time of those trips, the
three rail services' calendar rows, and the Thanksgiving 2026-11-26 exceptions. One bus route, one
bus trip with three stop times, and its three stops (whose descriptions carry quoted commas) stay
in so the tests prove what the extractor drops and how it parses.

The text files are the readable form. The zip is the same six files, made with
`zip -j -X gtfs-rail-slice.zip gtfs-rail-slice/*.txt`, so the real yauzl path is tested too.
