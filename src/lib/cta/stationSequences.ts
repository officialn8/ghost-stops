/**
 * CTA Station Sequences
 *
 * Ordered arrays of station names per CTA rail line.
 * Used for finding neighbor stations on the same line.
 *
 * Station names should match the normalized names in the database.
 * Multi-line stations appear in each line's sequence.
 */

export const CTA_STATION_SEQUENCES: Record<string, string[]> = {
  Red: [
    "Howard",
    "Jarvis",
    "Morse",
    "Loyola",
    "Granville",
    "Thorndale",
    "Bryn Mawr",
    "Berwyn",
    "Argyle",
    "Lawrence",
    "Wilson",
    "Sheridan",
    "Addison",
    "Belmont",
    "Fullerton",
    "North/Clybourn",
    "Clark/Division",
    "Chicago",
    "Grand",
    "Lake",
    "Monroe",
    "Jackson",
    "Harrison",
    "Roosevelt",
    "Cermak-Chinatown",
    "Sox-35th",
    "47th",
    "Garfield",
    "63rd",
    "69th",
    "79th",
    "87th",
    "95th/Dan Ryan"
  ],

  Blue: [
    // O'Hare Branch
    "O'Hare",
    "Rosemont",
    "Cumberland",
    "Harlem",
    "Jefferson Park",
    "Montrose",
    "Irving Park",
    "Addison",
    "Belmont",
    "Logan Square",
    "California",
    "Western",
    "Damen",
    "Division",
    "Chicago",
    "Grand",
    "Clark/Lake",
    "Washington",
    "Monroe",
    "Jackson",
    "LaSalle",
    "Clinton",
    "UIC-Halsted",
    "Racine",
    "Illinois Medical District",
    "Western",
    "Kedzie-Homan",
    "Pulaski",
    "Cicero",
    "Austin",
    "Oak Park",
    "Harlem",
    "Forest Park"
  ],

  Brown: [
    "Kimball",
    "Kedzie",
    "Francisco",
    "Rockwell",
    "Western",
    "Damen",
    "Montrose",
    "Irving Park",
    "Addison",
    "Paulina",
    "Southport",
    "Belmont",
    "Wellington",
    "Diversey",
    "Fullerton",
    "Armitage",
    "Sedgwick",
    "Chicago",
    "Merchandise Mart",
    "Washington/Wells",
    "Quincy",
    "LaSalle/Van Buren",
    "Harold Washington Library-State/Van Buren",
    "Adams/Wabash",
    "Washington/Wabash",
    "State/Lake",
    "Clark/Lake"
  ],

  Green: [
    // Harlem Branch
    "Harlem/Lake",
    "Oak Park",
    "Ridgeland",
    "Austin",
    "Central",
    "Laramie",
    "Cicero",
    "Pulaski",
    "Conservatory-Central Park Drive",
    "Kedzie",
    "California",
    "Ashland",
    "Morgan",
    "Clinton",
    "Clark/Lake",
    "State/Lake",
    "Washington/Wabash",
    "Adams/Wabash",
    "Roosevelt",
    "Cermak-McCormick Place",
    "35th-Bronzeville-IIT",
    "Indiana",
    "43rd",
    "47th",
    "51st",
    "Garfield",
    "King Drive",
    "Cottage Grove"
    // Ashland/63rd branch stations omitted (mostly similar)
  ],

  Orange: [
    "Midway",
    "Pulaski",
    "Kedzie",
    "Western",
    "35th/Archer",
    "Ashland",
    "Halsted",
    "Roosevelt",
    "Harold Washington Library-State/Van Buren",
    "LaSalle/Van Buren",
    "Quincy",
    "Washington/Wells",
    "Clark/Lake",
    "State/Lake",
    "Washington/Wabash",
    "Adams/Wabash"
  ],

  Purple: [
    "Linden",
    "Central",
    "Noyes",
    "Foster",
    "Davis",
    "Dempster",
    "Main",
    "South Boulevard",
    "Howard",
    // Purple Express continues to Loop during rush hours
    "Wilson",
    "Belmont",
    "Wellington",
    "Diversey",
    "Fullerton",
    "Armitage",
    "Sedgwick",
    "Chicago",
    "Merchandise Mart",
    "Clark/Lake",
    "State/Lake",
    "Washington/Wabash",
    "Adams/Wabash",
    "Harold Washington Library-State/Van Buren",
    "LaSalle/Van Buren",
    "Quincy",
    "Washington/Wells"
  ],

  Pink: [
    "54th/Cermak",
    "Cicero",
    "Kostner",
    "Pulaski",
    "Central Park",
    "Kedzie",
    "California",
    "Western",
    "Damen",
    "18th",
    "Polk",
    "Ashland",
    "Morgan",
    "Clinton",
    "Clark/Lake",
    "State/Lake",
    "Washington/Wabash",
    "Adams/Wabash",
    "Harold Washington Library-State/Van Buren",
    "LaSalle/Van Buren",
    "Quincy",
    "Washington/Wells"
  ],

  Yellow: [
    "Dempster-Skokie",
    "Oakton-Skokie",
    "Howard"
  ]
};

/**
 * Normalized station name lookup
 * Maps common variations to canonical names
 */
const STATION_NAME_ALIASES: Record<string, string> = {
  "95th": "95th/Dan Ryan",
  "Dan Ryan": "95th/Dan Ryan",
  "Sox 35th": "Sox-35th",
  "35th Sox": "Sox-35th",
  "Chinatown": "Cermak-Chinatown",
  "Library": "Harold Washington Library-State/Van Buren",
  "State/Van Buren": "Harold Washington Library-State/Van Buren",
  "UIC Halsted": "UIC-Halsted",
  "IIT": "35th-Bronzeville-IIT",
  "Bronzeville": "35th-Bronzeville-IIT",
  "McCormick Place": "Cermak-McCormick Place",
  "Conservatory": "Conservatory-Central Park Drive",
};

/**
 * Normalize a station name to match our sequences
 */
function normalizeStationName(name: string): string {
  // Check aliases first
  const alias = STATION_NAME_ALIASES[name];
  if (alias) return alias;

  // Basic normalization
  return name
    .replace(/\s*\([^)]*\)\s*/g, '') // Remove parentheticals like (Blue Line)
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NeighborInfo {
  line: string;
  prev: string | null;
  next: string | null;
}

/**
 * Find neighbor stations for a given station on all its lines
 */
export function findNeighbors(stationName: string, stationLines: string[]): NeighborInfo[] {
  const normalizedName = normalizeStationName(stationName);
  const neighbors: NeighborInfo[] = [];

  for (const line of stationLines) {
    const sequence = CTA_STATION_SEQUENCES[line];
    if (!sequence) continue;

    // Find the station in this line's sequence
    const index = sequence.findIndex(s =>
      normalizeStationName(s) === normalizedName ||
      s.toLowerCase().includes(normalizedName.toLowerCase()) ||
      normalizedName.toLowerCase().includes(s.toLowerCase())
    );

    if (index === -1) continue;

    neighbors.push({
      line,
      prev: index > 0 ? sequence[index - 1] : null,
      next: index < sequence.length - 1 ? sequence[index + 1] : null,
    });
  }

  return neighbors;
}

/**
 * Get the primary line for a station (first in canonical order)
 */
export function getPrimaryLine(lines: string[]): string | null {
  const lineOrder = ["Red", "Blue", "Brown", "Green", "Orange", "Purple", "Pink", "Yellow"];
  for (const line of lineOrder) {
    if (lines.includes(line)) return line;
  }
  return lines[0] || null;
}
