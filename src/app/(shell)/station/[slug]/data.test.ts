import { describe, expect, it, vi } from "vitest";

// Runs the cached function directly; this file checks which addresses are allowed into the cache.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
// No database: the guard decides from the roster and the alias map alone.
vi.mock("@/lib/stations/detail", () => ({ readStationDetail: vi.fn() }));
// One retired slug, so the alias branch has something to accept.
vi.mock("@/lib/cta/slugAliases", () => ({ SLUG_ALIASES: { "old-slug": "halsted-green" } }));

const { cacheable } = await import("./data");

describe("cacheable", () => {
    it("caches a station's current slug", () => {
        expect(cacheable("halsted-green")).toBe(true);
    });

    it("caches a retired slug, which answers with a redirect", () => {
        expect(cacheable("old-slug")).toBe(true);
    });

    it("reads an address that names no station uncached, a station id included", () => {
        expect(cacheable("nowhere")).toBe(false);
        expect(cacheable("0b7a6f3e-5d0c-4c43-9a55-1f3d2a9c8e01")).toBe(false);
    });
});
