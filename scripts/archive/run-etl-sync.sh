#!/bin/bash

# Script to run the ETL sync process with proper environment variables

# Check if SOCRATA_TOKEN is set
if [ -z "$SOCRATA_TOKEN" ]; then
    echo "Error: SOCRATA_TOKEN environment variable is not set"
    echo "Please set it with: export SOCRATA_TOKEN=your_token_here"
    exit 1
fi

# Export as CHICAGO_DATA_APP_TOKEN which is what the ETL expects
export CHICAGO_DATA_APP_TOKEN=$SOCRATA_TOKEN

echo "Running ETL sync process..."
echo

# 1. Populate station aliases
echo "Step 1: Populating station aliases..."
cd go-etl
go run scripts/populate_station_aliases.go ../prisma/dev.db
echo

# 2. Sync ridership data
echo "Step 2: Syncing ridership data..."
go run ./cmd/go-etl sync-ridership --city=chicago
echo

# 3. Compute ghost scores
echo "Step 3: Computing ghost scores..."
go run ./cmd/go-etl compute --city=chicago
echo

echo "✅ ETL sync complete!"
echo
echo "You can verify the results with:"
echo "sqlite3 ../prisma/dev.db < ../scripts/verify-ridership-mapping.sql"