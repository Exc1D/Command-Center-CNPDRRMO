import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPlanningScenario } from '../lib/planning';
import { createDatabase, type Database } from './database';
import { createPlanningRouter } from './planning';

describe('planning server', () => {
  let database: Database;
  let app: express.Application;

  beforeEach(async () => {
    database = await createDatabase(':memory:');
    app = express();
    app.use(express.json({ limit: '6mb' }));
    app.use('/api/planning', createPlanningRouter(database, req => req.headers.authorization === 'Bearer valid', {
      features: [{ geometry: { type: 'Polygon', coordinates: [[[122, 13], [124, 13], [124, 15], [122, 15], [122, 13]]] } }],
    }));
  });

  afterEach(() => database.close());

  it('creates and returns a validated scenario', async () => {
    const scenario = createPlanningScenario('Typhoon evacuation');

    const created = await request(app)
      .post('/api/planning/scenarios')
      .set('Authorization', 'Bearer valid')
      .send(scenario);

    expect(created.status).toBe(201);
    expect(created.body.name).toBe('Typhoon evacuation');
    expect(created.body.draftVersion).toBe(1);

    const listed = await request(app).get('/api/planning/scenarios').set('Authorization', 'Bearer valid');
    expect(listed.body).toHaveLength(1);
  });

  it('does not expose internal drafts or live previews to public readers', async () => {
    const scenario = createPlanningScenario('Restricted response plan');
    scenario.classification = 'Restricted';
    await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(scenario);

    expect((await request(app).get('/api/planning/scenarios')).body).toEqual([]);
    expect((await request(app).get(`/api/planning/scenarios/${scenario.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/planning/scenarios/${scenario.id}/events`)).status).toBe(401);
    expect((await request(app).get('/api/planning/templates')).status).toBe(401);
  });

  it('exposes only immutable published snapshots explicitly classified as public', async () => {
    const scenario = createPlanningScenario('Public evacuation plan');
    scenario.classification = 'Public';
    scenario.objects.push({ id: crypto.randomUUID(), kind: 'symbol', layer: 'symbols', coordinates: [[122.95, 14.1]], style: { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' }, locked: false, order: 0, symbolKey: 'eoc' });
    await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(scenario);
    await request(app).post(`/api/planning/scenarios/${scenario.id}/lock`).set('Authorization', 'Bearer valid').send({ sessionId: 'one' });
    await request(app).post(`/api/planning/scenarios/${scenario.id}/publish`).set('Authorization', 'Bearer valid').set('X-Planning-Session', 'one');

    const listed = await request(app).get('/api/planning/scenarios');
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].publishedRevision).toBe(1);
    expect((await request(app).get(`/api/planning/scenarios/${scenario.id}/revisions`)).body).toHaveLength(1);
  });

  it('protects mutations with operations authorization', async () => {
    const response = await request(app).post('/api/planning/scenarios').send(createPlanningScenario('Typhoon evacuation'));
    expect(response.status).toBe(401);
  });

  it('rejects a stale draft instead of overwriting newer work', async () => {
    const original = createPlanningScenario('Typhoon evacuation');
    const created = await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(original);
    await request(app).post(`/api/planning/scenarios/${original.id}/lock`).set('Authorization', 'Bearer valid').send({ sessionId: 'one' });
    await request(app).put(`/api/planning/scenarios/${original.id}`).set('Authorization', 'Bearer valid').set('X-Planning-Session', 'one').send({ ...created.body, notes: 'Newer work' });

    const stale = await request(app).put(`/api/planning/scenarios/${original.id}`).set('Authorization', 'Bearer valid').set('X-Planning-Session', 'one').send({ ...created.body, notes: 'Stale work' });

    expect(stale.status).toBe(409);
    expect(stale.body.current.notes).toBe('Newer work');
  });

  it('publishes immutable numbered revisions', async () => {
    const original = createPlanningScenario('Typhoon evacuation');
    original.objects.push({ id: crypto.randomUUID(), kind: 'symbol', layer: 'symbols', coordinates: [[122.95, 14.1]], style: { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' }, locked: false, order: 0, symbolKey: 'eoc' });
    await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(original);
    await request(app).post(`/api/planning/scenarios/${original.id}/lock`).set('Authorization', 'Bearer valid').send({ sessionId: 'one' });

    const first = await request(app).post(`/api/planning/scenarios/${original.id}/publish`).set('Authorization', 'Bearer valid').set('X-Planning-Session', 'one');
    const second = await request(app).post(`/api/planning/scenarios/${original.id}/publish`).set('Authorization', 'Bearer valid').set('X-Planning-Session', 'one');

    expect(first.body.revision).toBe(1);
    expect(second.body.revision).toBe(2);
  });

  it('requires the exact scenario name for permanent deletion', async () => {
    const scenario = createPlanningScenario('Typhoon evacuation');
    await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(scenario);
    await request(app).post(`/api/planning/scenarios/${scenario.id}/lock`).set('Authorization', 'Bearer valid').send({ sessionId: 'one' });

    const rejected = await request(app).delete(`/api/planning/scenarios/${scenario.id}`).set('Authorization', 'Bearer valid').set('X-Planning-Session', 'one').send({ name: 'Wrong' });
    const deleted = await request(app).delete(`/api/planning/scenarios/${scenario.id}`).set('Authorization', 'Bearer valid').set('X-Planning-Session', 'one').send({ name: scenario.name });

    expect(rejected.status).toBe(400);
    expect(deleted.status).toBe(200);
  });

  it('allows only one active editing session unless force-unlocked', async () => {
    const scenario = createPlanningScenario('Typhoon evacuation');
    await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(scenario);
    const endpoint = `/api/planning/scenarios/${scenario.id}/lock`;

    const first = await request(app).post(endpoint).set('Authorization', 'Bearer valid').send({ sessionId: 'one' });
    const blocked = await request(app).post(endpoint).set('Authorization', 'Bearer valid').send({ sessionId: 'two' });
    const forced = await request(app).post(endpoint).set('Authorization', 'Bearer valid').send({ sessionId: 'two', force: true });

    expect(first.status).toBe(200);
    expect(blocked.status).toBe(409);
    expect(forced.status).toBe(200);
  });

  it('does not release or broadcast success for the wrong session', async () => {
    const scenario = createPlanningScenario('Typhoon evacuation');
    await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(scenario);
    const endpoint = `/api/planning/scenarios/${scenario.id}/lock`;
    await request(app).post(endpoint).set('Authorization', 'Bearer valid').send({ sessionId: 'one' });

    const release = await request(app).delete(endpoint).set('Authorization', 'Bearer valid').send({ sessionId: 'two' });
    const stillBlocked = await request(app).post(endpoint).set('Authorization', 'Bearer valid').send({ sessionId: 'two' });

    expect(release.status).toBe(409);
    expect(stillBlocked.status).toBe(409);
  });

  it('rejects malformed shared templates', async () => {
    const id = crypto.randomUUID();
    const response = await request(app)
      .put(`/api/planning/templates/${id}`)
      .set('Authorization', 'Bearer valid')
      .send({ id, name: 'Broken', symbolKey: 'eoc', color: 'red', size: 'large', updatedAt: new Date().toISOString() });

    expect(response.status).toBe(400);
  });

  it('rejects scenario mutation without the active editing lock', async () => {
    const scenario = createPlanningScenario('Locked plan');
    const created = await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(scenario);

    const response = await request(app).put(`/api/planning/scenarios/${scenario.id}`).set('Authorization', 'Bearer valid').send(created.body);

    expect(response.status).toBe(409);
  });

  it('rejects planning objects outside the province boundary', async () => {
    const scenario = createPlanningScenario('Outside plan');
    scenario.objects.push({ id: crypto.randomUUID(), kind: 'symbol', layer: 'symbols', coordinates: [[0, 0]], style: { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' }, locked: false, order: 0, symbolKey: 'eoc' });

    const response = await request(app).post('/api/planning/scenarios').set('Authorization', 'Bearer valid').send(scenario);

    expect(response.status).toBe(400);
  });
});
