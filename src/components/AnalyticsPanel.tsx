import { resolveModernColors } from '../lib/resolveModernColors';
import { useState } from 'react';
import { X, Download, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useStore } from '../lib/store';
import { hazardDefinition, municipalities, canonicalLocation, REFERENCE_LAYERS, HAZARD_TYPES } from '../lib/reference';
import { MAP_CONFIG } from '../lib/constants';
import { PopulationExposure } from './PopulationExposure';
import { LocationFields, IncidentFilters } from './ReferenceControls';
import type { Hazard, EvacuationCenter } from '../lib/db';

const severities=['Minor','Moderate','Severe','Critical'];
const colors=['#6b7280','#b77900','#c2410c','#b91c1c'];
const same=(a='',b='')=>a.trim().toLowerCase()===b.trim().toLowerCase();

export type Place={name:string;municipality:string;barangay:string;counts:number[];total:number;affected:number;unknown:number;centers:number;capacity:number};
// Groups incidents and evacuation centers by municipality (province view) or barangay (municipality view).
export function summarizePlaces(rows:Hazard[],centers:EvacuationCenter[],byBarangay:boolean):Place[] {
  const places=new Map<string,Place>();
  const placeFor=(m='',b='')=>{
    const loc=canonicalLocation(m,b);
    const municipality=loc?.municipality ?? municipalities.find(v=>same(v,m)) ?? '';
    const name=byBarangay?loc?.barangay ?? (b.trim() || 'Unknown barangay'):municipality || 'Unresolved location';
    const key=JSON.stringify([municipality,name.toLowerCase()]);
    if(!places.has(key)) places.set(key,{name,municipality,barangay:byBarangay?loc?.barangay ?? '':'',counts:[0,0,0,0],total:0,affected:0,unknown:0,centers:0,capacity:0});
    return places.get(key)!;
  };
  for(const h of rows) {
    const p=placeFor(h.municipality,h.barangay);
    const severity=severities.indexOf(h.severity);
    if(severity>=0) p.counts[severity]++;
    p.total++;
    if(h.affectedPopulation==null) p.unknown++; else p.affected+=h.affectedPopulation;
  }
  for(const c of centers) {const p=placeFor(c.municipality,c.barangay);p.centers++;p.capacity+=c.capacity;}
  return [...places.values()];
}
export function rankPlaces(places:Place[]) {
  return places.filter(p=>p.total>0).sort((a,b)=>b.counts[3]-a.counts[3]||b.counts[2]-a.counts[2]||b.total-a.total||a.name.localeCompare(b.name));
}
export function shelterStatus(p:Place) {
  if(!p.unknown && !p.affected) return {label:'No one reported affected',rank:4,tone:'var(--color-success)',Icon:CheckCircle2};
  if(!p.centers) return {label:'No evacuation center recorded',rank:0,tone:colors[3],Icon:AlertTriangle};
  if(p.unknown===p.total) return {label:'Affected count not reported',rank:2,tone:colors[0],Icon:HelpCircle};
  if(p.affected>p.capacity) return {label:`Short by ${(p.affected-p.capacity).toLocaleString()} spaces`,rank:1,tone:colors[2],Icon:AlertTriangle};
  return {label:'Enough space',rank:3,tone:'var(--color-success)',Icon:CheckCircle2};
}
export function shelterReadiness(places:Place[]) {
  return places.filter(p=>p.total>0).map(p=>({...p,status:shelterStatus(p)})).sort((a,b)=>a.status.rank-b.status.rank||(b.affected-b.capacity)-(a.affected-a.capacity)||a.name.localeCompare(b.name));
}
export const severityText=(counts:number[])=>[3,2,1,0].filter(i=>counts[i]).map(i=>`${counts[i]} ${severities[i].toLowerCase()}`).join(' · ');
function firstPoint(geometry:any):[number,number]|null {
  let c=geometry?.coordinates;
  while(Array.isArray(c?.[0])) c=c[0];
  return Array.isArray(c) && typeof c[0]==='number'?[c[1],c[0]]:null;
}

