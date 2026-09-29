import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { municipalities, REFERENCE_LAYERS } from '../lib/reference';

export type ExposureCounts = {matchedRecords:number;populationSum:number;missingPopulationRecords:number;duplicateIdRecords:number};
type ExposureClass = {id:string;layer:string;label:string};
type Bucket = ExposureCounts & {municipality:string;barangay:string|null;classes:string[]};
export type ExposureIndex = {
  version:number;generatedAt:string;method:string;municipalities:string[];
  sources:{file:string;sha256:string}[];repairs:{source:string;feature:number}[];
  classes:ExposureClass[];buckets:Bucket[];
};
export type ExposureSelection = {layers:string[];floodClasses:string[];municipality:string;barangay:string};
const emptyCounts = ():ExposureCounts => ({matchedRecords:0,populationSum:0,missingPopulationRecords:0,duplicateIdRecords:0});
function add(total:ExposureCounts, row:ExposureCounts) {
  for(const key of ['matchedRecords','populationSum','missingPopulationRecords','duplicateIdRecords'] as const) {
    const sum=total[key]+row[key];
    if(!Number.isSafeInteger(row[key]) || row[key]<0 || !Number.isSafeInteger(sum)) throw new Error('Invalid population aggregate');
    total[key]=sum;
  }
}

export function summarizeLayerExposure(index:ExposureIndex, selection:ExposureSelection) {
  if(selection.layers.some(layer=>!index.classes.some(c=>c.layer===layer))) throw new Error('Selected hazard is missing from the exposure aggregate');
  const classes=index.classes.filter(c=>selection.layers.includes(c.layer) && (c.layer!=='flood' || !selection.floodClasses.length || selection.floodClasses.includes(c.label)));
  const byClass=classes.map(c=>({...c,...emptyCounts()}));
  const byLayer=REFERENCE_LAYERS.filter(l=>selection.layers.includes(l.id)).map(l=>({id:l.id,label:l.label,...emptyCounts()}));
  const locations=new Map<string,{municipality:string;barangay:string|null;available:ExposureCounts;exposed:ExposureCounts}>();
  const available=emptyCounts(), exposed=emptyCounts(), multipleHazards=emptyCounts();
  let unlocatedRecords=0;
  for(const bucket of index.buckets) {
    if(selection.municipality && bucket.municipality!==selection.municipality) continue;
    if(!bucket.barangay) unlocatedRecords+=bucket.matchedRecords;
    if(selection.barangay && bucket.barangay!==selection.barangay) continue;
    add(available,bucket);
    const key=JSON.stringify([bucket.municipality,bucket.barangay]);
    const location=locations.get(key) ?? {municipality:bucket.municipality,barangay:bucket.barangay,available:emptyCounts(),exposed:emptyCounts()};
    locations.set(key,location);add(location.available,bucket);
    const matchedClasses=byClass.filter(c=>bucket.classes.includes(c.id));
    if(!matchedClasses.length) continue;
    // Each bucket represents disjoint source records, even when its classes overlap.
    add(exposed,bucket);add(location.exposed,bucket);
    for(const c of matchedClasses) add(c,bucket);
    const matchedLayers=byLayer.filter(l=>matchedClasses.some(c=>c.layer===l.id));
    for(const l of matchedLayers) add(l,bucket);
    if(matchedLayers.length>1) add(multipleHazards,bucket);
  }
  return {
    selection,available,exposed,multipleHazards,byLayer,byClass,
    byLocation:[...locations.values()].sort((a,b)=>a.municipality.localeCompare(b.municipality)||(a.barangay||'').localeCompare(b.barangay||'')),
    unavailableMunicipalities:municipalities.filter(m=>(!selection.municipality || m===selection.municipality) && !index.municipalities.includes(m)),
    unlocatedRecords,generatedAt:index.generatedAt,method:index.method,sources:index.sources,repairs:index.repairs.length,
  };
}
export type LayerExposureResult = ReturnType<typeof summarizeLayerExposure>;

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const indexSchema=z.object({
  version:z.literal(1),generatedAt:z.string().datetime({offset:true}),method:z.string().min(1),
  municipalities:z.array(z.string().refine(m=>municipalities.includes(m))).min(1),
  sources:z.array(z.object({file:z.string(),sha256:z.string().regex(/^[a-f0-9]{64}$/)})),
  repairs:z.array(z.object({source:z.string(),feature:count})),
  classes:z.array(z.object({id:z.string().min(1),layer:z.string().refine(id=>REFERENCE_LAYERS.some(l=>l.id===id)),label:z.string().min(1)})).min(1),
  buckets:z.array(z.object({municipality:z.string(),barangay:z.string().nullable(),classes:z.array(z.string()),matchedRecords:count,populationSum:count,missingPopulationRecords:count,duplicateIdRecords:count})).min(1),
}).refine(index=>new Set(index.classes.map(c=>c.id)).size===index.classes.length && index.buckets.every(b=>
  index.municipalities.includes(b.municipality) && b.classes.every(id=>index.classes.some(c=>c.id===id)) &&
  b.missingPopulationRecords<=b.matchedRecords && b.duplicateIdRecords<=b.matchedRecords &&
  (b.missingPopulationRecords<b.matchedRecords || b.populationSum===0)), 'Invalid exposure aggregate');

export async function analyzeLayerExposure(selection:ExposureSelection) {
  const index=indexSchema.parse(JSON.parse(await fs.readFile(path.join(process.cwd(),'.private/population-exposure.json'),'utf8')));
  return summarizeLayerExposure(index as ExposureIndex,selection);
}
