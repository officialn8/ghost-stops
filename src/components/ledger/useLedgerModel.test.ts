import { describe, expect, it } from "vitest";
import { ALL_LINES_ON } from "@/components/shell/model";
import type { ActiveLines, SortState } from "@/components/shell/ShellContext";
import { CTA_LINE_ORDER, type CTALine } from "@/lib/utils";
import type { StationListItem } from "@/types/station";
import { LEDGER_STATIONS, station } from "./__fixtures__/stations";
import { deriveLedger, exclusionOf, matchesQuery, normalizeSearch, type LedgerInput } from "./useLedgerModel";

const BY_RANK: SortState = { key: "rank", direction: "asc" };

function only(...lines: CTALine[]): ActiveLines {
  return Object.fromEntries(CTA_LINE_ORDER.map((line) => [line, lines.includes(line)])) as ActiveLines;
}

const ALL_OFF = only();

function derive(overrides: Partial<LedgerInput> = {}) {
  return deriveLedger({
    stations: LEDGER_STATIONS,
    query: "",
    activeLines: ALL_LINES_ON,
    sort: BY_RANK,
    selectedSlug: null,
    ...overrides,
  });
}

const slugs = (rows: { station: StationListItem }[]) => rows.map((row) => row.station.slug);

describe("deriveLedger: sort", () => {
  it("lists ranked stations rank 1 first by default, and the excluded ones in trailing sections", () => {
    const ledger = derive();
    expect(slugs(ledger.ranked)).toEqual(["oak-park-green", "halsted-green", "monroe-red", "halsted-orange", "ohare", "clark-lake"]);
    expect(ledger.sections.map((section) => [section.kind, section.title, slugs(section.rows)])).toEqual([
      ["closed", "Closed", ["state-lake"]],
      ["no-data", "No recent data", ["cicero-pink"]],
    ]);
  });

  it("reverses rank on descending", () => {
    expect(slugs(derive({ sort: { key: "rank", direction: "desc" } }).ranked)).toEqual([
      "clark-lake",
      "ohare",
      "halsted-orange",
      "monroe-red",
      "halsted-green",
      "oak-park-green",
    ]);
  });

  it("sorts riders fewest first ascending and most first descending, by the 12-month average", () => {
    const fewest = ["halsted-green", "oak-park-green", "halsted-orange", "monroe-red", "ohare", "clark-lake"];
    expect(slugs(derive({ sort: { key: "riders", direction: "asc" } }).ranked)).toEqual(fewest);
    expect(slugs(derive({ sort: { key: "riders", direction: "desc" } }).ranked)).toEqual([...fewest].reverse());
  });

  it("sorts names A to Z and Z to A, breaking a tie by rank either way", () => {
    const az = slugs(derive({ sort: { key: "name", direction: "asc" } }).ranked);
    expect(az[0]).toBe("clark-lake");
    expect(az.slice(1, 3)).toEqual(["halsted-green", "halsted-orange"]);
    expect(az[3]).toBe("monroe-red");

    const za = slugs(derive({ sort: { key: "name", direction: "desc" } }).ranked);
    expect(za.at(-1)).toBe("clark-lake");
    expect(za.slice(-3, -1)).toEqual(["halsted-green", "halsted-orange"]);
  });

  it("puts a ranked station with no riders figure last under either riders direction", () => {
    const stations = [...LEDGER_STATIONS, station({ slug: "blank", displayName: "Blank", rank: 7, avg12m: null })];
    expect(slugs(derive({ stations, sort: { key: "riders", direction: "asc" } }).ranked).at(-1)).toBe("blank");
    expect(slugs(derive({ stations, sort: { key: "riders", direction: "desc" } }).ranked).at(-1)).toBe("blank");
  });

  // AE2 (ledger part): State/Lake stays in the trailing Closed section whatever the sort.
  it.each([
    ["rank", "asc"],
    ["rank", "desc"],
    ["riders", "asc"],
    ["riders", "desc"],
    ["name", "asc"],
    ["name", "desc"],
  ] as const)("keeps State/Lake in the trailing Closed section sorted by %s %s", (key, direction) => {
    const ledger = derive({ sort: { key, direction } });
    expect(slugs(ledger.ranked)).not.toContain("state-lake");
    expect(slugs(ledger.ranked)).not.toContain("cicero-pink");
    expect(ledger.sections[0]).toMatchObject({ kind: "closed", title: "Closed" });
    expect(slugs(ledger.sections[0].rows)).toEqual(["state-lake"]);
  });

  it("orders each trailing section by name", () => {
    const stations = [
      ...LEDGER_STATIONS,
      station({ slug: "a-closed", displayName: "Adams", status: "TEMP_CLOSED", rank: null }),
      station({ slug: "z-closed", displayName: "Zeta", status: "CLOSED", rank: null }),
    ];
    for (const direction of ["asc", "desc"] as const) {
      expect(slugs(derive({ stations, sort: { key: "name", direction } }).sections[0].rows)).toEqual([
        "a-closed",
        "state-lake",
        "z-closed",
      ]);
    }
  });

  it("drops a station without a slug, which has no page to open", () => {
    const stations = [...LEDGER_STATIONS, station({ slug: null, displayName: "Nowhere", rank: 7 })];
    const ledger = derive({ stations });
    expect(ledger.total).toBe(8);
    expect(ledger.ranked.map((row) => row.station.displayName)).not.toContain("Nowhere");
  });
});

