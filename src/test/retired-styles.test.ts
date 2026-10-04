import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The v1 skin is gone and stays gone (U18, R29): no glass or noise surfaces, and no animation that
 * runs forever, in any stylesheet or in the Tailwind theme.
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const srcDir = join(repoRoot, "src");

const files = [
    ...readdirSync(srcDir, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
        .map((entry) => join(entry.parentPath, entry.name)),
    join(repoRoot, "tailwind.config.ts"),
];

const RETIRED = [
    { name: "a glass surface", pattern: /glass/i },
    { name: "a noise texture", pattern: /noise/i },
    { name: "an infinite animation", pattern: /\binfinite\b/i },
];

describe("retired v1 styles", () => {
    it("scans the stylesheets and the Tailwind theme", () => {
        expect(files.map((file) => relative(repoRoot, file))).toEqual(
            expect.arrayContaining(["src/app/globals.css", "tailwind.config.ts"]),
        );
    });

    describe.each(files.map((file) => [relative(repoRoot, file), file]))("%s", (_name, file) => {
        const text = readFileSync(file, "utf8");
        it.each(RETIRED)("has no $name", ({ pattern }) => {
            expect(text).not.toMatch(pattern);
        });
    });
});
