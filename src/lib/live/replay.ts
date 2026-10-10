/**
 * Replays a day's raw lines through the slot tracker (KTD3, KTD16): the sensitivity table and a
 * re-reduce rebuild the tracker from the raw record, under the current parser and rule, exactly
 * as the worker would have. Lines are grouped into ticks at each positions call, the way the
 * worker makes them; a tick's arrivals batches follow its positions line.
 */
import type { RawLine } from "./rawStore";
import { applyTick, createDayTracker, createSweepState, type TickInput, type TrackerState } from "./tracker";
import { parseArrivalsBody, parsePositionsBody, type ArrivalsResponse, type PositionsResponse } from "./trainTracker";

export interface Replay {
    trackers: Map<string, TrackerState>;
    ticks: number;
    /** Lines whose body could not be parsed although CTA answered errCd 0. */
    unparsed: number;
}

/** The lines grouped into ticks: each positions line starts one. */
export function groupTicks(lines: readonly RawLine[]): RawLine[][] {
    const sorted = [...lines].sort((a, b) => a.pollEpoch - b.pollEpoch || (a.endpoint === "positions" ? -1 : 1));
    const ticks: RawLine[][] = [];
    for (const line of sorted) {
        if (line.endpoint === "positions" || ticks.length === 0) ticks.push([line]);
        else ticks[ticks.length - 1].push(line);
    }
    return ticks;
}

export function replayRawLines(lines: readonly RawLine[]): Replay {
    const trackers = new Map<string, TrackerState>();
    const trackerFor = (serviceDate: string): TrackerState => {
        let tracker = trackers.get(serviceDate);
        if (!tracker) {
            tracker = createDayTracker(serviceDate);
            trackers.set(serviceDate, tracker);
        }
        return tracker;
    };
    const sweep = createSweepState();
    let unparsed = 0;
    const ticks = groupTicks(lines);
    for (const tick of ticks) {
        const positionsLine = tick.find((l) => l.endpoint === "positions") ?? null;
        const pollEpoch = positionsLine?.pollEpoch ?? tick[0].pollEpoch;
        let positions: PositionsResponse | null = null;
        if (positionsLine !== null && positionsLine.errorCode === 0 && positionsLine.body !== null) {
            try {
                positions = parsePositionsBody(JSON.parse(positionsLine.body), positionsLine.pollEpoch);
            } catch {
                unparsed += 1;
            }
        }
        const arrivals: TickInput["arrivals"] = [];
        for (const line of tick) {
            if (line.endpoint !== "arrivals") continue;
            let response: ArrivalsResponse | null = null;
            if (line.errorCode === 0 && line.body !== null) {
                try {
                    response = parseArrivalsBody(JSON.parse(line.body), line.pollEpoch, line.stationIds);
                } catch {
                    unparsed += 1;
                }
            }
            arrivals.push({ stationIds: line.stationIds, response });
        }
        applyTick(sweep, trackerFor, { pollEpoch, positions, arrivals });
    }
    return { trackers, ticks: ticks.length, unparsed };
}
