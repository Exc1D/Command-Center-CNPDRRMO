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

  it('does not mutate objects on a locked planning layer', () => {
    usePlanningStore.getState().edit(current => ({ ...current, layers: { ...current.layers, drawings: { ...current.layers.drawings, locked: true } } }));
    usePlanningStore.getState().addObject({ id: crypto.randomUUID(), kind: 'line', layer: 'drawings', coordinates: [[122.9, 14.1], [123, 14.1]], style: { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' }, locked: false, order: 0 });

    expect(usePlanningStore.getState().history!.present.objects).toEqual([]);
  });

  it('allows a locked object to be unlocked but not otherwise edited', () => {
    const object = { id: crypto.randomUUID(), kind: 'symbol' as const, layer: 'symbols' as const, coordinates: [[122.9, 14.1]] as [number, number][], style: { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' as const }, locked: true, order: 0, symbolKey: 'eoc' };
    usePlanningStore.getState().addObject(object);

    usePlanningStore.getState().updateObject(object.id, { label: 'Changed' });
    expect(usePlanningStore.getState().history!.present.objects[0].label).toBeUndefined();
    usePlanningStore.getState().updateObject(object.id, { locked: false });
    expect(usePlanningStore.getState().history!.present.objects[0].locked).toBe(false);
  });
});
