"use client";

import { useState, useEffect, useMemo } from "react";
import Map, { Source, Layer, MapMouseEvent } from "react-map-gl/mapbox";
import type { FeatureCollection, Point, Feature } from "geojson";
import MapTooltip from "./MapTooltip";
import StationList from "@/components/station/StationList";
import StationDetailPanel from "@/components/station/StationDetailPanel";
import { getGhostScoreColor } from "@/lib/utils";

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
  const [stations, setStations] = useState<Station[]>([]);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [hoveredStation, setHoveredStation] = useState<Station | null>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [dataAsOf, setDataAsOf] = useState<string>("");

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
        geometry: {
          type: "Point",
          coordinates: [station.longitude, station.latitude],
        },
        properties: {
          ...station,
          lines: JSON.stringify(station.lines), // Serialize lines array for GeoJSON
        },
      })),
    }),
    [filteredStations]
  );

  const handleStationClick = (station: Station) => {
    setSelectedStation(station);
    // Smooth pan to station
    setViewState({
      ...viewState,
      latitude: station.latitude,
      longitude: station.longitude,
      zoom: 14,
    });
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
            <Source id="stations" type="geojson" data={geoJsonData}>
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