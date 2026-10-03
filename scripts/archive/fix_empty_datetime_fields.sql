-- Fix empty datetime fields in StationMetrics
-- Empty strings in datetime fields cause Prisma parsing errors

-- Check how many records have this issue
SELECT COUNT(*) as records_with_empty_datetime
FROM StationMetrics
WHERE serviceDateMax = '' OR serviceDateMax IS NULL;

-- Update empty string datetime fields to NULL
UPDATE StationMetrics
SET serviceDateMax = lastUpdated  -- Use lastUpdated as fallback since it's required
WHERE serviceDateMax = '' OR serviceDateMax IS NULL;

-- Verify the fix
SELECT
    'Fixed datetime fields' as status,
    COUNT(*) as count
FROM StationMetrics
WHERE serviceDateMax IS NOT NULL;

-- Check our problematic stations again
SELECT
    sm.stationId,
    s.name,
    sm.lastUpdated,
    sm.serviceDateMax,
    sm.rolling30dAvg,
    sm.ghostScore
FROM StationMetrics sm
JOIN Station s ON s.id = sm.stationId
WHERE sm.stationId IN (
    'df19d99efac023bfd0e7e87106692777',
    '9708ddfb0e6569405ab05449a77146ef',
    '2f1c27a23dec9d3a36e93a6fcbe99f',
    '5cab956320ed9c05474044fb960a87d9',
    'cb98f3dd10953552c2c7086c888a2e41'
)
LIMIT 5;