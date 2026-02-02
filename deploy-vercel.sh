#!/bin/bash

# Ghost Stops Vercel Deployment Script

echo "🚀 Ghost Stops Vercel Deployment"
echo "================================"

# Check for required tools
command -v npx vercel >/dev/null 2>&1 || { echo "❌ Vercel CLI not found. Install with: npm i -g vercel"; exit 1; }

# Check for environment variables
if [ -z "$NEXT_PUBLIC_MAPBOX_TOKEN" ]; then
    echo "❌ NEXT_PUBLIC_MAPBOX_TOKEN not set"
    echo "   Get a token at: https://www.mapbox.com/"
    exit 1
fi

echo "✅ Prerequisites checked"
echo ""

# Step 1: Database setup
echo "📊 Database Setup"
echo "-----------------"
echo "Choose your database option:"
echo "1) Vercel Postgres (recommended)"
echo "2) Neon PostgreSQL"
echo "3) I already have a PostgreSQL database"
read -p "Enter choice (1-3): " db_choice

case $db_choice in
    1)
        echo "Creating Vercel Postgres database..."
        vercel postgres create ghost-stops-db
        echo "✅ Database created. Connection string will be automatically available in Vercel."
        ;;
    2)
        echo "Please create a database at https://neon.tech and enter the connection string:"
        read -p "DATABASE_URL: " DATABASE_URL
        ;;
    3)
        read -p "Enter your PostgreSQL connection string: " DATABASE_URL
        ;;
esac

echo ""

# Step 2: Prepare for deployment
echo "🔧 Preparing for deployment..."
cp prisma/schema.postgres.prisma prisma/schema.prisma
echo "✅ Updated Prisma schema for PostgreSQL"

# Step 3: Deploy to Vercel
echo ""
echo "🚀 Deploying to Vercel..."
vercel --prod

echo ""
echo "🎉 Deployment initiated!"
echo ""
echo "Next steps:"
echo "1. Go to your Vercel dashboard to set environment variables:"
echo "   - DATABASE_URL (if using option 2 or 3)"
echo "   - NEXT_PUBLIC_MAPBOX_TOKEN"
echo ""
echo "2. Run database migrations:"
echo "   vercel env pull .env.production.local"
echo "   npx prisma migrate deploy"
echo ""
echo "3. Deploy the Go ETL pipeline (see DEPLOYMENT.md)"
echo ""
echo "For detailed instructions, see DEPLOYMENT.md"