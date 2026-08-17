import { z } from 'zod';
import { MAP_CONFIG } from './constants';

export type PlanningLayer = 'drawings' | 'symbols' | 'labels';
export type PlanningObjectKind = 'freehand' | 'line' | 'polygon' | 'rectangle' | 'circle' | 'text' | 'symbol';
export type PlanningClassification = 'Internal' | 'Restricted' | 'Public';

export interface PlanningStyle {
  color: string;
  width: number;
  fillOpacity: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

export interface PlanningObject {
  id: string;
  kind: PlanningObjectKind;
  layer: PlanningLayer;
  coordinates: [number, number][];
  style: PlanningStyle;
  locked: boolean;
  order: number;
  label?: string;
  labelPosition?: [number, number];
  radiusMeters?: number;
  arrows?: 'none' | 'end' | 'both';
  text?: string;
  textSize?: 'small' | 'medium' | 'large';
  bold?: boolean;
  textBackground?: boolean;
  symbolKey?: string;
  symbolSize?: 'small' | 'medium' | 'large';
  quantity?: number;
  notes?: string;
  measurementPinned?: boolean;
}

export interface PlanningScenario {
  id: string;
  name: string;
  notes: string;
  classification?: PlanningClassification;
  validFrom?: string;
  validUntil?: string;
  draftVersion: number;
  archivedAt?: string;
  updatedAt: string;
  mapState: {
    center: [number, number];
    zoom: number;
    baseMap: 'street' | 'topo' | 'satellite';
    activeFilters: string[];
    susceptibilityFilters: string[];
    evacuationCentersVisible: boolean;
  };
  layers: Record<PlanningLayer, { visible: boolean; locked: boolean }>;
  objects: PlanningObject[];
}

export interface PlanningRevision {
  id: string;
  scenarioId: string;
  revision: number;
  publishedAt: string;
  snapshot: PlanningScenario;
}

export interface PlanningTemplate {
  id: string;
  name: string;
  symbolKey: string;
  color: string;
  size: 'small' | 'medium' | 'large';
  defaultLabel?: string;
  updatedAt: string;
}

export const PLANNING_SYMBOLS = [
  { key: 'eoc', label: 'Emergency Operations Center', category: 'Command' },
  { key: 'icp', label: 'Incident Command Post', category: 'Command' },
  { key: 'staging', label: 'Staging Area', category: 'Command' },
  { key: 'checkpoint', label: 'Checkpoint', category: 'Command' },
  { key: 'evacuation-center', label: 'Evacuation Center', category: 'Life Safety' },
  { key: 'medical-post', label: 'Medical Post', category: 'Life Safety' },
  { key: 'search-rescue', label: 'Search and Rescue', category: 'Life Safety' },
  { key: 'fire-service', label: 'Fire Service', category: 'Life Safety' },
  { key: 'police', label: 'Police / Security', category: 'Life Safety' },
  { key: 'relief-goods', label: 'Relief Goods', category: 'Logistics' },
  { key: 'food', label: 'Food', category: 'Logistics' },
  { key: 'water', label: 'Water', category: 'Logistics' },
  { key: 'temporary-shelter', label: 'Temporary Shelter', category: 'Logistics' },
  { key: 'warehouse', label: 'Warehouse', category: 'Logistics' },
  { key: 'ambulance', label: 'Ambulance', category: 'Transport' },
  { key: 'rescue-truck', label: 'Rescue Truck', category: 'Transport' },
  { key: 'rescue-boat', label: 'Rescue Boat', category: 'Transport' },
  { key: 'helicopter', label: 'Helicopter / Helispot', category: 'Transport' },
  { key: 'pickup-point', label: 'Pickup Point', category: 'Transport' },
  { key: 'road-closure', label: 'Road Closure', category: 'Access & Impact' },
  { key: 'damaged-bridge', label: 'Damaged Bridge', category: 'Access & Impact' },
  { key: 'stranded-people', label: 'Stranded People', category: 'Access & Impact' },
  { key: 'affected-structure', label: 'Affected Structure', category: 'Access & Impact' },
  { key: 'power-outage', label: 'Power Outage', category: 'Access & Impact' },
  { key: 'flood', label: 'Projected Flood', category: 'Projected Hazard' },
  { key: 'storm-surge', label: 'Projected Storm Surge', category: 'Projected Hazard' },
  { key: 'landslide', label: 'Projected Landslide', category: 'Projected Hazard' },
  { key: 'earthquake', label: 'Projected Earthquake Impact', category: 'Projected Hazard' },
  { key: 'tsunami', label: 'Projected Tsunami Impact', category: 'Projected Hazard' },
  { key: 'vehicular-incident', label: 'Projected Vehicular Incident', category: 'Projected Hazard' },
  { key: 'fire-incident', label: 'Projected Fire', category: 'Projected Hazard' },
] as const;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const DEFAULT_PLANNING_STYLE: PlanningStyle = {
  color: '#dc2626',
  width: 3,
  fillOpacity: 0.2,
  lineStyle: 'solid',
};

export function createPlanningScenario(name: string): PlanningScenario {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    notes: '',
    draftVersion: 0,
    updatedAt: now,
    mapState: {
      center: [...MAP_CONFIG.PROVINCE_CENTER],
      zoom: MAP_CONFIG.DEFAULT_ZOOM,
      baseMap: 'street',
      activeFilters: [],
      susceptibilityFilters: [],
      evacuationCentersVisible: false,
    },
    layers: {
      drawings: { visible: true, locked: false },
      symbols: { visible: true, locked: false },
      labels: { visible: true, locked: false },
    },
    objects: [],
  };
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: structuredClone(initial), future: [] };
}

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  return {
    past: [...history.past, structuredClone(history.present)].slice(-100),
    present: structuredClone(next),
    future: [],
  };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: structuredClone(previous),
    future: [structuredClone(history.present), ...history.future],
  };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, structuredClone(history.present)].slice(-100),
    present: structuredClone(next),
    future: history.future.slice(1),
  };
}

