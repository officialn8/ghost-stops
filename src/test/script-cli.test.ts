import { afterEach, describe, expect, it, vi } from "vitest";
import { requireDatabaseUrl } from "../../scripts/cli";

describe("requireDatabaseUrl", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it.each([
        ["unset", undefined],
        ["empty", ""],
    ])("refuses to run a script when DATABASE_URL is %s, because pg would fall back to localhost", (_label, value) => {
        vi.stubEnv("DATABASE_URL", value);

        expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL must be set/);
    });

    it("lets a script run once DATABASE_URL is exported", () => {
        vi.stubEnv("DATABASE_URL", "postgresql://app@pooled.example/db");

        expect(() => requireDatabaseUrl()).not.toThrow();
    });
});
