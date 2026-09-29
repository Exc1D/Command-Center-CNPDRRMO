import { useState } from 'react';
import { useStore } from '../lib/store';

const usman='https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/tamss/weather/tcsummary/TD_USMAN_2018.pdf';
const kristine='https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/tamss/weather/tcprelimsummary/PAGASA_Prelim_2024_KRISTINE.pdf';
export const HISTORICAL_OBSERVATIONS = [
  {event:'Usman',municipality:'Daet',station:'Daet synoptic station',start:'2018-12-28',end:'2018-12-29',hours:48,rainfall:573.2,source:usman,reference:'PAGASA Usman report · rainfall table 1'},
  {event:'Kristine',municipality:'Daet',station:'Daet synoptic station',start:'2024-10-20',end:'2024-10-25',hours:144,rainfall:731.6,source:kristine,reference:'PAGASA preliminary report'},
  {event:'Kristine',municipality:'Daet',station:'Daet synoptic station',start:'2024-10-22',end:'2024-10-22',hours:24,rainfall:528.5,source:kristine,reference:'PAGASA preliminary report · table 2'},
];
export function historicalCsv(rows:typeof HISTORICAL_OBSERVATIONS) {
  return [['Event','Municipality','Station','Observation start','Observation end','Duration (hours)','Rainfall (mm)','Affected population','Source','Notes'],...rows.map(r=>[r.event,r.municipality,r.station,r.start,r.end,r.hours,r.rainfall,'Not available',r.source,'Station observation; intervals may overlap. Not an incident impact count.'])].map(row=>row.map(value=>'"'+String(value).replaceAll('"','""')+'"').join(',')).join('\r\n');
}
export function HistoricalData() {
  const {selectedMunicipality,selectedBarangay,setLocationFilter}=useStore();
  const [event,setEvent]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [hours,setHours]=useState('');
  const invalid=!!from && !!to && from>to;
  const rows=HISTORICAL_OBSERVATIONS.filter(r=>!invalid && !selectedBarangay && (!selectedMunicipality || selectedMunicipality===r.municipality) && (!event || r.event===event) && (!from || r.end>=from) && (!to || r.start<=to) && (!hours || r.hours===Number(hours)));
  return <section className="space-y-4 text-sm">
    <h3 className="font-bold">Historical event analysis</h3>
    <p>Usman and Kristine · verified station rainfall observations. History uses its own event and date filters and the selected location. Operational hazard filters and incident totals are separate.</p>
    <div className="grid grid-cols-2 gap-3">
      <label>Historical event<select className="reference-select mt-1" value={event} onChange={e=>setEvent(e.target.value)}><option value="">All events</option><option>Usman</option><option>Kristine</option></select></label>
      <label>Observation duration<select className="reference-select mt-1" value={hours} onChange={e=>setHours(e.target.value)}><option value="">All durations</option><option value="24">24 hours</option><option value="48">48 hours</option><option value="144">6 days</option></select></label>
      <label>History from<input type="date" className="reference-select mt-1" value={from} onChange={e=>setFrom(e.target.value)}/></label>
      <label>History through<input type="date" className="reference-select mt-1" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>
    {invalid && <p role="alert">The start date must be on or before the end date.</p>}
    {selectedBarangay && <p>No barangay-specific historical observations are available. <button className="underline min-h-11" onClick={()=>setLocationFilter(selectedMunicipality,'')}>Show municipality records</button></p>}
    <p><strong>{new Set(rows.map(r=>r.event)).size} events · {rows.length} observations</strong> · {new Set(rows.map(r=>r.station)).size} stations</p>
    <p className="text-xs">Dates select whole observation periods that overlap the range; values are not prorated. Different durations are not directly comparable. The 24-hour Kristine value is included in its 6-day total: do not add these observations together.</p>
    <div className="overflow-x-auto"><table className="w-full min-w-[620px]"><caption className="text-left font-semibold mb-2">Historical rainfall measurements</caption><thead><tr>{['Event','Station / municipality','Period','Duration','Rainfall (mm)','Source'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>
      {rows.map(r=><tr className="border-t border-outline-variant/40" key={r.event+r.start}><th className="p-2 text-left font-medium">{r.event}</th><td className="p-2">{r.station} / {r.municipality}</td><td className="p-2">{r.start} – {r.end}</td><td className="p-2">{r.hours} hours</td><td className="p-2 font-bold">{r.rainfall}</td><td className="p-2"><a className="underline" href={r.source} target="_blank" rel="noreferrer">{r.reference}</a></td></tr>)}
    </tbody></table></div>
    {!rows.length && <p>No historical observations match these filters. Missing observations do not mean that a location was unaffected.</p>}
    <button className="reference-select font-semibold disabled:opacity-50" disabled={!rows.length} onClick={()=>{
      const url=URL.createObjectURL(new Blob(['\uFEFF'+historicalCsv(rows)],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='Camarines-Norte-Historical-Observations.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}>Export filtered history (CSV)</button>
    <p className="text-xs">These are measurements at Daet station, not province-wide rainfall or affected-person counts. Usman was a tropical depression. The Kristine source is preliminary, published 31 March 2025. Local incident geometry and validated affected-population records are unavailable; combined Kristine/Leon impacts are not assigned to Kristine.</p>
  </section>;
}