function distanceToSegment(point: [number, number], start: [number, number], end: [number, number]) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy));
}

function simplify(points: [number, number][], tolerance: number): [number, number][] {
  if (points.length <= 2) return points.slice();
  let maxDistance = 0;
  let splitAt = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(points[index], points[0], points.at(-1)!);
    if (distance > maxDistance) {
      maxDistance = distance;
      splitAt = index;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points.at(-1)!];
  return [...simplify(points.slice(0, splitAt + 1), tolerance).slice(0, -1), ...simplify(points.slice(splitAt), tolerance)];
}

export function smoothStroke(points: [number, number][], level: 'off' | 'low' | 'high'): [number, number][] {
  if (level === 'off') return points.slice();
  return simplify(points, level === 'low' ? 0.000025 : 0.00008);
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const latitude = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const x = (b[0] - a[0]) * Math.PI / 180 * Math.cos(latitude);
  const y = (b[1] - a[1]) * Math.PI / 180;
  return Math.hypot(x, y) * 6_371_000;
}

function pathLengthMeters(points: [number, number][]) {
  return points.slice(1).reduce((total, point, index) => total + distanceMeters(points[index], point), 0);
}

function polygonAreaMeters(points: [number, number][]) {
  if (points.length < 3) return 0;
  const origin = points[0];
  const latitude = origin[1] * Math.PI / 180;
  const projected = points.map(([lng, lat]) => [
    (lng - origin[0]) * Math.PI / 180 * 6_371_000 * Math.cos(latitude),
    (lat - origin[1]) * Math.PI / 180 * 6_371_000,
  ]);
  return Math.abs(projected.reduce((sum, point, index) => {
    const next = projected[(index + 1) % projected.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0) / 2);
}

export function formatMeasurement(object: Pick<PlanningObject, 'kind' | 'coordinates' | 'radiusMeters'>) {
  const area = object.kind === 'circle'
    ? Math.PI * (object.radiusMeters ?? 0) ** 2
    : ['polygon', 'rectangle'].includes(object.kind) ? polygonAreaMeters(object.coordinates) : 0;
  if (area > 0) return area >= 1_000_000 ? `${(area / 1_000_000).toFixed(2)} km²` : `${(area / 10_000).toFixed(1)} ha`;
  const length = pathLengthMeters(object.coordinates);
  return length >= 1_000 ? `${(length / 1_000).toFixed(2)} km` : `${Math.round(length)} m`;
}

type SegmentHit = { distance: number; firstT: number };

function segmentHit(
  firstStart: [number, number],
  firstEnd: [number, number],
  secondStart: [number, number],
  secondEnd: [number, number],
): SegmentHit {
  const latitude = (firstStart[1] + firstEnd[1] + secondStart[1] + secondEnd[1]) / 4 * Math.PI / 180;
  const project = ([lng, lat]: [number, number]) => [lng * Math.PI / 180 * 6_371_000 * Math.cos(latitude), lat * Math.PI / 180 * 6_371_000] as const;
  const [a, b, c, d] = [firstStart, firstEnd, secondStart, secondEnd].map(project);
  const pointSegment = (point: readonly [number, number], start: readonly [number, number], end: readonly [number, number]) => {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
    return { distance: Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy), t };
  };
  const firstDx = b[0] - a[0];
  const firstDy = b[1] - a[1];
  const secondDx = d[0] - c[0];
  const secondDy = d[1] - c[1];
  const denominator = firstDx * secondDy - firstDy * secondDx;
  if (denominator !== 0) {
    const offsetX = c[0] - a[0];
    const offsetY = c[1] - a[1];
    const firstT = (offsetX * secondDy - offsetY * secondDx) / denominator;
    const secondT = (offsetX * firstDy - offsetY * firstDx) / denominator;
    if (firstT >= 0 && firstT <= 1 && secondT >= 0 && secondT <= 1) return { distance: 0, firstT };
  }
  const candidates: SegmentHit[] = [
    { distance: pointSegment(a, c, d).distance, firstT: 0 },
    { distance: pointSegment(b, c, d).distance, firstT: 1 },
    ...[c, d].map(point => {
      const result = pointSegment(point, a, b);
      return { distance: result.distance, firstT: result.t };
    }),
  ];
  return candidates.reduce((closest, candidate) => candidate.distance < closest.distance ? candidate : closest);
}

function pathSegments(path: [number, number][]) {
  return path.length === 1 ? [[path[0], path[0]]] as const : path.slice(1).map((end, index) => [path[index], end] as const);
}

function pathsTouch(first: [number, number][], second: [number, number][], radiusMeters: number) {
  const secondSegments = pathSegments(second).map(([start, end]) => ({ start, end, bounds: geographicBounds([start, end]) }));
  return pathSegments(first).some(([firstStart, firstEnd]) => {
    const firstBounds = geographicBounds([firstStart, firstEnd]);
    return secondSegments.some(({ start, end, bounds }) => boundsTouch(firstBounds, bounds, radiusMeters)
      && segmentHit(firstStart, firstEnd, start, end).distance <= radiusMeters);
  });
}

type GeographicBounds = { minLng: number; minLat: number; maxLng: number; maxLat: number };
const objectBounds = new WeakMap<PlanningObject, GeographicBounds>();

function geographicBounds(points: [number, number][]) {
  return points.reduce<GeographicBounds>((bounds, [lng, lat]) => ({
    minLng: Math.min(bounds.minLng, lng),
    minLat: Math.min(bounds.minLat, lat),
    maxLng: Math.max(bounds.maxLng, lng),
    maxLat: Math.max(bounds.maxLat, lat),
  }), { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity });
}

function boundsTouch(first: GeographicBounds, second: GeographicBounds, radiusMeters: number) {
  const latitude = (first.minLat + first.maxLat + second.minLat + second.maxLat) / 4 * Math.PI / 180;
  const latitudePadding = radiusMeters / 6_371_000 * 180 / Math.PI;
  const longitudePadding = latitudePadding / Math.max(0.01, Math.cos(latitude));
  return first.minLng - longitudePadding <= second.maxLng
    && first.maxLng + longitudePadding >= second.minLng
    && first.minLat - latitudePadding <= second.maxLat
    && first.maxLat + latitudePadding >= second.minLat;
}

function interpolate(start: [number, number], end: [number, number], t: number): [number, number] {
  return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
}

type BoundedSegment = { start: [number, number]; end: [number, number]; bounds: GeographicBounds };

function erasedIntervals(start: [number, number], end: [number, number], eraserSegments: BoundedSegment[], radiusMeters: number) {
  const strokeBounds = geographicBounds([start, end]);
  const intervals = eraserSegments.flatMap<[number, number]>(({ start: eraserStart, end: eraserEnd, bounds }) => {
    if (!boundsTouch(strokeBounds, bounds, radiusMeters)) return [];
    const hit = segmentHit(start, end, eraserStart, eraserEnd);
    if (hit.distance > radiusMeters) return [];
    const distanceAt = (t: number) => segmentHit(interpolate(start, end, t), interpolate(start, end, t), eraserStart, eraserEnd).distance;
    let left = 0;
    let right = 1;
    if (distanceAt(0) > radiusMeters) {
      let outside = 0;
      left = hit.firstT;
      for (let index = 0; index < 24; index += 1) {
        const middle = (outside + left) / 2;
        if (distanceAt(middle) <= radiusMeters) left = middle;
        else outside = middle;
      }
    }
    if (distanceAt(1) > radiusMeters) {
      let outside = 1;
      right = hit.firstT;
      for (let index = 0; index < 24; index += 1) {
        const middle = (right + outside) / 2;
        if (distanceAt(middle) <= radiusMeters) right = middle;
        else outside = middle;
      }
    }
    return [[left, right]];
  }).sort((a, b) => a[0] - b[0]);
  return intervals.reduce<[number, number][]>((merged, interval) => {
    const previous = merged.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else merged.push(interval);
    return merged;
  }, []);
}

function cappedCoordinates(points: [number, number][]) {
  if (points.length <= 20_000) return points;
  // ponytail: the persistence schema caps a path at 20k points; evenly thin only at that hard boundary.
  return Array.from({ length: 20_000 }, (_, index) => points[Math.round(index * (points.length - 1) / 19_999)]);
}

export function eraseStroke(
  stroke: [number, number][],
  eraserPath: [number, number][],
  radiusMeters: number,
): [number, number][][] {
  if (eraserPath.length === 0) return [stroke.slice()];
  const parts: [number, number][][] = [];
  let current: [number, number][] = stroke.length ? [stroke[0]] : [];
  let erasedAny = false;
  const eraserSegments = pathSegments(eraserPath).map(([start, end]) => ({ start, end, bounds: geographicBounds([start, end]) }));
  for (let index = 1; index < stroke.length; index += 1) {
    const start = stroke[index - 1];
    const end = stroke[index];
    const intervals = erasedIntervals(start, end, eraserSegments, radiusMeters);
    let cursor = 0;
    for (const [eraseStart, eraseEnd] of intervals) {
      erasedAny = true;
      if (eraseStart > cursor) {
        if (current.length === 0) current.push(interpolate(start, end, cursor));
        current.push(interpolate(start, end, eraseStart));
      }
      if (current.length >= 2) parts.push(cappedCoordinates(current));
      current = [];
      cursor = eraseEnd;
    }
    if (cursor < 1) {
      if (current.length === 0) current.push(interpolate(start, end, cursor));
      current.push(end);
    }
  }
  if (current.length >= 2) parts.push(cappedCoordinates(current));
  return erasedAny ? parts : [stroke.slice()];
}

export function eraserTouchesObject(object: PlanningObject, eraserPath: [number, number][], radiusMeters: number, visualRadiusMeters = 0) {
  if (object.coordinates.length === 0 || eraserPath.length === 0) return false;
  const bounds = objectBounds.get(object) ?? geographicBounds(object.coordinates);
  objectBounds.set(object, bounds);
  const objectRadius = (object.kind === 'circle' ? object.radiusMeters ?? 0 : 0) + visualRadiusMeters;
  if (!boundsTouch(bounds, geographicBounds(eraserPath), radiusMeters + objectRadius)) return false;
  if (object.kind === 'circle') {
    const reach = (object.radiusMeters ?? 0) + radiusMeters + visualRadiusMeters;
    return pathsTouch(object.coordinates, eraserPath, reach);
  }
  if (object.kind === 'polygon' || object.kind === 'rectangle') {
    const ring = [...object.coordinates, object.coordinates[0]];
    return eraserPath.some(point => pointInRing(point, ring)) || pathsTouch(ring, eraserPath, radiusMeters + visualRadiusMeters);
  }
  return pathsTouch(object.coordinates, eraserPath, radiusMeters + visualRadiusMeters);
}

export function erasePlanningObjects(
  objects: PlanningObject[],
  eraserPath: [number, number][],
  radiusMeters: number,
  layers: PlanningScenario['layers'],
  visualRadiusMeters: (object: PlanningObject) => number = () => 0,
  visuallyTouched: (object: PlanningObject) => boolean = () => false,
) {
  let erased = 0;
  let skipped = 0;
  let limitReached = false;
  const changes = objects.map(object => {
    if (!layers[object.layer].visible) return { object, replacement: [object], changed: false };
    if (!visuallyTouched(object) && !eraserTouchesObject(object, eraserPath, radiusMeters, visualRadiusMeters(object))) return { object, replacement: [object], changed: false };
    if (object.locked || layers[object.layer].locked) {
      skipped += 1;
      return { object, replacement: [object], changed: false };
    }
    erased += 1;
    if (object.kind !== 'freehand' && object.kind !== 'line') return { object, replacement: [], changed: true };
    const replacement = eraseStroke(object.coordinates, eraserPath, radiusMeters).map((coordinates, index) => ({
      ...object,
      id: index === 0 ? object.id : crypto.randomUUID(),
      coordinates,
      label: index === 0 ? object.label : undefined,
      labelPosition: index === 0 ? object.labelPosition : undefined,
    }));
    return { object, replacement, changed: true };
  });
  let total = changes.reduce((count, change) => count + change.replacement.length, 0);
  for (const change of changes) {
    if (total <= 5_000) break;
    if (!change.changed || change.replacement.length <= 1) continue;
    total -= change.replacement.length - 1;
    change.replacement = [change.object];
    change.changed = false;
    erased -= 1;
    limitReached = true;
  }
  const next = changes.flatMap(change => change.replacement);
  return { objects: erased ? next : objects, erased, skipped, limitReached };
}

type ProvinceGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: any };
export type ProvinceGeoJSON = { features: Array<{ geometry: ProvinceGeometry }> };

