import { useState } from 'react';
import { X, Download } from 'lucide-react';
import { useStore } from '../lib/store';
import { hazardDefinition, municipalities, canonicalLocation, REFERENCE_LAYERS, HAZARD_TYPES } from '../lib/reference';
import { HistoricalData } from './HistoricalData';
import { PopulationExposure } from './PopulationExposure';
import { LocationFields, LocationOverview, IncidentFilters } from './ReferenceControls';
import type { Hazard } from '../lib/db';

const severities=['Minor','Moderate','Severe','Critical'];
const colors=['#6b7280','#b77900','#c2410c','#b91c1c'];
export function summarizeMunicipalities(rows:Hazard[]) {
  const normalized=rows.map(h=>({...h,municipality:municipalities.find(m=>m.toLowerCase()===h.municipality?.trim().toLowerCase()) || 'Unresolved location'}));
  return [...municipalities,...(normalized.some(h=>h.municipality==='Unresolved location')?['Unresolved location']:[])].map(m=>({
    municipality:m, counts:severities.map(s=>normalized.filter(h=>h.municipality===m && h.severity===s).length),
  }));
}
export function summarizeBarangays(rows:Hazard[]) {
  const groups=new Map<string,{municipality:string;barangay:string;counts:number[];total:number;affected:number;unknown:number;estimated:number}>();
  for(const h of rows) {
    const location=canonicalLocation(h.municipality,h.barangay);
    const municipality=location?.municipality || h.municipality?.trim() || 'Unknown municipality';
    const barangay=location?.barangay || h.barangay?.trim() || 'Unknown barangay';
    const key=JSON.stringify([municipality.toLowerCase(),barangay.toLowerCase()]);
    const group=groups.get(key) ?? {municipality,barangay,counts:[0,0,0,0],total:0,affected:0,unknown:0,estimated:0};
    const severity=severities.indexOf(h.severity);
    if(severity>=0) group.counts[severity]++;
    group.total++;
    if(h.affectedPopulation==null) group.unknown++; else group.affected+=h.affectedPopulation;
    if(h.affectedPopulation!=null && h.affectedPopulationBasis==='population_estimate') group.estimated++;
    groups.set(key,group);
  }
  return [...groups.values()].sort((a,b)=>a.municipality.localeCompare(b.municipality)||a.barangay.localeCompare(b.barangay));
}
function BarangayAnalytics({rows}:{rows:Hazard[]}) {
  const setLocationFilter=useStore(s=>s.setLocationFilter);
  return <section className="space-y-4">
    <h3 className="font-bold">Barangay incident analytics</h3>
    <p className="text-xs">Grouped by municipality and barangay. Select a barangay to inspect its incidents and profile. Only locations with matching incidents appear; an empty result does not establish zero risk.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><caption className="text-left font-semibold mb-2">Barangay severity and affected population</caption>
      <thead><tr>{['Municipality','Barangay',...severities,'Incidents','Known affected','Unknown counts','Estimates'].map(label=><th key={label} className="p-2 text-left">{label}</th>)}</tr></thead>
      <tbody>{summarizeBarangays(rows).map(g=><tr key={JSON.stringify([g.municipality,g.barangay])} className="border-t border-outline-variant/40">
        <td className="p-2">{g.municipality}</td><th className="p-2 text-left font-medium">{canonicalLocation(g.municipality,g.barangay)?<button className="underline min-h-11" onClick={()=>setLocationFilter(g.municipality,g.barangay)}>{g.barangay}</button>:g.barangay}</th>
        {[...g.counts,g.total,g.unknown===g.total?'Unknown':g.affected.toLocaleString(),g.unknown,g.estimated].map((value,i)=><td className="p-2" key={i}>{value}</td>)}
      </tr>)}</tbody></table></div>
    {!rows.length && <p>No incidents match the selected filters.</p>}
    <p className="text-xs">Known affected is a sum of incident entries, including provisional estimates; people may be counted more than once. Unknown counts and estimates are numbers of incidents.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[500px] text-sm"><caption className="text-left font-semibold mb-2">Hazard and severity breakdown · selected locations</caption>
      <thead><tr><th className="p-2 text-left">Hazard</th>{severities.map(label=><th key={label} className="p-2">{label}</th>)}<th>Incidents</th></tr></thead>
      <tbody>{[...new Set(rows.map(h=>h.type))].sort().map(type=><tr key={type} className="border-t border-outline-variant/40"><th className="p-2 text-left font-medium">{hazardDefinition(type)?.label || type}</th>{severities.map(severity=><td key={severity} className="p-2 text-center">{rows.filter(h=>h.type===type && h.severity===severity).length}</td>)}<td className="p-2 text-center">{rows.filter(h=>h.type===type).length}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
export function AnalyticsPanel() {
  const s=useStore();
  const [tab,setTab]=useState('Summary');
  const [query,setQuery]=useState('');
  const [exporting,setExporting]=useState(false);
  const [error,setError]=useState('');
  const incidentView=tab!=='History' && tab!=='Population exposure';
  const rows=s.filteredHazards.filter(h=>[h.title,h.notes,h.municipality,h.barangay].some(v=>v?.toLowerCase().includes(query.toLowerCase())));
  if(!s.isAnalyticsOpen) return null;
  async function exportReport() {
    setExporting(true);setError('');
    try {
      const [{jsPDF},{default:html2canvas}]=await Promise.all([import('jspdf'),import('html2canvas')]);
      const pdf=new jsPDF({orientation:'landscape'});
      pdf.setFontSize(16);pdf.text('Camarines Norte - Incident Report',12,15);
      pdf.setFontSize(10);
      pdf.text(pdf.splitTextToSize([s.selectedMunicipality || 'Province overview',s.selectedBarangay || 'All barangays','Hazards: '+s.activeFilters.map(t=>hazardDefinition(t)?.label || t).join(', '),'Search: '+(query||'None'),'Generated: '+new Date().toLocaleString()].join(' | '),270),12,23);
      let y=45;
      const headings=['Municipality','Barangay','Hazard','Incident','Severity','Affected'];
      const xs=[12,57,97,154,227,257];
      const widths=[42,37,54,70,27,28];
      const heading=()=>{pdf.setFont('helvetica','bold');headings.forEach((v,i)=>pdf.text(v,xs[i],y));pdf.setFont('helvetica','normal');y+=8;};
      heading();
      for(const h of rows) {
        const cells=[h.municipality||'Unknown',h.barangay||'Unknown',hazardDefinition(h.type)?.label||h.type,h.title||'Untitled',h.severity,h.affectedPopulation==null?'Unknown':String(h.affectedPopulation)+(h.affectedPopulationBasis==='population_estimate'?' (est.)':'')].map((v,i)=>pdf.splitTextToSize(v,widths[i]));
        const height=Math.max(...cells.map(c=>c.length))*5+5;
        if(y+height>190){pdf.addPage();y=15;heading();}
        cells.forEach((v,i)=>pdf.text(v,xs[i],y));y+=height;
      }
      if(!rows.length) pdf.text('No incidents match the selected filters.',12,y);
      pdf.addPage();y=15;pdf.text('Barangay incident summary',12,y);y+=8;
      pdf.setFontSize(9);pdf.text('Affected counts can overlap across incidents. Unknown and estimates refer to incident counts.',12,y);y+=10;
      for(const group of summarizeBarangays(rows)) {
        const lines=pdf.splitTextToSize(`${group.municipality} / ${group.barangay}: ${group.total} incidents | ${severities.map((s,i)=>s+': '+group.counts[i]).join(', ')} | Known affected: ${group.unknown===group.total?'Unknown':group.affected} | Unknown counts: ${group.unknown} | Estimates: ${group.estimated}`,270);
        if(y+lines.length*5>190){pdf.addPage();y=15;pdf.text('Barangay incident summary (continued)',12,y);y+=10;}
        pdf.text(lines,12,y);y+=lines.length*5+5;
      }
      if(!rows.length) pdf.text('No incidents match the selected filters.',12,y);
      pdf.addPage();pdf.text('Map context - current visible layers',12,15);
      const element=document.querySelector('.leaflet-container') as HTMLElement | null;
      if(element) {
        try {const canvas=await html2canvas(element,{useCORS:true,scale:1,backgroundColor:'#ffffff',onclone:doc=>{
          // html2canvas 1.x cannot parse OKLCH. Let the browser resolve colors in the export clone.
          const pixel=doc.createElement('canvas');pixel.width=1;pixel.height=1;
          const context=pixel.getContext('2d')!;
          const converted=new Map<string,string>();
          const rgb=(value:string)=>{
            if(!converted.has(value)){
              context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);
              const [r,g,b,a]=context.getImageData(0,0,1,1).data;
              converted.set(value,'rgba('+[r,g,b,a/255].join(',')+')');
            }
            return converted.get(value)!;
          };
          doc.querySelectorAll<HTMLElement>('*').forEach(node=>{
            const style=doc.defaultView!.getComputedStyle(node);
            for(const property of ['color','background-color','border-top-color','border-right-color','border-bottom-color','border-left-color','outline-color','text-decoration-color','-webkit-text-stroke-color','box-shadow','text-shadow']){
              const value=style.getPropertyValue(property);
              if(/oklch|oklab|color\(/.test(value)) node.style.setProperty(property,value.replace(/(?:oklch|oklab|color)\([^)]*\)/g,rgb),'important');
            }
          });
        }}); const scale=Math.min(270/canvas.width,155/canvas.height);pdf.addImage(canvas.toDataURL('image/jpeg',0.8),'JPEG',12,25,canvas.width*scale,canvas.height*scale);}
        catch (error) {console.warn('Map report capture failed',error);setError('Report exported without the map image; the incident matrix is complete.');pdf.text('Map capture unavailable. Incident matrix remains complete.',12,30);}
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
      pdf.save('Camarines-Norte-Incidents-'+new Date().toISOString().slice(0,10)+'.pdf');
    }catch {setError('Report export failed. Please try again.');}
    finally {setExporting(false);}
  }
  return <aside aria-label="Data Analytics" className="analytics-panel absolute inset-3 sm:left-auto sm:w-[min(760px,95%)] z-[800] bg-surface-container-lowest shadow-ambient rounded-2xl border border-outline-variant flex flex-col overflow-hidden">
    <header className="p-4 flex items-center justify-between border-b border-outline-variant gap-3"><h2 className="text-xl font-bold">Data Analytics</h2><div className="flex gap-2">{incidentView && <button className="min-h-11 px-3 border rounded-xl text-sm flex items-center gap-2" onClick={exportReport} disabled={exporting}><Download size={16}/>{exporting?'Exporting…':'Export Report'}</button>}<button aria-label="Close analytics" className="min-w-11 min-h-11 grid place-items-center" onClick={()=>s.setAnalyticsOpen(false)}><X/></button></div></header>
    <div className="overflow-y-auto p-4 space-y-4">
      <nav aria-label="Analytics views" className="flex gap-2 flex-wrap">{['Summary','Population exposure','Matrix','Barangay','History'].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)} className="nav-text-button">{t}</button>)}</nav>
      <div className="grid sm:grid-cols-2 gap-4"><LocationFields municipality={s.selectedMunicipality} barangay={s.selectedBarangay} onChange={s.setLocationFilter}/>{incidentView && <IncidentFilters/>}</div>
      {incidentView && <><label className="block text-sm">Search incidents<input className="reference-select mt-1" placeholder="Search incidents..." value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <p className="text-sm"><strong>{rows.length} incidents</strong> · Affected population entered: {rows.reduce((n,h)=>n+(h.affectedPopulation ?? 0),0).toLocaleString()} · {rows.filter(h=>h.affectedPopulation==null).length} unknown</p>
      <p className="text-xs text-on-surface/60">Affected population is summed per incident and may count the same people more than once. {rows.filter(h=>h.affectedPopulationBasis==="population_estimate").length} incident counts are provisional population estimates. Location and hazard filters are shared with the map.</p></>}
      {error && <p role="alert">{error}</p>}
      {tab==='Population exposure' && <PopulationExposure/>}
      {tab==='Summary' && <section><h3 className="font-bold mb-3">Municipality severity summary</h3><div className="flex flex-wrap gap-3 text-xs mb-3">{severities.map((v,i)=><span key={v} style={{color:colors[i]}}>■ {v}</span>)}</div><table className="w-full text-sm"><thead><tr><th className="text-left p-2">Municipality</th>{severities.map(v=><th key={v} className="p-2">{v}</th>)}<th>Total</th></tr></thead><tbody>{summarizeMunicipalities(rows).filter(r=>!s.selectedMunicipality || r.municipality===s.selectedMunicipality).map(r=><tr key={r.municipality} className="border-t border-outline-variant/40"><th className="text-left p-2 font-medium">{r.municipality}</th>{r.counts.map((n,i)=><td key={i} className="text-center p-2" style={{color:colors[i]}}>{n}</td>)}<td className="text-center font-bold">{r.counts.reduce((a,b)=>a+b,0)}</td></tr>)}</tbody></table></section>}
      {tab==='Matrix' && <div className="overflow-x-auto"><h3 className="font-bold mb-3">Summary Matrix</h3><table className="w-full text-sm min-w-[620px]"><thead><tr>{['Municipality','Barangay','Hazard','Incident','Severity','Affected'].map(h=><th key={h} className="p-2 text-left">{h}</th>)}</tr></thead><tbody>{rows.map(h=><tr key={h.id} className="border-t border-outline-variant/40">{[h.municipality||'Unknown',h.barangay||'Unknown',hazardDefinition(h.type)?.label||h.type,h.title||'Untitled',h.severity,h.affectedPopulation==null?'Unknown':String(h.affectedPopulation)+(h.affectedPopulationBasis==='population_estimate'?' (est.)':'')].map((v,i)=><td key={i} className="p-2">{v}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="py-6">No incidents match the selected filters.</p>}</div>}
      {tab==='Barangay' && <div className="space-y-6"><BarangayAnalytics rows={rows}/><section><h3 className="font-bold mb-3">Location profile</h3><LocationOverview/></section></div>}
      {tab==='History' && <HistoricalData/>}
    </div>
  </aside>;
}
