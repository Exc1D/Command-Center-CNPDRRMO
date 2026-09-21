import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  BoxSelect,
  CheckCircle2,
  Circle,
  ChevronRight,
  Download,
  Eraser,
  FileImage,
  FileText,
  Hand,
  Import,
  Lock,
  Layers3,
  MapPin,
  MousePointer2,
  Pencil,
  Pentagon,
  Redo2,
  Save,
  Search,
  Send,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { PlanningAPI } from '../lib/planningApi';
import {
  exportScenario,
  getSymbolTotals,
  importPlanningFile,
  PLANNING_SYMBOLS,
  validateForPublish,
  type PlanningLayer,
  type PlanningObject,
  type PlanningScenario,
  type PlanningTemplate,
  type ProvinceGeoJSON,
} from '../lib/planning';
import { canApplyPlanningHistory, usePlanningStore, type PlanningTool } from '../lib/planningStore';
import { DISASTER_TYPES, SUSCEPTIBILITY_LEVELS, useStore } from '../lib/store';
import { MAP_CONFIG } from '../lib/constants';
import { getPlanningSymbolIcon } from '../lib/planningIcons';
import barangaysData from '../lib/barangays.json';
import provinceBoundaryUrl from '../../Municipal Boundary.geojson?url';

const MUNICIPALITIES = Object.entries(barangaysData).map(([name, raw]) => {
  const barangays = (raw as { barangays: Array<{ name: string; lat: number; lng: number }> }).barangays;
  return {
    name,
    barangays,
    center: [barangays.reduce((sum, item) => sum + item.lat, 0) / barangays.length, barangays.reduce((sum, item) => sum + item.lng, 0) / barangays.length] as [number, number],
  };
});

const TOOL_BUTTONS: Array<{ tool: PlanningTool; label: string; shortcut: string; icon: typeof MousePointer2 }> = [
  { tool: 'select', label: 'Select', shortcut: 'V', icon: MousePointer2 },
  { tool: 'box-select', label: 'Box select', shortcut: 'B', icon: BoxSelect },
  { tool: 'pan', label: 'Pan', shortcut: 'H', icon: Hand },
  { tool: 'freehand', label: 'Freehand', shortcut: 'P', icon: Pencil },
  { tool: 'line', label: 'Route / line', shortcut: 'L', icon: Send },
  { tool: 'polygon', label: 'Polygon', shortcut: 'G', icon: Pentagon },
  { tool: 'rectangle', label: 'Rectangle', shortcut: 'R', icon: Square },
  { tool: 'circle', label: 'Circle', shortcut: 'C', icon: Circle },
  { tool: 'text', label: 'Text', shortcut: 'T', icon: Type },
  { tool: 'symbol', label: 'Symbol', shortcut: 'I', icon: MapPin },
  { tool: 'eraser', label: 'Eraser', shortcut: 'E', icon: Eraser },
];

const PRIMARY_TOOL_BUTTONS = [
  { tool: 'select', label: 'Select', description: 'Move or edit', icon: MousePointer2 },
  { tool: 'line', label: 'Draw', description: 'Routes and areas', icon: Pencil },
  { tool: 'symbol', label: 'Symbol', description: 'People and resources', icon: MapPin },
  { tool: 'text', label: 'Note', description: 'Add map text', icon: Type },
] as const;

const DRAW_TOOLS = TOOL_BUTTONS.filter(item => ['freehand', 'line', 'polygon', 'rectangle', 'circle', 'eraser'].includes(item.tool));
const DRAW_TOOL_SET = new Set<PlanningTool>(DRAW_TOOLS.map(item => item.tool));

function localDateTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function refreshScenarios() {
  usePlanningStore.getState().setScenarios(await PlanningAPI.list(useStore.getState().isMapAuthorized));
}

export async function saveCurrentPlanningScenario() {
  const state = usePlanningStore.getState();
  const scenario = state.history?.present;
  if (!scenario) return;
  if (!scenario.name.trim()) {
    state.setMessage('Scenario name is required');
    return;
  }
  if (navigator.onLine && !state.temporary && !state.lockAcquired) return state.setMessage('Acquire the editing lock before saving');
  try {
  const operational = useStore.getState();
  const document = { ...scenario, mapState: {
      center: operational.mapCenter,
      zoom: operational.mapZoom,
      baseMap: operational.baseMap,
      activeFilters: operational.activeFilters,
      susceptibilityFilters: operational.activeSusceptibilityFilters,
    evacuationCentersVisible: operational.evacuationCentersVisible,
  } };
    state.setMessage('Saving plan...');
    const result = state.temporary
      ? { scenario: await PlanningAPI.create(document), conflicted: false }
      : await PlanningAPI.save(document, state.sessionId);
    state.markSaved(result.scenario);
    state.setMessage(result.conflicted ? 'Conflict preserved as a separate draft' : 'Scenario saved');
    if (navigator.onLine) {
      try {
        await PlanningAPI.acquireLock(result.scenario.id, state.sessionId);
        state.setLockAcquired(true);
      } catch {
        state.setLockAcquired(false);
      }
    }
    await refreshScenarios();
  } catch (error) {
    state.setMessage(error instanceof Error ? error.message : 'Could not save scenario');
  }
}

function download(name: string, blob: Blob) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function exportMap(scenario: PlanningScenario, type: 'png' | 'pdf') {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
  const map = document.querySelector('.leaflet-container') as HTMLElement | null;
  if (!map) return;
  const canvas = await html2canvas(map, { useCORS: true, scale: 2 });
  const safeName = scenario.name.replace(/[^a-z0-9-_]+/gi, '-');
  if (type === 'png') {
    canvas.toBlob(blob => blob && download(`${safeName}.png`, blob), 'image/png');
    return;
  }
  const pdf = new jsPDF('landscape', 'mm', 'a4');
  const totals = getSymbolTotals(scenario.objects);
  pdf.setFontSize(16);
  pdf.text(scenario.name, 10, 10);
  pdf.setFontSize(8);
  const validity = scenario.validFrom || scenario.validUntil ? `Valid: ${scenario.validFrom ?? '—'} to ${scenario.validUntil ?? '—'}` : 'No validity period';
  pdf.text(`${validity}  •  Generated ${format(new Date(), 'yyyy-MM-dd HH:mm')}  •  ${scenario.classification ?? 'Unclassified'}`, 10, 15);
  pdf.text('N ↑', 278, 15);
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 20, 277, 165);
  pdf.setFontSize(7);
  pdf.text(`Legend: ${totals.map(total => `${PLANNING_SYMBOLS.find(symbol => symbol.key === total.symbolKey)?.label ?? total.symbolKey} × ${total.quantity}`).join('  •  ') || 'Labeled objects appear on the map'}  •  Scale shown on map`, 10, 192, { maxWidth: 277 });
  pdf.save(`${safeName}.pdf`);
}

