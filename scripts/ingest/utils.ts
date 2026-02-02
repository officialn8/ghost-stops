import { PrismaClient } from "@prisma/client";
import type { IngestionResult } from "./types";

const DEFAULT_TIMEOUT_MS = 8000;

export const prisma = new PrismaClient();

type FetchOutcome = {
  ok: boolean;
  status?: number;
  error?: string;
};

async function fetchWithTimeout(url: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Fetch failed" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshDataSource(
  sourceCode: string,
  fallbackUrl?: string
): Promise<IngestionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const dataSource = await prisma.dataSource.findUnique({
    where: { code: sourceCode },
  });

  if (!dataSource) {
    warnings.push(`DataSource not found for code: ${sourceCode}`);
    return {
      sourceCode,
      inserted: 0,
      updated: 0,
      skipped: 1,
      warnings,
      errors,
    };
  }

  const targetUrl = dataSource.apiUrl ?? dataSource.url ?? fallbackUrl;
  if (!targetUrl) {
    warnings.push(`No URL available for ${sourceCode}`);
    return {
      sourceCode,
      inserted: 0,
      updated: 0,
      skipped: 1,
      warnings,
      errors,
    };
  }

  const fetchResult = await fetchWithTimeout(targetUrl);
  const now = new Date();

  if (!fetchResult.ok) {
    const message = fetchResult.error
      ? `Fetch failed: ${fetchResult.error}`
      : `Non-200 response: ${fetchResult.status}`;
    await prisma.dataSource.update({
      where: { id: dataSource.id },
      data: {
        lastFetched: now,
        status: "ERROR",
        lastError: message,
      },
    });
    errors.push(message);
    return {
      sourceCode,
      inserted: 0,
      updated: 1,
      skipped: 0,
      warnings,
      errors,
    };
  }

  await prisma.dataSource.update({
    where: { id: dataSource.id },
    data: {
      lastFetched: now,
      lastSuccessfulFetch: now,
      status: "ACTIVE",
      lastError: null,
    },
  });

  return {
    sourceCode,
    inserted: 0,
    updated: 1,
    skipped: 0,
    warnings,
    errors,
  };
}
