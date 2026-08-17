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
  { key: 'eoc', label: 'Emergency Operations Center', category: 'Command', glyph: 'EOC' },
  { key: 'icp', label: 'Incident Command Post', category: 'Command', glyph: 'ICP' },
  { key: 'staging', label: 'Staging Area', category: 'Command', glyph: 'S' },
  { key: 'checkpoint', label: 'Checkpoint', category: 'Command', glyph: 'CP' },
  { key: 'evacuation-center', label: 'Evacuation Center', category: 'Life Safety', glyph: 'EC' },
  { key: 'medical-post', label: 'Medical Post', category: 'Life Safety', glyph: '+' },
  { key: 'search-rescue', label: 'Search and Rescue', category: 'Life Safety', glyph: 'SAR' },
  { key: 'fire-service', label: 'Fire Service', category: 'Life Safety', glyph: 'FS' },
  { key: 'police', label: 'Police / Security', category: 'Life Safety', glyph: 'P' },
  { key: 'relief-goods', label: 'Relief Goods', category: 'Logistics', glyph: 'RG' },
  { key: 'food', label: 'Food', category: 'Logistics', glyph: 'F' },
  { key: 'water', label: 'Water', category: 'Logistics', glyph: 'W' },
  { key: 'temporary-shelter', label: 'Temporary Shelter', category: 'Logistics', glyph: 'TS' },
  { key: 'warehouse', label: 'Warehouse', category: 'Logistics', glyph: 'WH' },
  { key: 'ambulance', label: 'Ambulance', category: 'Transport', glyph: 'A' },
  { key: 'rescue-truck', label: 'Rescue Truck', category: 'Transport', glyph: 'RT' },
  { key: 'rescue-boat', label: 'Rescue Boat', category: 'Transport', glyph: 'RB' },
  { key: 'helicopter', label: 'Helicopter / Helispot', category: 'Transport', glyph: 'H' },
  { key: 'pickup-point', label: 'Pickup Point', category: 'Transport', glyph: 'PU' },
  { key: 'road-closure', label: 'Road Closure', category: 'Access & Impact', glyph: 'X' },
  { key: 'damaged-bridge', label: 'Damaged Bridge', category: 'Access & Impact', glyph: 'DB' },
  { key: 'stranded-people', label: 'Stranded People', category: 'Access & Impact', glyph: 'SP' },
  { key: 'affected-structure', label: 'Affected Structure', category: 'Access & Impact', glyph: 'AS' },
  { key: 'power-outage', label: 'Power Outage', category: 'Access & Impact', glyph: 'PO' },
  { key: 'flood', label: 'Projected Flood', category: 'Projected Hazard', glyph: 'FL' },
  { key: 'storm-surge', label: 'Projected Storm Surge', category: 'Projected Hazard', glyph: 'SS' },
  { key: 'landslide', label: 'Projected Landslide', category: 'Projected Hazard', glyph: 'LS' },
  { key: 'earthquake', label: 'Projected Earthquake Impact', category: 'Projected Hazard', glyph: 'EQ' },
  { key: 'tsunami', label: 'Projected Tsunami Impact', category: 'Projected Hazard', glyph: 'TSU' },
  { key: 'vehicular-incident', label: 'Projected Vehicular Incident', category: 'Projected Hazard', glyph: 'VI' },
  { key: 'fire-incident', label: 'Projected Fire', category: 'Projected Hazard', glyph: 'FI' },
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

export function eraseStroke(
  stroke: [number, number][],
  eraserPath: [number, number][],
  radiusMeters: number,
): [number, number][][] {
  if (eraserPath.length === 0) return [stroke.slice()];
  const parts: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const point of stroke) {
    const erased = eraserPath.some(eraserPoint => distanceMeters(point, eraserPoint) <= radiusMeters);
    if (erased) {
      if (current.length >= 2) parts.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length >= 2) parts.push(current);
  return parts;
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

export function importScenario(raw: string) {
  if (raw.length > 5_000_000) throw new Error('Scenario file exceeds the 5 MB limit');
  const imported = nativeScenarioSchema.parse(JSON.parse(raw));
  return {
    ...structuredClone(imported.scenario) as PlanningScenario,
    id: crypto.randomUUID(),
    draftVersion: 0,
    archivedAt: undefined,
    updatedAt: new Date().toISOString(),
  } satisfies PlanningScenario;
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