function pointInRing(point: [number, number], ring: [number, number][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x, y] = ring[index];
    const [previousX, previousY] = ring[previous];
    if ((y > point[1]) !== (previousY > point[1]) && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInPolygon(point: [number, number], rings: [number, number][][]) {
  return pointInRing(point, rings[0]) && !rings.slice(1).some(ring => pointInRing(point, ring));
}

export function pointInsideProvince(point: [number, number], province: ProvinceGeoJSON) {
  return province.features.some(({ geometry }) => {
    if (geometry.type === 'Polygon') return pointInPolygon(point, geometry.coordinates);
    return geometry.coordinates.some((polygon: [number, number][][]) => pointInPolygon(point, polygon));
  });
}

export function pathInsideProvince(path: [number, number][], province: ProvinceGeoJSON) {
  if (path.length === 0) return false;
  // ponytail: 100 m sampling is intentionally approximate; use polygon intersection if field validation needs survey-grade precision.
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const samples = Math.min(2_000, Math.max(1, Math.ceil(distanceMeters(start, end) / 100)));
    for (let sample = 0; sample <= samples; sample += 1) {
      const ratio = sample / samples;
      if (!pointInsideProvince([
        start[0] + (end[0] - start[0]) * ratio,
        start[1] + (end[1] - start[1]) * ratio,
      ], province)) return false;
    }
  }
  return path.length === 1 ? pointInsideProvince(path[0], province) : true;
}

export function circleInsideProvince(center: [number, number], radiusMeters: number, province: ProvinceGeoJSON) {
  const latitude = center[1] * Math.PI / 180;
  const points: [number, number][] = [center];
  for (let index = 0; index < 32; index += 1) {
    const angle = index * Math.PI * 2 / 32;
    points.push([
      center[0] + Math.cos(angle) * radiusMeters / (6_371_000 * Math.cos(latitude)) * 180 / Math.PI,
      center[1] + Math.sin(angle) * radiusMeters / 6_371_000 * 180 / Math.PI,
    ]);
  }
  return points.every(point => pointInsideProvince(point, province));
}

export function getSymbolTotals(objects: PlanningObject[]) {
  const totals = new Map<string, number>();
  for (const object of objects) {
    if (object.kind !== 'symbol' || !object.symbolKey) continue;
    totals.set(object.symbolKey, (totals.get(object.symbolKey) ?? 0) + (object.quantity ?? 1));
  }
  return [...totals].map(([symbolKey, quantity]) => ({ symbolKey, quantity }));
}

const coordinateSchema = z.tuple([z.number().finite(), z.number().finite()]);

const planningObjectSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['freehand', 'line', 'polygon', 'rectangle', 'circle', 'text', 'symbol']),
  layer: z.enum(['drawings', 'symbols', 'labels']),
  coordinates: z.array(coordinateSchema).max(20_000),
  style: z.object({
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    width: z.number().min(1).max(24),
    fillOpacity: z.number().min(0).max(1),
    lineStyle: z.enum(['solid', 'dashed', 'dotted']),
  }),
  locked: z.boolean(),
  order: z.number().int(),
  label: z.string().max(120).optional(),
  labelPosition: coordinateSchema.optional(),
  radiusMeters: z.number().positive().max(100_000).optional(),
  arrows: z.enum(['none', 'end', 'both']).optional(),
  text: z.string().max(2_000).optional(),
  textSize: z.enum(['small', 'medium', 'large']).optional(),
  bold: z.boolean().optional(),
  textBackground: z.boolean().optional(),
  symbolKey: z.string().max(64).optional(),
  symbolSize: z.enum(['small', 'medium', 'large']).optional(),
  quantity: z.number().int().positive().max(100_000).optional(),
  notes: z.string().max(2_000).optional(),
  measurementPinned: z.boolean().optional(),
}).superRefine((object, context) => {
  const minimum = object.kind === 'symbol' || object.kind === 'text' || object.kind === 'circle' ? 1
    : object.kind === 'line' || object.kind === 'freehand' ? 2 : 3;
  if (object.coordinates.length < minimum) context.addIssue({ code: 'custom', path: ['coordinates'], message: `${object.kind} requires at least ${minimum} coordinate${minimum === 1 ? '' : 's'}` });
  if (object.kind === 'circle' && object.radiusMeters === undefined) context.addIssue({ code: 'custom', path: ['radiusMeters'], message: 'Circle radius is required' });
  if (object.kind === 'symbol' && !PLANNING_SYMBOLS.some(symbol => symbol.key === object.symbolKey)) context.addIssue({ code: 'custom', path: ['symbolKey'], message: 'Known symbol is required' });
  if (object.kind === 'text' && !object.text?.trim()) context.addIssue({ code: 'custom', path: ['text'], message: 'Text content is required' });
});

