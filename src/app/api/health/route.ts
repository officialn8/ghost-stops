import { NextResponse } from "next/server";
import { assessTrains, readTrainHealthInputs, trainsFail } from "@/lib/live/health";
import { r2StoreFromEnv } from "@/lib/live/objectStore";
import { prisma } from "@/lib/prisma";
import { assessHealth, readHealthInputs } from "@/lib/sync/health";

/**
 * Requested daily by .github/workflows/health.yml, which fails (and GitHub emails Nate) on non-200.
 * Two reports in one body: the ridership sync's (src/lib/sync/health.ts, unchanged) and the train
 * collection's as a `trains` object (src/lib/live/health.ts), composed here so neither module
 * imports the other. The answer is 503 when either fails; `trains` fails only once the first
 * LiveDay row exists (KTD13).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** One quick HEAD: a request must not inherit the worker's retries when the bucket is down. */
const SITE_R2 = { retryDelaysMs: [], timeoutMs: 5_000 } as const;

export async function GET() {
    const now = new Date();
    try {
        const [ridership, trains] = await Promise.all([
            readHealthInputs(prisma, now),
            readTrainHealthInputs(prisma, r2StoreFromEnv(process.env, SITE_R2), now),
        ]);
        const { httpStatus, report } = assessHealth(ridership, now);
        const trainReport = assessTrains(trains, now);
        const status = httpStatus === 503 || trainsFail(trainReport) ? 503 : 200;
        return NextResponse.json({ ...report, trains: trainReport }, { status, headers: NO_STORE });
    } catch {
        return NextResponse.json({ status: "error" }, { status: 503, headers: NO_STORE });
    }
}
