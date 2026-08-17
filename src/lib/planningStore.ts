import { create } from 'zustand';
import {
  createHistory,
  createPlanningScenario,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
  type PlanningObject,
  type PlanningRevision,
  type PlanningScenario,
  type PlanningStyle,
  DEFAULT_PLANNING_STYLE,
} from './planning';

export type PlanningTool = 'select' | 'box-select' | 'pan' | 'freehand' | 'line' | 'polygon' | 'rectangle' | 'circle' | 'text' | 'symbol' | 'eraser';

interface PlanningState {
  isPlanningMode: boolean;
  scenarios: Array<PlanningScenario & { publishedRevision?: number | null }>;
  publishedOverlays: PlanningRevision[];
  history: History<PlanningScenario> | null;
  dirty: boolean;
  temporary: boolean;
  tool: PlanningTool;
  style: PlanningStyle;
  smoothing: 'off' | 'low' | 'high';
  eraserSize: 'small' | 'medium' | 'large';
  selectedIds: string[];
  symbolKey: string;
  symbolSize: 'small' | 'medium' | 'large';
  sessionId: string;
  lockAcquired: boolean;
  message: string | null;
  enter: () => void;
  exit: () => void;
  setScenarios: (scenarios: Array<PlanningScenario & { publishedRevision?: number | null }>) => void;
  setPublishedOverlays: (revisions: PlanningRevision[]) => void;
  newBoard: () => void;
  load: (scenario: PlanningScenario, temporary?: boolean) => void;
  showPreview: (scenario: PlanningScenario) => void;
  edit: (change: (scenario: PlanningScenario) => PlanningScenario) => void;
  addObject: (object: PlanningObject) => void;
  updateObject: (id: string, change: Partial<PlanningObject>) => void;
  removeObjects: (ids: string[]) => void;
  setTool: (tool: PlanningTool) => void;
  setStyle: (style: Partial<PlanningStyle>) => void;
  setSmoothing: (smoothing: 'off' | 'low' | 'high') => void;
  setEraserSize: (eraserSize: 'small' | 'medium' | 'large') => void;
  select: (ids: string[]) => void;
  setSymbolKey: (symbolKey: string) => void;
  setSymbolSize: (symbolSize: 'small' | 'medium' | 'large') => void;
  undo: () => void;
  redo: () => void;
  markSaved: (scenario: PlanningScenario) => void;
  setLockAcquired: (lockAcquired: boolean) => void;
  setMessage: (message: string | null) => void;
}

export const usePlanningStore = create<PlanningState>((set) => ({
  isPlanningMode: false,
  scenarios: [],
  publishedOverlays: [],
  history: null,
  dirty: false,
  temporary: true,
  tool: 'select',
  style: DEFAULT_PLANNING_STYLE,
  smoothing: 'low',
  eraserSize: 'medium',
  selectedIds: [],
  symbolKey: 'evacuation-center',
  symbolSize: 'medium',
  sessionId: crypto.randomUUID(),
  lockAcquired: false,
  message: null,
  enter: () => set(state => ({ isPlanningMode: true, history: state.history ?? createHistory(createPlanningScenario('Untitled Plan')) })),
  exit: () => set({ isPlanningMode: false, tool: 'select', selectedIds: [], lockAcquired: false }),
  setScenarios: scenarios => set({ scenarios }),
  setPublishedOverlays: publishedOverlays => set({ publishedOverlays }),
  newBoard: () => set({ history: createHistory(createPlanningScenario('Untitled Plan')), dirty: false, temporary: true, selectedIds: [], tool: 'select', lockAcquired: false }),
  load: (scenario, temporary = false) => set({ history: createHistory(scenario), dirty: false, temporary, selectedIds: [], tool: 'select', lockAcquired: false }),
  showPreview: scenario => set(state => ({ history: state.history ? { ...state.history, present: scenario } : createHistory(scenario) })),
  edit: change => set(state => {
    if (!state.history) return state;
    return { history: pushHistory(state.history, change(structuredClone(state.history.present))), dirty: true };
  }),
  addObject: object => set(state => {
    if (!state.history) return state;
    const next = { ...state.history.present, objects: [...state.history.present.objects, object] };
    return { history: pushHistory(state.history, next), dirty: true, selectedIds: [object.id] };
  }),
  updateObject: (id, change) => set(state => {
    if (!state.history) return state;
    const next = { ...state.history.present, objects: state.history.present.objects.map(object => object.id === id ? { ...object, ...change } : object) };
    return { history: pushHistory(state.history, next), dirty: true };
  }),
  removeObjects: ids => set(state => {
    if (!state.history) return state;
    const selected = new Set(ids);
    const next = { ...state.history.present, objects: state.history.present.objects.filter(object => !selected.has(object.id) || object.locked) };
    return { history: pushHistory(state.history, next), dirty: true, selectedIds: [] };
  }),
  setTool: tool => set({ tool }),
  setStyle: style => set(state => ({ style: { ...state.style, ...style } })),
  setSmoothing: smoothing => set({ smoothing }),
  setEraserSize: eraserSize => set({ eraserSize }),
  select: selectedIds => set({ selectedIds }),
  setSymbolKey: symbolKey => set({ symbolKey, tool: 'symbol' }),
  setSymbolSize: symbolSize => set({ symbolSize }),
  undo: () => set(state => state.history?.past.length ? { history: undoHistory(state.history), dirty: true, selectedIds: [] } : state),
  redo: () => set(state => state.history?.future.length ? { history: redoHistory(state.history), dirty: true, selectedIds: [] } : state),
  markSaved: scenario => set(state => ({
    history: state.history ? {
      past: state.history.past.map(item => ({ ...item, draftVersion: scenario.draftVersion })),
      present: scenario,
      future: state.history.future.map(item => ({ ...item, draftVersion: scenario.draftVersion })),
    } : createHistory(scenario),
    dirty: false,
    temporary: false,
  })),
  setLockAcquired: lockAcquired => set({ lockAcquired }),
  setMessage: message => set({ message }),
}));
