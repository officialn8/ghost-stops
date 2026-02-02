import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://neondb_owner:npg_gJZsFdam0HM1@ep-purple-bread-ae5a0gwi-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
    }
  }
});

// Additional mappings for stations that didn't match
const additionalMappings: Record<string, string> = {
  'Noyes': 'Noyes',
  'Foster': 'Foster',
  'Davis': 'Davis',
  'Main': 'Main',
  'Linden': 'Linden',
  'Dempster': 'Dempster',
  'Clark/Division': 'Clark/Division',
  'Ridgeland': 'Ridgeland',
  'Laramie': 'Laramie',
  'Rockwell': 'Rockwell',
  'Francisco': 'Francisco',
  'Kimball': 'Kimball',
  'Kostner': 'Kostner',
  'Central Park': 'Central Park',
  'Lawrence': 'Lawrence',
  'Jarvis': 'Jarvis',
  'Morse': 'Morse',
  'Loyola': 'Loyola',
  'Granville': 'Granville',
  'Thorndale': 'Thorndale',
  'Bryn Mawr': 'Bryn Mawr',
  'Berwyn': 'Berwyn',
  'Argyle': 'Argyle',
  'Sheridan': 'Sheridan',
  'Roosevelt': 'Roosevelt',
  'Washington/Wells': 'Washington/Wells',
  'Adams/Wabash': 'Adams/Wabash',
  'Library': 'Library',
  'Quincy': 'Quincy',
  'LaSalle/Van Buren': 'LaSalle/Van Buren',
  'Monroe (Blue)': 'Monroe-Dearborn',
  'Monroe (Red)': 'Monroe/State',
  'Division (Blue)': 'Division/Milwaukee',
  'Division (Red)': 'Division/State',
  'Cermak-Chinatown': 'Cermak-Chinatown',
  'Racine': 'Racine',
  'LaSalle': 'LaSalle',
  'Fullerton': 'Fullerton',
  'Wilson': 'Wilson',
  'Belmont (Blue)': 'Belmont-O\'Hare',
  'Belmont (Red/Brown/Purple)': 'Belmont-North Main',
  'Indiana': 'Indiana',
  '18th': '18th',
  'Polk': 'Polk',
  '47th (Red)': '47th-Dan Ryan',
  '47th (Green)': '47th-South Elevated',
  '51st': '51st',
  '63rd': '63rd-Dan Ryan',
  '69th': '69th',
  '79th': '79th',
  '87th': '87th',
  '95th/Dan Ryan': '95th/Dan Ryan',
  'Sox-35th': 'Sox-35th',
  '35-Bronzeville-IIT': '35-Bronzeville-IIT',
  '54th/Cermak': '54th/Cermak',
  '35th/Archer': '35th/Archer',
  'Harrison': 'Harrison',
  'Cottage Grove': 'East 63rd-Cottage Grove',
  'Ashland/63rd': 'Ashland/63rd',
  'King Drive': 'King Drive',
  'Conservatory-Central Park Drive': 'Conservatory',
  'Jefferson Park Transit Center': 'Jefferson Park',
  'Forest Park': 'Forest Park',
  'Cumberland': 'Cumberland',
  'Rosemont': 'Rosemont',
  "O'Hare": "O'Hare",
  'Midway': 'Midway',
  'Dempster-Skokie': 'Dempster',
  'UIC-Halsted': 'UIC-Halsted',
  'Logan Square': 'Logan Square',
  'Irving Park (Blue)': 'Irving Park-O\'Hare',
  'Irving Park (Brown)': 'Irving Park-Brown',
  'Addison (Blue)': 'Addison-O\'Hare',
  'Addison (Red)': 'Addison-North Main',
  'Addison (Brown)': 'Addison-Brown',
  'Montrose (Blue)': 'Montrose-O\'Hare',
  'Montrose (Brown)': 'Montrose-Brown',
  'California (Pink)': 'California/Milwaukee',
  'California (Blue)': 'California-Lake',
  'California (Green)': 'California-Cermak',
  'Morgan (Green/Pink)': 'Morgan-Lake',
  'Damen (Pink)': 'Damen-Pink',
  'Western (Pink)': 'Western-Cermak',
  'Illinois Medical District': 'Medical Center',
  'Oak Park (Blue)': 'Oak Park-Forest Park',
  'Oak Park (Green)': 'Oak Park-Lake',
  'Washington (Blue)': 'Washington/Dearborn',
  'Washington (Red)': 'Washington/State',
  'Chicago (Blue)': 'Chicago/Milwaukee',
  'Chicago (Red)': 'Chicago/State',
  'Chicago (Brown/Purple)': 'Chicago/Franklin',
  'Grand (Blue)': 'Grand/Milwaukee',
  'Grand (Red)': 'Grand/State',
  'Lake (Subway)': 'Lake/State',
  'Jackson (Blue)': 'Jackson/Dearborn',
  'Jackson (Red)': 'Jackson/State',
  'Cermak-McCormick Place': 'Cermak-Chinatown',
  'Sedgwick (Brown/Purple)': 'Sedgwick',
  'Armitage (Brown/Purple)': 'Armitage',
  'Wellington (Brown/Purple)': 'Wellington',
  'Southport': 'Southport',
  'Paulina': 'Paulina',
  'Merchandise Mart (Brown/Purple)': 'Merchandise Mart',
  'Washington/Wabash': 'Madison/Wabash',
  '35th-Bronzeville-IIT': '35-Bronzeville-IIT',
  'Harold Washington Library-State/Van Buren': 'Library',
  'Kedzie-Homan': 'Kedzie-Homan-Forest Park',
};

const SOCRATA_BASE = 'https://data.cityofchicago.org/resource/5neh-572f.json';

async function fetchMissing2001Data() {
  console.log('📊 Fetching missing 2001 ridership data...\n');

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

  for (const station of stations) {
    // Check if already has 2001 data
    const existingFact = await prisma.stationFact.findUnique({
      where: {
        stationId_factKey: {
          stationId: station.id,
          factKey: 'ridership_2001_avg'
        }
      }
    });

    if (existingFact && existingFact.quality === 'HIGH') {
      continue; // Already has real data
    }

    const ctaName = additionalMappings[station.name];
    if (!ctaName) {
      console.log(`  ⚠️ ${station.name}: No mapping`);
      skipped++;
      continue;
    }

    try {
      const url = `${SOCRATA_BASE}?$select=stationname,date,rides&$where=date between '2001-01-01T00:00:00' and '2001-12-31T23:59:59' AND stationname = '${ctaName}'&$limit=400`;
      
      const response = await fetch(url);
      if (!response.ok) continue;

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
    }
  }

  console.log(`\n✅ Updated ${updated} additional stations`);
  console.log(`⚠️ Skipped ${skipped} stations`);

  await prisma.$disconnect();
}

fetchMissing2001Data().catch(console.error);