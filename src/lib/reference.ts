import locations from './barangays.json';
import type { Hazard } from './db';

export const HAZARD_TYPES = [
  { id: 'flood', label: 'Flood', color: '#1d4ed8', symbol: '≋' },
  { id: 'storm_surge', label: 'Storm Surge', color: '#0369a1', symbol: '↟' },
  { id: 'rain_induced_landslide', label: 'Rain-Induced Landslide', color: '#902400', symbol: '◩' },
  { id: 'tsunami', label: 'Tsunami', color: '#0891b2', symbol: '≈' },
  { id: 'liquefaction', label: 'Liquefaction', color: '#b36b00', symbol: '▥' },
  { id: 'erosion', label: 'Erosion', color: '#92400e', symbol: '⋰' },
  { id: 'groundshaking', label: 'Groundshaking', color: '#7c3aed', symbol: '⌁' },
  { id: 'earthquake_event', label: 'Earthquake', color: '#991b1b', symbol: 'ϟ' },
];
export const LEGACY_TYPES = [
  {id:'landslide',label:'Landslide (legacy)',color:'#f59e0b',symbol:'◩'},
  {id:'earthquake',label:'Earthquake Fault (legacy)',color:'#991b1b',symbol:'ϟ'},
  {id:'vehicular_accident',label:'Vehicular Accident (legacy)',color:'#dc2626',symbol:'!'},
];
// Road and bridge status reuses incident storage; its status lives in the severity field.
export const ROAD_TYPE = {id:'road',label:'Road / Bridge Status',color:'#475569',symbol:'═'};
export const ROAD_STATUS: Record<string,string> = {Passable:'#15803d','Limited access':'#d97706','Not passable':'#dc2626'};
export const hazardDefinition = (id: string) => [...HAZARD_TYPES, ...LEGACY_TYPES, ROAD_TYPE].find(t => t.id === id);
export const FLOOD_COLORS: Record<string,string> = {'Very High':'#12003c',High:'#3e0683',Moderate:'#a61fec',Low:'#d5beee'};
export const RIL_COLORS: Record<string,string> = {'Very High Susceptibility':'#902400','High Susceptibility':'#FF0000','Moderate Susceptibility':'#008000','Low Susceptibility':'#FFFF00','Debris Flow/Possible Accumulation Zone':'#000000'};
export const REFERENCE_LAYERS = [
  {id:'flood',label:'Flood Susceptibility',field:'Suscep',colors:FLOOD_COLORS},
  {id:'storm_surge',label:'Storm Surge (SSA1)',field:'hazardClass',colors:{'Class 1':'#bae6fd','Class 2':'#0284c7','Class 3':'#075985'} as Record<string,string>},
  {id:'landslide',label:'Rain-Induced Landslide Susceptibility',field:'lndslidesu',colors:RIL_COLORS},
  {id:'liquefaction',label:'Liquefaction Susceptibility',field:'Liq_Class',colors:{'Generally Susceptible':'#ffaa00'} as Record<string,string>},
  {id:'tsunami',label:'Tsunami Inundation',field:'Inun_desc',colors:{'General inundation':'#c7cf5d','Inundation depth':'#25cfde'} as Record<string,string>},
  // ponytail: display only; add to the private exposure index when it is next rebuilt.
  {id:'noah_flood_5yr',label:'Flood Hazard (Project NOAH, 5-year)',field:'hazardClass',colors:{Low:'#facc15',Medium:'#f97316',High:'#dc2626'} as Record<string,string>,exposure:false},
];
export const EXPOSURE_LAYERS = REFERENCE_LAYERS.filter(layer => layer.exposure !== false);
export const ELEMENT_LAYERS = [
  {id:'facilities',label:'Critical Point Facilities'}, {id:'population',label:'Population'},
  {id:'roads',label:'Road Network'}, {id:'rivers',label:'Rivers'},
];
export const municipalities = Object.keys(locations);
export const barangaysFor = (m: string) => (locations as Record<string,{barangays:{name:string;lat:number;lng:number}[]}>)[m]?.barangays.map(b => ({...b,name:b.name.trim()})) ?? [];
const normalize = (s: string) => s.trim().toLocaleLowerCase();
export function canonicalLocation(m: string = '', b: string = '') {
  const municipality = municipalities.find(v => normalize(v) === normalize(m));
  const barangay = municipality && barangaysFor(municipality).find(v => normalize(v.name) === normalize(b))?.name;
  return municipality && barangay ? {municipality,barangay} : null;
}
export function filterMapRecords(hazards: Hazard[], types: string[], municipality = '', barangay = '') {
  return hazards.filter(h => h.syncStatus !== 'pending_delete' && types.includes(h.type) &&
    (!municipality || normalize(h.municipality || '') === normalize(municipality)) &&
    (!barangay || normalize(h.barangay || '') === normalize(barangay)));
}
export function filterIncidents(hazards: Hazard[], types: string[], municipality = '', barangay = '') {
  return filterMapRecords(hazards, types.filter(type => type !== 'resource' && type !== 'road'), municipality, barangay);
}
// Ray casting over GeoJSON rings; a point inside a hole is outside the shape.
export function pointInShape([lng,lat]:[number,number], geometry:{type:string;coordinates:any}) {
  const polygons:number[][][][]=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  return polygons.some(rings=>rings.every((ring,index)=>{
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const [xi,yi]=ring[i],[xj,yj]=ring[j];
      if((yi>lat)!==(yj>lat) && lng<(xj-xi)*(lat-yi)/(yj-yi)+xi) inside=!inside;
    }
    return index===0?inside:!inside;
  }));
}
// Boundary names carry suffixes like "Daet (Capital)"; the barangay list uses "Daet".
export const municipalityFromBoundary = (name:string) => municipalities.find(m => m===name) ?? municipalities.find(m => name.startsWith(m)) ?? '';
// Fallback when a barangay has no outline: the closest barangay center stands in for "the barangay you clicked".
export function nearestBarangay(municipality:string, lat:number, lng:number) {
  return barangaysFor(municipality).reduce<{name:string;lat:number;lng:number}|null>((best,b)=>!best || (b.lat-lat)**2+(b.lng-lng)**2<(best.lat-lat)**2+(best.lng-lng)**2?b:best,null);
}

// Hazards the barangay card reads per barangay; other hazard layers keep their own zone popups.
export const SUSCEPTIBILITY_KEY: Record<string, string> = { flood: 'Flood', landslide: 'Rain-Induced Landslide', tsunami: 'Tsunami', liquefaction: 'Liquefaction' };
