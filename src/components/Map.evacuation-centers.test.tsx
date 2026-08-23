import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CENTER_TYPE_LABELS, escapeHtml, loadEvacuationCenters } from './Map';
import { useStore } from '../lib/store';
import { ec1, ec2 } from '../test/fixtures/evacuationCenters';

const getAllCenters = vi.hoisted(() => vi.fn());
vi.mock('../lib/api', () => ({
  HazardAPI: {},
  EvacuationCenterAPI: { getAllCenters },
}));

describe('evacuation center map data', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({ evacuationCenters: [] });
  });

  it('loads centers through the real map helper and updates the store', async () => {
    getAllCenters.mockResolvedValue([ec1, ec2]);
    expect(await loadEvacuationCenters()).toEqual([ec1, ec2]);
    expect(useStore.getState().evacuationCenters).toEqual([ec1, ec2]);
  });

  it('escapes popup content', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('maps known center types', () => {
    expect(CENTER_TYPE_LABELS.school).toBe('School');
    expect(CENTER_TYPE_LABELS.unknown ?? 'Other').toBe('Other');
  });
});
