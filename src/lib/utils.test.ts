import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as utils from '../lib/utils';

const MOCK_BARANGAY_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [122.9803837, 14.1337179] },
      properties: { name: 'Bagasbas', municipality: 'Daet', psgc: '501603003' }
    },
    {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [122.9508094, 14.1167055] },
      properties: { name: 'Barangay IV', municipality: 'Daet', psgc: '501603027' }
    },
    {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [122.9677101, 14.063421] },
      properties: { name: 'Poblacion 1', municipality: 'Basud', psgc: '501601022' }
    }
  ]
};

const { haversineDistance, getCentroid, detectLocationFromGeometry } = utils;

describe('formatDate', () => {
  it('returns a safe fallback for malformed legacy dates', () => {
    expect(utils.formatDate(undefined, 'MM/dd/yyyy')).toBe('Unknown');
    expect(utils.formatDate('not-a-date', 'MM/dd/yyyy')).toBe('Unknown');
  });
});

describe('haversineDistance', () => {
  it('identical coordinates returns 0 km', () => {
    const result = haversineDistance(14.0, 123.0, 14.0, 123.0);
    expect(result).toBe(0);
  });

  it('1 degree latitude difference returns ~111 km', () => {
    const result = haversineDistance(14.0, 123.0, 15.0, 123.0);
    expect(result).toBeCloseTo(111, -1);
  });

  it('1 degree longitude difference at equator returns ~111 km', () => {
    const result = haversineDistance(0.0, 0.0, 0.0, 1.0);
    expect(result).toBeCloseTo(111, -1);
  });

  it('Camarines Norte coords: Bagasbas vs Barangay IV returns ~3.5 km', () => {
    const result = haversineDistance(14.1337, 122.9804, 14.1167, 122.9508);
    expect(result).toBeCloseTo(3.5, 0);
  });

  it('near-zero distance returns < 0.05 km', () => {
    const result = haversineDistance(14.1337179, 122.9803837, 14.1338, 122.9804);
    expect(result).toBeLessThan(0.05);
  });
});

describe('getCentroid', () => {
  it('Point geometry returns correct lat/lng', () => {
    const result = getCentroid({ type: 'Point', coordinates: [123, 9] });
    expect(result).toEqual({ lat: 9, lng: 123 });
  });

  it('Point with lng/lat order returns correct values', () => {
    const result = getCentroid({ type: 'Point', coordinates: [122.98, 14.13] });
    expect(result).toEqual({ lat: 14.13, lng: 122.98 });
  });

  it('Polygon geometry returns centroid', () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]],
    };
    const result = getCentroid(polygon);
    expect(result).toEqual({ lat: 1.6, lng: 1.6 });
  });

  it('Polygon 4-corner square has centroid at center', () => {
    const square = {
      type: 'Polygon',
      coordinates: [[[10, 20], [30, 20], [30, 40], [10, 40], [10, 20]]],
    };
    const result = getCentroid(square);
    expect(result).toEqual({ lat: 28, lng: 18 });
  });

  it('LineString geometry returns centroid', () => {
    const line = { type: 'LineString', coordinates: [[0, 0], [4, 4]] };
    const result = getCentroid(line);
    expect(result).toEqual({ lat: 2, lng: 2 });
  });

  it('LineString with 3 points returns centroid', () => {
    const line = { type: 'LineString', coordinates: [[0, 0], [2, 2], [4, 4]] };
    const result = getCentroid(line);
    expect(result).toEqual({ lat: 2, lng: 2 });
  });

  it('null input returns null', () => {
    expect(getCentroid(null)).toBeNull();
  });

  it('undefined input returns null', () => {
    expect(getCentroid(undefined)).toBeNull();
  });

  it('Unknown geometry type MultiPolygon returns null', () => {
    expect(getCentroid({ type: 'MultiPolygon' })).toBeNull();
  });

  it('Unknown geometry type GeometryCollection returns null', () => {
    expect(getCentroid({ type: 'GeometryCollection' })).toBeNull();
  });

  it('Point geometry without coordinates returns null', () => {
    expect(getCentroid({ type: 'Point' })).toBeNull();
  });

  it('malformed legacy coordinates return null', () => {
    expect(getCentroid({ type: 'Polygon', coordinates: [[null, [1, 2]]] })).toBeNull();
    expect(getCentroid({ type: 'LineString', coordinates: [[1, 2], ['bad', 3]] })).toBeNull();
  });

  it('empty array returns null', () => {
    expect(getCentroid([])).toBeNull();
  });
});

describe('detectLocationFromGeometry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_BARANGAY_GEOJSON,
    }) as any;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('null geometry returns null', async () => {
    const result = await detectLocationFromGeometry(null);
    expect(result).toBeNull();
  });

  it('undefined geometry returns null', async () => {
    const result = await detectLocationFromGeometry(undefined);
    expect(result).toBeNull();
  });

  it('Point at [0,0] finds no barangays within 0.5km', async () => {
    const result = await detectLocationFromGeometry({
      type: 'Point',
      coordinates: [0, 0],
    });
    expect(result).toBeNull();
  });

  it('just under 0.5km is included', async () => {
    const bagasbasLat = 14.1337179;
    const bagasbasLng = 122.9803837;
    const point = {
      type: 'Point',
      coordinates: [bagasbasLng + 0.004, bagasbasLat],
    };
    const dist = haversineDistance(bagasbasLat, bagasbasLng, bagasbasLat, bagasbasLng + 0.004);
    expect(dist).toBeLessThan(0.5);
    const result = await detectLocationFromGeometry(point);
    expect(result).not.toBeNull();
  });

  it('at least 0.5km away returns null (strict threshold)', async () => {
    const bagasbasLat = 14.1337179;
    const bagasbasLng = 122.9803837;
    const point = {
      type: 'Point',
      coordinates: [bagasbasLng + 0.01, bagasbasLat],
    };
    const dist = haversineDistance(bagasbasLat, bagasbasLng, bagasbasLat, bagasbasLng + 0.01);
    expect(dist).toBeGreaterThanOrEqual(0.5);
    const result = await detectLocationFromGeometry(point);
    expect(result).toBeNull();
  });

  it('Point near Bagasbas detects single barangay', async () => {
    const point = {
      type: 'Point',
      coordinates: [122.9804, 14.1337],
    };
    const result = await detectLocationFromGeometry(point);
    expect(result).not.toBeNull();
    expect(result!.municipality).toBe('Daet');
    expect(result!.barangay).toBe('Bagasbas');
    expect(result!.isMultiple).toBe(false);
  });

  it('Polygon geometry detects nearby barangay', async () => {
    const polygon = {
      type: 'Polygon',
      coordinates: [[[122.967, 14.063], [122.968, 14.063], [122.968, 14.064], [122.967, 14.063]]],
    };
    const result = await detectLocationFromGeometry(polygon);
    expect(result).not.toBeNull();
    expect(result!.barangay).toContain('Poblacion 1');
  });

  it('results are sorted by distance ascending', async () => {
    const point = {
      type: 'Point',
      coordinates: [122.9804, 14.1337],
    };
    const result = await detectLocationFromGeometry(point);
    expect(result).not.toBeNull();
    const firstBarangay = result!.barangay.split(', ')[0];
    expect(firstBarangay).toBe('Bagasbas');
  });

});
