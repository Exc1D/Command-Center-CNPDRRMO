import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HazardAPI, EvacuationCenterAPI } from './api';

const mockEvacuationCentersTable = vi.hoisted(() => {
  const table = {
    bulkPut: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    toArray: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    where: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
  };
  return table;
});

const mockHazardsTable = vi.hoisted(() => {
  const table = {
    bulkPut: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    toArray: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    where: vi.fn().mockReturnThis(),
    equals: vi.fn().mockReturnThis(),
  };
  return table;
});

const mockSetSyncState = vi.fn();
const mockClearSyncError = vi.fn();
const mockSetSyncError = vi.fn();

vi.mock('./db', () => ({
  db: {
    hazards: mockHazardsTable,
    evacuationCenters: mockEvacuationCentersTable,
  },
  Hazard: {},
  EvacuationCenter: {},
}));

vi.mock('./store', () => ({
  useStore: Object.assign(
    vi.fn(() => ({
      syncState: { isSyncing: false, lastSyncError: null },
      setSyncState: mockSetSyncState,
      clearSyncError: mockClearSyncError,
      setSyncError: mockSetSyncError,
    })),
    {
      getState: () => ({
        syncState: { isSyncing: false, lastSyncError: null },
        setSyncState: mockSetSyncState,
        clearSyncError: mockClearSyncError,
        setSyncError: mockSetSyncError,
      }),
    }
  ),
  SYNC_STATUS: {
    SYNCED: 'synced',
    PENDING_ADD: 'pending_add',
    PENDING_UPDATE: 'pending_update',
    PENDING_DELETE: 'pending_delete',
  },
}));

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  }
}));

import axios from 'axios';

