import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// Neither file has to exist: ESLint only uses the path to decide which config blocks apply.
const componentFile = join(repoRoot, "src/components/__boundary_probe__.tsx");
const routeFile = join(repoRoot, "src/app/api/example/route.ts");

// The rule matches the import text and never resolves it, so the relative form is flagged
// wherever the probe file sits.
const forbidden = [
    "@/lib/prisma",
    "../../lib/prisma",
    "@/lib/sync/run",
    "@/lib/scoring/ghost",
    "@/lib/narratives/generate",
    "@/generated/prisma/client",
];
const allowed = ["@/lib/utils", "@/lib/narratives"];

// One instance for the whole file: the first lint loads eslint.config.mjs and the Next config.
const eslint = new ESLint({ cwd: repoRoot });

/** Lints a module that imports `specifier` and returns only its `no-restricted-imports` messages. */
async function restrictedImports(specifier: string, filePath: string) {
    const code = `import { probe } from "${specifier}";\n\nexport const value = probe;\n`;
    const [result] = await eslint.lintText(code, { filePath });

    // An ignored file or a parse error reports a null ruleId. Failing on those keeps the
    // "not flagged" cases from passing when the probe was never actually linted.
    expect(result.messages.filter((message) => message.ruleId === null)).toEqual([]);

    return result.messages.filter((message) => message.ruleId === "no-restricted-imports");
}

describe("component import boundary", { timeout: 60_000 }, () => {
    it.each(forbidden)("fails lint when a component imports %s", async (specifier) => {
        const messages = await restrictedImports(specifier, componentFile);

        // Severity 2 is an error, which is what fails `next lint`; a warning would let the import through.
        expect(messages.map(({ severity }) => severity)).toContain(2);
    });

    it.each(allowed)("allows a component to import %s", async (specifier) => {
        expect(await restrictedImports(specifier, componentFile)).toEqual([]);
    });

    it.each(forbidden)("does not restrict %s outside src/components", async (specifier) => {
        expect(await restrictedImports(specifier, routeFile)).toEqual([]);
    });
});
