#!/bin/bash
# Sync missing Chicago CTA stations using curl and sqlite3

API_TOKEN="wFGo1rspxy4bY15XLIr6Wjl2U"
API_URL="https://data.cityofchicago.org/resource/5neh-572f.json"
DB_PATH="prisma/dev.db"

# Function to fetch and insert data for a station
sync_station() {
    local station_id=$1
    local station_name=$2
    local our_id=$3

    echo "Syncing $station_name (Socrata ID: $station_id)..."

    # Fetch last 30 days of data
    local since_date=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d '30 days ago' +%Y-%m-%d)
    local query="\$where=station_id='${station_id}' AND date > '${since_date}'&\$limit=1000"

    # Fetch data from API
    local temp_file="/tmp/station_${station_id}.json"
    curl -s -H "X-App-Token: $API_TOKEN" "${API_URL}?${query}" > "$temp_file"

    # Count records
    local count=$(jq '. | length' "$temp_file")
    echo "  Fetched $count records"

    if [ "$count" -gt 0 ]; then
        # Insert into database using jq and sqlite
        jq -r --arg sid "$our_id" '.[] | "INSERT OR REPLACE INTO RidershipDaily (id, stationId, serviceDate, entries) VALUES (\""
            + ([1000000000000 - (now * 1000), (now * 10000) | floor] | map(tostring) | join("") | .[0:32])
            + "-" + (.station_id)
            + "-" + (.date[0:10])
            + "\", \"" + $sid
            + "\", \"" + (.date[0:10]) + " 00:00:00"
            + "\", " + .rides + ");"' "$temp_file" | sqlite3 "$DB_PATH"

        echo "  Inserted records successfully"
    fi

    rm -f "$temp_file"
}

echo "Syncing missing Chicago CTA stations..."
echo "====================================="

# Sync each missing station
sync_station "40890" "O'Hare Airport" "5cab956320ed9c05474044fb960a87d9"
sync_station "40930" "Midway Airport" "df19d99efac023bfd0e7e87106692777"
sync_station "40450" "95th/Dan Ryan" "cb98f3dd10953552c2c7086c888a2e41"
sync_station "41090" "Monroe/State" "079a1746db130de63cf5d80101770506"
sync_station "40790" "Monroe/Dearborn" "7214e442e5e12a6187581e1b6ceeeda7"

echo ""
echo "Verifying sync results..."
echo "========================"

sqlite3 "$DB_PATH" << EOF
.headers on
.mode column
SELECT
    s.name,
    COUNT(rd.id) as records,
    MAX(rd.serviceDate) as latest_date
FROM Station s
LEFT JOIN RidershipDaily rd ON rd.stationId = s.id
WHERE s.name IN ('O''Hare', 'Midway', '95th/Dan Ryan', 'Monroe (Red)', 'Monroe (Blue)')
GROUP BY s.name
ORDER BY records DESC;
EOF

echo ""
echo "Done! Now run: ./go-etl/go-etl compute --city=chicago"