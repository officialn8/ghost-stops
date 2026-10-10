#!/usr/bin/env tsx

/**
 * The tolerance sensitivity table over recorded days (live Ghost score plan U7, KTD4): replays
 * each day's raw file from R2 through the tracker and the matcher at tolerances 2, 3, 5, and 8
 * minutes and prints ghosts per 100 system-wide and per line, the share of slots fulfilled by run
 * number after the tolerance, the share of scheduled stops fulfilled from the passage log alone,
 * and how long schedule-only entries stay posted. The plateau value becomes
 * GHOST_TOLERANCE_MINUTES in src/lib/live/matcher.ts, with its date; the table is pasted into the
 * method page's limits section (U16).
 *
 *   npx tsx scripts/live-sensitivity.ts --from 2026-10-15 --to 2026-10-17
 *
 * Needs the four R2_* variables in the shell (the read-write token is fine; nothing is written).
 */
import { parseArgs } from "node:util";
import { addDays, isCalendarDate } from "../src/lib/sync/window";
import type { RailSchedule } from "../src/lib/live/gtfs";
import { GHOST_TOLERANCE_MINUTES } from "../src/lib/live/matcher";
import { createR2Store, readR2Env } from "../src/lib/live/objectStore";
import { readRawDay } from "../src/lib/live/rawStore";
import { replayRawLines } from "../src/lib/live/replay";
import { scheduledStopsFor } from "../src/lib/live/schedule";
import { loadSchedule, readScheduleIndex, versionInForce } from "../src/lib/live/scheduleArchive";
import { formatSensitivityTable, sensitivityTable, type SensitivityDay } from "../src/lib/live/sensitivity";
import { dayCloseInstant } from "../src/lib/live/serviceDay";
import { isCliEntry } from "./cli";

export interface SensitivityArgs {
    from: string;
    to: string;
}

export function parseSensitivityArgs(argv: string[]): SensitivityArgs {
    const { values } = parseArgs({ args: argv, options: { from: { type: "string" }, to: { type: "string" } }, strict: true, allowPositionals: false });
    const { from, to } = values;
    if (!from || !to) throw new Error("--from and --to (YYYY-MM-DD) are required");
    if (!isCalendarDate(from) || !isCalendarDate(to)) throw new Error("--from and --to must be YYYY-MM-DD dates");
    if (to < from) throw new Error("--to must not be before --from");
    return { from, to };
}

async function main(): Promise<void> {
    const { from, to } = parseSensitivityArgs(process.argv.slice(2));
    const store = createR2Store(readR2Env(process.env));
    // The index once, each feed version once: the version in force for a day is the newest first seen before it closed (KTD6).
    const index = await readScheduleIndex(store);
    const archived = new Map<string, RailSchedule | null>();
    const days: SensitivityDay[] = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
        const lines = await readRawDay(store, date);
        if (lines === null) {
            console.error(`${date}: no raw file in the bucket; skipped`);
            continue;
        }
        const version = versionInForce(index, dayCloseInstant(date, GHOST_TOLERANCE_MINUTES));
        if (version !== null && !archived.has(version.hash)) archived.set(version.hash, await loadSchedule(store, version.hash));
        const rail = version === null ? null : (archived.get(version.hash) ?? null);
        if (rail === null) {
            console.error(`${date}: no schedule version in force; skipped`);
            continue;
        }
        const schedule = scheduledStopsFor(rail, date);
        const replay = replayRawLines(lines);
        const tracker = replay.trackers.get(date);
        if (!tracker) {
            console.error(`${date}: the raw file holds no tick of that service day; skipped`);
            continue;
        }
        console.error(`${date}: ${lines.length} lines, ${replay.ticks} ticks, ${Object.keys(tracker.slots).length} slots, ${tracker.passages.length} passages, ${schedule.stops.length} scheduled stops${replay.unparsed ? `, ${replay.unparsed} unparsed` : ""}`);
        days.push({ serviceDate: date, tracker, schedule });
    }
    if (days.length === 0) throw new Error("no day could be replayed");
    console.log(formatSensitivityTable(sensitivityTable(days)));
}

if (isCliEntry(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
