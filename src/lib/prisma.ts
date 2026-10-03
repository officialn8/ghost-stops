import { PrismaClient } from "@prisma/client";

/**
 * One Prisma client per process.
 *
 * Route handlers share this instance and never call `$disconnect()`: under Vercel Fluid
 * compute one instance serves concurrent requests, so a per-request disconnect tears the
 * client down while another request is mid-query. The client is cached on `globalThis` so
 * that a second evaluation of this module (another bundle chunk, a dev reload) reuses it.
 *
 * Server-only: components must not import this module (enforced by ESLint).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

globalForPrisma.prisma = prisma;
