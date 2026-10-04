import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";
import { blend, contrastRatio, type Rgb } from "@/lib/utils";

/**
 * Every text token meets WCAG AA (4.5:1) at 13px on both surfaces, in both themes (R13 success
 * criterion: no text style at 13px or above fails AA). The values come from the stylesheet
 * itself, so a token edit that breaks contrast fails here.
 */
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

type Theme = "dark" | "light";

function themeTokens(theme: Theme): Record<string, string> {
    const selector = theme === "dark" ? '[data-theme="dark"]' : '[data-theme="light"]';
    const tokens: Record<string, string> = {};
    postcss.parse(css).walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;
        rule.walkDecls(/^--/, (decl) => {
            tokens[decl.prop] = decl.value.replace(/\/\*.*\*\//, "").trim();
        });
    });
    return tokens;
}

const channels = (value: string): Rgb => value.split(/\s+/).map(Number) as unknown as Rgb;

describe.each(["dark", "light"] as const)("%s theme", (theme) => {
    const tokens = themeTokens(theme);
    const ink = channels(tokens["--ink"]);
    const surfaces = { surface: channels(tokens["--surface"]), "surface-2": channels(tokens["--surface-2"]) };
    const inks = {
        ink: 1,
        "ink-2": Number(tokens["--ink-2-alpha"]),
        "ink-3": Number(tokens["--ink-3-alpha"]),
    };

    it("defines every token the contrast check needs", () => {
        for (const value of [...Object.values(surfaces).flat(), ...ink, ...Object.values(inks)]) {
            expect(Number.isFinite(value)).toBe(true);
        }
    });

    describe.each(Object.entries(surfaces))("on %s", (_surfaceName, surface) => {
        it.each(Object.entries(inks))("%s meets AA for 13px text", (_inkName, alpha) => {
            expect(contrastRatio(blend(ink, surface, alpha), surface)).toBeGreaterThanOrEqual(4.5);
        });
    });

    it("keeps the three ink steps in order, so ink-3 reads quieter than ink-2", () => {
        expect(inks["ink-2"]).toBeLessThan(inks.ink);
        expect(inks["ink-3"]).toBeLessThan(inks["ink-2"]);
    });
});
