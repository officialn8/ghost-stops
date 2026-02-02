/**
 * Phase 2 ingestion scaffolding
 *
 * Run with: npx tsx scripts/ingest/index.ts
 */

type IngestionJob = {
  name: string;
  run: () => Promise<IngestionResult>;
};

import type { IngestionResult } from "./types";
import { runCensusIngestion } from "./sources/census";
import { runLodesIngestion } from "./sources/lodes";
import { runFhwaIngestion } from "./sources/fhwa";
import { runCtaHistoricalIngestion } from "./sources/ctaHistorical";
import { prisma } from "./utils";

const jobs: IngestionJob[] = [
  { name: "Census ACS/Decennial", run: runCensusIngestion },
  { name: "LODES", run: runLodesIngestion },
  { name: "FHWA", run: runFhwaIngestion },
  { name: "CTA Historical Ridership", run: runCtaHistoricalIngestion },
];

function logSummary(results: IngestionResult[]) {
  const totals = results.reduce(
    (acc, result) => {
      acc.inserted += result.inserted;
      acc.updated += result.updated;
      acc.skipped += result.skipped;
      acc.warnings += result.warnings.length;
      acc.errors += result.errors.length;
      return acc;
    },
    { inserted: 0, updated: 0, skipped: 0, warnings: 0, errors: 0 }
  );

  console.log("\n" + "═".repeat(50));
  console.log("📊 Ingestion Summary:");
  console.log(`  ✓ Inserted: ${totals.inserted}`);
  console.log(`  ✓ Updated: ${totals.updated}`);
  console.log(`  ⚠️ Skipped: ${totals.skipped}`);
  console.log(`  ⚠️ Warnings: ${totals.warnings}`);
  console.log(`  ✗ Errors: ${totals.errors}`);
  console.log("═".repeat(50));
}

async function main() {
  console.log("🚧 Phase 2 ingestion scaffolding\n");
  const results: IngestionResult[] = [];

  try {
    for (const job of jobs) {
      console.log(`▶ ${job.name}`);
      try {
        const result = await job.run();
        results.push(result);
        if (result.warnings.length > 0) {
          result.warnings.forEach((warning) => console.log(`  ⚠️ ${warning}`));
        }
        if (result.errors.length > 0) {
          result.errors.forEach((error) => console.log(`  ✗ ${error}`));
        }
      } catch (error) {
        console.log(`  ✗ Failed: ${error}`);
        results.push({
          sourceCode: job.name,
          inserted: 0,
          updated: 0,
          skipped: 0,
          warnings: [],
          errors: ["Unhandled ingestion error"],
        });
      }
    }

    logSummary(results);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("❌ Ingestion runner failed:", error);
  process.exit(1);
});
