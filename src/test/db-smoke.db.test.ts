import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

// Runs in the `db` Vitest project against the Postgres at DATABASE_URL,
// after `prisma migrate deploy` has applied every migration.
const INIT_MIGRATION = "20260202155550_init_production";

const prisma = new PrismaClient();

afterAll(async () => {
    await prisma.$disconnect();
});

describe("database tier", () => {
    it("connects and sees the init migration fully applied", async () => {
        const rows = await prisma.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`
            SELECT migration_name, finished_at
            FROM _prisma_migrations
            WHERE migration_name = ${INIT_MIGRATION}
        `;

        expect(rows).toHaveLength(1);
        expect(rows[0].finished_at).not.toBeNull();
    });
});
