import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { useStore } from '../lib/store';
import { REFERENCE_LAYERS, ELEMENT_LAYERS, hazardDefinition, isTransportFacility } from '../lib/reference';
import { renderToStaticMarkup } from 'react-dom/server';
import { School, Landmark, Cross, Church, Flame, Shield, Building2, Plane, Anchor, Bus, Flag, Tent, ShoppingBasket, Briefcase, Waves, Mountain, Activity, Zap, Droplets } from 'lucide-react';

const icons: Record<string, typeof School> = {School, 'Municipal Hall':Landmark, 'Barangay Hall':Landmark, 'Fire Station':Flame, 'Health Center/Station':Cross, Hospital:Cross, 'Pharmacy/ Drug Store':Cross, Church, Chapel:Church, 'Police Station':Shield, 'Transportation: Port, Airport':Plane, 'Transportation: Port, Fishlanding/Dock/Pier':Anchor, 'Transportation: Terminal, PUV/Bus':Bus, 'Red Cross':Cross, Plaza:Flag, 'Military/Armed Forces':Tent, Market:ShoppingBasket, 'Multipurpose Hall':Building2, 'National Government Agency':Briefcase};
const hazardIcons: Record<string,typeof Waves> = {flood:Droplets,storm_surge:Waves,rain_induced_landslide:Mountain,landslide:Mountain,tsunami:Waves,liquefaction:Activity,erosion:Mountain,groundshaking:Activity,earthquake_event:Zap,earthquake:Zap};
export function incidentIcon(type: string) {
  const def=hazardDefinition(type); const Icon=hazardIcons[type] || Flag;
  return L.divIcon({className:'incident-icon',html:renderToStaticMarkup(<Icon color={def?.color ?? '#555'} size={24}/>),iconSize:[36,36],iconAnchor:[18,18]});
}
function textPopup(parts: unknown[]) {
  const element=document.createElement('div');
  element.style.whiteSpace='pre-line';
  element.textContent=parts.filter(v=>v!==null && v!==undefined && v!=='').join('\n');
  return element;
}
// ponytail: cache the finite public layer set in memory; use vector tiles if provincial coverage grows.
const noClasses:string[]=[];
const cache=new Map<string,any>();
function ReferenceLayer({id}:{id:string}) {
  const map=useMap();
  const state=useStore();
  const activeSusceptibilityFilters=id==='flood'?state.activeSusceptibilityFilters:noClasses;
  const selectedMunicipality=id==='population'?state.selectedMunicipality:'';
  const selectedBarangay=id==='population'?state.selectedBarangay:'';
  const isMapAuthorized=id==='population'?state.isMapAuthorized:false;
  const [status,setStatus]=useState('');
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    if(id==='population' && (!isMapAuthorized || !selectedMunicipality)) {
      setStatus('Population: unlock operations and select a municipality.'); return;
    }
    const controller=new AbortController();
    const group=L.layerGroup().addTo(map);
    const renderer=id==='landslide'?L.svg({padding:0.5}):L.canvas({padding:0.5});
    let source:any;
    let disposed=false;
    const def=REFERENCE_LAYERS.find(t=>t.id===id);
    const label=def?.label ?? ELEMENT_LAYERS.find(t=>t.id===id)?.label ?? id;
    const url=id==='population'?'/api/reference/population/'+encodeURIComponent(selectedMunicipality):'/reference/'+(id==='lifelines'?'facilities':id)+'.geojson';
    const draw=()=>{
      if(!source || disposed) return;
      group.clearLayers();
      if(id==='population' && map.getZoom()<14) {setStatus('Population: zoom to level 14 or closer to view source points.');return;}
      const data=id==='population'?{...source,features:source.features.filter((f:any)=>map.getBounds().contains([f.geometry.coordinates[1],f.geometry.coordinates[0]]) && (!selectedBarangay || f.properties.barangay===selectedBarangay))}:source;
      const layer=L.geoJSON(data,{
        pmIgnore:true, renderer,
        filter:f=>id==='lifelines'?isTransportFacility(f.properties):id!=='flood' || activeSusceptibilityFilters.length===0 || activeSusceptibilityFilters.includes(f.properties.Suscep),
        style:f=>{
          const p=f?.properties ?? {};
          const color=def?.colors[p[def.field]] || (id==='roads'?'#806449':id==='rivers'?'#0369a1':'#232323');
          return {pmIgnore:true,renderer,color,weight:id==='boundaries'?2:1,fillColor:color,fillOpacity:def?0.4:0};
        },
        pointToLayer:(f,latlng)=>{
          if((id==='facilities' || id==='lifelines') && map.getZoom()>=14) {
            const Icon=icons[f.properties.SubCategor] || Building2;
            return L.marker(latlng,{pmIgnore:true,icon:L.divIcon({className:'incident-icon',html:renderToStaticMarkup(<Icon size={18} color="#155e75"/>),iconSize:[26,26],iconAnchor:[13,13]})});
          }
          return L.circleMarker(latlng,{pmIgnore:true,renderer,radius:id==='population'?3:4,color:id==='population'?'#7c3aed':'#155e75',fillOpacity:0.8,weight:1});
        },
        onEachFeature:(f,l)=>{
          const p=f.properties;
          l.bindPopup(textPopup(id==='population'?['Population source point',p.record,p.barangay || 'Barangay unavailable','Unverified source record; not a one-person-per-point count.']:
            (id==='facilities' || id==='lifelines')?[p.Name,p.Category,p.SubCategor,p.Municipali]:
            def?[def.label,p[def.field],p.Inun_depth,p.Municipali]:
            [p.ADM3_EN,p.AREA_SQKM && p.AREA_SQKM+' km²',p.RoadName,p['Road Class'],p.river_name || p.name,p.type]));
          if(id==='landslide' && p.lndslidesu?.startsWith('Debris')) l.on('add',()=>{
            const element=(l as L.Path).getElement();
            const svg=(element as SVGElement | undefined)?.ownerSVGElement;
            if(!element || !svg) return;
            let pattern=svg.querySelector('#ril-hatch');
            if(!pattern) {
              const defs=document.createElementNS('http://www.w3.org/2000/svg','defs');
              defs.innerHTML='<pattern id="ril-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#000000" stroke-width="2"/></pattern>';
              svg.prepend(defs);
            }
            element.setAttribute('fill','url(#ril-hatch)');
            element.setAttribute('fill-opacity','0.8');
          });
        },
      } as L.GeoJSONOptions);
      group.addLayer(layer);
      setStatus('');
    };
    async function load() {
      setStatus('Loading '+label+'…');
      try {
        source=id!=='population' && cache.get(url);
        if(!source) {
          const response=await fetch(url,{signal:controller.signal,cache:id==='population'?'no-store':'default'});
          if(!response.ok) throw new Error(id==='population'?'Population data unavailable or session expired.':'Could not load '+label);
          source=await response.json();
          if(!Array.isArray(source.features)) throw new Error('Invalid layer data');
          if(id!=='population') cache.set(url,source);
        }
        draw();
      } catch(error) {
        if(!controller.signal.aborted) setStatus(error instanceof Error?error.message:'Could not load layer');
      }
    }
    void load();
    if(id==='population') map.on('moveend',draw);
    if(id==='facilities' || id==='lifelines') map.on('zoomend',draw);
    return ()=>{disposed=true;controller.abort();map.off('moveend',draw);map.off('zoomend',draw);group.remove();renderer.remove();};
  },[id,map,activeSusceptibilityFilters,selectedMunicipality,selectedBarangay,isMapAuthorized,retry]);
  return status?<div role="status" className="bg-white/95 text-slate-800 rounded-xl px-3 py-2 text-xs shadow max-w-xs">{status} <button className="underline min-h-8" onClick={()=>setRetry(n=>n+1)}>Retry</button></div>:null;
}
export function ReferenceMapLayers() {
  const {referenceLayers,elementLayers}=useStore();
  const title=REFERENCE_LAYERS.filter(t=>referenceLayers.includes(t.id)).map(t=>t.label).join(' + ') || 'Camarines Norte Operational Map';
  return <div className="absolute top-3 right-3 z-[450] space-y-2 pointer-events-auto" aria-label="Layer status">
    <div className="bg-white/95 text-slate-800 rounded-xl p-3 shadow max-w-sm pointer-events-none"><h2 className="font-bold text-sm">{title}</h2><p className="text-xs mt-1">Use the sidebar to select hazards, incidents and elements.</p></div>
    {[...referenceLayers,...elementLayers].filter(id=>[...REFERENCE_LAYERS,...ELEMENT_LAYERS].some(t=>t.id===id) && !(id==='lifelines' && elementLayers.includes('facilities'))).map(id=><ReferenceLayer key={id} id={id}/>)}
  </div>;
}
