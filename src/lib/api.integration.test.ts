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
    id: 'int-h1',
    type: 'flood',
    severity: 'Moderate',
    title: 'Integration Test Flood',
    municipality: 'Daet',
    barangay: 'Bagasbas',
    notes: 'Testing offline-first',
    geometry: { type: 'Point', coordinates: [122.9803837, 14.1337179] },
    dateAdded: new Date().toISOString(),
  };

  await HazardAPI.addHazard(hazard);

  const stored = await db.hazards.get('int-h1');
  expect(stored?.syncStatus).toBe('pending_add');

  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });

  await HazardAPI.syncPending();

  const synced = await db.hazards.get('int-h1');
  expect(synced?.syncStatus).toBe('synced');
});
