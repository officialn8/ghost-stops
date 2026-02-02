import { createReadStream, createWriteStream } from "fs";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { createGunzip } from "zlib";
import * as readline from "readline";
import { buffer, area, intersect, booleanIntersects, point, featureCollection } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import * as shapefile from "shapefile";
import * as unzipper from "unzipper";
import type { IngestionResult } from "../types";
import { prisma } from "../utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data", "lodes");

const STATE_FIPS = "17";
const COUNTY_FIPS = "031";
const STATE_ABBR = "il";
const WALKSHED_MILES = 0.5;

const LODES_BASES = ["LODES8", "LODES7", "LODES5"] as const;
const LODES_SEGMENT = "S000";
const LODES_JOBTYPE = "JT00";
const BASELINE_YEAR = 2010;
const LATEST_YEAR = 2023;

const TIGER_2010_BG_URL =
  "https://www2.census.gov/geo/tiger/TIGER2010/BG/2010/tl_2010_17_bg10.zip";

const AGE_FIELDS = ["CA01", "CA02", "CA03"] as const;
const EARNINGS_FIELDS = ["CE01", "CE02", "CE03"] as const;
const INDUSTRY_FIELDS = [
  "CNS01",
  "CNS02",
  "CNS03",
  "CNS04",
  "CNS05",
  "CNS06",
  "CNS07",
  "CNS08",
  "CNS09",
  "CNS10",
  "CNS11",
  "CNS12",
  "CNS13",
  "CNS14",
  "CNS15",
  "CNS16",
  "CNS17",
  "CNS18",
  "CNS19",
  "CNS20",
] as const;

type BlockGroupFeature = {
  geoid: string;
  feature: Feature<Polygon | MultiPolygon>;
  area: number;
};

type CategoryTotals = Record<string, number>;

type LodesGroupValues = {
  geoid: string;
  total: number;
  age: CategoryTotals;
  earnings: CategoryTotals;
  industry: CategoryTotals;
};

type LodesAggregation = {
  total: number;
  weightSum: number;
  intersectCount: number;
  age: CategoryTotals;
  earnings: CategoryTotals;
  industry: CategoryTotals;
};

const ensureDir = async (dir: string) => {
  await fs.mkdir(dir, { recursive: true });
};

const downloadFile = async (url: string, destPath: string) => {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  await ensureDir(dirname(destPath));
  const fileStream = createWriteStream(destPath);
  await new Promise<void>((resolve, reject) => {
    const nodeStream = Readable.fromWeb(response.body as never);
    nodeStream.pipe(fileStream);
    nodeStream.on("error", reject);
    fileStream.on("finish", resolve);
  });
};

const ensureShapefile = async (datasetName: string, url: string) => {
  const datasetDir = join(DATA_DIR, datasetName);
  const zipPath = join(datasetDir, `${datasetName}.zip`);
  await ensureDir(datasetDir);

  const hasShp = await fs
    .readdir(datasetDir)
    .then((entries) => entries.some((entry) => entry.endsWith(".shp")))
    .catch(() => false);

  if (!hasShp) {
    const zipExists = await fs
      .access(zipPath)
      .then(() => true)
      .catch(() => false);

    if (!zipExists) {
      await downloadFile(url, zipPath);
    }
    await createReadStream(zipPath).pipe(unzipper.Extract({ path: datasetDir })).promise();
  }

  const entries = await fs.readdir(datasetDir);
  const shp = entries.find((entry) => entry.endsWith(".shp"));
  if (!shp) {
    throw new Error(`No .shp file found in ${datasetDir}`);
  }
  const base = shp.replace(/\.shp$/i, "");
  const dbf = entries.find((entry) => entry === `${base}.dbf`);
  if (!dbf) {
    throw new Error(`No .dbf file found for ${base} in ${datasetDir}`);
  }
  return {
    shpPath: join(datasetDir, shp),
    dbfPath: join(datasetDir, dbf),
  };
};

