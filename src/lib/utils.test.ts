import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
// Imported through the `@/` alias on purpose: this test also proves the alias resolves under Vitest.
import {
    cn,
    contrastRatio,
    CTA_LINE_ORDER,
    ctaLineColors,
    getLineColor,
    getTier,
    lineLabelInk,
    tierName,
    tierStyle,
    toUiDataStatus,
} from "@/lib/utils";

describe("getTier", () => {
    it.each([
        [95, { tier: "ghost", ink: 0.44, mark: "hollow-dashed" }],
        [80, { tier: "fading", ink: 0.72, mark: "hollow" }],
        [60, { tier: "quiet", ink: 1, mark: "hollow" }],
        [30, { tier: "healthy", ink: 1, mark: "solid" }],
    ])("maps %i to its tier, ink, and mark", (score, style) => {
        expect(getTier(score)).toEqual(style);
    });

    it.each([
        [100, "ghost"],
        [90, "ghost"],
        [89, "fading"],
        [75, "fading"],
        [74, "quiet"],
        [50, "quiet"],
        [49, "healthy"],
        [0, "healthy"],
    ])("puts %i in %s at the tier edges", (score, tier) => {
        expect(getTier(score).tier).toBe(tier);
    });
});

describe("tierStyle", () => {
    it.each(["ghost", "fading", "quiet", "healthy"] as const)("draws %s exactly as getTier does inside the band", (tier) => {
        expect(tierStyle(tier).tier).toBe(tier);
    });

    it("gives ghost the faintest ink and the dashed hollow mark", () => {
        expect(tierStyle("ghost")).toEqual({ tier: "ghost", ink: 0.44, mark: "hollow-dashed" });
        expect(tierStyle("healthy")).toEqual({ tier: "healthy", ink: 1, mark: "solid" });
    });
});

describe("ctaLineColors", () => {
    // The design audit's non-negotiables list the official set; the table must match it exactly.
    const audit = readFileSync(new URL("../../docs/audit-2026-10-02/design.md", import.meta.url), "utf8");
    const officialList = audit.match(/Official CTA line colors only\*\* \(`src\/lib\/utils\.ts` values: ([^)]*)\)/)?.[1] ?? "";
    const official = Object.fromEntries([...officialList.matchAll(/(\w+) (#[0-9A-F]{6})/g)].map((m) => [m[1], m[2]]));

    it("reads all eight official colors from the design audit", () => {
        expect(Object.keys(official)).toEqual([...CTA_LINE_ORDER]);
    });

    it.each([...CTA_LINE_ORDER])("draws %s in its official color", (line) => {
        expect(ctaLineColors[line]).toBe(official[line]);
    });

    it("draws the Purple Express as Purple and an unknown line in neutral gray", () => {
        expect(getLineColor("Purple Express")).toBe(ctaLineColors.Purple);
        expect(getLineColor("Silver")).toBe("#6B6B6B");
    });
});

describe("lineLabelInk", () => {
    it.each(["Yellow", "Pink"])("sets dark text on %s", (line) => {
        expect(lineLabelInk(line)).toBe("#141518");
    });

    it.each([...CTA_LINE_ORDER])("keeps text on %s at WCAG AA for large text or better", (line) => {
        expect(contrastRatio(lineLabelInk(line), getLineColor(line))).toBeGreaterThanOrEqual(4.5);
    });
});

describe("contrastRatio", () => {
    it("spans 1 to 21 and is symmetric", () => {
        expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
        expect(contrastRatio("#777777", "#777777")).toBe(1);
        expect(contrastRatio("#C60C30", "#F4F3EE")).toBeCloseTo(contrastRatio("#F4F3EE", "#C60C30"), 10);
    });
});

describe("tierName", () => {
    it("lowercases a stored tier and refuses anything else", () => {
        expect(tierName("GHOST")).toBe("ghost");
        expect(tierName("HEALTHY")).toBe("healthy");
        expect(tierName(null)).toBeNull();
        expect(tierName("SPOOKY")).toBeNull();
    });
});

describe("toUiDataStatus", () => {
    it("maps the stored status to the UI's words, missing when there is none", () => {
        expect(toUiDataStatus("normal")).toBe("available");
        expect(toUiDataStatus("zero")).toBe("zero");
        expect(toUiDataStatus("missing")).toBe("missing");
        expect(toUiDataStatus(undefined)).toBe("missing");
    });
});

describe("cn", () => {
    it("keeps a type-scale size beside a color, and still resolves real conflicts", () => {
        expect(cn("text-13 text-ink-2")).toBe("text-13 text-ink-2");
        expect(cn("px-1 text-11 uppercase tracking-[0.08em]", "text-ink")).toBe("px-1 text-11 uppercase tracking-[0.08em] text-ink");
        expect(cn("font-mono tabular text-13", "text-ink-3")).toBe("font-mono tabular text-13 text-ink-3");
        expect(cn("text-13 text-15")).toBe("text-15");
        expect(cn("text-ink-2 text-ink")).toBe("text-ink");
    });
});
