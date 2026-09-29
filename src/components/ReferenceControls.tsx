import { useId } from 'react';
import { useStore } from '../lib/store';
import { barangaysFor, municipalities, HAZARD_TYPES, REFERENCE_LAYERS, ELEMENT_LAYERS, LEGACY_TYPES } from '../lib/reference';
import profiles from '../lib/barangayProfiles.json';
import population from '../lib/populationSummary.json';
import { MAP_CONFIG } from '../lib/constants';

export function LocationFields({municipality,barangay,onChange,required=false}:{municipality:string;barangay:string;onChange:(m:string,b:string)=>void;required?:boolean}) {
  const id = useId();
  const items = barangaysFor(municipality);
  return <div className="space-y-2">
    <label className="block text-xs font-semibold" htmlFor={id+'m'}>Municipality</label>
    <select id={id+'m'} required={required} className="reference-select" value={municipality} onChange={e=>onChange(e.target.value,'')}>
      <option value="">{required?'Select municipality':'Province overview'}</option>
      {municipality && !municipalities.includes(municipality) && <option value={municipality}>{municipality} (legacy)</option>}
      {municipalities.map(m=><option key={m}>{m}</option>)}
    </select>
    <label className="block text-xs font-semibold" htmlFor={id+'b'}>Barangay</label>
    <select id={id+'b'} required={required} disabled={!municipality} className="reference-select" value={barangay} onChange={e=>onChange(municipality,e.target.value)}>
      <option value="">{required?'Select barangay':'All barangays'}</option>
      {barangay && !items.some(b=>b.name===barangay) && <option value={barangay}>{barangay} (legacy)</option>}
      {items.map(b=><option key={b.name}>{b.name}</option>)}
    </select>
  </div>;
}
export function LocationOverview() {
  const {selectedMunicipality:m,selectedBarangay:b,elementLayers} = useStore();
  const rows = profiles.filter(p=>(!m || p.municipality===m) && (!b || p.barangay===b));
  const hh = population.filter(h=>!m || h.municipality===m);
  return <div className="text-xs space-y-2 leading-relaxed">
    <p><strong>{b || m || 'Camarines Norte'}</strong> · {rows.length} barangay{rows.length===1?'':'s'}</p>
    <p>Area: {rows.reduce((n,p)=>n+p.areaKm2,0).toLocaleString(undefined,{maximumFractionDigits:2})} km²</p>
    <p>Population: {rows.reduce((n,p)=>n+p.population,0).toLocaleString()} <span className="text-on-surface/60">(source year unconfirmed)</span></p>
    {b && rows.map(p=><div key={p.barangay} className="space-y-2">
      <p>Barangay captain: {p.captain || 'Not supplied'}<br/>Contact: {p.contact || 'Not supplied'}<br/>DRRM contact: Not supplied</p>
      {Object.entries(p.susceptibility).map(([hazard,levels])=><p key={hazard}><strong>{hazard}:</strong> {levels.join(', ') || 'No class recorded'}</p>)}
      <p className="text-on-surface/60">No recorded class does not mean safe. Tsunami classes differ from map depth bands.</p>
      {Object.entries(p.demographics).map(([label,value])=><p key={label}>{label}: {value===null?'Not supplied':value.toLocaleString()}</p>)}
    </div>)}
    {elementLayers.includes('population') && <div className="rounded-xl border border-outline-variant p-3">
      <strong>Population · {m || 'Province'}</strong>{b && <p>Municipality totals, not barangay exposure.</p>}
      {hh.length ? <><p>{hh.reduce((n,h)=>n+h.sourceRecords,0).toLocaleString()} records (not people).</p><p>Reported population sum: {hh.some(h=>h.populationSum===null)?'Incomplete':hh.reduce((n,h)=>n+(h.populationSum ?? 0),0).toLocaleString()}.</p><p>{hh.reduce((n,h)=>n+h.duplicateIdExcess,0).toLocaleString()} duplicate-ID excess records retained for review.</p></> : <p>No population file supplied for this municipality.</p>}
      <p>Population coverage is incomplete; data year unconfirmed.</p>
    </div>}
  </div>;
}
export function IncidentFilters() {
  const s = useStore();
  return <details className="border border-outline-variant/40 rounded-xl p-3">
    <summary className="min-h-11 cursor-pointer font-semibold text-sm">Incident types · {s.activeFilters.length} selected</summary>
    {HAZARD_TYPES.map(t=><label key={t.id} className="reference-check"><input type="checkbox" checked={s.activeFilters.includes(t.id)} onChange={()=>s.toggleFilter(t.id)}/><span aria-hidden="true" style={{color:t.color}}>{t.symbol}</span>{t.label}</label>)}
    {s.hazards.some(h=>LEGACY_TYPES.some(t=>t.id===h.type)) && <label className="reference-check"><input type="checkbox" checked={LEGACY_TYPES.some(t=>s.activeFilters.includes(t.id))} onChange={e=>{const checked=e.target.checked;LEGACY_TYPES.forEach(t=>{if(s.activeFilters.includes(t.id)!==checked)s.toggleFilter(t.id);});}}/>Include legacy records</label>}
    <p className="text-xs text-on-surface/60">Filters also apply to analytics.</p>
  </details>;
}
export function ReferenceControls() {
  const s=useStore();
  return <div className="space-y-5">
    <section className="space-y-3"><h3 className="font-bold">Location Overview</h3>
      <LocationFields municipality={s.selectedMunicipality} barangay={s.selectedBarangay} onChange={(m,b)=>{
        s.setLocationFilter(m,b);
        const points=barangaysFor(m); const point=points.find(p=>p.name===b);
        if(point) s.flyTo([point.lat,point.lng],MAP_CONFIG.BARANGAY_ZOOM);
        else if(points.length) s.flyTo([points.reduce((n,p)=>n+p.lat,0)/points.length,points.reduce((n,p)=>n+p.lng,0)/points.length],MAP_CONFIG.MUNICIPALITY_ZOOM);
        else s.flyTo(MAP_CONFIG.PROVINCE_CENTER,MAP_CONFIG.DEFAULT_ZOOM);
      }}/>
      <LocationOverview/>
    </section>
    <label className="block font-bold">Basemap<select className="reference-select mt-2" value={s.baseMap} onChange={e=>s.setBaseMap(e.target.value as typeof s.baseMap)}><option value="street">Street · OpenStreetMap</option><option value="topo">Topographic · OpenTopoMap</option><option value="satellite">Satellite · Esri</option></select></label>
    <section>
      <details className="border border-outline-variant/40 rounded-xl p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold">Hazards</summary>
        <table className="w-full text-xs">
          <caption className="sr-only">Hazard zones and reported incidents</caption>
          <thead><tr><th scope="col" className="text-left font-semibold">Hazard</th><th scope="col" className="font-semibold">Zones</th><th scope="col" className="font-semibold">Incidents</th></tr></thead>
          <tbody>{HAZARD_TYPES.map(type=>{
            const layer=REFERENCE_LAYERS.find(layer=>layer.id===(type.id==='rain_induced_landslide'?'landslide':type.id));
            return <tr key={type.id} className="border-t border-outline-variant/30">
              <th scope="row" className="text-left font-medium pr-2">{type.label}</th>
              <td className="text-center">{layer ? <label className="min-h-11 min-w-11 flex items-center justify-center"><input className="w-5 h-5" type="checkbox" aria-label={`${type.label} zones`} checked={s.referenceLayers.includes(layer.id)} onChange={()=>s.toggleReferenceLayer(layer.id)}/></label> : <span title="No zone layer loaded" aria-label="No zone layer loaded">—</span>}</td>
              <td><label className="min-h-11 min-w-11 flex items-center justify-center"><input className="w-5 h-5 disabled:opacity-40" type="checkbox" aria-label={`${type.label} incidents`} disabled={!s.incidentsVisible} checked={s.activeFilters.includes(type.id)} onChange={()=>s.toggleFilter(type.id)}/></label></td>
            </tr>;
          })}</tbody>
        </table>
        <label className="reference-check text-xs"><input type="checkbox" checked={s.incidentsVisible} onChange={s.toggleIncidents}/>Show reported incidents</label>
        {s.hazards.some(h=>LEGACY_TYPES.some(t=>t.id===h.type)) && <label className="reference-check text-xs"><input type="checkbox" checked={LEGACY_TYPES.some(t=>s.activeFilters.includes(t.id))} onChange={e=>{const checked=e.target.checked;LEGACY_TYPES.forEach(t=>{if(s.activeFilters.includes(t.id)!==checked)s.toggleFilter(t.id);});}}/>Include legacy records</label>}
      </details>
      {REFERENCE_LAYERS.filter(t=>s.referenceLayers.includes(t.id)).map(t=><div key={t.id} className="mt-3"><h4 className="text-sm font-bold">{t.label}</h4>{t.id==='flood' && <p className="text-xs mb-2">No selection shows all classes.</p>}{Object.entries(t.colors).map(([label,color])=><label key={label} className="flex items-center gap-2 min-h-8 text-xs">{t.id==='flood' && <input type="checkbox" checked={s.activeSusceptibilityFilters.includes(label)} onChange={()=>s.toggleSusceptibilityFilter(label)}/>}<span className="w-5 h-4 border border-black/20 shrink-0" style={{background:label.startsWith('Debris')?'repeating-linear-gradient(135deg,transparent 0 3px,#000 3px 4px)':color}}/>{label}</label>)}</div>)}
    </section>
    <section><h3 className="font-bold">Elements</h3>{ELEMENT_LAYERS.filter(t=>!['roads','lifelines'].includes(t.id)).map(t=><label key={t.id} className="reference-check"><input type="checkbox" checked={s.elementLayers.includes(t.id)} onChange={()=>s.toggleElementLayer(t.id)}/>{t.label}</label>)}<label className="reference-check"><input type="checkbox" checked={s.evacuationCentersVisible} onChange={s.toggleEvacuationCenters}/>Evacuation centers</label>
      <fieldset className="rounded-xl border border-outline-variant p-3 my-3"><legend className="font-semibold px-1">Roads and transport</legend>
        {ELEMENT_LAYERS.filter(t=>['roads','lifelines'].includes(t.id)).map(t=><label key={t.id} className="reference-check"><input type="checkbox" checked={s.elementLayers.includes(t.id)} onChange={()=>s.toggleElementLayer(t.id)}/>{t.label}</label>)}
        <p className="text-xs">Reference locations only; road conditions are unverified.</p>
      </fieldset>
      <p className="text-xs text-on-surface/60">Roads © OpenStreetMap contributors.</p>
    </section>
  </div>;
}
