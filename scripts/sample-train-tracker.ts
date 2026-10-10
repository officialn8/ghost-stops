#!/usr/bin/env tsx

/**
 * Records one Train Tracker body per endpoint as a test fixture (live Ghost score plan U1): a
 * positions response for all eight routes and an arrivals response for a batch of four stations.
 * Each file holds the body only, with every occurrence of the key replaced, and no request field:
 * the key travels in the query string, so no URL is ever written.
 *
 *   npx tsx scripts/sample-train-tracker.ts
 *   npx tsx scripts/sample-train-tracker.ts --station-id 40900 --station-id 40380 --out src/test/fixtures/trains
 *
 * Needs CTA_TRAIN_TRACKER_KEY in the shell (it lives in .env.local, which nothing here reads).
 * Each run costs two of the key's daily transactions. Prints the files written and their sizes.
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { todayInChicago } from "../src/lib/cta/closures";
import {
    ARRIVALS_BATCH_SIZE,
    createTrainTracker,
    CTA_STATION_ID,
    scrubKey,
    type RawCall,
} from "../src/lib/live/trainTracker";
import { isCliEntry } from "./cli";

/** Howard (a terminal with four platforms), Clark/Lake (the Loop, five lines), 18th, Oakton-Skokie (Yellow). */
export const DEFAULT_STATION_IDS = ["40900", "40380", "40830", "41680"] as const;
export const DEFAULT_OUT_DIR = "src/test/fixtures/trains";

export interface SampleArgs {
    stationIds: string[];
    outDir: string;
}

export function parseSampleArgs(argv: string[]): SampleArgs {
    const { values } = parseArgs({
        args: argv,
        options: {
            "station-id": { type: "string", multiple: true },
            out: { type: "string", default: DEFAULT_OUT_DIR },
        },
        strict: true,
        allowPositionals: false,
    });
    const stationIds = values["station-id"] ?? [...DEFAULT_STATION_IDS];
    for (const id of stationIds) {
        if (!CTA_STATION_ID.test(id)) throw new Error(`--station-id must be a five-digit CTA station id, got "${id}"`);
    }
    if (stationIds.length > ARRIVALS_BATCH_SIZE) throw new Error(`at most ${ARRIVALS_BATCH_SIZE} station ids per arrivals call`);
    return { stationIds, outDir: values.out };
}

/** The fixture text: the body re-serialized, so a file never carries bytes the parser did not read. */
export function fixtureText(body: string, key: string): string {
    return `${JSON.stringify(JSON.parse(scrubKey(body, key)), null, 2)}\n`;
}

async function main(): Promise<void> {
    const args = parseSampleArgs(process.argv.slice(2));
    const key = process.env.CTA_TRAIN_TRACKER_KEY?.trim();
    if (!key) throw new Error("CTA_TRAIN_TRACKER_KEY must be set in this shell; it is not read from .env.local.");

    const calls: RawCall[] = [];
    const tracker = createTrainTracker({ key, onCall: (call) => calls.push(call) });
    // Named by the Chicago date, the date the bodies' own timestamps carry.
    const date = todayInChicago();
    fs.mkdirSync(args.outDir, { recursive: true });

    const positions = await tracker.positions();
    const arrivals = await tracker.arrivals(args.stationIds);

    for (const call of calls) {
        if (call.body === null) continue;
        const file = path.join(args.outDir, `${call.endpoint}-${date}.json`);
        fs.writeFileSync(file, fixtureText(call.body, key));
        console.log(`${file}: ${fs.statSync(file).size} bytes, HTTP ${call.httpStatus}, errCd ${call.errorCode}, ${call.durationMs} ms`);
    }
    console.log(
        `positions: ${positions.routes.map((r) => `${r.route} ${r.trains.length}`).join(", ")} (${positions.malformed} malformed)`,
    );
    console.log(
        `arrivals: ${arrivals.predictions.length} predictions at ${args.stationIds.join(", ")}, ` +
            `${arrivals.predictions.filter((p) => p.scheduled).length} schedule-only (${arrivals.malformed} malformed)`,
    );
}

if (isCliEntry(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
