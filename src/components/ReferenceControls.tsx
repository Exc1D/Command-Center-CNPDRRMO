import { useId } from 'react';
import { HazardLegend } from './HazardLegend';
import { useStore } from '../lib/store';
import { barangaysFor, municipalities, HAZARD_TYPES, REFERENCE_LAYERS, ELEMENT_LAYERS, LEGACY_TYPES } from '../lib/reference';
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
// Municipality-level population records; the location card on the map covers area and barangay facts.
export function PopulationRecords() {
  const m = useStore(s=>s.selectedMunicipality);
  const hh = population.filter(h=>!m || h.municipality===m);
  return <div className="text-xs space-y-1 leading-relaxed rounded-xl bg-surface-container-low p-3 mt-2">
    <strong>Population records · {m || 'Province'}</strong>
    {hh.length ? <><p>{hh.reduce((n,h)=>n+h.sourceRecords,0).toLocaleString()} household records (not people).</p><p>Reported population sum: {hh.some(h=>h.populationSum===null)?'Incomplete':hh.reduce((n,h)=>n+(h.populationSum ?? 0),0).toLocaleString()}.</p><p>{hh.reduce((n,h)=>n+h.duplicateIdExcess,0).toLocaleString()} records share an ID with another record and are kept for review.</p></> : <p>No population file supplied for this municipality.</p>}
    <p>Population coverage is incomplete; data year unconfirmed.</p>
  </div>;
}
export function ReferenceControls() {
  const s=useStore();
  const allTypes=HAZARD_TYPES.map(t=>t.id);
  const hasLegacy=s.hazards.some(h=>LEGACY_TYPES.some(t=>t.id===h.type));
  const legacyOn=LEGACY_TYPES.some(t=>s.activeFilters.includes(t.id));
  const shownTypes=s.activeFilters.filter(id=>allTypes.includes(id));
  const incidentType=shownTypes.length===allTypes.length?'':shownTypes.length===1?shownTypes[0]:'mixed';
  const check=(id:string)=><label key={id} className="reference-check"><input type="checkbox" checked={s.elementLayers.includes(id)} onChange={()=>s.toggleElementLayer(id)}/>{ELEMENT_LAYERS.find(t=>t.id===id)!.label}</label>;
  return <div className="space-y-5">
    <section className="space-y-3"><h3 className="font-bold">Location</h3>
      <p className="text-xs">Click a municipality on the map, then a barangay. Or pick one here.</p>
      <LocationFields municipality={s.selectedMunicipality} barangay={s.selectedBarangay} onChange={(m,b)=>{
        s.setLocationFilter(m,b);
        const points=barangaysFor(m); const point=points.find(p=>p.name===b);
        if(point) s.flyTo([point.lat,point.lng],MAP_CONFIG.BARANGAY_ZOOM);
        else if(points.length) s.flyTo([points.reduce((n,p)=>n+p.lat,0)/points.length,points.reduce((n,p)=>n+p.lng,0)/points.length],MAP_CONFIG.MUNICIPALITY_ZOOM);
        else s.flyTo(MAP_CONFIG.PROVINCE_CENTER,MAP_CONFIG.DEFAULT_ZOOM);
      }}/>
    </section>
    <label className="block font-bold">Basemap<select className="reference-select mt-2" aria-label="Basemap" value={s.baseMap} onChange={e=>s.setBaseMap(e.target.value as typeof s.baseMap)}><option value="" disabled>Select basemap</option><option value="street">Street · OpenStreetMap</option><option value="topo">Topographic · OpenTopoMap</option><option value="satellite">Satellite · Esri</option></select></label>
    <label className="block font-bold">Hazard zones<select className="reference-select mt-2" aria-label="Hazard zones" value={s.referenceLayers[0] ?? ''} onChange={e=>useStore.setState({referenceLayers:e.target.value?[e.target.value]:[]})}>
      <option value="">Select hazard</option>
      {REFERENCE_LAYERS.map(layer=><option key={layer.id} value={layer.id}>{layer.label}</option>)}
    </select></label>
    {/* The legend sits right under the hazard choice so the colors are explained whenever a zone layer is on. */}
    {s.referenceLayers.length>0 && <HazardLegend filterFlood />}
    <section className="space-y-2"><h3 className="font-bold">Incidents</h3>
      <div className="elements-group">
        <label className="reference-check"><input type="checkbox" checked={s.incidentsVisible} onChange={s.toggleIncidents}/>Show incidents and resource pins</label>
        <select className="reference-select" aria-label="Incident type" disabled={!s.incidentsVisible} value={incidentType} onChange={e=>s.setFilters([...s.activeFilters.filter(id=>!allTypes.includes(id)),...(e.target.value?[e.target.value]:allTypes)])}>
          <option value="">All incident types</option>
          {incidentType==='mixed' && <option value="mixed" disabled>Several types</option>}
          {HAZARD_TYPES.map(t=><option key={t.id} value={t.id}>{t.symbol} {t.label}</option>)}
        </select>
        {hasLegacy && <label className="reference-check text-xs"><input type="checkbox" disabled={!s.incidentsVisible} checked={legacyOn} onChange={()=>LEGACY_TYPES.forEach(t=>s.toggleFilter(t.id))}/>Include legacy records</label>}
      </div>
    </section>
    <section className="space-y-2"><h3 className="font-bold">Elements</h3>
      <div className="elements-group">
        {check('facilities')}
        <p className="text-xs">Includes transport facilities: ports, airport and terminals.</p>
        {check('population')}
        {s.elementLayers.includes('population') && <PopulationRecords/>}
        {check('rivers')}
        <label className="reference-check"><input type="checkbox" checked={s.evacuationCentersVisible} onChange={s.toggleEvacuationCenters}/>Evacuation centers</label>
        <div role="group" aria-label="Lifeline Utilities" className="pt-2 mt-2 border-t border-outline-variant/40">
          <p className="text-xs font-semibold uppercase tracking-wide">Lifeline Utilities</p>
          {check('roads')}
          <p className="text-xs">Road Network: reference locations only; road conditions are unverified. Roads © OpenStreetMap contributors.</p>
        </div>
      </div>
    </section>
  </div>;
}
