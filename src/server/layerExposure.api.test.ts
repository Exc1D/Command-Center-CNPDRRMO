import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, createDatabase } from '../../server';
import { analyzeLayerExposure } from './layerExposure';
import type { Database } from './database';

vi.mock('./layerExposure',()=>({analyzeLayerExposure:vi.fn()}));
let db:Database;
beforeEach(async()=>{db=await createDatabase(':memory:');vi.resetAllMocks();});
afterEach(()=>db.close());
it('authorizes, validates geography and layers, prevents caching, and reports missing datasets',async()=>{
  const client=request.agent(createApp(db,'2468'));
  const selection={layers:['flood'],municipality:'Daet',barangay:'Bagasbas',floodClasses:['High']};
  expect((await client.post('/api/reference/layer-exposure').send(selection)).status).toBe(401);
  await client.post('/api/verify-pin').send({pin:'2468'});
  for(const invalid of [{...selection,layers:['../../private']},{...selection,layers:[]},{...selection,floodClasses:['Critical']},{...selection,barangay:'Angas'},{...selection,municipality:''}]) {
    expect((await client.post('/api/reference/layer-exposure').send(invalid)).status).toBe(400);
  }
  expect(analyzeLayerExposure).not.toHaveBeenCalled();
  vi.mocked(analyzeLayerExposure).mockResolvedValue({selection} as Awaited<ReturnType<typeof analyzeLayerExposure>>);
  const response=await client.post('/api/reference/layer-exposure').send(selection);
  expect(response.status).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(analyzeLayerExposure).toHaveBeenCalledWith(selection);
  expect((await client.post('/api/reference/layer-exposure').send({...selection,barangay:' BAGASBAS '})).status).toBe(200);
  expect(analyzeLayerExposure).toHaveBeenLastCalledWith(selection);
  vi.mocked(analyzeLayerExposure).mockRejectedValue(new Error('private file missing'));
  const unavailable=await client.post('/api/reference/layer-exposure').send(selection);
  expect(unavailable.status).toBe(503);
  expect(unavailable.body.error).not.toContain('private file missing');
});
