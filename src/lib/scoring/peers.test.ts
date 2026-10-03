import { describe, expect, it } from "vitest";
import { CTA_ROSTER } from "@/lib/cta/roster";
import { HUB_CTA_IDS, LOOP_CTA_IDS, selectPeers, type PeerCandidate } from "./peers";

const CLARK_LAKE = "40380";
const STATE_LAKE = "40260";

/** Every roster station eligible as a peer, with a 12-month average of 1,000, except those named. */
function eligibleExcept(...excluded: string[]): Map<string, PeerCandidate> {
    return new Map(
        CTA_ROSTER.filter((s) => !excluded.includes(s.ctaStationId)).map((s) => [
            s.ctaStationId,
            { stationId: `id-${s.ctaStationId}`, avg12m: 1_000 },
        ]),
    );
}

describe("the peer groups", () => {
    it("treats exactly Belmont, Fullerton, Howard, Roosevelt, and Clark/Lake as hubs", () => {
        expect([...HUB_CTA_IDS].sort()).toEqual(["40380", "40900", "41220", "41320", "41400"]);
    });

    it("counts the eight Loop elevated stations, Clark/Lake included, as the Loop", () => {
        expect([...LOOP_CTA_IDS].sort()).toEqual(["40040", "40160", "40260", "40380", "40680", "40730", "40850", "41700"]);
    });
});

describe("selectPeers", () => {
    it("compares a station with the nearest open station either side on its branch", () => {
        const peers = selectPeers("40940", eligibleExcept()); // Halsted (Green)
        expect(peers).toMatchObject({ basis: "neighbors", line: "Green", branch: "ashland-63rd" });
        expect(peers.ctaStationIds).toEqual(["40510", "40290"]); // Garfield, Ashland/63rd
        expect(peers.stationIds).toEqual(["id-40510", "id-40290"]);
        expect(peers.baseline).toBe(1_000);
    });

    it("walks past a station that cannot be a peer to the next one out", () => {
        // Wilson's neighbor Lawrence is closed: Argyle stands in on that side.
        const peers = selectPeers("40540", eligibleExcept("40770"));
        expect(peers).toMatchObject({ basis: "neighbors", line: "Red", ctaStationIds: ["41200", "40080"] });
    });

    it("stops at a hub: Harrison takes Jackson and Monroe, not Roosevelt or Cermak-Chinatown past it", () => {
        expect(selectPeers("41490", eligibleExcept()).ctaStationIds).toEqual(["40560", "41090"]);
    });

    it("stops at Howard: South Boulevard takes Main and Dempster, not Wilson down the Purple Express track", () => {
        expect(selectPeers("40840", eligibleExcept()).ctaStationIds).toEqual(["40270", "40690"]);
    });

    it("takes the nearest station on each path at a fork", () => {
        // Garfield (Green): 51st on one side, Halsted and King Drive past the junction.
        expect(selectPeers("40510", eligibleExcept()).ctaStationIds).toEqual(["40130", "40940", "41140"]);
    });

    it("gives a terminal the two nearest stations on its only side", () => {
        const peers = selectPeers("40890", eligibleExcept()); // O'Hare
        expect(peers).toMatchObject({ basis: "neighbors", line: "Blue", branch: "main", ctaStationIds: ["40820", "40230"] });
    });

    it("treats a side with no eligible station like a terminal end", () => {
        // Halsted (Orange): past Roosevelt (a hub) lies only the Loop.
        expect(selectPeers("41130", eligibleExcept()).ctaStationIds).toEqual(["41060", "40120"]);
    });

    it("compares a Loop station with the other open Loop stations, leaving out Clark/Lake and closed State/Lake", () => {
        const peers = selectPeers("40160", eligibleExcept(STATE_LAKE)); // LaSalle/Van Buren
        expect(peers.basis).toBe("loop");
        expect(peers.branch).toBe("loop");
        expect([...peers.ctaStationIds].sort()).toEqual(["40040", "40680", "40730", "40850", "41700"]);
    });

    it("compares Clark/Lake with its primary line's branch median and says so", () => {
        const eligible = eligibleExcept();
        eligible.set("41340", { stationId: "id-41340", avg12m: 9_000 }); // LaSalle (Blue)
        const peers = selectPeers(CLARK_LAKE, eligible);
        expect(peers).toMatchObject({ basis: "branch-median", line: "Blue", branch: "main" });
        // Every other Blue station: 32 of them, none a hub.
        expect(peers.ctaStationIds).toHaveLength(32);
        expect(peers.ctaStationIds).not.toContain(CLARK_LAKE);
        expect(peers.baseline).toBe(1_000);
    });

    it("uses the Red Line branch median for Belmont, leaving the other hubs out", () => {
        const peers = selectPeers("41320", eligibleExcept());
        expect(peers).toMatchObject({ basis: "branch-median", line: "Red", branch: "main" });
        expect(peers.ctaStationIds).toHaveLength(29); // 33 Red stations less 4 hubs
        for (const hub of HUB_CTA_IDS) expect(peers.ctaStationIds).not.toContain(hub);
    });

    it("never picks a Loop station or a hub as a peer for a station outside the Loop", () => {
        // Clinton (Green/Pink): east of it lies Clark/Lake, a hub, so it takes the two stations west.
        expect(selectPeers("41160", eligibleExcept()).ctaStationIds).toEqual(["41510", "40170"]);
        for (const { ctaStationId } of CTA_ROSTER) {
            if (LOOP_CTA_IDS.has(ctaStationId) || HUB_CTA_IDS.has(ctaStationId)) continue;
            for (const id of selectPeers(ctaStationId, eligibleExcept()).ctaStationIds) {
                expect(LOOP_CTA_IDS.has(id) || HUB_CTA_IDS.has(id)).toBe(false);
            }
        }
    });

    it("takes the median of the peers' 12-month averages", () => {
        const eligible = eligibleExcept();
        eligible.set("40510", { stationId: "id-40510", avg12m: 600 });
        eligible.set("40290", { stationId: "id-40290", avg12m: 500 });
        const peers = selectPeers("40940", eligible);
        expect(peers.baseline).toBe(550);
        expect(peers.avg12m).toEqual([600, 500]);
    });

    it("finds no peers when none is eligible, or for a station outside the sequences", () => {
        expect(selectPeers("40940", new Map())).toEqual({
            basis: "none",
            line: "Green",
            branch: "ashland-63rd",
            ctaStationIds: [],
            stationIds: [],
            avg12m: [],
            baseline: null,
        });
        expect(selectPeers("99999", eligibleExcept())).toMatchObject({ basis: "none", line: null, branch: null, baseline: null });
        expect(selectPeers(null, eligibleExcept())).toMatchObject({ basis: "none", baseline: null });
    });

    it("never lists the station as its own peer", () => {
        for (const { ctaStationId } of CTA_ROSTER) {
            expect(selectPeers(ctaStationId, eligibleExcept()).ctaStationIds).not.toContain(ctaStationId);
        }
    });
});