export function PlanningSidebar() {
  const planning = usePlanningStore();
  const operational = useStore();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'archived'>('draft');
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolCategory, setSymbolCategory] = useState('Life Safety');
  const [selectedMunicipality, setSelectedMunicipality] = useState('ALL');
  const [sidebarTab, setSidebarTab] = useState<'brief' | 'map' | 'review'>('brief');
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [templates, setTemplates] = useState<PlanningTemplate[]>([]);
  const [province, setProvince] = useState<ProvinceGeoJSON | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const scenario = planning.history?.present;
  const symbolCategories = [...new Set(PLANNING_SYMBOLS.map(symbol => symbol.category))];
  const filteredSymbols = PLANNING_SYMBOLS.filter(symbol => {
    const matchesSearch = `${symbol.label} ${symbol.category}`.toLowerCase().includes(symbolQuery.toLowerCase());
    return matchesSearch && (symbolQuery.trim() || symbol.category === symbolCategory);
  });

  useEffect(() => {
    refreshScenarios().catch(() => planning.setMessage('Saved plans could not be loaded')).finally(() => setLoadingPlans(false));
    PlanningAPI.templates(operational.isMapAuthorized).then(setTemplates).catch(() => planning.setMessage('Shared templates could not be loaded'));
    fetch(provinceBoundaryUrl).then(response => response.json()).then(setProvince).catch(() => planning.setMessage('Province boundary could not be loaded'));
  }, [operational.isMapAuthorized]);

  const scenarios = planning.scenarios.filter(item => {
    const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase());
    if (status === 'archived') return matchesQuery && Boolean(item.archivedAt);
    if (status === 'published') return matchesQuery && !item.archivedAt && Boolean(item.publishedRevision);
    return matchesQuery && !item.archivedAt && !item.publishedRevision;
  });
  const recentPlans = planning.scenarios.filter(item => !item.archivedAt).slice(0, 3);

  const openScenario = async (next: PlanningScenario) => {
    if (planning.dirty && !confirm('Discard unsaved changes?')) return;
    planning.load(next);
    setSidebarTab('brief');
    operational.applyPlanningMapState(next.mapState);
    if (operational.isMapAuthorized && navigator.onLine) {
      try {
        await PlanningAPI.acquireLock(next.id, planning.sessionId);
        planning.setLockAcquired(true);
      } catch (error) {
        const locked = (error as { response?: { status?: number } }).response?.status === 409;
        if (locked && confirm('Another planner holds this edit lock. Force unlock it?')) {
          try { await PlanningAPI.acquireLock(next.id, planning.sessionId, true); planning.setLockAcquired(true); }
          catch { planning.setMessage('Could not take over the edit lock'); }
        } else planning.setMessage(locked ? 'Opened read-only with the live preview' : 'Opened offline without an edit lock');
      }
    }
  };

  const updateMetadata = (change: Partial<PlanningScenario>) => planning.edit(current => ({ ...current, ...change }));
  const canEdit = operational.isMapAuthorized && (planning.temporary || planning.lockAcquired || !navigator.onLine);

  if (!scenario) return <aside className="planning-sidebar w-[420px] h-full bg-surface-container-low flex flex-col z-[55] border-r border-outline-variant/40">
    <div className="p-7 border-b border-outline-variant/35">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-planning mb-2">Operational planning</p>
      <h2 className="text-2xl font-display font-extrabold tracking-tight">Make the next decision clear</h2>
      <p className="text-sm leading-relaxed text-on-surface/65 mt-3">Define the objective, map assignments and resources, then review the plan before it reaches the operational map.</p>
    </div>
    <div className="flex-1 overflow-y-auto p-7 custom-scrollbar">
      {!operational.isMapAuthorized && <button onClick={() => operational.openPinModal('unlock')} className="w-full min-h-14 px-4 rounded-xl bg-planning-container text-on-planning-container text-sm font-bold mb-5">Enter operations PIN to edit plans</button>}
      {recentPlans[0] && <button onClick={() => openScenario(recentPlans[0])} className="w-full min-h-20 p-4 text-left rounded-xl bg-planning text-on-planning mb-3">
        <span className="block text-xs font-bold opacity-80 mb-1">Resume active plan</span>
        <span className="block text-base font-extrabold truncate">{recentPlans[0].name}</span>
        <span className="block text-xs opacity-75 mt-1">Updated {format(new Date(recentPlans[0].updatedAt), 'MMM d, HH:mm')}</span>
      </button>}
      <button disabled={!operational.isMapAuthorized} onClick={planning.newBoard} className="w-full min-h-14 px-4 rounded-xl border border-outline-variant/60 bg-surface-container-lowest text-sm font-bold disabled:opacity-45">
        {recentPlans.length ? 'Create a new operational plan' : 'Create the first operational plan'}
      </button>

      <div className="mt-8 border-t border-outline-variant/40">
        {[['1', 'Define the brief', 'Objective, operational period, and information classification'], ['2', 'Map the response', 'Assignments, routes, facilities, and resources'], ['3', 'Review and publish', 'Resolve missing decisions and approve the saved plan']].map(([number, title, body]) => <div key={number} className="flex gap-4 py-4 border-b border-outline-variant/35">
          <span className="w-9 h-9 shrink-0 grid place-items-center rounded-full bg-surface-container text-sm font-extrabold">{number}</span>
          <div><h3 className="text-sm font-bold">{title}</h3><p className="text-xs leading-relaxed text-on-surface/55 mt-1">{body}</p></div>
        </div>)}
      </div>

      <div className="mt-7">
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">Recent plans</h3><span className="text-xs text-on-surface/50">{planning.scenarios.length}</span></div>
        {loadingPlans && <p className="text-xs text-on-surface/55 py-4">Loading plan register...</p>}
        {!loadingPlans && recentPlans.length === 0 && <p className="text-xs text-on-surface/55 py-4">No saved plans yet. Create one to begin the planning cycle.</p>}
        <div className="space-y-2">{recentPlans.slice(1).map(item => <button key={item.id} onClick={() => openScenario(item)} className="w-full min-h-14 px-3 py-2 text-left rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
          <span className="block text-sm font-bold truncate">{item.name}</span><span className="text-[11px] text-on-surface/55">Draft version {item.draftVersion}</span>
        </button>)}</div>
      </div>
    </div>
  </aside>;

  const validation = validateForPublish(scenario);
  const unlabeledObjects = scenario.objects.filter(object => object.kind !== 'text' && !object.label?.trim()).length;
  const resourceTotal = getSymbolTotals(scenario.objects).reduce((total, item) => total + item.quantity, 0);
  const readiness = [
    { label: 'Plan has a specific name', complete: Boolean(scenario.name.trim() && scenario.name !== 'Untitled Plan') },
    { label: 'Operational objective is stated', complete: Boolean(scenario.notes.trim()) },
    { label: 'Operational period is set', complete: Boolean(scenario.validFrom && scenario.validUntil) },
    { label: 'Assignments or resources are mapped', complete: scenario.objects.length > 0 },
    { label: 'Information classification is chosen', complete: Boolean(scenario.classification) },
  ];
  const selectedSymbol = PLANNING_SYMBOLS.find(symbol => symbol.key === planning.symbolKey);
  const canPublish = !planning.temporary && canEdit && navigator.onLine && !planning.dirty && validation.errors.length === 0;
  const publishBlockers = [
    ...(!operational.isMapAuthorized ? ['Enter the operations PIN to edit this plan'] : []),
    ...(operational.isMapAuthorized && !planning.temporary && !planning.lockAcquired && navigator.onLine ? ['Acquire the editing lock before publishing'] : []),
    ...(!navigator.onLine ? ['Reconnect before publishing'] : []),
    ...(planning.dirty ? ['Save the latest changes before publishing'] : []),
    ...validation.errors,
  ];

  const publish = async () => {
    if (!canPublish || publishing) return;
    if (validation.warnings.length && !confirm(`${validation.warnings.join('. ')}. Publish anyway?`)) return;
    setPublishing(true);
    try {
      const published = await PlanningAPI.publish(scenario.id, planning.sessionId);
      planning.setMessage(`Revision ${published.revision} published. The approved plan is available on the operational map.`);
      await refreshScenarios();
    } catch (error) {
      planning.setMessage(error instanceof Error ? error.message : 'The plan could not be published');
    } finally { setPublishing(false); }
  };

  return (
    <aside className="planning-sidebar w-[392px] h-full bg-surface-container-low flex flex-col z-[55] border-r border-outline-variant/40">
      <div className="p-5 pb-4 border-b border-outline-variant/35">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-planning mb-1">Operational plan</p>
            <h2 className="text-xl font-display font-extrabold tracking-tight truncate max-w-56">{scenario.name || 'Untitled Plan'}</h2>
            <p className="text-xs text-on-surface/55 mt-1">{planning.dirty ? 'Changes need saving' : planning.temporary ? 'New plan, not saved yet' : canEdit ? `Draft version ${scenario.draftVersion}, ready to edit` : 'Live view, another operator may be editing'}</p>
          </div>
          <button className="h-12 px-4 border border-outline-variant/50 bg-surface-container-lowest rounded-xl text-sm font-bold shrink-0" onClick={() => {
            if (!planning.dirty || confirm('Discard unsaved changes?')) { planning.newBoard(); setSidebarTab('brief'); }
          }}>New</button>
        </div>

        {!operational.isMapAuthorized && <button onClick={() => operational.openPinModal('unlock')} className="w-full min-h-12 px-4 rounded-xl bg-planning-container text-on-planning-container text-sm font-bold mb-3">Enter operations PIN to edit this plan</button>}

        <div className="grid grid-cols-3 gap-1.5 mt-4" role="tablist" aria-label="Planning panel">
          {([['brief', '1 Brief'], ['map', '2 Map'], ['review', '3 Review']] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={sidebarTab === tab} onClick={() => setSidebarTab(tab)} className={`h-11 rounded-lg text-xs font-bold transition-colors ${sidebarTab === tab ? 'bg-on-surface text-surface-container-lowest' : 'bg-surface-container text-on-surface/70 hover:bg-surface-container-high'}`}>{label}</button>)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
        {sidebarTab === 'brief' && <div className="space-y-5">
          <section>
            <h3 className="text-base font-bold">Define the decision</h3>
            <p className="text-xs leading-relaxed text-on-surface/55 mt-1 mb-4">State what the team must achieve and when this plan applies.</p>
            <label className="block text-xs font-semibold mb-4" htmlFor="scenario-name">Plan name<input id="scenario-name" disabled={!canEdit} value={scenario.name} maxLength={120} onChange={event => updateMetadata({ name: event.target.value })} className="mt-1.5 w-full h-12 bg-surface-container-lowest border border-outline-variant/50 px-3 rounded-xl text-base font-semibold" placeholder="Example: Pre-emptive evacuation, District 2" /></label>
            <label className="block text-xs font-semibold mb-4">Operational objective<textarea disabled={!canEdit} value={scenario.notes} maxLength={4000} onChange={event => updateMetadata({ notes: event.target.value })} className="mt-1.5 w-full bg-surface-container-lowest border border-outline-variant/45 p-3 rounded-xl text-sm resize-none font-normal" rows={4} placeholder="What must be achieved, for whom, and under what conditions?" /></label>
            <label className="block text-xs font-semibold mb-4">Starts<input disabled={!canEdit} aria-label="Valid from" type="datetime-local" value={localDateTime(scenario.validFrom)} onChange={event => updateMetadata({ validFrom: event.target.value ? new Date(event.target.value).toISOString() : undefined })} className="mt-1.5 w-full h-12 bg-surface-container-lowest border border-outline-variant/45 px-3 rounded-xl text-sm font-normal" /></label>
            <label className="block text-xs font-semibold mb-4">Ends<input disabled={!canEdit} aria-label="Valid until" type="datetime-local" value={localDateTime(scenario.validUntil)} onChange={event => updateMetadata({ validUntil: event.target.value ? new Date(event.target.value).toISOString() : undefined })} className="mt-1.5 w-full h-12 bg-surface-container-lowest border border-outline-variant/45 px-3 rounded-xl text-sm font-normal" /></label>
            <label className="block text-xs font-semibold">Information classification<select disabled={!canEdit} aria-label="Classification" value={scenario.classification ?? ''} onChange={event => updateMetadata({ classification: event.target.value ? event.target.value as PlanningScenario['classification'] : undefined })} className="mt-1.5 w-full h-12 bg-surface-container-lowest border border-outline-variant/45 px-3 rounded-xl text-sm font-normal">
              <option value="">Choose classification</option><option>Internal</option><option>Restricted</option><option>Public</option>
            </select></label>
          </section>

          <details className="border-t border-outline-variant/35 pt-3">
            <summary className="min-h-12 flex items-center justify-between text-sm font-bold cursor-pointer">Open another plan <ChevronRight size={17} /></summary>
            <div className="pt-2">
              <div className="relative mb-3"><Search size={17} className="absolute left-3 top-3.5 text-on-surface/40" /><input aria-label="Search scenarios" value={query} onChange={event => setQuery(event.target.value)} className="w-full h-12 pl-10 pr-3 rounded-xl border border-outline-variant/45 bg-surface-container-lowest text-sm" placeholder="Search plans" /></div>
              <div className="grid grid-cols-3 gap-1.5 mb-3">{(['draft', 'published', 'archived'] as const).map(item => <button key={item} onClick={() => setStatus(item)} className={`h-11 rounded-lg text-[11px] capitalize font-bold ${status === item ? 'bg-on-surface text-surface-container-lowest' : 'bg-surface-container-lowest text-on-surface/65'}`}>{item}</button>)}</div>
              <div className="max-h-52 overflow-y-auto space-y-2">{scenarios.length === 0 && <p className="py-5 text-center text-xs text-on-surface/50">No plans in this view</p>}{scenarios.map(item => <button key={item.id} onClick={() => openScenario(item)} className={`w-full min-h-14 text-left px-3 py-2 rounded-xl border text-sm ${item.id === scenario.id && !planning.temporary ? 'border-planning bg-planning-container text-on-planning-container font-bold' : 'border-outline-variant/35 bg-surface-container-lowest'}`}><span className="block truncate">{item.name}</span><span className="text-[11px] opacity-60">Draft {item.draftVersion}{item.publishedRevision ? `, published ${item.publishedRevision}` : ''}</span></button>)}</div>
            </div>
          </details>
        </div>}

        {sidebarTab === 'map' && <div className="space-y-6">
          <section>
            <h3 className="text-base font-bold">Map assignments and resources</h3>
            <p className="text-xs leading-relaxed text-on-surface/55 mt-1">Use the four map modes below. Label each placement with its owner, action, or purpose.</p>
            <div className="mt-4 min-h-12 px-3 rounded-xl bg-planning-container text-on-planning-container flex items-center gap-3"><MapPin size={18} /><div><span className="block text-[11px] font-bold">Selected symbol</span><span className="block text-sm font-semibold">{selectedSymbol?.label}</span></div></div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">Resource and facility symbols</h3><span className="text-xs text-on-surface/50">{filteredSymbols.length}</span></div>
            <div className="relative mb-3"><Search size={17} className="absolute left-3 top-3.5 text-on-surface/40" /><input aria-label="Search DRRM symbols" value={symbolQuery} onChange={event => setSymbolQuery(event.target.value)} className="w-full h-12 bg-surface-container-lowest border border-outline-variant/45 pl-10 pr-3 rounded-xl text-sm" placeholder="Search all symbols" /></div>
            {!symbolQuery.trim() && <select aria-label="Symbol category" value={symbolCategory} onChange={event => setSymbolCategory(event.target.value)} className="w-full h-12 mb-3 bg-surface-container-lowest border border-outline-variant/45 px-3 rounded-xl text-sm">{symbolCategories.map(category => <option key={category}>{category}</option>)}</select>}
            <div className="grid grid-cols-2 gap-2">{filteredSymbols.map(symbol => {
              const Icon = getPlanningSymbolIcon(symbol.key);
              const selected = planning.symbolKey === symbol.key;
              return <button key={symbol.key} aria-pressed={selected} onClick={() => planning.setSymbolKey(symbol.key)} className={`min-h-[68px] px-3 rounded-xl border flex items-center gap-3 text-left transition-colors ${selected ? 'border-planning bg-planning text-on-planning' : 'border-outline-variant/55 bg-surface-container-lowest hover:bg-surface-container'}`}><Icon size={24} strokeWidth={2.1} className="shrink-0" /><span className="text-xs font-bold leading-tight">{symbol.label}</span></button>;
            })}</div>
            {filteredSymbols.length === 0 && <p className="py-5 text-center text-xs text-on-surface/55">No symbols match that search.</p>}
            <div className="grid grid-cols-[1fr_auto] gap-2 mt-4"><select aria-label="Symbol size" value={planning.symbolSize} onChange={event => planning.setSymbolSize(event.target.value as typeof planning.symbolSize)} className="h-12 bg-surface-container-lowest border border-outline-variant/45 px-3 rounded-xl text-sm capitalize"><option>small</option><option>medium</option><option>large</option></select><button disabled={!operational.isMapAuthorized} onClick={async () => {
              const name = prompt('Template name');
              if (!name?.trim()) return;
              const template: PlanningTemplate = { id: crypto.randomUUID(), name: name.trim(), symbolKey: planning.symbolKey, color: planning.style.color, size: planning.symbolSize, updatedAt: new Date().toISOString() };
              try { await PlanningAPI.saveTemplate(template); setTemplates(await PlanningAPI.templates(true)); } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'Could not save template'); }
            }} className="h-12 px-4 bg-surface-container-lowest border border-outline-variant/45 rounded-xl text-xs font-bold disabled:opacity-40">Save template</button></div>
            {templates.length > 0 && <details className="mt-3"><summary className="min-h-11 flex items-center text-xs font-bold cursor-pointer">Shared symbol templates</summary><div className="space-y-2 mt-2">{templates.map(template => <div key={template.id} className="flex gap-2"><button onClick={() => { planning.setStyle({ color: template.color }); planning.setSymbolSize(template.size); planning.setSymbolKey(template.symbolKey); }} className="flex-1 min-h-11 px-3 bg-surface-container-lowest rounded-lg text-xs text-left truncate">{template.name}</button><button aria-label={`Delete ${template.name}`} disabled={!operational.isMapAuthorized} onClick={async () => { if (!confirm(`Delete template “${template.name}”?`)) return; try { await PlanningAPI.deleteTemplate(template.id); setTemplates(await PlanningAPI.templates(true)); } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'Could not delete template'); } }} className="w-11 h-11 grid place-items-center bg-error-container rounded-lg disabled:opacity-40"><X size={16} /></button></div>)}</div></details>}
          </section>

          <details className="border-t border-outline-variant/35 pt-3">
            <summary className="min-h-12 flex items-center justify-between text-sm font-bold cursor-pointer"><span className="flex items-center gap-2"><Layers3 size={17} /> Map reference and layers</span><ChevronRight size={17} /></summary>
            <div className="pt-3 space-y-4">
              <select aria-label="Municipality" value={selectedMunicipality} onChange={event => { const value = event.target.value; setSelectedMunicipality(value); const municipality = MUNICIPALITIES.find(item => item.name === value); operational.flyTo(municipality?.center ?? MAP_CONFIG.PROVINCE_CENTER, municipality ? MAP_CONFIG.MUNICIPALITY_ZOOM : MAP_CONFIG.DEFAULT_ZOOM); }} className="w-full h-12 bg-surface-container-lowest border border-outline-variant/45 px-3 rounded-xl text-sm"><option value="ALL">Province overview</option>{MUNICIPALITIES.map(item => <option key={item.name}>{item.name}</option>)}</select>
              {selectedMunicipality !== 'ALL' && <select aria-label="Barangay" onChange={event => { const barangay = MUNICIPALITIES.find(item => item.name === selectedMunicipality)?.barangays.find(item => item.name === event.target.value); if (barangay) operational.flyTo([barangay.lat, barangay.lng], MAP_CONFIG.BARANGAY_ZOOM); }} className="w-full h-12 bg-surface-container-lowest border border-outline-variant/45 px-3 rounded-xl text-sm"><option>All barangays</option>{MUNICIPALITIES.find(item => item.name === selectedMunicipality)?.barangays.map(item => <option key={item.name}>{item.name}</option>)}</select>}
              <div className="grid grid-cols-3 gap-2">{(['street', 'topo', 'satellite'] as const).map(base => <button key={base} onClick={() => operational.setBaseMap(base)} className={`h-11 rounded-lg text-xs capitalize font-bold ${operational.baseMap === base ? 'bg-tertiary text-on-tertiary' : 'bg-surface-container-lowest border border-outline-variant/40'}`}>{base}</button>)}</div>
              <div className="space-y-2">{(Object.keys(scenario.layers) as PlanningLayer[]).map(layer => <div key={layer} className="min-h-14 flex items-center gap-3 bg-surface-container-lowest border border-outline-variant/35 rounded-xl px-3 text-sm"><input className="w-5 h-5" disabled={!canEdit} aria-label={`Show ${layer}`} type="checkbox" checked={scenario.layers[layer].visible} onChange={event => planning.edit(current => ({ ...current, layers: { ...current.layers, [layer]: { ...current.layers[layer], visible: event.target.checked } } }))} /><span className="flex-1 capitalize font-semibold">{layer}</span><label className="min-h-11 flex items-center gap-2 px-2 text-xs"><input className="w-5 h-5" disabled={!canEdit} aria-label={`Lock ${layer}`} type="checkbox" checked={scenario.layers[layer].locked} onChange={event => planning.edit(current => ({ ...current, layers: { ...current.layers, [layer]: { ...current.layers[layer], locked: event.target.checked } } }))} /><Lock size={15} /> Lock</label></div>)}</div>
              <div className="space-y-1">{DISASTER_TYPES.map(type => <label key={type.id} className="min-h-11 flex items-center gap-3 text-sm px-2 rounded-lg hover:bg-surface-container-lowest"><input className="w-5 h-5" type="checkbox" checked={operational.activeFilters.includes(type.id)} onChange={() => operational.toggleFilter(type.id)} />{type.label}</label>)}{operational.activeFilters.includes('flood') && SUSCEPTIBILITY_LEVELS.map(level => <label key={level.id} className="min-h-11 flex items-center gap-3 text-sm px-6 rounded-lg hover:bg-surface-container-lowest"><input className="w-5 h-5" type="checkbox" checked={operational.activeSusceptibilityFilters.includes(level.id)} onChange={() => operational.toggleSusceptibilityFilter(level.id)} />{level.label}</label>)}<label className="min-h-11 flex items-center gap-3 text-sm px-2 rounded-lg hover:bg-surface-container-lowest"><input className="w-5 h-5" type="checkbox" checked={operational.evacuationCentersVisible} onChange={operational.toggleEvacuationCenters} />Evacuation centers</label></div>
            </div>
          </details>
        </div>}

        {sidebarTab === 'review' && <div className="space-y-6">
          <section>
            <h3 className="text-base font-bold">Publication readiness</h3>
            <p className="text-xs leading-relaxed text-on-surface/55 mt-1 mb-4">Confirm the plan tells the operational team what to do, where, and for how long.</p>
            <div className="divide-y divide-outline-variant/35 border-y border-outline-variant/35">{readiness.map(item => <div key={item.label} className="min-h-12 flex items-center gap-3 py-2 text-sm"><CheckCircle2 size={20} className={item.complete ? 'text-success' : 'text-on-surface/25'} /><span className={item.complete ? 'font-semibold' : 'text-on-surface/55'}>{item.label}</span></div>)}</div>
            {publishBlockers.length > 0 && <div className="mt-4 p-3 rounded-xl bg-planning-container text-on-planning-container"><p className="text-xs font-bold mb-1">Complete before publishing</p><ul className="text-xs leading-relaxed list-disc pl-4">{publishBlockers.map(error => <li key={error}>{error}</li>)}</ul></div>}
            {unlabeledObjects > 0 && <p className="mt-3 text-xs leading-relaxed text-on-surface/60">{unlabeledObjects} mapped {unlabeledObjects === 1 ? 'item needs' : 'items need'} an assignment label before handoff.</p>}
          </section>

          <section className="border-t border-outline-variant/35 pt-5">
            <h3 className="text-sm font-bold mb-3">Plan summary</h3>
            <dl className="space-y-3 text-sm"><div className="flex justify-between gap-4"><dt className="text-on-surface/55">Mapped actions</dt><dd className="font-bold">{scenario.objects.length}</dd></div><div className="flex justify-between gap-4"><dt className="text-on-surface/55">Resource quantity</dt><dd className="font-bold">{resourceTotal}</dd></div><div className="flex justify-between gap-4"><dt className="text-on-surface/55">Draft version</dt><dd className="font-bold">{scenario.draftVersion}</dd></div><div className="flex justify-between gap-4"><dt className="text-on-surface/55">Last saved</dt><dd className="font-bold">{planning.temporary ? 'Not saved' : format(new Date(scenario.updatedAt), 'MMM d, HH:mm')}</dd></div></dl>
          </section>

          <section className="border-t border-outline-variant/35 pt-5"><h3 className="text-sm font-bold mb-3">Plan outputs</h3><div className="grid grid-cols-2 gap-2"><button onClick={() => download(`${scenario.name.replace(/\W+/g, '-')}.cnplan`, new Blob([exportScenario(scenario, templates)], { type: 'application/json' }))} className="h-12 bg-surface-container-lowest border border-outline-variant/40 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><Download size={16} /> Plan file</button><button onClick={() => importInput.current?.click()} className="h-12 bg-surface-container-lowest border border-outline-variant/40 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><Import size={16} /> Import plan</button><button onClick={() => exportMap(scenario, 'png')} className="h-12 bg-surface-container-lowest border border-outline-variant/40 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><FileImage size={16} /> Map PNG</button><button onClick={() => exportMap(scenario, 'pdf')} className="h-12 bg-surface-container-lowest border border-outline-variant/40 rounded-xl text-xs font-bold flex items-center justify-center gap-2"><FileText size={16} /> Briefing PDF</button></div>
            <input ref={importInput} type="file" accept=".cnplan,application/json" hidden onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { if (!province) throw new Error('Province boundary is still loading'); const imported = importPlanningFile(await file.text(), province); planning.load(imported.scenario, true); setSidebarTab('brief'); if (operational.isMapAuthorized) { await Promise.all(imported.templates.map(template => PlanningAPI.saveTemplate(template))); setTemplates(await PlanningAPI.templates(true)); } else setTemplates(current => [...new Map([...current, ...imported.templates].map(template => [template.id, template])).values()]); planning.setMessage(`Imported as a new draft${imported.templates.length ? ` with ${imported.templates.length} template${imported.templates.length === 1 ? '' : 's'}` : ''}`); } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'The plan file is not valid'); } event.target.value = ''; }} />
          </section>

          {!planning.temporary && <section className="grid grid-cols-2 gap-2 border-t border-outline-variant/35 pt-5"><button disabled={!canEdit} onClick={async () => { planning.edit(current => ({ ...current, archivedAt: current.archivedAt ? undefined : new Date().toISOString() })); await saveCurrentPlanningScenario(); }} className="h-12 bg-surface-container-lowest border border-outline-variant/40 rounded-xl text-xs font-bold disabled:opacity-40"><Archive size={15} className="inline mr-2" />{scenario.archivedAt ? 'Restore plan' : 'Archive plan'}</button><button disabled={!canEdit} onClick={async () => { const typed = prompt(`Type “${scenario.name}” to permanently delete it.`); if (typed !== scenario.name) return; try { await PlanningAPI.remove(scenario, planning.sessionId); planning.newBoard(); setSidebarTab('brief'); await refreshScenarios(); } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'The plan could not be deleted'); } }} className="h-12 bg-error-container text-on-error-container rounded-xl text-xs font-bold disabled:opacity-40"><Trash2 size={15} className="inline mr-2" />Delete plan</button></section>}
        </div>}
      </div>

      <div className="p-4 border-t border-outline-variant/35 bg-surface-container-low space-y-3">
        {planning.message && <button aria-live="polite" onClick={() => planning.setMessage(null)} className="w-full min-h-11 text-left text-xs px-3 py-2 bg-planning-container text-on-planning-container rounded-xl flex items-center justify-between gap-3">{planning.message}<X size={16} className="shrink-0" /></button>}
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!canEdit} onClick={saveCurrentPlanningScenario} className="h-13 bg-tertiary text-on-tertiary rounded-xl text-sm font-bold disabled:opacity-40"><Save size={18} className="inline mr-2" />Save plan</button>
          {sidebarTab === 'brief' && <button onClick={() => setSidebarTab('map')} className="h-13 btn-planning text-sm font-bold">Map response <ChevronRight size={18} className="inline ml-1" /></button>}
          {sidebarTab === 'map' && <button onClick={() => setSidebarTab('review')} className="h-13 btn-planning text-sm font-bold">Review plan <ChevronRight size={18} className="inline ml-1" /></button>}
          {sidebarTab === 'review' && <button disabled={!canPublish || publishing} onClick={publish} aria-label="Publish plan" title={publishBlockers[0] ?? 'Publish plan'} className="h-13 btn-planning text-sm font-bold disabled:opacity-40"><Upload size={18} className="inline mr-2" />{publishing ? 'Publishing...' : 'Publish plan'}</button>}
        </div>
        {sidebarTab === 'review' && planning.dirty && <p className="text-[11px] text-center text-on-surface/55">Save the latest changes before publishing.</p>}
      </div>
    </aside>
  );
}

