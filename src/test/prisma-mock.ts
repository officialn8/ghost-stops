import type { PrismaClient } from "@/generated/prisma/client";
import { mockDeep, mockReset, type DeepMockProxy } from "vitest-mock-extended";

/**
 * Deep mock of PrismaClient for unit tests. Every model delegate and client
 * method is a mock that returns undefined until a test stubs it, for example
 * `prismaMock.station.findMany.mockResolvedValue([...])`.
 *
 * vi.mock factories are hoisted above imports, so load this module inside the factory:
 *
 *   vi.mock("@/lib/prisma", async () => ({
 *     prisma: (await import("@/test/prisma-mock")).prismaMock,
 *   }));
 */
export const prismaMock: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>();

/** Clears recorded calls and stubbed return values. Call it in beforeEach. */
export function resetPrismaMock(): void {
  mockReset(prismaMock);
}
