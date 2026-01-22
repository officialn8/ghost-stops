-- Debug station matching for key stations
-- Test normalization and matching logic

-- Check what we have in the database
SELECT '=== Current Station Aliases ===' as section;
SELECT
    s.name as station_name,
    sa.aliasName,
    sa.normalized
FROM Station s
JOIN StationAlias sa ON sa.stationId = s.id
WHERE s.name IN ('O''Hare', 'Midway', '95th/Dan Ryan', 'Monroe (Red)')
ORDER BY s.name, sa.aliasName;

-- Test matching for specific Socrata names
SELECT '=== Testing Socrata Name Matching ===' as section;
WITH socrata_names AS (
    SELECT 'O''Hare Airport' as name, '40890' as station_id
    UNION ALL SELECT 'Midway Airport', '40930'
    UNION ALL SELECT '95th/Dan Ryan', '40450'
    UNION ALL SELECT 'Monroe/State', '41090'
    UNION ALL SELECT 'Monroe/Dearborn', '40790'
)
SELECT
    sn.name as socrata_name,
    sn.station_id as socrata_id,
    sa.aliasName as matched_alias,
    s.name as our_station_name,
    s.id as our_station_id
FROM socrata_names sn
LEFT JOIN StationAlias sa ON sa.aliasName = sn.name
LEFT JOIN Station s ON s.id = sa.stationId
ORDER BY sn.name;

-- Check external ID mapping
SELECT '=== External ID Mapping ===' as section;
SELECT
    s.name,
    s.externalId,
    CASE WHEN s.externalId IS NULL THEN 'NO EXTERNAL ID' ELSE 'HAS EXTERNAL ID' END as status
FROM Station s
WHERE s.name IN ('O''Hare', 'Midway', '95th/Dan Ryan', 'Monroe (Red)')
ORDER BY s.name;

-- Check if we have any successful matches
SELECT '=== Stations with Ridership Data ===' as section;
SELECT
    s.name,
    COUNT(DISTINCT rd.serviceDate) as days_with_data,
    MIN(rd.serviceDate) as earliest_date,
    MAX(rd.serviceDate) as latest_date
FROM Station s
LEFT JOIN RidershipDaily rd ON rd.stationId = s.id
WHERE s.name IN ('O''Hare', 'Midway', '95th/Dan Ryan', 'Monroe (Red)', 'Fullerton', 'Clark/Division')
GROUP BY s.name
ORDER BY days_with_data DESC;