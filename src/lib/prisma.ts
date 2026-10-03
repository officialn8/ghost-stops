import { PrismaPg } from "@prisma/adapter-pg";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * One Prisma client per process, over one pg pool.
 *
 * Route handlers share this instance and never call `$disconnect()`: under Vercel Fluid
 * compute one instance serves concurrent requests, so a per-request disconnect tears the
 * client down while another request is mid-query. The client is cached on `globalThis` so
 * that a second evaluation of this module (another bundle chunk, a dev reload) reuses it.
 *
 * The pool connects to the pooled DATABASE_URL (Neon's PgBouncer); the CLI's direct URL lives
 * in prisma.config.ts. Prisma 7 passes the pool's settings straight to pg, so they are explicit:
 * pg's default connection timeout is 0, which waits forever on a Neon compute that is still
 * waking. `attachDatabasePool` lets Fluid compute close idle clients before an instance
 * suspends; outside Vercel it does nothing.
 *
 * Server-only: components must not import this module (enforced by ESLint).
 */
export const POOL_CONFIG = {
    /** Connections per instance; Prisma 6 defaulted to 2 x CPUs + 1, which is 5 on Vercel. */
    max: 10,
    /** Covers a cold compute waking (a few seconds) and a wait for a free pooled connection. */
    connectionTimeoutMillis: 10_000,
    /** Short, because attachDatabasePool keeps a Vercel instance alive this long after a query. */
    idleTimeoutMillis: 5_000,
} as const;

function createClient(): PrismaClient {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ...POOL_CONFIG });
    attachDatabasePool(pool);
    // Routes never disconnect. Scripts and database tests do, and then the pool must close
    // too, or its idle clients hold the process open.
    return new PrismaClient({ adapter: new PrismaPg(pool, { disposeExternalPool: true }) });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

globalForPrisma.prisma = prisma;
