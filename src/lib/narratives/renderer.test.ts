import { describe, expect, it } from "vitest";
import type { ArchetypeKey, NarrativeContext, NarrativeFacts } from "@/types/narrative";
import { ARCHETYPE_DEFINITIONS } from "./archetypes";
import { renderNarrative, renderTemplate } from "./renderer";

const fact = (value: number) => ({ value, quality: "HIGH" as const });

function context(overrides: Partial<NarrativeContext> = {}): NarrativeContext {
  return {
    stationName: "Test Station",
    facts: {},
    avg12m: 1000,
    yoyChangePct: null,
    vs2019Pct: null,
    tier: "QUIET",
    badge: null,
    closure: null,
    ...overrides,
  };
}

const story = (template: string, overrides: Partial<NarrativeContext> = {}) => renderTemplate(template, context(overrides)).story;

/** Every fact the templates read, all moving one way. */
function facts(sign: 1 | -1): NarrativeFacts {
  return {
    ridership_2001_avg: fact(sign > 0 ? 800 : 2000),
    population_change: fact(sign * 0.12),
    jobs_walkshed_change: fact(sign * 0.3),
    vehicle_ownership_pct: fact(0.55),
    il_lane_miles_change: fact(sign * 4200),
    airport_arrivals: fact(0),
  };
}

/** Rising and falling versions of every input, across tiers, badges, and closures. */
const CONTEXTS: NarrativeContext[] = ([1, -1] as const).flatMap((sign) =>
  [
    { tier: "HEALTHY" as const, badge: null },
    { tier: "GHOST" as const, badge: null },
    { tier: "FADING" as const, badge: sign > 0 ? ("small-but-growing" as const) : ("small-but-steady" as const) },
  ].map(({ tier, badge }) =>
    context({
      facts: facts(sign),
      yoyChangePct: sign * 7,
      vs2019Pct: sign * 18,
      tier,
      badge,
      closure: { startDate: "2026-01-05", endDate: sign > 0 ? "2026-12-01" : null, reason: "Closed for repairs" },
    }),
  ),
);

const EM_DASH = /\u2014/;
const EMOJI = /\p{Extended_Pictographic}/u;

describe("archetype templates", () => {
  const keys = Object.keys(ARCHETYPE_DEFINITIONS) as ArchetypeKey[];

  it.each(keys)("%s renders with no em dash, emoji, or leftover tag, for rising and falling numbers", (key) => {
    const archetype = ARCHETYPE_DEFINITIONS[key];
    expect(archetype.template).not.toMatch(EM_DASH);
    for (const ctx of CONTEXTS) {
      const rendered = renderNarrative(archetype, ctx);
      expect(rendered.missing).toEqual([]);
      expect(rendered.story.length).toBeGreaterThan(0);
      expect(rendered.story).not.toMatch(EM_DASH);
      expect(rendered.story).not.toMatch(EMOJI);
      expect(rendered.story).not.toMatch(/\{\{|\}\}/);
    }
  });

  it.each(keys)("%s never reads a rise as a fall or a fall as a rise", (key) => {
    const archetype = ARCHETYPE_DEFINITIONS[key];
    for (const ctx of CONTEXTS) {
      const text = renderNarrative(archetype, ctx).story;
      const rising = (ctx.yoyChangePct ?? 0) > 0;
      if (rising) {
        expect(text).not.toMatch(/fallen to|fell even faster|losing riders|When jobs leave|lost its economic anchor|residents have left|below its pre-pandemic|removed/);
      } else {
        expect(text).not.toMatch(/grown to|is growing|gaining riders|above its pre-pandemic|added \*\*/);
      }
    }
  });
});

