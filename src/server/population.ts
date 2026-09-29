import fs from 'node:fs/promises';
import path from 'node:path';
import { municipalities } from '../lib/reference';
import { pointInPolygon } from '../lib/planning';
import { haversineDistance } from '../lib/utils';
type Geometry = {type:'Point';coordinates:[number,number]} | {type:'Polygon';coordinates:[number,number][][]};
export type PopulationPoint = {geometry:{coordinates:[number,number]};properties:{populationCount:number|null;duplicateId?:boolean}};

export function countExposed(points:PopulationPoint[],geometry:Geometry,radiusMetres?:number) {
  if(geometry.type==='Point' && (!Number.isFinite(radiusMetres) || radiusMetres!<=0)) throw new Error('Point analysis requires an explicit positive radius');
  const coords=geometry.type==='Polygon'?geometry.coordinates.flat():[];
  const bounds=coords.length?[Math.min(...coords.map(c=>c[0])),Math.min(...coords.map(c=>c[1])),Math.max(...coords.map(c=>c[0])),Math.max(...coords.map(c=>c[1]))]:null;
  const result={matchedRecords:0,populationSum:0,missingPopulationRecords:0,duplicateIdRecords:0};
  for(const f of points) {
    const [lng,lat]=f.geometry.coordinates;
    const inside=geometry.type==='Point'?haversineDistance(lat,lng,geometry.coordinates[1],geometry.coordinates[0])*1000<=radiusMetres!:
      lng>=bounds![0] && lat>=bounds![1] && lng<=bounds![2] && lat<=bounds![3] && pointInPolygon([lng,lat],geometry.coordinates);
    if(!inside) continue;
    result.matchedRecords++;
    const populationCount=f.properties.populationCount;
    if(populationCount===null || populationCount===undefined) result.missingPopulationRecords++;
    else {if(!Number.isSafeInteger(populationCount) || populationCount<0) throw new Error('Invalid population count');result.populationSum+=populationCount;}
    if(f.properties.duplicateId) result.duplicateIdRecords++;
  }
  return result;
}
export async function estimateExposure(geometry:Geometry,radiusMetres?:number) {
  const byMunicipality=[];
  const unavailableMunicipalities=[];
  // Read one municipality at a time; population details never enter a public static asset or response.
  for(const municipality of municipalities) {
    let raw:string;
    try {raw=await fs.readFile(path.join(process.cwd(),'.private/population',municipality+'.geojson'),'utf8');}
    catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT'){unavailableMunicipalities.push(municipality);continue;}throw error;}
    const counts=countExposed(JSON.parse(raw).features,geometry,radiusMetres);
    byMunicipality.push({municipality,...counts});
  }
  if(!byMunicipality.length) throw new Error('No population datasets installed');
  const totals=byMunicipality.reduce((total,row)=>({matchedRecords:total.matchedRecords+row.matchedRecords,populationSum:total.populationSum+row.populationSum,missingPopulationRecords:total.missingPopulationRecords+row.missingPopulationRecords,duplicateIdRecords:total.duplicateIdRecords+row.duplicateIdRecords}),{matchedRecords:0,populationSum:0,missingPopulationRecords:0,duplicateIdRecords:0});
  return {...totals,byMunicipality,unavailableMunicipalities,method:geometry.type==='Polygon'?'Population points within incident polygon':'Population points within '+radiusMetres+' m radius',calculatedAt:new Date().toISOString(),coverageNote:'Source population sum, not confirmed affected people. Duplicate IDs retained. Six outlying coordinates excluded; coordinate disagreements unresolved. Paracale lacks population counts; Talisay is incomplete. A zero match does not establish zero exposure.'};
}
