import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, createDatabase } from '../../server';
import { one, type Database } from './database';

const hazard = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  type: 'flood',
  severity: 'Moderate',
  title: 'Test Hazard',
  municipality: 'Daet',
  barangay: 'Bagasbas',
  notes: '',
  geometry: { type: 'Point', coordinates: [122.98, 14.13] },
  dateAdded: '2026-04-15T08:00:00Z',
};

describe('production API', () => {
  let db: Database;
  let client: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    db = await createDatabase(':memory:');
    client = request.agent(createApp(db, '1234'));
  });

  afterEach(() => db.close());

  const authorize = async () => {
    const response = await client.post('/api/verify-pin').send({ pin: '1234' });
    expect(response.status).toBe(200);
  };

  it('protects every operational mutation with an authenticated session', async () => {
    expect((await client.post('/api/hazards').send(hazard)).status).toBe(401);
    expect((await client.put(`/api/hazards/${hazard.id}`).send({ severity: 'Severe' })).status).toBe(401);
    expect((await client.delete(`/api/hazards/${hazard.id}`)).status).toBe(401);
    expect((await client.post('/api/evacuation-centers').send({})).status).toBe(401);
  });

  it('creates valid hazards, rejects duplicates, and records the mutation', async () => {
    await authorize();
    expect((await client.post('/api/hazards').send(hazard)).status).toBe(201);
    expect((await client.post('/api/hazards').send(hazard)).status).toBe(409);
    expect((await client.get('/api/hazards')).body).toHaveLength(1);
    expect((await one<{ count: number }>(db, "SELECT COUNT(*) AS count FROM operations_audit WHERE path = '/api/hazards'"))?.count).toBe(1);
  });

  it('rejects missing dates and malformed geometry at the trust boundary', async () => {
    await authorize();
    const { dateAdded: _, ...missingDate } = hazard;
    expect((await client.post('/api/hazards').send(missingDate)).status).toBe(400);
    expect((await client.post('/api/hazards').send({ ...hazard, geometry: { type: 'Point', coordinates: [999, 999] } })).status).toBe(400);
    expect((await client.post('/api/hazards').set('Content-Type', 'application/json').send('{')).status).toBe(400);
  });

  it('rejects stale updates instead of overwriting newer operational data', async () => {
    await authorize();
    await client.post('/api/hazards').send(hazard);
    const updated = await client.put(`/api/hazards/${hazard.id}`).send({ severity: 'Severe', version: 1 });
    expect(updated.body.version).toBe(2);
    const stale = await client.put(`/api/hazards/${hazard.id}`).send({ severity: 'Critical', version: 1 });
    expect(stale.status).toBe(409);
    expect((await client.put(`/api/hazards/${hazard.id}`).send({ severity: 'Critical' })).status).toBe(400);
    expect(stale.body.current.severity).toBe('Severe');
  });

  it('rate-limits repeated PIN guesses', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await client.post('/api/verify-pin').set('X-Forwarded-For', '203.0.113.1').send({ pin: '0000' })).status).toBe(401);
    expect((await client.post('/api/verify-pin').set('X-Forwarded-For', '203.0.113.1').send({ pin: '0000' })).status).toBe(429);
    expect((await client.post('/api/verify-pin').set('X-Forwarded-For', '203.0.113.2').send({ pin: '0000' })).status).toBe(401);
    expect((await one<{ count: number }>(db, "SELECT COUNT(*) AS count FROM operations_audit WHERE path LIKE '/api/verify-pin:%'"))?.count).toBe(7);
  });

  it('uses the authenticated session—not a raw PIN header—for center deletion', async () => {
    const center = { id: crypto.randomUUID(), name: 'School', type: 'school', capacity: 100, municipality: 'Daet', barangay: 'Centro', coordinates: [122.98, 14.13], dateAdded: new Date().toISOString() };
    await authorize();
    expect((await client.post('/api/evacuation-centers').send(center)).status).toBe(201);
    expect((await client.delete(`/api/evacuation-centers/${center.id}`)).status).toBe(200);
  });
});