describe("deriveLedger: line filter", () => {
  it("shows only stations on a line that is on", () => {
    const ledger = derive({ activeLines: only("Red") });
    expect(slugs(ledger.ranked)).toEqual(["monroe-red"]);
    expect(ledger.sections).toEqual([]);
    expect(ledger.matchCount).toBe(1);
    expect(ledger.announcement).toBe("1 station matches");
  });

  it("treats every line off as every line on", () => {
    const allOff = derive({ activeLines: ALL_OFF });
    const allOn = derive();
    expect(slugs(allOff.ranked)).toEqual(slugs(allOn.ranked));
    expect(allOff.sections.map((section) => slugs(section.rows))).toEqual(allOn.sections.map((section) => slugs(section.rows)));
    expect(allOff.narrowed).toBe(false);
    expect(allOff.announcement).toBe("8 stations");
  });

  it("keeps a closed station whose lines are on in its section", () => {
    expect(slugs(derive({ activeLines: only("Brown") }).sections[0].rows)).toEqual(["state-lake"]);
  });
});

describe("deriveLedger: search", () => {
  it("matches display names case-insensitively and names the first match for Enter", () => {
    const ledger = derive({ query: "HALSTED" });
    expect(slugs(ledger.ranked)).toEqual(["halsted-green", "halsted-orange"]);
    expect(ledger.firstMatchSlug).toBe("halsted-green");
    expect(ledger.announcement).toBe("2 stations match");
  });

  it("follows the sort when picking the first match", () => {
    expect(derive({ query: "halsted", sort: { key: "rank", direction: "desc" } }).firstMatchSlug).toBe("halsted-orange");
  });

  it("finds an excluded station, which Enter can open too", () => {
    const ledger = derive({ query: "state" });
    expect(ledger.ranked).toEqual([]);
    expect(ledger.firstMatchSlug).toBe("state-lake");
  });

  it("returns nothing for a query that matches no station", () => {
    const ledger = derive({ query: "xyz" });
    expect(ledger.ranked).toEqual([]);
    expect(ledger.sections).toEqual([]);
    expect(ledger.matchCount).toBe(0);
    expect(ledger.firstMatchSlug).toBeNull();
    expect(ledger.announcement).toBe("No stations match");
  });

  it("ignores a query of only spaces", () => {
    const ledger = derive({ query: "   " });
    expect(ledger.narrowed).toBe(false);
    expect(ledger.matchCount).toBe(8);
  });

  it("combines the search with the line filter", () => {
    expect(slugs(derive({ query: "halsted", activeLines: only("Orange") }).ranked)).toEqual(["halsted-orange"]);
  });
});

