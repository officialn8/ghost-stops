#!/usr/bin/env tsx

/**
 * The live Ghost score worker (plan U6, U20): the always-on process that polls Train Tracker once
 * a minute, keeps the open day's slot tracker, records every call to R2, checkpoints every minute,
 * pings Healthchecks.io, and closes each service day. It runs on one Fly Machine; from an operator
 * shell it also answers the three checks the runbook asks for before a deploy.
 *
 *   npx tsx scripts/live-worker.ts                 # the worker, as Fly runs it
 *   npx tsx scripts/live-worker.ts --once          # one real tick: raw lines to the data dir, call counts and sizes
 *   npx tsx scripts/live-worker.ts --gtfs-check    # the real feed: scheduled stops per line, latest stop time, unmapped parents
 *   npx tsx scripts/live-worker.ts --store-check   # one object round-tripped against the real bucket
 *
 * Environment (docs-private/runbooks/live-worker.md): CTA_TRAIN_TRACKER_KEY; R2_ACCOUNT_ID,
 * R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY; DATABASE_URL (the ghost_stops_worker role);
 * HEALTHCHECKS_PING_URL; WORKER_REVALIDATE_SECRET and SITE_URL; optional LIVE_WORKER_DATA_DIR and
 * FLY_MACHINE_ID. The key and the ping URL are never printed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { todayInChicago } from "../src/lib/cta/closures";
import { CTA_ROSTER } from "../src/lib/cta/roster";
import { createHealthchecks } from "../src/lib/live/healthchecks";
import { createCallSink, runLoop, serializeClosedDay } from "../src/lib/live/loop";
import { GHOST_TOLERANCE_MINUTES } from "../src/lib/live/matcher";
import { closeDay, fillGapDays, finishDay, isOpenOn, type NightlyDeps } from "../src/lib/live/nightly";
import { createMemoryObjectStore, createR2Store, readR2Env, type ObjectStore } from "../src/lib/live/objectStore";
import { createRawWriter, RAW_PREFIX } from "../src/lib/live/rawStore";
import { siteFromEnv } from "../src/lib/live/revalidate";
import { countByRoute, scheduledStopsFor } from "../src/lib/live/schedule";
import { readScheduleIndex, refreshSchedule, versionInForce } from "../src/lib/live/scheduleArchive";
import { pad2, serviceDateOf } from "../src/lib/live/serviceDay";
import { bodyBytes, createTrainTracker, readTrainTrackerKey, type RawCall } from "../src/lib/live/trainTracker";
import { isCliEntry, requireDatabaseUrl } from "./cli";

export type WorkerMode = "run" | "once" | "gtfs-check" | "store-check";

export interface WorkerArgs {
    mode: WorkerMode;
}

export function parseWorkerArgs(argv: string[]): WorkerArgs {
    const { values } = parseArgs({
        args: argv,
        options: {
            once: { type: "boolean", default: false },
            "gtfs-check": { type: "boolean", default: false },
            "store-check": { type: "boolean", default: false },
        },
        strict: true,
        allowPositionals: false,
    });
    const chosen = (["once", "gtfs-check", "store-check"] as const).filter((flag) => values[flag]);
    if (chosen.length > 1) throw new Error("--once, --gtfs-check, and --store-check are separate runs; choose one");
    return { mode: chosen[0] ?? "run" };
}

export function dataDir(env: Record<string, string | undefined>): string {
    return env.LIVE_WORKER_DATA_DIR?.trim() || path.join(os.tmpdir(), "ghost-stops-live");
}

export function machineId(env: Record<string, string | undefined>): string {
    return env.FLY_MACHINE_ID?.trim() || `${os.hostname()}-${process.pid}`;
}

/** Every roster station's CTA id, open or closed. */
export const ROSTER_IDS: readonly string[] = CTA_ROSTER.map((s) => s.ctaStationId);

/** The worker's log line: a UTC timestamp and the message, to stderr. */
export const workerLog = (message: string): void => console.error(`${new Date().toISOString()} ${message}`);
const log = workerLog;

/**
 * The stations to sweep: the roster minus the stations closed today (R18). Train Tracker answers
 * error 103 for a closed station's id (State/Lake since 2026-01-05), which would fail its whole
 * batch of four, and a closed station has no scheduled stops to score anyway.
 */
