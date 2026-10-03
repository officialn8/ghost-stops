import { describe, expect, it } from "vitest";
import type { DataQuality } from "@/types/narrative";
import { generateNarratives, TEMPLATE_VERSION, type NarrativeRow, type NarrativeStationInput } from "./generate";

const DATA_THROUGH = "2026-07-31";

const fact = (value: number, quality: DataQuality = "HIGH") => ({ value, quality });

function station(overrides: Partial<NarrativeStationInput> = {}): NarrativeStationInput {
  return {
    stationId: "test-station",
    ctaStationId: "40000",
    name: "Test Station",
    status: "ACTIVE",
    openedAt: null,
    ranked: true,
    tier: "HEALTHY",
    badge: null,
    avg12m: 2000,
    yoyChangePct: 1.5,
    vs2019Pct: -10,
    closure: null,
    facts: {},
    ...overrides,
  };
}

/** The one row a single accepted station produces. */
function narrativeFor(input: NarrativeStationInput): NarrativeRow {
  const { rows, rejected } = generateNarratives([input], DATA_THROUGH);
  expect(rejected).toEqual([]);
  expect(rows).toHaveLength(1);
  return rows[0];
}

const evidence = (row: NarrativeRow) => JSON.parse(row.evidenceFactKeys) as string[];

// Production's facts for Logan Square; its 12-month average is 3,947 against 3,796 in 2001.
const LOGAN_SQUARE = station({
  stationId: "logan-square",
  ctaStationId: "41020",
  name: "Logan Square",
  avg12m: 3947,
  yoyChangePct: 2.4,
  vs2019Pct: -8.1,
  facts: {
    ridership_2001_avg: fact(3796),
    population_change: fact(-0.0727),
    vehicle_ownership_pct: fact(0.222, "MEDIUM"),
    jobs_walkshed_change: fact(0.597),
  },
});

// A station that lost 70% of its 2001 riders in a neighborhood that lost residents.
const SEVENTY_PERCENT_DECLINE = station({
  stationId: "halsted-green",
  ctaStationId: "40940",
  name: "Halsted (Green)",
  tier: "GHOST",
  avg12m: 300,
  yoyChangePct: -4.2,
  vs2019Pct: -35,
  facts: {
    ridership_2001_avg: fact(1000),
    population_change: fact(-0.15),
    vehicle_ownership_pct: fact(0.45, "MEDIUM"),
  },
});

