import { estimateExposure } from './src/server/population';
import { analyzeLayerExposure } from './src/server/layerExposure';
import { restorePrivateReferenceFiles } from './src/server/privateReferenceFiles';
import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createPlanningRouter } from "./src/server/planning";
import { all, createDatabase, execute, one, type Database } from "./src/server/database";

import { HAZARD_TYPES, LEGACY_TYPES, canonicalLocation, municipalities, REFERENCE_LAYERS, FLOOD_COLORS } from './src/lib/reference';

export { createDatabase } from "./src/server/database";

const PORT = parseInt(process.env.PORT || '3000', 10);

function generateErrorId() {
  return `ERR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  type: z.string().refine(value => [...HAZARD_TYPES,...LEGACY_TYPES].some(t => t.id === value)),
  affectedPopulationBasis: z.enum(['reported','population_estimate','household_estimate']).transform(value => value === 'household_estimate' ? 'population_estimate' : value).optional(),
  affectedPopulation: z.number().int().min(0).max(100_000_000).nullable().optional(),
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

export function createApp(db: Database, correctPin: string, provinceBoundary?: Parameters<typeof createPlanningRouter>[2]) {
  if (!/^\d{4}$/.test(correctPin)) throw new Error('PIN_SECRET must contain exactly four digits');
  const app = express();
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // ponytail: process-local sessions and rate limits; use a shared store only for multi-instance deployment.
  const operationsSessions = new Map<string, { id: string; expiresAt: number }>();
  // ponytail: sessions are the audit identity; add named accounts when distinct operator roles are required.
  const pinAttempts = new Map<string, { count: number; resetAt: number }>();
  const recordAudit = (sessionId: string, method: string, route: string) => {
    void execute(db, 'INSERT INTO operations_audit (session_id, method, path, created_at) VALUES (?, ?, ?, ?)', sessionId, method, route, new Date().toISOString()).catch(error => {
      console.error('Failed to record operations audit entry:', error);
    });
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

  app.get('/api/reference/population/:municipality', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!hasOperationsSession(request)) return response.status(401).json({error:'Authorization required'});
    const municipality = request.params.municipality;
    if (!municipalities.includes(municipality)) return response.status(404).json({error:'Municipality not found'});
    try {
      const contents = await fs.promises.readFile(path.join(process.cwd(), '.private/population', municipality + '.geojson'), 'utf8');
      response.type('json').send(contents);
    } catch {
      response.status(404).json({error:'Population data unavailable for this municipality'});
    }
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

  app.post('/api/reference/layer-exposure', async (request,response) => {
    response.setHeader('Cache-Control','no-store');
    const parsed=z.object({
      layers:z.array(z.string().refine(id=>REFERENCE_LAYERS.some(l=>l.id===id))).min(1).max(REFERENCE_LAYERS.length),
      floodClasses:z.array(z.string().refine(value=>Object.hasOwn(FLOOD_COLORS,value))).max(4).default([]),
      municipality:z.string().refine(value=>value==='' || municipalities.includes(value)).default(''),
      barangay:z.string().max(120).default(''),
    }).strict().safeParse(request.body);
    if(!parsed.success || (parsed.data.barangay && !canonicalLocation(parsed.data.municipality,parsed.data.barangay))) return response.status(400).json({error:'Choose valid hazard layers and a municipality/barangay from the location list.'});
    if(parsed.data.barangay) parsed.data.barangay=canonicalLocation(parsed.data.municipality,parsed.data.barangay)!.barangay;
    try {response.json(await analyzeLayerExposure(parsed.data));}
    catch {response.status(503).json({error:'Hazard–population analysis is unavailable. Prepare the private population exposure dataset on the server, then retry.'});}
  });

  app.post('/api/reference/population-exposure', async (request,response) => {
    response.setHeader('Cache-Control','no-store');
    const parsed=z.object({geometry:geometrySchema, radiusMetres:z.number().min(1).max(50000).optional()}).safeParse(request.body);
    if(!parsed.success) return response.status(400).json({error:'Invalid exposure area'});
    if(parsed.data.geometry.type==='LineString') return response.status(400).json({error:'Use a polygon area or a point with an explicit radius'});
    if(parsed.data.geometry.type==='Point' && parsed.data.radiusMetres===undefined) return response.status(400).json({error:'Choose a radius for the incident point'});
    if(parsed.data.geometry.type==='Polygon' && parsed.data.geometry.coordinates.some(ring => {
      const first=ring[0], last=ring.at(-1)!;
      return first[0]!==last[0] || first[1]!==last[1] || new Set(ring.map(point=>point.join(','))).size<3;
    })) return response.status(400).json({error:'Population analysis requires closed polygon rings with at least three distinct vertices'});
    if(parsed.data.geometry.type==='Polygon' && parsed.data.geometry.coordinates.flat().length>2000) return response.status(400).json({error:'Use an incident area with at most 2,000 vertices for population analysis'});
    try {response.json(await estimateExposure(parsed.data.geometry as Parameters<typeof estimateExposure>[0],parsed.data.radiusMetres));}
    catch {response.status(503).json({error:'Population analysis unavailable. Source files may be missing or invalid.'});}
  });

  app.use('/api/planning', createPlanningRouter(db, hasOperationsSession, provinceBoundary));

app.get("/api/hazards", async (req, res) => {
  try {
    const hazards = await all(db, 'SELECT * FROM hazards');
    res.json(hazards);
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to fetch hazards:`, error);
    res.status(500).json({ error: 'Failed to fetch hazards', errorId });
  }
});

