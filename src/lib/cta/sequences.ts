/**
 * CTA line topology, keyed by CTA station id (the ridership dataset's station_id).
 *
 * Each line is a set of branches. A branch is an ordered run of stations; together a line's
 * branches list each of its stations exactly once. Real forks are separate branches joined by a
 * junction (Green's Ashland/63rd and Cottage Grove branches leave the trunk at Garfield). The
 * Loop is a ring branch on the four lines that circle it (Brown, Orange, Pink, Purple); Green
 * runs only along Lake Street and Wabash, so its four Loop stations sit on its main branch.
 * Blue is one continuous branch from O'Hare to Forest Park, and the Purple Express is part of
 * Purple's main branch.
 *
 * Station.lines is derived from these branches, and scripts/seed-reference-data.ts writes them
 * to StationLineSequence, so the roster, the line lists, and the sequence table cannot disagree.
 */
import type { CTALine } from "../ctaLineColors";
import { CTA_LINE_ORDER } from "./normalizeStationLines";

export interface LineBranch {
    line: CTALine;
    branch: string;
    /** CTA station ids in travel order. */
    stations: readonly string[];
    /** The last station connects back to the first. */
    ring?: boolean;
}

/** A track connection from a branch end to other stations on the same line. */
export interface Junction {
    line: CTALine;
    from: string;
    to: readonly string[];
}

// Clockwise from Clark/Lake: Lake Street, Wabash, Van Buren, Wells.
const LOOP = [
    "40380", // Clark/Lake
    "40260", // State/Lake (closed since 2026-01-05)
    "41700", // Washington/Wabash
    "40680", // Adams/Wabash
    "40850", // Harold Washington Library-State/Van Buren
    "40160", // LaSalle/Van Buren
    "40040", // Quincy
    "40730", // Washington/Wells
] as const;

// Where each line's main branch meets the Loop: Tower 18 (Lake and Wells) sits between
// Washington/Wells and Clark/Lake; Tower 12 (Van Buren and Wabash) between Adams/Wabash and Library.
const TOWER_18 = ["40730", "40380"] as const;
const TOWER_12 = ["40850", "40680"] as const;

