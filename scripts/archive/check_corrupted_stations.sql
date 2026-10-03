-- Check stations with potentially corrupted data
-- These IDs were failing in the logs
SELECT
    id,
    name,
    lines,
    LENGTH(lines) as lines_length,
    CASE
        WHEN lines IS NULL THEN 'NULL'
        WHEN lines = '' THEN 'EMPTY'
        WHEN lines LIKE '[%' AND lines LIKE '%]' THEN 'LOOKS_LIKE_JSON'
        ELSE 'NOT_JSON'
    END as lines_status
FROM Station
WHERE id IN (
    'df19d99efac023bfd0e7e87106692777',
    '9708ddfb0e6569405ab05449a77146ef',
    '2f1c27a23dec9d3a36e93a6fcbe99f',
    '5cab956320ed9c05474044fb960a87d9',
    'cb98f3dd10953552c2c7086c888a2e41'
)
ORDER BY id;

-- Also check a few working stations for comparison
SELECT
    id,
    name,
    lines,
    LENGTH(lines) as lines_length,
    CASE
        WHEN lines IS NULL THEN 'NULL'
        WHEN lines = '' THEN 'EMPTY'
        WHEN lines LIKE '[%' AND lines LIKE '%]' THEN 'LOOKS_LIKE_JSON'
        ELSE 'NOT_JSON'
    END as lines_status
FROM Station
WHERE id IN (
    'ff92f4f58a52079057a6411ba66576c0',
    'a8278f267a972e8a90b81133a83c760b',
    'b160ec71aa06eb825b6e5bb466080e3a'
)
ORDER BY id;

-- Check for any stations with potentially malformed JSON in lines field
SELECT
    id,
    name,
    lines,
    LENGTH(lines) as lines_length
FROM Station
WHERE
    lines IS NOT NULL
    AND lines != ''
    AND (
        lines NOT LIKE '[%'
        OR lines NOT LIKE '%]'
        OR lines LIKE '%[%[%'  -- nested brackets
        OR lines LIKE '%]%]%'  -- nested brackets
    )
LIMIT 20;

-- Check StationMetrics for the failing stations
SELECT
    sm.id,
    sm.stationId,
    s.name,
    sm.rolling30dAvg,
    sm.rolling90dAvg,
    sm.ghostScore,
    sm.lastUpdated
FROM StationMetrics sm
JOIN Station s ON s.id = sm.stationId
WHERE sm.stationId IN (
    'df19d99efac023bfd0e7e87106692777',
    '9708ddfb0e6569405ab05449a77146ef',
    '2f1c27a23dec9d3a36e93a6fcbe99f',
    '5cab956320ed9c05474044fb960a87d9',
    'cb98f3dd10953552c2c7086c888a2e41'
);