function Tile({label,value,detail}:{label:string;value:string;detail?:string}) {
  return <div className="rounded-2xl bg-surface-container-low border border-outline-variant/60 p-4">
    <p className="text-sm text-on-surface/70">{label}</p>
    <p className="text-3xl font-bold mt-1 tabular-nums">{value}</p>
    {detail && <p className="text-sm text-on-surface/70 mt-1">{detail}</p>}
  </div>;
}
function SeverityBar({counts,total,max}:{counts:number[];total:number;max:number}) {
  return <div aria-hidden="true" className="h-3 rounded-full bg-surface-container-high overflow-hidden flex" style={{width:`${Math.max(8,100*total/max)}%`}}>
    {[3,2,1,0].map(i=>counts[i]>0 && <div key={i} style={{width:`${100*counts[i]/total}%`,background:colors[i]}}/>)}
  </div>;
}

export function AnalyticsPanel() {
  const s=useStore();
  const [showAllPlaces,setShowAllPlaces]=useState(false);
  const [exporting,setExporting]=useState(false);
  const [error,setError]=useState('');
  if(!s.isAnalyticsOpen) return null;
  const rows=s.filteredHazards;
  const scope=s.selectedBarangay?`${s.selectedBarangay}, ${s.selectedMunicipality}`:s.selectedMunicipality || 'Camarines Norte';
  const centers=s.evacuationCenters.filter(c=>c.syncStatus!=='pending_delete' && (!s.selectedMunicipality || same(c.municipality,s.selectedMunicipality)) && (!s.selectedBarangay || same(c.barangay,s.selectedBarangay)));
  const places=summarizePlaces(rows,centers,!!s.selectedMunicipality);
  const ranked=rankPlaces(places);
  const shelters=shelterReadiness(places);
  const counts=severities.map(v=>rows.filter(h=>h.severity===v).length);
  const reported=rows.filter(h=>h.affectedPopulation!=null);
  const affected=reported.reduce((n,h)=>n+h.affectedPopulation!,0);
  const barangays=summarizePlaces(rows,[],true).filter(p=>p.name!=='Unknown barangay').length;
  const capacity=centers.reduce((n,c)=>n+c.capacity,0);
  const unsynced=[...s.hazards,...s.evacuationCenters].filter(r=>r.syncStatus && r.syncStatus!=='synced').length;
  const hazardMix=[...new Set(rows.map(h=>h.type))].map(type=>({type,count:rows.filter(h=>h.type===type).length})).sort((a,b)=>b.count-a.count);
  const latest=[...rows].sort((a,b)=>b.dateAdded.localeCompare(a.dateAdded)).slice(0,5);
  const tiles=[
    {label:'Active incidents',value:rows.length.toLocaleString(),detail:severityText([0,0,counts[2],counts[3]]) || 'None critical or severe'},
    {label:'Barangays affected',value:barangays.toLocaleString()},
    {label:'People reported affected',value:reported.length?affected.toLocaleString():'Not reported',detail:rows.length-reported.length?`${rows.length-reported.length} incident${rows.length-reported.length===1?'':'s'} without a count`:undefined},
    {label:'Evacuation spaces',value:capacity.toLocaleString(),detail:`${centers.length} center${centers.length===1?'':'s'}`},
  ];
  function selectPlace(p:Place) {
    if(!p.municipality || (s.selectedMunicipality && !p.barangay)) return;
    s.setLocationFilter(p.municipality,p.barangay);
  }
  function showIncident(h:Hazard) {
    s.setSelectedHazard(h);
    const point=firstPoint(h.geometry);
    if(point) s.flyTo(point,MAP_CONFIG.BARANGAY_ZOOM);
  }
  async function exportReport() {
    setExporting(true);setError('');
    try {
      const [{jsPDF},{default:html2canvas}]=await Promise.all([import('jspdf'),import('html2canvas')]);
      const pdf=new jsPDF({orientation:'landscape'});
      let y=15;
      const line=(text:string,gap=6)=>{const lines=pdf.splitTextToSize(text,270);if(y+lines.length*5>190){pdf.addPage();y=15;}pdf.text(lines,12,y);y+=lines.length*5+gap-5;};
      const heading=(text:string)=>{y+=4;pdf.setFont('helvetica','bold');line(text,7);pdf.setFont('helvetica','normal');};
      pdf.setFontSize(16);line('Camarines Norte - Situation Report · '+scope,8);
      pdf.setFontSize(10);
      line('Incident types: '+s.activeFilters.map(t=>hazardDefinition(t)?.label || t).join(', ')+' | Generated: '+new Date().toLocaleString(),4);
      heading('Overview');
      for(const t of tiles) line(`${t.label}: ${t.value}${t.detail?' ('+t.detail+')':''}`);
      heading('Where to focus');
      for(const p of ranked.slice(0,10)) line(`${p.name}: ${severityText(p.counts)} · ${p.total} total`);
      if(!ranked.length) line('No incidents reported for these filters.');
      heading('Shelter readiness');
      for(const p of shelters) line(`${p.name}: ${p.status.label} · ${p.centers} centers, ${p.capacity.toLocaleString()} spaces, ${p.total===p.unknown?'affected not reported':p.affected.toLocaleString()+' reported affected'}`);
      if(!shelters.length) line('No incidents reported for these filters.');
      pdf.setFontSize(8);line('Reported affected counts are summed per incident and may count the same people more than once. No reports does not mean no risk.');
      pdf.addPage();y=15;pdf.setFontSize(12);pdf.text('Appendix - incident list',12,y);y+=10;pdf.setFontSize(10);
      const headings=['Municipality','Barangay','Hazard','Incident','Severity','Affected'];
      const xs=[12,57,97,154,227,257];
      const widths=[42,37,54,70,27,28];
      const tableHeading=()=>{pdf.setFont('helvetica','bold');headings.forEach((v,i)=>pdf.text(v,xs[i],y));pdf.setFont('helvetica','normal');y+=8;};
      tableHeading();
      for(const h of rows) {
        const cells=[h.municipality||'Unknown',h.barangay||'Unknown',hazardDefinition(h.type)?.label||h.type,h.title||'Untitled',h.severity,h.affectedPopulation==null?'Unknown':String(h.affectedPopulation)+(h.affectedPopulationBasis==='population_estimate'?' (est.)':'')].map((v,i)=>pdf.splitTextToSize(v,widths[i]));
        const height=Math.max(...cells.map(c=>c.length))*5+5;
        if(y+height>190){pdf.addPage();y=15;tableHeading();}
        cells.forEach((v,i)=>pdf.text(v,xs[i],y));y+=height;
      }
      if(!rows.length) pdf.text('No incidents match the selected filters.',12,y);
      pdf.addPage();pdf.text('Map context - current visible layers',12,15);
      const element=document.querySelector('.leaflet-container') as HTMLElement | null;
      if(element) {
        try {const canvas=await html2canvas(element,{useCORS:true,scale:1,backgroundColor:'#ffffff',onclone:resolveModernColors}); const scale=Math.min(270/canvas.width,155/canvas.height);pdf.addImage(canvas.toDataURL('image/jpeg',0.8),'JPEG',12,25,canvas.width*scale,canvas.height*scale);}
        catch (error) {console.warn('Map report capture failed',error);setError('Report exported without the map image; the rest of the report is complete.');pdf.text('Map capture unavailable. The rest of the report is complete.',12,30);}
      }
      pdf.setFontSize(9);
      pdf.text('Reference layers: '+(s.referenceLayers.join(', ') || 'None')+' | Incident overlays: '+(s.incidentsVisible?'Visible':'Hidden'),12,190);
      pdf.addPage();y=15;pdf.setFontSize(14);pdf.text('Map legends',12,y);y+=10;pdf.setFontSize(10);
      for(const layer of REFERENCE_LAYERS.filter(t=>s.referenceLayers.includes(t.id))) {
        if(y>160){pdf.addPage();y=15;}
        pdf.setFont('helvetica','bold');pdf.text(layer.label,12,y);y+=7;pdf.setFont('helvetica','normal');
        for(const [label,color] of Object.entries(layer.colors)) {
          pdf.setFillColor(color);pdf.rect(12,y-4,5,5,'F');
          pdf.text(label+(label.startsWith('Debris')?' (black hatch)':''),20,y);y+=7;
        }
        y+=4;
      }
      if(y>130){pdf.addPage();y=15;}
      pdf.text('Incident types (severity is recorded separately)',12,y);y+=8;
      for(const type of HAZARD_TYPES.filter(t=>s.activeFilters.includes(t.id))) {
        pdf.setFillColor(type.color);pdf.rect(12,y-4,5,5,'F');pdf.text(type.label,20,y);y+=7;
      }
      pdf.save('Camarines-Norte-Situation-Report-'+new Date().toISOString().slice(0,10)+'.pdf');
    }catch {setError('Report export failed. Please try again.');}
    finally {setExporting(false);}
  }
  const maxTotal=Math.max(1,...ranked.map(p=>p.total));
  const maxType=Math.max(1,...hazardMix.map(t=>t.count));
  return <aside aria-label="Situation overview" className="analytics-panel absolute inset-3 sm:left-auto sm:w-[min(760px,95%)] z-[800] bg-surface-container-lowest shadow-ambient rounded-2xl border border-outline-variant flex flex-col overflow-hidden">
    <header className="p-4 flex items-center justify-between border-b border-outline-variant gap-3">
      <div><h2 className="text-xl font-bold">Situation overview</h2><p className="text-sm text-on-surface/70">{scope}</p></div>
      <div className="flex gap-2"><button className="min-h-11 px-3 border rounded-xl text-sm flex items-center gap-2" onClick={exportReport} disabled={exporting}><Download size={16}/>{exporting?'Exporting…':'Export Report'}</button><button aria-label="Close analytics" className="min-w-11 min-h-11 grid place-items-center" onClick={()=>s.setAnalyticsOpen(false)}><X/></button></div>
    </header>
    <div className="overflow-y-auto p-4 space-y-6">
      <div className="grid sm:grid-cols-2 gap-4"><LocationFields municipality={s.selectedMunicipality} barangay={s.selectedBarangay} onChange={s.setLocationFilter}/><IncidentFilters/></div>
      {error && <p role="alert">{error}</p>}
      <section aria-label="Headline figures" className="grid grid-cols-2 gap-3">
        {tiles.map(t=><Tile key={t.label} {...t}/>)}
        {unsynced>0 && <div role="status" className="col-span-2 rounded-2xl border border-outline-variant p-3 text-sm flex items-center gap-2"><AlertTriangle size={16} aria-hidden="true"/>{unsynced} change{unsynced===1?'':'s'} not yet synced. Figures may change once sync completes.</div>}
      </section>
      {!rows.length ? <p className="rounded-2xl border border-outline-variant p-4">No incidents reported for {scope} with these incident types. No reports does not mean no risk.</p> : <>
        <section aria-labelledby="focus-heading" className="space-y-3">
          <div><h3 id="focus-heading" className="font-bold text-lg">Where to focus</h3><p className="text-sm text-on-surface/70">Ranked by critical, then severe incidents.{!s.selectedBarangay && ' Select a place to zoom in.'}</p></div>
          <div className="flex flex-wrap gap-3 text-xs">{[3,2,1,0].map(i=><span key={i} className="flex items-center gap-1"><span aria-hidden="true" className="w-3 h-3 rounded-sm" style={{background:colors[i]}}/>{severities[i]}</span>)}</div>
          <ol className="space-y-1">{(showAllPlaces?ranked:ranked.slice(0,5)).map(p=>{
            const clickable=!!p.municipality && (!s.selectedMunicipality || !!p.barangay) && !s.selectedBarangay;
            const body=<><span className="flex justify-between gap-3 w-full"><strong>{p.name}</strong><span className="text-sm">{severityText(p.counts)} · {p.total} total</span></span><SeverityBar counts={p.counts} total={p.total} max={maxTotal}/></>;
            return <li key={p.municipality+p.name}>{clickable?<button className="w-full min-h-11 text-left p-2 rounded-xl hover:bg-surface-container space-y-1" onClick={()=>selectPlace(p)}>{body}</button>:<div className="p-2 space-y-1">{body}</div>}</li>;
          })}</ol>
          {ranked.length>5 && <button className="nav-text-button underline" onClick={()=>setShowAllPlaces(v=>!v)}>{showAllPlaces?'Show top 5':`Show all ${ranked.length}`}</button>}
        </section>
        <section aria-labelledby="shelter-heading" className="space-y-3">
          <div><h3 id="shelter-heading" className="font-bold text-lg">Shelter readiness</h3><p className="text-sm text-on-surface/70">Evacuation center spaces compared with people reported affected.</p></div>
          <ul className="space-y-2">{shelters.map(p=><li key={p.municipality+p.name} className="rounded-xl border border-outline-variant/60 p-3 flex flex-wrap items-center justify-between gap-2">
            <div><strong>{p.name}</strong><p className="text-sm text-on-surface/70">{p.centers} center{p.centers===1?'':'s'} · {p.capacity.toLocaleString()} spaces · {p.total===p.unknown?'affected not reported':`${p.affected.toLocaleString()} reported affected`}</p></div>
            <span className="flex items-center gap-1 text-sm font-semibold" style={{color:p.status.tone}}><p.status.Icon size={16} aria-hidden="true"/>{p.status.label}</span>
          </li>)}</ul>
        </section>
        <section aria-labelledby="mix-heading" className="space-y-3">
          <h3 id="mix-heading" className="font-bold text-lg">Incidents by hazard</h3>
          <ul className="space-y-2">{hazardMix.map(({type,count})=>{const d=hazardDefinition(type);return <li key={type} className="space-y-1">
            <div className="flex justify-between text-sm"><span><span aria-hidden="true" style={{color:d?.color}}>{d?.symbol} </span>{d?.label || type}</span><strong>{count}</strong></div>
            <div aria-hidden="true" className="h-2 rounded-full bg-surface-container-high overflow-hidden"><div className="h-full" style={{width:`${100*count/maxType}%`,background:d?.color}}/></div>
          </li>;})}</ul>
        </section>
      </>}
      <PopulationExposure/>
      {!!latest.length && <section aria-labelledby="latest-heading" className="space-y-3">
        <div><h3 id="latest-heading" className="font-bold text-lg">Latest reports</h3><p className="text-sm text-on-surface/70">Select a report to show it on the map.</p></div>
        <ul className="space-y-1">{latest.map(h=><li key={h.id}><button className="w-full min-h-11 text-left p-2 rounded-xl hover:bg-surface-container flex justify-between gap-3" onClick={()=>showIncident(h)}>
          <span><strong>{h.title || 'Untitled'}</strong><span className="block text-sm text-on-surface/70">{hazardDefinition(h.type)?.label || h.type} · {[h.barangay,h.municipality].filter(Boolean).join(', ') || 'Location unknown'}</span></span>
          <span className="text-sm text-right shrink-0"><span className="font-semibold" style={{color:colors[severities.indexOf(h.severity)]}}>{h.severity}</span><span className="block text-on-surface/70">{formatDistanceToNow(new Date(h.dateAdded),{addSuffix:true})}</span></span>
        </button></li>)}</ul>
      </section>}
      <details className="border-t border-outline-variant pt-2 text-sm"><summary className="min-h-11 cursor-pointer font-semibold py-3">About these numbers</summary>
        <ul className="list-disc pl-5 space-y-1 text-on-surface/80">
          <li>Figures come from incidents recorded in this app and follow the location and incident-type filters, which are shared with the map.</li>
          <li>People reported affected is the sum of each incident's count. The same people may be counted in more than one incident, and some counts are provisional estimates.</li>
          <li>Places with no reports are not shown. No reports does not mean no risk.</li>
          <li>Shelter readiness compares recorded evacuation center capacity with reported affected people. It does not account for people sheltering elsewhere.</li>
        </ul>
      </details>
    </div>
  </aside>;
}
