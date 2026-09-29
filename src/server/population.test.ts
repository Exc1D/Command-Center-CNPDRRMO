import { expect, it } from 'vitest';
import { countExposed, type PopulationPoint } from './population';
it('estimates polygon exposure with holes and reports missing/duplicate population data separately',()=>{
  const point=(coordinates:[number,number],populationCount:number|null,duplicateId=false):PopulationPoint=>({geometry:{coordinates},properties:{populationCount,duplicateId}});
  const data=[point([122.1,14.1],5),point([122.2,14.2],4,true),point([122.3,14.3],null),point([122.5,14.5],8),point([124,14],99)];
  const geometry={type:'Polygon' as const,coordinates:[[[122,14],[123,14],[123,15],[122,15],[122,14]],[[122.4,14.4],[122.6,14.4],[122.6,14.6],[122.4,14.6],[122.4,14.4]]] as [number,number][][]};
  expect(countExposed(data,geometry)).toEqual({matchedRecords:3,populationSum:9,missingPopulationRecords:1,duplicateIdRecords:1});
  expect(()=>countExposed(data,{type:'Point',coordinates:[122.1,14.1]})).toThrow(/radius/);
  expect(countExposed(data,{type:'Point',coordinates:[122.1,14.1]},100).populationSum).toBe(5);
});
