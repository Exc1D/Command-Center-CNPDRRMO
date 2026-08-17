import { beforeEach, describe, expect, it } from 'vitest';
import { createPlanningScenario } from './planning';
import { usePlanningStore } from './planningStore';

describe('planning editor store', () => {
  beforeEach(() => usePlanningStore.getState().newBoard());

  it('keeps the saved server version when undoing after a save', () => {
    const scenario = createPlanningScenario('Typhoon evacuation');
    usePlanningStore.getState().load(scenario);
    usePlanningStore.getState().edit(current => ({ ...current, notes: 'First change' }));
    usePlanningStore.getState().markSaved({ ...usePlanningStore.getState().history!.present, draftVersion: 4 });

    usePlanningStore.getState().undo();

    expect(usePlanningStore.getState().history!.present.draftVersion).toBe(4);
  });
});
