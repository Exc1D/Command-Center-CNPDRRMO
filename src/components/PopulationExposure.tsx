import { useEffect, useState } from 'react';
import { useStore } from '../lib/store';
import { canonicalLocation, FLOOD_COLORS, REFERENCE_LAYERS } from '../lib/reference';
import type { ExposureCounts, LayerExposureResult } from '../server/layerExposure';

const populationText=(counts:ExposureCounts)=>counts.matchedRecords>0 && counts.matchedRecords===counts.missingPopulationRecords?'Unknown':counts.populationSum.toLocaleString();
export function PopulationExposure() {
  const s=useStore();
  const [result,setResult]=useState<{key:string;data:LayerExposureResult}|null>(null);
  const [error,setError]=useState('');
  const [retry,setRetry]=useState(0);
  const key=JSON.stringify({layers:s.referenceLayers,floodClasses:s.activeSusceptibilityFilters,municipality:s.selectedMunicipality,barangay:s.selectedBarangay});
  const ready=s.isMapAuthorized && s.referenceLayers.length>0;
  useEffect(()=>{
    setResult(null);setError('');
    if(!ready) return;
    const controller=new AbortController();
    (async()=>{
      try {
        const response=await fetch('/api/reference/layer-exposure',{method:'POST',headers:{'Content-Type':'application/json'},body:key,signal:controller.signal,cache:'no-store'});
        const data=await response.json();
        if(!response.ok) {
          if(response.status===401) useStore.getState().setMapAuthorized(false);
          throw new Error(data.error || 'Population analysis failed. Please retry.');
        }
        if(!controller.signal.aborted) setResult({key,data});
      }catch(e){if(!controller.signal.aborted) setError(e instanceof Error?e.message:'Unable to reach the analysis service. Please retry.');}
    })();
    return ()=>controller.abort();
  },[key,ready,retry]);
  const data=ready && result?.key===key?result.data:null;
  const available=!!data?.available.matchedRecords;
  return <section className="space-y-4 text-sm" aria-label="Hazard–population exposure">
    <div><h3 className="font-bold text-lg">Population exposed to selected hazards</h3><p className="mt-1 text-on-surface/70">Provisional estimates, not confirmed affected-person counts.</p></div>
    <fieldset><legend className="font-semibold">Hazard layers</legend><div className="grid sm:grid-cols-2 gap-x-4">{REFERENCE_LAYERS.map(layer=><label key={layer.id} className="reference-check"><input type="checkbox" checked={s.referenceLayers.includes(layer.id)} onChange={()=>s.toggleReferenceLayer(layer.id)}/>{layer.label}</label>)}</div></fieldset>
    {s.referenceLayers.includes('flood') && <fieldset><legend className="font-semibold">Flood susceptibility classes</legend><div className="flex flex-wrap gap-x-5">{Object.keys(FLOOD_COLORS).map(label=><label key={label} className="reference-check"><input type="checkbox" checked={s.activeSusceptibilityFilters.includes(label)} onChange={()=>s.toggleSusceptibilityFilter(label)}/>{label}</label>)}</div><p className="text-xs">No selection includes all classes.</p></fieldset>}
    {!s.referenceLayers.length && <p role="status">Select a hazard layer to calculate exposure.</p>}
    {!s.isMapAuthorized && <div><p>Unlock operations to analyze the private population dataset.</p><button className="nav-text-button underline" onClick={()=>s.openPinModal('unlock')}>Unlock population analysis</button></div>}
    {ready && !data && !error && <p role="status">Calculating population exposure…</p>}
    {error && <div role="alert"><p>{error}</p><button className="nav-text-button underline" onClick={()=>setRetry(v=>v+1)}>Retry analysis</button></div>}
    {data && <>
      <div role="status" className="py-4 border-y border-outline-variant space-y-2">
        <h4 className="font-bold">Combined exposure · {s.selectedBarangay || s.selectedMunicipality || 'Camarines Norte'}</h4>
        <p className="text-lg"><strong>{available?populationText(data.exposed):'No population data'}</strong>{available && ' source population within at least one selected hazard'}</p>
        <p>{data.exposed.matchedRecords.toLocaleString()} matching source records · {data.exposed.missingPopulationRecords.toLocaleString()} without population counts · {data.exposed.duplicateIdRecords.toLocaleString()} with duplicate IDs</p>
        <p className="text-xs">Duplicates remain unresolved.{available && <> Population in more than one selected hazard type: {populationText(data.multipleHazards)}.</>}</p>
      </div>
      <section aria-label="Exposure comparison" className="space-y-4">
        <h4 className="font-bold">Compare selected hazards</h4>
        <p className="text-xs">{data.available.populationSum>0?`Bars show the share of the ${populationText(data.available)} known source population in this location.`:'Population percentages cannot be calculated without a known, positive population total.'} Hazard totals overlap and must not be added together.</p>
        {data.byLayer.map(layer=>{
          const percent=data.available.populationSum>0 && (layer.matchedRecords===0 || layer.matchedRecords>layer.missingPopulationRecords)?100*layer.populationSum/data.available.populationSum:null;
          return <div key={layer.id} className="space-y-1"><div className="flex justify-between gap-3"><span>{layer.label}</span><strong>{available?populationText(layer):'No data'}{percent!==null?` (${percent.toFixed(1)}%)`:''}</strong></div><div aria-hidden="true" className="h-2 bg-surface-container-high rounded-full overflow-hidden"><div className="h-full bg-tertiary" style={{width:`${percent ?? 0}%`}}/></div><p className="text-xs text-on-surface/70">{layer.matchedRecords.toLocaleString()} records; {layer.missingPopulationRecords.toLocaleString()} missing counts</p></div>;
        })}
      </section>
      <details className="border-y border-outline-variant py-2"><summary className="min-h-11 cursor-pointer font-semibold py-3">Susceptibility and inundation breakdown</summary><div className="overflow-x-auto"><table className="w-full text-sm"><caption className="text-left text-xs py-2">Classes can overlap. Depth bands retain the tsunami source labels.</caption><thead><tr>{['Hazard / class','Source population','Missing counts'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{data.byClass.map(c=><tr key={c.id} className="border-t border-outline-variant/40"><th className="p-2 text-left font-medium">{REFERENCE_LAYERS.find(l=>l.id===c.layer)?.label}<br/><span className="text-xs font-normal">{c.label}</span></th><td className="p-2">{available?populationText(c):'No data'}</td><td className="p-2">{c.missingPopulationRecords.toLocaleString()}</td></tr>)}</tbody></table></div></details>
      <details className="border-b border-outline-variant pb-2"><summary className="min-h-11 cursor-pointer font-semibold">Municipality and barangay breakdown · {data.byLocation.length} locations</summary><div className="overflow-x-auto"><table className="w-full min-w-[520px] text-sm"><caption className="text-left font-bold mb-2">Combined exposure by location</caption><thead><tr>{['Municipality','Barangay','Source population','Matching records','Missing counts'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{data.byLocation.map(row=><tr key={JSON.stringify([row.municipality,row.barangay])} className="border-t border-outline-variant/40"><td className="p-2">{row.municipality}</td><th className="p-2 text-left font-medium">{row.barangay && canonicalLocation(row.municipality,row.barangay)?<button className="underline min-h-11" onClick={()=>s.setLocationFilter(row.municipality,row.barangay!)}>{row.barangay}</button>:row.barangay || 'Unassigned in source'}</th><td className="p-2">{populationText(row.exposed)}</td><td className="p-2">{row.exposed.matchedRecords.toLocaleString()}</td><td className="p-2">{row.exposed.missingPopulationRecords.toLocaleString()}</td></tr>)}</tbody></table></div></details>
      {!available && <p>No population records are available for this location. Exposure cannot be determined.</p>}
      {available && data.exposed.matchedRecords===0 && <p>No source points match these hazard zones. This does not establish zero risk or zero affected people.</p>}
      <section className="space-y-2 text-xs"><h4 className="font-bold text-sm">Coverage gaps</h4>
        {!!data.unavailableMunicipalities.length && <p>Population files missing: {data.unavailableMunicipalities.join(', ')}.</p>}
        {(!s.selectedMunicipality || s.selectedMunicipality==='Talisay') && <p>Talisay lacks Cahabaan, Del Carmen, San Isidro and San Jose population coverage.</p>}
        {(!s.selectedMunicipality || s.selectedMunicipality==='Paracale') && <p>Paracale records lack population values and barangay labels; person counts and barangay exposure are unknown.</p>}
        {!!data.unlocatedRecords && <p>{data.unlocatedRecords.toLocaleString()} records have no barangay label in this municipality scope.{s.selectedBarangay?' They are excluded from this barangay result.':' They appear as unassigned.'}</p>}
        <p>Coverage is incomplete; data year unconfirmed.</p>
      </section>
    </>}
  </section>;
}
