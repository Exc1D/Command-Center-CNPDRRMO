import { expect, it } from 'vitest';
import { pointInShape, municipalityFromBoundary, nearestBarangay } from './reference';

it('tests points against polygons with holes and multipolygons', () => {
  const square = [[0,0],[10,0],[10,10],[0,10],[0,0]];
  const hole = [[4,4],[6,4],[6,6],[4,6],[4,4]];
  expect(pointInShape([2,2], {type:'Polygon',coordinates:[square,hole]})).toBe(true);
  expect(pointInShape([5,5], {type:'Polygon',coordinates:[square,hole]})).toBe(false);
  expect(pointInShape([12,2], {type:'Polygon',coordinates:[square]})).toBe(false);
  expect(pointInShape([21,1], {type:'MultiPolygon',coordinates:[[square],[[[20,0],[22,0],[22,2],[20,2],[20,0]]]]})).toBe(true);
});

it('maps boundary names to municipality names and finds the closest barangay', () => {
  expect(municipalityFromBoundary('Daet (Capital)')).toBe('Daet');
  expect(municipalityFromBoundary('San Lorenzo Ruiz (Imelda)')).toBe('San Lorenzo Ruiz (Imelda)');
  expect(nearestBarangay('Basud', 13.9957214, 122.9381321)?.name).toBe('Caayunan');
});
