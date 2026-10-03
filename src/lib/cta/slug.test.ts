import { describe, expect, it } from "vitest";
import { CTA_ROSTER } from "./roster";
import { linesForStation } from "./sequences";
import { baseSlug, displayNameFor, generateSlugs, resolveSlugAlias, slugify } from "./slug";

const rosterWithLines = CTA_ROSTER.map((s) => ({ ...s, lines: linesForStation(s.ctaStationId) }));
const slugs = generateSlugs(rosterWithLines);

describe("slugify", () => {
    it("lowercases, drops apostrophes, and turns slashes and spaces into hyphens", () => {
        expect(slugify("95th/Dan Ryan")).toBe("95th-dan-ryan");
        expect(slugify("O'Hare")).toBe("ohare");
        expect(slugify("Harold Washington Library-State/Van Buren")).toBe("harold-washington-library-state-van-buren");
        expect(slugify("  Cermak-McCormick  Place ")).toBe("cermak-mccormick-place");
    });
});

describe("generateSlugs over the roster", () => {
    it("gives the five Western stations their qualified slugs (AE3)", () => {
        expect(["40670", "40220", "41480", "40310", "40740"].map((id) => slugs.get(id))).toEqual([
            "western-blue-ohare",
            "western-blue-forest-park",
            "western-brown",
            "western-orange",
            "western-pink",
        ]);
    });

    it("leaves unique names unqualified", () => {
        expect(slugs.get("40450")).toBe("95th-dan-ryan");
        expect(slugs.get("40890")).toBe("ohare");
        expect(slugs.get("40850")).toBe("harold-washington-library-state-van-buren");
        expect(slugs.get("40260")).toBe("state-lake");
        expect(slugs.get("41660")).toBe("lake");
        expect(slugs.get("41280")).toBe("jefferson-park");
    });

    it("qualifies a colliding name by its primary line", () => {
        expect(slugs.get("40940")).toBe("halsted-green");
        expect(slugs.get("41320")).toBe("belmont-red");
        expect(slugs.get("40060")).toBe("belmont-blue");
        expect(slugs.get("40750")).toBe("harlem-blue-ohare");
        expect(slugs.get("40980")).toBe("harlem-blue-forest-park");
    });

    it("is unique across all 144 stations and qualifies exactly the 59 stations in 23 collision groups", () => {
        expect(slugs.size).toBe(144);
        expect(new Set(slugs.values()).size).toBe(144);
        const qualified = rosterWithLines.filter((s) => slugs.get(s.ctaStationId) !== baseSlug(s));
        expect(qualified).toHaveLength(59);
    });

    it("gives the local snapshot's spellings the same slugs as production's", () => {
        const local = rosterWithLines.map((s) => {
            const spelling: Record<string, string> = {
                "40220": "Western (Blue - Forest Park Branch)",
                "40670": "Western (Blue - O'Hare Branch)",
                "40980": "Harlem (Blue - Forest Park Branch)",
                "40750": "Harlem (Blue - O'Hare Branch)",
            };
            return { ...s, name: spelling[s.ctaStationId] ?? s.name };
        });
        expect(generateSlugs(local)).toEqual(slugs);
    });

    it("throws when a collision cannot be resolved", () => {
        const twins = [
            { ctaStationId: "1", name: "Twin", lines: ["Red" as const] },
            { ctaStationId: "2", name: "Twin (Red)", lines: ["Red" as const] },
        ];
        expect(() => generateSlugs(twins)).toThrow(/Twin/);
    });
});

describe("displayNameFor", () => {
    it("strips line parentheticals and applies the two CTA renames", () => {
        expect(displayNameFor({ ctaStationId: "40660", name: "Armitage (Brown/Purple)" })).toBe("Armitage");
        expect(displayNameFor({ ctaStationId: "41660", name: "Lake (Subway)" })).toBe("Lake");
        expect(displayNameFor({ ctaStationId: "41280", name: "Jefferson Park Transit Center" })).toBe("Jefferson Park");
        expect(displayNameFor({ ctaStationId: "40670", name: "Western (O'Hare)" })).toBe("Western (O'Hare)");
    });
});

describe("resolveSlugAlias", () => {
    it("resolves an alias to its canonical slug", () => {
        expect(resolveSlugAlias("old-name", { "old-name": "new-name" })).toBe("new-name");
    });

    it("resolves nothing with the shipped empty map", () => {
        expect(resolveSlugAlias("western-blue-ohare")).toBeUndefined();
    });
});