const loadBlockGroups2010 = async (): Promise<BlockGroupFeature[]> => {
  const { shpPath, dbfPath } = await ensureShapefile("bg2010_il", TIGER_2010_BG_URL);
  const source = await shapefile.open(shpPath, dbfPath);
  const results: BlockGroupFeature[] = [];

  while (true) {
    const record = await source.read();
    if (record.done) break;
    const feature = record.value as Feature<Polygon | MultiPolygon>;
    const props = feature.properties ?? {};

    const stateRaw = props["STATEFP10"] as string | number | undefined;
    const countyRaw = props["COUNTYFP10"] as string | number | undefined;
    const geoidRaw = props["GEOID10"] as string | number | undefined;
    const state = stateRaw !== undefined ? String(stateRaw).padStart(2, "0") : undefined;
    const county = countyRaw !== undefined ? String(countyRaw).padStart(3, "0") : undefined;
    const geoid = geoidRaw !== undefined ? String(geoidRaw) : undefined;

    if (state !== STATE_FIPS || county !== COUNTY_FIPS || !geoid) {
      continue;
    }

    results.push({
      geoid,
      feature,
      area: area(feature),
    });
  }

  return results;
};

const buildLodesFilename = (year: number) =>
  `${STATE_ABBR}_wac_${LODES_SEGMENT}_${LODES_JOBTYPE}_${year}.csv.gz`;

const buildLodesUrl = (base: string, year: number) =>
  `https://lehd.ces.census.gov/data/lodes/${base}/${STATE_ABBR}/wac/${buildLodesFilename(
    year
  )}`;

