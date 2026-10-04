-- Add missing station aliases based on unmatched stations from ridership sync
-- These mappings handle various naming conventions used in the CTA ridership data

-- Kedzie-Homan-Forest Park -> Kedzie-Homan (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Kedzie-Homan-Forest Park', 'kedzie homan forest park'
FROM Station s WHERE s.name = 'Kedzie-Homan' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Jackson/State -> Jackson (Red)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Jackson/State', 'jackson state'
FROM Station s WHERE s.name = 'Jackson (Red)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Randolph/Wabash -> Washington/Wabash (Loop consolidation)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Randolph/Wabash', 'randolph wabash'
FROM Station s WHERE s.name = 'Washington/Wabash' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Washington/Dearborn -> Washington (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Washington/Dearborn', 'washington dearborn'
FROM Station s WHERE s.name = 'Washington (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Quincy/Wells -> Quincy
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Quincy/Wells', 'quincy wells'
FROM Station s WHERE s.name = 'Quincy' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Kedzie-Lake -> Kedzie (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Kedzie-Lake', 'kedzie lake'
FROM Station s WHERE s.name = 'Kedzie (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Cicero-Lake -> Cicero (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Cicero-Lake', 'cicero lake'
FROM Station s WHERE s.name = 'Cicero (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Skokie -> Dempster-Skokie (Yellow)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Skokie', 'skokie'
FROM Station s WHERE s.name = 'Dempster-Skobie (Yellow)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Halsted/63rd -> Halsted (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Halsted/63rd', 'halsted 63rd'
FROM Station s WHERE s.name = 'Halsted (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Monroe/Dearborn -> Monroe (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Monroe/Dearborn', 'monroe dearborn'
FROM Station s WHERE s.name = 'Monroe (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Damen-Lake -> Damen (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Damen-Lake', 'damen lake'
FROM Station s WHERE s.name = 'Damen (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- State/Lake -> Lake (Subway/Elevated)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'State/Lake', 'state lake'
FROM Station s WHERE s.name = 'Lake (Subway)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Division/Milwaukee -> Division
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Division/Milwaukee', 'division milwaukee'
FROM Station s WHERE s.name = 'Division' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Austin-Forest Park -> Austin (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Austin-Forest Park', 'austin forest park'
FROM Station s WHERE s.name = 'Austin (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Sox-35th-Dan Ryan -> Sox-35th
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Sox-35th-Dan Ryan', 'sox 35th dan ryan'
FROM Station s WHERE s.name = 'Sox-35th' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Clinton-Lake -> Clinton (Green/Pink)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Clinton-Lake', 'clinton lake'
FROM Station s WHERE s.name = 'Clinton (Green/Pink)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Clinton-Forest Park -> Clinton (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Clinton-Forest Park', 'clinton forest park'
FROM Station s WHERE s.name = 'Clinton (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Chicago/Franklin -> Chicago (Brown/Purple)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Chicago/Franklin', 'chicago franklin'
FROM Station s WHERE s.name = 'Chicago (Brown/Purple)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Western/Milwaukee -> Western (Blue) - O'Hare branch
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Western/Milwaukee', 'western milwaukee'
FROM Station s WHERE s.name = 'Western (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- California-Lake -> California (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'California-Lake', 'california lake'
FROM Station s WHERE s.name = 'California (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Clark/Lake -> Clark/Lake (Elevated)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Clark/Lake', 'clark lake'
FROM Station s WHERE s.name = 'Clark/Lake (Elevated)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Belmont-O'Hare -> Belmont (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Belmont-O''Hare', 'belmont ohare'
FROM Station s WHERE s.name = 'Belmont (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Oak Park-Lake -> Oak Park (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Oak Park-Lake', 'oak park lake'
FROM Station s WHERE s.name = 'Oak Park (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Garfield-South Elevated -> Garfield (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Garfield-South Elevated', 'garfield south elevated'
FROM Station s WHERE s.name = 'Garfield (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Roosevelt (standalone) -> Roosevelt (Elevated)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Roosevelt', 'roosevelt'
FROM Station s WHERE s.name = 'Roosevelt' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Garfield-Dan Ryan -> Garfield (Red)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Garfield-Dan Ryan', 'garfield dan ryan'
FROM Station s WHERE s.name = 'Garfield (Red)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Central-Lake -> Central (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Central-Lake', 'central lake'
FROM Station s WHERE s.name = 'Central (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Grand/Milwaukee -> Grand (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Grand/Milwaukee', 'grand milwaukee'
FROM Station s WHERE s.name = 'Grand (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Harlem-Lake -> Harlem (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Harlem-Lake', 'harlem lake'
FROM Station s WHERE s.name = 'Harlem (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Pulaski-Lake -> Pulaski (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Pulaski-Lake', 'pulaski lake'
FROM Station s WHERE s.name = 'Pulaski (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- 47th-South Elevated -> 47th (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, '47th-South Elevated', '47th south elevated'
FROM Station s WHERE s.name = '47th (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Montrose-O'Hare -> Montrose (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Montrose-O''Hare', 'montrose ohare'
FROM Station s WHERE s.name = 'Montrose (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Grand/State -> Grand (Red)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Grand/State', 'grand state'
FROM Station s WHERE s.name = 'Grand (Red)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Wilson -> Wilson
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Wilson', 'wilson'
FROM Station s WHERE s.name = 'Wilson' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Morgan-Lake -> Morgan (Green/Pink)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Morgan-Lake', 'morgan lake'
FROM Station s WHERE s.name = 'Morgan (Green/Pink)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Madison/Wabash -> Washington/Wabash (consolidated Loop station)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Madison/Wabash', 'madison wabash'
FROM Station s WHERE s.name = 'Washington/Wabash' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- 95th/Dan Ryan -> 95th
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, '95th/Dan Ryan', '95th dan ryan'
FROM Station s WHERE s.name = '95th' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- 47th-Dan Ryan -> 47th (Red)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, '47th-Dan Ryan', '47th dan ryan'
FROM Station s WHERE s.name = '47th (Red)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Irving Park-O'Hare -> Irving Park (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Irving Park-O''Hare', 'irving park ohare'
FROM Station s WHERE s.name = 'Irving Park (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Kedzie-Midway -> Kedzie (Orange)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Kedzie-Midway', 'kedzie midway'
FROM Station s WHERE s.name = 'Kedzie (Orange)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Midway Airport -> Midway
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Midway Airport', 'midway airport'
FROM Station s WHERE s.name = 'Midway' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Medical Center -> Illinois Medical District
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Medical Center', 'medical center'
FROM Station s WHERE s.name = 'Illinois Medical District' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Oak Park-Forest Park -> Oak Park (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Oak Park-Forest Park', 'oak park forest park'
FROM Station s WHERE s.name = 'Oak Park (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- California/Milwaukee -> California (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'California/Milwaukee', 'california milwaukee'
FROM Station s WHERE s.name = 'California (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Damen/Milwaukee -> Damen (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Damen/Milwaukee', 'damen milwaukee'
FROM Station s WHERE s.name = 'Damen (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Chicago/State -> Chicago (Red)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Chicago/State', 'chicago state'
FROM Station s WHERE s.name = 'Chicago (Red)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Chicago/Milwaukee -> Chicago (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Chicago/Milwaukee', 'chicago milwaukee'
FROM Station s WHERE s.name = 'Chicago (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- O'Hare Airport -> O'Hare
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'O''Hare Airport', 'ohare airport'
FROM Station s WHERE s.name = 'O''Hare' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Monroe/State -> Monroe (Red)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Monroe/State', 'monroe state'
FROM Station s WHERE s.name = 'Monroe (Red)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- 63rd-Dan Ryan -> 63rd
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, '63rd-Dan Ryan', '63rd dan ryan'
FROM Station s WHERE s.name = '63rd' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Addison-O'Hare -> Addison (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Addison-O''Hare', 'addison ohare'
FROM Station s WHERE s.name = 'Addison (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Jackson/Dearborn -> Jackson (Blue)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Jackson/Dearborn', 'jackson dearborn'
FROM Station s WHERE s.name = 'Jackson (Blue)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Central-Evanston -> Central (Purple)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Central-Evanston', 'central evanston'
FROM Station s WHERE s.name = 'Central' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Homan -> Kedzie-Homan
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Homan', 'homan'
FROM Station s WHERE s.name = 'Kedzie-Homan' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Lake/State -> Lake (Subway/Elevated)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Lake/State', 'lake state'
FROM Station s WHERE s.name = 'Lake (Subway)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Library -> Harold Washington Library
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Library', 'library'
FROM Station s WHERE s.name = 'Harold Washington Library' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Austin-Lake -> Austin (Green)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Austin-Lake', 'austin lake'
FROM Station s WHERE s.name = 'Austin (Green)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Addison-North Main -> Addison (Red)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Addison-North Main', 'addison north main'
FROM Station s WHERE s.name = 'Addison (Red)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Belmont-North Main -> Belmont (Red/Brown/Purple)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Belmont-North Main', 'belmont north main'
FROM Station s WHERE s.name = 'Belmont (Red/Brown/Purple)' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');

-- Washington/State -> Washington/Wabash (consolidated Loop)
INSERT OR IGNORE INTO StationAlias (id, stationId, aliasName, normalized)
SELECT lower(hex(randomblob(16))), s.id, 'Washington/State', 'washington state'
FROM Station s WHERE s.name = 'Washington/Wabash' AND s.cityId = (SELECT id FROM City WHERE code = 'chicago');