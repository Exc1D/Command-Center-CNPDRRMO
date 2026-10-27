import { estimateExposure } from './src/server/population';
import { analyzeLayerExposure } from './src/server/layerExposure';
import { privateDir, restorePrivateReferenceFiles } from './src/server/privateReferenceFiles';
import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createPlanningRouter } from "./src/server/planning";
import { all, createDatabase, execute, one, type Database } from "./src/server/database";

import { HAZARD_TYPES, LEGACY_TYPES, canonicalLocation, municipalities, REFERENCE_LAYERS, FLOOD_COLORS } from './src/lib/reference';
import { PLANNING_SYMBOLS } from './src/lib/planning';

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
  type: z.string().refine(value => value === 'resource' || [...HAZARD_TYPES,...LEGACY_TYPES].some(t => t.id === value)),
  symbolKey: z.string().refine(value => PLANNING_SYMBOLS.some(symbol => symbol.key === value)).nullable().optional(),
  affectedPopulationBasis: z.enum(['reported','population_estimate','household_estimate']).transform(value => value === 'household_estimate' ? 'population_estimate' : value).optional(),
  affectedPopulation: z.number().int().min(0).max(100_000_000).nullable().optional(),
  severity: z.enum(['Minor', 'Moderate', 'Severe', 'Critical', 'Not applicable']),
  title: z.string().trim().max(120).optional(),
  municipality: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(500).optional(),
  notes: z.string().max(4_000).default(''),
  geometry: geometrySchema,
  dateAdded: z.string().datetime(),
  version: z.number().int().nonnegative().optional(),
});

