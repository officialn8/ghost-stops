-- Fix Prisma P2023 error by updating exact 0.0 float values
-- These cause parsing issues between SQLite and Prisma

-- First, let's see how many records we're about to update
SELECT COUNT(*) as stations_to_fix
FROM StationMetrics
WHERE rolling30dAvg = 0.0 OR rolling90dAvg = 0.0;

-- Update the problematic 0.0 values to NULL
-- This is valid according to the schema and will fix the Prisma parsing issue
UPDATE StationMetrics
SET
    rolling30dAvg = CASE WHEN rolling30dAvg = 0.0 THEN NULL ELSE rolling30dAvg END,
    rolling90dAvg = CASE WHEN rolling90dAvg = 0.0 THEN NULL ELSE rolling90dAvg END,
    lastDayEntries = CASE WHEN lastDayEntries = 0 THEN NULL ELSE lastDayEntries END
WHERE rolling30dAvg = 0.0 OR rolling90dAvg = 0.0;

-- Verify the fix
SELECT
    'Fixed stations:' as status,
    COUNT(*) as count
FROM StationMetrics
WHERE rolling30dAvg IS NULL OR rolling90dAvg IS NULL;

-- Check a few of the previously failing stations
SELECT
    sm.stationId,
    s.name,
    sm.rolling30dAvg,
    sm.rolling90dAvg,
    sm.lastDayEntries,
    sm.ghostScore
FROM StationMetrics sm
JOIN Station s ON s.id = sm.stationId
WHERE sm.stationId IN (
    'df19d99efac023bfd0e7e87106692777',
    '9708ddfb0e6569405ab05449a77146ef',
    '2f1c27a23dec9d3a36e93a6fcbe99f',
    '5cab956320ed9c05474044fb960a87d9',
    'cb98f3dd10953552c2c7086c888a2e41'
);