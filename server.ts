import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createPlanningRouter } from "./src/server/planning";

const PORT = parseInt(process.env.PORT || '3000', 10);

function generateErrorId() {
  return `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDatabase(dbPath = path.resolve(process.cwd(), 'camarines_drrmc.db')) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS hazards (
      id TEXT PRIMARY KEY, type TEXT, severity TEXT, title TEXT, municipality TEXT,
      barangay TEXT, notes TEXT, geometry TEXT, dateAdded TEXT, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS evacuation_centers (
      id TEXT PRIMARY KEY, name TEXT, type TEXT, capacity INTEGER, municipality TEXT,
      barangay TEXT, coordinates TEXT, dateAdded TEXT, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS operations_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, method TEXT NOT NULL,
      path TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `);
  const migrations = [
    ['hazards', 'title', 'TEXT'], ['hazards', 'municipality', 'TEXT'], ['hazards', 'barangay', 'TEXT'],
    ['hazards', 'version', 'INTEGER NOT NULL DEFAULT 1'], ['evacuation_centers', 'version', 'INTEGER NOT NULL DEFAULT 1'],
  ];
  for (const [table, column, type] of migrations) {
    if (!(db.pragma(`table_info(${table})`) as Array<{ name: string }>).some(item => item.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }
  return db;
}

// Batch update: Auto-detect location for existing records without municipality
async function batchUpdateLocations(db: Database.Database) {
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
const longitude = z.number().finite().min(-180).max(180);
const latitude = z.number().finite().min(-90).max(90);
const coordinate = z.tuple([longitude, latitude]);
const geometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: coordinate }),
  z.object({ type: z.literal('LineString'), coordinates: z.array(coordinate).min(2).max(20_000) }),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(coordinate).min(4).max(20_000)).min(1).max(32) }),
]);

const hazardSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['flood', 'landslide', 'vehicular_accident', 'earthquake', 'storm_surge', 'tsunami']),
  severity: z.enum(['Minor', 'Moderate', 'Severe', 'Critical']),
  title: z.string().trim().max(120).optional(),
  municipality: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(500).optional(),
  notes: z.string().max(4_000).default(''),
  geometry: geometrySchema,
  dateAdded: z.string().datetime(),
  version: z.number().int().nonnegative().optional(),
});

const evacuationCenterSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  type: z.enum(['school', 'barangay_hall', 'church', 'covered_court', 'other']),
  capacity: z.number().int().positive().max(1_000_000),
  municipality: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(500).optional(),
  coordinates: coordinate,
  dateAdded: z.string().datetime(),
  version: z.number().int().nonnegative().optional(),
});

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApp(db: Database.Database, correctPin: string, provinceBoundary?: Parameters<typeof createPlanningRouter>[2]) {
  if (!/^\d{4}$/.test(correctPin)) throw new Error('PIN_SECRET must contain exactly four digits');
  const app = express();
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // ponytail: process-local sessions and rate limits; use a shared store only for multi-instance deployment.
  const operationsSessions = new Map<string, { id: string; expiresAt: number }>();
  // ponytail: sessions are the audit identity; add named accounts when distinct operator roles are required.
  const pinAttempts = new Map<string, { count: number; resetAt: number }>();
  const recordAudit = (sessionId: string, method: string, route: string) => {
    try {
      db.prepare('INSERT INTO operations_audit (session_id, method, path, created_at) VALUES (?, ?, ?, ?)')
        .run(sessionId, method, route, new Date().toISOString());
    } catch (error) {
      console.error('Failed to record operations audit entry:', error);
    }
  };
  const tokenFrom = (request: express.Request) => request.headers.cookie?.match(/(?:^|;\s*)operationsToken=([^;]+)/)?.[1];
  const hasOperationsSession = (request: express.Request) => {
    const token = tokenFrom(request);
    if (!token) return false;
    const session = operationsSessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      operationsSessions.delete(token);
      return false;
    }
    return true;
  };

  app.post('/api/verify-pin', (request, response, next) => {
    const identity = `ip:${request.ip || 'unknown'}`;
    response.on('finish', () => recordAudit(identity, request.method, `${request.path}:${response.statusCode}`));
    next();
  }, express.json({ limit: '1kb' }), (request, response) => {
    const key = request.ip || 'unknown';
    const now = Date.now();
    if (!pinAttempts.has(key) && pinAttempts.size >= 10_000) {
      for (const [ip, attempt] of pinAttempts) if (attempt.resetAt <= now) pinAttempts.delete(ip);
      if (pinAttempts.size >= 10_000) return response.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const attempts = pinAttempts.get(key);
    if (attempts && attempts.resetAt > now && attempts.count >= 5) {
      return response.status(429).json({ error: 'Too many attempts. Try again later.' });
    }
    const { pin } = request.body;
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return response.status(400).json({ error: 'Invalid PIN format' });
    if (pin !== correctPin) {
      pinAttempts.set(key, { count: attempts && attempts.resetAt > now ? attempts.count + 1 : 1, resetAt: now + 15 * 60 * 1000 });
      return response.status(401).json({ valid: false });
    }
    pinAttempts.delete(key);
    if (operationsSessions.size >= 10_000) {
      for (const [id, session] of operationsSessions) if (session.expiresAt <= now) operationsSessions.delete(id);
      if (operationsSessions.size >= 10_000) return response.status(503).json({ error: 'Too many active sessions' });
    }
    const token = randomUUID();
    operationsSessions.set(token, { id: randomUUID(), expiresAt: now + 8 * 60 * 60 * 1000 });
    response.setHeader('Set-Cookie', `operationsToken=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    response.json({ valid: true });
  });

  app.get('/api/session', (request, response) => response.json({ valid: hasOperationsSession(request) }));
  app.post('/api/logout', (request, response) => {
    const token = tokenFrom(request);
    if (token) operationsSessions.delete(token);
    response.setHeader('Set-Cookie', 'operationsToken=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    response.json({ success: true });
  });

  // Protect every current and future mutation at one boundary; public reads opt in inside their routers.
  app.use((request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.path === '/api/verify-pin') return next();
    if (!hasOperationsSession(request)) return response.status(401).json({ error: 'Authorization required' });
    const sessionId = operationsSessions.get(tokenFrom(request)!)!.id;
    response.on('finish', () => {
      if (response.statusCode < 400 && request.path !== '/api/logout') {
        recordAudit(sessionId, request.method, request.path);
      }
    });
    next();
  });
  app.use(express.json({ limit: '6mb' }));

  app.use('/api/planning', createPlanningRouter(db, hasOperationsSession, provinceBoundary));

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
    res.status(201).json({ success: true, id, version: 1 });
  } catch (error) {
    if ((error as Error).message.includes('UNIQUE')) return res.status(409).json({ error: 'Hazard already exists' });
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

    const updateSchema = hazardSchema.partial().omit({ id: true, version: true }).extend({ version: z.number().int().positive() });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });
    }

    const { type, severity, title, municipality, barangay, notes, geometry, dateAdded, version } = parsed.data;

    // Check if hazard exists
    const existing = db.prepare('SELECT * FROM hazards WHERE id = ?').get(id) as { version: number } | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Hazard not found' });
    }
    if (version !== existing.version) {
      return res.status(409).json({ error: 'Hazard changed', current: db.prepare('SELECT * FROM hazards WHERE id = ?').get(id) });
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
          dateAdded = COALESCE(?, dateAdded),
          version = version + 1
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
    res.json({ success: true, id, version: existing.version + 1 });
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
    res.status(201).json({ success: true, id, version: 1 });
  } catch (error) {
    if ((error as Error).message.includes('UNIQUE')) return res.status(409).json({ error: 'Evacuation center already exists' });
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
    const updateSchema = evacuationCenterSchema.partial().omit({ id: true, version: true }).extend({ version: z.number().int().positive() });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });
    }
    const { name, type, capacity, municipality, barangay, coordinates, dateAdded, version } = parsed.data;
    const existing = db.prepare('SELECT * FROM evacuation_centers WHERE id = ?').get(id) as { version: number } | undefined;
    if (!existing) {
      return res.status(404).json({ error: 'Evacuation center not found' });
    }
    if (version !== existing.version) {
      return res.status(409).json({ error: 'Evacuation center changed', current: db.prepare('SELECT * FROM evacuation_centers WHERE id = ?').get(id) });
    }
    const stmt = db.prepare(`
      UPDATE evacuation_centers
      SET name = COALESCE(?, name),
          type = COALESCE(?, type),
          capacity = COALESCE(?, capacity),
          municipality = COALESCE(?, municipality),
          barangay = COALESCE(?, barangay),
          coordinates = COALESCE(?, coordinates),
          dateAdded = COALESCE(?, dateAdded),
          version = version + 1
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
    res.json({ success: true, id, version: existing.version + 1 });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to update evacuation center:`, error);
    res.status(500).json({ error: 'Failed to update evacuation center', errorId });
  }
});

app.delete("/api/evacuation-centers/:id", (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid evacuation center ID format' });
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

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (error instanceof SyntaxError && 'body' in error) return response.status(400).json({ error: 'Invalid JSON body' });
    next(error);
  });

  return app;
}

async function startServer() {
  const correctPin = process.env.PIN_SECRET;
  if (!correctPin) throw new Error('PIN_SECRET environment variable is required');
  const db = createDatabase(process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : undefined);
  await batchUpdateLocations(db);
  const provinceBoundary = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'Municipal Boundary.geojson'), 'utf8'));
  const app = createApp(db, correctPin, provinceBoundary);

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import('vite');
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

if (!process.env.VITEST) {
  startServer().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
