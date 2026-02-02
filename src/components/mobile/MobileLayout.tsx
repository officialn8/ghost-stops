import { useState, useRef } from 'react';
import Map from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import { Source, Layer } from 'react-map-gl/mapbox';
import MobileSearchBar from './MobileSearchBar';
import MobileFilterScroll from './MobileFilterScroll';
import MobileBottomSheet from './MobileBottomSheet';
import MobileStationDetail from './MobileStationDetail';
import { CTA_LINE_ORDER, CTA_LINE_COLORS, isStationActiveByLineFilter } from '@/lib/cta/explodeAndStitchSegments';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import { ThemeToggle, useTheme } from '@/components/theme';
import type { FactMap, StationNarrativeData, DataSourceInfo } from "@/types/narrative";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

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

interface NeighborStation {
  id: string;
  name: string;
  rolling30dAvg: number;
  ghostScore: number;
}

interface StationDetailResponse {
  ridershipSeries?: { date: string; entries: number }[];
  comparisons?: {
    systemMedian: number;
    primaryLine: string | null;
    lineMedian: number;
    neighbors: {
      prev: NeighborStation | null;
      next: NeighborStation | null;
      neighborAvg: number;
    };
    vsSystemMedian: number;
    vsLineMedian: number;
    vsNeighbors: number;
  };
  metrics?: {
    ghostScore: number;
    percentile: number;
    systemAverage: number;
    systemMedian?: number;
    explanation: string;
  };
  // Facts + Narrative system
  facts?: FactMap | null;
  narrative?: StationNarrativeData | null;
  sources?: DataSourceInfo[] | null;
}

interface MobileLayoutProps {
  stations: Station[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedLines: string[];
  onLineToggle: (line: string) => void;
  onClearAllLines: () => void;
  onSelectAllLines: () => void;
  stationsGeoJson?: GeoJSON.FeatureCollection | null;
  lineGeoJson?: GeoJSON.FeatureCollection | null;
}

export default function MobileLayout({
  stations,
  searchQuery,
  onSearchChange,
  selectedLines,
  onLineToggle,
  onClearAllLines,
  onSelectAllLines,
  stationsGeoJson,
  lineGeoJson
}: MobileLayoutProps) {
  const mapRef = useRef<MapRef>(null);
  const haptic = useHapticFeedback();
  const { theme } = useTheme();
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [stationDetail, setStationDetail] = useState<StationDetailResponse | null>(null);
  const [isSheetHidden, setIsSheetHidden] = useState(false);

  // Convert selectedLines array to activeLines object for filtering
  const activeLinesObj: Record<string, boolean> = {};
  CTA_LINE_ORDER.forEach(line => {
    activeLinesObj[line] = selectedLines.includes(line);
  });

  // Filter stations by active lines, then take top 25 (stations are pre-sorted by ghost score)
  const filteredByLine = stations.filter(station =>
    isStationActiveByLineFilter(station.lines, activeLinesObj)
  );
  
  // Show top 25 ghostiest stations, matching desktop behavior
  const topStations = filteredByLine.slice(0, 25);
  
  // Fetch full station detail data
  const fetchStationDetail = async (stationId: string) => {
    try {
      const response = await fetch(`/api/chicago/stations/${stationId}`);
      if (response.ok) {
        const data = await response.json();
        setStationDetail(data);
      } else {
        setStationDetail(null);
      }
    } catch (error) {
      console.error('Failed to fetch station detail:', error);
      setStationDetail(null);
    }
  };

  const handleStationClick = async (station: Station) => {
    haptic.impact('medium');
    setSelectedStation(station);
    setIsDetailOpen(true);
    setIsSheetHidden(true); // Hide the bottom sheet while detail is open

    // Fetch full station detail
    await fetchStationDetail(station.id);
  };

  const handleDetailClose = () => {
    setIsDetailOpen(false);
    setIsSheetHidden(false); // Show the bottom sheet again
    // Clear station after animation completes
    setTimeout(() => {
      setSelectedStation(null);
      setStationDetail(null);
    }, 300);
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
          mapStyle={theme === "dark" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11"}
          reuseMaps
          interactiveLayerIds={['stations-circle']}
          onMouseEnter={(e) => {
            if (e.features && e.features.length > 0 && mapRef.current) {
              mapRef.current.getCanvas().style.cursor = 'pointer';
            }
          }}
          onMouseLeave={() => {
            if (mapRef.current) {
              mapRef.current.getCanvas().style.cursor = '';
            }
          }}
          onClick={(event) => {
            const feature = event.features?.[0];
            if (feature && feature.properties) {
              const props = feature.properties;
              // Reconstruct the station object from properties
              const clickedStation: Station = {
                id: props.id,
                name: props.name,
                latitude: props.latitude,
                longitude: props.longitude,
                lines: typeof props.lines === 'string' ? JSON.parse(props.lines) : props.lines || [],
                ghostScore: props.ghostScore,
                rolling30dAvg: props.rolling30dAvg,
                trend: props.trend ?? null,
                dataStatus: props.dataStatus
              };
              handleStationClick(clickedStation);
            }
          }}
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
                id="stations-circle"
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

      {/* Dark Mode Toggle */}
      <div className="fixed top-[calc(env(safe-area-inset-top,0px)+16px)] right-4 z-[101]">
        <ThemeToggle className="w-12 h-12 bg-background/90 backdrop-blur-sm rounded-full shadow-lg" />
      </div>

      {/* Horizontal Filter Scroll */}
      <MobileFilterScroll
        selectedLines={selectedLines}
        onLineToggle={onLineToggle}
        onClearAll={onClearAllLines}
        onSelectAll={onSelectAllLines}
      />

      {/* Bottom Sheet - shows top 25 ghostiest stations */}
      <MobileBottomSheet
        stations={topStations}
        onStationClick={handleStationClick}
        isHidden={isSheetHidden}
      />

      {/* Station Detail */}
      <MobileStationDetail
        station={selectedStation && stationDetail?.station ? {
          ...selectedStation,
          trend: stationDetail.station.trend
        } : selectedStation}
        isOpen={isDetailOpen}
        onClose={handleDetailClose}
        ridershipData={stationDetail?.ridershipSeries}
        comparisons={stationDetail?.comparisons}
        metrics={stationDetail?.metrics}
        facts={stationDetail?.facts}
        narrative={stationDetail?.narrative}
        sources={stationDetail?.sources}
        onStationSelect={(stationId) => {
          // Find and select the new station
          const newStation = stations.find(s => s.id === stationId);
          if (newStation) {
            handleStationClick(newStation);
          }
        }}
      />
    </div>
  );
}