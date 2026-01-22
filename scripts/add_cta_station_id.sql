-- Migration to add ctaStationId field to Station table and dataStatus to StationMetrics

-- Add ctaStationId to Station table
ALTER TABLE Station ADD COLUMN ctaStationId TEXT;

-- Create index on ctaStationId for fast lookups
CREATE INDEX idx_station_city_cta_id ON Station(cityId, ctaStationId);

-- Add dataStatus to StationMetrics table
ALTER TABLE StationMetrics ADD COLUMN dataStatus TEXT DEFAULT 'normal';