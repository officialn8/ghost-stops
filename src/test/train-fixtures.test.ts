import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The recorded Train Tracker fixtures hold bodies only (live Ghost score plan U1, KTD14): the key
 * travels in the query string, so no fixture may carry a request URL or a `key=` parameter, and a
 * scrubbed body reads `key=[key]` at most. gitleaks scans the same files in CI; this test fails
 * earlier, on the developer's machine.
 */
const fixturesDir = fileURLToPath(new URL("./fixtures/trains/", import.meta.url));

const fixtures = readdirSync(fixturesDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, text: readFileSync(join(fixturesDir, name), "utf8") }));

describe("Train Tracker fixtures", () => {
    it("exist, so the scan cannot pass on an empty directory", () => {
        expect(fixtures.map((f) => f.name)).toContain("positions-2026-10-09.json");
        expect(fixtures.map((f) => f.name)).toContain("arrivals-2026-10-09.json");
    });

    it.each(fixtures.map((f) => f.name))("%s carries no key and no request", (name) => {
        const { text } = fixtures.find((f) => f.name === name)!;
        // A key value after key= would be hex; the scrubbed form is "[key]".
        expect(text).not.toMatch(/key=[0-9a-fA-F]{8,}/);
        expect(text).not.toMatch(/[0-9a-f]{32}/);
        const body = JSON.parse(text) as Record<string, unknown>;
        expect(Object.keys(body)).toEqual(["ctatt"]);
        expect(text).not.toMatch(/"url"\s*:/);
        expect(text).not.toContain("lapi.transitchicago.com");
    });
});
