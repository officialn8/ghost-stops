// CTA Line Colors - Official branding colors
export const ctaLineColors = {
  Red: '#C60C30',
  Blue: '#00A1DE',
  Brown: '#62361B',
  Green: '#009B3A',
  Orange: '#F9461C',
  Purple: '#522398',
  Pink: '#E27EA6',
  Yellow: '#F9E300',
} as const;

export type CTALine = keyof typeof ctaLineColors;

// Get color for a line
export function getLineColor(line: string): string {
  return ctaLineColors[line as CTALine] || '#666666';
}

// Mock line data for stations based on common patterns
// This will be replaced once the ETL properly loads line data
export function getMockLinesForStation(stationName: string): string[] {
  const linePatterns: Record<string, string[]> = {
    // Loop stations
    'Adams/Wabash': ['Brown', 'Green', 'Orange', 'Pink', 'Purple'],
    'Washington/Wabash': ['Brown', 'Green', 'Orange', 'Pink', 'Purple'],
    'Madison/Wabash': ['Brown', 'Green', 'Orange', 'Pink', 'Purple'],
    'Randolph/Wabash': ['Brown', 'Green', 'Orange', 'Pink', 'Purple'],
    'State/Lake': ['Brown', 'Green', 'Orange', 'Pink', 'Purple'],
    'Clark/Lake': ['Blue', 'Brown', 'Green', 'Orange', 'Pink', 'Purple'],
    'LaSalle/Van Buren': ['Brown', 'Orange', 'Pink', 'Purple'],
    'Harold Washington Library': ['Brown', 'Orange', 'Pink', 'Purple'],
    'Quincy/Wells': ['Brown', 'Orange', 'Pink', 'Purple'],
    'Washington/Wells': ['Brown', 'Orange', 'Pink', 'Purple'],

    // Red Line
    'Howard': ['Red', 'Purple', 'Yellow'],
    'Jarvis': ['Red'],
    'Morse': ['Red'],
    'Loyola': ['Red'],
    'Granville': ['Red'],
    'Thorndale': ['Red'],
    'Bryn Mawr': ['Red'],
    'Berwyn': ['Red'],
    'Argyle': ['Red'],
    'Lawrence': ['Red'],
    'Wilson': ['Red', 'Purple'],
    'Sheridan': ['Red'],
    'Addison': ['Red'],
    'Belmont': ['Red', 'Brown', 'Purple'],
    'Fullerton': ['Red', 'Brown', 'Purple'],
    'North/Clybourn': ['Red'],
    'Chicago': ['Red', 'Brown'],
    'Grand': ['Red'],
    'Lake': ['Red'],
    'Monroe': ['Red'],
    'Jackson': ['Red'],
    'Harrison': ['Red'],
    'Roosevelt': ['Red', 'Green', 'Orange'],
    'Cermak-Chinatown': ['Red'],
    'Sox-35th': ['Red'],
    'Garfield': ['Red'],

    // Blue Line
    'O\'Hare': ['Blue'],
    'Rosemont': ['Blue'],
    'Cumberland': ['Blue'],
    'Harlem': ['Blue'],
    'Jefferson Park': ['Blue'],
    'Montrose': ['Blue'],
    'Irving Park': ['Blue'],
    'Addison': ['Blue'],
    'Belmont': ['Blue'],
    'Logan Square': ['Blue'],
    'California': ['Blue'],
    'Western': ['Blue'],
    'Damen': ['Blue'],
    'Division': ['Blue'],
    'Chicago': ['Blue'],
    'Grand': ['Blue'],
    'Jackson': ['Blue'],
    'Monroe': ['Blue'],
    'Washington': ['Blue'],
    'LaSalle': ['Blue'],
    'Clinton': ['Blue'],
    'UIC-Halsted': ['Blue'],
    'Racine': ['Blue'],
    'Illinois Medical District': ['Blue'],
    'Western': ['Blue'],
    'Kedzie-Homan': ['Blue'],
    'Pulaski': ['Blue'],
    'Cicero': ['Blue'],
    'Austin': ['Blue'],
    'Oak Park': ['Blue'],
    'Harlem': ['Blue'],
    'Forest Park': ['Blue'],

    // Green Line
    'Harlem/Lake': ['Green'],
    'Oak Park': ['Green'],
    'Ridgeland': ['Green'],
    'Austin': ['Green'],
    'Central': ['Green'],
    'Laramie': ['Green'],
    'Cicero': ['Green'],
    'Pulaski': ['Green'],
    'Conservatory': ['Green'],
    'Kedzie': ['Green'],
    'California': ['Green'],
    'Ashland': ['Green'],
    'Morgan': ['Green'],
    'Clinton': ['Green'],
    'Cermak-McCormick Place': ['Green'],
    '35-Bronzeville-IIT': ['Green'],
    'Indiana': ['Green'],
    '43rd': ['Green'],
    '47th': ['Green'],
    '51st': ['Green'],
    'Garfield': ['Green'],
    'King Drive': ['Green'],
    'Cottage Grove': ['Green'],
    'Halsted': ['Green'],
    'Ashland/63rd': ['Green'],

    // Orange Line
    'Midway': ['Orange'],
    'Pulaski': ['Orange'],
    'Kedzie': ['Orange'],
    '35th/Archer': ['Orange'],
    'Western': ['Orange'],
    'Ashland': ['Orange'],
    'Halsted': ['Orange'],

    // Brown Line
    'Kimball': ['Brown'],
    'Kedzie': ['Brown'],
    'Francisco': ['Brown'],
    'Rockwell': ['Brown'],
    'Western': ['Brown'],
    'Damen': ['Brown'],
    'Montrose': ['Brown'],
    'Irving Park': ['Brown'],
    'Addison': ['Brown'],
    'Paulina': ['Brown'],
    'Southport': ['Brown'],
    'Wellington': ['Brown'],
    'Diversey': ['Brown'],
    'Armitage': ['Brown'],
    'Sedgwick': ['Brown'],
    'Chicago': ['Brown'],
    'Merchandise Mart': ['Brown', 'Purple'],

    // Purple Line
    'Linden': ['Purple'],
    'Central': ['Purple'],
    'Noyes': ['Purple'],
    'Foster': ['Purple'],
    'Davis': ['Purple'],
    'Dempster': ['Purple'],
    'Main': ['Purple'],
    'South Boulevard': ['Purple'],

    // Pink Line
    'Polk': ['Pink'],
    'Ashland': ['Pink'],
    'Morgan': ['Pink'],
    'Clinton': ['Pink'],
    '54th/Cermak': ['Pink'],
    'Cicero': ['Pink'],
    'Kostner': ['Pink'],
    'Pulaski': ['Pink'],
    'Central Park': ['Pink'],
    'Kedzie': ['Pink'],
    'California': ['Pink'],
    'Western': ['Pink'],
    'Damen': ['Pink'],
    '18th': ['Pink'],

    // Yellow Line
    'Dempster-Skokie': ['Yellow'],
    'Oakton-Skokie': ['Yellow'],
  };

  // Check for exact match
  if (linePatterns[stationName]) {
    return linePatterns[stationName];
  }

  // Check for partial matches
  for (const [pattern, lines] of Object.entries(linePatterns)) {
    if (stationName.includes(pattern) || pattern.includes(stationName)) {
      return lines;
    }
  }

  // Check for line suffixes in the station name
  const lineSuffixes = {
    '-Red': ['Red'],
    '-Blue': ['Blue'],
    '-Brown': ['Brown'],
    '-Green': ['Green'],
    '-Orange': ['Orange'],
    '-Purple': ['Purple'],
    '-Pink': ['Pink'],
    '-Yellow': ['Yellow'],
  };

  for (const [suffix, lines] of Object.entries(lineSuffixes)) {
    if (stationName.includes(suffix)) {
      return lines;
    }
  }

  // Default to Red Line if no match found
  return ['Red'];
}