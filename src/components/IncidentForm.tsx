import { useState } from 'react';
import { X } from 'lucide-react';
import type { Hazard } from '../lib/db';
import { HAZARD_TYPES, hazardDefinition, canonicalLocation } from '../lib/reference';
import { LocationFields } from './ReferenceControls';
import { HazardAPI } from '../lib/api';
import { useStore } from '../lib/store';
import { detectLocationFromGeometry } from '../lib/utils';

export function IncidentForm({record,geometry,onClose}:{record?:Hazard;geometry:any;onClose:()=>void}) {
  const [type,setType]=useState(record?.type ?? 'flood');
  const [severity,setSeverity]=useState(record?.severity ?? 'Moderate');
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
  const unchangedLocation=record && municipality===record.municipality?.trim() && barangay===record.barangay?.trim();
  async function save(event:React.FormEvent) {
    event.preventDefault();
    if(!canonicalLocation(municipality,barangay) && !unchangedLocation) {setError('Select a valid municipality and barangay.');return;}
    const affectedPopulation=affected===''?null:Number(affected);
    if(affectedPopulation!==null && (!Number.isSafeInteger(affectedPopulation) || affectedPopulation<0 || affectedPopulation>100_000_000)) {setError('Affected population must be a whole number from 0 to 100,000,000.');return;}
    setBusy(true);setError('');
    const hazard:Hazard={...record,id:record?.id ?? crypto.randomUUID(),type,severity,title:title.trim() || 'Untitled Incident',municipality,barangay,notes,affectedPopulation,affectedPopulationBasis:basis,geometry,dateAdded:record?.dateAdded ?? new Date().toISOString()};
    try {
      if(record) await HazardAPI.updateHazard(hazard); else await HazardAPI.addHazard(hazard);
      setHazards(await HazardAPI.getAllHazards());
      onClose();
    } catch(e) {setError(e instanceof Error?e.message:'Could not save. Your entries are still here.');}
    finally {setBusy(false);}
  }
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-on-surface/20 backdrop-blur-sm p-4">
    <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="incident-heading" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-2xl p-6 bg-surface-container-lowest shadow-ambient text-on-surface space-y-4">
      <div className="flex justify-between gap-3"><h2 id="incident-heading" className="text-xl font-bold">{record?'Edit Incident Details':'Incident Details'}</h2><button type="button" aria-label="Close incident details" className="min-w-11 min-h-11 grid place-items-center" onClick={onClose} disabled={busy}><X/></button></div>
      <label className="block text-sm font-semibold">Incident Title<input autoFocus className="reference-select mt-1" value={title} maxLength={120} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Flooding at Bagasbas"/></label>
      <LocationFields required municipality={municipality} barangay={barangay} onChange={(m,b)=>{setMunicipality(m);setBarangay(b);setSuggestion('');}}/>
      {!record && <button type="button" className="text-sm underline min-h-11" onClick={async()=>{
        setSuggestion('Looking for a nearby barangay…');
        try {const result=await detectLocationFromGeometry(geometry);const location=result && canonicalLocation(result.municipality,result.barangay);
          if(location){setMunicipality(location.municipality);setBarangay(location.barangay);setSuggestion('Suggested from the nearest reference point. Confirm the location; this is not a boundary check.');}
          else setSuggestion('No nearby reference point found. Select the location manually.');
        }catch {setSuggestion('Location suggestion unavailable. Select the location manually.');}
      }}>Suggest nearby location</button>}
      {suggestion && <p role="status" className="text-xs">{suggestion}</p>}
      <label className="block text-sm font-semibold">Hazard Type<select className="reference-select mt-1" value={type} onChange={e=>setType(e.target.value)}>
        {!HAZARD_TYPES.some(t=>t.id===type) && <option value={type}>{hazardDefinition(type)?.label || type}</option>}
        {HAZARD_TYPES.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
      </select></label>
      <label className="block text-sm font-semibold">Severity Level<select className="reference-select mt-1" value={severity} onChange={e=>setSeverity(e.target.value)}>{['Minor','Moderate','Severe','Critical'].map(s=><option key={s}>{s}</option>)}</select></label>
      <label className="block text-sm font-semibold">Affected Population<input type="number" min={0} max={100000000} step={1} className="reference-select mt-1" value={affected} onChange={e=>{setAffected(e.target.value);setBasis('reported');}} placeholder="Unknown"/></label>
      <p className="text-xs text-on-surface/60">Leave blank if unknown. Enter 0 only when zero affected people is confirmed.</p>
      <section className="rounded-xl border border-outline-variant p-3 space-y-2">
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
        {geometry?.type==='LineString' && <p className="text-xs">Draw an incident polygon or use a point with a radius for population analysis.</p>}
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
      </section>
      <label className="block text-sm font-semibold">Field Notes<textarea className="reference-select mt-1" rows={3} maxLength={4000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
      {error && <p role="alert" className="text-primary">{error}</p>}
      <button disabled={busy} className="btn-primary w-full min-h-12 disabled:opacity-50">{busy?'Saving…':record?'Save Changes':'Save Incident'}</button>
    </form>
  </div>;
}
