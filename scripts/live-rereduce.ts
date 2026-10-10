#!/usr/bin/env tsx

/**
 * Re-reduces one past service day from its raw file (live Ghost score plan U8, KTD6, KTD16):
 * replays the day's raw record through the tracker and the reducer under the current rule and
 * the schedule version recorded for the day (or, for a probe day with no row yet, the version in
 * force when it closed), writes it under the current reducer version, asks the site to refresh,
 * and records the raw path. It refuses the open day and any date with no raw day in the bucket;
 * when parts exist but the day object does not, it compacts them first.
 *
 *   npx tsx scripts/live-rereduce.ts --date 2026-10-15
 *
 * Needs DATABASE_URL (the ghost_stops_worker role is enough), the four R2_* variables, and, to
 * refresh the site, WORKER_REVALIDATE_SECRET and SITE_URL. A quota stop on the original day is
 * not visible in the raw record; its minutes are missing, so the day reads as a site gap.
 */
import { parseArgs } from "node:util";
import { GHOST_TOLERANCE_MINUTES } from "../src/lib/live/matcher";
import { finishDay, reduceAndWrite, type NightlyDeps } from "../src/lib/live/nightly";
import { createR2Store, readR2Env } from "../src/lib/live/objectStore";
import { compactDay, readRawDay } from "../src/lib/live/rawStore";
import { replayRawLines } from "../src/lib/live/replay";
import { siteFromEnv } from "../src/lib/live/revalidate";
import { dayCloseInstant } from "../src/lib/live/serviceDay";
import { prisma } from "../src/lib/prisma";
import { isCalendarDate, toUtcDate } from "../src/lib/sync/window";
import { isCliEntry, requireDatabaseUrl } from "./cli";
import { ROSTER_IDS, workerLog as log } from "./live-worker";

export interface RereduceArgs {
    date: string;
}

export function parseRereduceArgs(argv: string[]): RereduceArgs {
    const { values } = parseArgs({ args: argv, options: { date: { type: "string" } }, strict: true, allowPositionals: false });
    if (!values.date) throw new Error("--date YYYY-MM-DD is required");
    if (!isCalendarDate(values.date)) throw new Error(`--date must be a YYYY-MM-DD date, got "${values.date}"`);
    return { date: values.date };
}

/** Whether the service day has closed by `now`; a re-reduce refuses an open day. */
export function isClosed(date: string, nowEpochMs: number): boolean {
    return dayCloseInstant(date, GHOST_TOLERANCE_MINUTES) <= nowEpochMs;
}

async function main(): Promise<void> {
    const { date } = parseRereduceArgs(process.argv.slice(2));
    requireDatabaseUrl();
    if (!isClosed(date, Date.now())) throw new Error(`${date} is still open; a day can be re-reduced once it has closed`);
    const store = createR2Store(readR2Env(process.env));

    // compactDay reports no-parts only after finding no day object either, so the read below says so.
    const compaction = await compactDay(store, date);
    if (compaction.status === "compacted") log(`${date} raw parts compacted first: ${compaction.parts} part(s), ${compaction.bytes} bytes`);
    const lines = await readRawDay(store, date);
    if (lines === null) throw new Error(`${date} has no raw day in the bucket`);
    const replay = replayRawLines(lines);
    const tracker = replay.trackers.get(date);
    if (!tracker) throw new Error(`${date}: the raw file holds no tick of that service day`);
    log(`${date}: ${lines.length} lines, ${replay.ticks} ticks, ${Object.keys(tracker.slots).length} slots, ${tracker.passages.length} passages${replay.unparsed ? `, ${replay.unparsed} unparsed` : ""}`);

    const existing = await prisma.liveDay.findUnique({ where: { serviceDate: toUtcDate(date) }, select: { scheduleVersion: true, reducerVersion: true } });
    const deps: NightlyDeps = { db: prisma, store, stationIds: ROSTER_IDS, site: siteFromEnv(process.env), log };
    if (deps.site === null) log("WORKER_REVALIDATE_SECRET or SITE_URL not set; the site will not be asked to refresh");

    const { reduced, written } = await reduceAndWrite(deps, tracker, { quotaStopped: false, scheduleHash: existing?.scheduleVersion ?? null });
    if (!written) {
        process.exitCode = 1;
        return;
    }
    const finished = await finishDay(deps, { serviceDate: date, reduced: true, revalidated: false, compacted: false });
    console.log(
        JSON.stringify(
            {
                serviceDate: date,
                verdict: reduced.day.verdict,
                cause: reduced.day.cause,
                coverage: reduced.day.coverage,
                faultLines: reduced.day.faultLines,
                scheduleVersion: reduced.day.scheduleVersion,
                reducerVersion: reduced.day.reducerVersion,
                previousReducerVersion: existing?.reducerVersion ?? null,
                stations: reduced.stations.length,
                counted: reduced.stations.filter((s) => s.counted).length,
                ghosts: reduced.stations.reduce((sum, s) => sum + s.ghosts, 0),
                revalidated: finished.revalidated,
                compacted: finished.compacted,
            },
            null,
            2,
        ),
    );
}

if (isCliEntry(import.meta.url)) {
    main()
        .catch((error: unknown) => {
            console.error(error instanceof Error ? error.message : error);
            process.exitCode = 1;
        })
        .finally(() => prisma.$disconnect());
}
