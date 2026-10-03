import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assessHealth, readHealthInputs } from "@/lib/sync/health";

// Requested daily by .github/workflows/health.yml, which fails (and GitHub emails Nate) on non-200.
export const dynamic = "force-dynamic";

export async function GET() {
    const now = new Date();
    try {
        const { httpStatus, report } = assessHealth(await readHealthInputs(prisma, now), now);
        return NextResponse.json(report, { status: httpStatus, headers: { "Cache-Control": "no-store" } });
    } catch {
        return NextResponse.json({ status: "error" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
}
