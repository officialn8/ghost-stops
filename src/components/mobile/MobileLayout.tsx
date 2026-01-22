import { useState, useRef } from 'react';
import Map from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import { Source, Layer } from 'react-map-gl/mapbox';
import MobileSearchBar from './MobileSearchBar';
import MobileFilterScroll from './MobileFilterScroll';
import MobileViewListFAB from './MobileViewListFAB';
import MobileBottomSheet from './MobileBottomSheet';
import MobileStationDetail from './MobileStationDetail';
import { CTA_LINE_ORDER, CTA_LINE_COLORS, isStationActiveByLineFilter } from '@/lib/cta/explodeAndStitchSegments';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { useMobileSheet } from '@/hooks/useMobileSheet';

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

interface MobileLayoutProps {
  stations: Station[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedLines: string[];
  onLineToggle: (line: string) => void;
  onClearAllLines: () => void;
  onSelectAllLines: () => void;
  mapStyle?: string;
  stationsGeoJson?: any;
  lineGeoJson?: any;
}

export default function MobileLayout({
  stations,
  searchQuery,
  onSearchChange,
  selectedLines,
  onLineToggle,
  onClearAllLines,
  onSelectAllLines,
  mapStyle = "mapbox://styles/mapbox/light-v11",
  stationsGeoJson,
  lineGeoJson
}: MobileLayoutProps) {
  const mapRef = useRef<MapRef>(null);
  const haptic = useHapticFeedback();
  const sheet = useMobileSheet();
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [ridershipData, setRidershipData] = useState<{ date: string; entries: number }[] | undefined>(undefined);

  // Convert selectedLines array to activeLines object for filtering
  const activeLinesObj: Record<string, boolean> = {};
  CTA_LINE_ORDER.forEach(line => {
    activeLinesObj[line] = selectedLines.includes(line);
  });

  // Filter stations by active lines
  const filteredStations = stations.filter(station =>
    isStationActiveByLineFilter(station.lines, activeLinesObj)
  );

  // Count ghost stops
  const ghostStopCount = filteredStations.filter(s => s.ghostScore > 70).length;

  // Fetch ridership data for a station
  const fetchRidershipData = async (stationId: string) => {
    try {
      const response = await fetch(`/api/chicago/stations/${stationId}/ridership`);
      if (response.ok) {
        const data = await response.json();
        setRidershipData(data.series || []);
      } else {
        setRidershipData(undefined);
      }
    } catch (error) {
      console.error('Failed to fetch ridership data:', error);
      setRidershipData(undefined);
    }
  };

  const handleStationClick = async (station: Station) => {
    haptic.impact('medium');
    setSelectedStation(station);
    setIsDetailOpen(true);
    sheet.close();

    // Fetch ridership data
    await fetchRidershipData(station.id);
  };

  const handleDetailClose = () => {
    setIsDetailOpen(false);
    // Ensure map is interactive again
    document.body.style.overflow = '';
    document.body.style.touchAction = '';
    setTimeout(() => {
      setSelectedStation(null);
      setRidershipData(undefined);
    }, 300);
  };

  const handleViewListClick = () => {
    sheet.openTo(1);
  };

  return (
    <div className="mobile-layout fixed inset-0">
      {/* Full-screen map */}
      <div className="map-container">
        <Map
          ref={mapRef}
          mapboxAccessToken={MAPBOX_TOKEN}
          initialViewState={{
            longitude: -87.6298,
            latitude: 41.8781,
            zoom: 11
          }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={mapStyle}
          reuseMaps
        >
          {/* CTA Track Lines */}
          {lineGeoJson && (
            <Source id="cta-tracks" type="geojson" data={lineGeoJson}>
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
                      10, ["case", ["get", "is_loop"], 0.48, 0.72],
                      11, ["case", ["get", "is_loop"], 0.51, 0.765],
                      12, ["case", ["get", "is_loop"], 0.6, 0.9]
                    ],
                    "line-blur": [
                      "case",
                      ["get", "is_loop"], 0.25,
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
                      10, ["case", ["get", "is_loop"], 1.6, 2],
                      12, ["case", ["get", "is_loop"], 2.4, 3],
                      14, ["case", ["get", "is_loop"], 4.1, 5]
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

          {/* Stations */}
          {stationsGeoJson && (
            <Source id="stations" type="geojson" data={stationsGeoJson}>
              <Layer
                id="stations-layer"
                type="circle"
                paint={{
                  'circle-radius': [
                    'interpolate',
                    ['linear'],
                    ['zoom'],
                    10, 6,
                    14, 12
                  ],
                  'circle-color': [
                    'interpolate',
                    ['linear'],
                    ['get', 'ghostScore'],
                    0, '#22c55e',
                    50, '#f59e0b',
                    70, '#ef4444'
                  ],
                  'circle-stroke-color': '#ffffff',
                  'circle-stroke-width': 2,
                  'circle-opacity': 0.9
                }}
              />
            </Source>
          )}
        </Map>
      </div>

      {/* Floating Search Bar */}
      <MobileSearchBar
        value={searchQuery}
        onChange={onSearchChange}
        placeholder="Search stations..."
      />

      {/* Horizontal Filter Scroll */}
      <MobileFilterScroll
        selectedLines={selectedLines}
        onLineToggle={onLineToggle}
        onClearAll={onClearAllLines}
        onSelectAll={onSelectAllLines}
      />

      {/* View List FAB */}
      <MobileViewListFAB
        stationCount={filteredStations.length}
        ghostStopCount={ghostStopCount}
        onClick={handleViewListClick}
      />

      {/* Bottom Sheet */}
      <div style={{ pointerEvents: isDetailOpen ? 'none' : 'auto' }}>
        <MobileBottomSheet
          stations={filteredStations}
          onStationClick={handleStationClick}
          sheetState={sheet}
        />
      </div>

      {/* Station Detail */}
      <MobileStationDetail
        station={selectedStation}
        isOpen={isDetailOpen}
        onClose={handleDetailClose}
        ridershipData={ridershipData}
      />
    </div>
  );
}