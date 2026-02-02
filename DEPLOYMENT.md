# Ghost Stops Deployment Guide

This guide covers deploying Ghost Stops to production using Vercel (frontend) and Railway (Go ETL pipeline).

## Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   Vercel        │         │   Railway       │
│   (Next.js)     │◄────────┤   (Go ETL)      │
│   - Frontend    │  DB     │   - Daily sync  │
│   - API routes  │         │   - Ghost scores│
└────────┬────────┘         └─────────────────┘
         │
    ┌────┴────┐
    │ PostgreSQL │  (Vercel Postgres or Neon)
    │  (shared)  │
    └────────────┘
```

## Prerequisites

- [Vercel CLI](https://vercel.com/cli) installed
- [Railway CLI](https://docs.railway.app/reference/cli) installed
- PostgreSQL database (Vercel Postgres, Neon, or Railway)
- Mapbox API token

## Step 1: Database Setup

### Option A: Vercel Postgres (Recommended)
```bash
# Install Vercel CLI
npm i -g vercel

# Create Vercel Postgres database
vercel postgres create ghost-stops-db
```

### Option B: Neon PostgreSQL
1. Sign up at [neon.tech](https://neon.tech)
2. Create a new database
3. Copy the connection string

### Migrate Database Schema

1. Update Prisma to use PostgreSQL:
```bash
# Use the PostgreSQL schema
cp prisma/schema.postgres.prisma prisma/schema.prisma
```

2. Update your `.env` with the PostgreSQL connection string:
```env
DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"
```

3. Run migrations:
```bash
npx prisma migrate dev --name init_postgres
npx prisma generate
```

## Step 2: Export Local Data

If you have existing data in SQLite:

```bash
# Export stations and metrics
sqlite3 prisma/dev.db <<EOF
.headers on
.mode csv
.output stations.csv
SELECT * FROM Station;
.output metrics.csv
SELECT * FROM StationMetrics;
.output ridership.csv
SELECT * FROM RidershipDaily ORDER BY serviceDate DESC LIMIT 10000;
.quit
EOF
```

## Step 3: Deploy Frontend to Vercel

1. Install dependencies:
```bash
npm install
```

2. Deploy to Vercel:
```bash
vercel --prod
```

3. Add environment variables in Vercel dashboard:
   - `DATABASE_URL`: Your PostgreSQL connection string
   - `NEXT_PUBLIC_MAPBOX_TOKEN`: Your Mapbox token

4. Configure domain (optional):
```bash
vercel domains add your-domain.com
```

## Step 4: Deploy Go ETL to Railway

1. Navigate to ETL directory:
```bash
cd go-etl
```

2. Initialize Railway project:
```bash
railway login
railway init
```

3. Deploy:
```bash
railway up
```

4. Set environment variables:
```bash
railway variables set DATABASE_URL="your-postgres-url"
railway variables set CHICAGO_DATA_APP_TOKEN="your-token" # Optional
```

5. Verify deployment:
```bash
railway logs
```

## Step 5: Initial Data Load

### Import Existing Data

If you exported data from SQLite:

```bash
# Connect to PostgreSQL and import CSVs
psql $DATABASE_URL

# Import stations
\copy "Station" FROM 'stations.csv' CSV HEADER;

# Import metrics
\copy "StationMetrics" FROM 'metrics.csv' CSV HEADER;

# Import ridership
\copy "RidershipDaily" FROM 'ridership.csv' CSV HEADER;
```

### Or Fetch Fresh Data

Run the ETL manually:

```bash
railway run ./etl sync-ridership --city chicago --days 365
railway run ./etl compute --city chicago
```

## Step 6: Verify Deployment

1. Check frontend:
   - Visit your Vercel URL
   - Verify map loads
   - Check station list populates
   - Test station details

2. Check ETL:
   - View Railway logs: `railway logs`
   - Verify cron schedules are set
   - Check database for recent data

## Environment Variables Reference

### Vercel (Frontend)
- `DATABASE_URL`: PostgreSQL connection string
- `NEXT_PUBLIC_MAPBOX_TOKEN`: Mapbox GL JS token

### Railway (Go ETL)
- `DATABASE_URL`: Same PostgreSQL connection string
- `CHICAGO_DATA_APP_TOKEN`: Optional Socrata API token for higher rate limits

## Monitoring

### Frontend (Vercel)
- View logs: `vercel logs`
- Analytics: Vercel dashboard
- Errors: Vercel Functions tab

### ETL (Railway)
- View logs: `railway logs`
- Metrics: Railway dashboard
- Cron status: Railway deployments tab

## Troubleshooting

### Database Connection Issues
```bash
# Test connection
psql $DATABASE_URL -c "SELECT COUNT(*) FROM \"Station\";"
```

### ETL Not Running
```bash
# Run manually to debug
railway run ./etl sync-ridership --city chicago --days 1
```

### Missing Data
```bash
# Check latest ridership date
psql $DATABASE_URL -c "SELECT MAX(\"serviceDate\") FROM \"RidershipDaily\";"
```

## Production Checklist

- [ ] PostgreSQL database created and accessible
- [ ] Prisma schema migrated to PostgreSQL
- [ ] Environment variables set in Vercel
- [ ] Environment variables set in Railway
- [ ] Frontend deployed and accessible
- [ ] ETL deployed and running
- [ ] Cron jobs scheduled correctly
- [ ] Initial data loaded
- [ ] Map displays correctly
- [ ] Station data loading
- [ ] Custom domain configured (optional)

## Cost Estimates

- **Vercel**: Free tier covers most use cases
  - Pro ($20/mo) for team features
- **Railway**: $5/mo for hobby tier
  - Includes cron jobs
- **Database**:
  - Vercel Postgres: Free tier (60 hours compute)
  - Neon: Free tier (0.5GB storage)
  - Railway Postgres: ~$5-10/mo

Total: ~$5-10/month for a production deployment