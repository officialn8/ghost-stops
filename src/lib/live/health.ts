/**
 * Train collection health for /api/health (R17; KTD13; F4), beside the ridership report in
 * src/lib/sync/health.ts, which never imports this module.
 *
 * `readTrainFreshness` gives the list, the detail, and the health route the same "observed
 * through" date, the latest counted LiveDay, as `readFreshness` does for ridership. The status
 * is `not-started` whenever no LiveDay row exists, whatever the checkpoint says, so the probe
 * days before the reducer lands never fail the daily GitHub check; after the first row it is
 * `trains-stale` when the checkpoint in the bucket is older than 45 minutes or cannot be read,
 * `trains-unreduced` when the latest LiveDay is more than two service days old, else `ok`. The
 * report carries statuses, dates, and ages only, never error text.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { addDays, optionalDay } from "@/lib/sync/window";
import type { ObjectStore } from "./objectStore";
import { headCheckpoint } from "./rawStore";
import { serviceDateOf } from "./serviceDay";

/** A checkpoint older than this means the worker has stopped (three missed alerts' worth). */
export const CHECKPOINT_STALE_MS = 45 * 60_000;

/** The latest LiveDay may lag today's service day by this many days before it counts as unreduced. */
export const UNREDUCED_AFTER_DAYS = 2;

export interface TrainFreshness {
    /** The latest counted service day, YYYY-MM-DD; null before the first. */
    observedThrough: string | null;
}

export type TrainHealthStatus = "ok" | "not-started" | "trains-stale" | "trains-unreduced";

export interface TrainHealthInputs {
    /** The latest LiveDay row of any verdict; null before the first. */
    latestDay: string | null;
    observedThrough: string | null;
    /** The checkpoint's age from the bucket; "unreadable" when the read failed or no store is configured. */
    checkpointAgeMs: number | null | "unreadable";
}

export interface TrainHealthReport {
    status: TrainHealthStatus;
    observedThrough: string | null;
    latestDay: string | null;
    /** Minutes since the worker last checkpointed; null when unknown. */
    checkpointAgeMinutes: number | null;
}

type Db = Pick<PrismaClient, "liveDay">;

export async function readTrainFreshness(db: Db): Promise<TrainFreshness> {
    const latest = await db.liveDay.findFirst({ where: { verdict: "COUNTED" }, orderBy: { serviceDate: "desc" }, select: { serviceDate: true } });
    return { observedThrough: optionalDay(latest?.serviceDate) };
}

/** The database and bucket facts the assessment needs; a failed bucket read is a fact, not an error. */
export async function readTrainHealthInputs(db: Db, store: ObjectStore | null, now: Date): Promise<TrainHealthInputs> {
    const [latest, freshness] = await Promise.all([
        db.liveDay.findFirst({ orderBy: { serviceDate: "desc" }, select: { serviceDate: true } }),
        readTrainFreshness(db),
    ]);
    let checkpointAgeMs: TrainHealthInputs["checkpointAgeMs"] = "unreadable";
    if (store !== null) {
        try {
            const head = await headCheckpoint(store, now.getTime());
            checkpointAgeMs = head === null ? null : head.ageMs === null ? "unreadable" : head.ageMs;
        } catch {
            checkpointAgeMs = "unreadable";
        }
    }
    return { latestDay: optionalDay(latest?.serviceDate), observedThrough: freshness.observedThrough, checkpointAgeMs };
}

export function assessTrains(inputs: TrainHealthInputs, now: Date): TrainHealthReport {
    const checkpointAgeMinutes = typeof inputs.checkpointAgeMs === "number" ? Math.round(inputs.checkpointAgeMs / 60_000) : null;
    let status: TrainHealthStatus = "ok";
    if (inputs.latestDay === null) status = "not-started";
    else if (typeof inputs.checkpointAgeMs !== "number" || inputs.checkpointAgeMs > CHECKPOINT_STALE_MS) status = "trains-stale";
    else if (inputs.latestDay < addDays(serviceDateOf(now.getTime()), -UNREDUCED_AFTER_DAYS)) status = "trains-unreduced";
    return { status, observedThrough: inputs.observedThrough, latestDay: inputs.latestDay, checkpointAgeMinutes };
}

/** Whether a train status should fail the health check: anything but ok, once collection has started. */
export function trainsFail(report: TrainHealthReport): boolean {
    return report.status !== "ok" && report.status !== "not-started";
}
