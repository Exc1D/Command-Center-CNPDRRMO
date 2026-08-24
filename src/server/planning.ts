import express, { Request, Response } from 'express';
import { planningScenarioSchema, planningTemplateSchema, scenarioInsideProvince, validateForPublish, type PlanningRevision, type PlanningScenario, type ProvinceGeoJSON } from '../lib/planning';
import { all, execute, one, type Database } from './database';

const LOCK_TTL_MS = 15 * 60 * 1000;

export function createPlanningRouter(db: Database, isAuthorized: (request: Request) => boolean, province?: ProvinceGeoJSON) {
  // ponytail: locks and previews are process-local; move them to shared storage only when this server runs in multiple processes.
  const router = express.Router();
  const locks = new Map<string, { sessionId: string; expiresAt: number }>();
  const previews = new Map<string, PlanningScenario>();
  const viewers = new Map<string, Set<Response>>();

  const requireAuthorization: express.RequestHandler = (request, response, next) => {
    if (!isAuthorized(request)) return response.status(401).json({ error: 'Authorization required' });
    next();
  };

  const asyncRoute = (handler: (request: Request, response: Response) => Promise<unknown>): express.RequestHandler =>
    (request, response, next) => { void handler(request, response).catch(next); };

  const getScenario = async (id: string): Promise<PlanningScenario | null> => {
    const row = await one<{ document: string }>(db, 'SELECT document FROM planning_scenarios WHERE id = ?', id);
    return row ? planningScenarioSchema.parse(JSON.parse(row.document)) as PlanningScenario : null;
  };

  const publicRevisions = async (scenarioId?: string) => {
    const rows = await all<Record<string, unknown>>(db, `SELECT id, scenario_id, revision, published_at, snapshot FROM planning_revisions
      ${scenarioId ? 'WHERE scenario_id = ?' : ''} ORDER BY revision DESC`, ...(scenarioId ? [scenarioId] : []));
    return rows.map(row => ({
      id: row.id as string,
      scenarioId: row.scenario_id as string,
      revision: row.revision as number,
      publishedAt: row.published_at as string,
      snapshot: planningScenarioSchema.parse(JSON.parse(row.snapshot as string)) as PlanningScenario,
    })).filter(revision => revision.snapshot.classification === 'Public');
  };

  const hasScenarioLock = (request: Request) => {
    const lock = locks.get(request.params.id);
    return Boolean(lock && lock.expiresAt > Date.now() && lock.sessionId === request.headers['x-planning-session']);
  };

  const broadcast = (scenarioId: string, event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    viewers.get(scenarioId)?.forEach(response => response.write(payload));
  };

  router.get('/scenarios', asyncRoute(async (request, response) => {
    if (!isAuthorized(request)) {
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
    if (!isAuthorized(request)) {
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
    if (province && !scenarioInsideProvince(parsed.data as PlanningScenario, province)) return response.status(400).json({ error: 'Planning objects must remain inside Camarines Norte' });
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
    if (!hasScenarioLock(request)) return response.status(409).json({ error: 'Active editing lock required' });
    if (parsed.data.draftVersion !== current.draftVersion) return response.status(409).json({ error: 'Scenario changed', current });
    if (province && !scenarioInsideProvince(parsed.data as PlanningScenario, province)) return response.status(400).json({ error: 'Planning objects must remain inside Camarines Norte' });
    const scenario = { ...parsed.data, draftVersion: current.draftVersion + 1, updatedAt: new Date().toISOString() } as PlanningScenario;
    const result = await execute(db, `UPDATE planning_scenarios SET
      name = ?, valid_from = ?, valid_until = ?, draft_version = ?, archived_at = ?, updated_at = ?, document = ?
      WHERE id = ? AND draft_version = ?`, scenario.name, scenario.validFrom ?? null, scenario.validUntil ?? null, scenario.draftVersion, scenario.archivedAt ?? null, scenario.updatedAt, JSON.stringify(scenario), scenario.id, current.draftVersion);
    if (result.rowsAffected === 0) return response.status(409).json({ error: 'Scenario changed', current: await getScenario(scenario.id) });
    previews.delete(scenario.id);
    broadcast(scenario.id, 'saved', scenario);
    response.json(scenario);
  }));

  router.delete('/scenarios/:id', requireAuthorization, asyncRoute(async (request, response) => {
    const current = await getScenario(request.params.id);
    if (!current) return response.status(404).json({ error: 'Scenario not found' });
    if (!hasScenarioLock(request)) return response.status(409).json({ error: 'Active editing lock required' });
    if (request.body?.name !== current.name) return response.status(400).json({ error: 'Type the scenario name to delete it' });
    await db.batch([
      { sql: 'DELETE FROM planning_revisions WHERE scenario_id = ?', args: [current.id] },
      { sql: 'DELETE FROM planning_scenarios WHERE id = ?', args: [current.id] },
    ], 'write');
    previews.delete(current.id);
    locks.delete(current.id);
    broadcast(current.id, 'deleted', { id: current.id });
    response.json({ success: true });
  }));

  router.get('/scenarios/:id/revisions', asyncRoute(async (request, response) => {
    if (!isAuthorized(request)) return response.json(await publicRevisions(request.params.id));
    const rows = await all<Record<string, unknown>>(db, 'SELECT * FROM planning_revisions WHERE scenario_id = ? ORDER BY revision DESC', request.params.id);
    response.json(rows.map(row => ({
      id: row.id,
      scenarioId: row.scenario_id,
      revision: row.revision,
      publishedAt: row.published_at,
      snapshot: JSON.parse(row.snapshot as string),
    })));
  }));

  router.post('/scenarios/:id/publish', requireAuthorization, asyncRoute(async (request, response) => {
    const scenario = await getScenario(request.params.id);
    if (!scenario) return response.status(404).json({ error: 'Scenario not found' });
    if (!hasScenarioLock(request)) return response.status(409).json({ error: 'Active editing lock required' });
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
    broadcast(scenario.id, 'published', published);
    response.status(201).json({ ...published, warnings: validation.warnings });
  }));

  router.post('/scenarios/:id/lock', requireAuthorization, asyncRoute(async (request, response) => {
    if (!await getScenario(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
    const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : '';
    if (!sessionId) return response.status(400).json({ error: 'Session ID required' });
    const existing = locks.get(request.params.id);
    if (existing && existing.expiresAt > Date.now() && existing.sessionId !== sessionId && !request.body?.force) {
      return response.status(409).json({ error: 'Scenario is being edited', expiresAt: existing.expiresAt });
    }
    const lock = { sessionId, expiresAt: Date.now() + LOCK_TTL_MS };
    locks.set(request.params.id, lock);
    broadcast(request.params.id, 'lock', { locked: true, expiresAt: lock.expiresAt });
    response.json(lock);
  }));

  router.delete('/scenarios/:id/lock', requireAuthorization, (request, response) => {
    const existing = locks.get(request.params.id);
    if (existing && existing.sessionId !== request.body?.sessionId && !request.body?.force) return response.status(409).json({ error: 'Lock belongs to another session' });
    locks.delete(request.params.id);
    broadcast(request.params.id, 'lock', { locked: false });
    response.json({ success: true });
  });

  router.put('/scenarios/:id/preview', requireAuthorization, (request, response) => {
    const parsed = planningScenarioSchema.safeParse(request.body);
    const lock = locks.get(request.params.id);
    if (!parsed.success || parsed.data.id !== request.params.id) return response.status(400).json({ error: 'Invalid preview' });
    if (province && !scenarioInsideProvince(parsed.data as PlanningScenario, province)) return response.status(400).json({ error: 'Planning objects must remain inside Camarines Norte' });
    if (!lock || lock.expiresAt <= Date.now() || lock.sessionId !== request.headers['x-planning-session']) {
      return response.status(409).json({ error: 'Editing lock required' });
    }
    previews.set(request.params.id, parsed.data as PlanningScenario);
    broadcast(request.params.id, 'preview', parsed.data);
    response.status(204).end();
  });

  router.get('/scenarios/:id/events', requireAuthorization, asyncRoute(async (request, response) => {
    if (!await getScenario(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    const scenarioViewers = viewers.get(request.params.id) ?? new Set<Response>();
    scenarioViewers.add(response);
    viewers.set(request.params.id, scenarioViewers);
    const initial = previews.get(request.params.id) ?? await getScenario(request.params.id);
    if (initial) response.write(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 25_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      scenarioViewers.delete(response);
    });
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
