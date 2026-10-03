import type { PrismaClient } from "@/generated/prisma/client";
import type { RidershipRow } from "./match";

/** Rows per statement: a 60-day window is about 8,800 rows, so two statements. */
const UPSERT_CHUNK_SIZE = 5_000;

export interface UpsertCounts {
    inserted: number;
    revised: number;
}

/**
 * Inserts new station-days and overwrites stored ones whose entries or day type differ, one
 * parameterized statement per chunk (KTD4). `createMany({ skipDuplicates })` compiles to
 * `DO NOTHING` and could never absorb CTA's revisions. The `IS DISTINCT FROM` guard skips
 * unchanged rows, so `revised` counts real changes, and `xmax = 0` tells an insert from an update.
 *
 * Each chunk commits on its own; re-running a chunk is harmless.
 */
export async function upsertRidership(
    db: Pick<PrismaClient, "$queryRaw">,
    rows: readonly RidershipRow[],
    chunkSize = UPSERT_CHUNK_SIZE,
): Promise<UpsertCounts> {
    const keys = new Set(rows.map((r) => `${r.stationId}|${r.serviceDate}`));
    if (keys.size !== rows.length) {
        // Postgres would refuse too ("cannot affect row a second time"), less clearly.
        throw new Error("Upsert batch names a station-day twice; dedupe upstream rows first");
    }

    const totals: UpsertCounts = { inserted: 0, revised: 0 };
    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const [counts] = await db.$queryRaw<{ inserted: bigint; revised: bigint }[]>`
            WITH changed AS (
                INSERT INTO "RidershipDaily" ("stationId", "serviceDate", "entries", "dayType")
                SELECT * FROM unnest(
                    ${chunk.map((r) => r.stationId)}::text[],
                    ${chunk.map((r) => r.serviceDate)}::date[],
                    ${chunk.map((r) => r.entries)}::int[],
                    ${chunk.map((r) => r.dayType)}::char(1)[]
                )
                ON CONFLICT ("stationId", "serviceDate") DO UPDATE
                    SET "entries" = EXCLUDED."entries", "dayType" = EXCLUDED."dayType"
                    WHERE ("RidershipDaily"."entries", "RidershipDaily"."dayType")
                        IS DISTINCT FROM (EXCLUDED."entries", EXCLUDED."dayType")
                RETURNING (xmax = 0) AS inserted
            )
            SELECT count(*) FILTER (WHERE inserted) AS inserted, count(*) FILTER (WHERE NOT inserted) AS revised
            FROM changed`;
        totals.inserted += Number(counts.inserted);
        totals.revised += Number(counts.revised);
    }
    return totals;
}
