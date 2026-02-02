import { createReadStream, createWriteStream } from "fs";
import { promises as fs } from "fs";
import { dirname, join, basename } from "path";
import { fileURLToPath } from "url";
import { Readable } from "stream";
import { buffer, area, intersect, booleanIntersects, point, featureCollection } from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import * as shapefile from "shapefile";
import * as unzipper from "unzipper";
import type { IngestionResult } from "../types";
import { prisma } from "../utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DATA_DIR = join(__dirname, "..", "data", "census");

const STATE_FIPS = "17";
const COUNTY_FIPS = "031";
const WALKSHED_MILES = 0.5;

const TIGER_2010_BG_URL =
  "https://www2.census.gov/geo/tiger/TIGER2010/BG/2010/tl_2010_17_bg10.zip";
const TIGER_2020_BG_URL =
  "https://www2.census.gov/geo/tiger/TIGER2020/BG/tl_2020_17_bg.zip";
const TIGER_2020_TRACT_URL =
  "https://www2.census.gov/geo/tiger/TIGER2020/TRACT/tl_2020_17_tract.zip";

const ACS_API_BASE = "https://api.census.gov/data/2024/acs/acs5";
const DECENNIAL_API_BASE = "https://api.census.gov/data/2010/dec/sf1";

type BlockGroupFeature = {
  geoid: string;
  feature: Feature<Polygon | MultiPolygon>;
  area: number;
};

type TractFeature = {
  geoid: string;
  feature: Feature<Polygon | MultiPolygon>;
  area: number;
};

type BlockGroupValues = {
  geoid: string;
  population?: number;
  households?: number;
  vehicles2plus?: number;
};

type TractValues = {
  geoid: string;
  population?: number;
  households?: number;
  vehicles2plus?: number;
};

type AggregationResult = {
  total: number;
  weightSum: number;
  intersectCount: number;
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

const unzipFile = async (zipPath: string, destDir: string) => {
  await ensureDir(destDir);
  await createReadStream(zipPath)
    .pipe(unzipper.Extract({ path: destDir }))
    .promise();
};

const findShapefilePair = async (dir: string) => {
  const entries = await fs.readdir(dir);
  const shp = entries.find((entry) => entry.endsWith(".shp"));
  if (!shp) {
    throw new Error(`No .shp file found in ${dir}`);
  }
  const base = basename(shp, ".shp");
  const dbf = entries.find((entry) => entry === `${base}.dbf`);
  if (!dbf) {
    throw new Error(`No .dbf file found for ${base} in ${dir}`);
  }
  return {
    shpPath: join(dir, shp),
    dbfPath: join(dir, dbf),
  };
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
    await unzipFile(zipPath, datasetDir);
  }

  return findShapefilePair(datasetDir);
};

