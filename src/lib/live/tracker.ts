/**
 * The slot tracker: what one service day's polls say about every schedule-only prediction and
 * every train that came (KTD4). Pure data and pure functions, checkpointed whole every minute
 * (KTD2); the verdicts are taken later by the matcher (U7).
 *
 * Two records per day:
 * - a slot for every schedule-only prediction, keyed by station, platform, route, and the
 *   scheduled minute, holding when it was first and last seen, the run numbers it carried, CTA's
 *   fault flag, and whether a live prediction with one of those runs later showed at the same
 *   platform ("replaced by a live prediction with the same run");
 * - a passage for every live prediction that showed "approaching", or a predicted arrival within
 *   two minutes of the poll, and then vanished from the station's board: the train came. Its
 *   passage time is the last live predicted arrival.
 *
 * A prediction belongs to the day of the time it names, so the minutes around 03:00 feed two
 * open days. The boundary is read with the close margin's grace (`OVERLAP_MS`): a live train whose
 * arrival slipped from 02:58 to 03:02 is still the train the earlier day's slot was waiting for,
 * so its sighting marks that day's slots too, and its passage is filed under both days when the
 * arrival it first named falls in the other. Each day's stops are disjoint, so a day credits a
 * train at most once, and the doubling is bounded to those minutes.
 *
 * Live predictions still on a board are held across ticks in `SweepState`, which is shared by
 * every open day. Each day also keeps a poll ledger: per minute of the day, whether the positions
 * call succeeded, the stations whose arrivals batch failed, the live trains seen per route, and
 * the entries the parser could not read. A minute with no record is a minute the worker did not
 * poll.
 */
import { DAY_CLOSE_MARGIN_MINUTES, MINUTE_MS, minuteIndexOf, serviceDateOf } from "./serviceDay";
import { TRAIN_ROUTES, type ArrivalsResponse, type PositionsResponse, type TrainRoute } from "./trainTracker";

/** A live prediction counts as "about to arrive" within this many ms of the poll. */
export const PASSAGE_WINDOW_MS = 2 * MINUTE_MS;

/**
 * How far past a day's end a live prediction still speaks for that day: a slot of the day whose
 * run shows live for a time this far into the next is marked, and a passage first predicted for
 * the day is filed under it too. The close margin, within which the day is still open to take them.
 */
const OVERLAP_MS = DAY_CLOSE_MARGIN_MINUTES * MINUTE_MS;

export interface Slot {
    key: string;
    stationId: string;
    stopId: string;
    route: TrainRoute;
    /** The scheduled instant the prediction names, epoch ms, and CTA's text for it. */
    scheduledAt: number;
    scheduledText: string;
    /** Poll epochs. */
    firstSeen: number;
    lastSeen: number;
    /** The run numbers the entry carried, in the order seen. */
    runs: string[];
    /** CTA flagged the scheduled departure as not having happened (`isFlt`). */
    fault: boolean;
    /** The poll epoch a live prediction with one of `runs` first showed at this platform; null if never. */
    liveSameRunAt: number | null;
}

export interface Passage {
    stationId: string;
    stopId: string;
    route: TrainRoute;
    run: string;
    /** The last live predicted arrival, epoch ms: the passage time. */
    arrivedAt: number;
    /** The poll epoch the prediction was last seen, and the one it was gone by. */
    lastSeen: number;
    vanishedAt: number;
}

/** A live prediction still on a board, held between ticks. */
export interface OpenLive {
    stationId: string;
    stopId: string;
    route: TrainRoute;
    run: string;
    lastSeen: number;
    /** The predicted arrival when first seen, never updated. Absent only in a checkpoint written before the field; read as `lastArrival`. */
    firstArrival?: number;
    lastArrival: number;
    /** Showed "approaching", or an arrival within the passage window of the poll, at some tick. */
    near: boolean;
}

export interface MinuteRecord {
    /** 1 when the positions call succeeded. */
    p: 0 | 1;
    /** Stations whose arrivals batch failed or was not made. */
    f: string[];
    /** Live trains per route in `TRAIN_ROUTES` order, from the positions call; null when it failed. */
    t: number[] | null;
    /** Entries the parser could not read across the tick's responses (the feed-shape check, KTD7). */
    m: number;
}

export interface TrackerState {
    serviceDate: string;
    slots: Record<string, Slot>;
    passages: Passage[];
    /** By minute index from the day's start; minutes past the day's end belong to the overlap. */
    minutes: Record<string, MinuteRecord>;
}

export interface SweepState {
    openLive: Record<string, OpenLive>;
}

