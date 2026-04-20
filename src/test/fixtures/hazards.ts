import type { Hazard } from '@/lib/db';

// h1 — Flood in Daet municipality
export const h1: Hazard = {
  id: 'h1',
  type: 'flood',
  severity: 'Moderate',
  title: 'Brgy. Bagasbas Flooding',
  municipality: 'Daet',
  barangay: 'Bagasbas',
  notes: 'Low-lying area near coast',
  geometry: { type: 'Point', coordinates: [122.9803837, 14.1337179] },
  dateAdded: '2026-04-15T08:00:00Z'
};

// h2 — Landslide in Mercedes
export const h2: Hazard = {
  id: 'h2',
  type: 'landslide',
  severity: 'Severe',
  title: 'Mercedes Landslide Zone',
  municipality: 'Mercedes',
  barangay: 'Mercedes',
  notes: 'Hillside erosion observed',
  geometry: { type: 'Point', coordinates: [122.9803837, 14.1337179] },
  dateAdded: '2026-04-16T10:00:00Z'
};

// h3 — Vehicular accident in Daet
export const h3: Hazard = {
  id: 'h3',
  type: 'vehicular_accident',
  severity: 'Minor',
  title: 'Daet Highway Collision',
  municipality: 'Daet',
  barangay: 'Barangay IV',
  notes: 'Two-vehicle collision, no injuries',
  geometry: { type: 'Point', coordinates: [122.9508094, 14.1167055] },
  dateAdded: '2026-04-17T14:00:00Z'
};

// h4 — Earthquake fault line
export const h4: Hazard = {
  id: 'h4',
  type: 'earthquake',
  severity: 'Critical',
  title: 'Camarineste Fault Line',
  municipality: 'Labo',
  barangay: 'Anameam',
  notes: 'Seismic activity detected',
  geometry: { type: 'Point', coordinates: [122.588174, 14.1707462] },
  dateAdded: '2026-04-18T06:00:00Z'
};

// h5 — Storm surge in Basud
export const h5: Hazard = {
  id: 'h5',
  type: 'storm_surge',
  severity: 'Severe',
  title: 'Basud Storm Surge Area',
  municipality: 'Basud',
  barangay: 'Poblacion 1',
  notes: 'Coastal flooding during high tide',
  geometry: { type: 'Point', coordinates: [122.9677101, 14.063421] },
  dateAdded: '2026-04-19T12:00:00Z'
};

// h6 — Tsunami risk in Capalonga
export const h6: Hazard = {
  id: 'h6',
  type: 'tsunami',
  severity: 'Moderate',
  title: 'Capalonga Coastal Zone',
  municipality: 'Capalonga',
  barangay: 'Poblacion',
  notes: 'Evacuation routes marked',
  geometry: { type: 'Point', coordinates: [122.4962532, 14.3337694] },
  dateAdded: '2026-04-20T09:00:00Z'
};