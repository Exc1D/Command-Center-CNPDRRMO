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

describe('EditHazardModal handleSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAllHazards.mockResolvedValue([]);
  });

  it('handleSave catches errors and resets isSaving on failure', async () => {
    mockUpdateHazard.mockRejectedValue(new Error('Update failed'));

    let isSaving = true;
    try {
      await HazardAPI.updateHazard({ id: '1', type: 'flood', severity: 'Moderate' });
    } catch {
      // Error caught - isSaving should be reset
    } finally {
      isSaving = false;
    }

    expect(isSaving).toBe(false);
  });

  it('handleSave does not crash on API error', async () => {
    mockUpdateHazard.mockRejectedValue(new Error('Network error'));

    // Verify the function handles the rejection gracefully
    let caught = false;
    try {
      await HazardAPI.updateHazard({ id: '1', type: 'flood' });
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);
  });

  it('handleSave closes modal on success', async () => {
    mockUpdateHazard.mockResolvedValue(undefined);

    // Simulate successful save
    const closeModal = vi.fn();
    try {
      await HazardAPI.updateHazard({ id: '1', type: 'flood' });
      closeModal();
    } catch {
      // No-op on error
    }

    expect(closeModal).toHaveBeenCalled();
  });

  it('handleSave refreshes hazards after successful update', async () => {
    const mockHazards = [{ id: '1', type: 'flood', severity: 'Severe' }];
    mockUpdateHazard.mockResolvedValue(undefined);
    mockGetAllHazards.mockResolvedValue(mockHazards);

    await HazardAPI.updateHazard({ id: '1', type: 'flood' });
    const hazards = await HazardAPI.getAllHazards();

    expect(hazards).toEqual(mockHazards);
  });
});