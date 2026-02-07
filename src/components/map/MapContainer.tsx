"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import Map, { Source, Layer, MapMouseEvent } from "react-map-gl/mapbox";
import type { FeatureCollection, Point, Feature, LineString } from "geojson";
import type { MapRef } from "react-map-gl/mapbox";
import MapTooltip from "./MapTooltip";
import StationMarker from "./StationMarker";
import StationList from "@/components/station/StationList";
import StationDetailPanel from "@/components/station/StationDetailPanel";
import LineFilter from "@/components/map/LineFilter";
import { useTheme } from "@/components/theme";
import { useIsMobile } from "@/hooks/useMediaQuery";
import MobileLayout from "@/components/mobile/MobileLayout";
import {
  explodeAndStitchSegments,
  isStationActiveByLineFilter,
  CTA_LINE_ORDER,
  CTA_LINE_COLORS
} from "@/lib/cta/explodeAndStitchSegments";
import { safeJsonParse } from "@/lib/utils";

// Zoom thresholds for progressive marker display
const MARKER_ZOOM_THRESHOLD = 12;        // Start showing markers
const MARKER_ZOOM_ALL_THRESHOLD = 14.5;  // Show all markers without filtering
const MIN_VIEWPORT_MARKERS = 6;          // Minimum markers to show in any viewport
const MAX_VIEWPORT_MARKERS_MEDIUM = 15;  // Max markers at medium zoom (12-13.5)
const MAX_VIEWPORT_MARKERS_HIGH = 25;    // Max markers at high zoom (13.5-14.5)

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const LINE_RENDER_ORDER = [...CTA_LINE_ORDER.filter(line => line !== "Red"), "Red"] as const;

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  trend: number | null;
  dataStatus?: 'available' | 'missing' | 'zero';
}

interface MapContainerProps {
  searchQuery?: string;
}

