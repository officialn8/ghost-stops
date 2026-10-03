import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Count constructions across module re-evaluations; vi.resetModules() re-runs the mock factory.
const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock("@prisma/client", () => ({
    PrismaClient: vi.fn(function PrismaClient(this: object) {
        constructed.count += 1;
    }),
}));

const globalForPrisma = globalThis as unknown as { prisma?: unknown };

const apiDir = fileURLToPath(new URL("../app/api", import.meta.url));

/** Every App Router route handler under src/app/api, read once. */
const routeHandlers = readdirSync(apiDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /^route\.(ts|tsx|js)$/.test(entry.name))
    .map((entry) => {
        const file = join(entry.parentPath, entry.name);
        return { file, source: readFileSync(file, "utf8") };
    });

describe("prisma singleton", () => {
    afterEach(() => {
        delete globalForPrisma.prisma;
        constructed.count = 0;
        vi.resetModules();
    });

    it("returns the same client when the module is evaluated twice", async () => {
        const first = await import("./prisma");
        vi.resetModules(); // a second bundle chunk or a dev reload re-evaluates the module
        const second = await import("./prisma");

        expect(second.prisma).toBe(first.prisma);
        expect(constructed.count).toBe(1);
    });

    it("reuses a client already cached on globalThis", async () => {
        const cached = { cached: true };
        globalForPrisma.prisma = cached;

        const { prisma } = await import("./prisma");

        expect(prisma).toBe(cached);
        expect(constructed.count).toBe(0);
    });
});

describe("API route handlers", () => {
    it("finds route handlers to check", () => {
        expect(routeHandlers.length).toBeGreaterThan(0);
    });

    it("never disconnect the shared client", () => {
        const offenders = routeHandlers
            .filter(({ source }) => source.includes("$disconnect"))
            .map(({ file }) => file);
        expect(offenders).toEqual([]);
    });

    it("never construct their own PrismaClient", () => {
        const offenders = routeHandlers
            .filter(({ source }) => /new\s+PrismaClient\s*\(/.test(source))
            .map(({ file }) => file);
        expect(offenders).toEqual([]);
    });
});
