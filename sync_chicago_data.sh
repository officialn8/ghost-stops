#!/bin/bash
# Sync Chicago CTA ridership data

echo "Starting Chicago ridership sync..."

# Set environment variables
export CHICAGO_DATA_APP_TOKEN="wFGo1rspxy4bY15XLIr6Wjl2U"
export DATABASE_URL="./prisma/dev.db"

# Run sync for the last 30 days
./go-etl/go-etl sync-ridership --city=chicago --since="2025-12-20" --limit=5000

# Recompute ghost scores
echo "Recomputing ghost scores..."
./go-etl/go-etl compute --city=chicago

echo "Sync complete!"