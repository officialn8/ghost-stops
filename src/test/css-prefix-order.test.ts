import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const srcDir = join(repoRoot, "src");

const cssFiles = readdirSync(srcDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css"))
    .map((entry) => join(entry.parentPath, entry.name));

/**
 * Rules that declare a standard property and then its vendor-prefixed twin. Lightning CSS
 * (Turbopack's CSS pipeline since Next 16) keeps only the later of the two, so the standard
 * property vanishes and Chrome and Firefox, which ignore the prefix, lose the style.
 */
function standardBeforePrefix(css: string): string[] {
    const found: string[] = [];
    postcss.parse(css).walkRules((rule) => {
        const props: string[] = [];
        rule.each((node) => {
            if (node.type === "decl") props.push(node.prop);
        });
        props.forEach((prop, index) => {
            const standard = prop.match(/^-(?:webkit|moz|ms)-(.+)$/)?.[1];
            if (standard && props.indexOf(standard) !== -1 && props.indexOf(standard) < index) {
                found.push(`${rule.selector.replace(/\s+/g, " ")}: ${standard} then ${prop}`);
            }
        });
    });
    return found;
}

describe("CSS vendor-prefix order", () => {
    it("scans the stylesheets, so an empty result means something", () => {
        expect(cssFiles.map((file) => relative(repoRoot, file))).toContain("src/app/globals.css");
    });

    it.each(cssFiles.map((file) => [relative(repoRoot, file), file]))(
        "%s never puts a prefixed duplicate after its standard property",
        (_name, file) => {
            expect(standardBeforePrefix(readFileSync(file, "utf8"))).toEqual([]);
        },
    );

    it("detects the pattern Lightning CSS mishandles, and allows prefix-first", () => {
        expect(standardBeforePrefix(".a { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }")).toEqual([
            ".a: backdrop-filter then -webkit-backdrop-filter",
        ]);
        expect(standardBeforePrefix(".a { -webkit-user-select: none; user-select: none; }")).toEqual([]);
    });
});