export function PlanningOverlay() {
  const planning = usePlanningStore();
  const authorized = useStore(state => state.isMapAuthorized);
  const [drawMenuOpen, setDrawMenuOpen] = useState(false);
  const scenario = planning.history?.present;
  const canEdit = authorized && (planning.temporary || planning.lockAcquired || !navigator.onLine);
  const canUndo = Boolean(scenario && canApplyPlanningHistory(scenario, planning.history?.past.at(-1)));
  const canRedo = Boolean(scenario && canApplyPlanningHistory(scenario, planning.history?.future[0]));

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!usePlanningStore.getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (canEdit) saveCurrentPlanningScenario(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (canEdit && (event.shiftKey ? canRedo : canUndo)) event.shiftKey ? planning.redo() : planning.undo(); return; }
      if (event.key === 'Escape') planning.setTool('select');
      const tool = TOOL_BUTTONS.find(item => item.shortcut.toLowerCase() === event.key.toLowerCase())?.tool;
      if (tool && (canEdit || tool === 'pan' || tool === 'select') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) planning.setTool(tool);
      if (canEdit && (event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) planning.removeObjects(planning.selectedIds);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [planning]);

  useEffect(() => {
    if (!scenario || planning.temporary || planning.lockAcquired) return;
    return PlanningAPI.subscribe(scenario.id, event => {
      if (['snapshot', 'preview', 'saved'].includes(event.type)) planning.showPreview(JSON.parse(event.data));
      if (event.type === 'deleted') planning.newBoard();
    });
  }, [scenario?.id, planning.temporary, planning.lockAcquired]);

  useEffect(() => {
    if (!scenario || !planning.dirty || !planning.lockAcquired || !navigator.onLine) return;
    const timer = setTimeout(() => PlanningAPI.preview(scenario, planning.sessionId).catch(() => planning.setLockAcquired(false)), 500);
    return () => clearTimeout(timer);
  }, [scenario, planning.dirty, planning.lockAcquired, planning.sessionId]);

  useEffect(() => {
    if (!scenario || !planning.lockAcquired || !navigator.onLine) return;
    const timer = setInterval(() => PlanningAPI.acquireLock(scenario.id, planning.sessionId).catch(() => planning.setLockAcquired(false)), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [scenario?.id, planning.lockAcquired, planning.sessionId]);

  if (!scenario) return null;

  const drawActive = DRAW_TOOL_SET.has(planning.tool);

  return (
    <>
      <div className="absolute top-4 left-4 z-[700] bg-surface-container-lowest text-on-surface border border-outline-variant/45 rounded-xl px-4 h-11 flex items-center gap-2 text-xs font-bold shadow-panel">
        <span className={`w-2 h-2 rounded-full ${planning.dirty ? 'bg-planning' : canEdit ? 'bg-success' : 'bg-tertiary'}`} />
        {planning.dirty ? 'Changes need saving' : planning.temporary ? 'New plan, not saved' : canEdit ? 'Saved plan' : 'Live view only'}
      </div>
      {(drawMenuOpen || drawActive) && <div className="absolute bottom-[104px] left-1/2 -translate-x-1/2 z-[699] bg-surface-container-lowest border border-outline-variant/45 rounded-2xl shadow-panel p-3 max-w-[calc(100%-2rem)]">
        <div className="flex items-center gap-2 overflow-x-auto planning-tool-dock">
          {DRAW_TOOLS.map(({ tool, label, shortcut, icon: Icon }) => {
            const eraserLocked = tool === 'eraser' && Object.values(scenario.layers).every(item => item.locked);
            return <button key={tool} disabled={!canEdit || scenario.layers.drawings.locked || eraserLocked} title={`${label} (${shortcut})`} onClick={() => planning.setTool(tool)} className={`min-w-[76px] h-12 px-2 rounded-xl flex items-center justify-center gap-2 shrink-0 text-xs font-bold disabled:opacity-30 transition-colors ${planning.tool === tool ? 'bg-planning text-on-planning' : 'bg-surface-container hover:bg-surface-container-high'}`}><Icon size={18} /><span>{label}</span></button>;
          })}
          <span className="w-px h-9 bg-outline-variant/50 mx-1 shrink-0" />
          {planning.tool !== 'eraser' && <><input aria-label="Drawing color" title="Drawing color" type="color" value={planning.style.color} onChange={event => planning.setStyle({ color: event.target.value })} className="w-12 h-12 p-2 bg-surface-container rounded-xl shrink-0" /><select aria-label="Line style" value={planning.style.lineStyle} onChange={event => planning.setStyle({ lineStyle: event.target.value as typeof planning.style.lineStyle })} className="h-12 text-xs font-semibold bg-surface-container rounded-xl px-3 shrink-0"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select><select aria-label="Line width" value={planning.style.width} onChange={event => planning.setStyle({ width: Number(event.target.value) })} className="h-12 text-xs font-semibold bg-surface-container rounded-xl px-3 shrink-0"><option value="2">Thin</option><option value="3">Medium</option><option value="6">Thick</option></select></>}
          {planning.tool === 'freehand' && <select aria-label="Smoothing" value={planning.smoothing} onChange={event => planning.setSmoothing(event.target.value as typeof planning.smoothing)} className="h-12 text-xs font-semibold bg-surface-container rounded-xl px-3 shrink-0"><option value="off">No smoothing</option><option value="low">Low smoothing</option><option value="high">High smoothing</option></select>}
          {planning.tool === 'eraser' && <select aria-label="Eraser size" value={planning.eraserSize} onChange={event => planning.setEraserSize(event.target.value as typeof planning.eraserSize)} className="h-12 text-xs font-semibold bg-surface-container rounded-xl px-3 shrink-0"><option value="small">Small eraser</option><option value="medium">Medium eraser</option><option value="large">Large eraser</option></select>}
        </div>
      </div>}
      <div className="planning-tool-dock absolute bottom-5 left-1/2 -translate-x-1/2 z-[700] bg-surface-container-lowest border border-outline-variant/45 rounded-2xl shadow-panel p-2 flex gap-1.5 max-w-[calc(100%-2rem)] overflow-x-auto">
        {PRIMARY_TOOL_BUTTONS.map(({ tool, label, description, icon: Icon }) => {
          const layer: PlanningLayer | null = tool === 'symbol' ? 'symbols' : tool === 'text' ? 'labels' : tool === 'line' ? 'drawings' : null;
          const active = tool === 'line' ? drawActive : planning.tool === tool;
          return <button key={tool} disabled={(!canEdit && tool !== 'select') || Boolean(layer && scenario.layers[layer].locked)} onClick={() => {
            if (tool === 'line') { setDrawMenuOpen(true); planning.setTool('line'); }
            else { setDrawMenuOpen(false); planning.setTool(tool); }
          }} className={`min-w-[116px] h-[62px] px-3 rounded-xl flex items-center gap-3 shrink-0 text-left disabled:opacity-30 transition-colors ${active ? 'bg-planning text-on-planning' : 'hover:bg-surface-container text-on-surface/75'}`}><Icon size={21} className="shrink-0" /><span><span className="block text-xs font-extrabold leading-tight">{label}</span><span className="block text-[10px] leading-tight opacity-70 mt-0.5">{description}</span></span></button>;
        })}
        <span className="w-px bg-outline-variant/50 mx-1 shrink-0" />
        <button title="Undo (Ctrl/Cmd+Z)" disabled={!canEdit || !canUndo} onClick={planning.undo} className="w-[52px] h-[62px] rounded-xl flex flex-col gap-1 items-center justify-center shrink-0 disabled:opacity-30 hover:bg-surface-container"><Undo2 size={20} /><span className="text-[10px] font-bold">Undo</span></button>
        <button title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canEdit || !canRedo} onClick={planning.redo} className="w-[52px] h-[62px] rounded-xl flex flex-col gap-1 items-center justify-center shrink-0 disabled:opacity-30 hover:bg-surface-container"><Redo2 size={20} /><span className="text-[10px] font-bold">Redo</span></button>
      </div>
      <PlanningProperties canEdit={canEdit} />
    </>
  );
}

function PlanningProperties({ canEdit }: { canEdit: boolean }) {
  const planning = usePlanningStore();
  const scenario = planning.history?.present;
  const selected = scenario?.objects.filter(object => planning.selectedIds.includes(object.id)) ?? [];
  const object = selected.length === 1 ? selected[0] : null;
  if (!scenario || !object) return null;
  const canToggleLock = canEdit && (!object || !scenario.layers[object.layer].locked);
  canEdit = canToggleLock && !object?.locked;
  return (
    <div className="planning-properties absolute right-4 top-4 z-[650] w-[300px] bg-surface-container-lowest border border-outline-variant/45 rounded-2xl shadow-panel p-5 max-h-[calc(100%-7rem)] overflow-y-auto">
      <div className="flex justify-between items-center mb-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-tertiary mb-1">Plan contents</p><h3 className="text-base font-bold">{object ? 'Object properties' : 'Object inventory'}</h3></div>{object && <button className="w-11 h-11 grid place-items-center rounded-xl hover:bg-surface-container" aria-label="Close object properties" onClick={() => planning.select([])}><X size={18} /></button>}</div>
      <>
        {object.kind === 'symbol' && <p className="text-xs font-semibold mb-2">{PLANNING_SYMBOLS.find(symbol => symbol.key === object.symbolKey)?.label ?? 'DRRM symbol'}</p>}
        <label className="text-[9px] uppercase">Label</label><input aria-label="Object label" disabled={!canEdit} value={object.label ?? ''} onChange={event => planning.updateObject(object.id, { label: event.target.value })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2" />
        <div className="grid grid-cols-2 gap-2 mb-2"><label className="text-[9px] uppercase">Color<input aria-label="Object color" disabled={!canEdit} type="color" value={object.style.color} onChange={event => planning.updateObject(object.id, { style: { ...object.style, color: event.target.value } })} className="block w-full h-8" /></label><label className="text-[9px] uppercase">Width<select aria-label="Object width" disabled={!canEdit} value={object.style.width} onChange={event => planning.updateObject(object.id, { style: { ...object.style, width: Number(event.target.value) } })} className="block w-full h-8 bg-surface-container-lowest rounded"><option value="2">Thin</option><option value="3">Medium</option><option value="6">Thick</option></select></label></div>
        {!['symbol', 'text'].includes(object.kind) && <select aria-label="Object line style" disabled={!canEdit} value={object.style.lineStyle} onChange={event => planning.updateObject(object.id, { style: { ...object.style, lineStyle: event.target.value as PlanningObject['style']['lineStyle'] } })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>}
        {['polygon', 'rectangle', 'circle'].includes(object.kind) && <label className="text-[9px] uppercase block mb-2">Fill opacity<input aria-label="Object fill opacity" disabled={!canEdit} type="range" min="0" max="0.8" step="0.1" value={object.style.fillOpacity} onChange={event => planning.updateObject(object.id, { style: { ...object.style, fillOpacity: Number(event.target.value) } })} className="w-full" /></label>}
        {object.kind === 'text' && <><textarea aria-label="Text content" disabled={!canEdit} value={object.text ?? ''} onChange={event => planning.updateObject(object.id, { text: event.target.value })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2" /><select aria-label="Text size" disabled={!canEdit} value={object.textSize ?? 'medium'} onChange={event => planning.updateObject(object.id, { textSize: event.target.value as PlanningObject['textSize'] })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2"><option>small</option><option>medium</option><option>large</option></select><div className="flex gap-4 mb-2"><label className="text-xs flex gap-1"><input disabled={!canEdit} type="checkbox" checked={Boolean(object.bold)} onChange={event => planning.updateObject(object.id, { bold: event.target.checked })} />Bold</label><label className="text-xs flex gap-1"><input disabled={!canEdit} type="checkbox" checked={Boolean(object.textBackground)} onChange={event => planning.updateObject(object.id, { textBackground: event.target.checked })} />Background</label></div></>}
        {object.kind === 'symbol' && <><label className="text-[9px] uppercase">Quantity</label><input disabled={!canEdit} type="number" min={1} value={object.quantity ?? 1} onChange={event => planning.updateObject(object.id, { quantity: Math.max(1, Number(event.target.value)) })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2" /><textarea disabled={!canEdit} value={object.notes ?? ''} onChange={event => planning.updateObject(object.id, { notes: event.target.value })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2" placeholder="Notes" /><select disabled={!canEdit} value={object.symbolSize ?? 'medium'} onChange={event => planning.updateObject(object.id, { symbolSize: event.target.value as PlanningObject['symbolSize'] })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2"><option>small</option><option>medium</option><option>large</option></select></>}
        {object.kind === 'line' && <select disabled={!canEdit} value={object.arrows ?? 'end'} onChange={event => planning.updateObject(object.id, { arrows: event.target.value as PlanningObject['arrows'] })} className="w-full p-2 bg-surface-container-lowest rounded text-xs mb-2"><option value="none">No arrows</option><option value="end">End arrow</option><option value="both">Both ends</option></select>}
        {['line', 'freehand', 'polygon', 'rectangle', 'circle'].includes(object.kind) && <label className="flex items-center gap-2 text-xs mb-2"><input disabled={!canEdit} type="checkbox" checked={Boolean(object.measurementPinned)} onChange={event => planning.updateObject(object.id, { measurementPinned: event.target.checked })} />Pin measurement</label>}
        <label className="flex items-center gap-2 text-xs mb-2"><input disabled={!canToggleLock} type="checkbox" checked={object.locked} onChange={event => planning.updateObject(object.id, { locked: event.target.checked })} />{object.locked ? <Lock size={12} /> : <Unlock size={12} />} Locked</label>
        <div className="grid grid-cols-2 gap-2 mb-2"><button disabled={!canEdit} onClick={() => planning.updateObject(object.id, { order: Math.max(...scenario.objects.map(item => item.order)) + 1 })} className="p-2 bg-surface-container-lowest rounded text-[10px] disabled:opacity-30">Bring forward</button><button disabled={!canEdit} onClick={() => planning.updateObject(object.id, { order: Math.min(...scenario.objects.map(item => item.order)) - 1 })} className="p-2 bg-surface-container-lowest rounded text-[10px] disabled:opacity-30">Send backward</button></div>
        <div className="grid grid-cols-2 gap-2"><button disabled={!canEdit} onClick={() => planning.addObject({ ...structuredClone(object), id: crypto.randomUUID(), order: scenario.objects.length })} className="p-2 bg-surface-container-lowest rounded text-[10px] disabled:opacity-30">Duplicate</button><button disabled={!canEdit || object.locked} onClick={() => planning.removeObjects([object.id])} className="p-2 bg-error-container rounded text-[10px] disabled:opacity-30">Delete</button></div>
      </>
    </div>
  );
}

export function PublishedPlansControl() {
  const planning = usePlanningStore();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) refreshScenarios(); }, [open]);
  const published = planning.scenarios.filter(scenario => !scenario.archivedAt && scenario.publishedRevision && (!scenario.validUntil || new Date(scenario.validUntil) >= new Date()));
  return <div className="absolute bottom-5 right-5 z-[600] bg-surface-container-lowest border border-outline-variant/45 rounded-2xl shadow-panel p-2 w-64">
    <button onClick={() => setOpen(!open)} className="w-full min-h-12 px-3 flex items-center justify-between text-sm font-bold rounded-xl hover:bg-surface-container"><span>Published Plans</span><span className="min-w-7 h-7 px-2 grid place-items-center rounded-full bg-surface-container text-xs">{planning.publishedOverlays.length}</span></button>
    {open && <div className="space-y-2 mt-2 px-2 pb-2">{published.length === 0 ? <p className="text-xs text-on-surface/55 py-2">No current published plans</p> : published.map(scenario => <label key={scenario.id} className="min-h-11 flex items-center gap-3 text-xs"><input className="w-5 h-5" type="checkbox" checked={planning.publishedOverlays.some(revision => revision.scenarioId === scenario.id)} onChange={async event => {
      if (!event.target.checked) return planning.setPublishedOverlays(planning.publishedOverlays.filter(revision => revision.scenarioId !== scenario.id));
      const revisions = await PlanningAPI.revisions(scenario.id, useStore.getState().isMapAuthorized);
      const latest = revisions[0];
      if (latest) planning.setPublishedOverlays([...planning.publishedOverlays.filter(revision => revision.scenarioId !== scenario.id), latest]);
    }} /><span>{scenario.name} • r{scenario.publishedRevision}</span></label>)}</div>}
  </div>;
}
