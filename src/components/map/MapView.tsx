"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Map, { Layer, Source, type MapMouseEvent, type MapRef } from "react-map-gl/mapbox";
import type { FeatureCollection, LineString, Point } from "geojson";
import { useShell } from "@/components/shell/ShellContext";
import { useTheme } from "@/components/theme";
import { explodeAndStitchSegments } from "@/lib/cta/explodeAndStitchSegments";
import { CTA_LINE_ORDER, ctaLineColors } from "@/lib/utils";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const TRACKS_URL = "/data/cta/chicago_track_segments.geojson";

type TrackProperties = { segment_id: string; corridor: string; is_loop: boolean; lines: string[] };

/**
 * The one map (U19): CTA tracks in the official colors and every station as a circle, shared by
 * every viewport. Clicking a station opens its page; selecting one flies the camera to it.
 */
export default function MapView() {
  const mapRef = useRef<MapRef>(null);
  const { theme } = useTheme();
  const { stations, selected, openStation, activeLines } = useShell();
  const [tracks, setTracks] = useState<FeatureCollection<LineString, TrackProperties> | null>(null);

  useEffect(() => {
    fetch(TRACKS_URL)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setTracks(data))
      .catch(() => setTracks(null));
  }, []);

  const exploded = useMemo(
    () => (tracks ? explodeAndStitchSegments(tracks, activeLines as Record<string, boolean>, 5.0, 3.0, true) : null),
    [tracks, activeLines],
  );

  const stationPoints = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: stations.map((s) => ({
        type: "Feature",
        id: s.id,
        geometry: { type: "Point", coordinates: [s.longitude, s.latitude] },
        properties: { slug: s.slug, name: s.displayName },
      })),
    }),
    [stations],
  );

  useEffect(() => {
    if (!selected) return;
    mapRef.current?.flyTo({ center: [selected.longitude, selected.latitude], zoom: 13.5, duration: 900 });
  }, [selected]);

  return (
    <Map
      ref={mapRef}
      initialViewState={{ latitude: 41.8781, longitude: -87.6298, zoom: 10.6 }}
      style={{ position: "absolute", inset: 0 }}
      mapStyle={theme === "dark" ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11"}
      mapboxAccessToken={MAPBOX_TOKEN}
      interactiveLayerIds={["stations"]}
      onClick={(event: MapMouseEvent) => {
        const slug = event.features?.[0]?.properties?.slug;
        if (typeof slug === "string") openStation(slug);
      }}
    >
      {exploded && (
        <Source id="cta-tracks" type="geojson" data={exploded}>
          {CTA_LINE_ORDER.map((line) => (
            <Layer
              key={line}
              id={`track-${line}`}
              type="line"
              filter={["==", ["get", "line"], line]}
              layout={{ "line-cap": "round", "line-join": "round" }}
              paint={{ "line-color": ctaLineColors[line], "line-width": 2.4, "line-offset": ["get", "offset_px"] }}
            />
          ))}
        </Source>
      )}
      <Source id="stations" type="geojson" data={stationPoints}>
        <Layer
          id="stations"
          type="circle"
          paint={{ "circle-radius": 4, "circle-color": theme === "dark" ? "#F2F1EC" : "#141518" }}
        />
      </Source>
    </Map>
  );
}
