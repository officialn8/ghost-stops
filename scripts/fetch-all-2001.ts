import { PrismaClient } from '@prisma/client';
import { SOCRATA_2001_NAMES } from '../src/lib/cta/socrata2001Names';

// One-off backfill of the ridership_2001_avg station fact from the CTA Socrata dataset.
// Reads the database connection from DATABASE_URL; never hardcode a connection string.
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Export it before running this script.');
  process.exit(1);
}

const prisma = new PrismaClient();

const SOCRATA_BASE = 'https://data.cityofchicago.org/resource/5neh-572f.json';

async function fetchAll2001Data() {
  console.log('📊 Fetching ALL 2001 ridership data...\n');

  const source = await prisma.dataSource.findUnique({ where: { code: 'cta_socrata' } });
  if (!source) {
    console.error('❌ cta_socrata source not found');
    return;
  }

  const stations = await prisma.station.findMany({
    where: { city: { code: 'chicago' } }
  });

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const station of stations) {
    const ctaName = SOCRATA_2001_NAMES[station.name];
    
    if (!ctaName) {
      console.log(`  ⚠️ ${station.name}: No mapping`);
      skipped++;
      continue;
    }

    try {
      const url = `${SOCRATA_BASE}?$select=stationname,date,rides&$where=date between '2001-01-01T00:00:00' and '2001-12-31T23:59:59' AND stationname = '${ctaName}'&$limit=400`;
      
      const response = await fetch(url);
      if (!response.ok) {
        console.log(`  ⚠️ ${station.name}: API error ${response.status}`);
        errors++;
        continue;
      }

      const data = await response.json();
      if (data.length === 0) {
        console.log(`  ⚠️ ${station.name}: No 2001 data`);
        skipped++;
        continue;
      }

      const totalRides = data.reduce((sum: number, row: any) => sum + parseInt(row.rides || 0), 0);
      const avgDaily = Math.round(totalRides / data.length);

      await prisma.stationFact.upsert({
        where: {
          stationId_factKey: {
            stationId: station.id,
            factKey: 'ridership_2001_avg'
          }
        },
        create: {
          stationId: station.id,
          factKey: 'ridership_2001_avg',
          value: avgDaily,
          valueType: 'number',
          unit: 'riders/day',
          geography: 'station',
          timeframeStart: 2001,
          timeframeEnd: 2001,
          methodology: 'Daily average from CTA Socrata ridership entries for calendar year 2001',
          sourceId: source.id,
          quality: 'HIGH',
          qualityNote: 'Official CTA ridership data from data.cityofchicago.org',
          evidenceMeta: { source: 'cta_socrata', count: data.length }
        },
        update: {
          value: avgDaily,
          quality: 'HIGH',
          qualityNote: 'Official CTA ridership data from data.cityofchicago.org',
          evidenceMeta: { source: 'cta_socrata', count: data.length }
        }
      });

      console.log(`  ✓ ${station.name}: ${avgDaily.toLocaleString()} riders/day`);
      updated++;

      await new Promise(r => setTimeout(r, 50));

    } catch (err) {
      console.log(`  ✗ ${station.name}: ${err}`);
      errors++;
    }
  }

  console.log(`\n✅ Updated ${updated} stations`);
  console.log(`⚠️ Skipped ${skipped} stations`);
  if (errors > 0) console.log(`✗ ${errors} errors`);

  await prisma.$disconnect();
}

fetchAll2001Data().catch(console.error);