export function openStationIds(asOf = todayInChicago()): string[] {
    return ROSTER_IDS.filter((id) => isOpenOn(id, asOf));
}

/** Call counts and body sizes for the --once report, from the same records the raw file gets. */
export function summarizeCalls(calls: readonly RawCall[]): string[] {
    const lines: string[] = [];
    for (const endpoint of ["positions", "arrivals"] as const) {
        const of = calls.filter((c) => c.endpoint === endpoint);
        if (of.length === 0) continue;
        const sizes = of.map(bodyBytes);
        const ok = of.filter((c) => c.errorCode === 0).length;
        lines.push(
            `${endpoint}: ${of.length} call(s), ${ok} answered errCd 0, bodies ${Math.min(...sizes)} to ${Math.max(...sizes)} bytes ` +
                `(${sizes.reduce((a, b) => a + b, 0)} total), ${Math.round(of.reduce((a, c) => a + c.durationMs, 0) / of.length)} ms average`,
        );
    }
    const failed = calls.filter((c) => c.failure !== null);
    if (failed.length > 0) lines.push(`failed: ${failed.map((c) => `${c.endpoint} ${c.failure}${c.errorCode === null ? "" : ` errCd ${c.errorCode}`}`).join("; ")}`);
    return lines;
}

async function gtfsCheck(): Promise<number> {
    const store = createMemoryObjectStore();
    const dir = path.join(dataDir(process.env), "gtfs-check");
    const result = await refreshSchedule({ store, feedFile: path.join(dir, "google_transit.zip"), rosterIds: new Set(ROSTER_IDS), log });
    if (result.status !== "archived") {
        console.log(`feed not extracted: ${result.status === "failed" ? result.reason : result.status}`);
        return 1;
    }
    const { schedule, version } = result;
    const today = serviceDateOf(Date.now());
    const day = scheduledStopsFor(schedule, today);
    const hours = Math.floor(schedule.latestStopSeconds / 3600);
    const minutes = Math.floor((schedule.latestStopSeconds % 3600) / 60);
    console.log(`version ${version.hash} (${version.bytes} bytes, Last-Modified ${version.lastModified ?? "unknown"})`);
    console.log(`${schedule.trips.length} rail trips, ${Object.keys(schedule.platforms).length} platforms, ${new Set(Object.values(schedule.platforms)).size} stations, 0 unmapped parents`);
    console.log(`latest scheduled stop ${pad2(hours)}:${pad2(minutes)} (${schedule.latestStopSeconds} s)`);
    console.log(`scheduled stops on service day ${today}: ${day.stops.length}`);
    for (const [route, count] of Object.entries(countByRoute(day))) console.log(`  ${route}: ${count}`);
    return 0;
}

async function storeCheck(): Promise<number> {
    const store = createR2Store(readR2Env(process.env));
    const key = "state/store-check.txt";
    const body = Buffer.from(`store check ${new Date().toISOString()}\n`, "utf8");
    const { etag } = await store.put(key, body, { contentType: "text/plain" });
    const head = await store.head(key);
    const got = await store.get(key);
    await store.delete(key);
    const ok = head !== null && got !== null && got.body.equals(body) && (await store.head(key)) === null;
    console.log(`${key}: put (etag ${etag ?? "none"}), head ${head?.size ?? "missing"} bytes, get ${got?.body.byteLength ?? "missing"} bytes, delete: ${ok ? "ok" : "FAILED"}`);
    return ok ? 0 : 1;
}

async function once(): Promise<number> {
    const key = readTrainTrackerKey(process.env);
    const dir = path.join(dataDir(process.env), "once");
    fs.rmSync(dir, { recursive: true, force: true });
    const store = createMemoryObjectStore();
    const rawWriter = createRawWriter({ dir, store, log });
    const sink = createCallSink(rawWriter);
    const calls: RawCall[] = [];
    const source = createTrainTracker({
        key,
        onCall: (call) => {
            calls.push(call);
            sink.onCall(call);
        },
    });
    const result = await runLoop({ source, sink, store, rawWriter, stations: openStationIds, machineId: machineId(process.env), signal: new AbortController().signal, maxTicks: 1, log });
    // The memory store holds the uploaded part; write it beside the data dir for inspection.
    for (const part of await store.list(`${RAW_PREFIX}/`)) {
        const file = path.join(dir, path.basename(part.key));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, (await store.get(part.key))!.body);
        console.log(`raw part: ${file} (${part.size} bytes gzipped)`);
    }
    console.log(`tick: ${result.ticks}, exit ${result.exit}`);
    for (const line of summarizeCalls(calls)) console.log(line);
    return calls.some((c) => c.failure !== null) ? 1 : 0;
}