describe("generateNarratives", () => {
  it("tells Logan Square's growth from 3,796 to 3,947 as growth, quoting the card's numbers", () => {
    const row = narrativeFor(LOGAN_SQUARE);

    expect(row.archetypeKey).toBe("growth");
    expect(row.renderedStory).toContain("has grown to **3,947**");
    expect(row.renderedStory).toContain("**+4%**");
    expect(row.renderedStory).toContain("**+2%**"); // year over year, 2.4
    expect(row.renderedStory).toContain("**-8%**"); // against 2019
    expect(row.renderedStory).not.toMatch(/fallen|decline|ghost/i);
    expect(evidence(row)).toEqual(["ridership_2001_avg"]);
    expect(row).toMatchObject({ templateVersion: TEMPLATE_VERSION, confidence: 1, quality: "HIGH", qualityNote: null });
    expect(row.evidenceMeta).toMatchObject({
      metrics: { avg12m: 3947, yoyChangePct: 2.4, vs2019Pct: -8.1, dataThrough: DATA_THROUGH },
    });
  });

  it("reads Logan Square as growth through the fact-based archetypes too, when its tier is not healthy", () => {
    const row = narrativeFor({ ...LOGAN_SQUARE, tier: "QUIET" });

    expect(row.archetypeKey).toBe("resilient_anomaly");
    expect(row.renderedStory).toContain("has grown to **3,947**");
    expect(row.renderedStory).toContain("**+4%**");
    expect(row.renderedStory).not.toMatch(/fallen|dipped/i);
  });

  it("tells a 70% decline as decline", () => {
    const row = narrativeFor(SEVENTY_PERCENT_DECLINE);

    expect(row.archetypeKey).toBe("suburban_shift");
    expect(row.renderedStory).toContain("has fallen to **300**, a **-70%** change");
    expect(row.renderedStory).toContain("**-15%** change in population since 2010, suggesting residents have left the area.");
    expect(row.renderedStory).toContain("**-4%**"); // year over year, -4.2
    expect(row.renderedStory).not.toMatch(/grown|gaining/i);
    expect(evidence(row)).toEqual(["ridership_2001_avg", "population_change", "vehicle_ownership_pct"]);
    expect(row.quality).toBe("MEDIUM");
    expect(row.confidence).toBe(0.9);
  });

  it("gives a healthy station with no 2001 fact a stable or growth story from its components", () => {
    const steady = narrativeFor(station({ yoyChangePct: -1.2, vs2019Pct: -20 }));
    expect(steady.archetypeKey).toBe("stable");
    expect(steady.renderedStory).toBe(
      "Test Station is holding its own. Over the last 12 months it averaged **2,000** riders a day.\n\n" +
        "The last 90 days show a **-1%** change from the same days a year earlier. " +
        "Its 12-month average is a **-20%** change from 2019, still below its pre-pandemic level.",
    );
    expect(evidence(steady)).toEqual([]);
    expect(steady.quality).toBe("UNKNOWN");
    expect(steady.qualityNote).toMatch(/CTA ridership alone/);

    // Year over year unknown (a closure in the window): the sign comes from the 2019 comparison.
    const growing = narrativeFor(station({ yoyChangePct: null, vs2019Pct: 6 }));
    expect(growing.archetypeKey).toBe("growth");
    expect(growing.renderedStory).toContain("is gaining riders");
    expect(growing.renderedStory).toContain("**+6%** change from 2019, above its pre-pandemic level");
  });

  it("agrees with the small-station badge on a change outside the level band", () => {
    const growing = narrativeFor(station({ tier: "FADING", badge: "small-but-growing", yoyChangePct: 0.3 }));
    expect(growing.archetypeKey).toBe("growth");
    expect(growing.renderedStory).toContain("carries fewer riders than comparable stations, but its ridership is growing");
    expect(growing.renderedStory).toContain("**+0.3%**");

    const steady = narrativeFor(station({ tier: "FADING", badge: "small-but-steady", yoyChangePct: -2 }));
    expect(steady.archetypeKey).toBe("stable");
    expect(steady.renderedStory).toContain("its ridership is holding up better than most");
  });

  it("reads a change that rounds to 0.0% as level, as the score card does: stable, neither gaining nor losing", () => {
    const cases: Partial<NarrativeStationInput>[] = [
      { yoyChangePct: -0.04, vs2019Pct: -20 },
      { yoyChangePct: 0.04, vs2019Pct: -20 },
      { yoyChangePct: null, vs2019Pct: 0.04 }, // year over year unknown: the 2019 change decides
    ];
    for (const change of cases) {
      for (const tier of ["HEALTHY", "GHOST"] as const) {
        const label = `${tier} ${JSON.stringify(change)}`;
        const row = narrativeFor(station({ tier, ...change }));
        expect(row.archetypeKey, label).toBe("stable");
        expect(row.renderedStory, label).not.toMatch(/gaining|losing|is growing|recent gains/i);
        if (change.yoyChangePct !== null) {
          expect(row.renderedStory, label).toContain("a **0%** change from the same days a year earlier");
        }
      }
    }
    expect(narrativeFor(station({ tier: "HEALTHY", yoyChangePct: 0.04 })).renderedStory).toContain("Test Station is holding its own.");
    expect(narrativeFor(station({ tier: "GHOST", yoyChangePct: -0.04 })).renderedStory).toContain("Test Station ranks as a ghost station.");
  });

  it("tells a ghost station with falling riders and no long-run facts that it is losing riders", () => {
    const row = narrativeFor(station({ tier: "GHOST", yoyChangePct: -6, vs2019Pct: -40 }));

    expect(row.archetypeKey).toBe("recent_decline");
    expect(row.renderedStory).toContain("Test Station ranks as a ghost station, and it has been losing riders.");
    expect(row.renderedStory).toContain("**-6%**");
  });

  it("does not compare a station that opened after 2001 with a 2001 average", () => {
    // Cermak-McCormick Place opened in 2015; its stored 2001 average belongs to no station of its own.
    const row = narrativeFor(
      station({ name: "Cermak-McCormick Place", openedAt: "2015-02-08", yoyChangePct: 3, facts: { ridership_2001_avg: fact(2655) } }),
    );

    expect(row.renderedStory).not.toContain("2001");
    expect(evidence(row)).toEqual([]);
  });

  it("tells O'Hare's airport story, with the route's former override text and no em dash", () => {
    const row = narrativeFor(
      station({
        ctaStationId: "40890",
        name: "O'Hare",
        tier: "QUIET",
        facts: { airport_arrivals: fact(0, "LOW"), jobs_walkshed_change: fact(-0.02, "MEDIUM"), ridership_2001_avg: fact(7902) },
      }),
    );

    expect(row).toMatchObject({
      archetypeKey: "airport_gateway",
      renderedStory:
        "O'Hare is an airport-driven station. Local residential population doesn't explain its ridership: " +
        "airport arrivals and traveler demand do. Census walkshed metrics are intentionally excluded here to avoid misleading comparisons.",
      confidence: 0.85,
      quality: "LOW",
      qualityNote: "Airport arrivals are the primary driver; Census facts excluded.",
    });
    expect(evidence(row)).toEqual(["airport_arrivals"]);
  });

  it("does not tell the airport story for the O'Hare branch stations that carry the placeholder airport fact", () => {
    const row = narrativeFor(
      station({
        ctaStationId: "40750",
        name: "Harlem (O'Hare)",
        tier: "FADING",
        avg12m: 1100,
        facts: { airport_arrivals: fact(0, "LOW"), ridership_2001_avg: fact(2181), jobs_walkshed_change: fact(-0.56) },
      }),
    );

    expect(row.archetypeKey).not.toBe("airport_gateway");
    expect(row.renderedStory).not.toMatch(/airport/i);
    expect(evidence(row)).not.toContain("airport_arrivals");
  });

  it("tells a closed station when and why it closed, with no score framing", () => {
    const row = narrativeFor(
      station({
        name: "State/Lake",
        status: "CLOSED",
        ranked: false,
        tier: null,
        avg12m: 150,
        yoyChangePct: null,
        vs2019Pct: null,
        closure: { startDate: "2026-01-05", endDate: null, reason: "Closed for demolition and reconstruction of the station" },
      }),
    );

    expect(row.archetypeKey).toBe("closed");
    expect(row.renderedStory).toBe("State/Lake has been closed since **January 2026** for demolition and reconstruction of the station.");
    expect(row.quality).toBe("UNKNOWN");
  });

  it("gives a temporary closure its reopening date and a reason worded any way", () => {
    const row = narrativeFor(
      station({
        name: "Berwyn",
        status: "TEMP_CLOSED",
        ranked: false,
        tier: null,
        closure: { startDate: "2021-05-16", endDate: "2025-07-20", reason: "Track work" },
      }),
    );

    expect(row.renderedStory).toBe(
      "Berwyn has been closed since **May 2021**. Reason given: Track work.\n\nService is scheduled to resume on **July 20, 2025**.",
    );
  });

  it("tells an open station with no recent riders only that", () => {
    const row = narrativeFor(station({ ranked: false, tier: null, yoyChangePct: null, vs2019Pct: null }));

    expect(row.archetypeKey).toBe("no_recent_data");
    expect(row.renderedStory).toBe(
      "The CTA's ridership data shows no recent riders at Test Station, so it is not compared with other stations for now.",
    );
  });

  it("rejects a narrative that cites a fact the station lacks, and writes the others", () => {
    const lacking = station({ stationId: "lacking" });
    const having = station({ stationId: "having", facts: { population_change: fact(0.031) } });

    // Both are healthy and growing; a growth template that cites population unguarded.
    const { rows, rejected } = generateNarratives([lacking, having], DATA_THROUGH, {
      templates: { growth: "{{stationName}} saw a **{{population_change|change}}** change in population." },
    });

    expect(rejected).toEqual([{ stationId: "lacking", archetypeKey: "growth", missing: ["population_change"] }]);
    expect(rows.map((r) => [r.stationId, r.renderedStory, evidence(r)])).toEqual([
      ["having", "Test Station saw a **+3%** change in population.", ["population_change"]],
    ]);
  });

  it("produces identical rows from identical inputs", () => {
    const inputs = [LOGAN_SQUARE, SEVENTY_PERCENT_DECLINE, station()];
    expect(generateNarratives(inputs, DATA_THROUGH)).toEqual(generateNarratives(inputs, DATA_THROUGH));
  });
});
