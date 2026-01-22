"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Map, { Source, Layer, MapMouseEvent } from "react-map-gl/mapbox";
import type { FeatureCollection, Point, Feature, LineString } from "geojson";
import type { MapRef } from "react-map-gl/mapbox";
import MapTooltip from "./MapTooltip";
import StationList from "@/components/station/StationList";
import StationDetailPanel from "@/components/station/StationDetailPanel";
import LineFilter from "@/components/map/LineFilter";
import { getGhostScoreColor } from "@/lib/utils";
import {
  explodeAndStitchSegments,
  explodeSegments,
  isStationActiveByLineFilter,
  CTA_LINE_ORDER,
  CTA_LINE_COLORS
} from "@/lib/cta/explodeAndStitchSegments";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  lines: string[];
  ghostScore: number;
  rolling30dAvg: number;
  lastDayEntries: number;
  dataStatus?: 'available' | 'missing' | 'zero';
}

interface MapContainerProps {
  searchQuery?: string;
}

export default function MapContainer({ searchQuery = "" }: MapContainerProps) {
  const mapRef = useRef<MapRef>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [dataAsOf, setDataAsOf] = useState<string>("");
  const [trackSegments, setTrackSegments] = useState<FeatureCollection<LineString> | null>(null);

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
      .then((res) => res.json())
      .then((data) => {
        console.log("API Response:", data); // Debug log
        if (data.stations) {
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
      .then(res => res.json())
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
    if (!searchQuery) return stations;

    const query = searchQuery.toLowerCase();
    return stations.filter(
      (station) =>
        station.name.toLowerCase().includes(query) ||
        station.lines.some((line) => line.toLowerCase().includes(query))
    );
  }, [stations, searchQuery]);

  // Create GeoJSON data
  const geoJsonData: FeatureCollection = useMemo(
    () => ({
      type: "FeatureCollection",
      features: filteredStations.map((station) => ({
        type: "Feature",
        id: station.id, // Important for feature state
        geometry: {
          type: "Point",
          coordinates: [station.longitude, station.latitude],
        },
        properties: {
          ...station,
          lines: JSON.stringify(station.lines), // Serialize lines array for GeoJSON
          isActiveByLineFilter: isStationActiveByLineFilter(station.lines, activeLines),
        },
      })),
    }),
    [filteredStations, activeLines]
  );

  // Process track segments with offsets and stitch contiguous segments
  const explodedTracks = useMemo(() => {
    if (!trackSegments) return null;

    // Only stitch Loop segments for safety (stitchOnlyLoop = true by default)
    return explodeAndStitchSegments(trackSegments as any, activeLines);

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

    // Set new selection
    setSelectedStation(station);

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

  const handleToggleLine = (line: string) => {
    setActiveLines(prev => ({
      ...prev,
      [line]: !prev[line]
    }));
  };

  return (
    <>
      {/* Glass Station List */}
      <StationList
        stations={filteredStations}
        selectedStationId={selectedStation?.id}
        onStationSelect={handleStationClick}
        dataAsOf={dataAsOf}
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
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-spectral-500/20 to-aurora-500/20 animate-ghost-pulse" />
              <p className="text-text-secondary">Loading stations...</p>
            </div>
          </div>
        ) : (
          <Map
            ref={mapRef}
            {...viewState}
            onMove={(evt) => setViewState(evt.viewState)}
            style={{ width: "100%", height: "100%" }}
            mapStyle="mapbox://styles/mapbox/light-v11"
            mapboxAccessToken={MAPBOX_TOKEN}
            interactiveLayerIds={["stations-circle", "stations-halo"]}
            onMouseMove={(e: MapMouseEvent) => {
              const feature = e.features?.[0] as Feature<Point> | undefined;
              if (feature && feature.properties) {
                const props = feature.properties;
                // Parse the serialized lines array
                const station: Station = {
                  ...props as any,
                  lines: typeof props.lines === 'string' ? JSON.parse(props.lines) : props.lines || [],
                };
                setHoveredStation(station);
                setMousePosition({ x: e.point.x, y: e.point.y });
              } else {
                setHoveredStation(null);
              }
            }}
            onClick={(e: MapMouseEvent) => {
              const feature = e.features?.[0] as Feature<Point> | undefined;
              if (feature && feature.properties) {
                const props = feature.properties;
                // Parse the serialized lines array
                const station: Station = {
                  ...props as any,
                  lines: typeof props.lines === 'string' ? JSON.parse(props.lines) : props.lines || [],
                };
                handleStationClick(station);
              }
            }}
          >
            {/* CTA Track Lines */}
            {explodedTracks && (
              <Source id="cta-tracks" type="geojson" data={explodedTracks}>
                {/* Render casing layers first, then core layers */}
                {CTA_LINE_ORDER.map(line => (
                  <Layer
                    key={`casing-${line}`}
                    id={`cta-line-casing-${line}`}
                    type="line"
                    filter={["==", ["get", "line"], line]}
                    layout={{
                      "line-cap": "round",
                      "line-join": "round",
                      "line-miter-limit": 2,
                      "line-round-limit": 1.5
                    }}
                    paint={{
                      "line-color": "rgba(11,18,32,0.22)",
                      "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10, ["case", ["get", "is_loop"], 3.825, 4.5],
                        12, ["case", ["get", "is_loop"], 4.675, 5.5],
                        14, ["case", ["get", "is_loop"], 6.375, 7.5]
                      ],
                      "line-opacity": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10, ["case", ["get", "is_loop"], 0.48, 0.72],    // 0.6 * 0.8 for loop, 0.9 * 0.8 for regular
                        11, ["case", ["get", "is_loop"], 0.51, 0.765],   // 0.6 * 0.85 for loop, 0.9 * 0.85 for regular
                        12, ["case", ["get", "is_loop"], 0.6, 0.9]       // Full opacity values
                      ],
                      "line-blur": [
                        "case",
                        ["get", "is_loop"], 0.25,  // Slightly more blur for Loop
                        0.2
                      ],
                      "line-offset": ["get", "offset_px"]
                    }}
                  />
                ))}
                {CTA_LINE_ORDER.map(line => (
                  <Layer
                    key={`core-${line}`}
                    id={`cta-line-core-${line}`}
                    type="line"
                    filter={["==", ["get", "line"], line]}
                    layout={{
                      "line-cap": "round",
                      "line-join": "round",
                      "line-miter-limit": 2,
                      "line-round-limit": 1.5
                    }}
                    paint={{
                      "line-color": CTA_LINE_COLORS[line],
                      "line-width": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10, ["case", ["get", "is_loop"], 1.6, 2],     // Reduced by 0.1
                        12, ["case", ["get", "is_loop"], 2.4, 3],     // Reduced by 0.15
                        14, ["case", ["get", "is_loop"], 4.1, 5]      // Reduced by 0.15
                      ],
                      "line-opacity": [
                        "interpolate",
                        ["linear"],
                        ["zoom"],
                        10, 0.75,
                        11, 0.85,
                        13, 1
                      ],
                      "line-offset": ["get", "offset_px"]
                    }}
                  />
                ))}
              </Source>
            )}

            <Source id="stations" type="geojson" data={geoJsonData}>
              {/* Station Drop Shadow */}
              <Layer
                id="stations-shadow"
                type="circle"
                paint={{
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10, 8,
                    14, 12.5,
                  ],
                  "circle-color": "rgba(11, 18, 32, 0.15)",
                  "circle-blur": 0.8,
                  "circle-translate": [1, 2], // Slight offset down-right
                  "circle-opacity": [
                    "case",
                    ["get", "isActiveByLineFilter"], 1,
                    0.2
                  ]
                }}
              />

              {/* Ghost Halo Layer */}
              <Layer
                id="stations-halo"
                type="circle"
                paint={{
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10,
                    ["*", 1.8, ["interpolate", ["linear"], ["get", "ghostScore"], 0, 8, 100, 16]],
                    14,
                    ["*", 2.5, ["interpolate", ["linear"], ["get", "ghostScore"], 0, 12, 100, 24]],
                  ],
                  "circle-color": [
                    "case",
                    ["==", ["get", "dataStatus"], "missing"], "rgba(156, 163, 175, 0.15)",
                    [
                      "interpolate",
                      ["linear"],
                      ["get", "ghostScore"],
                      0, "rgba(34, 197, 94, 0.1)",
                      20, "rgba(132, 204, 22, 0.15)",
                      40, "rgba(245, 158, 11, 0.2)",
                      60, "rgba(234, 88, 12, 0.25)",
                      80, "rgba(220, 38, 38, 0.3)",
                    ]
                  ],
                  "circle-blur": 0.8,
                  "circle-opacity": [
                    "case",
                    ["get", "isActiveByLineFilter"], 1,
                    0.05
                  ]
                }}
              />

              {/* Main Station Dots */}
              <Layer
                id="stations-circle"
                type="circle"
                paint={{
                  "circle-radius": [
                    "interpolate",
                    ["linear"],
                    ["zoom"],
                    10, 6,
                    14, 10,
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
                    3,
                    2,
                  ],
                  "circle-stroke-color": "#FFFFFF",
                  "circle-stroke-opacity": 0.9,
                  "circle-opacity": [
                    "case",
                    ["get", "isActiveByLineFilter"], 1,
                    0.2
                  ]
                }}
              />
            </Source>

            {/* Tooltip */}
            {hoveredStation && (
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
      {selectedStation && (
        <StationDetailPanel
          station={selectedStation}
          onClose={() => setSelectedStation(null)}
        />
      )}
    </>
  );
}