describe("renderTemplate", () => {
  it("picks the long-run verb from the sign of the change, holding near for under half a percent", () => {
    const template = "{{baseline_verb}} **{{today_avg|number}}**, a **{{baseline_change|change}}** change";
    const withBaseline = (avg12m: number) => story(template, { avg12m, facts: { ridership_2001_avg: fact(3796) } });

    expect(withBaseline(3947)).toBe("has grown to **3,947**, a **+4%** change");
    expect(withBaseline(1139)).toBe("has fallen to **1,139**, a **-70%** change");
    expect(withBaseline(3810)).toBe("has held near **3,810**, a **+0.4%** change");
  });

  it("reads the recent direction with the score card's level band: a change that rounds to 0.0% is neither up nor down", () => {
    const template = "{{#if recent_up}}up {{/if}}{{#if recent_down}}down {{/if}}{{#if has_yoy}}{{yoy_change|change}}{{/if}}";
    expect(story(template, { yoyChangePct: 0.04 })).toBe("0%");
    expect(story(template, { yoyChangePct: -0.04 })).toBe("0%");
    expect(story(template, { yoyChangePct: 0.05 })).toBe("up +0.1%");
    expect(story(template, { yoyChangePct: -0.05 })).toBe("down -0.1%");
    // With no year-over-year change, the 2019 change decides, banded the same way.
    expect(story("{{#if recent_up}}up{{/if}}{{#if recent_down}}down{{/if}}", { vs2019Pct: -0.04 })).toBe("");
    expect(story("{{#if recent_up}}up{{/if}}{{#if recent_down}}down{{/if}}", { vs2019Pct: -0.06 })).toBe("down");
  });

  it("renders every change with an explicit sign", () => {
    const template = "{{yoy_change|change}} {{vs2019_change|change}} {{population_change|change}} {{jobs_walkshed_change|change}}";
    expect(
      story(template, {
        yoyChangePct: 4.2,
        vs2019Pct: -38.4,
        facts: { population_change: fact(0.031), jobs_walkshed_change: fact(-0.2) },
      }),
    ).toBe("+4% -38% +3% -20%");
  });

  it("nests conditionals, keeping text after an inner block that renders nothing", () => {
    const template = "{{#if population_change}}A **{{population_change|change}}** change{{#if population_declining}}, falling{{/if}}.{{/if}}";

    expect(story(template, { facts: { population_change: fact(0.02) } })).toBe("A **+2%** change.");
    expect(story(template, { facts: { population_change: fact(-0.2) } })).toBe("A **-20%** change, falling.");
    expect(story(template)).toBe("");
  });

  it("treats a fact stored as zero as present", () => {
    expect(story("{{#if airport_arrivals}}cited{{else}}absent{{/if}}", { facts: { airport_arrivals: fact(0) } })).toBe("cited");
  });

  it("reports the facts the text drew on, and any value it could not fill", () => {
    const rendered = renderTemplate(
      "{{#if vehicle_ownership_pct}}Cars: {{vehicle_ownership_pct|percent}}.{{/if}} Jobs: {{jobs_walkshed_change|change}}. {{typo_value}}",
      context({ facts: { vehicle_ownership_pct: fact(0.42) } }),
    );

    expect(rendered.story).toBe("Cars: 42%. Jobs: .");
    expect(rendered.evidenceFactKeys).toEqual(["vehicle_ownership_pct"]);
    expect(rendered.missing).toEqual(["jobs_walkshed_change", "typo_value"]);
  });

  it("counts an archetype's required facts as evidence, and as missing when absent", () => {
    const archetype = { template: "{{stationName}}.", requiredFacts: ["airport_arrivals" as const] };

    expect(renderNarrative(archetype, context({ facts: { airport_arrivals: fact(0) } }))).toMatchObject({
      evidenceFactKeys: ["airport_arrivals"],
      missing: [],
    });
    expect(renderNarrative(archetype, context()).missing).toEqual(["airport_arrivals"]);
  });

  it("replaces an em dash that arrives in stored text", () => {
    const closure = { startDate: "2026-01-05", endDate: null, reason: "Closed for work \u2014 phase two" };
    expect(story("{{closure_purpose}}", { closure })).toBe("for work, phase two");
  });
});