app.post("/api/hazards", async (req, res) => {
  try {
    const parsed = hazardSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid hazard data', details: parsed.error.flatten() });
    }
    const { id, type, severity, title, notes, geometry, dateAdded, affectedPopulation, affectedPopulationBasis } = parsed.data;
    const location = canonicalLocation(parsed.data.municipality,parsed.data.barangay);
    if (!location) return res.status(400).json({error:'Select a valid municipality and barangay'});
    const {municipality,barangay} = location;
    // Retain legacy types arriving from an existing offline queue with their original meaning.

    await execute(db, `
      INSERT INTO hazards (id, type, severity, title, municipality, barangay, notes, geometry, dateAdded, affectedPopulation, affectedPopulationBasis)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, type, severity, title || '', municipality || '', barangay || '', notes, JSON.stringify(geometry), dateAdded, affectedPopulation ?? null, affectedPopulationBasis ?? 'reported');
    res.status(201).json({ success: true, id, version: 1 });
  } catch (error) {
    if ((error as Error).message.includes('UNIQUE')) return res.status(409).json({ error: 'Hazard already exists' });
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to save hazard:`, error);
    res.status(500).json({ error: 'Failed to save hazard', errorId });
  }
});

app.put("/api/hazards/:id", async (req, res) => {
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

    let { type, severity, title, municipality, barangay, notes, geometry, dateAdded, version, affectedPopulation, affectedPopulationBasis } = parsed.data;
    const current = await one<Record<string, unknown>>(db, 'SELECT * FROM hazards WHERE id = ?', id);
    if (!current) return res.status(404).json({error:'Hazard not found'});
    if ((municipality !== undefined && municipality !== current.municipality) || (barangay !== undefined && barangay !== current.barangay)) {
      if (!canonicalLocation(municipality ?? String(current.municipality || ''), barangay ?? String(current.barangay || ''))) return res.status(400).json({error:'Select a valid municipality and barangay'});
    }

    if (geometry && JSON.stringify(geometry) !== current.geometry && (affectedPopulationBasis ?? current.affectedPopulationBasis) === 'population_estimate') {
      affectedPopulation = null;
      affectedPopulationBasis = 'reported';
    }

    const result = await execute(db, `
      UPDATE hazards
      SET affectedPopulationBasis = COALESCE(?, affectedPopulationBasis),
          affectedPopulation = CASE WHEN ? THEN ? ELSE affectedPopulation END,
          type = COALESCE(?, type),
          severity = COALESCE(?, severity),
          title = COALESCE(?, title),
          municipality = COALESCE(?, municipality),
          barangay = COALESCE(?, barangay),
          notes = COALESCE(?, notes),
          geometry = COALESCE(?, geometry),
          dateAdded = COALESCE(?, dateAdded),
          version = version + 1
      WHERE id = ? AND version = ?
    `,
      affectedPopulationBasis,
      affectedPopulation !== undefined ? 1 : 0,
      affectedPopulation ?? null,
      type,
      severity,
      title,
      municipality,
      barangay,
      notes,
      geometry ? JSON.stringify(geometry) : undefined,
      dateAdded,
      id,
      version,
    );
    if (result.rowsAffected === 0) {
      const current = await one<Record<string, unknown>>(db, 'SELECT * FROM hazards WHERE id = ?', id);
      return current ? res.status(409).json({ error: 'Hazard changed', current }) : res.status(404).json({ error: 'Hazard not found' });
    }
    res.json({ success: true, id, version: version + 1 });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to update hazard:`, error);
    res.status(500).json({ error: 'Failed to update hazard', errorId });
  }
});

app.delete("/api/hazards/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid hazard ID format' });
    }

    const result = await execute(db, 'DELETE FROM hazards WHERE id = ?', id);
    if (result.rowsAffected === 0) {
      return res.status(404).json({ error: 'Hazard not found' });
    }
    res.json({ success: true });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to delete hazard:`, error);
    res.status(500).json({ error: 'Failed to delete hazard', errorId });
  }
});

