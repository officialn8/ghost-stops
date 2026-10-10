import { describe, expect, it } from "vitest";
import { DEFAULT_OUT_DIR, DEFAULT_STATION_IDS, fixtureText, parseSampleArgs } from "../../scripts/sample-train-tracker";

describe("parseSampleArgs", () => {
    it("records the default batch into the fixtures directory", () => {
        expect(parseSampleArgs([])).toEqual({ stationIds: [...DEFAULT_STATION_IDS], outDir: DEFAULT_OUT_DIR });
    });

    it("takes up to four station ids and an output directory", () => {
        expect(parseSampleArgs(["--station-id", "40900", "--station-id", "40380", "--out", "/tmp/x"])).toEqual({
            stationIds: ["40900", "40380"],
            outDir: "/tmp/x",
        });
        expect(() => parseSampleArgs(["--station-id", "30075"])).toThrow(/five-digit/);
        expect(() => parseSampleArgs(["--station-id", "40900", "--station-id", "40380", "--station-id", "40830", "--station-id", "41680", "--station-id", "40010"])).toThrow(/at most 4/);
        expect(() => parseSampleArgs(["--since", "2026-01-01"])).toThrow();
    });
});

describe("fixtureText", () => {
    it("re-serializes the body with the key scrubbed and no request field", () => {
        const key = "0123456789abcdef0123456789abcdef";
        const text = fixtureText(`{"ctatt":{"tmst":"2026-10-09T22:27:16","errCd":"0","errNm":"see ${key}","eta":[]}}`, key);
        expect(text).not.toContain(key);
        expect(JSON.parse(text)).toEqual({ ctatt: { tmst: "2026-10-09T22:27:16", errCd: "0", errNm: "see [key]", eta: [] } });
        expect(text.endsWith("\n")).toBe(true);
    });
});
