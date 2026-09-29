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
  expect(stored).toMatchObject({syncStatus:'pending_add',affectedPopulation:37,affectedPopulationBasis:'population_estimate'});

  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

  await HazardAPI.syncPending();

  const synced = await db.hazards.get(hazard.id);
  expect(synced).toMatchObject({syncStatus:'synced',affectedPopulation:37,affectedPopulationBasis:'population_estimate'});
  expect(axios.post).toHaveBeenCalledWith('/api/hazards',expect.objectContaining({affectedPopulation:37,affectedPopulationBasis:'population_estimate'}));
});
