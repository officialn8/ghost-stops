#!/bin/bash
# Manually sync critical stations

echo "Manually syncing critical Chicago CTA stations..."
echo "=============================================="

# Function to sync a station
sync_station() {
    local station_id=$1
    local station_name=$2
    local our_id=$3

    echo ""
    echo "Syncing $station_name..."

    # Fetch November data
    curl -s -H "X-App-Token: wFGo1rspxy4bY15XLIr6Wjl2U" \
        "https://data.cityofchicago.org/resource/5neh-572f.json?\$where=station_id='${station_id}'%20AND%20date%20%3E%3D%20'2025-11-01'%20AND%20date%20%3C%3D%20'2025-11-30'&\$limit=100" | \
    jq -r --arg sid "$our_id" --arg sname "$station_name" '
    .[] |
    "INSERT OR REPLACE INTO RidershipDaily (id, stationId, serviceDate, entries) VALUES (" +
    "\"" + (.station_id + "-" + .date[0:10] + "-" + $sid[0:8]) + "\", " +
    "\"" + $sid + "\", " +
    "\"" + .date[0:10] + " 00:00:00\", " +
    .rides + ");"' > /tmp/sync_${station_id}.sql

    # Count the inserts
    local count=$(wc -l < /tmp/sync_${station_id}.sql | tr -d ' ')
    echo "  Generated $count insert statements"

    # Execute the SQL
    if [ "$count" -gt 0 ]; then
        sqlite3 prisma/dev.db < /tmp/sync_${station_id}.sql
        echo "  Inserted successfully"
    fi

    rm -f /tmp/sync_${station_id}.sql
}

# Sync the critical stations
sync_station "40890" "O'Hare Airport" "5cab956320ed9c05474044fb960a87d9"
sync_station "40930" "Midway Airport" "df19d99efac023bfd0e7e87106692777"
sync_station "40450" "95th/Dan Ryan" "cb98f3dd10953552c2c7086c888a2e41"
sync_station "41090" "Monroe/State" "079a1746db130de63cf5d80101770506"
sync_station "40790" "Monroe/Dearborn" "7214e442e5e12a6187581e1b6ceeeda7"

# Also sync some other important stations
sync_station "41300" "Jackson/State" "5d19a1c6b4c72a1c5a8eb039e6cf9d5a"
sync_station "40380" "Clark/Lake" "414c037ca453b435db22cf430557736e"
sync_station "40320" "Clark/Division" "c59b25a8bc73871302fdc95b80c65c3c"
sync_station "40370" "Chicago/State" "b4e1fd1f7b63e8b0e86508fa63c12e6e"

echo ""
echo "Verifying results..."
echo "==================="

sqlite3 prisma/dev.db << 'EOF'
.headers on
.mode column
.width 25 15 20
SELECT
    s.name,
    COUNT(rd.id) as records,
    MAX(rd.serviceDate) as latest_date,
    SUM(rd.entries) as total_ridership
FROM Station s
LEFT JOIN RidershipDaily rd ON rd.stationId = s.id
WHERE s.name IN ('O''Hare', 'Midway', '95th/Dan Ryan', 'Monroe (Red)', 'Monroe (Blue)',
                 'Jackson (Red)', 'Clark/Lake', 'Clark/Division', 'Chicago (Red)')
GROUP BY s.name
ORDER BY total_ridership DESC NULLS LAST;
EOF

echo ""
echo "Running compute to update ghost scores..."
DATABASE_URL="./prisma/dev.db" ./go-etl/go-etl compute --city=chicago

echo ""
echo "Done!"