export function createDayTracker(serviceDate: string): TrackerState {
    return { serviceDate, slots: {}, passages: [], minutes: {} };
}

export function createSweepState(): SweepState {
    return { openLive: {} };
}

export const slotKey = (stationId: string, stopId: string, route: TrainRoute, scheduledAt: number) =>
    `${stationId}|${stopId}|${route}|${Math.floor(scheduledAt / MINUTE_MS)}`;

/** One platform and route at a station: where a live train and a slot can be the same train. */
export const platformKey = (stationId: string, stopId: string, route: TrainRoute) => `${stationId}|${stopId}|${route}`;

const liveKey = (stationId: string, stopId: string, route: TrainRoute, run: string) => `${platformKey(stationId, stopId, route)}|${run}`;

/**
 * A day's slots by platform, so a live prediction checks only the slots at its own platform
 * rather than every slot of the day, every minute. Built once per tracker object from its slots
 * (a tracker restored from a checkpoint builds its own) and kept beside the state, outside what
 * is serialized.
 */
const slotsByPlatform = new WeakMap<TrackerState, Map<string, Slot[]>>();

function platformSlots(tracker: TrackerState): Map<string, Slot[]> {
    let index = slotsByPlatform.get(tracker);
    if (index === undefined) {
        index = new Map();
        for (const slot of Object.values(tracker.slots)) indexSlot(index, slot);
        slotsByPlatform.set(tracker, index);
    }
    return index;
}

function indexSlot(index: Map<string, Slot[]>, slot: Slot): void {
    const key = platformKey(slot.stationId, slot.stopId, slot.route);
    const list = index.get(key);
    if (list === undefined) index.set(key, [slot]);
    else list.push(slot);
}

/** The day's slots at one platform and route, in the order they were opened. */
export function slotsAtPlatform(tracker: TrackerState, stationId: string, stopId: string, route: TrainRoute): readonly Slot[] {
    return platformSlots(tracker).get(platformKey(stationId, stopId, route)) ?? [];
}

/** One tick's results as the loop hands them over; a null response is a failed call. */
export interface TickInput {
    pollEpoch: number;
    positions: PositionsResponse | null;
    /** One entry per arrivals batch, the stations it covered and its answer. */
    arrivals: { stationIds: string[]; response: ArrivalsResponse | null }[];
}

/**
 * The day a tick's records go to, created on first use so the overlap around 03:00 has both days;
 * null for a day that has already closed, whose records are dropped.
 */
export type TrackerFor = (serviceDate: string) => TrackerState | null;

/**
 * Applies one tick: the ledger line for the poll's day, the slots and passages for the day each
 * prediction's time names, and the open live predictions for the next tick.
 */
