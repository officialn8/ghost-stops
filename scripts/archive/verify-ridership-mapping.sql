-- Script to verify the ridership mapping implementation

-- 1. Check distinct stations with ridership data in last 365 days
SELECT
    COUNT(DISTINCT rd.stationId) as stations_with_data,
    COUNT(DISTINCT s.id) as total_stations
FROM Station s
JOIN City c ON s.cityId = c.id
LEFT JOIN RidershipDaily rd ON s.id = rd.stationId AND rd.serviceDate >= date('now', '-365 days')
WHERE c.code = 'chicago';

-- 2. List stations with 0 ridership rows in the last 365 days (should be minimal)
SELECT
    s.name,
    s.externalId,
    COUNT(rd.id) as ridership_rows,
    m.ghostScore,
    m.serviceDateMax
FROM Station s
JOIN City c ON s.cityId = c.id
LEFT JOIN RidershipDaily rd ON s.id = rd.stationId AND rd.serviceDate >= date('now', '-365 days')
LEFT JOIN StationMetrics m ON s.id = m.stationId
WHERE c.code = 'chicago'
GROUP BY s.id, s.name, s.externalId, m.ghostScore, m.serviceDateMax
HAVING COUNT(rd.id) = 0
ORDER BY s.name;

-- 3. Verify major stations have data (Blue/Orange line stations)
SELECT
    s.name,
    s.lines,
    COUNT(rd.id) as ridership_rows_365d,
    m.rolling30dAvg,
    m.ghostScore,
    CASE
        WHEN m.serviceDateMax IS NULL THEN 'missing'
        WHEN m.rolling30dAvg = 0 THEN 'zero'
        ELSE 'available'
    END as data_status
FROM Station s
JOIN City c ON s.cityId = c.id
LEFT JOIN RidershipDaily rd ON s.id = rd.stationId AND rd.serviceDate >= date('now', '-365 days')
LEFT JOIN StationMetrics m ON s.id = m.stationId
WHERE c.code = 'chicago'
    AND (s.lines LIKE '%Blue%' OR s.lines LIKE '%Orange%')
GROUP BY s.id, s.name, s.lines, m.rolling30dAvg, m.ghostScore, m.serviceDateMax
ORDER BY ridership_rows_365d ASC, s.name;

-- 4. Summary statistics
SELECT
    'Total Chicago stations' as metric,
    COUNT(DISTINCT s.id) as value
FROM Station s
JOIN City c ON s.cityId = c.id
WHERE c.code = 'chicago'
UNION ALL
SELECT
    'Stations with ridership data (365d)' as metric,
    COUNT(DISTINCT rd.stationId) as value
FROM RidershipDaily rd
JOIN Station s ON s.id = rd.stationId
JOIN City c ON s.cityId = c.id
WHERE c.code = 'chicago' AND rd.serviceDate >= date('now', '-365 days')
UNION ALL
SELECT
    'Stations with 0 rows (365d)' as metric,
    COUNT(DISTINCT s.id) - COUNT(DISTINCT rd.stationId) as value
FROM Station s
JOIN City c ON s.cityId = c.id
LEFT JOIN RidershipDaily rd ON s.id = rd.stationId AND rd.serviceDate >= date('now', '-365 days')
WHERE c.code = 'chicago'
UNION ALL
SELECT
    'Stations with metrics' as metric,
    COUNT(DISTINCT m.stationId) as value
FROM StationMetrics m
JOIN Station s ON s.id = m.stationId
JOIN City c ON s.cityId = c.id
WHERE c.code = 'chicago';

-- 5. Check station aliases count
SELECT
    COUNT(*) as total_aliases,
    COUNT(DISTINCT stationId) as stations_with_aliases
FROM StationAlias sa
JOIN Station s ON s.id = sa.stationId
JOIN City c ON s.cityId = c.id
WHERE c.code = 'chicago';