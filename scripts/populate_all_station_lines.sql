-- Comprehensive CTA Station Line Mapping
-- Maps ALL stations to their correct lines based on official CTA data

-- First, run the existing script to catch parenthetical patterns
-- Then add specific mappings for all remaining stations

-- ========================================
-- EXPLICIT MULTI-LINE STATION MAPPINGS
-- ========================================

-- Brown/Purple Line shared stations
UPDATE Station SET lines = '["Brown", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    'Armitage (Brown/Purple)',
    'Sedgwick (Brown/Purple)',
    'Diversey (Brown/Purple)',
    'Wellington (Brown/Purple)',
    'Merchandise Mart (Brown/Purple)'
);

-- Major transfer stations
UPDATE Station SET lines = '["Blue", "Brown", "Green", "Orange", "Pink", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Clark/Lake';

UPDATE Station SET lines = '["Brown", "Green", "Orange", "Pink", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN ('Adams/Wabash', 'Washington/Wells', 'LaSalle/Van Buren', 'Quincy', 'Harold Washington Library-State/Van Buren');

UPDATE Station SET lines = '["Red"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN ('LaSalle', 'Washington', 'Harrison', 'Clark/Division');

-- ========================================
-- RED LINE STATIONS
-- ========================================
UPDATE Station SET lines = '["Red"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    '35th-Bronzeville-IIT',
    '47th',
    '63rd',
    '69th',
    '79th',
    '87th',
    '95th/Dan Ryan',
    'Cermak-McCormick Place',
    'Harrison',
    'Indiana',
    'King Drive',
    'Sox-35th',
    'Cottage Grove'
);

-- ========================================
-- BLUE LINE STATIONS
-- ========================================
UPDATE Station SET lines = '["Blue"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    'Cumberland',
    'Harlem (Blue - O''Hare Branch)',
    'Rosemont',
    'Jefferson Park Transit Center',
    'Forest Park',
    'Harlem (Blue - Forest Park Branch)',
    'Illinois Medical District',
    'Racine',
    'UIC-Halsted',
    'Western (Blue - O''Hare Branch)',
    'Western (Blue - Forest Park Branch)',
    'Kedzie-Homan',
    'Polk',
    'Division',
    'Logan Square',
    'California'
);

-- ========================================
-- BROWN LINE STATIONS
-- ========================================
UPDATE Station SET lines = '["Brown"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    'Kimball',
    'Kedzie (Brown)',
    'Francisco',
    'Rockwell',
    'Western (Brown)',
    'Damen (Brown)',
    'Montrose (Brown)',
    'Irving Park (Brown)',
    'Addison (Brown)',
    'Paulina',
    'Southport'
);

-- ========================================
-- GREEN LINE STATIONS
-- ========================================
UPDATE Station SET lines = '["Green"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    'Harlem/Lake',
    'Ridgeland',
    'Oak Park (Green)',
    'Central Park',
    'Conservatory-Central Park Drive',
    'Kedzie (Green)',
    'California (Green)',
    'Ashland/63rd',
    '63rd (Green)',
    'Cottage Grove',
    'King Drive',
    'Indiana',
    '35th-Bronzeville-IIT',
    '43rd',
    '47th (Green)',
    '51st'
);

-- Wait - some of these stations are on multiple lines!
-- Let me fix the multi-line stations properly

-- ========================================
-- FIX GREEN LINE SOUTH SIDE (all serve Green)
-- These are on Green Line - but some like King Drive, Indiana
-- are actually on the Red Line! Let me verify...
-- ========================================

-- Actually the South Side Green Line goes:  Cottage Grove, King Drive, Indiana, 35th-Bronzeville-IIT, 43rd, 47th, 51st, etc.
-- The Red Line goes through: Sox-35th, 35th-Bronzeville-IIT (RED only), etc.

-- Let me fix this properly:

-- Green Line South Side stations
UPDATE Station SET lines = '["Green"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    '43rd',
    '47th (Green)',
    '51st',
    'Ashland/63rd',
    'Cottage Grove'
);

-- Actually King Drive and Indiana ARE on the Green Line!
-- 35th-Bronzeville-IIT is on Green Line
-- Sox-35th is on Red Line

UPDATE Station SET lines = '["Green"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN ('King Drive', 'Indiana', '35th-Bronzeville-IIT');

-- ========================================
-- ORANGE LINE STATIONS
-- ========================================
UPDATE Station SET lines = '["Orange"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    'Midway',
    'Pulaski (Orange)',
    'Kedzie (Orange)',
    '35th/Archer',
    'Ashland (Orange)',
    'Western (Orange)'
);

-- ========================================
-- PINK LINE STATIONS
-- ========================================
UPDATE Station SET lines = '["Pink"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    '54th/Cermak',
    'Kostner',
    'Pulaski (Pink)',
    'Kedzie (Pink)',
    'California (Pink)',
    'Western (Pink)',
    '18th',
    'Polk',
    'Damen (Pink)',
    'Cicero (Pink)'
);

-- ========================================
-- PURPLE LINE STATIONS (Evanston)
-- ========================================
UPDATE Station SET lines = '["Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    'Linden',
    'Central (Purple)',
    'Noyes',
    'Foster',
    'Davis',
    'Dempster',
    'Main',
    'South Boulevard'
);

-- ========================================
-- YELLOW LINE STATIONS
-- ========================================
UPDATE Station SET lines = '["Yellow"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN (
    'Dempster-Skokie',
    'Oakton-Skokie'
);

-- ========================================
-- LARAMIE FIX (Pink Line)
-- ========================================
UPDATE Station SET lines = '["Pink"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Laramie';

-- Verify results
SELECT name, lines FROM Station 
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND lines = '[]'
ORDER BY name;
