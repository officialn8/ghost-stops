#!/usr/bin/env python3
import requests
import sqlite3
import json
import uuid
from datetime import datetime, timedelta

# Configuration
API_TOKEN = "wFGo1rspxy4bY15XLIr6Wjl2U"
API_URL = "https://data.cityofchicago.org/resource/5neh-572f.json"
DB_PATH = "prisma/dev.db"

# Stations we know are missing data
MISSING_STATIONS = {
    "40890": {"name": "O'Hare Airport", "our_id": "5cab956320ed9c05474044fb960a87d9"},
    "40930": {"name": "Midway Airport", "our_id": "df19d99efac023bfd0e7e87106692777"},
    "40450": {"name": "95th/Dan Ryan", "our_id": "cb98f3dd10953552c2c7086c888a2e41"},
    "41090": {"name": "Monroe/State", "our_id": "079a1746db130de63cf5d80101770506"},
    "40790": {"name": "Monroe/Dearborn", "our_id": "7214e442e5e12a6187581e1b6ceeeda7"},
}

def fetch_station_data(station_id, station_name, days=30):
    """Fetch ridership data for a specific station from the API."""
    since_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")

    params = {
        "$where": f"station_id='{station_id}' AND date > '{since_date}'",
        "$order": "date DESC",
        "$limit": 1000
    }

    headers = {
        "X-App-Token": API_TOKEN
    }

    response = requests.get(API_URL, params=params, headers=headers)
    if response.status_code == 200:
        data = response.json()
        print(f"  Fetched {len(data)} records for {station_name}")
        return data
    else:
        print(f"  Error fetching data for {station_name}: {response.status_code}")
        return []

def insert_ridership_data(conn, station_id, records):
    """Insert ridership records into the database."""
    cursor = conn.cursor()
    inserted = 0

    for record in records:
        record_id = str(uuid.uuid4())
        service_date = record['date'].split('T')[0] + ' 00:00:00'
        entries = int(record['rides'])

        cursor.execute("""
            INSERT OR REPLACE INTO RidershipDaily (id, stationId, serviceDate, entries)
            VALUES (?, ?, ?, ?)
        """, (record_id, station_id, service_date, entries))
        inserted += 1

    conn.commit()
    return inserted

def main():
    print("Syncing missing Chicago CTA stations...")
    print("=====================================")

    # Connect to database
    conn = sqlite3.connect(DB_PATH)

    total_inserted = 0

    for socrata_id, info in MISSING_STATIONS.items():
        station_name = info['name']
        our_id = info['our_id']

        print(f"\nSyncing {station_name} (Socrata ID: {socrata_id})...")

        # Fetch data from API
        records = fetch_station_data(socrata_id, station_name, days=365)

        if records:
            # Insert into database
            inserted = insert_ridership_data(conn, our_id, records)
            total_inserted += inserted
            print(f"  Inserted {inserted} records")
        else:
            print(f"  No data found")

    # Check results
    print("\n\nVerifying sync results...")
    print("========================")

    cursor = conn.cursor()
    for socrata_id, info in MISSING_STATIONS.items():
        station_name = info['name']
        our_id = info['our_id']

        cursor.execute("""
            SELECT COUNT(*) as count, MAX(serviceDate) as latest
            FROM RidershipDaily
            WHERE stationId = ?
        """, (our_id,))

        count, latest = cursor.fetchone()
        print(f"{station_name}: {count} records, latest: {latest}")

    conn.close()

    print(f"\nTotal records inserted: {total_inserted}")
    print("\nDone! Now run: ./go-etl/go-etl compute --city=chicago")

if __name__ == "__main__":
    main()