app.get("/api/evacuation-centers", async (req, res) => {
  try {
    const centers = await all(db, 'SELECT * FROM evacuation_centers');
    res.json(centers);
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to fetch evacuation centers:`, error);
    res.status(500).json({ error: 'Failed to fetch evacuation centers', errorId });
  }
});

app.post("/api/evacuation-centers", async (req, res) => {
  try {
    const parsed = evacuationCenterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid evacuation center data', details: parsed.error.flatten() });
    }
    const { id, name, type, capacity, municipality, barangay, coordinates, dateAdded } = parsed.data;
    await execute(db, `
      INSERT INTO evacuation_centers (id, name, type, capacity, municipality, barangay, coordinates, dateAdded)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, id, name, type, capacity, municipality || '', barangay || '', JSON.stringify(coordinates), dateAdded);
    res.status(201).json({ success: true, id, version: 1 });
  } catch (error) {
    if ((error as Error).message.includes('UNIQUE')) return res.status(409).json({ error: 'Evacuation center already exists' });
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to save evacuation center:`, error);
    res.status(500).json({ error: 'Failed to save evacuation center', errorId });
  }
});

app.put("/api/evacuation-centers/:id", async (req, res) => {
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
    const result = await execute(db, `
      UPDATE evacuation_centers
      SET name = COALESCE(?, name),
          type = COALESCE(?, type),
          capacity = COALESCE(?, capacity),
          municipality = COALESCE(?, municipality),
          barangay = COALESCE(?, barangay),
          coordinates = COALESCE(?, coordinates),
          dateAdded = COALESCE(?, dateAdded),
          version = version + 1
      WHERE id = ? AND version = ?
    `,
      name,
      type,
      capacity,
      municipality,
      barangay,
      coordinates ? JSON.stringify(coordinates) : undefined,
      dateAdded,
      id,
      version,
    );
    if (result.rowsAffected === 0) {
      const current = await one<Record<string, unknown>>(db, 'SELECT * FROM evacuation_centers WHERE id = ?', id);
      return current ? res.status(409).json({ error: 'Evacuation center changed', current }) : res.status(404).json({ error: 'Evacuation center not found' });
    }
    res.json({ success: true, id, version: version + 1 });
  } catch (error) {
    const errorId = generateErrorId();
    console.error(`[${errorId}] Failed to update evacuation center:`, error);
    res.status(500).json({ error: 'Failed to update evacuation center', errorId });
  }
});

app.delete("/api/evacuation-centers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!uuidRegex.test(id)) {
      return res.status(400).json({ error: 'Invalid evacuation center ID format' });
    }

    const result = await execute(db, 'DELETE FROM evacuation_centers WHERE id = ?', id);
    if (result.rowsAffected === 0) {
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
  const db = await createDatabase();
  await restorePrivateReferenceFiles(db);
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
