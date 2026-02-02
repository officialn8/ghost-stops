import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://neondb_owner:npg_gJZsFdam0HM1@ep-purple-bread-ae5a0gwi-pooler.c-2.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
    }
  }
});

// Complete mapping from our station names to CTA 2001 names
const nameMapping: Record<string, string> = {
  'Austin (Blue)': 'Austin-Forest Park',
  'Austin (Green)': 'Austin-Lake',
  'Harlem (Blue - Forest Park Branch)': 'Harlem-Forest Park',
  'Harlem (Blue - O\'Hare Branch)': 'Harlem-O\'Hare',
  'Harlem/Lake': 'Harlem-Lake',
  'Halsted (Green)': 'Halsted/63rd',
  'Halsted (Orange)': 'Halsted-Orange',
  'Pulaski (Blue)': 'Pulaski-Forest Park',
  'Pulaski (Green)': 'Pulaski-Lake',
  'Pulaski (Orange)': 'Pulaski-Orange',
  'Pulaski (Pink)': 'Pulaski-Cermak',
  'Western (Blue - O\'Hare Branch)': 'Western-O\'Hare',
  'Western (Blue - Forest Park Branch)': 'Western-Forest Park',
  'Western (Orange)': 'Western-Orange',
  'Western (Brown)': 'Western-Brown',
  'Western (Pink)': 'Western-Cermak',
  'California (Green)': 'California-Cermak',
  'California (Blue)': 'California-Lake',
  'California (Pink)': 'California/Milwaukee',
  'Cicero (Blue)': 'Cicero-Forest Park',
  'Cicero (Green)': 'Cicero-Lake',
  'Cicero (Pink)': 'Cicero-Cermak',
  'Kedzie (Green)': 'Kedzie-Lake',
  'Kedzie (Brown)': 'Kedzie-Brown',
  'Kedzie (Orange)': 'Kedzie-Midway',
  'Kedzie (Pink)': 'Kedzie-Cermak',
  'Damen (Blue)': 'Damen/Milwaukee',
  'Damen (Green)': 'Damen-Cermak',
  'Damen (Brown)': 'Damen-Brown',
  'Damen (Pink)': 'Damen-Pink',
  'Jackson (Blue)': 'Jackson/Dearborn',
  'Jackson (Red)': 'Jackson/State',
  'Clinton (Blue)': 'Clinton-Forest Park',
  'Clinton (Green)': 'Clinton-Lake',
  'Grand (Blue)': 'Grand/Milwaukee',
  'Grand (Red)': 'Grand/State',
  'Chicago (Blue)': 'Chicago/Milwaukee',
  'Chicago (Red)': 'Chicago/State',
  'Chicago (Brown)': 'Chicago/Franklin',
  'Lake (Subway)': 'Lake/State',
  'Monroe (Blue)': 'Monroe-Dearborn',
  'Monroe (Red)': 'Monroe/State',
  'Division (Blue)': 'Division/Milwaukee',
  'Division (Red)': 'Division/State',
  'Argyle (Red)': 'Argyle',
  'Berwyn (Red)': 'Berwyn',
  'Bryn Mawr (Red)': 'Bryn Mawr',
  'Thorndale (Red)': 'Thorndale',
  'Granville (Red)': 'Granville',
  'Loyola (Red)': 'Loyola',
  'Morse (Red)': 'Morse',
  'Jarvis (Red)': 'Jarvis',
  'Howard (Red/Purple/Yellow)': 'Howard',
  'Wilson (Red/Purple)': 'Wilson',
  'Belmont (Red/Brown/Purple)': 'Belmont-North Main',
  'Belmont (Blue)': 'Belmont-O\'Hare',
  'Fullerton (Red/Brown/Purple)': 'Fullerton',
  'Sedgwick (Brown/Purple)': 'Sedgwick',
  'Chicago (Brown/Purple)': 'Chicago/Franklin',
  'Merchandise Mart (Brown/Purple)': 'Merchandise Mart',
  'Washington (Blue)': 'Washington/Dearborn',
  'Washington (Red)': 'Washington/State',
  'Harrison (Red)': 'Harrison',
  'Jackson (Red)': 'Jackson/State',
  '35th-Bronzeville-IIT (Green)': '35-Bronzeville-IIT',
  'Sox-35th (Red)': 'Sox-35th',
  '47th (Green)': '47th-South Elevated',
  '47th (Red)': '47th-Dan Ryan',
  '63rd (Red)': '63rd-Dan Ryan',
  '69th (Red)': '69th',
  '79th (Red)': '79th',
  '87th (Red)': '87th',
  '95th/Dan Ryan (Red)': '95th/Dan Ryan',
  'Garfield (Green)': 'Garfield-South Elevated',
  'Garfield (Red)': 'Garfield-Dan Ryan',
  'King Drive (Green)': 'King Drive',
  'Cottage Grove (Green)': 'East 63rd-Cottage Grove',
  'Ashland/63rd (Green)': 'Ashland/63rd',
  'Indiana (Red)': 'Indiana',
  '43rd (Green)': '43rd',
  '51st (Green)': '51st',
  'Kedzie-Homan (Blue)': 'Kedzie-Homan-Forest Park',
  'Central (Green)': 'Central-Lake',
  'Central (Purple)': 'Central-Evanston',
  'Ridgeland (Green)': 'Ridgeland',
  'Laramie (Green)': 'Laramie',
  'Conservatory-Central Park Drive (Green)': 'Conservatory',
  'Ashland (Green/Pink)': 'Ashland-Lake',
  'Morgan (Green/Pink)': 'Morgan-Lake',
  'Clinton (Green/Pink)': 'Clinton-Lake',
  'Clark/Lake (Blue/Brown/Green/Orange/Purple/Pink)': 'Clark/Lake',
  'Washington/Wells (Brown/Orange/Purple/Pink)': 'Washington/Wells',
  'Quincy (Brown/Orange/Purple/Pink)': 'Quincy',
  'LaSalle/Van Buren (Brown/Orange/Purple/Pink)': 'LaSalle/Van Buren',
  'LaSalle (Blue)': 'LaSalle',
  'Racine (Blue)': 'Racine',
  'Illinois Medical District (Blue)': 'Medical Center',
  'Forest Park (Blue)': 'Forest Park',
  'Cumberland (Blue)': 'Cumberland',
  'Rosemont (Blue)': 'Rosemont',
  'Jefferson Park Transit Center (Blue)': 'Jefferson Park',
  "O'Hare (Blue)": "O'Hare",
  'Midway (Orange)': 'Midway',
  '35th/Archer (Orange)': '35th/Archer',
  'Ashland (Orange)': 'Ashland-Orange',
  'Kostner (Pink)': 'Kostner',
  'Central (Pink)': 'Central-Cermak',
  '18th (Pink)': '18th',
  'Polk (Pink)': 'Polk',
  'Ashland (Pink)': 'Ashland-Cermak',
  'Central Park (Green)': 'Central Park',
  'Roosevelt (Red/Orange/Green)': 'Roosevelt',
  'Cermak-Chinatown (Red)': 'Cermak-Chinatown',
  'Kimball (Brown)': 'Kimball',
  'Francisco (Brown)': 'Francisco',
  'Rockwell (Brown)': 'Rockwell',
  'Paulina (Brown)': 'Paulina',
  'Southport (Brown)': 'Southport',
  'Wellington (Brown/Purple)': 'Wellington',
  'Armitage (Brown/Purple)': 'Armitage',
  'Adams/Wabash (Brown/Green/Orange/Pink/Purple)': 'Adams/Wabash',
  'Library (Red)': 'Library',
  'Washington/State (Red)': 'Washington/State',
  'Monroe/State (Red)': 'Monroe/State',
  'Jackson/State (Red)': 'Jackson/State',
  'Dempster (Purple)': 'Dempster',
  'Davis (Purple)': 'Davis',
  'Main (Purple)': 'Main',
  'Linden (Purple)': 'Linden',
  'Foster (Purple)': 'Foster',
  'Noyes (Purple)': 'Noyes',
  'Diversey (Brown/Purple)': 'Diversey',
  'Logan Square (Blue)': 'Logan Square',
  'UIC-Halsted (Blue)': 'UIC-Halsted',
  '54th/Cermak (Pink)': '54th/Cermak',
  'Irving Park (Brown)': 'Irving Park-Brown',
  'Addison (Brown)': 'Addison-Brown',
  'Addison (Red)': 'Addison-North Main',
  'Addison (Blue)': 'Addison-O\'Hare',
  'Irving Park (Blue)': 'Irving Park-O\'Hare',
  'Lawrence (Red)': 'Lawrence',
  'Sheridan (Red)': 'Sheridan',
  'North/Clybourn (Red)': 'North/Clybourn',
  'Chicago/State (Red)': 'Chicago/State',
  'Grand/State (Red)': 'Grand/State',
  'Lake/State (Red)': 'Lake/State',
  'Monroe/State (Red)': 'Monroe/State',
  'Jackson/State (Red)': 'Jackson/State',
  'Harrison (Red)': 'Harrison',
  'Sox-35th (Red)': 'Sox-35th',
  '47th-Dan Ryan (Red)': '47th-Dan Ryan',
  '63rd-Dan Ryan (Red)': '63rd-Dan Ryan',
  '69th (Red)': '69th',
  '79th (Red)': '79th',
  '87th (Red)': '87th',
  '95th/Dan Ryan (Red)': '95th/Dan Ryan',
};

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
    const ctaName = nameMapping[station.name];
    
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