export default function MapContainer({ searchQuery = "" }: MapContainerProps) {
  const mapRef = useRef<MapRef>(null);
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [dataAsOf, setDataAsOf] = useState<string>("");
  const [trackSegments, setTrackSegments] = useState<FeatureCollection<LineString> | null>(null);
  const [mobileSearchQuery, setMobileSearchQuery] = useState("");

  // Line filter state - all lines active by default
  const [activeLines, setActiveLines] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    CTA_LINE_ORDER.forEach(line => {
      initial[line] = true;
    });
    return initial;
  });

  const [viewState, setViewState] = useState({
    latitude: 41.8781,
    longitude: -87.6298,
    zoom: 11.5,
    pitch: 0,
    bearing: 0,
  });

  // Fetch stations data
  useEffect(() => {
    fetch("/api/chicago/stations-raw?sort=ghost_score_desc")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load stations (${res.status})`);
        }
        return res.json();
      })
      .then((data) => {
        console.log("API Response:", data); // Debug log
        if (Array.isArray(data.stations)) {
          console.log(`Loaded ${data.stations.length} stations`); // Debug log
          setStations(data.stations);
          setDataAsOf(data.dataAsOf);
        } else if (data.error) {
          console.error("API Error:", data.error);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load stations:", err);
        setLoading(false);
      });
  }, []);

  // Load track segments
  useEffect(() => {
    fetch("/data/cta/chicago_track_segments.geojson")
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to load track segments (${res.status})`);
        }
        return res.json();
      })
      .then(data => {
        console.log("Loaded track segments:", data);
        setTrackSegments(data);
      })
      .catch(err => {
        console.error("Failed to load track segments:", err);
      });
  }, []);

  // Filter stations based on search
  const filteredStations = useMemo(() => {
    const query = (isMobile ? mobileSearchQuery : searchQuery).toLowerCase();
    if (!query) return stations;

    return stations.filter(
      (station) =>
        station.name.toLowerCase().includes(query) ||
        station.lines.some((line) => line.toLowerCase().includes(query))
    );
  }, [stations, searchQuery, mobileSearchQuery, isMobile]);

  // Create GeoJSON data with clean station names
  const geoJsonData: FeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection",
      features: filteredStations.map((station) => {
        // Clean station name by removing parenthetical line info like "(Blue)"
        const cleanName = station.name.replace(/\s*\([^)]*\)\s*$/, '').trim();
        
        return {
          type: "Feature",
          id: station.id, // Important for feature state
          geometry: {
            type: "Point",
            coordinates: [station.longitude, station.latitude],
          },
          properties: {
            ...station,
            cleanName, // Clean name without "(Blue)" etc
            lines: JSON.stringify(station.lines), // Serialize lines array for GeoJSON
            primaryLine: station.lines[0] || null, // For label coloring
            isActiveByLineFilter: isStationActiveByLineFilter(station.lines, activeLines),
          },
        };
      }),
    }),
    [filteredStations, activeLines]
  );

  // Process track segments with offsets and stitch contiguous segments
  const explodedTracks = useMemo(() => {
    if (!trackSegments) return null;

    // Only stitch Loop segments for safety (stitchOnlyLoop = true by default)
    return explodeAndStitchSegments(
      trackSegments as FeatureCollection<LineString, { segment_id: string; corridor: string; is_loop: boolean; lines: string[] }>,
      activeLines,
      5.0,
      3.0,
      true
    );

    // If stitching causes issues, uncomment this to use simple explosion:
    // return explodeSegments(trackSegments as any, activeLines);
  }, [trackSegments, activeLines]);

  const handleStationClick = (station: Station) => {
    // Clear previous selection
    if (selectedStation && mapRef.current) {
      mapRef.current.setFeatureState(
        { source: "stations", id: selectedStation.id },
        { selected: false }
      );
    }

    // Always use the station from the main stations array to ensure consistency
    const stationFromMainList = stations.find(s => s.id === station.id);
    const stationToSelect = stationFromMainList || station;

    // Set new selection
    setSelectedStation(stationToSelect);

    // Set feature state for selected station
    if (mapRef.current) {
      mapRef.current.setFeatureState(
        { source: "stations", id: station.id },
        { selected: true }
      );
    }

    // Smooth pan to station
    setViewState({
      ...viewState,
      latitude: station.latitude,
      longitude: station.longitude,
      zoom: 14,
    });
  };

  // Handle station selection by ID (for neighbor navigation)
  const handleStationSelectById = (stationId: string) => {
    const station = stations.find(s => s.id === stationId);
    if (station) {
      handleStationClick(station);
    }
  };

  const handleToggleLine = (line: string) => {
    setActiveLines(prev => ({
      ...prev,
      [line]: !prev[line]
    }));
  };

  const handleClearAllLines = () => {
    const newActiveLines: Record<string, boolean> = {};
    CTA_LINE_ORDER.forEach(line => {
      newActiveLines[line] = false;
    });
    setActiveLines(newActiveLines);
  };

  const handleSelectAllLines = () => {
    const newActiveLines: Record<string, boolean> = {};
    CTA_LINE_ORDER.forEach(line => {
      newActiveLines[line] = true;
    });
    setActiveLines(newActiveLines);
  };

  // Mobile layout
  if (isMobile) {
    const selectedLinesArray = Object.entries(activeLines)
      .filter(([, isActive]) => isActive)
      .map(([line]) => line);

    return (
      <MobileLayout
        stations={filteredStations}
        searchQuery={mobileSearchQuery}
        onSearchChange={setMobileSearchQuery}
        selectedLines={selectedLinesArray}
        onLineToggle={handleToggleLine}
        onClearAllLines={handleClearAllLines}
        onSelectAllLines={handleSelectAllLines}
        stationsGeoJson={geoJsonData}
        lineGeoJson={explodedTracks}
      />
    );
  }

  // Desktop layout
  return (
    <>
      {/* Glass Station List */}
      <StationList
        stations={filteredStations}
        selectedStationId={selectedStation?.id}
        onStationSelect={handleStationClick}
        dataAsOf={dataAsOf}
        loading={loading}
      />

      {/* Line Filter */}
      <LineFilter
        activeLines={activeLines}
        onToggleLine={handleToggleLine}
      />

      {/* Map */}
      <div className="absolute inset-0">
        {loading ? (
          <div className="w-full h-full bg-neutral-bg flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-brandIndigo/20 to-emerald-500/20 animate-ghost-pulse" />
              <p className="text-text-secondary">Loading stations...</p>
            </div>
          </div>
        ) : (
          <Map
            ref={mapRef}
            {...viewState}
            onMove={(evt) => setViewState(evt.viewState)}
            style={{ width: "100%", height: "100%" }}
            mapStyle={theme === "dark" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11"}
            mapboxAccessToken={MAPBOX_TOKEN}
            interactiveLayerIds={["stations-circle", "stations-halo"]}
            onMouseMove={(e: MapMouseEvent) => {
              const feature = e.features?.[0] as Feature<Point> | undefined;
              if (feature && feature.properties) {
                const props = feature.properties;
                // Parse the serialized lines array
                const station: Station = {
                  ...props as Station,
                  lines: typeof props.lines === 'string'
                    ? safeJsonParse<string[]>(props.lines, [])
                    : props.lines || [],
                };
                setHoveredStation(station);
                setMousePosition({ x: e.point.x, y: e.point.y });
              } else {
                setHoveredStation(null);
              }
            }}
            onClick={(e: MapMouseEvent) => {
              // Only handle clicks on circle layers when markers aren't shown
              if (viewState.zoom >= MARKER_ZOOM_THRESHOLD) {
                return; // Let marker onClick handlers handle it
              }

              const feature = e.features?.[0] as Feature<Point> | undefined;
              if (feature && feature.properties) {
                const props = feature.properties;
                // Parse the serialized lines array
                const station: Station = {
                  ...props as Station,
                  lines: typeof props.lines === 'string'
                    ? safeJsonParse<string[]>(props.lines, [])
                    : props.lines || [],
                };
                handleStationClick(station);
              }
            }}
          >
            {/* CTA Track Lines */}
            {explodedTracks && (
              <Source id="cta-tracks" type="geojson" data={explodedTracks}>
                {/* Render casing layers first, then core layers */}
                {LINE_RENDER_ORDER.map(line => (
                  <Layer
                    key={`casing-${line}`}
                    id={`cta-line-casing-${line}`}
                    type="line"
                    filter={["==", ["get", "line"], line]}
                    layout={{
                      "line-cap": "round",
                      "line-join": "round",
                    }}
                    paint={{
                      "line-color": "rgba(11,18,32,0.15)",
                      "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10, ["case", ["get", "is_loop"], 2.2, 2.8],
                        12, ["case", ["get", "is_loop"], 2.8, 3.2],
                        14, ["case", ["get", "is_loop"], 3.5, 4.0]
                      ],
                      "line-opacity": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10, ["case", ["get", "is_loop"], 0.20, 0.30],
                        11, ["case", ["get", "is_loop"], 0.25, 0.35],
                        12, ["case", ["get", "is_loop"], 0.30, 0.40]
                      ],
                      "line-blur": 0.05,
                      "line-offset": ["get", "offset_px"]
                    }}
                  />
                ))}
                {LINE_RENDER_ORDER.map(line => (
                  <Layer
                    key={`core-${line}`}
                    id={`cta-line-core-${line}`}
                    type="line"
                    filter={["==", ["get", "line"], line]}
                    layout={{
                      "line-cap": "round",
                      "line-join": "round",
                    }}
                    paint={{
                      "line-color": CTA_LINE_COLORS[line],
                      "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10, ["case", ["get", "is_loop"], 1.4, 1.8],
                        12, ["case", ["get", "is_loop"], 2.0, 2.6],
                        14, ["case", ["get", "is_loop"], 3.0, 3.8]
                      ],
                      "line-opacity": 1,  // Full opacity for crisp lines
                      "line-offset": ["get", "offset_px"]
                    }}
                  />
                ))}
              </Source>
            )}

            <Source id="stations" type="geojson" data={geoJsonData}>
              {/* Station Drop Shadow - fade out as markers appear */}
              <Layer
                id="stations-shadow"
                type="circle"
                maxzoom={13}
                paint={{
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10, 5,
                    13, 7,
                  ],
                  "circle-color": "rgba(11, 18, 32, 0.12)",
                  "circle-blur": 0.6,
                  "circle-translate": [0.5, 1],
                  "circle-opacity": [
                    "case",
                    ["get", "isActiveByLineFilter"], 1,
                    0.15
                  ]
                }}
              />

              {/* Ghost Halo Layer - fade out as markers appear */}
              <Layer
                id="stations-halo"
                type="circle"
                maxzoom={12}
                paint={{
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10,
                    ["*", 1.3, ["interpolate", ["linear"], ["get", "ghostScore"], 0, 6, 100, 12]],
                    13,
                    ["*", 1.5, ["interpolate", ["linear"], ["get", "ghostScore"], 0, 7, 100, 14]],
                  ],
                  "circle-color": [
                    "case",
                    ["==", ["get", "dataStatus"], "missing"], "rgba(156, 163, 175, 0.10)",
                    [
                      "interpolate",
                      ["linear"],
                      ["get", "ghostScore"],
                      0, "rgba(34, 197, 94, 0.08)",
                      20, "rgba(132, 204, 22, 0.10)",
                      40, "rgba(245, 158, 11, 0.14)",
                      60, "rgba(234, 88, 12, 0.18)",
                      80, "rgba(220, 38, 38, 0.22)",
                    ]
                  ],
                  "circle-blur": 0.7,
                  "circle-opacity": [
                    "case",
                    ["get", "isActiveByLineFilter"], 1,
                    0.03
                  ]
                }}
              />

              {/* Main Station Dots - fade out as markers appear */}
              <Layer
                id="stations-circle"
                type="circle"
                maxzoom={12}
                paint={{
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10, 4,
                    13, 6,
                  ],
                  "circle-color": [
                    "case",
                    ["==", ["get", "dataStatus"], "missing"], "#9CA3AF",
                    [
                      "interpolate",
                      ["linear"],
                      ["get", "ghostScore"],
                      0, "#22C55E",
                      20, "#84CC16",
                      40, "#F59E0B",
                      60, "#EA580C",
                      80, "#DC2626",
                    ]
                  ],
                  "circle-stroke-width": [
                    "case",
                    ["boolean", ["feature-state", "selected"], false],
                    2.5,
                    1.5,
                  ],
                  "circle-stroke-color": "#FFFFFF",
                  "circle-stroke-opacity": 0.95,
                  "circle-opacity": [
                    "case",
                    ["get", "isActiveByLineFilter"], 1,
                    0.2
                  ]
                }}
              />
            </Source>

            {/* Station Markers with Labels - viewport-aware progressive display */}
            {(viewState.zoom >= MARKER_ZOOM_THRESHOLD || selectedStation) && (() => {
              // If we're below zoom threshold, only show selected station
              if (viewState.zoom < MARKER_ZOOM_THRESHOLD && selectedStation) {
                return (
                  <StationMarker
                    key={selectedStation.id}
                    station={selectedStation}
                    onClick={handleStationClick}
                    isSelected={true}
                    showGhostIcon={selectedStation.ghostScore >= 65}
                    zoomLevel={viewState.zoom}
                  />
                );
              }

              // STEP 1: Start with all filtered stations, but ALWAYS include selected station
              const candidateStations = [...filteredStations];
              
              // Ensure selected station is in candidates before ANY filtering
              if (selectedStation && !candidateStations.some(s => s.id === selectedStation.id)) {
                const fullSelected = stations.find(s => s.id === selectedStation.id);
                if (fullSelected) {
                  candidateStations.push(fullSelected);
                } else {
                  candidateStations.push(selectedStation);
                }
              }
              
              // STEP 2: Filter by active lines, but ALWAYS keep selected station
              const activeStations = candidateStations.filter(station => 
                station.id === selectedStation?.id || // Always include selected
                isStationActiveByLineFilter(station.lines, activeLines)
              );
              
              // STEP 3: Filter by viewport bounds, but ALWAYS keep selected station
              const bounds = mapRef.current?.getBounds();
              const visibleStations = bounds 
                ? activeStations.filter(station => 
                    station.id === selectedStation?.id || // Always include selected
                    bounds.contains([station.longitude, station.latitude])
                  )
                : activeStations;
              
              // STEP 4: Determine how many markers to show based on zoom level
              const showAllMarkers = viewState.zoom >= MARKER_ZOOM_ALL_THRESHOLD;
              let maxMarkers: number;
              if (showAllMarkers) {
                maxMarkers = Infinity;
              } else if (viewState.zoom >= 13.5) {
                maxMarkers = MAX_VIEWPORT_MARKERS_HIGH;
              } else {
                maxMarkers = MAX_VIEWPORT_MARKERS_MEDIUM;
              }
              
              // STEP 5: Smart filtering with ghost score priority
              let stationsToShow: Station[];
              
              if (showAllMarkers || visibleStations.length <= maxMarkers) {
                stationsToShow = visibleStations;
              } else {
                // Separate selected station from the rest for priority sorting
                const selectedInVisible = visibleStations.find(s => s.id === selectedStation?.id);
                const otherStations = visibleStations.filter(s => s.id !== selectedStation?.id);
                
                // Sort others by ghost score descending
                const sortedByGhost = [...otherStations].sort((a, b) => b.ghostScore - a.ghostScore);
                
                // Take top ghost score stations (reserve 1 slot for selected if needed)
                const slotsForOthers = selectedInVisible ? maxMarkers - 1 : maxMarkers;
                stationsToShow = sortedByGhost.slice(0, slotsForOthers);
                
                // ALWAYS add selected station first (renders on top due to array order)
                if (selectedInVisible) {
                  stationsToShow.unshift(selectedInVisible);
                }
                
                // Ensure minimum coverage
                if (stationsToShow.length < MIN_VIEWPORT_MARKERS && visibleStations.length >= MIN_VIEWPORT_MARKERS) {
                  const needed = MIN_VIEWPORT_MARKERS - stationsToShow.length;
                  const additional = sortedByGhost.slice(slotsForOthers, slotsForOthers + needed);
                  stationsToShow.push(...additional);
                }
              }
              
              // STEP 6: Final safety check - selected station MUST be shown
              if (selectedStation && !stationsToShow.some(s => s.id === selectedStation.id)) {
                const fullStation = stations.find(s => s.id === selectedStation.id) || selectedStation;
                stationsToShow.unshift(fullStation);
              }
              
              // Render all stations with proper selection state
              return stationsToShow.map((station) => (
                <StationMarker
                  key={station.id}
                  station={station}
                  onClick={handleStationClick}
                  isSelected={selectedStation?.id === station.id}
                  showGhostIcon={station.ghostScore >= 65}
                  zoomLevel={viewState.zoom}
                />
              ));
            })()}

            {/* Tooltip - only show when not using markers */}
            {hoveredStation && viewState.zoom < MARKER_ZOOM_THRESHOLD && (
              <MapTooltip
                station={hoveredStation}
                x={mousePosition.x}
                y={mousePosition.y}
              />
            )}
          </Map>
        )}
      </div>

      {/* Station Detail Panel */}
      <AnimatePresence mode="wait">
        {selectedStation && (
          <StationDetailPanel
            key={selectedStation.id}
            station={selectedStation}
            onClose={() => setSelectedStation(null)}
            onStationSelect={handleStationSelectById}
          />
        )}
      </AnimatePresence>
    </>
  );
}