export const LINE_BRANCHES: readonly LineBranch[] = [
    {
        line: "Red",
        branch: "main",
        stations: [
            "40900", // Howard
            "41190", // Jarvis
            "40100", // Morse
            "41300", // Loyola
            "40760", // Granville
            "40880", // Thorndale
            "41380", // Bryn Mawr
            "40340", // Berwyn
            "41200", // Argyle
            "40770", // Lawrence
            "40540", // Wilson
            "40080", // Sheridan
            "41420", // Addison (Red)
            "41320", // Belmont
            "41220", // Fullerton
            "40650", // North/Clybourn
            "40630", // Clark/Division
            "41450", // Chicago (Red)
            "40330", // Grand (Red)
            "41660", // Lake
            "41090", // Monroe (Red)
            "40560", // Jackson (Red)
            "41490", // Harrison
            "41400", // Roosevelt
            "41000", // Cermak-Chinatown
            "40190", // Sox-35th
            "41230", // 47th (Red)
            "41170", // Garfield (Red)
            "40910", // 63rd
            "40990", // 69th
            "40240", // 79th
            "41430", // 87th
            "40450", // 95th/Dan Ryan
        ],
    },
    {
        line: "Blue",
        branch: "main",
        stations: [
            "40890", // O'Hare
            "40820", // Rosemont
            "40230", // Cumberland
            "40750", // Harlem (O'Hare branch)
            "41280", // Jefferson Park
            "41330", // Montrose (Blue)
            "40550", // Irving Park (Blue)
            "41240", // Addison (Blue)
            "40060", // Belmont (Blue)
            "41020", // Logan Square
            "40570", // California (Blue)
            "40670", // Western (O'Hare branch)
            "40590", // Damen (Blue)
            "40320", // Division
            "41410", // Chicago (Blue)
            "40490", // Grand (Blue)
            "40380", // Clark/Lake
            "40370", // Washington (Blue)
            "40790", // Monroe (Blue)
            "40070", // Jackson (Blue)
            "41340", // LaSalle
            "40430", // Clinton (Blue)
            "40350", // UIC-Halsted
            "40470", // Racine
            "40810", // Illinois Medical District
            "40220", // Western (Forest Park branch)
            "40250", // Kedzie-Homan
            "40920", // Pulaski (Blue)
            "40970", // Cicero (Blue)
            "40010", // Austin (Blue)
            "40180", // Oak Park (Blue)
            "40980", // Harlem (Forest Park branch)
            "40390", // Forest Park
        ],
    },
    {
        line: "Brown",
        branch: "main",
        stations: [
            "41290", // Kimball
            "41180", // Kedzie (Brown)
            "40870", // Francisco
            "41010", // Rockwell
            "41480", // Western (Brown)
            "40090", // Damen (Brown)
            "41500", // Montrose (Brown)
            "41460", // Irving Park (Brown)
            "41440", // Addison (Brown)
            "41310", // Paulina
            "40360", // Southport
            "41320", // Belmont
            "41210", // Wellington
            "40530", // Diversey
            "41220", // Fullerton
            "40660", // Armitage
            "40800", // Sedgwick
            "40710", // Chicago (Brown/Purple)
            "40460", // Merchandise Mart
        ],
    },
    { line: "Brown", branch: "loop", stations: LOOP, ring: true },
    {
        line: "Green",
        branch: "main",
        stations: [
            "40020", // Harlem/Lake
            "41350", // Oak Park (Green)
            "40610", // Ridgeland
            "41260", // Austin (Green)
            "40280", // Central (Green)
            "40700", // Laramie
            "40480", // Cicero (Green)
            "40030", // Pulaski (Green)
            "41670", // Conservatory-Central Park Drive
            "41070", // Kedzie (Green)
            "41360", // California (Green)
            "41710", // Damen (Green)
            "40170", // Ashland (Green/Pink)
            "41510", // Morgan
            "41160", // Clinton (Green/Pink)
            "40380", // Clark/Lake
            "40260", // State/Lake
            "41700", // Washington/Wabash
            "40680", // Adams/Wabash
            "41400", // Roosevelt
            "41690", // Cermak-McCormick Place
            "41120", // 35th-Bronzeville-IIT
            "40300", // Indiana
            "41270", // 43rd
            "41080", // 47th (Green)
            "40130", // 51st
            "40510", // Garfield (Green)
        ],
    },
    {
        line: "Green",
        branch: "ashland-63rd",
        stations: [
            "40940", // Halsted (Green)
            "40290", // Ashland/63rd
        ],
    },
    {
        line: "Green",
        branch: "cottage-grove",
        stations: [
            "41140", // King Drive
            "40720", // Cottage Grove
        ],
    },
    {
        line: "Orange",
        branch: "main",
        stations: [
            "40930", // Midway
            "40960", // Pulaski (Orange)
            "41150", // Kedzie (Orange)
            "40310", // Western (Orange)
            "40120", // 35th/Archer
            "41060", // Ashland (Orange)
            "41130", // Halsted (Orange)
            "41400", // Roosevelt
        ],
    },
    { line: "Orange", branch: "loop", stations: LOOP, ring: true },
    {
        line: "Purple",
        branch: "main",
        stations: [
            "41050", // Linden
            "41250", // Central (Purple)
            "40400", // Noyes
            "40520", // Foster
            "40050", // Davis
            "40690", // Dempster
            "40270", // Main
            "40840", // South Boulevard
            "40900", // Howard
            "40540", // Wilson
            "41320", // Belmont
            "41210", // Wellington
            "40530", // Diversey
            "41220", // Fullerton
            "40660", // Armitage
            "40800", // Sedgwick
            "40710", // Chicago (Brown/Purple)
            "40460", // Merchandise Mart
        ],
    },
    { line: "Purple", branch: "loop", stations: LOOP, ring: true },
    {
        line: "Pink",
        branch: "main",
        stations: [
            "40580", // 54th/Cermak
            "40420", // Cicero (Pink)
            "40600", // Kostner
            "40150", // Pulaski (Pink)
            "40780", // Central Park
            "41040", // Kedzie (Pink)
            "40440", // California (Pink)
            "40740", // Western (Pink)
            "40210", // Damen (Pink)
            "40830", // 18th
            "41030", // Polk
            "40170", // Ashland (Green/Pink)
            "41510", // Morgan
            "41160", // Clinton (Green/Pink)
        ],
    },
    { line: "Pink", branch: "loop", stations: LOOP, ring: true },
    {
        line: "Yellow",
        branch: "main",
        stations: [
            "40140", // Dempster-Skokie
            "41680", // Oakton-Skokie
            "40900", // Howard
        ],
    },
];

