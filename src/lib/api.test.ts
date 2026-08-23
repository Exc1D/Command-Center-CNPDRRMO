import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { db, type Hazard } from './db';
import { EvacuationCenterAPI, HazardAPI } from './api';
import { useStore } from './store';

vi.mock('axios', async importActual => {
  const actual = await importActual<typeof import('axios')>();
  return { default: { ...actual.default, get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const api = vi.mocked(axios);
const hazard = (id: string, syncStatus?: Hazard['syncStatus']): Hazard => ({
  id,
  type: 'flood',
  severity: 'Moderate',
  notes: '',
  geometry: { type: 'Point', coordinates: [122.98, 14.13] },
  dateAdded: '2026-04-15T08:00:00Z',
  version: 1,
  syncStatus,
});

beforeEach(async () => {
  await Promise.all([db.hazards.clear(), db.evacuationCenters.clear()]);
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  useStore.setState({ syncState: { isSyncing: false, lastSyncError: null } });
});

describe('offline reconciliation', () => {
  it('preserves pending work, removes stale cache entries, and hides pending deletes', async () => {
    await db.hazards.bulkPut([
      hazard('pending-update', 'pending_update'),
      hazard('pending-delete', 'pending_delete'),
      hazard('pending-add', 'pending_add'),
      hazard('stale', 'synced'),
    ]);
    api.get.mockResolvedValue({ data: [hazard('pending-update'), hazard('pending-delete'), hazard('server')] });

    const visible = await HazardAPI.getAllHazards();

    expect(visible.map(item => item.id).sort()).toEqual(['pending-add', 'pending-update', 'server']);
    expect((await db.hazards.get('pending-update'))?.syncStatus).toBe('pending_update');
    expect(await db.hazards.get('stale')).toBeUndefined();
  });

  it('does not show records queued for deletion while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false });
    await db.hazards.bulkPut([hazard('visible', 'synced'), hazard('deleted', 'pending_delete')]);
    expect((await HazardAPI.getAllHazards()).map(item => item.id)).toEqual(['visible']);
  });

  it('serializes concurrent sync calls through the real mutex', async () => {
    await db.hazards.put(hazard('pending', 'pending_add'));
    api.post.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ data: { version: 1 } }), 30)));
    await Promise.all([HazardAPI.syncPending(), HazardAPI.syncPending()]);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('does not disguise validation failures as offline work', async () => {
    api.put.mockRejectedValue(Object.assign(new Error('Bad request'), { isAxiosError: true, response: { status: 400 } }));
    await expect(HazardAPI.updateHazard(hazard('invalid'))).rejects.toThrow('Bad request');
    expect(await db.hazards.get('invalid')).toBeUndefined();
  });

  it('does not queue non-network failures', async () => {
    api.post.mockRejectedValue(new Error('storage failed'));
    await expect(HazardAPI.addHazard(hazard('broken'))).rejects.toThrow('storage failed');
    expect(await db.hazards.get('broken')).toBeUndefined();
  });

  it('preserves a visible sync error when an item fails', async () => {
    await db.hazards.put(hazard('pending', 'pending_update'));
    api.put.mockRejectedValue(new Error('server unavailable'));
    await HazardAPI.syncPending();
    await EvacuationCenterAPI.syncPending();
    expect(useStore.getState().syncState.lastSyncError).toContain('1 item');
  });

  it('treats a duplicate queued add as an idempotent success', async () => {
    await db.hazards.put(hazard('duplicate', 'pending_add'));
    api.post.mockRejectedValue(Object.assign(new Error('Conflict'), { isAxiosError: true, response: { status: 409 } }));
    await HazardAPI.syncPending();
    expect((await db.hazards.get('duplicate'))?.syncStatus).toBe('synced');
  });

  it('reconciles evacuation centers with the same pending-work rules', async () => {
    const center = { id: 'center', name: 'School', type: 'school' as const, capacity: 10, municipality: 'Daet', barangay: 'Centro', coordinates: [122.98, 14.13] as [number, number], dateAdded: new Date().toISOString(), syncStatus: 'pending_add' as const };
    await db.evacuationCenters.put(center);
    api.get.mockResolvedValue({ data: [] });
    expect((await EvacuationCenterAPI.getAllCenters()).map(item => item.id)).toEqual(['center']);
  });
});
