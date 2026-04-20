// Minimal 3-barangkay subset for precise 0.5km boundary testing
// Selected for known inter-barangkay distances

export const MOCK_BARANGAY_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [122.9803837, 14.1337179] },
      properties: { name: 'Bagasbas', municipality: 'Daet', psgc: '501603003' }
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [122.9508094, 14.1167055] },
      properties: { name: 'Barangay IV', municipality: 'Daet', psgc: '501603027' }
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [122.9677101, 14.063421] },
      properties: { name: 'Poblacion 1', municipality: 'Basud', psgc: '501601022' }
    }
  ]
};

// Key distances (verified via haversine):
// - Bagasbas → Barangay IV: ~3.5km (outside 0.5km threshold)
// - Poblacion 1 → test Point at [122.9677, 14.0634]: <0.1km (within range)