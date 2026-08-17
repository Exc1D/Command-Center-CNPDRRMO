import { describe, expect, it } from 'vitest';
import { circleInsideProvince, createHistory, createPlanningScenario, eraseStroke, exportScenario, formatMeasurement, getSymbolTotals, importPlanningFile, importScenario, pathInsideProvince, planningScenarioSchema, pushHistory, smoothStroke, undoHistory, validateForPublish } from './planning';

describe('planning documents', () => {
  it('creates a blank draft with the fixed planning layers', () => {
    const scenario = createPlanningScenario('Typhoon evacuation');

    expect(scenario.name).toBe('Typhoon evacuation');
    expect(scenario.objects).toEqual([]);
    expect(scenario.layers).toEqual({
      drawings: { visible: true, locked: false },
      symbols: { visible: true, locked: false },
      labels: { visible: true, locked: false },
    });
  });

  it('undoes the most recent completed action', () => {
    const initial = createPlanningScenario('Typhoon evacuation');
    const changed = { ...initial, notes: 'Close the coastal road' };
    const history = pushHistory(createHistory(initial), changed);

    expect(undoHistory(history).present.notes).toBe('');
  });

  it('smooths freehand input without moving its endpoints', () => {
    const points: [number, number][] = [
      [122.95, 14.1],
      [122.95001, 14.10002],
      [122.95002, 14.09998],
      [122.95003, 14.1],
      [122.951, 14.101],
    ];

    const smoothed = smoothStroke(points, 'low');

    expect(smoothed[0]).toEqual(points[0]);
    expect(smoothed.at(-1)).toEqual(points.at(-1));
    expect(smoothed.length).toBeLessThan(points.length);
  });

  it('partially erases a freehand stroke into separate strokes', () => {
    const stroke: [number, number][] = [
      [122.95, 14.1],
      [122.9501, 14.1],
      [122.9502, 14.1],
      [122.9503, 14.1],
      [122.9504, 14.1],
    ];

    const parts = eraseStroke(stroke, [[122.9502, 14.1]], 5);

    expect(parts).toHaveLength(2);
    expect(parts.flat()).not.toContainEqual([122.9502, 14.1]);
  });

  it('erases through a long smoothed segment even when its endpoints miss the eraser', () => {
    const parts = eraseStroke([[122.95, 14.1], [122.952, 14.1]], [[122.951, 14.1]], 10);

    expect(parts).toHaveLength(2);
  });

  it('rejects a route that leaves the province between valid endpoints', () => {
    const province = {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
        { type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [[[2, 0], [3, 0], [3, 1], [2, 1], [2, 0]]] } },
      ],
    };

    expect(pathInsideProvince([[0.5, 0.5], [2.5, 0.5]], province)).toBe(false);
  });

  it('rejects a circle whose edge crosses the province boundary', () => {
    const province = {
      features: [{ geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }],
    };

    expect(circleInsideProvince([0.5, 0.5], 10_000, province)).toBe(true);
    expect(circleInsideProvince([0.95, 0.5], 10_000, province)).toBe(false);
  });

  it('formats line distance and polygon area for map measurements', () => {
    const scenario = createPlanningScenario('Measurements');
    const style = scenario.objects[0]?.style ?? { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' as const };

    expect(formatMeasurement({ id: crypto.randomUUID(), kind: 'line', layer: 'drawings', coordinates: [[0, 0], [0.01, 0]], style, locked: false, order: 0 })).toMatch(/km$/);
    expect(formatMeasurement({ id: crypto.randomUUID(), kind: 'polygon', layer: 'drawings', coordinates: [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]], style, locked: false, order: 0 })).toMatch(/km²$/);
  });

  it('aggregates placed symbol quantities for the legend', () => {
    const scenario = createPlanningScenario('Typhoon evacuation');
    scenario.objects = [
      { id: crypto.randomUUID(), kind: 'symbol', layer: 'symbols', coordinates: [[122.95, 14.1]], style: { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' }, locked: false, order: 0, symbolKey: 'ambulance', quantity: 2 },
      { id: crypto.randomUUID(), kind: 'symbol', layer: 'symbols', coordinates: [[122.96, 14.1]], style: { color: '#00ff00', width: 3, fillOpacity: 0.2, lineStyle: 'solid' }, locked: false, order: 1, symbolKey: 'ambulance', quantity: 3 },
    ];

    expect(getSymbolTotals(scenario.objects)).toEqual([{ symbolKey: 'ambulance', quantity: 5 }]);
  });

  it('imports a native export as a new draft', () => {
    const original = createPlanningScenario('Typhoon evacuation');
    original.notes = 'Move residents before landfall';

    const imported = importScenario(exportScenario(original, []));

    expect(imported.id).not.toBe(original.id);
    expect(imported.name).toBe(original.name);
    expect(imported.notes).toBe(original.notes);
    expect(imported.draftVersion).toBe(0);
  });

  it('round-trips bundled symbol templates', () => {
    const template = { id: crypto.randomUUID(), name: 'EOC team', symbolKey: 'eoc', color: '#ff0000', size: 'large' as const, updatedAt: new Date().toISOString() };

    expect(importPlanningFile(exportScenario(createPlanningScenario('Plan'), [template])).templates).toEqual([template]);
  });

  it('blocks publication of an empty scenario', () => {
    const result = validateForPublish(createPlanningScenario('Typhoon evacuation'));

    expect(result.errors).toContain('Add at least one planning object');
  });

  it('rejects planning objects that cannot be rendered safely', () => {
    const scenario = createPlanningScenario('Broken import');
    scenario.objects = [{ id: crypto.randomUUID(), kind: 'circle', layer: 'drawings', coordinates: [], style: { color: '#ff0000', width: 3, fillOpacity: 0.2, lineStyle: 'solid' }, locked: false, order: 0 }];

    expect(planningScenarioSchema.safeParse(scenario).success).toBe(false);
  });
});
