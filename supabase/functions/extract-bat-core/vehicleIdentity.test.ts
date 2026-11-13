import { strict as assert } from 'node:assert';
import { resolveBatVehicleIdentity } from './vehicleIdentity.ts';
const locatorId='00000000-0000-4000-8000-000000000001', ownerId='00000000-0000-4000-8000-000000000002';
const vin='1HGCM82633A004352',url='https://bringatrailer.com/listing/fixture-relist';
const locator={id:locatorId,vin:null,listing_url:url,deleted_at:null,status:'active',
 origin_metadata:{source:'bat_auctions_page',platform:'bringatrailer',external_id:'123456'}};
const owner={id:ownerId,vin,deleted_at:null,status:'active'};
const input={vehicleId:locatorId,vin,sourceUrl:url,comments:[{post:123456},{post:123456}]};
function client(selected:any=locator,owners:any[]=[owner],failure=false){
 const calls:any[]=[];
 return {calls,from(table:string){assert.equal(table,'vehicles');const filters:any[]=[];calls.push(filters);
  const q:any={select(v:string){filters.push(['select',v]);return q;},eq(k:string,v:any){filters.push(['eq',k,v]);return q;},
   not(...x:any[]){filters.push(['not',...x]);return q;},is(...x:any[]){filters.push(['is',...x]);return q;},
   or(...x:any[]){filters.push(['or',...x]);return q;},limit(n:number){assert.equal(n,2);return Promise.resolve({data:owners,error:failure?{message:'offline'}:null});},
   maybeSingle(){return Promise.resolve({data:selected,error:null});}};return q;}};
}
Deno.test('verified inventory locator yields unique exact VIN owner before testimony',async()=>{
 const db=client();assert.deepEqual(await resolveBatVehicleIdentity(db,input),{vehicleId:ownerId,redirectedFrom:locatorId});
 assert.equal(db.calls.length,2);assert.ok(db.calls[1].some((x:any[])=>x[0]==='eq'&&x[1]==='vin'&&x[2]===vin));
 assert.ok(db.calls[1].some((x:any[])=>x[0]==='not'&&x[1]==='vin'));
});
Deno.test('correct provided canonical identity requires no candidate scan',async()=>{
 const db=client({...owner,id:ownerId});
 assert.deepEqual(await resolveBatVehicleIdentity(db,{...input,vehicleId:ownerId}),{vehicleId:ownerId,redirectedFrom:null});
 assert.equal(db.calls.length,1);
});
Deno.test('missing and short chassis preserve existing resolution without new lookups',async()=>{
 for(const value of [null,'','AB12345']){const db=client();assert.equal((await resolveBatVehicleIdentity(db,{...input,vin:value})).vehicleId,locatorId);assert.equal(db.calls.length,0);}
});
Deno.test('an unresolved exact VIN stays on its original empty-VIN vehicle',async()=>{
 assert.deepEqual(await resolveBatVehicleIdentity(client(locator,[]),input),{vehicleId:locatorId,redirectedFrom:null});
});
Deno.test('conflicting supplied VIN fails closed even if another owner matches',async()=>{
 const db=client({...locator,vin:'1HGCM82643A004352'});await assert.rejects(()=>resolveBatVehicleIdentity(db,input),/contradicts/);assert.equal(db.calls.length,1);
});
Deno.test('ambiguous, deleted, merged, mismatched and unavailable VIN candidates cannot redirect',async()=>{
 for(const owners of [[owner,{...owner,id:locatorId}],[{...owner,deleted_at:'2026-01-01'}],[{...owner,status:'merged'}],
  [{...owner,merged_into_vehicle_id:locatorId,status:'active'}],[{...owner,merged_into_vehicle_id:locatorId,status:null}],[{...owner,vin:'OTHER'}]])
  await assert.rejects(()=>resolveBatVehicleIdentity(client(locator,owners),input),/ambiguous/);
 await assert.rejects(()=>resolveBatVehicleIdentity(client(locator,[owner],true),input),/unavailable/);
});
Deno.test('missing deleted or merged supplied vehicle fails before evidence writes',async()=>{
 for(const selected of [null,{...locator,deleted_at:'2026-01-01'},{...locator,status:'merged'},
  {...locator,merged_into_vehicle_id:ownerId,status:'active'},{...locator,merged_into_vehicle_id:ownerId,status:null}])
  await assert.rejects(()=>resolveBatVehicleIdentity(client(selected),input),/unavailable/);
});
Deno.test('native post, exact lot URL and inventory provenance are all required',async()=>{
 for(const selected of [
  {...locator,listing_url:url+'-other'},
  {...locator,listing_url:'https://bringatrailer.example/listing/fixture-relist'},
  {...locator,origin_metadata:{...locator.origin_metadata,source:'manual'}},
  {...locator,origin_metadata:{...locator.origin_metadata,platform:'other'}},
  {...locator,origin_metadata:{...locator.origin_metadata,external_id:'654321'}},
 ]) await assert.rejects(()=>resolveBatVehicleIdentity(client(selected),input),/unverified/);
 for(const comments of [[],[{post:123456},{post:654321}], [{}]])
  await assert.rejects(()=>resolveBatVehicleIdentity(client(),{...input,comments}),/unverified/);
});
