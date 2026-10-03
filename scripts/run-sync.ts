#!/usr/bin/env tsx

/**
 * Runs the ridership sync from an operator machine, with no 300-second budget (revival plan U10).
 * Same library as the cron route; wide backfills and per-station re-fetches run here, never in
 * the cron.
 *
 *   npx tsx scripts/run-sync.ts                                  # the trailing window, as the daily cron
 *   npx tsx scripts/run-sync.ts --since 2001-01-01               # a wide backfill
 *   npx tsx scripts/run-sync.ts --since 2001-01-01 --station-id 40670 --station-id 40310
 *   npx tsx scripts/run-sync.ts --reconcile                      # the weekly pass: record drift months
 *
 * Needs DATABASE_URL. CHICAGO_DATA_APP_TOKEN, when set, travels only in the X-App-Token header.
 * Prints progress to stderr and the run summary as JSON to stdout; exits 1 unless the run is ok.
 */
import { parseArgs } from "node:util";
import { prisma } from "../src/lib/prisma";
import { runSync, type SyncOptions } from "../src/lib/sync/run";
import { createSocrataSource, CTA_STATION_ID } from "../src/lib/sync/socrata";
import { isCliEntry } from "./cli";
import { isCalendarDate } from "./dates";

export type RunSyncArgs = Pick<SyncOptions, "trigger" | "mode" | "cityCode" | "since" | "ctaStationIds">;

export function parseRunSyncArgs(argv: string[]): RunSyncArgs {
    const { values } = parseArgs({
        args: argv,
        options: {
            since: { type: "string" },
            "station-id": { type: "string", multiple: true },
            reconcile: { type: "boolean", default: false },
            city: { type: "string", default: "chicago" },
        },
        strict: true,
        allowPositionals: false,
    });
    const since = values.since;
    const ctaStationIds = values["station-id"] ?? [];
    if (since !== undefined && !isCalendarDate(since)) throw new Error(`--since must be a YYYY-MM-DD date, got "${since}"`);
    for (const id of ctaStationIds) {
        if (!CTA_STATION_ID.test(id)) throw new Error(`--station-id must be a five-digit CTA station id, got "${id}"`);
    }
    if (values.reconcile && ctaStationIds.length > 0) throw new Error("--reconcile covers every station; drop --station-id");

    // The run record names what was asked for (plan U10).
    const trigger = [
        "local",
        ...(since ? [`--since ${since}`] : []),
        ...ctaStationIds.map((id) => `--station-id ${id}`),
        ...(values.reconcile ? ["--reconcile"] : []),
    ].join(" ");
    return {
        trigger,
        mode: values.reconcile ? "weekly" : "daily",
        cityCode: values.city,
        since,
        ctaStationIds: ctaStationIds.length > 0 ? ctaStationIds : undefined,
    };
}

async function main(): Promise<void> {
    const args = parseRunSyncArgs(process.argv.slice(2));
    const source = createSocrataSource({ appToken: process.env.CHICAGO_DATA_APP_TOKEN });
    try {
        const summary = await runSync(prisma, source, { ...args, log: (line) => console.error(line) });
        console.log(JSON.stringify(summary, null, 2));
        if (summary.status !== "OK") process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

if (isCliEntry(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
