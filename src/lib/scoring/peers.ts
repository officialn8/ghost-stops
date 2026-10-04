/**
 * The peer set behind score v2's residual (KTD8): the stations a station's 12-month average is
 * compared with, so a small station in a quiet part of a line is judged against its neighbors,
 * not against the whole system.
 *
 * - A station outside the Loop: the nearest eligible station on each side along its primary
 *   line, walking past stations that cannot be peers (a closed station, say) and following
 *   junctions (at a fork, the nearest on each path), but never past a hub. A terminal, or a
 *   station with nothing eligible on one side before a hub, takes the two nearest on its other side.
 * - A Loop station: the other eligible Loop stations.
 * - A multi-line hub (Belmont, Fullerton, Howard, Roosevelt, Clark/Lake): every eligible station
 *   on its primary line's branch, since its own neighbors are a different kind of station.
 *
 * Hubs are never anyone's peer, nor are Loop stations for a station outside the Loop. The
 * baseline is the median of the peers' 12-month averages. Topology comes from
 * src/lib/cta/sequences.ts, the same branches the StationLineSequence table is seeded from, plus
 * the junctions that table does not hold.
 */
import { branchOf, getPrimaryLine, LINE_BRANCHES, linesForStation, neighborsOnLine } from "@/lib/cta/sequences";
import type { CTALine } from "@/lib/utils";
import type { PeerBasis } from "@/types/station";
import { median } from "./components";

export type { PeerBasis };

export const HUB_CTA_IDS: ReadonlySet<string> = new Set([
    "41320", // Belmont (Red/Brown/Purple)
    "41220", // Fullerton
    "40900", // Howard
    "41400", // Roosevelt
    "40380", // Clark/Lake
]);

/** The eight elevated Loop stations, from the ring branch the four Loop lines share. */
export const LOOP_CTA_IDS: ReadonlySet<string> = new Set(LINE_BRANCHES.find((b) => b.ring)?.stations ?? []);

/** A station that may serve as a peer: ranked, with a 12-month window clear of closures and its opening. */
export interface PeerCandidate {
    stationId: string;
    avg12m: number;
}

export interface PeerSet {
    basis: PeerBasis;
    /** The station's primary line and its branch there ("loop" for a Loop station); null off the map. */
    line: CTALine | null;
    branch: string | null;
    ctaStationIds: string[];
    stationIds: string[];
    /** The peers' 12-month averages, in the order of `ctaStationIds`. */
    avg12m: number[];
    /** The median of `avg12m`; null with no peers. */
    baseline: number | null;
}

type Side = "prev" | "next";

interface Walk {
    /** Keep walking a path past a peer it found, or end the path there. */
    pastPeers: boolean;
    /** Stop once this many peers are found. */
    limit: number;
}

/** The nearest peer on every path one way. */
const NEAREST_ON_EACH_PATH: Walk = { pastPeers: false, limit: Infinity };
/** The two nearest peers one way, for a station with none on its other side. */
const TWO_NEAREST: Walk = { pastPeers: true, limit: 2 };

/**
 * Walks one way from `start`, breadth first, through stations that cannot be peers, and returns
 * the peers it reaches, nearest first. A hub ends a path: past it the track belongs to more lines,
 * and the stations there are not this stretch's neighbors (South Boulevard would otherwise reach
 * past Howard to Wilson).
 */
function walkToPeers(start: string, line: CTALine, side: Side, canPeer: (id: string) => boolean, walk: Walk): string[] {
    const found: string[] = [];
    const seen = new Set([start]);
    let frontier = [start];
    while (frontier.length > 0 && found.length < walk.limit) {
        const next: string[] = [];
        for (const id of frontier) {
            for (const neighbor of neighborsOnLine(id, line)?.[side] ?? []) {
                if (seen.has(neighbor)) continue;
                seen.add(neighbor);
                const peer = canPeer(neighbor);
                if (peer && found.length < walk.limit) found.push(neighbor);
                if (HUB_CTA_IDS.has(neighbor) || (peer && !walk.pastPeers)) continue;
                next.push(neighbor);
            }
        }
        frontier = next;
    }
    return found;
}

function peerSet(
    basis: Exclude<PeerBasis, "none">,
    line: CTALine | null,
    branch: string | null,
    ctaStationIds: string[],
    eligible: ReadonlyMap<string, PeerCandidate>,
): PeerSet {
    const peers = ctaStationIds.map((id) => eligible.get(id)!);
    const avg12m = peers.map((p) => p.avg12m);
    return {
        basis: ctaStationIds.length > 0 ? basis : "none",
        line,
        branch,
        ctaStationIds,
        stationIds: peers.map((p) => p.stationId),
        avg12m,
        baseline: median(avg12m),
    };
}

/**
 * The peers of the station with CTA id `ctaStationId`, chosen from `eligible` (keyed by CTA id).
 * The station itself, hubs, and (for a station outside the Loop) Loop stations are skipped even
 * when present in `eligible`.
 */
export function selectPeers(ctaStationId: string | null, eligible: ReadonlyMap<string, PeerCandidate>): PeerSet {
    const line = ctaStationId === null ? null : getPrimaryLine(linesForStation(ctaStationId));
    const branch = line === null ? undefined : branchOf(ctaStationId!, line);
    if (ctaStationId === null || line === null || branch === undefined) {
        return { basis: "none", line: null, branch: null, ctaStationIds: [], stationIds: [], avg12m: [], baseline: null };
    }

    const isHub = HUB_CTA_IDS.has(ctaStationId);
    const inLoop = LOOP_CTA_IDS.has(ctaStationId) && !isHub;
    const canPeer = (id: string) =>
        id !== ctaStationId && eligible.has(id) && !HUB_CTA_IDS.has(id) && (inLoop || !LOOP_CTA_IDS.has(id));

    if (isHub) return peerSet("branch-median", line, branch.branch, branch.stations.filter(canPeer), eligible);
    if (inLoop) return peerSet("loop", line, branch.branch, [...LOOP_CTA_IDS].filter(canPeer), eligible);

    const prev = walkToPeers(ctaStationId, line, "prev", canPeer, NEAREST_ON_EACH_PATH);
    const next = walkToPeers(ctaStationId, line, "next", canPeer, NEAREST_ON_EACH_PATH);
    let ids: string[];
    if (prev.length > 0 && next.length > 0) ids = [...prev, ...next];
    else if (prev.length > 0) ids = walkToPeers(ctaStationId, line, "prev", canPeer, TWO_NEAREST);
    else if (next.length > 0) ids = walkToPeers(ctaStationId, line, "next", canPeer, TWO_NEAREST);
    else ids = [];
    return peerSet("neighbors", line, branch.branch, ids, eligible);
}
