/**
 * Seed Narratives - Phase 1
 *
 * Populates DataSource, StationFact, and StationNarrative tables
 * for the top 25 ghost stations using curated placeholder data.
 *
 * Run with: npx tsx scripts/seed-narratives-phase1.ts
 */

import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  findBestArchetype,
  renderNarrative,
  formatValue,
  ARCHETYPE_TITLES,
  ARCHETYPE_EMOJIS,
} from "../src/lib/narratives";
import type { FactMap, FactKey, SeedDataFile } from "../src/types/narrative";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

const TEMPLATE_VERSION = "v1.0";
const DEFAULT_QUALITY = "LOW";
const DEFAULT_QUALITY_NOTE = "Placeholder fact (Phase 1)";

const ALLOWED_GEOGRAPHIES = new Set(["station", "walkshed_0.5mi", "region_il"]);

function getValueType(unit: string) {
  return unit === "%" ? "percent" : "number";
}

function resolveQuality(
  factData: SeedDataFile["stations"][number]["facts"][string],
  defaults: { quality: string; note: string }
) {
  const quality = factData?.quality ?? defaults.quality;
  const qualityNote = factData?.qualityNote ?? defaults.note;
  return { quality, qualityNote };
}

function validateSeedFact(
  factKey: string,
  factData: SeedDataFile["stations"][number]["facts"][string],
  defaults: { quality: string; note: string }
) {
  const issues: string[] = [];

  if (!factData) {
    issues.push("missing fact data");
    return { valid: false, issues, quality: defaults.quality, qualityNote: defaults.note };
  }

  if (typeof factData.value !== "number" || Number.isNaN(factData.value)) {
    issues.push("value must be a number");
  }

  if (!factData.unit || typeof factData.unit !== "string") {
    issues.push("unit is required");
  }

  if (!factData.methodology || typeof factData.methodology !== "string") {
    issues.push("methodology is required");
  }

  if (!ALLOWED_GEOGRAPHIES.has(factData.geography)) {
    issues.push(`invalid geography: ${factData.geography}`);
  }

  if (factData.timeframeStart && factData.timeframeEnd) {
    if (factData.timeframeStart > factData.timeframeEnd) {
      issues.push("timeframeStart must be <= timeframeEnd");
    }
  }

  if (factData.unit === "%" && Math.abs(factData.value) > 1) {
    issues.push("percent values must be stored as decimals");
  }

  const { quality, qualityNote } = resolveQuality(factData, defaults);

  return {
    valid: issues.length === 0,
    issues,
    quality,
    qualityNote,
  };
}

