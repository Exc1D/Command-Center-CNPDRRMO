import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { MAP_CONFIG } from './constants';
import { format } from 'date-fns';
import type { EvacuationCenter } from './db';
import { pointInsideProvince, type ProvinceGeometry } from './planning';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(value: string | undefined, pattern: string, fallback = 'Unknown') {
  const date = new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? fallback : format(date, pattern);
}

export const CENTER_STATUS = {
  standby: { label: 'Standby', color: '#64748b' },
  open: { label: 'Open', color: '#059669' },
  full: { label: 'Full', color: '#dc2626' },
  closed: { label: 'Closed', color: '#9ca3af' },
} as const;

// The declared status wins, except an open center reads as nearly full at 80% of capacity and at capacity from 100%.
export function centerOccupancyTone(center: Pick<EvacuationCenter, 'status' | 'personsNow' | 'capacity'>) {
  const status = center.status ?? 'standby';
  const persons = center.personsNow ?? 0;
  if (status === 'open' && persons >= center.capacity) return { label: 'At capacity', color: '#dc2626' };
  if (status === 'open' && persons >= center.capacity * 0.8) return { label: 'Nearly full', color: '#d97706' };
  return CENTER_STATUS[status] ?? CENTER_STATUS.standby;
}

// Province-wide headline counts for the Monitor view. Only open or full centers count as sheltering people.
export function monitorSummary(hazards: { type: string; severity: string }[], centers: Pick<EvacuationCenter, 'status' | 'personsNow' | 'familiesNow'>[]) {
  const sheltering = centers.filter(center => center.status === 'open' || center.status === 'full');
  return {
    incidents: hazards.filter(hazard => hazard.type !== 'resource' && hazard.type !== 'road').length,
    roadsClosed: hazards.filter(hazard => hazard.type === 'road' && hazard.severity === 'Not passable').length,
    openCenters: sheltering.length,
    totalCenters: centers.length,
    personsNow: sheltering.reduce((sum, center) => sum + (center.personsNow ?? 0), 0),
    familiesNow: sheltering.reduce((sum, center) => sum + (center.familiesNow ?? 0), 0),
  };
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

// ponytail: the barangay file is static, so load it once per page; a failed load is retried next time.
let barangays: Promise<BarangayGeoJSON> | null = null;

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
    if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length < 2 || !geometry.coordinates.every(Number.isFinite)) return null;
    return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
  }
  const coords = geometry.type === 'Polygon' ? geometry.coordinates?.[0] : geometry.type === 'LineString' ? geometry.coordinates : null;
  if (!Array.isArray(coords) || coords.length === 0 || !coords.every((c: unknown) => Array.isArray(c) && c.length >= 2 && c.slice(0, 2).every(Number.isFinite))) return null;
  return {
    lat: coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length,
    lng: coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length,
  };
}

export function loadBarangayGeoJSON(): Promise<BarangayGeoJSON> {
  return barangays ??= fetch('/baranggays.geojson')
    .then(response => {
      if (!response.ok) throw new Error(`Failed to load barangay data: ${response.status}`);
      return response.json();
    })
    .catch(error => {
      barangays = null;
      throw error;
    });
}

// ponytail: municipal polygons are loaded once per page; a failed load is retried next time.
let municipalBoundaries: Promise<{ features: Array<{ geometry: ProvinceGeometry; properties: { ADM3_EN: string } }> }> | null = null;

async function municipalityAt(point: [number, number]): Promise<string | null> {
  municipalBoundaries ??= fetch('/reference/boundaries.geojson')
    .then(response => {
      if (!response.ok) throw new Error(`Failed to load municipal boundaries: ${response.status}`);
      return response.json();
    })
    .catch(error => {
      municipalBoundaries = null;
      throw error;
    });
  const { features } = await municipalBoundaries;
  const match = features.find(feature =>
    ['Polygon', 'MultiPolygon'].includes(feature.geometry?.type) && pointInsideProvince(point, { features: [feature] }));
  // NAMRIA labels the capital "Daet (Capital)"; the barangay list calls it "Daet".
  return match?.properties.ADM3_EN.replace(' (Capital)', '') ?? null;
}

// The municipality comes from the boundary the pin sits in. Barangay boundaries are not available,
// so the barangay is the nearest barangay center inside that municipality; the form lets people correct it.
export async function detectLocationFromGeometry(
  geometry: any
): Promise<DetectedLocation | null> {
  const centroid = getCentroid(geometry);
  if (!centroid) return null;

  const [geojson, municipality] = await Promise.all([
    loadBarangayGeoJSON(),
    municipalityAt([centroid.lng, centroid.lat]).catch(() => null),
  ]);

  const candidates = municipality
    ? geojson.features.filter(feature => feature.properties.municipality === municipality)
    : geojson.features;
  // Outside every boundary (for example just offshore) only a barangay center within the threshold counts.
  const maxKm = municipality && candidates.length > 0 ? Infinity : MAP_CONFIG.DETECTION_THRESHOLD_KM;

  const detectedBarangays = (candidates.length > 0 ? candidates : geojson.features)
    .map(feature => ({
      name: feature.properties.name,
      municipality: feature.properties.municipality,
      distance: haversineDistance(centroid.lat, centroid.lng, feature.geometry.coordinates[1], feature.geometry.coordinates[0]),
    }))
    .filter(barangay => barangay.distance < maxKm)
    .sort((a, b) => a.distance - b.distance);

  if (detectedBarangays.length === 0) return null;

  return {
    municipality: detectedBarangays[0].municipality,
    barangay: detectedBarangays[0].name,
    isMultiple: detectedBarangays.length > 1,
  };
}