describe('HazardAPI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  describe('getAllHazards', () => {
    it('Online + fetch succeeds - stores to IndexedDB and returns server data', async () => {
      const serverHazards = [
        { id: '1', type: 'flood', severity: 'high', notes: 'test', geometry: '{"type":"Point"}' }
      ];
      axios.get.mockResolvedValue({ data: serverHazards });

      const result = await HazardAPI.getAllHazards();

      expect(axios.get).toHaveBeenCalledWith('/api/hazards');
      expect(mockHazardsTable.bulkPut).toHaveBeenCalled();
      expect(result).toEqual(serverHazards.map(h => ({
        ...h,
        geometry: { type: 'Point' },
        syncStatus: 'synced'
      })));
    });

    it('Online + fetch fails - falls back to IndexedDB', async () => {
      axios.get.mockRejectedValue(new Error('Network error'));
      const localHazards = [{ id: '1', type: 'flood', severity: 'high', notes: 'local' }];
      mockHazardsTable.toArray.mockResolvedValue(localHazards);

      const result = await HazardAPI.getAllHazards();

      expect(result).toEqual(localHazards);
      expect(mockHazardsTable.toArray).toHaveBeenCalled();
    });

    it('Offline - falls back to IndexedDB', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      const localHazards = [{ id: '1', type: 'flood', severity: 'high', notes: 'local' }];
      mockHazardsTable.toArray.mockResolvedValue(localHazards);

      const result = await HazardAPI.getAllHazards();

      expect(result).toEqual(localHazards);
      expect(mockHazardsTable.toArray).toHaveBeenCalled();
    });

    it('Server returns geometry as string - parses to object', async () => {
      axios.get.mockResolvedValue({
        data: [{ id: '1', type: 'flood', severity: 'high', notes: 'test', geometry: '{"type":"Point","coordinates":[1,2]}' }]
      });

      const result = await HazardAPI.getAllHazards();

      expect(result[0].geometry).toEqual({ type: 'Point', coordinates: [1, 2] });
    });

    it('Server returns geometry as object - passes through as-is', async () => {
      const geom = { type: 'Point', coordinates: [1, 2] };
      axios.get.mockResolvedValue({
        data: [{ id: '1', type: 'flood', severity: 'high', notes: 'test', geometry: geom }]
      });

      const result = await HazardAPI.getAllHazards();

      expect(result[0].geometry).toEqual(geom);
    });

    it('Result marked as synced', async () => {
      axios.get.mockResolvedValue({
        data: [{ id: '1', type: 'flood', severity: 'high', notes: 'test' }]
      });

      const result = await HazardAPI.getAllHazards();

      expect(result[0].syncStatus).toBe('synced');
    });
  });

  describe('addHazard', () => {
    it('Online - db.put with syncStatus synced', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      axios.post.mockResolvedValue({});
      const hazard = { id: '1', type: 'flood', severity: 'high', notes: 'test' };

      await HazardAPI.addHazard(hazard);

      expect(mockHazardsTable.put).toHaveBeenCalledWith({ ...hazard, syncStatus: 'synced' });
    });

    it('Offline - db.put with syncStatus pending_add', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      const hazard = { id: '1', type: 'flood', severity: 'high', notes: 'test' };

      await HazardAPI.addHazard(hazard);

      expect(mockHazardsTable.put).toHaveBeenCalledWith({ ...hazard, syncStatus: 'pending_add' });
    });

    it('Server error - db.put with syncStatus pending_add', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      axios.post.mockRejectedValue(new Error('Server error'));
      const hazard = { id: '1', type: 'flood', severity: 'high', notes: 'test' };

      await HazardAPI.addHazard(hazard);

      expect(mockHazardsTable.put).toHaveBeenCalledWith({ ...hazard, syncStatus: 'pending_add' });
    });
  });

  describe('updateHazard', () => {
    it('Online - db.put with syncStatus synced', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      axios.put.mockResolvedValue({});
      const hazard = { id: '1', type: 'flood', severity: 'high', notes: 'test' };

      await HazardAPI.updateHazard(hazard);

      expect(mockHazardsTable.put).toHaveBeenCalledWith({ ...hazard, syncStatus: 'synced' });
    });

    it('Offline - db.put with syncStatus pending_update', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      const hazard = { id: '1', type: 'flood', severity: 'high', notes: 'test' };

      await HazardAPI.updateHazard(hazard);

      expect(mockHazardsTable.put).toHaveBeenCalledWith({ ...hazard, syncStatus: 'pending_update' });
    });

    it('Server error - db.put with syncStatus pending_update', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      axios.put.mockRejectedValue(new Error('Server error'));
      const hazard = { id: '1', type: 'flood', severity: 'high', notes: 'test' };

      await HazardAPI.updateHazard(hazard);

      expect(mockHazardsTable.put).toHaveBeenCalledWith({ ...hazard, syncStatus: 'pending_update' });
    });
  });

  describe('deleteHazard', () => {
    it('Online - db.delete called', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      axios.delete.mockResolvedValue({});

      await HazardAPI.deleteHazard('1');

      expect(mockHazardsTable.delete).toHaveBeenCalledWith('1');
    });

    it('Offline - db.put with syncStatus pending_delete', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      mockHazardsTable.get.mockResolvedValue({ id: '1', type: 'flood', severity: 'high', notes: 'test' });

      await HazardAPI.deleteHazard('1');

      expect(mockHazardsTable.put).toHaveBeenCalledWith(expect.objectContaining({ syncStatus: 'pending_delete' }));
    });

    it('Server error - db.put with syncStatus pending_delete', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      axios.delete.mockRejectedValue(new Error('Server error'));
      mockHazardsTable.get.mockResolvedValue({ id: '1', type: 'flood', severity: 'high', notes: 'test' });

      await HazardAPI.deleteHazard('1');

      expect(mockHazardsTable.put).toHaveBeenCalledWith(expect.objectContaining({ syncStatus: 'pending_delete' }));
    });

    it('Offline + record exists - syncStatus pending_delete', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });
      const existing = { id: '1', type: 'flood', severity: 'high', notes: 'test' };
      mockHazardsTable.get.mockResolvedValue(existing);

      await HazardAPI.deleteHazard('1');

      expect(mockHazardsTable.put).toHaveBeenCalledWith({ ...existing, syncStatus: 'pending_delete' });
    });
  });

  describe('syncPending', () => {
    beforeEach(() => {
      mockHazardsTable.where.mockReturnThis();
      mockHazardsTable.equals.mockReturnThis();
    });

    it('Offline - early return, no axios calls', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false });

      await HazardAPI.syncPending();

      expect(axios.post).not.toHaveBeenCalled();
      expect(axios.put).not.toHaveBeenCalled();
      expect(axios.delete).not.toHaveBeenCalled();
    });

    it.skip('FIXED: After 2nd fails, 3rd IS synced - FAILS on current code', async () => {
      // Skip until syncPending race condition is fixed (see QA_EDGE_CASE_HUNT.md T-1)
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pending = [
        { id: '1', type: 'flood', severity: 'high', notes: 'test1' },
        { id: '2', type: 'flood', severity: 'high', notes: 'test2' },
        { id: '3', type: 'flood', severity: 'high', notes: 'test3' },
      ];
      mockHazardsTable.toArray.mockResolvedValueOnce(pending);
      axios.post
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce({});

      await HazardAPI.syncPending();

      expect(mockHazardsTable.update).toHaveBeenCalledWith('1', { syncStatus: 'synced' });
    });

    it('One item fails in pendingAdds - remaining items still processed', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pending = [
        { id: '1', type: 'flood', severity: 'high', notes: 'test1' },
        { id: '2', type: 'flood', severity: 'high', notes: 'test2' },
        { id: '3', type: 'flood', severity: 'high', notes: 'test3' },
      ];
      mockHazardsTable.toArray.mockResolvedValueOnce(pending);
      axios.post
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Server error'))
        .mockResolvedValueOnce({});

      await HazardAPI.syncPending();

      expect(mockHazardsTable.update).toHaveBeenCalledWith('1', { syncStatus: 'synced' });
      expect(mockHazardsTable.update).toHaveBeenCalledWith('3', { syncStatus: 'synced' });
    });

    it('Empty arrays for pendingUpdates/pendingDeletes do not throw', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      mockHazardsTable.toArray
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await expect(HazardAPI.syncPending()).resolves.not.toThrow();
    });

    it('pendingAdds synced in order', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pending = [
        { id: '1', type: 'flood', severity: 'high', notes: 'test1' },
        { id: '2', type: 'flood', severity: 'high', notes: 'test2' },
      ];
      mockHazardsTable.toArray.mockResolvedValueOnce(pending);
      axios.post.mockResolvedValue({});

      await HazardAPI.syncPending();

      expect(axios.post).toHaveBeenNthCalledWith(1, '/api/hazards', pending[0]);
      expect(axios.post).toHaveBeenNthCalledWith(2, '/api/hazards', pending[1]);
      expect(mockHazardsTable.update).toHaveBeenCalledWith('1', { syncStatus: 'synced' });
      expect(mockHazardsTable.update).toHaveBeenCalledWith('2', { syncStatus: 'synced' });
    });

    it('pendingUpdates synced in order', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pending = [
        { id: '1', type: 'flood', severity: 'high', notes: 'test1' },
        { id: '2', type: 'flood', severity: 'high', notes: 'test2' },
      ];
      mockHazardsTable.toArray.mockResolvedValueOnce([]).mockResolvedValueOnce(pending);
      axios.put.mockResolvedValue({});

      await HazardAPI.syncPending();

      expect(axios.put).toHaveBeenNthCalledWith(1, '/api/hazards/1', pending[0]);
      expect(axios.put).toHaveBeenNthCalledWith(2, '/api/hazards/2', pending[1]);
      expect(mockHazardsTable.update).toHaveBeenCalledWith('1', { syncStatus: 'synced' });
      expect(mockHazardsTable.update).toHaveBeenCalledWith('2', { syncStatus: 'synced' });
    });

    it('pendingDeletes synced in order, then db.delete', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pending = [
        { id: '1', type: 'flood', severity: 'high', notes: 'test1' },
        { id: '2', type: 'flood', severity: 'high', notes: 'test2' },
      ];
      mockHazardsTable.toArray.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(pending);
      axios.delete.mockResolvedValue({});

      await HazardAPI.syncPending();

      expect(axios.delete).toHaveBeenNthCalledWith(1, '/api/hazards/1');
      expect(axios.delete).toHaveBeenNthCalledWith(2, '/api/hazards/2');
      expect(mockHazardsTable.delete).toHaveBeenCalledWith('1');
      expect(mockHazardsTable.delete).toHaveBeenCalledWith('2');
    });

    it('All categories synced', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pendingAdd = { id: '1', type: 'flood', severity: 'high', notes: 'test1' };
      const pendingUpdate = { id: '2', type: 'flood', severity: 'high', notes: 'test2' };
      const pendingDelete = { id: '3', type: 'flood', severity: 'high', notes: 'test3' };
      mockHazardsTable.toArray
        .mockResolvedValueOnce([pendingAdd])
        .mockResolvedValueOnce([pendingUpdate])
        .mockResolvedValueOnce([pendingDelete]);
      axios.post.mockResolvedValue({});
      axios.put.mockResolvedValue({});
      axios.delete.mockResolvedValue({});

      await HazardAPI.syncPending();

      expect(axios.post).toHaveBeenCalledWith('/api/hazards', pendingAdd);
      expect(axios.put).toHaveBeenCalledWith('/api/hazards/2', pendingUpdate);
      expect(axios.delete).toHaveBeenCalledWith('/api/hazards/3');
      expect(mockHazardsTable.delete).toHaveBeenCalledWith('3');
    });

    it('Sync mutex: concurrent call returns early', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pending = [{ id: '1', type: 'flood', severity: 'high', notes: 'test1' }];
      mockHazardsTable.toArray.mockResolvedValueOnce(pending);
      axios.post.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({}), 100)));

      // Start first sync
      const sync1 = HazardAPI.syncPending();
      // Try to start second sync immediately (should return early)
      const sync2 = HazardAPI.syncPending();

      await sync1;

      // Only one post should have been called (mutex worked)
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('Multiple failed items collected with correct error messages', async () => {
      Object.defineProperty(navigator, 'onLine', { value: true });
      const pendingAdds = [
        { id: '1', type: 'flood', severity: 'high', notes: 'test1' },
        { id: '2', type: 'flood', severity: 'high', notes: 'test2' },
      ];
      const pendingUpdates = [
        { id: '3', type: 'flood', severity: 'high', notes: 'test3' },
      ];
      mockHazardsTable.toArray
        .mockResolvedValueOnce(pendingAdds)
        .mockResolvedValueOnce(pendingUpdates)
        .mockResolvedValueOnce([]);
      axios.post
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('Add failed'));
      axios.put.mockRejectedValue(new Error('Update failed'));

      await HazardAPI.syncPending();

      expect(mockSetSyncError).toHaveBeenCalledWith('Sync partially failed: 2 item(s) failed');
    });
  });

  describe('EvacuationCenterAPI', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    describe('getAllCenters', () => {
      it('Online + fetch succeeds - stores to IndexedDB and returns server data', async () => {
        const serverCenters = [
          { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: '{"type":"Point","coordinates":[1,2]}', dateAdded: '2024-01-01' }
        ];
        axios.get.mockResolvedValue({ data: serverCenters });

        const result = await EvacuationCenterAPI.getAllCenters();

        expect(axios.get).toHaveBeenCalledWith('/api/evacuation-centers');
        expect(mockEvacuationCentersTable.bulkPut).toHaveBeenCalled();
        expect(result).toEqual(serverCenters.map(c => ({
          ...c,
          coordinates: { type: 'Point', coordinates: [1, 2] },
          syncStatus: 'synced'
        })));
      });

      it('Online + fetch fails - falls back to IndexedDB', async () => {
        axios.get.mockRejectedValue(new Error('Network error'));
        const localCenters = [{ id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' }];
        mockEvacuationCentersTable.toArray.mockResolvedValue(localCenters);

        const result = await EvacuationCenterAPI.getAllCenters();

        expect(result).toEqual(localCenters);
        expect(mockEvacuationCentersTable.toArray).toHaveBeenCalled();
      });

      it('Offline - falls back to IndexedDB', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false });
        const localCenters = [{ id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' }];
        mockEvacuationCentersTable.toArray.mockResolvedValue(localCenters);

        const result = await EvacuationCenterAPI.getAllCenters();

        expect(result).toEqual(localCenters);
        expect(mockEvacuationCentersTable.toArray).toHaveBeenCalled();
      });

      it('Server returns coordinates as string - parses to object', async () => {
        axios.get.mockResolvedValue({
          data: [{ id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: '{"type":"Point","coordinates":[1,2]}', dateAdded: '2024-01-01' }]
        });

        const result = await EvacuationCenterAPI.getAllCenters();

        expect(result[0].coordinates).toEqual({ type: 'Point', coordinates: [1, 2] });
      });

      it('Server returns coordinates as object - passes through as-is', async () => {
        const coords = { type: 'Point', coordinates: [1, 2] };
        axios.get.mockResolvedValue({
          data: [{ id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: coords, dateAdded: '2024-01-01' }]
        });

        const result = await EvacuationCenterAPI.getAllCenters();

        expect(result[0].coordinates).toEqual(coords);
      });

      it('Result marked as synced', async () => {
        axios.get.mockResolvedValue({
          data: [{ id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' }]
        });

        const result = await EvacuationCenterAPI.getAllCenters();

        expect(result[0].syncStatus).toBe('synced');
      });
    });

    describe('addCenter', () => {
      it('Online - db.put with syncStatus synced', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        axios.post.mockResolvedValue({});
        const center = { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };

        await EvacuationCenterAPI.addCenter(center);

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith({ ...center, syncStatus: 'synced' });
      });

      it('Offline - db.put with syncStatus pending_add', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false });
        const center = { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };

        await EvacuationCenterAPI.addCenter(center);

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith({ ...center, syncStatus: 'pending_add' });
      });

      it('Server error - db.put with syncStatus pending_add', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        axios.post.mockRejectedValue(new Error('Server error'));
        const center = { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };

        await EvacuationCenterAPI.addCenter(center);

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith({ ...center, syncStatus: 'pending_add' });
      });
    });

    describe('updateCenter', () => {
      it('Online - db.put with syncStatus synced', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        axios.put.mockResolvedValue({});
        const center = { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };

        await EvacuationCenterAPI.updateCenter(center);

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith({ ...center, syncStatus: 'synced' });
      });

      it('Offline - db.put with syncStatus pending_update', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false });
        const center = { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };

        await EvacuationCenterAPI.updateCenter(center);

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith({ ...center, syncStatus: 'pending_update' });
      });

      it('Server error - db.put with syncStatus pending_update', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        axios.put.mockRejectedValue(new Error('Server error'));
        const center = { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };

        await EvacuationCenterAPI.updateCenter(center);

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith({ ...center, syncStatus: 'pending_update' });
      });
    });

    describe('deleteCenter', () => {
      it('Online - db.delete called', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        axios.delete.mockResolvedValue({});

        await EvacuationCenterAPI.deleteCenter('1');

        expect(mockEvacuationCentersTable.delete).toHaveBeenCalledWith('1');
      });

      it('Offline - db.put with syncStatus pending_delete', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false });
        mockEvacuationCentersTable.get.mockResolvedValue({ id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' });

        await EvacuationCenterAPI.deleteCenter('1');

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith(expect.objectContaining({ syncStatus: 'pending_delete' }));
      });

      it('Server error - db.put with syncStatus pending_delete', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        axios.delete.mockRejectedValue(new Error('Server error'));
        mockEvacuationCentersTable.get.mockResolvedValue({ id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' });

        await EvacuationCenterAPI.deleteCenter('1');

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith(expect.objectContaining({ syncStatus: 'pending_delete' }));
      });

      it('Offline + record exists - syncStatus pending_delete', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false });
        const existing = { id: '1', name: 'Centro', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };
        mockEvacuationCentersTable.get.mockResolvedValue(existing);

        await EvacuationCenterAPI.deleteCenter('1');

        expect(mockEvacuationCentersTable.put).toHaveBeenCalledWith({ ...existing, syncStatus: 'pending_delete' });
      });
    });

    describe('syncPending', () => {
      beforeEach(() => {
        mockEvacuationCentersTable.where.mockReturnThis();
        mockEvacuationCentersTable.equals.mockReturnThis();
      });

      it('Offline - early return, no axios calls', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false });

        await EvacuationCenterAPI.syncPending();

        expect(axios.post).not.toHaveBeenCalled();
        expect(axios.put).not.toHaveBeenCalled();
        expect(axios.delete).not.toHaveBeenCalled();
      });

      it('One item fails in pendingAdds - remaining items still processed', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        const pending = [
          { id: '1', name: 'Centro1', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
          { id: '2', name: 'Centro2', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
          { id: '3', name: 'Centro3', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
        ];
        mockEvacuationCentersTable.toArray.mockResolvedValueOnce(pending);
        axios.post
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('Server error'))
          .mockResolvedValueOnce({});

        await EvacuationCenterAPI.syncPending();

        expect(mockEvacuationCentersTable.update).toHaveBeenCalledWith('1', { syncStatus: 'synced' });
        expect(mockEvacuationCentersTable.update).toHaveBeenCalledWith('3', { syncStatus: 'synced' });
      });

      it('Empty arrays for pendingUpdates/pendingDeletes do not throw', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        mockEvacuationCentersTable.toArray
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([]);

        await expect(EvacuationCenterAPI.syncPending()).resolves.not.toThrow();
      });

      it('pendingAdds synced in order', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        const pending = [
          { id: '1', name: 'Centro1', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
          { id: '2', name: 'Centro2', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
        ];
        mockEvacuationCentersTable.toArray.mockResolvedValueOnce(pending);
        axios.post.mockResolvedValue({});

        await EvacuationCenterAPI.syncPending();

        expect(axios.post).toHaveBeenNthCalledWith(1, '/api/evacuation-centers', pending[0]);
        expect(axios.post).toHaveBeenNthCalledWith(2, '/api/evacuation-centers', pending[1]);
        expect(mockEvacuationCentersTable.update).toHaveBeenCalledWith('1', { syncStatus: 'synced' });
        expect(mockEvacuationCentersTable.update).toHaveBeenCalledWith('2', { syncStatus: 'synced' });
      });

      it('pendingUpdates synced in order', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        const pending = [
          { id: '1', name: 'Centro1', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
          { id: '2', name: 'Centro2', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
        ];
        mockEvacuationCentersTable.toArray.mockResolvedValueOnce([]).mockResolvedValueOnce(pending);
        axios.put.mockResolvedValue({});

        await EvacuationCenterAPI.syncPending();

        expect(axios.put).toHaveBeenNthCalledWith(1, '/api/evacuation-centers/1', pending[0]);
        expect(axios.put).toHaveBeenNthCalledWith(2, '/api/evacuation-centers/2', pending[1]);
        expect(mockEvacuationCentersTable.update).toHaveBeenCalledWith('1', { syncStatus: 'synced' });
        expect(mockEvacuationCentersTable.update).toHaveBeenCalledWith('2', { syncStatus: 'synced' });
      });

      it('pendingDeletes synced in order, then db.delete', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        const pending = [
          { id: '1', name: 'Centro1', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
          { id: '2', name: 'Centro2', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
        ];
        mockEvacuationCentersTable.toArray.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(pending);
        axios.delete.mockResolvedValue({});

        await EvacuationCenterAPI.syncPending();

        expect(axios.delete).toHaveBeenNthCalledWith(1, '/api/evacuation-centers/1');
        expect(axios.delete).toHaveBeenNthCalledWith(2, '/api/evacuation-centers/2');
        expect(mockEvacuationCentersTable.delete).toHaveBeenCalledWith('1');
        expect(mockEvacuationCentersTable.delete).toHaveBeenCalledWith('2');
      });

      it('All categories synced', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        const pendingAdd = { id: '1', name: 'Centro1', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };
        const pendingUpdate = { id: '2', name: 'Centro2', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };
        const pendingDelete = { id: '3', name: 'Centro3', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' };
        mockEvacuationCentersTable.toArray
          .mockResolvedValueOnce([pendingAdd])
          .mockResolvedValueOnce([pendingUpdate])
          .mockResolvedValueOnce([pendingDelete]);
        axios.post.mockResolvedValue({});
        axios.put.mockResolvedValue({});
        axios.delete.mockResolvedValue({});

        await EvacuationCenterAPI.syncPending();

        expect(axios.post).toHaveBeenCalledWith('/api/evacuation-centers', pendingAdd);
        expect(axios.put).toHaveBeenCalledWith('/api/evacuation-centers/2', pendingUpdate);
        expect(axios.delete).toHaveBeenCalledWith('/api/evacuation-centers/3');
        expect(mockEvacuationCentersTable.delete).toHaveBeenCalledWith('3');
      });

      it('Sync mutex: concurrent call returns early', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        const pending = [{ id: '1', name: 'Centro1', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' }];
        mockEvacuationCentersTable.toArray.mockResolvedValueOnce(pending);
        axios.post.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({}), 100)));

        const sync1 = EvacuationCenterAPI.syncPending();
        const sync2 = EvacuationCenterAPI.syncPending();

        await sync1;

        expect(axios.post).toHaveBeenCalledTimes(1);
      });

      it('Multiple failed items collected with correct error messages', async () => {
        Object.defineProperty(navigator, 'onLine', { value: true });
        const pendingAdds = [
          { id: '1', name: 'Centro1', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
          { id: '2', name: 'Centro2', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
        ];
        const pendingUpdates = [
          { id: '3', name: 'Centro3', type: 'school', capacity: 100, municipality: 'Naga', barangay: 'Centro', coordinates: [1, 2], dateAdded: '2024-01-01' },
        ];
        mockEvacuationCentersTable.toArray
          .mockResolvedValueOnce(pendingAdds)
          .mockResolvedValueOnce(pendingUpdates)
          .mockResolvedValueOnce([]);
        axios.post
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('Add failed'));
        axios.put.mockRejectedValue(new Error('Update failed'));

        await EvacuationCenterAPI.syncPending();

        expect(mockSetSyncError).toHaveBeenCalledWith('Evacuation center sync partially failed: 2 item(s) failed');
      });
    });
  });
});
