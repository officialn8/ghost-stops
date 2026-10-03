import { describe, expect, it } from "vitest";
import stopList from "@/test/fixtures/cta-stop-list.json";
import { CTA_LINE_ORDER } from "./normalizeStationLines";
import { CTA_ROSTER } from "./roster";
import {
    LINE_BRANCHES,
    adjacentStations,
    getPrimaryLine,
    isTerminalOnLine,
    linesForStation,
    neighborsOnLine,
    primaryLineNeighbors,
    sequenceRows,
} from "./sequences";

const official = stopList.stations as Record<string, { name: string; lines: string[] }>;

const HARLEM_FOREST_PARK = "40980";
const HARLEM_OHARE = "40750";
const GARFIELD_GREEN = "40510";

describe("roster", () => {
    it("has the 144 stations of CTA's official stop list, State/Lake included", () => {
        expect(CTA_ROSTER).toHaveLength(144);
        expect(new Set(CTA_ROSTER.map((s) => s.ctaStationId))).toEqual(new Set(Object.keys(official)));
        expect(CTA_ROSTER.find((s) => s.ctaStationId === "40260")?.name).toBe("State/Lake");
    });
});

describe("line membership derived from the sequences", () => {
    it("matches CTA's official stop list for every station", () => {
        for (const { ctaStationId } of CTA_ROSTER) {
            expect([ctaStationId, linesForStation(ctaStationId)]).toEqual([
                ctaStationId,
                CTA_LINE_ORDER.filter((line) => official[ctaStationId].lines.includes(line)),
            ]);
        }
    });

    it("drops Green from the four west and south Loop stations and adds Purple to Wilson", () => {
        for (const id of ["40040", "40160", "40730", "40850"]) {
            expect(linesForStation(id)).toEqual(["Brown", "Orange", "Purple", "Pink"]);
        }
        expect(linesForStation("40540")).toEqual(["Red", "Purple"]);
        expect(linesForStation("40260")).toEqual(["Brown", "Green", "Orange", "Purple", "Pink"]);
    });
});

describe("branch walks", () => {
    it("visits every station on each line exactly once across that line's branches", () => {
        for (const line of CTA_LINE_ORDER) {
            const walked = LINE_BRANCHES.filter((b) => b.line === line).flatMap((b) => b.stations);
            const members = CTA_ROSTER.map((s) => s.ctaStationId).filter((id) =>
                official[id].lines.includes(line),
            );
            expect([line, walked.length]).toEqual([line, new Set(walked).size]);
            expect([line, new Set(walked)]).toEqual([line, new Set(members)]);
        }
    });

    it("closes the Loop ring for each line that circles it", () => {
        for (const line of ["Brown", "Orange", "Pink", "Purple"] as const) {
            const ring = LINE_BRANCHES.find((b) => b.line === line && b.ring);
            expect(ring?.stations).toHaveLength(8);
            const [first] = ring!.stations;
            const last = ring!.stations[ring!.stations.length - 1];
            expect(neighborsOnLine(last, line)?.next).toEqual([first]);
            expect(neighborsOnLine(first, line)?.prev).toEqual([last]);
        }
        expect(LINE_BRANCHES.filter((b) => b.ring).map((b) => b.line).sort()).toEqual([
            "Brown",
            "Orange",
            "Pink",
            "Purple",
        ]);
    });

    it("puts Damen and Halsted on Green", () => {
        expect(linesForStation("41710")).toEqual(["Green"]);
        expect(linesForStation("40940")).toEqual(["Green"]);
        expect(neighborsOnLine("41710", "Green")).toEqual({ prev: ["41360"], next: ["40170"] });
    });
});