async function run(): Promise<number> {
    const key = readTrainTrackerKey(process.env);
    requireDatabaseUrl();
    const store: ObjectStore = createR2Store(readR2Env(process.env));
    const dir = dataDir(process.env);
    const rawWriter = createRawWriter({ dir: path.join(dir, "parts"), store, log });
    const sink = createCallSink(rawWriter);
    const source = createTrainTracker({ key, onCall: sink.onCall });
    const pingUrl = process.env.HEALTHCHECKS_PING_URL?.trim();
    const healthchecks = pingUrl ? createHealthchecks({ pingUrl, log }) : null;
    if (healthchecks === null) log("HEALTHCHECKS_PING_URL is not set; no dead-man's switch");

    // The schedule: checked now and after each day close; the newest version's latest stop time
    // decides the day's close instant.
    const feedFile = path.join(dir, "gtfs", "google_transit.zip");
    const refresh = async () => {
        const result = await refreshSchedule({ store, feedFile, rosterIds: new Set(ROSTER_IDS), log });
        log(`schedule check: ${result.status}${result.status === "failed" ? ` (${result.reason})` : ""}`);
    };
    await refresh();
    const latestStopSeconds = versionInForce(await readScheduleIndex(store), Date.now())?.latestStopSeconds;

    // The nightly steps (U8): reduce and write the closed day, refresh the site, compact the raw
    // day; finish a day the checkpoint left half done; record gap days as set aside.
    const { prisma } = await import("../src/lib/prisma");
    const site = siteFromEnv(process.env);
    if (site === null) log("WORKER_REVALIDATE_SECRET or SITE_URL is not set; the site will not be asked to refresh");
    const nightly: NightlyDeps = {
        db: prisma,
        store,
        stationIds: ROSTER_IDS,
        site,
        healthchecks,
        toleranceMinutes: GHOST_TOLERANCE_MINUTES,
        log,
    };

    const controller = new AbortController();
    const stop = (signal: NodeJS.Signals) => {
        log(`${signal} received; finishing the tick`);
        controller.abort();
        setTimeout(() => {
            log("shutdown took too long; exiting");
            process.exit(1);
        }, 30_000).unref();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);

    const result = await runLoop({
        source,
        sink,
        store,
        rawWriter,
        stations: openStationIds,
        machineId: machineId(process.env),
        toleranceMinutes: GHOST_TOLERANCE_MINUTES,
        latestStopSeconds,
        signal: controller.signal,
        healthchecks,
        hooks: {
            onDayClose: async (tracker, context) => {
                // The serialized tracker stays beside the raw day: the record of what the worker held.
                await serializeClosedDay(store, tracker);
                const day = await closeDay(nightly, tracker, { quotaStopped: context.quota.stopped });
                await fillGapDays(nightly, Date.now());
                await refresh();
                return day;
            },
            finishDay: (day) => finishDay(nightly, day),
            fillGaps: (now) => fillGapDays(nightly, now).then(() => {}),
        },
        log,
    });
    log(`worker exit: ${result.exit} after ${result.ticks} tick(s)`);
    return result.exit === "lost-lease" ? 1 : 0;
}

const RUNS: Record<WorkerMode, () => Promise<number>> = { run, once, "gtfs-check": gtfsCheck, "store-check": storeCheck };

async function main(): Promise<void> {
    const { mode } = parseWorkerArgs(process.argv.slice(2));
    process.exitCode = await RUNS[mode]();
    if (mode === "run") {
        const { prisma } = await import("../src/lib/prisma");
        await prisma.$disconnect();
    }
}

if (isCliEntry(import.meta.url)) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    });
}
