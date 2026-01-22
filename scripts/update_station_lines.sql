-- Update station lines based on station name patterns
-- This script extracts line information from station names like "Austin (Blue)" or "Harlem (Green)"

-- Update Blue Line stations
UPDATE Station
SET lines = '["Blue"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Blue)%' OR name LIKE '%-Blue%');

-- Update Red Line stations
UPDATE Station
SET lines = '["Red"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Red)%' OR name LIKE '%-Red%');

-- Update Green Line stations
UPDATE Station
SET lines = '["Green"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Green)%' OR name LIKE '%-Green%');

-- Update Brown Line stations
UPDATE Station
SET lines = '["Brown"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Brown)%' OR name LIKE '%-Brown%');

-- Update Orange Line stations
UPDATE Station
SET lines = '["Orange"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Orange)%' OR name LIKE '%-Orange%');

-- Update Purple Line stations
UPDATE Station
SET lines = '["Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Purple)%' OR name LIKE '%-Purple%');

-- Update Pink Line stations
UPDATE Station
SET lines = '["Pink"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Pink)%' OR name LIKE '%-Pink%');

-- Update Yellow Line stations
UPDATE Station
SET lines = '["Yellow"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name LIKE '%(Yellow)%' OR name LIKE '%-Yellow%');

-- Update multi-line stations
-- Belmont (Red/Brown/Purple)
UPDATE Station
SET lines = '["Red", "Brown", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Belmont (Red/Brown/Purple)';

-- Fullerton (Red/Brown/Purple)
UPDATE Station
SET lines = '["Red", "Brown", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Fullerton';

-- Howard (Red/Purple/Yellow)
UPDATE Station
SET lines = '["Red", "Purple", "Yellow"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Howard';

-- Roosevelt (Elevated) - serves Red, Green, Orange
UPDATE Station
SET lines = '["Red", "Green", "Orange"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name = 'Roosevelt' OR name = 'Roosevelt (Elevated)');

-- Clark/Lake (Elevated) - serves multiple lines in the Loop
UPDATE Station
SET lines = '["Blue", "Brown", "Green", "Orange", "Pink", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Clark/Lake (Elevated)';

-- Washington/Wabash - Loop station serving multiple lines
UPDATE Station
SET lines = '["Brown", "Green", "Orange", "Pink", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Washington/Wabash';

-- State/Lake - serves Red Line
UPDATE Station
SET lines = '["Red"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND (name = 'Lake (Subway)' OR name = 'State/Lake');

-- Chicago (Brown/Purple)
UPDATE Station
SET lines = '["Brown", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Chicago (Brown/Purple)';

-- Merchandise Mart (Brown/Purple)
UPDATE Station
SET lines = '["Brown", "Purple"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Merchandise Mart';

-- Clinton (Green/Pink)
UPDATE Station
SET lines = '["Green", "Pink"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Clinton (Green/Pink)';

-- Morgan (Green/Pink)
UPDATE Station
SET lines = '["Green", "Pink"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Morgan (Green/Pink)';

-- Ashland (Green/Pink)
UPDATE Station
SET lines = '["Green", "Pink"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Ashland (Green/Pink)';

-- Handle special cases where line isn't in parentheses
UPDATE Station
SET lines = '["Red"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name IN ('Addison', 'Argyle', 'Berwyn', 'Bryn Mawr', 'Cermak-Chinatown', 'Granville',
            'Jarvis', 'Lawrence', 'Loyola', 'Morse', 'North/Clybourn', 'Sheridan',
            'Thorndale', 'Wilson');

-- O'Hare (Blue Line terminus)
UPDATE Station
SET lines = '["Blue"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'O''Hare';

-- Midway (Orange Line terminus)
UPDATE Station
SET lines = '["Orange"]'
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
AND name = 'Midway';

-- Check results
SELECT name, lines, COUNT(*) as count
FROM Station
WHERE cityId = (SELECT id FROM City WHERE code = 'chicago')
GROUP BY lines
ORDER BY count DESC;