async function main() {
  console.log("🚀 Starting narrative seed (Phase 1)...\n");

  // Load seed data
  const dataPath = join(__dirname, "data", "top25-facts.json");
  const seedData: SeedDataFile = JSON.parse(readFileSync(dataPath, "utf-8"));
  const defaultQuality = seedData.defaultFactQuality ?? DEFAULT_QUALITY;
  const defaultQualityNote = seedData.defaultFactQualityNote ?? DEFAULT_QUALITY_NOTE;
  const defaultEvidenceMeta = seedData.defaultEvidenceMeta ?? {
    placeholder: true,
    source: "phase1_seed",
  };

  // 1. Seed DataSources
  console.log("📚 Seeding data sources...");
  const sourceMap = new Map<string, string>(); // code -> id

  for (const source of seedData.sources) {
    const existing = await prisma.dataSource.findUnique({
      where: { code: source.code },
    });

    if (existing) {
      sourceMap.set(source.code, existing.id);
      console.log(`  ✓ ${source.code} (exists)`);
    } else {
      const created = await prisma.dataSource.create({
        data: {
          code: source.code,
          name: source.name,
          url: source.url,
          apiUrl: source.apiUrl,
          datasetId: source.datasetId,
          license: source.license,
          refreshCadence: source.refreshCadence,
        },
      });
      sourceMap.set(source.code, created.id);
      console.log(`  + ${source.code} (created)`);
    }
  }

  // 2. Process each station
  console.log("\n📊 Processing stations...\n");

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  let warningCount = 0;

  for (const stationData of seedData.stations) {
    const stationName = stationData.name;

    // Find station in database
    const station = await prisma.station.findFirst({
      where: {
        name: { contains: stationName },
        city: { code: "chicago" },
      },
      include: { metrics: true },
    });

    if (!station) {
      console.log(`  ⚠️ ${stationName}: Station not found, skipping`);
      skipCount++;
      continue;
    }

    const latestAvg = station.metrics?.rolling30dAvg ?? 0;

    // Build fact map for this station
    const factMap: FactMap = {};

    // 3. Seed facts for this station
    for (const [factKey, factData] of Object.entries(stationData.facts)) {
      const validation = validateSeedFact(factKey, factData, {
        quality: defaultQuality,
        note: defaultQualityNote,
      });
      if (!validation.valid) {
        warningCount += validation.issues.length;
        console.log(
          `    ⚠️ ${factKey}: ${validation.issues.join("; ")}`
        );
        continue;
      }

      const sourceId = sourceMap.get(factData.sourceCode);
      if (!sourceId) {
        console.log(`    ⚠️ Unknown source: ${factData.sourceCode}`);
        continue;
      }

      const valueType = getValueType(factData.unit);
      const evidenceMeta = factData.evidenceMeta ?? defaultEvidenceMeta;

      try {
        // Upsert fact
        await prisma.stationFact.upsert({
          where: {
            stationId_factKey: {
              stationId: station.id,
              factKey: factKey,
            },
          },
          create: {
            stationId: station.id,
            factKey: factKey,
            value: factData.value,
            valueType: valueType,
            unit: factData.unit,
            geography: factData.geography,
            timeframeStart: factData.timeframeStart,
            timeframeEnd: factData.timeframeEnd,
            methodology: factData.methodology,
            sourceId: sourceId,
            sourceNote: factData.sourceNote,
            quality: validation.quality,
            qualityNote: validation.qualityNote,
            evidenceMeta: evidenceMeta,
          },
          update: {
            value: factData.value,
            valueType: valueType,
            unit: factData.unit,
            geography: factData.geography,
            timeframeStart: factData.timeframeStart,
            timeframeEnd: factData.timeframeEnd,
            methodology: factData.methodology,
            sourceId: sourceId,
            sourceNote: factData.sourceNote,
            quality: validation.quality,
            qualityNote: validation.qualityNote,
            evidenceMeta: evidenceMeta,
          },
        });

        // Add to fact map
        factMap[factKey as FactKey] = {
          value: factData.value,
          displayValue: formatValue(
            factData.value,
            valueType
          ),
          valueType: valueType,
          unit: factData.unit,
          geography: factData.geography as "station" | "walkshed_0.5mi" | "region_il",
          timeframeStart: factData.timeframeStart,
          timeframeEnd: factData.timeframeEnd,
          methodology: factData.methodology,
          sourceNote: factData.sourceNote,
          quality: validation.quality as "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN",
          qualityNote: validation.qualityNote,
          evidenceMeta: evidenceMeta,
          source: {
            name: seedData.sources.find((s) => s.code === factData.sourceCode)?.name ?? "",
            url: seedData.sources.find((s) => s.code === factData.sourceCode)?.url ?? "",
          },
        };
      } catch (err) {
        console.log(`    ⚠️ Error inserting fact ${factKey}: ${err}`);
      }
    }

    // Add regional facts
    if (seedData.regionalFacts) {
      for (const [factKey, factData] of Object.entries(seedData.regionalFacts)) {
        const validation = validateSeedFact(factKey, factData, {
          quality: defaultQuality,
          note: defaultQualityNote,
        });
        if (!validation.valid) {
          warningCount += validation.issues.length;
          console.log(
            `    ⚠️ ${factKey}: ${validation.issues.join("; ")}`
          );
          continue;
        }

        const sourceId = sourceMap.get(factData.sourceCode);
        if (!sourceId) continue;

        const valueType = getValueType(factData.unit);
        const evidenceMeta = factData.evidenceMeta ?? defaultEvidenceMeta;

        try {
          await prisma.stationFact.upsert({
            where: {
              stationId_factKey: {
                stationId: station.id,
                factKey: factKey,
              },
            },
            create: {
              stationId: station.id,
              factKey: factKey,
              value: factData.value,
              valueType: valueType,
              unit: factData.unit,
              geography: factData.geography,
              timeframeStart: factData.timeframeStart,
              timeframeEnd: factData.timeframeEnd,
              methodology: factData.methodology,
              sourceId: sourceId,
              quality: validation.quality,
              qualityNote: validation.qualityNote,
              evidenceMeta: evidenceMeta,
            },
            update: {
              value: factData.value,
              valueType: valueType,
              unit: factData.unit,
              geography: factData.geography,
              timeframeStart: factData.timeframeStart,
              timeframeEnd: factData.timeframeEnd,
              methodology: factData.methodology,
              sourceId: sourceId,
              quality: validation.quality,
              qualityNote: validation.qualityNote,
              evidenceMeta: evidenceMeta,
            },
          });

          factMap[factKey as FactKey] = {
            value: factData.value,
            displayValue: formatValue(
              factData.value,
              valueType
            ),
            valueType: valueType,
            unit: factData.unit,
            geography: factData.geography as "station" | "walkshed_0.5mi" | "region_il",
            timeframeStart: factData.timeframeStart,
            timeframeEnd: factData.timeframeEnd,
            methodology: factData.methodology,
            quality: validation.quality as "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN",
            qualityNote: validation.qualityNote,
            evidenceMeta: evidenceMeta,
            source: {
              name: seedData.sources.find((s) => s.code === factData.sourceCode)?.name ?? "",
              url: seedData.sources.find((s) => s.code === factData.sourceCode)?.url ?? "",
            },
          };
        } catch (err) {
          // Ignore duplicate regional facts
        }
      }
    }

    // Add computed facts
    const baseline = factMap.ridership_2001_avg?.value;
    if (baseline && baseline > 0 && latestAvg > 0) {
      const declinePct = (baseline - latestAvg) / baseline;
      const sourceId = sourceMap.get("cta_socrata");

      if (sourceId) {
        const computedEvidenceMeta = {
          computedFrom: ["ridership_2001_avg", "rolling30dAvg"],
          formula: "(baseline - latestAvg) / baseline",
        };
        await prisma.stationFact.upsert({
          where: {
            stationId_factKey: {
              stationId: station.id,
              factKey: "ridership_decline_pct",
            },
          },
          create: {
            stationId: station.id,
            factKey: "ridership_decline_pct",
            value: declinePct,
            valueType: "percent",
            unit: "%",
            geography: "station",
            timeframeStart: 2001,
            methodology: "Computed: (2001 avg - latest 30-day avg) / 2001 avg",
            sourceId: sourceId,
            sourceNote: "Latest from current DB rolling 30-day",
            quality: "MEDIUM",
            qualityNote: "Computed from historical baseline and current rolling average.",
            evidenceMeta: computedEvidenceMeta,
          },
          update: {
            value: declinePct,
            valueType: "percent",
            unit: "%",
            geography: "station",
            timeframeStart: 2001,
            methodology: "Computed: (2001 avg - latest 30-day avg) / 2001 avg",
            sourceId: sourceId,
            sourceNote: "Latest from current DB rolling 30-day",
            quality: "MEDIUM",
            qualityNote: "Computed from historical baseline and current rolling average.",
            evidenceMeta: computedEvidenceMeta,
          },
        });

        factMap.ridership_decline_pct = {
          value: declinePct,
          displayValue: formatValue(declinePct, "percent"),
          valueType: "percent",
          unit: "%",
          geography: "station",
          timeframeStart: 2001,
          methodology: "Computed: (2001 avg - latest 30-day avg) / 2001 avg",
          sourceNote: "Latest from current DB rolling 30-day",
          quality: "MEDIUM",
          qualityNote: "Computed from historical baseline and current rolling average.",
          evidenceMeta: computedEvidenceMeta,
          source: {
            name: "CTA L Station Entries Daily Totals",
            url: "https://data.cityofchicago.org/Transportation/CTA-Ridership-L-Station-Entries-Daily-Totals/5neh-572f",
          },
        };
      }
    }

    // 4. Generate narrative
    const { archetype, confidence } = findBestArchetype(factMap, latestAvg);
    const { story, evidenceFactKeys } = renderNarrative(
      archetype,
      station.name,
      factMap,
      latestAvg
    );

    const evidenceQualities = evidenceFactKeys
      .map((key) => factMap[key as FactKey]?.quality)
      .filter((quality): quality is string => Boolean(quality));
    const narrativeQuality = evidenceQualities.includes("LOW")
      ? "LOW"
      : evidenceQualities.includes("MEDIUM")
      ? "MEDIUM"
      : evidenceQualities.includes("HIGH")
      ? "HIGH"
      : defaultQuality;
    const narrativeQualityNote =
      narrativeQuality === "LOW"
        ? "Some evidence facts are placeholder or low confidence."
        : narrativeQuality === "MEDIUM"
        ? "Narrative derived from mixed-confidence evidence."
        : undefined;

    // 5. Save narrative
    try {
      await prisma.stationNarrative.upsert({
        where: { stationId: station.id },
        create: {
          stationId: station.id,
          archetypeKey: archetype.key,
          renderedStory: story,
          evidenceFactKeys: JSON.stringify(evidenceFactKeys),
          templateVersion: TEMPLATE_VERSION,
          confidence: confidence,
          quality: narrativeQuality,
          qualityNote: narrativeQualityNote,
          evidenceMeta: {
            evidenceFactKeys: evidenceFactKeys,
            generatedBy: "seed-narratives-phase1",
          },
        },
        update: {
          archetypeKey: archetype.key,
          renderedStory: story,
          evidenceFactKeys: JSON.stringify(evidenceFactKeys),
          templateVersion: TEMPLATE_VERSION,
          confidence: confidence,
          quality: narrativeQuality,
          qualityNote: narrativeQualityNote,
          evidenceMeta: {
            evidenceFactKeys: evidenceFactKeys,
            generatedBy: "seed-narratives-phase1",
          },
          lastComputed: new Date(),
        },
      });

      console.log(
        `  ✓ ${stationName}: ${ARCHETYPE_EMOJIS[archetype.key]} ${archetype.title} (${Math.round(confidence * 100)}% confidence)`
      );
      successCount++;
    } catch (err) {
      console.log(`  ✗ ${stationName}: Error saving narrative - ${err}`);
      errorCount++;
    }
  }

  // Summary
  console.log("\n" + "═".repeat(50));
  console.log("📊 Summary:");
  console.log(`  ✓ ${successCount} stations processed successfully`);
  if (skipCount > 0) console.log(`  ⚠️ ${skipCount} stations skipped (not found)`);
  if (warningCount > 0) console.log(`  ⚠️ ${warningCount} validation warnings`);
  if (errorCount > 0) console.log(`  ✗ ${errorCount} errors`);
  console.log("═".repeat(50));
}

main()
  .catch((e) => {
    console.error("❌ Fatal error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
