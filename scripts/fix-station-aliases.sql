-- Corrected CTA station name mappings
-- This script maps ridership data station names to the correct GTFS station names.
-- The 'normalized' column is generated using the same logic as the Go ETL script.

-- Format: Ridership Name -> GTFS Name
-- Roosevelt -> Roosevelt (Elevated)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Roosevelt', 'roosevelt'
FROM Station s WHERE s.name = 'Roosevelt (Elevated)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Addison-O'Hare -> Addison-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Addison-O''Hare', 'addison-ohare'
FROM Station s WHERE s.name = 'Addison-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Belmont-O'Hare -> Belmont-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Belmont-O''Hare', 'belmont-ohare'
FROM Station s WHERE s.name = 'Belmont-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- State/Lake -> Lake (this is a guess, might need to be State/Lake)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'State/Lake', 'statelake'
FROM Station s WHERE s.name = 'Lake' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Grand/Milwaukee -> Grand-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Grand/Milwaukee', 'grandmilwaukee'
FROM Station s WHERE s.name = 'Grand-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Madison/Wabash -> Washington/Wabash
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Madison/Wabash', 'madisonwabash'
FROM Station s WHERE s.name = 'Washington/Wabash' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Homan -> Kedzie-Homan
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Homan', 'homan'
FROM Station s WHERE s.name = 'Kedzie-Homan' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Chicago/Milwaukee -> Chicago-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Chicago/Milwaukee', 'chicagomilwaukee'
FROM Station s WHERE s.name = 'Chicago-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Western/Milwaukee -> Western-O'Hare
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Western/Milwaukee', 'westernmilwaukee'
FROM Station s WHERE s.name = 'Western-O''Hare' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Montrose-O'Hare -> Montrose-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Montrose-O''Hare', 'montrose-ohare'
FROM Station s WHERE s.name = 'Montrose-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Chicago/State -> Chicago-Red
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Chicago/State', 'chicagostate'
FROM Station s WHERE s.name = 'Chicago-Red' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Chicago/Franklin -> Chicago-Brown
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Chicago/Franklin', 'chicagofranklin'
FROM Station s WHERE s.name = 'Chicago-Brown' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Jackson/Dearborn -> Jackson-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Jackson/Dearborn', 'jacksondearborn'
FROM Station s WHERE s.name = 'Jackson-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Grand/State -> Grand-Red
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Grand/State', 'grandstate'
FROM Station s WHERE s.name = 'Grand-Red' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Quincy/Wells -> Quincy
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Quincy/Wells', 'quincywells'
FROM Station s WHERE s.name = 'Quincy' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- California/Milwaukee -> California-O'Hare
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'California/Milwaukee', 'californiamilwaukee'
FROM Station s WHERE s.name = 'California-O''Hare' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- 95th/Dan Ryan -> 95th
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, '95th/Dan Ryan', '95thdan ryan'
FROM Station s WHERE s.name = '95th' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Washington/Dearborn -> Washington-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Washington/Dearborn', 'washingtondearborn'
FROM Station s WHERE s.name = 'Washington-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Clark/Lake -> Clark/Lake (Elevated)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Clark/Lake', 'clarklake'
FROM Station s WHERE s.name = 'Clark/Lake (Elevated)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Monroe/State -> Monroe-Red
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Monroe/State', 'monroestate'
FROM Station s WHERE s.name = 'Monroe-Red' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Irving Park-O'Hare -> Irving Park-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Irving Park-O''Hare', 'irving park-ohare'
FROM Station s WHERE s.name = 'Irving Park-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Monroe/Dearborn -> Monroe-Blue
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Monroe/Dearborn', 'monroedearborn'
FROM Station s WHERE s.name = 'Monroe-Blue' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Washington/State -> Washington-Red (No such station, guess: Washington/Wabash)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Washington/State', 'washingtonstate'
FROM Station s WHERE s.name = 'Washington/Wabash' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Lake/State -> Lake
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Lake/State', 'lakestate'
FROM Station s WHERE s.name = 'Lake' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Wilson -> Wilson-North Inner
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Wilson', 'wilson'
FROM Station s WHERE s.name = 'Wilson-North Inner' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Jackson/State -> Jackson-Red
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Jackson/State', 'jacksonstate'
FROM Station s WHERE s.name = 'Jackson-Red' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- O'Hare Airport -> O'Hare
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'O''Hare Airport', 'ohare airport'
FROM Station s WHERE s.name = 'O''Hare' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Damen/Milwaukee -> Damen-O'Hare
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Damen/Milwaukee', 'damenmilwaukee'
FROM Station s WHERE s.name = 'Damen-O''Hare' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Halsted/63rd -> Halsted-Green
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Halsted/63rd', 'halsted63rd'
FROM Station s WHERE s.name = 'Halsted-Green' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Garfield-South Elevated -> Garfield-Green
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Garfield-South Elevated', 'garfield-south elevated'
FROM Station s WHERE s.name = 'Garfield-Green' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Randolph/Wabash -> Washington/Wabash
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Randolph/Wabash', 'randolphwabash'
FROM Station s WHERE s.name = 'Washington/Wabash' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Division/Milwaukee -> Division
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Division/Milwaukee', 'divisionmilwaukee'
FROM Station s WHERE s.name = 'Division' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');