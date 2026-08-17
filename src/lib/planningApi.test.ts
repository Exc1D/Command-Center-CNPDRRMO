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
    isAxiosError: vi.fn(() => true),
  },
}));

describe('PlanningAPI offline reconciliation', () => {
  beforeEach(async () => {
    await db.planningScenarios.clear();
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('keeps pending local drafts visible beside server scenarios', async () => {
    const server = { ...createPlanningScenario('Server plan'), draftVersion: 1 };
    const local = { ...createPlanningScenario('Offline plan'), syncStatus: 'pending_add' };
    await db.planningScenarios.put(local);
    vi.mocked(axios.get).mockResolvedValue({ data: [server] });

    const scenarios = await PlanningAPI.list();

    expect(scenarios.map(scenario => scenario.name)).toEqual(['Server plan', 'Offline plan']);
  });

  it('resolves a stale pending update after preserving one conflict copy', async () => {
    const stale = { ...createPlanningScenario('Stale plan'), draftVersion: 1, syncStatus: 'pending_update' };
    const current = { ...stale, notes: 'Server copy', draftVersion: 2 };
    await db.planningScenarios.put(stale);
    vi.mocked(axios.put).mockRejectedValue({ response: { status: 409, data: { current } } });
    vi.mocked(axios.post).mockImplementation(async (_url, scenario) => ({ data: { ...(scenario as object), draftVersion: 1 } }));

    const result = await PlanningAPI.save(stale, 'session');

    expect(result.conflicted).toBe(true);
    expect(await db.planningScenarios.get(stale.id)).toBeUndefined();
    expect((await db.planningScenarios.toArray()).filter(scenario => scenario.name.includes('offline conflict'))).toHaveLength(1);
  });
});
