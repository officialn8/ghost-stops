import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Animation is the `motion` package only (R33, KTD16). The v1 springs, gestures, and the chart
 * library the dossier no longer uses stay out of the code and out of package.json.
 */
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const RETIRED = ["@react-spring/web", "@use-gesture/react", "framer-motion", "recharts", "date-fns"];

const sources = readdirSync(join(repoRoot, "src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && !entry.parentPath.includes("generated"))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.endsWith("retired-deps.test.ts"));

const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

describe.each(RETIRED)("%s", (name) => {
    it("is imported nowhere under src", () => {
        const importers = sources
            .filter((file) => readFileSync(file, "utf8").includes(`"${name}`))
            .map((file) => relative(repoRoot, file));
        expect(importers).toEqual([]);
    });

    it("is not a dependency", () => {
        expect(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })).not.toContain(name);
    });
});
