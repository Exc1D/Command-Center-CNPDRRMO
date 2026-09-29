import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { analyzeLayerExposure, summarizeLayerExposure, type ExposureIndex } from './layerExposure';

it('counts overlapping hazards/classes once in combined totals and preserves unknown, zero, and missing geography',()=>{
  const index:ExposureIndex={version:1,generatedAt:'2026-09-28T00:00:00Z',method:'Test',sources:[],repairs:[],municipalities:['Daet','Paracale'],classes:[
    {id:'high',layer:'flood',label:'High'},{id:'low',layer:'flood',label:'Low'},{id:'tsunami',layer:'tsunami',label:'General inundation'},
  ],buckets:[
    {municipality:'Daet',barangay:'Bagasbas',classes:['high','low','tsunami'],matchedRecords:2,populationSum:9,missingPopulationRecords:0,duplicateIdRecords:2},
    {municipality:'Daet',barangay:'Bagasbas',classes:['low'],matchedRecords:1,populationSum:0,missingPopulationRecords:0,duplicateIdRecords:0},
    {municipality:'Daet',barangay:'Bagasbas',classes:[],matchedRecords:1,populationSum:7,missingPopulationRecords:0,duplicateIdRecords:0},
    {municipality:'Paracale',barangay:null,classes:['high'],matchedRecords:1,populationSum:0,missingPopulationRecords:1,duplicateIdRecords:0},
  ]};
  const selection={layers:['flood','tsunami'],floodClasses:[],municipality:'',barangay:''};
  const result=summarizeLayerExposure(index,selection);
  expect(result.available).toMatchObject({matchedRecords:5,populationSum:16});
  expect(result.exposed).toEqual({matchedRecords:4,populationSum:9,missingPopulationRecords:1,duplicateIdRecords:2});
  expect(result.byLayer.find(l=>l.id==='flood')).toMatchObject({matchedRecords:4,populationSum:9});
  expect(result.multipleHazards).toMatchObject({matchedRecords:2,populationSum:9});
  expect(result.byClass.find(c=>c.id==='high')?.matchedRecords).toBe(3);
  expect(result.unavailableMunicipalities).toContain('San Vicente');
  const filtered=summarizeLayerExposure(index,{...selection,layers:['flood'],floodClasses:['High'],municipality:'Daet',barangay:'Bagasbas'});
  expect(filtered.exposed).toMatchObject({matchedRecords:2,populationSum:9});
  expect(filtered.byClass).toHaveLength(1);
  expect(filtered.multipleHazards.matchedRecords).toBe(0);
  const missing=summarizeLayerExposure(index,{...selection,municipality:'Paracale',barangay:'Tabas'});
  expect(missing.available.matchedRecords).toBe(0);
  expect(missing.unlocatedRecords).toBe(1);
  expect(summarizeLayerExposure(index,{...selection,municipality:'San Vicente'}).unavailableMunicipalities).toEqual(['San Vicente']);
  expect(()=>summarizeLayerExposure({...index,buckets:[{...index.buckets[0],populationSum:-1}]},selection)).toThrow(/Invalid population aggregate/);
  expect(()=>summarizeLayerExposure({...index,buckets:[{...index.buckets[0],populationSum:Number.MAX_SAFE_INTEGER},index.buckets[0]]},selection)).toThrow(/Invalid population aggregate/);
});

it('rejects damaged or incomplete private datasets instead of reporting zero exposure',async()=>{
  const bucket={municipality:'Daet',barangay:'Bagasbas',classes:['flood'],matchedRecords:1,populationSum:3,missingPopulationRecords:0,duplicateIdRecords:0};
  const index={version:1,generatedAt:'2026-09-28T00:00:00Z',method:'Original polygons',municipalities:['Daet'],sources:[],repairs:[],classes:['flood','landslide','liquefaction','tsunami'].map(layer=>({id:layer,layer,label:'High'})),buckets:[bucket]};
  const selection={layers:['flood'],floodClasses:[],municipality:'Daet',barangay:'Bagasbas'};
  const read=vi.spyOn(fs,'readFile');
  try {
    read.mockResolvedValue(JSON.stringify(index));
    await expect(analyzeLayerExposure(selection)).resolves.toMatchObject({exposed:{populationSum:3}});
    await expect(analyzeLayerExposure({...selection,layers:['storm_surge']})).rejects.toThrow(/missing from the exposure aggregate/);
    read.mockResolvedValue(JSON.stringify({...index,classes:[...index.classes,{id:'ssa1',layer:'storm_surge',label:'Class 1'}],buckets:[{...bucket,classes:['flood','ssa1']}]}));
    await expect(analyzeLayerExposure({...selection,layers:['storm_surge','flood']})).resolves.toMatchObject({exposed:{populationSum:3},multipleHazards:{populationSum:3}});
    for(const damaged of [{...index,classes:[]},{...index,buckets:[{...bucket,populationSum:'3'}]},{...index,buckets:[{...bucket,missingPopulationRecords:2}]}]) {
      read.mockResolvedValue(JSON.stringify(damaged));
      await expect(analyzeLayerExposure(selection)).rejects.toThrow();
    }
  }finally{read.mockRestore();}
});