describe("deriveLedger: the selected station", () => {
  it("stays in the list, in its sorted place, when the line filter would hide it", () => {
    const ledger = derive({ activeLines: only("Red"), selectedSlug: "halsted-green" });
    expect(ledger.ranked.map((row) => [row.station.slug, row.outsideFilter])).toEqual([
      ["halsted-green", true],
      ["monroe-red", false],
    ]);
    // The count announces matches; the pinned row is not one.
    expect(ledger.matchCount).toBe(1);
  });

  it("stays in its trailing section when the search would hide it", () => {
    const ledger = derive({ query: "xyz", selectedSlug: "state-lake" });
    expect(ledger.sections.map((section) => [section.kind, section.rows.map((row) => row.outsideFilter)])).toEqual([
      ["closed", [true]],
    ]);
    expect(ledger.matchCount).toBe(0);
    expect(ledger.firstMatchSlug).toBeNull();
  });

  it("is not marked when it matches", () => {
    expect(derive({ selectedSlug: "ohare" }).ranked.find((row) => row.station.slug === "ohare")?.outsideFilter).toBe(false);
  });

  it("ignores an unknown slug", () => {
    expect(derive({ selectedSlug: "no-such-station", query: "xyz" }).ranked).toEqual([]);
  });
});

describe("deriveLedger: announcement", () => {
  it("states the full count when nothing narrows the list", () => {
    expect(derive().announcement).toBe("8 stations");
    expect(derive().narrowed).toBe(false);
  });

  it("states the match count under a filter", () => {
    expect(derive({ activeLines: only("Green", "Blue") }).announcement).toBe("5 stations match");
  });
});

describe("exclusionOf", () => {
  it("names why a station is outside the ranking", () => {
    expect(exclusionOf(station({ slug: "a", displayName: "A", rank: 3 }))).toBeNull();
    expect(exclusionOf(station({ slug: "a", displayName: "A", rank: null, status: "CLOSED" }))).toBe("closed");
    expect(exclusionOf(station({ slug: "a", displayName: "A", rank: null, status: "TEMP_CLOSED" }))).toBe("closed");
    expect(exclusionOf(station({ slug: "a", displayName: "A", rank: null, status: "ACTIVE" }))).toBe("no-data");
  });
});

describe("search normalization", () => {
  it("drops case, accents, spaces, and punctuation", () => {
    expect(normalizeSearch("  O'Hare ")).toBe("ohare");
    expect(normalizeSearch("State/Lake")).toBe("statelake");
    expect(normalizeSearch("Cermak-McCormick Place")).toBe("cermakmccormickplace");
  });

  it.each([
    ["ohare", "O'Hare"],
    ["o'hare", "O'Hare"],
    ["state lake", "State/Lake"],
    ["clark/", "Clark/Lake"],
    ["35th arch", "35th/Archer"],
    ["mccormick", "Cermak-McCormick Place"],
  ])("finds %s in %s", (query, name) => {
    expect(matchesQuery(name, normalizeSearch(query))).toBe(true);
  });

  it("matches everything for an empty needle", () => {
    expect(matchesQuery("Halsted", "")).toBe(true);
  });
});

describe("deriveLedger: tier groups", () => {
  const tiers = (groups: ReturnType<typeof derive>["tierGroups"]) => groups?.map((group) => [group.tier, slugs(group.rows)]);

  it("groups the ranked rows by tier under the rank sort, ghost first", () => {
    expect(tiers(derive().tierGroups)).toEqual([
      ["ghost", ["oak-park-green", "halsted-green"]],
      ["fading", ["monroe-red"]],
      ["quiet", ["halsted-orange"]],
      ["healthy", ["ohare", "clark-lake"]],
    ]);
  });

  it("reverses the groups with the direction", () => {
    expect(derive({ sort: { key: "rank", direction: "desc" } }).tierGroups?.map((group) => group.tier)).toEqual([
      "healthy",
      "quiet",
      "fading",
      "ghost",
    ]);
  });

  it("has no groups under the riders or name sort, where tiers interleave", () => {
    expect(derive({ sort: { key: "riders", direction: "asc" } }).tierGroups).toBeNull();
    expect(derive({ sort: { key: "name", direction: "desc" } }).tierGroups).toBeNull();
  });

  it("keeps only the tiers a search leaves, with a pinned selection in its tier", () => {
    expect(tiers(derive({ query: "xyz", selectedSlug: "monroe-red" }).tierGroups)).toEqual([["fading", ["monroe-red"]]]);
    expect(derive({ query: "xyz" }).tierGroups).toEqual([]);
  });
});
