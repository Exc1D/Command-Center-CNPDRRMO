import 'fake-indexeddb/auto';
import { vi, it, expect, beforeEach } from 'vitest';
import axios from 'axios';
import { db } from './db';
import { HazardAPI } from './api';
import type { Hazard } from './db';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

beforeEach(async () => {
  await db.hazards.clear();
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

it('full offline-first workflow: add offline, go online, syncPending', async () => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });

  const hazard: Omit<Hazard, 'syncStatus'> = {
    id: '550e8400-e29b-41d4-a716-446655440001',
    type: 'flood',
    symbolKey: 'rescue-boat',
    severity: 'Moderate',
    title: 'Integration Test Flood',
    municipality: 'Daet',
    barangay: 'Bagasbas',
    notes: 'Testing offline-first',
    affectedPopulation: 37,
    affectedPopulationBasis: 'population_estimate',
    geometry: { type: 'Point', coordinates: [122.9803837, 14.1337179] },
    dateAdded: new Date().toISOString(),
  };

  await HazardAPI.addHazard(hazard);

  const stored = await db.hazards.get(hazard.id);
  expect(stored).toMatchObject({symbolKey:'rescue-boat',syncStatus:'pending_add',affectedPopulation:37,affectedPopulationBasis:'population_estimate'});

  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

  await HazardAPI.syncPending();

  const synced = await db.hazards.get(hazard.id);
  expect(synced).toMatchObject({symbolKey:'rescue-boat',syncStatus:'synced',affectedPopulation:37,affectedPopulationBasis:'population_estimate'});
  expect(axios.post).toHaveBeenCalledWith('/api/hazards',expect.objectContaining({symbolKey:'rescue-boat',affectedPopulation:37,affectedPopulationBasis:'population_estimate'}));
});

it('queues standalone resource pins offline and retains their symbol after reload', async () => {
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
  const resource: Hazard={id:crypto.randomUUID(),type:'resource',symbolKey:'ambulance',severity:'Not applicable',notes:'Team Alpha',municipality:'Daet',barangay:'Bagasbas',geometry:{type:'Point',coordinates:[123,14]},dateAdded:new Date().toISOString()};
  await HazardAPI.addHazard(resource);
  expect(await HazardAPI.getAllHazards()).toEqual([expect.objectContaining({...resource,syncStatus:'pending_add'})]);
  Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
  vi.mocked(axios.post).mockResolvedValue({data:{version:1}});
  await HazardAPI.syncPending();
  vi.mocked(axios.get).mockResolvedValue({data:[{...resource,version:1,geometry:JSON.stringify(resource.geometry)}]});
  expect(await HazardAPI.getAllHazards()).toEqual([expect.objectContaining({...resource,syncStatus:'synced',version:1})]);
});
