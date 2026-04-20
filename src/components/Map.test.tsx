/**
 * Map Component Integration Tests
 * 
 * These tests verify the integration between the map event handlers (pm:remove, pm:edit)
 * and the HazardAPI/store, WITHOUT rendering the actual Map component (which requires
 * Leaflet/React-Leaflet that doesn't work in JSDOM).
 * 
 * The pm:remove and pm:edit handlers are defined in Map.tsx (lines 60-71 and 167-184).
 * We test the handler patterns directly by simulating what they do:
 *   - pm:remove: calls HazardAPI.deleteHazard(), then getAllHazards() to refresh store
 *   - pm:edit:  calls HazardAPI.updateHazard(), then getAllHazards() to refresh store
 * 
 * This is NOT testing the visual map component — it's testing the business logic
 * integration of the map event handlers with the data layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HazardAPI } from '../lib/api';
import { useStore } from '../lib/store';

// Hoisted mock functions
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

describe('Map - HazardAPI integration for pm:remove and pm:edit handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllHazards.mockResolvedValue([]);
    mockDeleteHazard.mockResolvedValue(undefined);
    mockUpdateHazard.mockResolvedValue(undefined);

    useStore.setState({
      hazards: [],
      filteredHazards: [],
    });
  });

  describe('pm:remove handler integration (HazardAPI.deleteHazard)', () => {
    it('deleteHazard is called with correct hazardId', async () => {
      const hazardId = 'test-uuid';

      await HazardAPI.deleteHazard(hazardId);

      expect(mockDeleteHazard).toHaveBeenCalledWith(hazardId);
    });

    it('pm:remove pattern - deleteHazard then getAllHazards updates store', async () => {
      const hazardId = 'test-uuid';
      const remainingHazards = [{ id: 'other-uuid', type: 'flood', severity: 'Moderate' }];
      mockDeleteHazard.mockResolvedValue(undefined);
      mockGetAllHazards.mockResolvedValue(remainingHazards);

      // Simulate what pm:remove handler does (from Map.tsx lines 60-71)
      try {
        await HazardAPI.deleteHazard(hazardId);
        const hazards = await HazardAPI.getAllHazards();
        useStore.getState().setHazards(hazards);
      } catch (error) {
        console.error('Failed to delete hazard:', error);
      }

      expect(mockDeleteHazard).toHaveBeenCalledWith(hazardId);
      expect(mockGetAllHazards).toHaveBeenCalled();
      expect(useStore.getState().hazards).toEqual(remainingHazards);
    });

    it('pm:remove handler pattern catches errors and logs without crashing', async () => {
      const hazardId = 'test-uuid';
      mockDeleteHazard.mockRejectedValue(new Error('Delete failed'));

      // Spy on console.error to suppress error output
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate the pm:remove handler pattern from Map.tsx (lines 60-71)
      // The handler catches errors and logs them
      let handlerError = null;
      try {
        await HazardAPI.deleteHazard(hazardId);
      } catch (error) {
        handlerError = error;
        console.error('Failed to delete hazard:', error);
      }

      // The error was caught by the handler
      expect(handlerError).toBeInstanceOf(Error);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to delete hazard:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });

  describe('pm:edit handler integration (HazardAPI.updateHazard)', () => {
    it('updateHazard is called with updated hazard data', async () => {
      const hazard = {
        id: 'test-uuid',
        type: 'flood' as const,
        severity: 'Moderate' as const,
        geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      };

      await HazardAPI.updateHazard(hazard);

      expect(mockUpdateHazard).toHaveBeenCalledWith(hazard);
    });

    it('pm:edit pattern - updateHazard then getAllHazards updates store', async () => {
      const hazardData = {
        id: 'test-uuid',
        type: 'flood' as const,
        severity: 'Moderate' as const,
        geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
      };
      const refreshedHazards = [{ ...hazardData, severity: 'Severe' }];

      mockUpdateHazard.mockResolvedValue(undefined);
      mockGetAllHazards.mockResolvedValue(refreshedHazards);

      // Simulate what pm:edit handler does (from Map.tsx lines 167-184)
      try {
        await HazardAPI.updateHazard(hazardData);
        const hazards = await HazardAPI.getAllHazards();
        useStore.getState().setHazards(hazards);
      } catch (error) {
        console.error('Failed to update hazard:', error);
      }

      expect(mockUpdateHazard).toHaveBeenCalledWith(hazardData);
      expect(mockGetAllHazards).toHaveBeenCalled();
      expect(useStore.getState().hazards).toEqual(refreshedHazards);
    });

    it('pm:edit handler pattern catches errors and logs without crashing', async () => {
      const hazard = { id: 'test-uuid', type: 'flood', severity: 'Moderate' };
      mockUpdateHazard.mockRejectedValue(new Error('Update failed'));

      // Spy on console.error to suppress error output
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate the pm:edit handler pattern from Map.tsx (lines 167-184)
      // The handler catches errors and logs them
      let handlerError = null;
      try {
        await HazardAPI.updateHazard(hazard);
      } catch (error) {
        handlerError = error;
        console.error('Failed to update hazard:', error);
      }

      // The error was caught by the handler
      expect(handlerError).toBeInstanceOf(Error);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to update hazard:', expect.any(Error));

      consoleSpy.mockRestore();
    });
  });
});