export const planningScenarioSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  notes: z.string().max(4_000),
  classification: z.enum(['Internal', 'Restricted', 'Public']).optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  draftVersion: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime(),
  mapState: z.object({
    center: coordinateSchema,
    zoom: z.number().min(1).max(20),
    baseMap: z.enum(['street', 'topo', 'satellite']),
    activeFilters: z.array(z.string().max(64)).max(32),
    susceptibilityFilters: z.array(z.string().max(64)).max(16),
    evacuationCentersVisible: z.boolean(),
  }),
  layers: z.object({
    drawings: z.object({ visible: z.boolean(), locked: z.boolean() }),
    symbols: z.object({ visible: z.boolean(), locked: z.boolean() }),
    labels: z.object({ visible: z.boolean(), locked: z.boolean() }),
  }),
  objects: z.array(planningObjectSchema).max(5_000),
}).superRefine((scenario, context) => {
  if (scenario.validFrom && scenario.validUntil && scenario.validFrom > scenario.validUntil) {
    context.addIssue({ code: 'custom', path: ['validUntil'], message: 'Validity end must be after its start' });
  }
});

export function scenarioInsideProvince(scenario: PlanningScenario, province: ProvinceGeoJSON) {
  return scenario.objects.every(object => {
    const coordinates = ['polygon', 'rectangle'].includes(object.kind) && object.coordinates.length > 0
      ? [...object.coordinates, object.coordinates[0]] : object.coordinates;
    const geometryInside = object.kind === 'circle'
      ? circleInsideProvince(object.coordinates[0], object.radiusMeters ?? 0, province)
      : pathInsideProvince(coordinates, province);
    return geometryInside && (!object.labelPosition || pointInsideProvince(object.labelPosition, province));
  });
}