describe("neighborsOnLine", () => {
    it("tells the two Harlem stations on Blue apart", () => {
        expect(neighborsOnLine(HARLEM_FOREST_PARK, "Blue")).toEqual({ prev: ["40180"], next: ["40390"] });
        expect(neighborsOnLine(HARLEM_OHARE, "Blue")).toEqual({ prev: ["40230"], next: ["41280"] });
    });

    it("gives Division neighbors on both sides and does not call it a terminal", () => {
        expect(neighborsOnLine("40320", "Blue")).toEqual({ prev: ["40590"], next: ["41410"] });
        expect(isTerminalOnLine("40320", "Blue")).toBe(false);
    });

    it("ends the Ashland/63rd branch at Ashland/63rd and joins it to the trunk at Garfield", () => {
        expect(neighborsOnLine("40290", "Green")).toEqual({ prev: ["40940"], next: [] });
        expect(neighborsOnLine("40940", "Green")).toEqual({ prev: [GARFIELD_GREEN], next: ["40290"] });
        expect(neighborsOnLine(GARFIELD_GREEN, "Green")).toEqual({ prev: ["40130"], next: ["40940", "41140"] });
        expect(isTerminalOnLine("40290", "Green")).toBe(true);
        expect(isTerminalOnLine(GARFIELD_GREEN, "Green")).toBe(false);
    });

    it("joins a line's main branch to the Loop where its trains enter it", () => {
        expect(neighborsOnLine("40460", "Brown")).toEqual({ prev: ["40710"], next: ["40730", "40380"] });
        expect(neighborsOnLine("41400", "Orange")).toEqual({ prev: ["41130"], next: ["40850", "40680"] });
        expect(isTerminalOnLine("40460", "Brown")).toBe(false);
        expect(isTerminalOnLine("41290", "Brown")).toBe(true);
    });

    it("returns null for a station that is not on the line", () => {
        expect(neighborsOnLine("40980", "Green")).toBeNull();
        expect(isTerminalOnLine("40980", "Green")).toBe(false);
    });
});

describe("adjacentStations", () => {
    const adjacentTo = (ctaStationId: string) =>
        CTA_ROSTER.map((s) => s.ctaStationId)
            .filter((id) => adjacentStations(id).includes(ctaStationId))
            .sort();

    it("names the immediate neighbors on every line, the side before first, each once", () => {
        // Wilson: Lawrence and Sheridan on Red, Howard and Belmont on the Purple Express.
        expect(adjacentStations("40540")).toEqual(["40770", "40080", "40900", "41320"]);
        // State/Lake: Clark/Lake and Washington/Wabash on all five lines that serve it.
        expect(adjacentStations("40260")).toEqual(["40380", "41700"]);
        // Garfield (Green) across its junction, and a terminal with one side only.
        expect(adjacentStations(GARFIELD_GREEN)).toEqual(["40130", "40940", "41140"]);
        expect(adjacentStations("40390")).toEqual(["40980"]);
    });

    it("finds, from the sequences, the stations next to each closed or reopened station", () => {
        expect(adjacentTo("40260")).toEqual(["40380", "41700"]); // State/Lake: Clark/Lake, Washington/Wabash
        expect(adjacentTo("40770")).toEqual(["40540", "41200"]); // Lawrence: Wilson, Argyle
        expect(adjacentTo("40340")).toEqual(["41200", "41380"]); // Berwyn: Argyle, Bryn Mawr
    });

    it("returns nothing for a station on no line", () => {
        expect(adjacentStations("99999")).toEqual([]);
    });
});

describe("primaryLineNeighbors", () => {
    it("names Oak Park and Forest Park for Harlem at the Forest Park end", () => {
        expect(primaryLineNeighbors(HARLEM_FOREST_PARK, ["Blue"])).toEqual({ line: "Blue", prev: "40180", next: "40390" });
    });

    it("uses the primary line of a hub", () => {
        expect(primaryLineNeighbors("41320", ["Red", "Brown", "Purple"])).toEqual({
            line: "Red",
            prev: "41420",
            next: "41220",
        });
    });

    it("returns null when the station is not on its listed primary line", () => {
        expect(primaryLineNeighbors(HARLEM_FOREST_PARK, ["Green"])).toBeNull();
        expect(primaryLineNeighbors(HARLEM_FOREST_PARK, [])).toBeNull();
    });
});

describe("sequenceRows", () => {
    it("emits one row per station per branch with unique positions", () => {
        const rows = sequenceRows();
        expect(rows).toHaveLength(LINE_BRANCHES.reduce((n, b) => n + b.stations.length, 0));
        const keys = rows.map((r) => `${r.line}/${r.branch}/${r.seq}`);
        expect(new Set(keys).size).toBe(rows.length);
        expect(rows.find((r) => r.ctaStationId === HARLEM_FOREST_PARK)).toEqual({
            ctaStationId: HARLEM_FOREST_PARK,
            line: "Blue",
            branch: "main",
            seq: 31,
        });
    });
});

describe("getPrimaryLine", () => {
    it("picks the first line in canonical CTA order", () => {
        expect(getPrimaryLine(["Purple", "Brown", "Red"])).toBe("Red");
        expect(getPrimaryLine(["Pink", "Green"])).toBe("Green");
        expect(getPrimaryLine([])).toBeNull();
    });
});