export function applyTick(sweep: SweepState, trackerFor: TrackerFor, tick: TickInput): void {
    const { positions } = tick;
    const pollDay = serviceDateOf(tick.pollEpoch);
    const failed = tick.arrivals.filter((b) => b.response === null).flatMap((b) => b.stationIds).sort();
    const trains = positions === null ? null : TRAIN_ROUTES.map((route) => positions.routes.find((r) => r.route === route)?.trains.length ?? 0);
    const malformed = (positions?.malformed ?? 0) + tick.arrivals.reduce((sum, b) => sum + (b.response?.malformed ?? 0), 0);
    const record: MinuteRecord = { p: positions === null ? 0 : 1, f: failed, t: trains, m: malformed };
    const pollTracker = trackerFor(pollDay);
    if (pollTracker !== null) pollTracker.minutes[String(minuteIndexOf(pollDay, tick.pollEpoch))] = record;
    // The day that closes at 03:15 still sees the polls after 03:00, under indexes past its end.
    const yesterday = serviceDateOf(tick.pollEpoch - 60 * MINUTE_MS);
    if (yesterday !== pollDay) {
        const previous = trackerFor(yesterday);
        if (previous !== null) previous.minutes[String(minuteIndexOf(yesterday, tick.pollEpoch))] = record;
    }

    const seenNow = new Set<string>();
    for (const batch of tick.arrivals) {
        if (batch.response === null) continue;
        for (const prediction of batch.response.predictions) {
            const { stationId, stopId, route, run } = prediction;
            if (prediction.scheduled) {
                const day = trackerFor(serviceDateOf(prediction.arrivalAt));
                if (day === null) continue;
                const key = slotKey(stationId, stopId, route, prediction.arrivalAt);
                const slot = day.slots[key];
                if (slot === undefined) {
                    const created: Slot = {
                        key,
                        stationId,
                        stopId,
                        route,
                        scheduledAt: prediction.arrivalAt,
                        scheduledText: prediction.arrivalText,
                        firstSeen: tick.pollEpoch,
                        lastSeen: tick.pollEpoch,
                        runs: [run],
                        fault: prediction.fault,
                        liveSameRunAt: null,
                    };
                    // The index builds lazily from `day.slots`, so take it before the insert: a first
                    // slot inserted first would be indexed by the build and then again here.
                    const index = platformSlots(day);
                    day.slots[key] = created;
                    indexSlot(index, created);
                } else {
                    slot.lastSeen = tick.pollEpoch;
                    if (!slot.runs.includes(run)) slot.runs.push(run);
                    slot.fault = slot.fault || prediction.fault;
                }
                continue;
            }

            const key = liveKey(stationId, stopId, route, run);
            seenNow.add(key);
            const near = prediction.approaching || prediction.arrivalAt - tick.pollEpoch <= PASSAGE_WINDOW_MS;
            const open = sweep.openLive[key];
            if (open === undefined) {
                sweep.openLive[key] = { stationId, stopId, route, run, lastSeen: tick.pollEpoch, firstArrival: prediction.arrivalAt, lastArrival: prediction.arrivalAt, near };
            } else {
                open.lastSeen = tick.pollEpoch;
                open.lastArrival = prediction.arrivalAt;
                open.near = open.near || near;
            }
            // A live train with a run an open slot carried, at the slot's platform: the slot was replaced.
            // The slot sits in the day the arrival names, or in the day before when the arrival is
            // within the overlap of its end (a 02:58 slot whose train now reads 03:02), or the poll's day.
            for (const day of new Set([trackerFor(serviceDateOf(prediction.arrivalAt)), trackerFor(serviceDateOf(prediction.arrivalAt - OVERLAP_MS)), pollTracker])) {
                if (day === null) continue;
                for (const slot of slotsAtPlatform(day, stationId, stopId, route)) {
                    if (slot.liveSameRunAt === null && slot.runs.includes(run)) slot.liveSameRunAt = tick.pollEpoch;
                }
            }
        }
    }

    // A live prediction gone from a board that was polled this tick: the train came, if it was near.
    const polled = new Set(tick.arrivals.filter((b) => b.response !== null).flatMap((b) => b.stationIds));
    for (const [key, open] of Object.entries(sweep.openLive)) {
        if (seenNow.has(key) || !polled.has(open.stationId)) continue;
        delete sweep.openLive[key];
        if (!open.near) continue;
        const passage: Passage = {
            stationId: open.stationId,
            stopId: open.stopId,
            route: open.route,
            run: open.run,
            arrivedAt: open.lastArrival,
            lastSeen: open.lastSeen,
            vanishedAt: tick.pollEpoch,
        };
        // Filed under the day of the passage time, and under the day of the arrival first predicted
        // when that differs: a train predicted for 02:58 that came at 03:02 is the one the earlier
        // day's stop was waiting for. Each day's stops are disjoint, so each day credits it at most
        // once, and only a train that crossed 03:00 while on a board is filed twice.
        for (const date of new Set([serviceDateOf(open.lastArrival), serviceDateOf(open.firstArrival ?? open.lastArrival)])) {
            const day = trackerFor(date);
            if (day !== null) day.passages.push(passage);
        }
    }
}

/** The minute records inside the day's expected count, the overlap past its end left out. */
export function minutesWithin(tracker: TrackerState, expectedPolls: number): MinuteRecord[] {
    const records: MinuteRecord[] = [];
    for (const [index, record] of Object.entries(tracker.minutes)) {
        const minute = Number(index);
        if (minute >= 0 && minute < expectedPolls) records.push(record);
    }
    return records;
}

/** The minutes (under the expected count) a station's arrivals batch succeeded in. */
export function stationPolls(tracker: TrackerState, stationId: string, expectedPolls: number): number {
    return minutesWithin(tracker, expectedPolls).filter((r) => !r.f.includes(stationId)).length;
}

/** True when any minute from `fromEpoch` to `toEpoch` (inclusive, by minute index) has no record or lists the station as failed. */
export function hasGap(tracker: TrackerState, stationId: string, fromEpoch: number, toEpoch: number): boolean {
    const first = minuteIndexOf(tracker.serviceDate, fromEpoch);
    const last = minuteIndexOf(tracker.serviceDate, toEpoch);
    for (let index = first; index <= last; index++) {
        const record = tracker.minutes[String(index)];
        if (record === undefined || record.f.includes(stationId)) return true;
    }
    return false;
}
