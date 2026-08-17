import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BoxSelect,
  Circle,
  Download,
  Eraser,
  FileImage,
  FileText,
  Hand,
  Import,
  Lock,
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
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
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
import { usePlanningStore, type PlanningTool } from '../lib/planningStore';
import { DISASTER_TYPES, SUSCEPTIBILITY_LEVELS, useStore } from '../lib/store';
import { MAP_CONFIG } from '../lib/constants';
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
  { tool: 'eraser', label: 'Partial eraser', shortcut: 'E', icon: Eraser },
];

function localDateTime(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function refreshScenarios() {
  usePlanningStore.getState().setScenarios(await PlanningAPI.list());
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
  const [selectedMunicipality, setSelectedMunicipality] = useState('ALL');
  const [templates, setTemplates] = useState<PlanningTemplate[]>([]);
  const [province, setProvince] = useState<ProvinceGeoJSON | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const scenario = planning.history?.present;

  useEffect(() => {
    refreshScenarios();
    PlanningAPI.templates().then(setTemplates);
    fetch(provinceBoundaryUrl).then(response => response.json()).then(setProvince).catch(() => planning.setMessage('Province boundary could not be loaded'));
  }, []);

  const scenarios = planning.scenarios.filter(item => {
    const matchesQuery = item.name.toLowerCase().includes(query.toLowerCase());
    if (status === 'archived') return matchesQuery && Boolean(item.archivedAt);
    if (status === 'published') return matchesQuery && !item.archivedAt && Boolean(item.publishedRevision);
    return matchesQuery && !item.archivedAt;
  });

  const openScenario = async (next: PlanningScenario) => {
    if (planning.dirty && !confirm('Discard unsaved changes?')) return;
    planning.load(next);
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

  if (!scenario) return null;

  return (
    <aside className="w-80 h-full bg-surface-container-low flex flex-col z-[55] shadow-ambient">
      <div className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
        {!operational.isMapAuthorized && <button onClick={() => operational.openPinModal('unlock')} className="w-full p-3 rounded-lg bg-error-container text-on-error-container text-[10px] font-bold uppercase">Unlock planning tools</button>}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-display font-bold">Planning Scenarios</h2>
            <button className="text-xs btn-primary px-3 py-2" onClick={() => {
              if (!planning.dirty || confirm('Discard unsaved changes?')) planning.newBoard();
            }}>New</button>
          </div>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-2.5 text-on-surface/40" />
            <input aria-label="Search scenarios" value={query} onChange={event => setQuery(event.target.value)} className="w-full pl-9 pr-3 py-2 rounded-md bg-surface-container-lowest text-sm" placeholder="Search" />
          </div>
          <div className="flex gap-1 mb-2">
            {(['draft', 'published', 'archived'] as const).map(item => <button key={item} onClick={() => setStatus(item)} className={`flex-1 py-1 rounded text-[10px] uppercase font-bold ${status === item ? 'bg-primary text-white' : 'bg-surface-container-lowest'}`}>{item}</button>)}
          </div>
          <div className="max-h-36 overflow-y-auto space-y-1">
            {scenarios.map(item => <button key={item.id} onClick={() => openScenario(item)} className={`w-full text-left px-3 py-2 rounded-md text-xs ${item.id === scenario.id && !planning.temporary ? 'bg-primary/10 text-primary font-bold' : 'bg-surface-container-lowest'}`}>
              <span className="block truncate">{item.name}</span>
              <span className="text-[9px] opacity-60">v{item.draftVersion}{item.publishedRevision ? ` • published r${item.publishedRevision}` : ''}</span>
            </button>)}
          </div>
        </section>

        <section className="space-y-2">
          <label className="text-[10px] uppercase font-bold">Scenario details</label>
          <input disabled={!canEdit} value={scenario.name} maxLength={120} onChange={event => updateMetadata({ name: event.target.value })} className="w-full bg-surface-container-lowest p-2 rounded text-sm" placeholder="Scenario name" />
          <textarea disabled={!canEdit} value={scenario.notes} maxLength={4000} onChange={event => updateMetadata({ notes: event.target.value })} className="w-full bg-surface-container-lowest p-2 rounded text-sm resize-none" rows={2} placeholder="Objective / notes" />
          <div className="grid grid-cols-2 gap-2">
            <input disabled={!canEdit} aria-label="Valid from" type="datetime-local" value={localDateTime(scenario.validFrom)} onChange={event => updateMetadata({ validFrom: event.target.value ? new Date(event.target.value).toISOString() : undefined })} className="bg-surface-container-lowest p-2 rounded text-[10px]" />
            <input disabled={!canEdit} aria-label="Valid until" type="datetime-local" value={localDateTime(scenario.validUntil)} onChange={event => updateMetadata({ validUntil: event.target.value ? new Date(event.target.value).toISOString() : undefined })} className="bg-surface-container-lowest p-2 rounded text-[10px]" />
          </div>
          <select disabled={!canEdit} aria-label="Classification" value={scenario.classification ?? ''} onChange={event => updateMetadata({ classification: event.target.value ? event.target.value as PlanningScenario['classification'] : undefined })} className="w-full bg-surface-container-lowest p-2 rounded text-xs">
            <option value="">No classification</option><option>Internal</option><option>Restricted</option><option>Public</option>
          </select>
        </section>

        <section>
          <label className="text-[10px] uppercase font-bold block mb-2">Planning layers</label>
          <div className="space-y-1">{(Object.keys(scenario.layers) as PlanningLayer[]).map(layer => <div key={layer} className="flex items-center gap-2 bg-surface-container-lowest rounded px-2 py-1 text-xs">
            <input disabled={!canEdit} aria-label={`Show ${layer}`} type="checkbox" checked={scenario.layers[layer].visible} onChange={event => planning.edit(current => ({ ...current, layers: { ...current.layers, [layer]: { ...current.layers[layer], visible: event.target.checked } } }))} />
            <span className="flex-1 capitalize">{layer}</span>
            <label className="flex items-center gap-1 text-[9px]"><input disabled={!canEdit} aria-label={`Lock ${layer}`} type="checkbox" checked={scenario.layers[layer].locked} onChange={event => planning.edit(current => ({ ...current, layers: { ...current.layers, [layer]: { ...current.layers[layer], locked: event.target.checked } } }))} /><Lock size={10} /></label>
          </div>)}</div>
        </section>

        <section>
          <label className="text-[10px] uppercase font-bold block mb-2">Symbols</label>
          <input value={symbolQuery} onChange={event => setSymbolQuery(event.target.value)} className="w-full bg-surface-container-lowest p-2 rounded text-xs mb-2" placeholder="Search DRRM symbols" />
          <div className="grid grid-cols-4 gap-2 max-h-44 overflow-y-auto">
            {PLANNING_SYMBOLS.filter(symbol => `${symbol.label} ${symbol.category}`.toLowerCase().includes(symbolQuery.toLowerCase())).map(symbol => (
              <button key={symbol.key} aria-label={symbol.label} title={symbol.label} onClick={() => planning.setSymbolKey(symbol.key)} className={`aspect-square rounded-lg border text-[9px] font-black ${planning.symbolKey === symbol.key && planning.tool === 'symbol' ? 'border-primary bg-primary text-white' : 'border-outline-variant bg-surface-container-lowest'}`}>{symbol.glyph}</button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <select aria-label="Symbol size" value={planning.symbolSize} onChange={event => planning.setSymbolSize(event.target.value as typeof planning.symbolSize)} className="flex-1 bg-surface-container-lowest p-2 rounded text-xs"><option>small</option><option>medium</option><option>large</option></select>
            <button disabled={!operational.isMapAuthorized} onClick={async () => {
              const name = prompt('Template name');
              if (!name?.trim()) return;
              const template: PlanningTemplate = { id: crypto.randomUUID(), name: name.trim(), symbolKey: planning.symbolKey, color: planning.style.color, size: planning.symbolSize, updatedAt: new Date().toISOString() };
              try { await PlanningAPI.saveTemplate(template); setTemplates(await PlanningAPI.templates()); }
              catch (error) { planning.setMessage(error instanceof Error ? error.message : 'Could not save template'); }
            }} className="px-3 bg-surface-container-lowest rounded text-[10px] disabled:opacity-40">Save template</button>
          </div>
          {templates.length > 0 && <details className="mt-2"><summary className="text-[10px] cursor-pointer">Shared templates</summary><div className="space-y-1 mt-1">{templates.map(template => <div key={template.id} className="flex gap-1">
            <button onClick={() => { planning.setStyle({ color: template.color }); planning.setSymbolSize(template.size); planning.setSymbolKey(template.symbolKey); }} className="flex-1 p-2 bg-surface-container-lowest rounded text-[10px] text-left truncate">{template.name}</button>
            <button aria-label={`Delete ${template.name}`} disabled={!operational.isMapAuthorized} onClick={async () => { if (!confirm(`Delete template “${template.name}”?`)) return; try { await PlanningAPI.deleteTemplate(template.id); setTemplates(await PlanningAPI.templates()); } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'Could not delete template'); } }} className="p-2 bg-error-container rounded disabled:opacity-40"><X size={11} /></button>
          </div>)}</div></details>}
        </section>

        <details>
          <summary className="text-[10px] uppercase font-bold cursor-pointer">Reference layers</summary>
          <div className="space-y-2 mt-3">
            <select value={selectedMunicipality} onChange={event => {
              const value = event.target.value;
              setSelectedMunicipality(value);
              const municipality = MUNICIPALITIES.find(item => item.name === value);
              operational.flyTo(municipality?.center ?? MAP_CONFIG.PROVINCE_CENTER, municipality ? MAP_CONFIG.MUNICIPALITY_ZOOM : MAP_CONFIG.DEFAULT_ZOOM);
            }} className="w-full bg-surface-container-lowest p-2 rounded text-xs">
              <option value="ALL">Province overview</option>{MUNICIPALITIES.map(item => <option key={item.name}>{item.name}</option>)}
            </select>
            {selectedMunicipality !== 'ALL' && <select onChange={event => {
              const barangay = MUNICIPALITIES.find(item => item.name === selectedMunicipality)?.barangays.find(item => item.name === event.target.value);
              if (barangay) operational.flyTo([barangay.lat, barangay.lng], MAP_CONFIG.BARANGAY_ZOOM);
            }} className="w-full bg-surface-container-lowest p-2 rounded text-xs"><option>All barangays</option>{MUNICIPALITIES.find(item => item.name === selectedMunicipality)?.barangays.map(item => <option key={item.name}>{item.name}</option>)}</select>}
            <div className="grid grid-cols-3 gap-1">{(['street', 'topo', 'satellite'] as const).map(base => <button key={base} onClick={() => operational.setBaseMap(base)} className={`p-1 rounded text-[9px] uppercase ${operational.baseMap === base ? 'bg-primary text-white' : 'bg-surface-container-lowest'}`}>{base}</button>)}</div>
            {DISASTER_TYPES.map(type => <label key={type.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={operational.activeFilters.includes(type.id)} onChange={() => operational.toggleFilter(type.id)} />{type.label}</label>)}
            {operational.activeFilters.includes('flood') && SUSCEPTIBILITY_LEVELS.map(level => <label key={level.id} className="flex items-center gap-2 text-xs pl-4"><input type="checkbox" checked={operational.activeSusceptibilityFilters.includes(level.id)} onChange={() => operational.toggleSusceptibilityFilter(level.id)} />{level.label}</label>)}
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={operational.evacuationCentersVisible} onChange={operational.toggleEvacuationCenters} />Evacuation centers</label>
          </div>
        </details>

        <section className="grid grid-cols-2 gap-2">
          <button onClick={() => download(`${scenario.name.replace(/\W+/g, '-')}.cnplan`, new Blob([exportScenario(scenario, templates)], { type: 'application/json' }))} className="p-2 bg-surface-container-lowest rounded text-[10px] flex items-center gap-1"><Download size={13} /> Native</button>
          <button onClick={() => importInput.current?.click()} className="p-2 bg-surface-container-lowest rounded text-[10px] flex items-center gap-1"><Import size={13} /> Import</button>
          <button onClick={() => exportMap(scenario, 'png')} className="p-2 bg-surface-container-lowest rounded text-[10px] flex items-center gap-1"><FileImage size={13} /> PNG</button>
          <button onClick={() => exportMap(scenario, 'pdf')} className="p-2 bg-surface-container-lowest rounded text-[10px] flex items-center gap-1"><FileText size={13} /> A4 PDF</button>
          <input ref={importInput} type="file" accept=".cnplan,application/json" hidden onChange={async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              if (!province) throw new Error('Province boundary is still loading');
              const imported = importPlanningFile(await file.text(), province);
              planning.load(imported.scenario, true);
              if (operational.isMapAuthorized) {
                await Promise.all(imported.templates.map(template => PlanningAPI.saveTemplate(template)));
                setTemplates(await PlanningAPI.templates());
              } else setTemplates(current => [...new Map([...current, ...imported.templates].map(template => [template.id, template])).values()]);
              planning.setMessage(`Imported as a new draft${imported.templates.length ? ` with ${imported.templates.length} template${imported.templates.length === 1 ? '' : 's'}` : ''}`);
            } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'Invalid scenario file'); }
            event.target.value = '';
          }} />
        </section>
      </div>
      <div className="p-4 border-t border-outline-variant/30 space-y-2">
        {planning.message && <button onClick={() => planning.setMessage(null)} className="w-full text-left text-[10px] p-2 bg-surface-container-highest rounded flex justify-between">{planning.message}<X size={12} /></button>}
        <div className="flex gap-2">
          <button disabled={!canEdit} onClick={saveCurrentPlanningScenario} className="flex-1 btn-primary py-2 text-xs disabled:opacity-40"><Save size={14} className="inline mr-1" />Save</button>
          <button disabled={planning.temporary || !canEdit || !navigator.onLine} onClick={async () => {
            const validation = validateForPublish(scenario);
            if (validation.errors.length) return planning.setMessage(validation.errors.join('. '));
            if (validation.warnings.length && !confirm(`${validation.warnings.join('. ')}. Publish anyway?`)) return;
            try { const published = await PlanningAPI.publish(scenario.id, planning.sessionId); planning.setMessage(`Published revision ${published.revision}`); await refreshScenarios(); } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'Publish failed'); }
          }} aria-label="Publish scenario" title="Publish scenario" className="px-3 bg-tertiary text-white rounded text-xs disabled:opacity-40"><Upload size={14} /></button>
        </div>
        {!planning.temporary && <div className="flex gap-2">
          <button disabled={!canEdit} onClick={async () => { planning.edit(current => ({ ...current, archivedAt: current.archivedAt ? undefined : new Date().toISOString() })); await saveCurrentPlanningScenario(); }} className="flex-1 p-2 bg-surface-container-lowest rounded text-[10px] disabled:opacity-40"><Archive size={12} className="inline mr-1" />{scenario.archivedAt ? 'Restore' : 'Archive'}</button>
          <button disabled={!canEdit} onClick={async () => { const typed = prompt(`Type “${scenario.name}” to permanently delete it.`); if (typed !== scenario.name) return; try { await PlanningAPI.remove(scenario, planning.sessionId); planning.newBoard(); await refreshScenarios(); } catch (error) { planning.setMessage(error instanceof Error ? error.message : 'Could not delete scenario'); } }} className="flex-1 p-2 bg-error-container text-on-error-container rounded text-[10px] disabled:opacity-40"><Trash2 size={12} className="inline mr-1" />Delete</button>
        </div>}
      </div>
    </aside>
  );
}

