import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Count constructions across module re-evaluations; vi.resetModules() re-runs the mock factory.
const constructed = vi.hoisted(() => ({ count: 0 }));

vi.mock('@prisma/client', () => ({
  PrismaClient: vi.fn(function PrismaClient(this: object) {
    constructed.count += 1;
  }),
}));

const globalForPrisma = globalThis as unknown as { prisma?: unknown };

function routeHandlerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return routeHandlerFiles(full);
    return /^route\.(ts|tsx|js)$/.test(entry) ? [full] : [];
  });
}

const apiDir = fileURLToPath(new URL('../app/api', import.meta.url));

describe('prisma singleton', () => {
  afterEach(() => {
    delete globalForPrisma.prisma;
    constructed.count = 0;
    vi.resetModules();
  });

  it('returns the same client when the module is evaluated twice', async () => {
    const first = await import('./prisma');
    vi.resetModules(); // a second bundle chunk or a dev reload re-evaluates the module
    const second = await import('./prisma');

    expect(second.prisma).toBe(first.prisma);
    expect(constructed.count).toBe(1);
  });

  it('reuses a client already cached on globalThis', async () => {
    const cached = { cached: true };
    globalForPrisma.prisma = cached;

    const { prisma } = await import('./prisma');

    expect(prisma).toBe(cached);
    expect(constructed.count).toBe(0);
  });
});

describe('API route handlers', () => {
  const files = routeHandlerFiles(apiDir);

  it('finds route handlers to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never disconnect the shared client', () => {
    const offenders = files.filter((file) => readFileSync(file, 'utf8').includes('$disconnect'));
    expect(offenders).toEqual([]);
  });

  it('never construct their own PrismaClient', () => {
    const offenders = files.filter((file) => /new\s+PrismaClient\s*\(/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