export const JUNCTIONS: readonly Junction[] = [
    { line: "Green", from: "40510", to: ["40940", "41140"] }, // Garfield to Halsted and King Drive
    { line: "Brown", from: "40460", to: TOWER_18 }, // Merchandise Mart
    { line: "Purple", from: "40460", to: TOWER_18 }, // Merchandise Mart
    { line: "Pink", from: "41160", to: TOWER_18 }, // Clinton
    { line: "Orange", from: "41400", to: TOWER_12 }, // Roosevelt
];

export interface LineNeighbors {
    prev: string[];
    next: string[];
}

function branchOf(ctaStationId: string, line: CTALine): LineBranch | undefined {
    return LINE_BRANCHES.find((b) => b.line === line && b.stations.includes(ctaStationId));
}

/**
 * Adjacent stations on one line, in travel order. Inside a branch there is at most one on each
 * side; at a branch end the junctions supply the rest (Garfield's next is Halsted and King Drive).
 * Returns null when the station is not on the line.
 */
export function neighborsOnLine(ctaStationId: string, line: CTALine): LineNeighbors | null {
    const branch = branchOf(ctaStationId, line);
    if (!branch) return null;

    const { stations } = branch;
    const i = stations.indexOf(ctaStationId);
    if (branch.ring) {
        return {
            prev: [stations[(i - 1 + stations.length) % stations.length]],
            next: [stations[(i + 1) % stations.length]],
        };
    }

    const junctions = JUNCTIONS.filter((j) => j.line === line);
    return {
        prev: i > 0 ? [stations[i - 1]] : junctions.filter((j) => j.to.includes(ctaStationId)).map((j) => j.from),
        next:
            i < stations.length - 1
                ? [stations[i + 1]]
                : junctions.filter((j) => j.from === ctaStationId).flatMap((j) => [...j.to]),
    };
}

/** A station is a terminal of a line when the line's track ends there. */
export function isTerminalOnLine(ctaStationId: string, line: CTALine): boolean {
    const neighbors = neighborsOnLine(ctaStationId, line);
    return neighbors !== null && (neighbors.prev.length === 0 || neighbors.next.length === 0);
}

/** The lines that serve a station, in canonical CTA order. */
export function linesForStation(ctaStationId: string): CTALine[] {
    return CTA_LINE_ORDER.filter((line) => branchOf(ctaStationId, line) !== undefined);
}

/** The station's first line in canonical CTA order, used where one line must stand for a hub. */
export function getPrimaryLine(lines: readonly string[]): CTALine | null {
    return CTA_LINE_ORDER.find((line) => lines.includes(line)) ?? null;
}

export interface SequenceRow {
    ctaStationId: string;
    line: CTALine;
    branch: string;
    seq: number;
}

/** The StationLineSequence rows, keyed by CTA station id. */
export function sequenceRows(): SequenceRow[] {
    return LINE_BRANCHES.flatMap(({ line, branch, stations }) =>
        stations.map((ctaStationId, seq) => ({ ctaStationId, line, branch, seq })),
    );
}

export interface PrimaryLineNeighbors {
    line: CTALine;
    prev: string | null;
    next: string | null;
}

/**
 * The stations before and after one on its primary line, for the detail route's neighbor pills.
 * At a fork or a Loop entry, the first station on that side stands for the rest.
 */
export function primaryLineNeighbors(ctaStationId: string, lines: readonly string[]): PrimaryLineNeighbors | null {
    const line = getPrimaryLine(lines);
    const neighbors = line ? neighborsOnLine(ctaStationId, line) : null;
    if (!line || !neighbors) return null;
    return { line, prev: neighbors.prev[0] ?? null, next: neighbors.next[0] ?? null };
}