const loadBlockGroups = async (
  datasetName: string,
  url: string,
  year: 2010 | 2020
): Promise<BlockGroupFeature[]> => {
  const { shpPath, dbfPath } = await ensureShapefile(datasetName, url);
  const source = await shapefile.open(shpPath, dbfPath);
  const results: BlockGroupFeature[] = [];

  while (true) {
    const record = await source.read();
    if (record.done) break;
    const feature = record.value as Feature<Polygon | MultiPolygon>;
    const props = feature.properties ?? {};

    const stateKey = year === 2010 ? "STATEFP10" : "STATEFP";
    const countyKey = year === 2010 ? "COUNTYFP10" : "COUNTYFP";
    const geoidKey = year === 2010 ? "GEOID10" : "GEOID";

    const stateRaw = props[stateKey] as string | number | undefined;
    const countyRaw = props[countyKey] as string | number | undefined;
    const geoidRaw = props[geoidKey] as string | number | undefined;
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

const loadTracts = async (
  datasetName: string,
  url: string
): Promise<TractFeature[]> => {
  const { shpPath, dbfPath } = await ensureShapefile(datasetName, url);
  const source = await shapefile.open(shpPath, dbfPath);
  const results: TractFeature[] = [];

  while (true) {
    const record = await source.read();
    if (record.done) break;
    const feature = record.value as Feature<Polygon | MultiPolygon>;
    const props = feature.properties ?? {};

    const stateRaw = props["STATEFP"] as string | number | undefined;
    const countyRaw = props["COUNTYFP"] as string | number | undefined;
    const geoidRaw = props["GEOID"] as string | number | undefined;
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

const buildGeoid = (state: string, county: string, tract: string, blockGroup: string) =>
  `${state}${county}${tract}${blockGroup}`;

const fetchCensusData = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Census API request failed: ${response.status}`);
  }
  const data = (await response.json()) as string[][];
  if (!Array.isArray(data) || data.length < 2) {
    throw new Error("Unexpected Census API response shape");
  }
  const [header, ...rows] = data;
  return { header, rows };
};

const findHeaderIndex = (header: string[], candidates: string[]) => {
  const normalized = header.map((value) => value.toLowerCase().trim());
  const target = candidates.map((value) => value.toLowerCase().trim());
  return normalized.findIndex((value) => target.includes(value));
};

const parseNumber = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const aggregateWeighted = (
  bufferFeature: Feature<Polygon | MultiPolygon>,
  blockGroups: BlockGroupFeature[],
  values: Map<string, BlockGroupValues>,
  valueSelector: (value: BlockGroupValues) => number | null
): AggregationResult => {
  let total = 0;
  let weightSum = 0;
  let intersectCount = 0;

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
    const value = valueSelector(groupValues);
    if (value === null) continue;

    total += value * weight;
    weightSum += weight;
    intersectCount += 1;
  }

  return { total, weightSum, intersectCount };
};

const buildCensusUrl = (base: string, params: Record<string, string>) => {
  const search = new URLSearchParams(params);
  const apiKey = process.env.CENSUS_API_KEY;
  if (apiKey) {
    search.set("key", apiKey);
  }
  return `${base}?${search.toString()}`;
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

export async function runCensusIngestion(): Promise<IngestionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const now = new Date();

  const decennialSource = await prisma.dataSource.findUnique({
    where: { code: "census_decennial" },
  });
  const acsSource = await prisma.dataSource.findUnique({
    where: { code: "census_acs_5yr" },
  });
  const airportSource = await prisma.dataSource.upsert({
    where: { code: "ohare_arrivals" },
    update: {},
    create: {
      code: "ohare_arrivals",
      name: "O'Hare Airport Arrivals",
      url: "https://www.flychicago.com",
      refreshCadence: "annual",
    },
  });

  if (!decennialSource || !acsSource) {
    warnings.push("Missing DataSource rows for census_decennial or census_acs_5yr");
  }

  let blockGroups2010: BlockGroupFeature[] = [];
  let blockGroups2020: BlockGroupFeature[] = [];
  let tracts2020: TractFeature[] = [];

  try {
    blockGroups2010 = await loadBlockGroups("bg2010_il", TIGER_2010_BG_URL, 2010);
    blockGroups2020 = await loadBlockGroups("bg2020_il", TIGER_2020_BG_URL, 2020);
    tracts2020 = await loadTracts("tract2020_il", TIGER_2020_TRACT_URL);
  } catch (error) {
    errors.push(`Failed to load TIGER/Line block groups: ${error}`);
  }

  const decennialUrl = buildCensusUrl(DECENNIAL_API_BASE, {
    get: "P001001",
    for: "block group:*",
    in: `state:${STATE_FIPS} county:${COUNTY_FIPS}`,
  });
  const decennialTractUrl = buildCensusUrl(DECENNIAL_API_BASE, {
    get: "P001001",
    for: "tract:*",
    in: `state:${STATE_FIPS} county:${COUNTY_FIPS}`,
  });

  const acsPopulationUrl = buildCensusUrl(ACS_API_BASE, {
    get: "B01003_001E",
    for: "block group:*",
    in: `state:${STATE_FIPS} county:${COUNTY_FIPS}`,
  });

  const acsVehiclesUrl = buildCensusUrl(ACS_API_BASE, {
    get: "B08201_001E,B08201_004E,B08201_005E,B08201_006E",
    for: "tract:*",
    in: `state:${STATE_FIPS} county:${COUNTY_FIPS}`,
  });

  const decennialValues = new Map<string, BlockGroupValues>();
  const decennialTractValues = new Map<string, TractValues>();
  const acsPopulationValues = new Map<string, BlockGroupValues>();
  const acsVehicleValues = new Map<string, TractValues>();

  try {
    const { header, rows } = await fetchCensusData(decennialUrl);
    const popIndex = findHeaderIndex(header, ["P001001"]);
    const stateIndex = findHeaderIndex(header, ["state"]);
    const countyIndex = findHeaderIndex(header, ["county"]);
    const tractIndex = findHeaderIndex(header, ["tract"]);
    const blockGroupIndex = findHeaderIndex(header, ["block group", "blockgroup", "blkgrp"]);

    if (
      popIndex === -1 ||
      stateIndex === -1 ||
      countyIndex === -1 ||
      tractIndex === -1 ||
      blockGroupIndex === -1
    ) {
      throw new Error(`Decennial header missing expected fields: ${header.join(", ")}`);
    }

    rows.forEach((row) => {
      const geoid = buildGeoid(
        row[stateIndex],
        row[countyIndex],
        row[tractIndex],
        row[blockGroupIndex]
      );
      const population = parseNumber(row[popIndex]);
      if (population === null) return;
      decennialValues.set(geoid, { geoid, population });
    });
  } catch (error) {
    errors.push(`Decennial API failed: ${error}`);
  }

  try {
    const { header, rows } = await fetchCensusData(decennialTractUrl);
    const popIndex = findHeaderIndex(header, ["P001001"]);
    const stateIndex = findHeaderIndex(header, ["state"]);
    const countyIndex = findHeaderIndex(header, ["county"]);
    const tractIndex = findHeaderIndex(header, ["tract"]);

    if (
      popIndex === -1 ||
      stateIndex === -1 ||
      countyIndex === -1 ||
      tractIndex === -1
    ) {
      throw new Error(`Decennial tract header missing expected fields: ${header.join(", ")}`);
    }

    rows.forEach((row) => {
      const geoid = `${row[stateIndex]}${row[countyIndex]}${row[tractIndex]}`;
      const population = parseNumber(row[popIndex]);
      if (population === null) return;
      decennialTractValues.set(geoid, { geoid, population });
    });
  } catch (error) {
    errors.push(`Decennial tract API failed: ${error}`);
  }

  try {
    const { header, rows } = await fetchCensusData(acsPopulationUrl);
    const popIndex = findHeaderIndex(header, ["B01003_001E"]);
    const stateIndex = findHeaderIndex(header, ["state"]);
    const countyIndex = findHeaderIndex(header, ["county"]);
    const tractIndex = findHeaderIndex(header, ["tract"]);
    const blockGroupIndex = findHeaderIndex(header, ["block group", "blockgroup", "blkgrp"]);

    if (
      popIndex === -1 ||
      stateIndex === -1 ||
      countyIndex === -1 ||
      tractIndex === -1 ||
      blockGroupIndex === -1
    ) {
      throw new Error(`ACS population header missing expected fields: ${header.join(", ")}`);
    }

    rows.forEach((row) => {
      const geoid = buildGeoid(
        row[stateIndex],
        row[countyIndex],
        row[tractIndex],
        row[blockGroupIndex]
      );
      const population = parseNumber(row[popIndex]);
      if (population === null) return;
      acsPopulationValues.set(geoid, {
        geoid,
        population,
      });
    });
  } catch (error) {
    errors.push(`ACS population API failed: ${error}`);
  }

  try {
    const { header, rows } = await fetchCensusData(acsVehiclesUrl);
    const totalHouseholdsIndex = findHeaderIndex(header, ["B08201_001E"]);
    const vehicles2Index = findHeaderIndex(header, ["B08201_004E"]);
    const vehicles3Index = findHeaderIndex(header, ["B08201_005E"]);
    const vehicles4Index = findHeaderIndex(header, ["B08201_006E"]);
    const stateIndex = findHeaderIndex(header, ["state"]);
    const countyIndex = findHeaderIndex(header, ["county"]);
    const tractIndex = findHeaderIndex(header, ["tract"]);

    if (
      totalHouseholdsIndex === -1 ||
      vehicles2Index === -1 ||
      vehicles3Index === -1 ||
      vehicles4Index === -1 ||
      stateIndex === -1 ||
      countyIndex === -1 ||
      tractIndex === -1
    ) {
      throw new Error(`ACS vehicle header missing expected fields: ${header.join(", ")}`);
    }

    rows.forEach((row) => {
      const geoid = `${row[stateIndex]}${row[countyIndex]}${row[tractIndex]}`;
      const households = parseNumber(row[totalHouseholdsIndex]);
      const vehicles2 = parseNumber(row[vehicles2Index]) ?? 0;
      const vehicles3 = parseNumber(row[vehicles3Index]) ?? 0;
      const vehicles4 = parseNumber(row[vehicles4Index]) ?? 0;
      const vehicles2plus = vehicles2 + vehicles3 + vehicles4;

      if (households === null) return;
      acsVehicleValues.set(geoid, {
        geoid,
        households,
        vehicles2plus,
      });
    });
  } catch (error) {
    errors.push(`ACS vehicle API failed: ${error}`);
  }

  const stations = await prisma.station.findMany({
    where: { city: { code: "chicago" } },
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  let updated = 0;
  let skipped = 0;
  let processed = 0;
  let missingInputs = 0;

  for (const station of stations) {
    const isOhare = /o['’]?hare/i.test(station.name);
    if (isOhare) {
      await upsertFact({
        stationId: station.id,
        factKey: "airport_arrivals",
        value: 0,
        valueType: "number",
        unit: "arrivals/day",
        geography: "station",
        sourceId: airportSource.id,
        methodology: "Placeholder until airport arrivals ingestion is implemented.",
        quality: "LOW",
        qualityNote: "Airport arrivals data pending; Census walkshed excluded.",
        evidenceMeta: { placeholder: true },
      });
      updated += 1;
      processed += 1;
      continue;
    }

    if (
      blockGroups2010.length === 0 ||
      blockGroups2020.length === 0 ||
      acsPopulationValues.size === 0 ||
      decennialValues.size === 0
    ) {
      skipped += 1;
      missingInputs += 1;
      continue;
    }

    const bufferFeature = buffer(point([station.longitude, station.latitude]), WALKSHED_MILES, {
      units: "miles",
    }) as Feature<Polygon | MultiPolygon>;

    const decennialAgg = aggregateWeighted(
      bufferFeature,
      blockGroups2010,
      decennialValues,
      (value) => value.population ?? null
    );
    const decennialTractAgg = tracts2020.length > 0 && decennialTractValues.size > 0
      ? aggregateWeighted(
          bufferFeature,
          tracts2020,
          decennialTractValues,
          (value) => value.population ?? null
        )
      : { total: 0, weightSum: 0, intersectCount: 0 };

    const acsPopAgg = aggregateWeighted(
      bufferFeature,
      blockGroups2020,
      acsPopulationValues,
      (value) => value.population ?? null
    );

    const acsHouseholdsAgg = tracts2020.length > 0 && acsVehicleValues.size > 0
      ? aggregateWeighted(
          bufferFeature,
          tracts2020,
          acsVehicleValues,
          (value) => value.households ?? null
        )
      : { total: 0, weightSum: 0, intersectCount: 0 };

    const acsVehiclesAgg = tracts2020.length > 0 && acsVehicleValues.size > 0
      ? aggregateWeighted(
          bufferFeature,
          tracts2020,
          acsVehicleValues,
          (value) => value.vehicles2plus ?? null
        )
      : { total: 0, weightSum: 0, intersectCount: 0 };

    let populationChangeSource: "block_group" | "tract" = "block_group";
    let populationChangeTotal = decennialAgg.total;
    let populationChangeAcs = acsPopAgg.total;

    if (decennialAgg.total <= 0 || acsPopAgg.total <= 0) {
      if (decennialTractAgg.total > 0 && acsPopAgg.total > 0) {
        populationChangeSource = "tract";
        populationChangeTotal = decennialTractAgg.total;
      } else {
        warnings.push(`Population data missing for ${station.name}`);
        skipped += 1;
        continue;
      }
    }

    const populationChange = (populationChangeAcs - populationChangeTotal) / populationChangeTotal;
    const vehiclePct =
      acsHouseholdsAgg.total > 0 ? acsVehiclesAgg.total / acsHouseholdsAgg.total : null;

    if (vehiclePct === null) {
      warnings.push(`Vehicle ownership data missing for ${station.name}`);
    }

    const isLowPopulation = populationChangeTotal < 50 || populationChangeAcs < 50;
    const quality: "HIGH" | "MEDIUM" | "LOW" =
      populationChangeSource === "tract"
        ? "MEDIUM"
        : isLowPopulation
        ? "LOW"
        : decennialAgg.weightSum >= 0.75 && acsPopAgg.weightSum >= 0.75
        ? "HIGH"
        : "MEDIUM";
      decennialAgg.weightSum >= 0.75 && acsPopAgg.weightSum >= 0.75
        ? "HIGH"
        : "MEDIUM";

    const evidenceMeta = {
      walkshedMiles: WALKSHED_MILES,
      blockGroupYear: 2020,
      weights: {
        decennial: populationChangeSource === "tract"
          ? decennialTractAgg.weightSum
          : decennialAgg.weightSum,
        acs: acsPopAgg.weightSum,
      },
      populationSource: populationChangeSource,
    };
    const vehicleEvidenceMeta = {
      walkshedMiles: WALKSHED_MILES,
      tractYear: 2020,
      weights: {
        acs: acsHouseholdsAgg.weightSum,
      },
    };

    if (acsSource) {
      await upsertFact({
        stationId: station.id,
        factKey: "population_change",
        value: populationChange,
        valueType: "percent",
        unit: "%",
        geography: "walkshed_0.5mi",
        sourceId: acsSource.id,
        sourceNote: "Baseline: 2010 Decennial SF1 P001001",
        methodology:
          "Area-weighted block group totals within 0.5mi walkshed (2010 SF1 vs 2020-2024 ACS).",
        timeframeStart: 2010,
        timeframeEnd: 2024,
        quality,
        qualityNote: populationChangeSource === "tract"
          ? "Block group population totals were zero; tract-level weighting used."
          : isLowPopulation
          ? "Very low population in walkshed; percent change may be unstable."
          : quality === "MEDIUM"
          ? "Partial block group coverage in walkshed."
          : undefined,
        evidenceMeta,
      });
      updated += 1;
    }

    if (vehiclePct !== null && acsSource) {
      await upsertFact({
        stationId: station.id,
        factKey: "vehicle_ownership_pct",
        value: vehiclePct,
        valueType: "percent",
        unit: "%",
        geography: "walkshed_0.5mi",
        sourceId: acsSource.id,
        methodology:
          "Area-weighted tract totals within 0.5mi walkshed (ACS 2020-2024 B08201).",
        timeframeStart: 2020,
        timeframeEnd: 2024,
        quality: "MEDIUM",
        qualityNote:
          "Vehicle ownership tables are not available at block group level; tract-level weighting used.",
        evidenceMeta: vehicleEvidenceMeta,
      });
      updated += 1;
    }

    processed += 1;
  }

  if (decennialSource) {
    await prisma.dataSource.update({
      where: { id: decennialSource.id },
      data: {
        lastFetched: now,
        lastSuccessfulFetch: errors.length === 0 ? now : decennialSource.lastSuccessfulFetch,
        status: errors.length === 0 ? "ACTIVE" : "ERROR",
        lastError: errors.length === 0 ? null : errors.join("; "),
      },
    });
  }

  if (acsSource) {
    await prisma.dataSource.update({
      where: { id: acsSource.id },
      data: {
        lastFetched: now,
        lastSuccessfulFetch: errors.length === 0 ? now : acsSource.lastSuccessfulFetch,
        status: errors.length === 0 ? "ACTIVE" : "ERROR",
        lastError: errors.length === 0 ? null : errors.join("; "),
      },
    });
  }

  if (processed === 0) {
    warnings.push(
      `No stations processed (missing inputs: ${missingInputs}, bg2010: ${blockGroups2010.length}, bg2020: ${blockGroups2020.length}, decennial: ${decennialValues.size}, acsPop: ${acsPopulationValues.size}, acsVehicles: ${acsVehicleValues.size}).`
    );
  }

  return {
    sourceCode: "census_acs_5yr",
    inserted: 0,
    updated,
    skipped,
    warnings,
    errors,
  };
}
