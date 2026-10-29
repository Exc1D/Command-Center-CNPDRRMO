export const MAP_CONFIG = {
  PROVINCE_CENTER: [14.1167, 122.9500] as [number, number],
  DEFAULT_ZOOM: 10,
  // Bounding box of the NAMRIA municipal boundaries; the home view fits this instead of a fixed zoom.
  PROVINCE_BOUNDS: [[13.8376, 122.2986], [14.5012, 123.1181]] as [[number, number], [number, number]],
  BARANGAY_ZOOM: 15,
  MUNICIPALITY_ZOOM: 13,
  DETECTION_THRESHOLD_KM: 0.5,
} as const;