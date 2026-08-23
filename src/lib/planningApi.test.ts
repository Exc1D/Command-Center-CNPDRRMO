import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { db } from './db';
import { createPlanningScenario } from './planning';
import { PlanningAPI } from './planningApi';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    isAxiosError: vi.fn((error: { isAxiosError?: boolean }) => Boolean(error?.isAxiosError)),
  },
}));

describe('PlanningAPI offline reconciliation', () => {
  beforeEach(async () => {
    await Promise.all([db.planningScenarios.clear(), db.planningTemplates.clear()]);
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('keeps pending local drafts visible beside server scenarios', async () => {
    const server = { ...createPlanningScenario('Server plan'), draftVersion: 1 };
    const local = { ...createPlanningScenario('Offline plan'), syncStatus: 'pending_add' };
    await db.planningScenarios.put(local);
    vi.mocked(axios.get).mockResolvedValue({ data: [server] });

    const scenarios = await PlanningAPI.list(true);

    expect(scenarios.map(scenario => scenario.name)).toEqual(['Server plan', 'Offline plan']);
  });

  it('does not expose cached drafts without authorization', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await db.planningScenarios.bulkPut([
      { ...createPlanningScenario('Restricted draft'), classification: 'Restricted', syncStatus: 'synced' },
      { ...createPlanningScenario('Published plan'), classification: 'Public', publishedRevision: 1, syncStatus: 'synced' },
    ]);

    expect((await PlanningAPI.list()).map(scenario => scenario.name)).toEqual(['Published plan']);
  });

  it('keeps restricted cached drafts hidden but intact during a public refresh', async () => {
    const restricted = { ...createPlanningScenario('Restricted draft'), classification: 'Restricted' as const, syncStatus: 'synced' };
    await db.planningScenarios.put(restricted);
    vi.mocked(axios.get).mockResolvedValue({ data: [] });

    expect(await PlanningAPI.list()).toEqual([]);
    expect(await db.planningScenarios.get(restricted.id)).toBeDefined();
  });

  it('queues retryable online deletes and rejects programming failures', async () => {
    const scenario = { ...createPlanningScenario('Delete me'), draftVersion: 1, syncStatus: 'synced' };
    await db.planningScenarios.put(scenario);
    vi.mocked(axios.delete).mockRejectedValueOnce(Object.assign(new Error('offline'), { isAxiosError: true }));
    await PlanningAPI.remove(scenario, 'session');
    expect((await db.planningScenarios.get(scenario.id))?.syncStatus).toBe('pending_delete');

    vi.mocked(axios.post).mockRejectedValueOnce(new Error('storage failed'));
    await expect(PlanningAPI.create(createPlanningScenario('Broken'))).rejects.toThrow('storage failed');
  });

  it('resolves a stale pending update after preserving one conflict copy', async () => {
    const stale = { ...createPlanningScenario('Stale plan'), draftVersion: 1, syncStatus: 'pending_update' };
    const current = { ...stale, notes: 'Server copy', draftVersion: 2 };
    await db.planningScenarios.put(stale);
    vi.mocked(axios.put).mockRejectedValue({ isAxiosError: true, response: { status: 409, data: { current } } });
    vi.mocked(axios.post).mockImplementation(async (_url, scenario) => ({ data: { ...(scenario as object), draftVersion: 1 } }));

    const result = await PlanningAPI.save(stale, 'session');

    expect(result.conflicted).toBe(true);
    expect(await db.planningScenarios.get(stale.id)).toBeUndefined();
    expect((await db.planningScenarios.toArray()).filter(scenario => scenario.name.includes('offline conflict'))).toHaveLength(1);
  });
});
