import { PrismaClient as SqliteClient } from '@prisma/client'
import { PrismaClient as PostgresClient } from '@prisma/client'

// Script to migrate data from SQLite to PostgreSQL
// Usage: DATABASE_URL_SQLITE=file:./prisma/dev.db DATABASE_URL=postgresql://... npm run migrate:data

async function migrate() {
  const sqliteUrl = process.env.DATABASE_URL_SQLITE || 'file:./prisma/dev.db'
  const postgresUrl = process.env.DATABASE_URL

  if (!postgresUrl) {
    console.error('❌ DATABASE_URL environment variable required')
    process.exit(1)
  }

  console.log('🚀 Starting migration from SQLite to PostgreSQL...')

  // Initialize clients
  const sqlite = new SqliteClient({
    datasources: { db: { url: sqliteUrl } }
  })

  const postgres = new PostgresClient({
    datasources: { db: { url: postgresUrl } }
  })

  try {
    // 1. Migrate Cities
    console.log('📍 Migrating cities...')
    const cities = await sqlite.city.findMany()
    for (const city of cities) {
      await postgres.city.upsert({
        where: { code: city.code },
        create: city,
        update: city,
      })
    }
    console.log(`✅ Migrated ${cities.length} cities`)

    // 2. Migrate Stations
    console.log('🚉 Migrating stations...')
    const stations = await sqlite.station.findMany()
    for (const station of stations) {
      await postgres.station.upsert({
        where: { id: station.id },
        create: {
          ...station,
          lines: JSON.parse(station.lines as string), // Convert string to JSON
        },
        update: {
          ...station,
          lines: JSON.parse(station.lines as string),
        },
      })
    }
    console.log(`✅ Migrated ${stations.length} stations`)

    // 3. Migrate Station Aliases
    console.log('🏷️  Migrating station aliases...')
    const aliases = await sqlite.stationAlias.findMany()
    for (const alias of aliases) {
      await postgres.stationAlias.upsert({
        where: {
          stationId_aliasName: {
            stationId: alias.stationId,
            aliasName: alias.aliasName
          }
        },
        create: alias,
        update: alias,
      })
    }
    console.log(`✅ Migrated ${aliases.length} aliases`)

    // 4. Migrate Station Metrics
    console.log('📊 Migrating station metrics...')
    const metrics = await sqlite.stationMetrics.findMany()
    for (const metric of metrics) {
      await postgres.stationMetrics.upsert({
        where: { stationId: metric.stationId },
        create: metric,
        update: metric,
      })
    }
    console.log(`✅ Migrated ${metrics.length} station metrics`)

    // 5. Migrate Ridership Data (last 90 days for performance)
    console.log('📈 Migrating ridership data (last 90 days)...')
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    const ridership = await sqlite.ridershipDaily.findMany({
      where: {
        serviceDate: {
          gte: ninetyDaysAgo
        }
      },
      orderBy: {
        serviceDate: 'desc'
      }
    })

    // Batch insert for performance
    const batchSize = 1000
    for (let i = 0; i < ridership.length; i += batchSize) {
      const batch = ridership.slice(i, i + batchSize)
      await postgres.ridershipDaily.createMany({
        data: batch,
        skipDuplicates: true,
      })
      console.log(`  Processed ${Math.min(i + batchSize, ridership.length)}/${ridership.length} ridership records`)
    }
    console.log(`✅ Migrated ${ridership.length} ridership records`)

    // 6. Migrate Data Sources
    console.log('📚 Migrating data sources...')
    const sources = await sqlite.dataSource.findMany()
    for (const source of sources) {
      await postgres.dataSource.upsert({
        where: { code: source.code },
        create: source,
        update: source,
      })
    }
    console.log(`✅ Migrated ${sources.length} data sources`)

    // 7. Migrate Station Facts
    console.log('📝 Migrating station facts...')
    const facts = await sqlite.stationFact.findMany()
    for (const fact of facts) {
      await postgres.stationFact.upsert({
        where: {
          stationId_factKey: {
            stationId: fact.stationId,
            factKey: fact.factKey
          }
        },
        create: {
          ...fact,
          evidenceMeta: fact.evidenceMeta ? JSON.parse(fact.evidenceMeta as string) : null,
        },
        update: {
          ...fact,
          evidenceMeta: fact.evidenceMeta ? JSON.parse(fact.evidenceMeta as string) : null,
        },
      })
    }
    console.log(`✅ Migrated ${facts.length} facts`)

    // 8. Migrate Station Narratives
    console.log('📖 Migrating station narratives...')
    const narratives = await sqlite.stationNarrative.findMany()
    for (const narrative of narratives) {
      await postgres.stationNarrative.upsert({
        where: { stationId: narrative.stationId },
        create: {
          ...narrative,
          evidenceFactKeys: JSON.parse(narrative.evidenceFactKeys as string),
          evidenceMeta: narrative.evidenceMeta ? JSON.parse(narrative.evidenceMeta as string) : null,
        },
        update: {
          ...narrative,
          evidenceFactKeys: JSON.parse(narrative.evidenceFactKeys as string),
          evidenceMeta: narrative.evidenceMeta ? JSON.parse(narrative.evidenceMeta as string) : null,
        },
      })
    }
    console.log(`✅ Migrated ${narratives.length} narratives`)

    console.log('🎉 Migration completed successfully!')

  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await sqlite.$disconnect()
    await postgres.$disconnect()
  }
}

// Run migration
migrate().catch((e) => {
  console.error(e)
  process.exit(1)
})