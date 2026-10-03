import { prisma } from "@/lib/prisma";

/** A scratch city for the sync's database tests, with stations keyed by CTA station id. */
export async function createSyncTestCity(code: string, ctaStationIds: readonly string[]): Promise<string> {
    await deleteSyncTestCity(code);
    const city = await prisma.city.create({ data: { code, name: `Sync test ${code}` } });
    await prisma.station.createMany({
        data: ctaStationIds.map((ctaStationId) => ({
            id: stationIdFor(code, ctaStationId),
            cityId: city.id,
            externalId: ctaStationId,
            ctaStationId,
            name: `Station ${ctaStationId}`,
            latitude: 41.88,
            longitude: -87.63,
            lines: '["Red"]',
        })),
    });
    return city.id;
}

export function stationIdFor(cityCode: string, ctaStationId: string): string {
    return `${cityCode}-${ctaStationId}`;
}

export async function deleteSyncTestCity(code: string): Promise<void> {
    const city = await prisma.city.findUnique({ where: { code } });
    if (!city) return;
    const station = { cityId: city.id };
    await prisma.ridershipDaily.deleteMany({ where: { station } });
    await prisma.stationMetrics.deleteMany({ where: { station } });
    await prisma.stationNarrative.deleteMany({ where: { station } });
    await prisma.stationFact.deleteMany({ where: { station } });
    await prisma.stationClosure.deleteMany({ where: { station } });
    await prisma.station.deleteMany({ where: station });
    await prisma.city.delete({ where: { id: city.id } });
}

/** SyncRun rows belong to no city, and the lease is global, so each test starts from none. */
export async function clearSyncRuns(): Promise<void> {
    await prisma.syncRun.deleteMany({});
}
