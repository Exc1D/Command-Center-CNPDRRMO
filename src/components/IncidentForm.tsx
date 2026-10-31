import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Hazard } from '../lib/db';
import { HAZARD_TYPES, ROAD_STATUS, hazardDefinition, canonicalLocation } from '../lib/reference';
import { LocationFields } from './ReferenceControls';
import { SymbolOptions } from './SymbolOptions';
import { PLANNING_SYMBOLS } from '../lib/planning';
import { HazardAPI } from '../lib/api';
import { useStore } from '../lib/store';
import { detectLocationFromGeometry } from '../lib/utils';

export function IncidentForm({record,geometry,onClose}:{record?:Hazard;geometry:any;onClose:()=>void}) {
  const [type,setType]=useState(record?.type ?? 'flood');
  const [symbolKey,setSymbolKey]=useState(record?.symbolKey ?? '');
  const [kind,setKind]=useState(record?.type === 'resource' || record?.type === 'road' ? record.type : record || geometry?.type!=='LineString' ? 'incident' : 'road');
  const isResource=kind==='resource', isRoad=kind==='road';
  const [severity,setSeverity]=useState(record?.severity ?? 'Moderate');
  const [roadStatus,setRoadStatus]=useState(isRoad && record ? record.severity : 'Not passable');
  const [title,setTitle]=useState(record?.title ?? '');
  const [municipality,setMunicipality]=useState(record?.municipality?.trim() ?? '');
  const [barangay,setBarangay]=useState(record?.barangay?.trim() ?? '');
  const [notes,setNotes]=useState(record?.notes ?? '');
  const [affected,setAffected]=useState(record?.affectedPopulation?.toString() ?? '');
  const [basis,setBasis]=useState<'reported'|'population_estimate'>(record?.affectedPopulationBasis ?? 'reported');
  const [radius,setRadius]=useState('');
  const [estimate,setEstimate]=useState<null | {matchedRecords:number;populationSum:number;missingPopulationRecords:number;duplicateIdRecords:number;method:string;calculatedAt:string;coverageNote:string;unavailableMunicipalities:string[]}>(null);
  const [estimating,setEstimating]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [suggestion,setSuggestion]=useState('');
  const setHazards=useStore(s=>s.setHazards);
  // New pins fill the location from the map boundaries so the reporter only confirms or corrects it.
  useEffect(()=>{
    if(record) return;
    let cancelled=false;
    setSuggestion('Finding the nearest barangay…');
    detectLocationFromGeometry(geometry).then(result=>{
      if(cancelled) return;
      const location=result && canonicalLocation(result.municipality,result.barangay);
      if(location){setMunicipality(m=>m || location.municipality);setBarangay(b=>b || location.barangay);setSuggestion('Filled in from where you placed the pin. Change it if it is wrong.');}
      else setSuggestion('No nearby barangay found. Choose the location.');
    }).catch(()=>{ if(!cancelled) setSuggestion('Could not find the location automatically. Choose it below.'); });
    return ()=>{cancelled=true;};
  },[record,geometry]);
  const unchangedLocation=record && municipality===record.municipality?.trim() && barangay===record.barangay?.trim();
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(!canonicalLocation(municipality,barangay) && !unchangedLocation) {setError('Select a valid municipality and barangay.');return;}
    const affectedPopulation=isResource || isRoad || affected===''?null:Number(affected);
    if(isResource && !symbolKey) {setError('Choose a resource symbol.');return;}
    if(affectedPopulation!==null && (!Number.isSafeInteger(affectedPopulation) || affectedPopulation<0 || affectedPopulation>100_000_000)) {setError('Affected population must be a whole number from 0 to 100,000,000.');return;}
    setBusy(true);setError('');
    const place=barangay?` – ${barangay}`:'';
    const defaultTitle=isResource?PLANNING_SYMBOLS.find(symbol=>symbol.key===symbolKey)?.label:isRoad?`Road or bridge${place}`:`${hazardDefinition(type)?.label || 'Incident'}${place}`;
    const hazard:Hazard={...record,id:record?.id ?? crypto.randomUUID(),type:isResource || isRoad?kind:type,symbolKey:symbolKey || null,severity:isResource?'Not applicable':isRoad?roadStatus:severity,title:title.trim() || defaultTitle,municipality,barangay,notes,affectedPopulation,affectedPopulationBasis:isResource || isRoad?'reported':basis,geometry,dateAdded:record?.dateAdded ?? new Date().toISOString()};
    try {
      if(record) await HazardAPI.updateHazard(hazard); else await HazardAPI.addHazard(hazard);
      setHazards(await HazardAPI.getAllHazards());
      onClose();
    } catch(e) {setError(e instanceof Error?e.message:'Could not save. Your entries are still here.');}
    finally {setBusy(false);}
  }
  const symbolField=geometry?.type==='Point' && <label className="block text-sm font-semibold">Pin symbol<select className="reference-select mt-1" value={symbolKey} onChange={e=>setSymbolKey(e.target.value)}>
        <option value="">{isResource?'Choose a resource symbol':isRoad?'Use road icon':'Use hazard icon'}</option>
        <SymbolOptions />
      </select><span className="block text-xs font-normal mt-1">{isResource || isRoad?'Uses the same symbols as Planning.':'Uses the same symbols as Planning. Hazard type and severity stay with the incident.'}</span></label>;
  return <div className="backdrop-in fixed inset-0 z-[1000] flex items-center justify-center bg-on-surface/20 backdrop-blur-sm p-4">
    <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="incident-heading" className="sheet-in w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl p-6 bg-surface-container-lowest shadow-ambient text-on-surface space-y-4">
      <div className="flex justify-between gap-3"><h2 id="incident-heading" className="text-xl font-bold">{isRoad?(record?'Edit Road or Bridge Status':'Road or Bridge Status'):isResource?(record?'Edit Resource Pin':'Resource Pin Details'):(record?'Edit Incident Details':'Incident Details')}</h2><button type="button" aria-label="Close incident details" className="min-w-11 min-h-11 grid place-items-center" onClick={onClose} disabled={busy}><X/></button></div>
      {!record && <label className="block text-sm font-semibold">Pin type<select className="reference-select mt-1" value={kind} onChange={e=>setKind(e.target.value)}><option value="incident">Incident</option>{geometry?.type==='Point' && <option value="resource">Resource</option>}<option value="road">Road or bridge status</option></select></label>}
      <label className="block text-sm font-semibold">{isResource?'Resource title':isRoad?'Road or bridge name':'Incident Title'} <span className="font-normal text-on-surface/60">(optional)</span><input autoFocus className="reference-select mt-1" value={title} maxLength={120} onChange={e=>setTitle(e.target.value)} placeholder={isResource?'e.g. Ambulance Team Alpha':isRoad?'e.g. Bagasbas Bridge':'e.g. Flooding at Bagasbas'}/></label>
      <LocationFields required municipality={municipality} barangay={barangay} onChange={(m,b)=>{setMunicipality(m);setBarangay(b);setSuggestion('');}}/>
      {suggestion && <p role="status" className="text-xs">{suggestion}</p>}
      {isRoad && <label className="block text-sm font-semibold">Road status<select className="reference-select mt-1" value={roadStatus} onChange={e=>setRoadStatus(e.target.value)}>{Object.keys(ROAD_STATUS).map(s=><option key={s}>{s}</option>)}</select></label>}
      {kind==='incident' && <label className="block text-sm font-semibold">Hazard Type<select className="reference-select mt-1" value={type} onChange={e=>setType(e.target.value)}>
        {!HAZARD_TYPES.some(t=>t.id===type) && <option value={type}>{hazardDefinition(type)?.label || type}</option>}
        {HAZARD_TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
      </select></label>}
      {isResource && symbolField}
      {kind==='incident' && <><label className="block text-sm font-semibold">Severity Level<select className="reference-select mt-1" value={severity} onChange={e=>setSeverity(e.target.value)}>{['Minor','Moderate','Severe','Critical'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label className="block text-sm font-semibold">Affected Population<input type="number" min={0} max={100000000} step={1} className="reference-select mt-1" value={affected} onChange={e=>{setAffected(e.target.value);setBasis('reported');}} placeholder="Unknown"/></label>
      <p className="text-xs text-on-surface/60">Leave blank if unknown. Enter 0 only when zero affected people is confirmed.</p>
      </>}
      {!isResource && (kind==='incident' || geometry?.type==='Point') && <details className="rounded-xl border border-outline-variant p-3"><summary className="text-sm font-semibold cursor-pointer min-h-8">More options</summary><div className="space-y-4 mt-3">
      {symbolField}
      {kind==='incident' && <section className="space-y-2">
        <h3 className="text-sm font-bold">Estimate from population data</h3>
        <p className="text-xs">Counts source population within the incident area. Review coverage and data issues before using the estimate.</p>
        {geometry?.type==='Point' && <label className="block text-sm">Analysis radius (metres)<input type="number" min={1} max={50000} value={radius} className="reference-select mt-1" placeholder="Choose the incident impact radius" onChange={e=>{setRadius(e.target.value);setEstimate(null);}}/></label>}
        <button type="button" className="reference-select font-semibold disabled:opacity-50" disabled={estimating || geometry?.type==='LineString' || (geometry?.type==='Point' && (!radius || Number(radius)<=0 || Number(radius)>50000))} onClick={async()=>{
          setEstimating(true);setError('');setEstimate(null);
          try {
            const response=await fetch('/api/reference/population-exposure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({geometry,...(geometry.type==='Point'?{radiusMetres:Number(radius)}:{})})});
            const data=await response.json();
            if(!response.ok) throw new Error(data.error || 'Population estimate unavailable');
            setEstimate(data);
          }catch(e){setError(e instanceof Error?e.message:'Population estimate unavailable. Existing entries are preserved.');}
          finally{setEstimating(false);}
        }}>{estimating?'Calculating population exposure…':'Calculate population exposure'}</button>
        {geometry?.type==='LineString' && <p className="text-xs">Population analysis is unavailable for saved lines. Use an incident pin with a radius.</p>}
        {estimate && <div role="status" className="text-xs space-y-2">
          <p><strong>Source population sum: {estimate.populationSum.toLocaleString()}</strong> across {estimate.matchedRecords.toLocaleString()} matching records.</p>
          <p>Missing population counts: {estimate.missingPopulationRecords}; records with duplicate IDs: {estimate.duplicateIdRecords}.</p>
          <p>{estimate.method}. Missing municipality files: {estimate.unavailableMunicipalities.join(', ') || 'None'}.</p>
          <p>{estimate.coverageNote}</p>
          <button type="button" className="reference-select font-bold" disabled={estimate.matchedRecords===estimate.missingPopulationRecords} onClick={()=>{
            setAffected(String(estimate.populationSum));setBasis('population_estimate');
            const provenance='Population-data provisional estimate: '+estimate.method+'; '+estimate.populationSum+' source population / '+estimate.matchedRecords+' records; '+estimate.missingPopulationRecords+' missing counts; '+estimate.duplicateIdRecords+' duplicate-ID records; calculated '+estimate.calculatedAt+'. Field verification required.';
            setNotes(current=>(current+'\n'+provenance).trim());
          }}>Use as provisional estimate</button>
        </div>}
        <p className="text-xs font-semibold">Population basis: {basis==='population_estimate'?'Provisional population estimate':'Field report / manual entry'}</p>
      </section>}</div></details>}
      <label className="block text-sm font-semibold">Field Notes<textarea className="reference-select mt-1" rows={3} maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      {error && <p role="alert" className="text-primary">{error}</p>}
      <button disabled={busy} className="btn-primary w-full min-h-12 disabled:opacity-50">{busy?'Saving…':record?'Save Changes':isResource?'Save Resource Pin':isRoad?'Save Road Status':'Save Incident'}</button>
    </form>
  </div>;
}