export const planningTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  symbolKey: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  size: z.enum(['small', 'medium', 'large']),
  defaultLabel: z.string().max(120).optional(),
  updatedAt: z.string().datetime(),
});

const nativeScenarioSchema = z.object({
  format: z.literal('cnpdrrmo-planning-scenario'),
  schemaVersion: z.literal(1),
  exportedAt: z.string().datetime(),
  scenario: planningScenarioSchema,
  templates: z.array(planningTemplateSchema).max(200),
});

export function exportScenario(scenario: PlanningScenario, templates: PlanningTemplate[]) {
  return JSON.stringify({
    format: 'cnpdrrmo-planning-scenario',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    scenario,
    templates,
  });
}

export function importPlanningFile(raw: string, province?: ProvinceGeoJSON) {
  if (raw.length > 5_000_000) throw new Error('Scenario file exceeds the 5 MB limit');
  const imported = nativeScenarioSchema.parse(JSON.parse(raw));
  const scenario = {
    ...structuredClone(imported.scenario) as PlanningScenario,
    id: crypto.randomUUID(),
    draftVersion: 0,
    archivedAt: undefined,
    updatedAt: new Date().toISOString(),
  } satisfies PlanningScenario;
  if (province && !scenarioInsideProvince(scenario, province)) throw new Error('Scenario contains objects outside Camarines Norte');
  return { scenario, templates: structuredClone(imported.templates) as PlanningTemplate[] };
}

export function importScenario(raw: string, province?: ProvinceGeoJSON) {
  return importPlanningFile(raw, province).scenario;
}

export function validateForPublish(scenario: PlanningScenario) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const parsed = planningScenarioSchema.safeParse(scenario);
  if (!parsed.success) errors.push(...parsed.error.issues.map(issue => issue.message));
  if (scenario.objects.length === 0) errors.push('Add at least one planning object');
  const unlabeled = scenario.objects.filter(object => object.kind !== 'text' && !object.label?.trim()).length;
  if (unlabeled > 0) warnings.push(`${unlabeled} object${unlabeled === 1 ? '' : 's'} have no label`);
  return { errors: [...new Set(errors)], warnings };
}
