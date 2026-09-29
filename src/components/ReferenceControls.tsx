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
      <p className="text-on-surface/60">Multiple classes can occur within a barangay. No recorded class does not mean safe. Tsunami workbook classes are separate from map depth bands.</p>
      {Object.entries(p.demographics).map(([label,value])=><p key={label}>{label}: {value===null?'Not supplied':value.toLocaleString()}</p>)}
    </div>)}
    {elementLayers.includes('population') && <div className="rounded-xl border border-outline-variant p-3">
      <strong>Population · {m || 'Province'}</strong>{b && <p>This population summary covers the municipality. Use the incident area to calculate exposed people.</p>}
      {hh.length ? <><p>{hh.reduce((n,h)=>n+h.sourceRecords,0).toLocaleString()} population source records; record count is not a person count.</p><p>Reported population sum: {hh.some(h=>h.populationSum===null)?'Incomplete':hh.reduce((n,h)=>n+(h.populationSum ?? 0),0).toLocaleString()}.</p><p>{hh.reduce((n,h)=>n+h.duplicateIdExcess,0).toLocaleString()} duplicate-ID excess records retained for review.</p></> : <p>No population file supplied for this municipality.</p>}
      <p>Points require authorization, a municipality and zoom 14+. Barangay filtering uses source labels; Paracale has no labels. Talisay covers 11 of 15 barangays. Santa Elena and San Vicente files are missing.</p>
    </div>}
    <p className="text-on-surface/60">Source: supplied Barangay_Data_ForUpload workbook. Workbook totals are separate from the supplied HH-prefixed population dataset.</p>
  </div>;
}
export function IncidentFilters() {
  const s = useStore();
  return <details className="border border-outline-variant/40 rounded-xl p-3">
    <summary className="min-h-11 cursor-pointer font-semibold text-sm">Hazard Type · {s.activeFilters.length} selected</summary>
    {HAZARD_TYPES.map(t=><label key={t.id} className="reference-check"><input type="checkbox" checked={s.activeFilters.includes(t.id)} onChange={()=>s.toggleFilter(t.id)}/><span aria-hidden="true" style={{color:t.color}}>{t.symbol}</span>{t.label}</label>)}
    {s.hazards.some(h=>LEGACY_TYPES.some(t=>t.id===h.type)) && <label className="reference-check"><input type="checkbox" checked={LEGACY_TYPES.some(t=>s.activeFilters.includes(t.id))} onChange={e=>{const checked=e.target.checked;LEGACY_TYPES.forEach(t=>{if(s.activeFilters.includes(t.id)!==checked)s.toggleFilter(t.id);});}}/>Include legacy records</label>}
    <p className="text-xs text-on-surface/60">No selected types shows no incidents. These filters also apply to analytics.</p>
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
    <section><h3 className="font-bold">Reference Hazards</h3><p className="text-xs mt-1 mb-2">Select layers to show susceptibility and inundation zones.</p>
      <details className="border border-outline-variant/40 rounded-xl p-3"><summary className="min-h-11 cursor-pointer text-sm font-semibold">Hazard layers · {s.referenceLayers.length} selected</summary>
      {REFERENCE_LAYERS.map(t=><label key={t.id} className="reference-check"><input type="checkbox" checked={s.referenceLayers.includes(t.id)} onChange={()=>s.toggleReferenceLayer(t.id)}/>{t.label}</label>)}</details>
      {REFERENCE_LAYERS.filter(t=>s.referenceLayers.includes(t.id)).map(t=><div key={t.id} className="mt-3"><h4 className="text-sm font-bold">{t.label}</h4><p className="text-xs mb-2">{t.id==='flood'?'Select classes; none selected shows all classes.':'Legend · source classes'}</p>{Object.entries(t.colors).map(([label,color])=><label key={label} className="flex items-center gap-2 min-h-8 text-xs">{t.id==='flood' && <input type="checkbox" checked={s.activeSusceptibilityFilters.includes(label)} onChange={()=>s.toggleSusceptibilityFilter(label)}/>}<span className="w-5 h-4 border border-black/20 shrink-0" style={{background:label.startsWith('Debris')?'repeating-linear-gradient(135deg,transparent 0 3px,#000 3px 4px)':color}}/>{label}</label>)}</div>)}
      <p className="text-xs text-on-surface/60 mt-2">Storm surge, erosion and groundshaking reference datasets were not supplied.</p>
    </section>
    <section><label className="reference-check font-bold"><input type="checkbox" checked={s.incidentsVisible} onChange={s.toggleIncidents}/>Incident overlays</label><IncidentFilters/></section>
    <section><h3 className="font-bold">Elements</h3>{ELEMENT_LAYERS.filter(t=>!['roads','lifelines'].includes(t.id)).map(t=><label key={t.id} className="reference-check"><input type="checkbox" checked={s.elementLayers.includes(t.id)} onChange={()=>s.toggleElementLayer(t.id)}/>{t.label}</label>)}<label className="reference-check"><input type="checkbox" checked={s.evacuationCentersVisible} onChange={s.toggleEvacuationCenters}/>Evacuation centers</label>
      <fieldset className="rounded-xl border border-outline-variant p-3 my-3"><legend className="font-semibold px-1">Lifeline Utilities</legend>
        {ELEMENT_LAYERS.filter(t=>['roads','lifelines'].includes(t.id)).map(t=><label key={t.id} className="reference-check"><input type="checkbox" checked={s.elementLayers.includes(t.id)} onChange={()=>s.toggleElementLayer(t.id)}/>{t.label}</label>)}
        <p className="text-xs">Transport facilities reuse the supplied CPF records; enabling both displays each point once. Roads and transport are reference locations, not live service or passability reports.</p>
        <ul className="text-xs mt-2 list-disc pl-4"><li>Power network: data not supplied</li><li>Water network: data not supplied</li><li>Telecommunications network: data not supplied</li></ul>
      </fieldset>
      <p className="text-xs text-on-surface/60">Facilities use category symbols. Three facility coordinates and six population coordinates are withheld pending correction. Roads © OpenStreetMap contributors. Utility networks were not supplied.</p>
    </section>
  </div>;
}
