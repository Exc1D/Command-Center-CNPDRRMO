import 'dotenv/config';
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { z } from "zod";

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

function generateErrorId() {
  return `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

app.use(express.json());

// Set up SQLite Database
const dbPath = path.resolve(process.cwd(), 'camarines_drrmc.db');
const db = new Database(dbPath);

// Initialize DB Table
db.prepare(`
  CREATE TABLE IF NOT EXISTS hazards (
    id TEXT PRIMARY KEY,
    type TEXT,
    severity TEXT,
    title TEXT,
    municipality TEXT,
    barangay TEXT,
    notes TEXT,
    geometry TEXT,
    dateAdded TEXT
  )
`).run();

// Migration: Add missing columns if they don't exist
const migrations = [
  { name: 'title', sql: 'ALTER TABLE hazards ADD COLUMN title TEXT' },
  { name: 'municipality', sql: 'ALTER TABLE hazards ADD COLUMN municipality TEXT' },
  { name: 'barangay', sql: 'ALTER TABLE hazards ADD COLUMN barangay TEXT' },
];

for (const mig of migrations) {
  try {
    db.prepare(mig.sql).run();
    console.log(`Migration added: ${mig.name}`);
  } catch (e) {
    if ((e as Error).message.includes('duplicate column name')) {
      // Expected
    } else {
      console.error(`Migration failed for ${mig.name}:`, e);
      throw e;
    }
  }
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS evacuation_centers (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    capacity INTEGER,
    municipality TEXT,
    barangay TEXT,
    coordinates TEXT,
    dateAdded TEXT
  )
`).run();

// Batch update: Auto-detect location for existing records without municipality
async function batchUpdateLocations() {
  const hazardsWithoutLocation = db.prepare("SELECT * FROM hazards WHERE municipality IS NULL OR municipality = ''").all();
  if (hazardsWithoutLocation.length === 0) {
    console.log('No records need location batch update');
    return;
  }
  console.log(`Batch updating location for ${hazardsWithoutLocation.length} records...`);

  // Load barangay GeoJSON
  const geojson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public/baranggays.geojson'), 'utf8'));

  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function getCentroid(geometry) {
    if (!geometry) return null;
    if (geometry.type === 'Point') {
      return { lat: geometry.coordinates[1], lng: geometry.coordinates[0] };
    }
    if (geometry.type === 'Polygon' && geometry.coordinates?.[0]) {
      const coords = geometry.coordinates[0];
      let latSum = 0, lngSum = 0;
      for (const c of coords) {
        latSum += c[1];
        lngSum += c[0];
      }
      return { lat: latSum / coords.length, lng: lngSum / coords.length };
    }
    if (geometry.type === 'LineString' && geometry.coordinates?.[0]) {
      const coords = geometry.coordinates;
      let latSum = 0, lngSum = 0;
      for (const c of coords) {
        latSum += c[1];
        lngSum += c[0];
      }
      return { lat: latSum / coords.length, lng: lngSum / coords.length };
    }
    return null;
  }

  function pointInPolygon(point, polygon) {
    if (!polygon || !point) return false;
    const coords = polygon.coordinates?.[0] || [];
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const xi = coords[i][0], yi = coords[i][1];
      const xj = coords[j][0], yj = coords[j][1];
      if (((yi > point.lat) !== (yj > point.lat)) && (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  for (const hazard of hazardsWithoutLocation as Array<{id: string; geometry: string}>) {
    try {
      const geometry = typeof hazard.geometry === 'string' ? JSON.parse(hazard.geometry) : hazard.geometry;
      const centroid = getCentroid(geometry);

      if (!centroid) continue;

      let detectedBarangays = [];
      let detectedMunicipality = null;

      // First check if centroid is inside any barangay polygon (but we have points, so use proximity)
      for (const feature of geojson.features) {
        const bCoords = feature.geometry.coordinates;
        const bLat = bCoords[1];
        const bLng = bCoords[0];
        const dist = haversineDistance(centroid.lat, centroid.lng, bLat, bLng);

        if (dist < 0.5) { // Within 500m
          detectedBarangays.push({
            name: feature.properties.name,
            municipality: feature.properties.municipality,
            distance: dist
          });
        }
      }

      // Sort by distance and take the nearest
      detectedBarangays.sort((a, b) => a.distance - b.distance);

      if (detectedBarangays.length > 0) {
        // Get unique municipalities from detected barangays
        detectedMunicipality = detectedBarangays[0].municipality;

        const barangayNames = detectedBarangays.slice(0, 3).map(b => b.name);
        const barangayStr = barangayNames.join(', ');

        db.prepare('UPDATE hazards SET municipality = ?, barangay = ? WHERE id = ?')
          .run(detectedMunicipality, barangayStr, hazard.id);
        console.log(`Updated hazard ${hazard.id}: ${detectedMunicipality}, ${barangayStr}`);
      }
    } catch (e) {
      console.error(`Failed to update hazard ${hazard.id}:`, (e as Error).message);
    }
  }
}

// API Routes
const hazardSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['flood', 'landslide', 'vehicular_accident', 'earthquake', 'storm_surge', 'tsunami']),
  severity: z.enum(['Minor', 'Moderate', 'Severe', 'Critical']),
  title: z.string().optional(),
  municipality: z.string().optional(),
  barangay: z.string().optional(),
  notes: z.string().optional(),
  geometry: z.object({ type: z.string(), coordinates: z.any() }),
  dateAdded: z.string().datetime().optional(),
});

const evacuationCenterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: z.enum(['school', 'barangay_hall', 'church', 'covered_court', 'other']),
  capacity: z.number().int().positive(),
  municipality: z.string().optional(),
  barangay: z.string().optional(),
  coordinates: z.tuple([z.number(), z.number()]),
  dateAdded: z.string().datetime().optional(),
});

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PIN Verification
const CORRECT_PIN = process.env.PIN_SECRET;
if (!CORRECT_PIN) {
  console.error('PIN_SECRET environment variable is required');
  process.exit(1);
}

app.post('/api/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (typeof pin !== 'string' || pin.length !== 4) {
    return res.status(400).json({ error: 'Invalid PIN format' });
  }
  if (pin === CORRECT_PIN) {
    res.json({ valid: true });
  } else {
    res.status(401).json({ valid: false });
  }
});

app.get("/api/hazards", (req, res) => {
  try {
    const hazards = db.prepare('SELECT * FROM hazards').all();
    res.json(hazards);
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to fetch hazards:`, error);
    res.status(500).json({ error: 'Failed to fetch hazards', errorId });
  }
});

app.post("/api/hazards", (req, res) => {
  try {
    const parsed = hazardSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid hazard data', details: parsed.error.flatten() });
    }
    const { id, type, severity, title, municipality, barangay, notes, geometry, dateAdded } = parsed.data;
    const stmt = db.prepare(`
      INSERT INTO hazards (id, type, severity, title, municipality, barangay, notes, geometry, dateAdded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, type, severity, title || '', municipality || '', barangay || '', notes, JSON.stringify(geometry), dateAdded);
    res.json({ success: true, id });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to save hazard:`, error);
    res.status(500).json({ error: 'Failed to save hazard', errorId });
  }
});

app.put("/api/hazards/:id", (req, res) => {
  try {
    const { id } = req.params;

    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid hazard ID format' });
    }

    const updateSchema = hazardSchema.partial().omit({ id: true });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });
    }

    const { type, severity, title, municipality, barangay, notes, geometry, dateAdded } = parsed.data;

    // Check if hazard exists
    const existing = db.prepare('SELECT * FROM hazards WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Hazard not found' });
    }

    const stmt = db.prepare(`
      UPDATE hazards
      SET type = COALESCE(?, type),
          severity = COALESCE(?, severity),
          title = COALESCE(?, title),
          municipality = COALESCE(?, municipality),
          barangay = COALESCE(?, barangay),
          notes = COALESCE(?, notes),
          geometry = COALESCE(?, geometry),
          dateAdded = COALESCE(?, dateAdded)
      WHERE id = ?
    `);
    stmt.run(
      type,
      severity,
      title,
      municipality,
      barangay,
      notes,
      geometry ? JSON.stringify(geometry) : undefined,
      dateAdded,
      id
    );
    res.json({ success: true, id });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to update hazard:`, error);
    res.status(500).json({ error: 'Failed to update hazard', errorId });
  }
});

app.delete("/api/hazards/:id", (req, res) => {
  try {
    const { id } = req.params;

    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid hazard ID format' });
    }

    const result = db.prepare('DELETE FROM hazards WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Hazard not found' });
    }
    res.json({ success: true });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to delete hazard:`, error);
    res.status(500).json({ error: 'Failed to delete hazard', errorId });
  }
});

app.get("/api/evacuation-centers", (req, res) => {
  try {
    const centers = db.prepare('SELECT * FROM evacuation_centers').all();
    res.json(centers);
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to fetch evacuation centers:`, error);
    res.status(500).json({ error: 'Failed to fetch evacuation centers', errorId });
  }
});

app.post("/api/evacuation-centers", (req, res) => {
  try {
    const parsed = evacuationCenterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid evacuation center data', details: parsed.error.flatten() });
    }
    const { id, name, type, capacity, municipality, barangay, coordinates, dateAdded } = parsed.data;
    const stmt = db.prepare(`
      INSERT INTO evacuation_centers (id, name, type, capacity, municipality, barangay, coordinates, dateAdded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, name, type, capacity, municipality || '', barangay || '', JSON.stringify(coordinates), dateAdded);
    res.json({ success: true, id });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to save evacuation center:`, error);
    res.status(500).json({ error: 'Failed to save evacuation center', errorId });
  }
});

app.put("/api/evacuation-centers/:id", (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid evacuation center ID format' });
    }
    const updateSchema = evacuationCenterSchema.partial().omit({ id: true });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });
    }
    const { name, type, capacity, municipality, barangay, coordinates, dateAdded } = parsed.data;
    const existing = db.prepare('SELECT * FROM evacuation_centers WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    const stmt = db.prepare(`
      UPDATE evacuation_centers
      SET name = COALESCE(?, name),
          type = COALESCE(?, type),
          capacity = COALESCE(?, capacity),
          municipality = COALESCE(?, municipality),
          barangay = COALESCE(?, barangay),
          coordinates = COALESCE(?, coordinates),
          dateAdded = COALESCE(?, dateAdded)
      WHERE id = ?
    `);
    stmt.run(
      name,
      type,
      capacity,
      municipality,
      barangay,
      coordinates ? JSON.stringify(coordinates) : undefined,
      dateAdded,
      id
    );
    res.json({ success: true, id });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to update evacuation center:`, error);
    res.status(500).json({ error: 'Failed to update evacuation center', errorId });
  }
});

app.delete("/api/evacuation-centers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pin = req.headers['x-pin'] as string;

    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid evacuation center ID format' });
    }

    if (!pin || pin !== process.env.PIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = db.prepare('DELETE FROM evacuation_centers WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    res.json({ success: true });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to delete evacuation center:`, error);
    res.status(500).json({ error: 'Failed to delete evacuation center', errorId });
  }
});

async function startServer() {
  // Run batch update for existing records
  await batchUpdateLocations();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
