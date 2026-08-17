import express, { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { planningScenarioSchema, planningTemplateSchema, validateForPublish, type PlanningRevision, type PlanningScenario } from '../lib/planning';

const LOCK_TTL_MS = 15 * 60 * 1000;

export function createPlanningRouter(db: Database.Database, isAuthorized: (request: Request) => boolean) {
  // ponytail: locks and previews are process-local; move them to shared storage only when this server runs in multiple processes.
  const router = express.Router();
  const locks = new Map<string, { sessionId: string; expiresAt: number }>();
  const previews = new Map<string, PlanningScenario>();
  const viewers = new Map<string, Set<Response>>();

  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_scenarios (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      draft_version INTEGER NOT NULL,
      archived_at TEXT,
      updated_at TEXT NOT NULL,
      document TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS planning_revisions (
      id TEXT PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      published_at TEXT NOT NULL,
      snapshot TEXT NOT NULL,
      UNIQUE(scenario_id, revision),
      FOREIGN KEY(scenario_id) REFERENCES planning_scenarios(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS planning_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      document TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const requireAuthorization: express.RequestHandler = (request, response, next) => {
    if (!isAuthorized(request)) return response.status(401).json({ error: 'Authorization required' });
    next();
  };

  const getScenario = (id: string): PlanningScenario | null => {
    const row = db.prepare('SELECT document FROM planning_scenarios WHERE id = ?').get(id) as { document: string } | undefined;
    return row ? planningScenarioSchema.parse(JSON.parse(row.document)) as PlanningScenario : null;
  };

  const broadcast = (scenarioId: string, event: string, data: unknown) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    viewers.get(scenarioId)?.forEach(response => response.write(payload));
  };

  router.get('/scenarios', (_request, response) => {
    const rows = db.prepare(`
      SELECT s.document,
        (SELECT MAX(revision) FROM planning_revisions r WHERE r.scenario_id = s.id) AS published_revision
      FROM planning_scenarios s ORDER BY s.updated_at DESC
    `).all() as Array<{ document: string; published_revision: number | null }>;
    response.json(rows.map(row => ({ ...JSON.parse(row.document), publishedRevision: row.published_revision })));
  });

  router.get('/scenarios/:id', (request, response) => {
    const scenario = getScenario(request.params.id);
    if (!scenario) return response.status(404).json({ error: 'Scenario not found' });
    response.json(scenario);
  });

  router.post('/scenarios', requireAuthorization, (request, response) => {
    const parsed = planningScenarioSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Invalid scenario', details: parsed.error.flatten() });
    const scenario = { ...parsed.data, draftVersion: 1, updatedAt: new Date().toISOString() } as PlanningScenario;
    try {
      db.prepare(`INSERT INTO planning_scenarios
        (id, name, valid_from, valid_until, draft_version, archived_at, updated_at, document)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(scenario.id, scenario.name, scenario.validFrom ?? null, scenario.validUntil ?? null, scenario.draftVersion, scenario.archivedAt ?? null, scenario.updatedAt, JSON.stringify(scenario));
      response.status(201).json(scenario);
    } catch (error) {
      if ((error as Error).message.includes('UNIQUE')) return response.status(409).json({ error: 'Scenario already exists' });
      throw error;
    }
  });

  router.put('/scenarios/:id', requireAuthorization, (request, response) => {
    const parsed = planningScenarioSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.id !== request.params.id) return response.status(400).json({ error: 'Invalid scenario' });
    const current = getScenario(request.params.id);
    if (!current) return response.status(404).json({ error: 'Scenario not found' });
    if (parsed.data.draftVersion !== current.draftVersion) return response.status(409).json({ error: 'Scenario changed', current });
    const scenario = { ...parsed.data, draftVersion: current.draftVersion + 1, updatedAt: new Date().toISOString() } as PlanningScenario;
    db.prepare(`UPDATE planning_scenarios SET
      name = ?, valid_from = ?, valid_until = ?, draft_version = ?, archived_at = ?, updated_at = ?, document = ? WHERE id = ?`)
      .run(scenario.name, scenario.validFrom ?? null, scenario.validUntil ?? null, scenario.draftVersion, scenario.archivedAt ?? null, scenario.updatedAt, JSON.stringify(scenario), scenario.id);
    previews.delete(scenario.id);
    broadcast(scenario.id, 'saved', scenario);
    response.json(scenario);
  });

  router.delete('/scenarios/:id', requireAuthorization, (request, response) => {
    const current = getScenario(request.params.id);
    if (!current) return response.status(404).json({ error: 'Scenario not found' });
    if (request.body?.name !== current.name) return response.status(400).json({ error: 'Type the scenario name to delete it' });
    db.prepare('DELETE FROM planning_revisions WHERE scenario_id = ?').run(current.id);
    db.prepare('DELETE FROM planning_scenarios WHERE id = ?').run(current.id);
    previews.delete(current.id);
    locks.delete(current.id);
    broadcast(current.id, 'deleted', { id: current.id });
    response.json({ success: true });
  });

  router.get('/scenarios/:id/revisions', (request, response) => {
    const rows = db.prepare('SELECT * FROM planning_revisions WHERE scenario_id = ? ORDER BY revision DESC').all(request.params.id) as Array<Record<string, unknown>>;
    response.json(rows.map(row => ({
      id: row.id,
      scenarioId: row.scenario_id,
      revision: row.revision,
      publishedAt: row.published_at,
      snapshot: JSON.parse(row.snapshot as string),
    })));
  });

  router.post('/scenarios/:id/publish', requireAuthorization, (request, response) => {
    const scenario = getScenario(request.params.id);
    if (!scenario) return response.status(404).json({ error: 'Scenario not found' });
    const validation = validateForPublish(scenario);
    if (validation.errors.length > 0) return response.status(400).json(validation);
    const revision = ((db.prepare('SELECT MAX(revision) AS revision FROM planning_revisions WHERE scenario_id = ?').get(scenario.id) as { revision: number | null }).revision ?? 0) + 1;
    const published: PlanningRevision = {
      id: crypto.randomUUID(),
      scenarioId: scenario.id,
      revision,
      publishedAt: new Date().toISOString(),
      snapshot: scenario,
    };
    db.prepare('INSERT INTO planning_revisions (id, scenario_id, revision, published_at, snapshot) VALUES (?, ?, ?, ?, ?)')
      .run(published.id, published.scenarioId, published.revision, published.publishedAt, JSON.stringify(published.snapshot));
    broadcast(scenario.id, 'published', published);
    response.status(201).json({ ...published, warnings: validation.warnings });
  });

  router.post('/scenarios/:id/lock', requireAuthorization, (request, response) => {
    if (!getScenario(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
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
  });

  router.delete('/scenarios/:id/lock', requireAuthorization, (request, response) => {
    const existing = locks.get(request.params.id);
    if (!existing || existing.sessionId === request.body?.sessionId || request.body?.force) locks.delete(request.params.id);
    broadcast(request.params.id, 'lock', { locked: false });
    response.json({ success: true });
  });

  router.put('/scenarios/:id/preview', requireAuthorization, (request, response) => {
    const parsed = planningScenarioSchema.safeParse(request.body);
    const lock = locks.get(request.params.id);
    if (!parsed.success || parsed.data.id !== request.params.id) return response.status(400).json({ error: 'Invalid preview' });
    if (!lock || lock.expiresAt <= Date.now() || lock.sessionId !== request.headers['x-planning-session']) {
      return response.status(409).json({ error: 'Editing lock required' });
    }
    previews.set(request.params.id, parsed.data as PlanningScenario);
    broadcast(request.params.id, 'preview', parsed.data);
    response.status(204).end();
  });

  router.get('/scenarios/:id/events', (request, response) => {
    if (!getScenario(request.params.id)) return response.status(404).json({ error: 'Scenario not found' });
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.flushHeaders();
    const scenarioViewers = viewers.get(request.params.id) ?? new Set<Response>();
    scenarioViewers.add(response);
    viewers.set(request.params.id, scenarioViewers);
    const initial = previews.get(request.params.id) ?? getScenario(request.params.id);
    if (initial) response.write(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`);
    const keepAlive = setInterval(() => response.write(': keep-alive\n\n'), 25_000);
    request.on('close', () => {
      clearInterval(keepAlive);
      scenarioViewers.delete(response);
    });
  });

  router.get('/templates', (_request, response) => {
    const rows = db.prepare('SELECT document FROM planning_templates ORDER BY name').all() as Array<{ document: string }>;
    response.json(rows.map(row => JSON.parse(row.document)));
  });

  router.put('/templates/:id', requireAuthorization, (request, response) => {
    const parsed = planningTemplateSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.id !== request.params.id) {
      return response.status(400).json({ error: 'Invalid template' });
    }
    const updated = { ...parsed.data, updatedAt: new Date().toISOString() };
    db.prepare(`INSERT INTO planning_templates (id, name, document, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, document = excluded.document, updated_at = excluded.updated_at`)
      .run(updated.id, updated.name, JSON.stringify(updated), updated.updatedAt);
    response.json(updated);
  });

  router.delete('/templates/:id', requireAuthorization, (request, response) => {
    db.prepare('DELETE FROM planning_templates WHERE id = ?').run(request.params.id);
    response.json({ success: true });
  });

  return router;
}
