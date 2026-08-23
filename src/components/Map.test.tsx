import { beforeEach, describe, expect, it, vi } from 'vitest';
import { removeHazard, updateHazardGeometry } from './Map';
import { useStore } from '../lib/store';

const api = vi.hoisted(() => ({
  getAllHazards: vi.fn(),
  updateHazard: vi.fn(),
  deleteHazard: vi.fn(),
}));

vi.mock('../lib/api', () => ({
  HazardAPI: api,
  EvacuationCenterAPI: { getAllCenters: vi.fn() },
}));

describe('map persistence handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ hazards: [], filteredHazards: [], activeFilters: ['flood'] });
  });

  it('removes a hazard through the real handler and refreshes the store', async () => {
    api.getAllHazards.mockResolvedValue([{ id: 'remaining', type: 'flood' }]);
    await removeHazard('deleted');
    expect(api.deleteHazard).toHaveBeenCalledWith('deleted');
    expect(useStore.getState().hazards).toEqual([{ id: 'remaining', type: 'flood' }]);
  });

  it('persists edited geometry through the real handler and refreshes the store', async () => {
    const hazard = { id: 'hazard', type: 'flood', geometry: { type: 'Point', coordinates: [122, 14] } };
    const geometry = { type: 'Point', coordinates: [123, 15] };
    api.getAllHazards.mockResolvedValue([{ ...hazard, geometry }]);
    await updateHazardGeometry(hazard, geometry);
    expect(api.updateHazard).toHaveBeenCalledWith({ ...hazard, geometry });
    expect(useStore.getState().hazards[0].geometry).toEqual(geometry);
  });
});
