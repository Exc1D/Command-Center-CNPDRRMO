import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MAP_CONFIG } from './constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface DetectedLocation {
  municipality: string;
  barangay: string;
  isMultiple: boolean;
}

interface BarangayFeature {
  type: 'Feature';
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
  properties: {
    name: string;
    psgc: string;
    municipality: string;
    municipality_psgc: string;
    province: string;
  };
}

interface BarangayGeoJSON {
  type: 'FeatureCollection';
  features: BarangayFeature[];
}

let barangayCache: BarangayGeoJSON | null = null;

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function getCentroid(geometry: any): { lat: number; lng: number } | null {
  if (!geometry) return null;
  if (geometry.type === 'Point') {
    return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
  }
  if (geometry.type === 'Polygon' && geometry.coordinates?.[0]) {
    const coords = geometry.coordinates[0];
    let latSum = 0,
      lngSum = 0;
    for (const c of coords) {
      latSum += c[1];
      lngSum += c[0];
    }
    return { lat: latSum / coords.length, lng: lngSum / coords.length };
  }
  if (geometry.type === 'LineString' && geometry.coordinates?.[0]) {
    const coords = geometry.coordinates;
    let latSum = 0,
      lngSum = 0;
    for (const c of coords) {
      latSum += c[1];
      lngSum += c[0];
    }
    return { lat: latSum / coords.length, lng: lngSum / coords.length };
  }
  return null;
}

export async function loadBarangayGeoJSON(): Promise<BarangayGeoJSON> {
  if (barangayCache) return barangayCache;
  const response = await fetch('/baranggays.geojson');
  if (!response.ok) throw new Error(`Failed to load barangay data: ${response.status}`);
  barangayCache = await response.json();
  return barangayCache;
}

export async function detectLocationFromGeometry(
  geometry: any
): Promise<DetectedLocation | null> {
  const geojson = await loadBarangayGeoJSON();
  const centroid = getCentroid(geometry);

  if (!centroid) return null;

  const detectedBarangays: Array<{
    name: string;
    municipality: string;
    distance: number;
  }> = [];

  for (const feature of geojson.features) {
    const bCoords = feature.geometry.coordinates;
    const bLat = bCoords[1];
    const bLng = bCoords[0];
    const dist = haversineDistance(centroid.lat, centroid.lng, bLat, bLng);

    if (dist < MAP_CONFIG.DETECTION_THRESHOLD_KM) {
      detectedBarangays.push({
        name: feature.properties.name,
        municipality: feature.properties.municipality,
        distance: dist,
      });
    }
  }

  detectedBarangays.sort((a, b) => a.distance - b.distance);

  if (detectedBarangays.length === 0) return null;

  const municipality = detectedBarangays[0].municipality;
  const barangayNames = detectedBarangays
    .slice(0, 3)
    .map((b) => b.name)
    .join(', ');

  return {
    municipality,
    barangay: barangayNames,
    isMultiple: detectedBarangays.length > 1,
  };
}
