import { estimateExposure } from './src/server/population';
import { analyzeLayerExposure } from './src/server/layerExposure';
import { privateDir, restorePrivateReferenceFiles } from './src/server/privateReferenceFiles';
import 'dotenv/config';
import express from "express";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createPlanningRouter } from "./src/server/planning";
import { all, createDatabase, execute, one, type Database } from "./src/server/database";

import { HAZARD_TYPES, LEGACY_TYPES, ROAD_STATUS, canonicalLocation, municipalities, REFERENCE_LAYERS, FLOOD_COLORS } from './src/lib/reference';
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
  type: z.string().refine(value => value === 'resource' || value === 'road' || [...HAZARD_TYPES,...LEGACY_TYPES].some(t => t.id === value)),
  symbolKey: z.string().refine(value => PLANNING_SYMBOLS.some(symbol => symbol.key === value)).nullable().optional(),
  affectedPopulationBasis: z.enum(['reported','population_estimate','household_estimate']).transform(value => value === 'household_estimate' ? 'population_estimate' : value).optional(),
  affectedPopulation: z.number().int().min(0).max(100_000_000).nullable().optional(),
  severity: z.enum(['Minor', 'Moderate', 'Severe', 'Critical', 'Not applicable', ...Object.keys(ROAD_STATUS)] as [string, ...string[]]),
  title: z.string().trim().max(120).optional(),
  municipality: z.string().trim().max(120).optional(),
  barangay: z.string().trim().max(500).optional(),
  notes: z.string().max(4_000).default(''),
  geometry: geometrySchema,
  dateAdded: z.string().datetime(),
  version: z.number().int().nonnegative().optional(),
});

// Resource pins and road status reuse operational storage and offline sync without becoming incidents.
function validPinKind(record: { type: unknown; severity: unknown; symbolKey?: unknown; geometry?: { type?: string }; affectedPopulation?: unknown; affectedPopulationBasis?: unknown }) {
  const noPopulation = record.affectedPopulation == null && record.affectedPopulationBasis !== 'population_estimate';
  const roadStatus = Object.hasOwn(ROAD_STATUS, String(record.severity));
  if (record.type === 'resource') return record.geometry?.type === 'Point' && Boolean(record.symbolKey) && record.severity === 'Not applicable' && noPopulation;
  if (record.type === 'road') return (record.geometry?.type === 'Point' || record.geometry?.type === 'LineString') && roadStatus && noPopulation;
  return record.severity !== 'Not applicable' && !roadStatus;
}

