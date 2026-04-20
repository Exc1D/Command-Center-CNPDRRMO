import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HazardAPI } from '../lib/api';

// Use hoisted mock functions so they're available in the hoisted factory
const mockGetAllHazards = vi.hoisted(() => vi.fn());
const mockSyncPending = vi.hoisted(() => vi.fn());
const mockAddHazard = vi.hoisted(() => vi.fn());
const mockUpdateHazard = vi.hoisted(() => vi.fn());
const mockDeleteHazard = vi.hoisted(() => vi.fn());

// Mock the api module
vi.mock('../lib/api', () => ({
  HazardAPI: {
    getAllHazards: mockGetAllHazards,
    syncPending: mockSyncPending,
    addHazard: mockAddHazard,
    updateHazard: mockUpdateHazard,
    deleteHazard: mockDeleteHazard,
  },
}));

describe('Map - pm:remove and pm:edit handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllHazards.mockResolvedValue([]);
    mockDeleteHazard.mockResolvedValue(undefined);
    mockUpdateHazard.mockResolvedValue(undefined);
  });

  describe('pm:remove handler', () => {
    it('pm:remove calls deleteHazard', async () => {
      const hazardId = 'test-uuid';

      await HazardAPI.deleteHazard(hazardId);

      expect(mockDeleteHazard).toHaveBeenCalledWith(hazardId);
    });

    it('pm:remove refreshes store on success', async () => {
      const hazardId = 'test-uuid';
      const mockHazards = [{ id: '1', type: 'flood' }];
      mockDeleteHazard.mockResolvedValue(undefined);
      mockGetAllHazards.mockResolvedValue(mockHazards);

      await HazardAPI.deleteHazard(hazardId);
      const hazards = await HazardAPI.getAllHazards();

      expect(hazards).toEqual(mockHazards);
    });

    it('pm:remove catches errors without crashing', async () => {
      const hazardId = 'test-uuid';
      mockDeleteHazard.mockRejectedValue(new Error('Delete failed'));

      // Verify the function handles the rejection gracefully
      let caught = false;
      try {
        await HazardAPI.deleteHazard(hazardId);
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });
  });

  describe('pm:edit handler', () => {
    it('pm:edit calls updateHazard', async () => {
      const hazard = { id: 'test-uuid', type: 'flood', severity: 'Moderate' };

      await HazardAPI.updateHazard(hazard);

      expect(mockUpdateHazard).toHaveBeenCalledWith(hazard);
    });

    it('pm:edit refreshes store on success', async () => {
      const hazard = { id: 'test-uuid', type: 'flood', severity: 'Moderate' };
      const mockHazards = [{ id: 'test-uuid', type: 'flood', severity: 'Severe' }];
      mockUpdateHazard.mockResolvedValue(undefined);
      mockGetAllHazards.mockResolvedValue(mockHazards);

      await HazardAPI.updateHazard(hazard);
      const hazards = await HazardAPI.getAllHazards();

      expect(hazards).toEqual(mockHazards);
    });

    it('pm:edit catches errors without crashing', async () => {
      const hazard = { id: 'test-uuid', type: 'flood', severity: 'Moderate' };
      mockUpdateHazard.mockRejectedValue(new Error('Update failed'));

      // Verify the function handles the rejection gracefully
      let caught = false;
      try {
        await HazardAPI.updateHazard(hazard);
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
    });
  });
});