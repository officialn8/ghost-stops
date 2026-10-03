import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl } from "./db-guard";

describe("assertLocalDatabaseUrl", () => {
    it.each([
        "postgresql://postgres:postgres@localhost:5432/ghost_stops_test",
        "postgresql://postgres:postgres@127.0.0.1:55432/ghost_stops_test",
        "postgres://postgres@[::1]:5432/ghost_stops_test",
    ])("accepts the local database %s", (url) => {
        expect(() => assertLocalDatabaseUrl(url)).not.toThrow();
    });

    it("rejects a remote Neon host", () => {
        expect(() =>
            assertLocalDatabaseUrl("postgresql://role:secret@ep-example-123456-pooler.us-east-2.aws.neon.tech/neondb"),
        ).toThrow(/Refusing to run database tests against ep-example-123456-pooler\.us-east-2\.aws\.neon\.tech/);
    });

    it("rejects an unset URL, because Prisma would fall back to .env", () => {
        expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/must be set explicitly/);
        expect(() => assertLocalDatabaseUrl("")).toThrow(/must be set explicitly/);
    });

    it("rejects a value that is not a URL without echoing it", () => {
        expect(() => assertLocalDatabaseUrl("not a url with-a-secret")).toThrow(/^DATABASE_URL is not a valid URL\.$/);
    });
});