const headcount = z.number().int().nonnegative().max(1_000_000);
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
  status: z.enum(['standby', 'open', 'full', 'closed']).optional(),
  familiesNow: headcount.optional(),
  personsNow: headcount.optional(),
  familiesCumulative: headcount.optional(),
  personsCumulative: headcount.optional(),
  occupancyUpdatedAt: z.string().datetime().optional(),
});
// DROMIC cumulative counts include everyone currently inside. ponytail: checked only when both sides are sent; the card always sends both.
const cumulativeCoversNow = (center: { familiesNow?: number; personsNow?: number; familiesCumulative?: number; personsCumulative?: number }) =>
  (center.familiesNow == null || center.familiesCumulative == null || center.familiesCumulative >= center.familiesNow)
  && (center.personsNow == null || center.personsCumulative == null || center.personsCumulative >= center.personsNow);

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
      const { pin } = request.body;
      if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return response.status(400).json({ error: 'Invalid PIN format' });
      // Count the attempt atomically before checking, so parallel requests across instances can't slip past the limit.
      const attempt = await one<{ count: number }>(db, `INSERT INTO pin_attempts (ip, count, reset_at) VALUES (?, 1, ?)
        ON CONFLICT(ip) DO UPDATE SET
          count = CASE WHEN pin_attempts.reset_at > ? THEN pin_attempts.count + 1 ELSE 1 END,
          reset_at = CASE WHEN pin_attempts.reset_at > ? THEN pin_attempts.reset_at ELSE excluded.reset_at END
        RETURNING count`, key, now + 15 * 60 * 1000, now, now);
      if (!attempt || attempt.count > 5) return response.status(429).json({ error: 'Too many attempts. Try again later.' });
      const digest = (value: string) => createHash('sha256').update(value).digest();
      if (!timingSafeEqual(digest(pin), digest(correctPin))) {
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

  // One 500 shape for every record route; each failure gets an id that operators can quote from the logs.
  const route = (what: string, handler: express.RequestHandler, duplicate?: string): express.RequestHandler => async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      if (duplicate && (error as Error).message.includes('UNIQUE')) return res.status(409).json({ error: duplicate });
      const errorId = generateErrorId();
      console.error(`[${errorId}] Failed to ${what}:`, error);
      res.status(500).json({ error: `Failed to ${what}`, errorId });
    }
  };
  // A versioned UPDATE that touched nothing either lost a race (409 with the current row) or hit a deleted record.
  const staleOrMissing = async (res: express.Response, table: string, id: string, label: string) => {
    const current = await one<Record<string, unknown>>(db, `SELECT * FROM ${table} WHERE id = ?`, id);
    return current ? res.status(409).json({ error: `${label} changed`, current }) : res.status(404).json({ error: `${label} not found` });
  };

  for (const [base, table, label] of [['/api/hazards', 'hazards', 'Hazard'], ['/api/evacuation-centers', 'evacuation_centers', 'Evacuation center']]) {
    const noun = label.toLowerCase();
    app.get(base, route(`fetch ${noun}s`, async (_req, res) => {
      res.json(await all(db, `SELECT * FROM ${table}`));
    }));
    app.delete(`${base}/:id`, route(`delete ${noun}`, async (req, res) => {
      const { id } = req.params;
      if (!uuidRegex.test(id)) return res.status(400).json({ error: `Invalid ${noun} ID format` });
      const result = await execute(db, `DELETE FROM ${table} WHERE id = ?`, id);
      if (result.rowsAffected === 0) return res.status(404).json({ error: `${label} not found` });
      res.json({ success: true });
    }));
  }

  app.post("/api/hazards", route('save hazard', async (req, res) => {
    const parsed = hazardSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid hazard data', details: parsed.error.flatten() });
    const { id, type, symbolKey, severity, title, notes, geometry, dateAdded, affectedPopulation, affectedPopulationBasis } = parsed.data;
    if (!validPinKind(parsed.data)) return res.status(400).json({error:'Resource pins need a point and symbol; road status needs a point or line and a road status; neither takes incident severity or population'});
    const location = canonicalLocation(parsed.data.municipality,parsed.data.barangay);
    if (!location) return res.status(400).json({error:'Select a valid municipality and barangay'});
    const {municipality,barangay} = location;
    await execute(db, `
      INSERT INTO hazards (id, type, severity, title, municipality, barangay, notes, geometry, dateAdded, affectedPopulation, affectedPopulationBasis, symbolKey)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, type, severity, title || '', municipality || '', barangay || '', notes, JSON.stringify(geometry), dateAdded, affectedPopulation ?? null, affectedPopulationBasis ?? 'reported', symbolKey ?? null);
    res.status(201).json({ success: true, id, version: 1 });
  }, 'Hazard already exists'));

  app.put("/api/hazards/:id", route('update hazard', async (req, res) => {
    const { id } = req.params;
    if (!uuidRegex.test(id)) return res.status(400).json({ error: 'Invalid hazard ID format' });
    const updateSchema = hazardSchema.partial().omit({ id: true, version: true }).extend({ version: z.number().int().positive() });
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });

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
    if (result.rowsAffected === 0) return staleOrMissing(res, 'hazards', id, 'Hazard');
    res.json({ success: true, id, version: version + 1 });
  }));

  app.post("/api/evacuation-centers", route('save evacuation center', async (req, res) => {
    const parsed = evacuationCenterSchema.refine(cumulativeCoversNow, 'Cumulative counts cannot be below current counts').safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid evacuation center data', details: parsed.error.flatten() });
    const { id, name, type, capacity, municipality, barangay, coordinates, dateAdded, status, familiesNow, personsNow, familiesCumulative, personsCumulative, occupancyUpdatedAt } = parsed.data;
    await execute(db, `
      INSERT INTO evacuation_centers (id, name, type, capacity, municipality, barangay, coordinates, dateAdded, status, familiesNow, personsNow, familiesCumulative, personsCumulative, occupancyUpdatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, id, name, type, capacity, municipality || '', barangay || '', JSON.stringify(coordinates), dateAdded, status ?? 'standby', familiesNow ?? 0, personsNow ?? 0, familiesCumulative ?? 0, personsCumulative ?? 0, occupancyUpdatedAt);
    res.status(201).json({ success: true, id, version: 1 });
  }, 'Evacuation center already exists'));

  app.put("/api/evacuation-centers/:id", route('update evacuation center', async (req, res) => {
    const { id } = req.params;
    if (!uuidRegex.test(id)) return res.status(400).json({ error: 'Invalid evacuation center ID format' });
    const updateSchema = evacuationCenterSchema.partial().omit({ id: true, version: true }).extend({ version: z.number().int().positive() }).refine(cumulativeCoversNow, 'Cumulative counts cannot be below current counts');
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid update data', details: parsed.error.flatten() });
    const { name, type, capacity, municipality, barangay, coordinates, dateAdded, status, familiesNow, personsNow, familiesCumulative, personsCumulative, occupancyUpdatedAt, version } = parsed.data;
    const result = await execute(db, `
      UPDATE evacuation_centers
      SET name = COALESCE(?, name),
          type = COALESCE(?, type),
          capacity = COALESCE(?, capacity),
          municipality = COALESCE(?, municipality),
          barangay = COALESCE(?, barangay),
          coordinates = COALESCE(?, coordinates),
          dateAdded = COALESCE(?, dateAdded),
          status = COALESCE(?, status),
          familiesNow = COALESCE(?, familiesNow),
          personsNow = COALESCE(?, personsNow),
          familiesCumulative = COALESCE(?, familiesCumulative),
          personsCumulative = COALESCE(?, personsCumulative),
          occupancyUpdatedAt = COALESCE(?, occupancyUpdatedAt),
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
      status,
      familiesNow,
      personsNow,
      familiesCumulative,
      personsCumulative,
      occupancyUpdatedAt,
      id,
      version,
    );
    if (result.rowsAffected === 0) return staleOrMissing(res, 'evacuation_centers', id, 'Evacuation center');
    res.json({ success: true, id, version: version + 1 });
  }));

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
