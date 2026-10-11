import { useStore } from '../lib/store';
import { REFERENCE_LAYERS } from '../lib/reference';

export function HazardLegend({ filterFlood = false }: { filterFlood?: boolean }) {
  const { referenceLayers, activeSusceptibilityFilters, toggleSusceptibilityFilter } = useStore();
  const layers = REFERENCE_LAYERS.filter(layer => referenceLayers.includes(layer.id));
  return <div aria-label="Hazard legend">
    {!layers.length && <p className="text-xs">Select reference hazard layers to show their legend.</p>}
    {layers.map(layer => <div key={layer.id} className="mt-3">
      <h4 className="text-sm font-bold">{layer.label}</h4>
      <p className="text-xs mb-2">{filterFlood && layer.id === 'flood' ? 'Select classes; none selected shows all classes.' : 'Legend · source classes'}</p>
      {Object.entries(layer.colors).filter(([label]) => filterFlood || layer.id !== 'flood' || !activeSusceptibilityFilters.length || activeSusceptibilityFilters.includes(label)).map(([label, color]) => <label key={label} className="flex items-center gap-2 min-h-8 text-xs">
        {filterFlood && layer.id === 'flood' && <input type="checkbox" checked={activeSusceptibilityFilters.includes(label)} onChange={() => toggleSusceptibilityFilter(label)} />}
        <span aria-hidden="true" className="w-5 h-4 border border-black/20 shrink-0" style={{ background: label.startsWith('Debris') ? 'repeating-linear-gradient(135deg,transparent 0 3px,#000 3px 4px)' : color }} />
        {label}
      </label>)}
    </div>)}
  </div>;
}