const ensureLodesFile = async (year: number) => {
  const filename = buildLodesFilename(year);
  const targetPath = join(DATA_DIR, filename);

  const exists = await fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);
  if (exists) {
    return targetPath;
  }

  let lastError: string | null = null;
  for (const base of LODES_BASES) {
    const url = buildLodesUrl(base, year);
    try {
      await downloadFile(url, targetPath);
      return targetPath;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(`Failed to download LODES ${year}: ${lastError ?? "unknown error"}`);
};

const parseNumber = (value: string | undefined) => {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

const initCategoryTotals = (fields: readonly string[]): CategoryTotals => {
  const totals: CategoryTotals = {};
  fields.forEach((field) => {
    totals[field] = 0;
  });
  return totals;
};

const loadLodesValues = async (year: number): Promise<Map<string, LodesGroupValues>> => {
  const filePath = await ensureLodesFile(year);
  const stream = createReadStream(filePath).pipe(createGunzip());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let header: string[] | null = null;
  let indexMap: Record<string, number> = {};
  const values = new Map<string, LodesGroupValues>();

  for await (const line of rl) {
    if (!header) {
      header = line.split(",");
      indexMap = header.reduce<Record<string, number>>((acc, key, idx) => {
        acc[key] = idx;
        return acc;
      }, {});
      const required = ["w_geocode", "C000", ...AGE_FIELDS, ...EARNINGS_FIELDS, ...INDUSTRY_FIELDS];
      const missing = required.filter((field) => indexMap[field] === undefined);
      if (missing.length > 0) {
        throw new Error(`Missing LODES columns: ${missing.join(", ")}`);
      }
      continue;
    }

    const row = line.split(",");
    const geocode = row[indexMap["w_geocode"]];
    if (!geocode || !geocode.startsWith(`${STATE_FIPS}${COUNTY_FIPS}`)) {
      continue;
    }
    const blockGroup = geocode.slice(0, 12);

    const total = parseNumber(row[indexMap["C000"]]);
    if (!values.has(blockGroup)) {
      values.set(blockGroup, {
        geoid: blockGroup,
        total: 0,
        age: initCategoryTotals(AGE_FIELDS),
        earnings: initCategoryTotals(EARNINGS_FIELDS),
        industry: initCategoryTotals(INDUSTRY_FIELDS),
      });
    }
    const entry = values.get(blockGroup)!;
    entry.total += total;

    AGE_FIELDS.forEach((field) => {
      entry.age[field] += parseNumber(row[indexMap[field]]);
    });
    EARNINGS_FIELDS.forEach((field) => {
      entry.earnings[field] += parseNumber(row[indexMap[field]]);
    });
    INDUSTRY_FIELDS.forEach((field) => {
      entry.industry[field] += parseNumber(row[indexMap[field]]);
    });
  }

  return values;
};

const aggregateWeighted = (
  bufferFeature: Feature<Polygon | MultiPolygon>,
  blockGroups: BlockGroupFeature[],
  values: Map<string, LodesGroupValues>
): LodesAggregation => {
  let total = 0;
  let weightSum = 0;
  let intersectCount = 0;
  const ageTotals = initCategoryTotals(AGE_FIELDS);
  const earningsTotals = initCategoryTotals(EARNINGS_FIELDS);
  const industryTotals = initCategoryTotals(INDUSTRY_FIELDS);

  for (const group of blockGroups) {
    const groupValues = values.get(group.geoid);
    if (!groupValues) continue;
    if (!booleanIntersects(bufferFeature, group.feature)) {
      continue;
    }

    const intersection = intersect(
      featureCollection([bufferFeature, group.feature])
    ) as Feature<Polygon | MultiPolygon> | null;
    if (!intersection) continue;

    const intersectionArea = area(intersection);
    if (intersectionArea <= 0 || group.area <= 0) continue;

    const weight = intersectionArea / group.area;
    total += groupValues.total * weight;
    weightSum += weight;
    intersectCount += 1;

    AGE_FIELDS.forEach((field) => {
      ageTotals[field] += groupValues.age[field] * weight;
    });
    EARNINGS_FIELDS.forEach((field) => {
      earningsTotals[field] += groupValues.earnings[field] * weight;
    });
    INDUSTRY_FIELDS.forEach((field) => {
      industryTotals[field] += groupValues.industry[field] * weight;
    });
  }

  return {
    total,
    weightSum,
    intersectCount,
    age: ageTotals,
    earnings: earningsTotals,
    industry: industryTotals,
  };
};

const upsertFact = async (data: {
  stationId: string;
  factKey: string;
  value: number;
  valueType: "number" | "percent" | "currency";
  unit: string;
  geography: "station" | "walkshed_0.5mi" | "region_il";
  sourceId: string;
  sourceNote?: string;
  methodology: string;
  timeframeStart?: number;
  timeframeEnd?: number;
  quality: "HIGH" | "MEDIUM" | "LOW";
  qualityNote?: string;
  evidenceMeta?: Record<string, unknown>;
}) => {
  await prisma.stationFact.upsert({
    where: {
      stationId_factKey: {
        stationId: data.stationId,
        factKey: data.factKey,
      },
    },
    create: {
      stationId: data.stationId,
      factKey: data.factKey,
      value: data.value,
      valueType: data.valueType,
      unit: data.unit,
      geography: data.geography,
      timeframeStart: data.timeframeStart,
      timeframeEnd: data.timeframeEnd,
      methodology: data.methodology,
      sourceId: data.sourceId,
      sourceNote: data.sourceNote,
      quality: data.quality,
      qualityNote: data.qualityNote,
      evidenceMeta: data.evidenceMeta,
    },
    update: {
      value: data.value,
      valueType: data.valueType,
      unit: data.unit,
      geography: data.geography,
      timeframeStart: data.timeframeStart,
      timeframeEnd: data.timeframeEnd,
      methodology: data.methodology,
      sourceId: data.sourceId,
      sourceNote: data.sourceNote,
      quality: data.quality,
      qualityNote: data.qualityNote,
      evidenceMeta: data.evidenceMeta,
    },
  });
};

export async function runLodesIngestion(): Promise<IngestionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const now = new Date();

  const dataSource = await prisma.dataSource.findUnique({
    where: { code: "lodes" },
  });
  if (!dataSource) {
    warnings.push("Missing DataSource row for lodes");
  }

  let blockGroups: BlockGroupFeature[] = [];
  let baselineValues = new Map<string, LodesGroupValues>();
  let latestValues = new Map<string, LodesGroupValues>();

  try {
    blockGroups = await loadBlockGroups2010();
  } catch (error) {
    errors.push(`Failed to load block groups: ${error}`);
  }

  try {
    baselineValues = await loadLodesValues(BASELINE_YEAR);
  } catch (error) {
    errors.push(`Failed to load LODES ${BASELINE_YEAR}: ${error}`);
  }

  try {
    latestValues = await loadLodesValues(LATEST_YEAR);
  } catch (error) {
    errors.push(`Failed to load LODES ${LATEST_YEAR}: ${error}`);
  }

  const stations = await prisma.station.findMany({
    where: { city: { code: "chicago" } },
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  let updated = 0;
  let skipped = 0;
  let processed = 0;

  for (const station of stations) {
    if (
      blockGroups.length === 0 ||
      baselineValues.size === 0 ||
      latestValues.size === 0
    ) {
      skipped += 1;
      continue;
    }

    const bufferFeature = buffer(point([station.longitude, station.latitude]), WALKSHED_MILES, {
      units: "miles",
    }) as Feature<Polygon | MultiPolygon>;

    const baselineAgg = aggregateWeighted(bufferFeature, blockGroups, baselineValues);
    const latestAgg = aggregateWeighted(bufferFeature, blockGroups, latestValues);

    if (baselineAgg.total <= 0 || latestAgg.total <= 0) {
      warnings.push(`Job data missing for ${station.name}`);
      skipped += 1;
      continue;
    }

    const jobsChange = (latestAgg.total - baselineAgg.total) / baselineAgg.total;
    const isLowJobs = baselineAgg.total < 50 || latestAgg.total < 50;
    const quality: "HIGH" | "MEDIUM" | "LOW" =
      isLowJobs ? "LOW" : baselineAgg.weightSum >= 0.75 && latestAgg.weightSum >= 0.75
      ? "HIGH"
      : "MEDIUM";

    const evidenceMeta = {
      walkshedMiles: WALKSHED_MILES,
      blockGroupYear: 2010,
      weights: {
        baseline: baselineAgg.weightSum,
        latest: latestAgg.weightSum,
      },
      baselineYear: BASELINE_YEAR,
      latestYear: LATEST_YEAR,
      categories: {
        age: { baseline: baselineAgg.age, latest: latestAgg.age },
        earnings: { baseline: baselineAgg.earnings, latest: latestAgg.earnings },
        industry: { baseline: baselineAgg.industry, latest: latestAgg.industry },
      },
    };

    if (dataSource) {
      await upsertFact({
        stationId: station.id,
        factKey: "jobs_walkshed_change",
        value: jobsChange,
        valueType: "percent",
        unit: "%",
        geography: "walkshed_0.5mi",
        sourceId: dataSource.id,
        sourceNote: `LODES WAC ${LODES_SEGMENT} ${LODES_JOBTYPE}`,
        methodology:
          "Area-weighted LODES WAC totals within 0.5mi walkshed (2010 vs 2023).",
        timeframeStart: BASELINE_YEAR,
        timeframeEnd: LATEST_YEAR,
        quality,
        qualityNote: isLowJobs
          ? "Very low job counts in walkshed; percent change may be unstable."
          : quality === "MEDIUM"
          ? "Partial block group coverage in walkshed."
          : undefined,
        evidenceMeta,
      });
      updated += 1;
    }

    processed += 1;
  }

  if (dataSource) {
    await prisma.dataSource.update({
      where: { id: dataSource.id },
      data: {
        lastFetched: now,
        lastSuccessfulFetch: errors.length === 0 ? now : dataSource.lastSuccessfulFetch,
        status: errors.length === 0 ? "ACTIVE" : "ERROR",
        lastError: errors.length === 0 ? null : errors.join("; "),
      },
    });
  }

  if (processed === 0) {
    warnings.push(
      `No stations processed (bg2010: ${blockGroups.length}, baseline: ${baselineValues.size}, latest: ${latestValues.size}).`
    );
  }

  return {
    sourceCode: "lodes",
    inserted: 0,
    updated,
    skipped,
    warnings,
    errors,
  };
}
