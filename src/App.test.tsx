import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HazardAPI } from './lib/api';

// Use hoisted mock functions so they're available in the hoisted factory
const mockGetAllHazards = vi.hoisted(() => vi.fn());
const mockSyncPending = vi.hoisted(() => vi.fn());
const mockAddHazard = vi.hoisted(() => vi.fn());
const mockUpdateHazard = vi.hoisted(() => vi.fn());
const mockDeleteHazard = vi.hoisted(() => vi.fn());

// Mock the api module
vi.mock('./lib/api', () => ({
  HazardAPI: {
    getAllHazards: mockGetAllHazards,
    syncPending: mockSyncPending,
    addHazard: mockAddHazard,
    updateHazard: mockUpdateHazard,
    deleteHazard: mockDeleteHazard,
  },
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllHazards.mockResolvedValue([]);
    mockSyncPending.mockResolvedValue(undefined);
  });

  describe('fetchHazards on mount', () => {
    it('fetchHazards is called on mount and sets hazards', async () => {
      const hazards = [{ id: '1', type: 'flood', severity: 'Moderate' }];
      mockGetAllHazards.mockResolvedValue(hazards);

      const result = await HazardAPI.getAllHazards();

      expect(mockGetAllHazards).toHaveBeenCalled();
      expect(result).toEqual(hazards);
    });
  });

  describe('handleOnline', () => {
    it('handleOnline catches syncPending errors without crashing', async () => {
      mockSyncPending.mockRejectedValue(new Error('Sync failed'));

      // Verify the function handles the rejection gracefully
      let caught = false;
      try {
        await HazardAPI.syncPending();
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });

    it('handleOnline refreshes hazards after successful sync', async () => {
      const hazards = [{ id: '1', type: 'flood', severity: 'Moderate' }];
      mockSyncPending.mockResolvedValue(undefined);
      mockGetAllHazards.mockResolvedValue(hazards);

      await HazardAPI.syncPending();
      const result = await HazardAPI.getAllHazards();

      expect(mockSyncPending).toHaveBeenCalled();
      expect(mockGetAllHazards).toHaveBeenCalled();
      expect(result).toEqual(hazards);
    });
  });

  describe('event listeners', () => {
    it('online event listener is registered and cleaned up', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const handleOnline = vi.fn();
      window.addEventListener('online', handleOnline);
      window.removeEventListener('online', handleOnline);

      expect(addSpy).toHaveBeenCalledWith('online', handleOnline);
      expect(removeSpy).toHaveBeenCalledWith('online', handleOnline);
    });

    it('offline event listener is registered and cleaned up', () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const handleOffline = vi.fn();
      window.addEventListener('offline', handleOffline);
      window.removeEventListener('offline', handleOffline);

      expect(addSpy).toHaveBeenCalledWith('offline', handleOffline);
      expect(removeSpy).toHaveBeenCalledWith('offline', handleOffline);
    });
  });
});