export function PlanningOverlay() {
  const planning = usePlanningStore();
  const authorized = useStore(state => state.isMapAuthorized);
  const scenario = planning.history?.present;
  const canEdit = authorized && (planning.temporary || planning.lockAcquired || !navigator.onLine);
  const historyLocked = Boolean(scenario && Object.values(scenario.layers).some(layer => layer.locked));

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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (canEdit && !historyLocked) event.shiftKey ? planning.redo() : planning.undo(); return; }
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

  return (
    <>
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[700] bg-[#fff4ce] text-[#5f4500] border border-[#e2c764] rounded-full px-4 py-2 text-[10px] font-black tracking-widest shadow-lg">PLANNING MODE • {planning.dirty ? 'UNSAVED CHANGES' : planning.temporary ? 'TEMPORARY BOARD' : canEdit ? 'SAVED' : 'READ-ONLY LIVE PREVIEW'}</div>
      <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[700] bg-surface-container-highest rounded-xl shadow-lg p-1 flex gap-1 max-w-[calc(100%-2rem)] overflow-x-auto">
        {TOOL_BUTTONS.map(({ tool, label, shortcut, icon: Icon }) => {
          const layer: PlanningLayer | null = tool === 'symbol' ? 'symbols' : tool === 'text' ? 'labels' : ['freehand', 'line', 'polygon', 'rectangle', 'circle', 'eraser'].includes(tool) ? 'drawings' : null;
          return <button key={tool} disabled={(!canEdit && tool !== 'pan' && tool !== 'select') || Boolean(layer && scenario?.layers[layer].locked)} title={`${label} (${shortcut})`} onClick={() => planning.setTool(tool)} className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 disabled:opacity-30 ${planning.tool === tool ? 'bg-primary text-white' : 'hover:bg-surface-container'}`}><Icon size={17} /></button>;
        })}
        <span className="w-px bg-outline-variant/50 mx-1" />
        <button title="Undo (Ctrl/Cmd+Z)" disabled={!canEdit || historyLocked || !planning.history?.past.length} onClick={planning.undo} className="w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30"><Undo2 size={17} /></button>
        <button title="Redo (Ctrl/Cmd+Shift+Z)" disabled={!canEdit || historyLocked || !planning.history?.future.length} onClick={planning.redo} className="w-10 h-10 rounded-lg flex items-center justify-center disabled:opacity-30"><Redo2 size={17} /></button>
        <input aria-label="Drawing color" type="color" value={planning.style.color} onChange={event => planning.setStyle({ color: event.target.value })} className="w-10 h-10 p-1 bg-transparent" />
        <select aria-label="Line style" value={planning.style.lineStyle} onChange={event => planning.setStyle({ lineStyle: event.target.value as typeof planning.style.lineStyle })} className="text-[10px] bg-surface-container rounded px-1"><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select>
        <select aria-label="Line width" value={planning.style.width} onChange={event => planning.setStyle({ width: Number(event.target.value) })} className="text-[10px] bg-surface-container rounded px-1"><option value="2">Thin</option><option value="3">Medium</option><option value="6">Thick</option></select>
        <label className="flex items-center px-1 text-[9px]">Fill<input aria-label="Fill opacity" type="range" min="0" max="0.8" step="0.1" value={planning.style.fillOpacity} onChange={event => planning.setStyle({ fillOpacity: Number(event.target.value) })} className="w-16" /></label>
        {planning.tool === 'freehand' && <select aria-label="Smoothing" value={planning.smoothing} onChange={event => planning.setSmoothing(event.target.value as typeof planning.smoothing)} className="text-[10px] bg-surface-container rounded px-1"><option value="off">No smoothing</option><option value="low">Low smoothing</option><option value="high">High smoothing</option></select>}
        {planning.tool === 'eraser' && <select aria-label="Eraser size" value={planning.eraserSize} onChange={event => planning.setEraserSize(event.target.value as typeof planning.eraserSize)} className="text-[10px] bg-surface-container rounded px-1"><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select>}
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
  const totals = useMemo(() => scenario ? getSymbolTotals(scenario.objects) : [], [scenario]);
  if (!scenario) return null;
  const canToggleLock = canEdit && (!object || !scenario.layers[object.layer].locked);
  canEdit = canToggleLock && !object?.locked;
  return (
    <div className="absolute right-4 top-28 z-[650] w-64 bg-surface-container-highest rounded-xl shadow-lg p-4 max-h-[calc(100%-10rem)] overflow-y-auto">
      <div className="flex justify-between items-center mb-3"><h3 className="text-xs font-bold uppercase">{object ? 'Object properties' : 'Object inventory'}</h3>{object && <button aria-label="Close object properties" onClick={() => planning.select([])}><X size={14} /></button>}</div>
      {object ? <>
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
      </> : <>
        <div className="relative mb-2"><BoxSelect size={13} className="absolute left-2 top-2.5" /><span className="block pl-7 py-2 text-[10px]">{scenario.objects.length} objects</span></div>
        <div className="space-y-1 max-h-52 overflow-y-auto">{scenario.objects.map(object => <button key={object.id} onClick={() => planning.select([object.id])} className="w-full flex justify-between p-2 bg-surface-container-lowest rounded text-[10px] text-left"><span className="truncate">{object.label || object.symbolKey || object.kind}</span>{object.locked && <Lock size={10} />}</button>)}</div>
        {totals.length > 0 && <div className="mt-3 pt-3 border-t border-outline-variant/30 space-y-1">{totals.map(total => <div key={total.symbolKey} className="flex justify-between text-[9px]"><span>{PLANNING_SYMBOLS.find(symbol => symbol.key === total.symbolKey)?.label ?? total.symbolKey}</span><strong>{total.quantity}</strong></div>)}</div>}
      </>}
    </div>
  );
}

export function PublishedPlansControl() {
  const planning = usePlanningStore();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) refreshScenarios(); }, [open]);
  const published = planning.scenarios.filter(scenario => !scenario.archivedAt && scenario.publishedRevision && (!scenario.validUntil || new Date(scenario.validUntil) >= new Date()));
  return <div className="absolute bottom-5 right-5 z-[600] bg-surface-container-highest rounded-xl shadow-lg p-3 w-64">
    <button onClick={() => setOpen(!open)} className="w-full flex justify-between text-xs font-bold"><span>Published Plans</span><span>{planning.publishedOverlays.length}</span></button>
    {open && <div className="space-y-2 mt-3">{published.length === 0 ? <p className="text-[10px] opacity-60">No current published plans</p> : published.map(scenario => <label key={scenario.id} className="flex gap-2 text-[10px]"><input type="checkbox" checked={planning.publishedOverlays.some(revision => revision.scenarioId === scenario.id)} onChange={async event => {
      if (!event.target.checked) return planning.setPublishedOverlays(planning.publishedOverlays.filter(revision => revision.scenarioId !== scenario.id));
      const revisions = await PlanningAPI.revisions(scenario.id);
      const latest = revisions[0];
      if (latest) planning.setPublishedOverlays([...planning.publishedOverlays.filter(revision => revision.scenarioId !== scenario.id), latest]);
    }} /><span>{scenario.name} • r{scenario.publishedRevision}</span></label>)}</div>}
  </div>;
}
