import express, { Request, Response } from 'express';
import { planningScenarioSchema, planningTemplateSchema, scenarioInsideProvince, validateForPublish, type PlanningRevision, type PlanningScenario, type ProvinceGeoJSON } from '../lib/planning';
import { all, execute, one, type Database } from './database';

const LOCK_TTL_MS = 15 * 60 * 1000;
const POLL_MS = 1_500;
const STREAM_MS = 240_000;

export function createPlanningRouter(db: Database, isAuthorized: (request: Request) => Promise<boolean>, province?: ProvinceGeoJSON) {
  // Locks, previews and live events live in the database so they work across serverless instances.
  const router = express.Router();

  const requireAuthorization: express.RequestHandler = (request, response, next) => {
    isAuthorized(request).then(authorized => authorized ? next() : response.status(401).json({ error: 'Authorization required' }), next);
  };

  const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>): express.RequestHandler =>
    (request, response, next) => { void handler(request, response).catch(next); };

  const getScenario = async (id: string): Promise<PlanningScenario | null> => {
    const row = await one<{ document: string }>(db, 'SELECT document FROM planning_scenarios WHERE id = ?', id);
    return row ? planningScenarioSchema.parse(JSON.parse(row.document)) as PlanningScenario : null;
  };

  const revisions = async (scenarioId?: string) => {
    const rows = await all<Record<string, unknown>>(db, `SELECT id, scenario_id, revision, published_at, snapshot FROM planning_revisions
      ${scenarioId ? 'WHERE scenario_id = ?' : ''} ORDER BY revision DESC`, ...(scenarioId ? [scenarioId] : []));
    return rows.map(row => ({
      id: row.id as string,
      scenarioId: row.scenario_id as string,
      revision: row.revision as number,
      publishedAt: row.published_at as string,
      snapshot: JSON.parse(row.snapshot as string),
    }));
  };
  // Signed-out viewers get only schema-clean Public snapshots.
  const publicRevisions = async (scenarioId?: string) => (await revisions(scenarioId))
    .map(revision => ({ ...revision, snapshot: planningScenarioSchema.parse(revision.snapshot) as PlanningScenario }))
    .filter(revision => revision.snapshot.classification === 'Public');

  const outsideProvince = (scenario: unknown) => province !== undefined && !scenarioInsideProvince(scenario as PlanningScenario, province);
  const OUTSIDE_PROVINCE = { error: 'Planning objects must remain inside Camarines Norte' };

  const activeLock = (scenarioId: string) =>
    one<{ session_id: string; expires_at: number }>(db, 'SELECT session_id, expires_at FROM planning_locks WHERE scenario_id = ? AND expires_at > ?', scenarioId, Date.now());

  const hasScenarioLock = async (request: Request) => {
    const lock = await activeLock(request.params.id);
    return Boolean(lock && lock.session_id === request.headers['x-planning-session']);
  };

  // Viewers poll this table (see /events), so every instance's writes reach every viewer.
  const broadcast = (scenarioId: string, event: string, data: unknown) => db.batch([
    { sql: 'INSERT INTO planning_events (scenario_id, event, data, created_at) VALUES (?, ?, ?, ?)', args: [scenarioId, event, JSON.stringify(data), Date.now()] },
    { sql: 'DELETE FROM planning_events WHERE created_at < ?', args: [Date.now() - 60 * 60 * 1000] },
  ], 'write');

  router.get('/scenarios', asyncRoute(async (request, response) => {
    if (!await isAuthorized(request)) {
      const latest = new Map<string, PlanningRevision>();
      for (const revision of await publicRevisions()) if (!latest.has(revision.scenarioId)) latest.set(revision.scenarioId, revision);
      return response.json([...latest.values()].map(revision => ({ ...revision.snapshot, publishedRevision: revision.revision })));
    }
    const rows = await all<{ document: string; published_revision: number | null }>(db, `
      SELECT s.document,
        (SELECT MAX(revision) FROM planning_revisions r WHERE r.scenario_id = s.id) AS published_revision
      FROM planning_scenarios s ORDER BY s.updated_at DESC
    `);
    response.json(rows.map(row => ({ ...JSON.parse(row.document), publishedRevision: row.published_revision })));
  }));

  router.get('/scenarios/:id', asyncRoute(async (request, response) => {
    if (!await isAuthorized(request)) {
      const revision = (await publicRevisions(request.params.id))[0];
      return revision ? response.json(revision.snapshot) : response.status(404).json({ error: 'Scenario not found' });
    }
    const scenario = await getScenario(request.params.id);
    if (!scenario) return response.status(404).json({ error: 'Scenario not found' });
    response.json(scenario);
  }));

  router.post('/scenarios', requireAuthorization, asyncRoute(async (request, response) => {
    const parsed = planningScenarioSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid scenario', details: parsed.error.flatten() });
    if (outsideProvince(parsed.data)) return response.status(400).json(OUTSIDE_PROVINCE);
    const scenario = { ...parsed.data, draftVersion: 1, updatedAt: new Date().toISOString() } as PlanningScenario;
    try {
      await execute(db, `INSERT INTO planning_scenarios
        (id, name, valid_from, valid_until, draft_version, archived_at, updated_at, document)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, scenario.id, scenario.name, scenario.validFrom ?? null, scenario.validUntil ?? null, scenario.draftVersion, scenario.archivedAt ?? null, scenario.updatedAt, JSON.stringify(scenario));
      response.status(201).json(scenario);
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) return response.status(409).json({ error: 'Scenario already exists' });
      throw error;
    }
  }));

  router.put('/scenarios/:id', requireAuthorization, asyncRoute(async (request, response) => {
    const parsed = planningScenarioSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.id !== request.params.id) return response.status(400).json({ error: 'Invalid scenario' });
    const current = await getScenario(request.params.id);
    if (!current) return response.status(404).json({ error: 'Scenario not found' });
    if (!await hasScenarioLock(request)) return response.status(409).json({ error: 'Active editing lock required' });
    if (parsed.data.draftVersion !== current.draftVersion) return response.status(409).json({ error: 'Scenario changed', current });
    if (outsideProvince(parsed.data)) return response.status(400).json(OUTSIDE_PROVINCE);
    const scenario = { ...parsed.data, draftVersion: current.draftVersion + 1, updatedAt: new Date().toISOString() } as PlanningScenario;
    const result = await execute(db, `UPDATE planning_scenarios SET
      name = ?, valid_from = ?, valid_until = ?, draft_version = ?, archived_at = ?, updated_at = ?, document = ?
      WHERE id = ? AND draft_version = ?`, scenario.name, scenario.validFrom ?? null, scenario.validUntil ?? null, scenario.draftVersion, scenario.archivedAt ?? null, scenario.updatedAt, JSON.stringify(scenario), scenario.id, current.draftVersion);
    if (result.rowsAffected === 0) return response.status(409).json({ error: 'Scenario changed', current: await getScenario(scenario.id) });
    await execute(db, 'DELETE FROM planning_previews WHERE scenario_id = ?', scenario.id);
    await broadcast(scenario.id, 'saved', scenario);
    response.json(scenario);
  }));

  router.delete('/scenarios/:id', requireAuthorization, asyncRoute(async (request, response) => {
    const current = await getScenario(request.params.id);
    if (!current) return response.status(404).json({ error: 'Scenario not found' });
    if (!await hasScenarioLock(request)) return response.status(409).json({ error: 'Active editing lock required' });
    if (request.body?.name !== current.name) return response.status(400).json({ error: 'Type the scenario name to delete it' });
    await db.batch([
      { sql: 'DELETE FROM planning_revisions WHERE scenario_id = ?', args: [current.id] },
      { sql: 'DELETE FROM planning_scenarios WHERE id = ?', args: [current.id] },
      { sql: 'DELETE FROM planning_previews WHERE scenario_id = ?', args: [current.id] },
      { sql: 'DELETE FROM planning_locks WHERE scenario_id = ?', args: [current.id] },
    ], 'write');
    await broadcast(current.id, 'deleted', { id: current.id });
    response.json({ success: true });
  }));

  router.get('/scenarios/:id/revisions', asyncRoute(async (request, response) => {
    if (!await isAuthorized(request)) return response.json(await publicRevisions(request.params.id));
    response.json(await revisions(request.params.id));
  }));

  router.post('/scenarios/:id/publish', requireAuthorization, asyncRoute(async (request, response) => {
    const scenario = await getScenario(request.params.id);
    if (!scenario) return response.status(404).json({ error: 'Scenario not found' });
    if (!await hasScenarioLock(request)) return response.status(409).json({ error: 'Active editing lock required' });
    const validation = validateForPublish(scenario);
    if (validation.errors.length > 0) return response.status(400).json(validation);
    const publishedAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const inserted = await execute(db, `INSERT INTO planning_revisions (id, scenario_id, revision, published_at, snapshot)
      SELECT ?, ?, COALESCE(MAX(revision), 0) + 1, ?, ? FROM planning_revisions WHERE scenario_id = ? RETURNING revision`,
      id, scenario.id, publishedAt, JSON.stringify(scenario), scenario.id);
    const revision = inserted.rows[0].revision as number;
    const published: PlanningRevision = {
      id,
      scenarioId: scenario.id,
      revision,
      publishedAt,
      snapshot: scenario,
    };
    await broadcast(scenario.id, 'published', published);
    response.status(201).json({ ...published, warnings: validation.warnings });
  }));

  router.post('/scenarios/:id/lock', requireAuthorization, asyncRoute(async (request, response) => {
    if (!await getScenario(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
    const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
    if (!sessionId) return response.status(400).json({ error: 'Session ID required' });
    const now = Date.now();
    const lock = { sessionId, expiresAt: now + LOCK_TTL_MS };
    // One conditional upsert, so two instances cannot both take the lock.
    const taken = await execute(db, `INSERT INTO planning_locks (scenario_id, session_id, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(scenario_id) DO UPDATE SET session_id = excluded.session_id, expires_at = excluded.expires_at
      WHERE planning_locks.expires_at <= ? OR planning_locks.session_id = excluded.session_id OR ?`,
      request.params.id, sessionId, lock.expiresAt, now, request.body?.force ? 1 : 0);
    if (taken.rowsAffected === 0) {
      const existing = await activeLock(request.params.id);
      return response.status(409).json({ error: 'Scenario is being edited', expiresAt: existing?.expires_at });
    }
    await broadcast(request.params.id, 'lock', { locked: true, expiresAt: lock.expiresAt });
    response.json(lock);
  }));

  router.delete('/scenarios/:id/lock', requireAuthorization, asyncRoute(async (request, response) => {
    const existing = await activeLock(request.params.id);
    if (existing && existing.session_id !== request.body?.sessionId && !request.body?.force) return response.status(409).json({ error: 'Lock belongs to another session' });
    await execute(db, 'DELETE FROM planning_locks WHERE scenario_id = ?', request.params.id);
    await broadcast(request.params.id, 'lock', { locked: false });
    response.json({ success: true });
  }));

  router.put('/scenarios/:id/preview', requireAuthorization, asyncRoute(async (request, response) => {
    const parsed = planningScenarioSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.id !== request.params.id) return response.status(400).json({ error: 'Invalid preview' });
    if (outsideProvince(parsed.data)) return response.status(400).json(OUTSIDE_PROVINCE);
    if (!await hasScenarioLock(request)) return response.status(409).json({ error: 'Editing lock required' });
    await execute(db, 'INSERT INTO planning_previews (scenario_id, document) VALUES (?, ?) ON CONFLICT(scenario_id) DO UPDATE SET document = excluded.document', request.params.id, JSON.stringify(parsed.data));
    await broadcast(request.params.id, 'preview', parsed.data);
    response.status(204).end();
  }));

  // ponytail: polls the events table every POLL_MS; push via a pub/sub service only if the delay matters.
  // The stream ends before the serverless time limit; EventSource reconnects and resumes from Last-Event-ID.
  router.get('/scenarios/:id/events', requireAuthorization, asyncRoute(async (request, response) => {
    if (!await getScenario(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    const scenarioId = request.params.id;
    const resumeFrom = Number(request.headers['last-event-id']);
    let lastId = Number.isSafeInteger(resumeFrom) && resumeFrom > 0 ? resumeFrom
      : (await one<{ id: number | null }>(db, 'SELECT MAX(id) AS id FROM planning_events'))?.id ?? 0;
    const preview = await one<{ document: string }>(db, 'SELECT document FROM planning_previews WHERE scenario_id = ?', scenarioId);
    const initial = preview ? JSON.parse(preview.document) : await getScenario(scenarioId);
    if (initial) response.write(`id: ${lastId}\nevent: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);
    let closed = false;
    request.on('close', () => { closed = true; });
    const endAt = Date.now() + STREAM_MS;
    while (!closed && Date.now() < endAt) {
      const events = await all<{ id: number; event: string; data: string }>(db, 'SELECT id, event, data FROM planning_events WHERE scenario_id = ? AND id > ? ORDER BY id', scenarioId, lastId);
      for (const event of events) {
        response.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${event.data}\n\n`);
        lastId = event.id;
      }
      if (!events.length) response.write(': keep-alive\n\n');
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
    }
    response.end();
  }));

  router.get('/templates', requireAuthorization, asyncRoute(async (_request, response) => {
    const rows = await all<{ document: string }>(db, 'SELECT document FROM planning_templates ORDER BY name');
    response.json(rows.map(row => JSON.parse(row.document)));
  }));

  router.put('/templates/:id', requireAuthorization, asyncRoute(async (request, response) => {
    const parsed = planningTemplateSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.id !== request.params.id) {
      return response.status(400).json({ error: 'Invalid template' });
    }
    const updated = { ...parsed.data, updatedAt: new Date().toISOString() };
    await execute(db, `INSERT INTO planning_templates (id, name, document, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, document = excluded.document, updated_at = excluded.updated_at`,
      updated.id, updated.name, JSON.stringify(updated), updated.updatedAt);
    response.json(updated);
  }));

  router.delete('/templates/:id', requireAuthorization, asyncRoute(async (request, response) => {
    await execute(db, 'DELETE FROM planning_templates WHERE id = ?', request.params.id);
    response.json({ success: true });
  }));

  return router;
}
