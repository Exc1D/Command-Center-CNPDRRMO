import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HazardAPI } from './api';

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

vi.mock('./db', () => ({
  db: {
    hazards: mockHazardsTable,
  },
  Hazard: {},
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

    it('BUGGY: After 2nd fails, 3rd is NEVER synced', async () => {
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
      expect(mockHazardsTable.update).not.toHaveBeenCalledWith('3', { syncStatus: 'synced' });
    });

    it('FIXED: After 2nd fails, 3rd IS synced - FAILS on current code', async () => {
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
  });
});