// Resource pins reuse operational storage and offline sync without becoming incidents.
function validPinKind(record: { type: unknown; severity: unknown; symbolKey?: unknown; geometry?: { type?: string }; affectedPopulation?: unknown; affectedPopulationBasis?: unknown }) {
  return record.type === 'resource'
    ? record.geometry?.type === 'Point' && Boolean(record.symbolKey) && record.severity === 'Not applicable' && record.affectedPopulation == null && record.affectedPopulationBasis !== 'population_estimate'
    : record.severity !== 'Not applicable';
}

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
  // Vercel's edge sets X-Forwarded-For itself, so trust it there; elsewhere only trust local proxies.
  app.set('trust proxy', process.env.VERCEL ? true : 'loopback, linklocal, uniquelocal');

  // Sessions and PIN attempts live in the database so every serverless instance sees the same state.
  // ponytail: sessions are the audit identity; add named accounts when distinct operator roles are required.
  const recordAudit = (sessionId: string, method: string, route: string) => {
    void execute(db, 'INSERT INTO operations_audit (session_id, method, path, created_at) VALUES (?, ?, ?, ?)', sessionId, method, route, new Date().toISOString()).catch(error => {
      console.error('Failed to record operations audit entry:', error);
    });
  };
  const tokenFrom = (request: express.Request) => request.headers.cookie?.match(/(?:^|;\s*)operationsToken=([^;]+)/)?.[1];
  const operationsSessionId = async (request: express.Request) => {
    const token = tokenFrom(request);
    if (!token) return undefined;
    const session = await one<{ id: string }>(db, 'SELECT id FROM operations_sessions WHERE token = ? AND expires_at > ?', token, Date.now());
    return session?.id;
  };
  const hasOperationsSession = async (request: express.Request) => Boolean(await operationsSessionId(request));

  app.post('/api/verify-pin', (request, response, next) => {
    const identity = `ip:${request.ip || 'unknown'}`;
    response.on('finish', () => recordAudit(identity, request.method, `${request.path}:${response.statusCode}`));
    next();
  }, express.json({ limit: '1kb' }), async (request, response, next) => {
    try {
      const key = request.ip || 'unknown';
      const now = Date.now();
      const attempts = await one<{ count: number; reset_at: number }>(db, 'SELECT count, reset_at FROM pin_attempts WHERE ip = ?', key);
      if (attempts && attempts.reset_at > now && attempts.count >= 5) {
        return response.status(429).json({ error: 'Too many attempts. Try again later.' });
      }
      const { pin } = request.body;
      if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return response.status(400).json({ error: 'Invalid PIN format' });
      if (pin !== correctPin) {
        const count = attempts && attempts.reset_at > now ? attempts.count + 1 : 1;
        await execute(db, 'INSERT INTO pin_attempts (ip, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(ip) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at', key, count, now + 15 * 60 * 1000);
        return response.status(401).json({ valid: false });
      }
      const token = randomUUID();
      await db.batch([
        { sql: 'DELETE FROM pin_attempts WHERE ip = ? OR reset_at <= ?', args: [key, now] },
        { sql: 'DELETE FROM operations_sessions WHERE expires_at <= ?', args: [now] },
        { sql: 'INSERT INTO operations_sessions (token, id, expires_at) VALUES (?, ?, ?)', args: [token, randomUUID(), now + 8 * 60 * 60 * 1000] },
      ], 'write');
      response.setHeader('Set-Cookie', `operationsToken=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      response.json({ valid: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/reference/population/:municipality', async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!await hasOperationsSession(request)) return response.status(401).json({error:'Authorization required'});
    const municipality = request.params.municipality;
    if (!municipalities.includes(municipality)) return response.status(404).json({error:'Municipality not found'});
    try {
      const contents = await fs.promises.readFile(path.join(privateDir, 'population', municipality + '.geojson'), 'utf8');
      response.type('json').send(contents);
    } catch {
      response.status(404).json({error:'Population data unavailable for this municipality'});
    }
  });

  app.get('/api/session', (request, response, next) => {
    hasOperationsSession(request).then(valid => response.json({ valid }), next);
  });
  app.post('/api/logout', (request, response, next) => {
    const token = tokenFrom(request);
    (token ? execute(db, 'DELETE FROM operations_sessions WHERE token = ?', token) : Promise.resolve()).then(() => {
      response.setHeader('Set-Cookie', 'operationsToken=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      response.json({ success: true });
    }, next);
  });

  // Protect every current and future mutation at one boundary; public reads opt in inside their routers.
  app.use((request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.path === '/api/verify-pin') return next();
    operationsSessionId(request).then(sessionId => {
      if (!sessionId) return response.status(401).json({ error: 'Authorization required' });
      response.on('finish', () => {
        if (response.statusCode < 400 && request.path !== '/api/logout') {
          recordAudit(sessionId, request.method, request.path);
        }
      });
      next();
    }, next);
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
    const { id, type, symbolKey, severity, title, notes, geometry, dateAdded, affectedPopulation, affectedPopulationBasis } = parsed.data;
    if (!validPinKind(parsed.data)) return res.status(400).json({error:'Resource pins require a point and symbol, without incident severity or population'});
    const location = canonicalLocation(parsed.data.municipality,parsed.data.barangay);
    if (!location) return res.status(400).json({error:'Select a valid municipality and barangay'});
    const {municipality,barangay} = location;
    // Retain legacy types arriving from an existing offline queue with their original meaning.

    await execute(db, `
      INSERT INTO hazards (id, type, severity, title, municipality, barangay, notes, geometry, dateAdded, affectedPopulation, affectedPopulationBasis, symbolKey)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, type, severity, title || '', municipality || '', barangay || '', notes, JSON.stringify(geometry), dateAdded, affectedPopulation ?? null, affectedPopulationBasis ?? 'reported', symbolKey ?? null);
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

    let { type, symbolKey, severity, title, municipality, barangay, notes, geometry, dateAdded, version, affectedPopulation, affectedPopulationBasis } = parsed.data;
    const current = await one<Record<string, unknown>>(db, 'SELECT * FROM hazards WHERE id = ?', id);
    if (!current) return res.status(404).json({error:'Hazard not found'});
    if (!validPinKind({ ...current, ...parsed.data, type: type ?? current.type, severity: severity ?? current.severity, geometry: geometry ?? JSON.parse(String(current.geometry)) })) return res.status(400).json({error:'Invalid incident or resource pin fields'});
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
          symbolKey = CASE WHEN ? THEN ? ELSE symbolKey END,
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
      symbolKey !== undefined ? 1 : 0,
      symbolKey ?? null,
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

export async function createConfiguredApp() {
  const correctPin = process.env.PIN_SECRET;
  if (!correctPin) throw new Error('PIN_SECRET environment variable is required');
  const db = await createDatabase();
  await restorePrivateReferenceFiles(db);
  const provinceBoundary = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'Municipal Boundary.geojson'), 'utf8'));
  return createApp(db, correctPin, provinceBoundary);
}

async function startServer() {
  const app = await createConfiguredApp();

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

// On Vercel, api/index.ts serves the app instead of a listening server.
if (!process.env.VITEST && !process.env.VERCEL) {
  startServer().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
