/**
 * Station.status and closedAt, recomputed on every run from the StationClosure rows (KTD9), so a
 * closure that starts or ends changes the status without anyone re-running the seed.
 */
import type { Prisma, PrismaClient, StationStatus } from "@prisma/client";
import { deriveStatus } from "@/lib/cta/closures";
import { toDay } from "./window";

export interface StationStatusRow {
    stationId: string;
    status: StationStatus;
    closedAt: string | null;
}

export async function deriveStationStatuses(
    db: Pick<PrismaClient, "station">,
    cityId: string,
    asOf: string,
): Promise<StationStatusRow[]> {
    const stations = await db.station.findMany({
        where: { cityId },
        select: { id: true, closures: { select: { startDate: true, endDate: true } } },
    });
    return stations.map((station) => {
        const closures = station.closures.map((c) => ({
            startDate: toDay(c.startDate),
            endDate: c.endDate === null ? null : toDay(c.endDate),
        }));
        return { stationId: station.id, ...deriveStatus(closures, asOf) };
    });
}

/** Writes the statuses that changed, in one statement; returns how many stations changed. */
export async function writeStationStatuses(
    tx: Pick<Prisma.TransactionClient, "$executeRaw">,
    rows: readonly StationStatusRow[],
): Promise<number> {
    return tx.$executeRaw`
        UPDATE "Station" s
        SET "status" = u."status"::"StationStatus", "closedAt" = u."closedAt"::date
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS u("stationId" text, "status" text, "closedAt" text)
        WHERE s."id" = u."stationId"
          AND (s."status", s."closedAt") IS DISTINCT FROM (u."status"::"StationStatus", u."closedAt"::date)`;
}
