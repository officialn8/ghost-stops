import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import { prismaMock, resetPrismaMock } from "@/test/prisma-mock";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag }));
vi.mock("@/lib/prisma", async () => ({
    prisma: (await import("@/test/prisma-mock")).prismaMock,
}));

const route = await import("./route");
const { POST } = route;

const NOW = new Date("2026-10-15T08:21:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

function request(headers: Record<string, string> = {}, body?: string) {
    return new NextRequest("http://localhost/api/internal/revalidate", { method: "POST", headers, body });
}

beforeEach(() => {
    resetPrismaMock();
    revalidateTag.mockReset();
    vi.stubEnv("WORKER_REVALIDATE_SECRET", "ghrv_test-worker-secret");
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe("POST /api/internal/revalidate", () => {
    it("expires the stations tag once when the latest reduction is two minutes old", async () => {
        prismaMock.liveDay.findFirst.mockResolvedValue({ reducedAt: minutesAgo(2) } as never);

        const response = await POST(request({ authorization: "Bearer ghrv_test-worker-secret" }));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ revalidated: [STATIONS_CACHE_TAG] });
        expect(revalidateTag).toHaveBeenCalledTimes(1);
        expect(revalidateTag).toHaveBeenCalledWith(STATIONS_CACHE_TAG, { expire: 0 });
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(prismaMock.liveDay.findFirst).toHaveBeenCalledWith({ orderBy: { reducedAt: "desc" }, select: { reducedAt: true } });
    });

    it("answers skipped without expiring when the latest reduction is twenty minutes old, or there is none", async () => {
        prismaMock.liveDay.findFirst.mockResolvedValue({ reducedAt: minutesAgo(20) } as never);
        let response = await POST(request({ authorization: "Bearer ghrv_test-worker-secret" }));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ skipped: true });

        prismaMock.liveDay.findFirst.mockResolvedValue(null);
        response = await POST(request({ authorization: "Bearer ghrv_test-worker-secret" }));
        expect(await response.json()).toEqual({ skipped: true });
        expect(revalidateTag).not.toHaveBeenCalled();
    });

    it("ignores a body", async () => {
        prismaMock.liveDay.findFirst.mockResolvedValue({ reducedAt: minutesAgo(1) } as never);

        const response = await POST(request({ authorization: "Bearer ghrv_test-worker-secret", "content-type": "application/json" }, '{"tags":["everything"]}'));
        expect(await response.json()).toEqual({ revalidated: [STATIONS_CACHE_TAG] });
        expect(revalidateTag).toHaveBeenCalledWith(STATIONS_CACHE_TAG, { expire: 0 });
    });

    it("answers 401 to a wrong secret, the cron secret, no header, or an unset secret, without reading the database", async () => {
        expect((await POST(request({ authorization: "Bearer wrong" }))).status).toBe(401);
        expect((await POST(request({ authorization: "Bearer test-cron-secret" }))).status).toBe(401);
        expect((await POST(request())).status).toBe(401);

        vi.stubEnv("WORKER_REVALIDATE_SECRET", "");
        expect((await POST(request({ authorization: "Bearer " }))).status).toBe(401);

        expect(prismaMock.liveDay.findFirst).not.toHaveBeenCalled();
        expect(revalidateTag).not.toHaveBeenCalled();
    });

    it("is POST only, so Next answers GET with 405", () => {
        expect((route as Record<string, unknown>).GET).toBeUndefined();
        expect(route.dynamic).toBe("force-dynamic");
    });
});
