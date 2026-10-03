import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { STATIONS_CACHE_TAG } from "@/lib/cacheTags";
import { prisma } from "@/lib/prisma";
import { runSync } from "@/lib/sync/run";
import { syncModeForSchedule } from "@/lib/sync/schedule";
import { createSocrataSource } from "@/lib/sync/socrata";

// Vercel Cron's daily and weekly schedules (vercel.json). Fluid compute allows 300 seconds on Hobby.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Drift months stop after this long, leaving a minute for metrics and finalizing the run. */
const DRIFT_BUDGET_MS = 240_000;

function authorized(request: NextRequest): boolean {
    const secret = process.env.CRON_SECRET;
    const header = request.headers.get("authorization");
    if (!secret || header === null) return false;
    // Equal-length digests, so the comparison takes the same time however the header differs.
    const digest = (value: string) => createHash("sha256").update(value).digest();
    return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export async function GET(request: NextRequest) {
    if (!authorized(request)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const mode = syncModeForSchedule(request.headers.get("x-vercel-cron-schedule"));
    try {
        const summary = await runSync(prisma, createSocrataSource({ appToken: process.env.CHICAGO_DATA_APP_TOKEN }), {
            trigger: `cron-${mode}`,
            mode,
            deadline: Date.now() + DRIFT_BUDGET_MS,
        });
        if (summary.status === "OK" || summary.status === "PARTIAL") revalidateTag(STATIONS_CACHE_TAG);

        // Status and counts only; the error text stays in the SyncRun row.
        const body = {
            runId: summary.runId,
            status: summary.status,
            mode,
            window: summary.window,
            dataThrough: summary.dataThrough,
            rowsFetched: summary.rowsFetched,
            rowsInserted: summary.rowsInserted,
            rowsRevised: summary.rowsRevised,
            unmatchedStationIds: summary.unmatchedStationIds.length,
            driftMonths: summary.driftMonths.length,
            durationMs: summary.durationMs,
        };
        console.info("sync-ridership", JSON.stringify(body));
        const failed = summary.status === "FAILED" || summary.status === "PARTIAL";
        return NextResponse.json(body, { status: failed ? 500 : 200 });
    } catch (error) {
        // The run could not record itself (the database is unreachable); health catches the gap.
        console.error("sync-ridership could not run:", error instanceof Error ? error.name : "unknown error");
        return NextResponse.json({ status: "ERROR", mode }, { status: 500 });
    }
}
