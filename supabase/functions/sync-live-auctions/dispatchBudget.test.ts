import { strict as assert } from "node:assert";
import { auctionDispatchBudget, admissionConfirmed, postObservations, postResultsBeforeBids } from "./postObservations.ts";
import type { ObservationPost } from "./boards.ts";
const posts = (n: number) => Array.from({length:n}, (_,i) => ({kind:"bid", source_identifier:`fixture:${i}`} as ObservationPost));
const db:any={from(){const q:any={select(){return q;},eq(){return q;},in:async()=>({data:[],error:null})};return q;}};
Deno.test("shared dispatch accounts BaT and preserves PCar ten slots regardless stage order",()=>{
 for(const order of [["bat","cc","pcar"],["cc","pcar","bat"],["pcar","bat","cc"]] as const){
  const b=auctionDispatchBudget(true);
  for(const lane of order) for(let i=0;i<40;i++) b.take(lane);
  assert.equal(b.receipt().attempted,30);assert.equal(b.receipt().pcar,10);
  assert.ok(b.receipt().cc<=20);assert.ok(b.receipt().bat<=10);
 }
});
Deno.test("actual admissions reserve PCar, prioritize five results and honestly defer excess",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({success:true,observation_id:"fixture-id"});};
 try{
  for(const hasPcar of [true,false]) for(const resultCount of [0,8]){
   calls=0;const b=auctionDispatchBudget(hasPcar),deadline=Date.now()+5000;
   const results=await postObservations(db,posts(resultCount),deadline,Math.min(5,b.remaining("cc")),undefined,b);
   const bids=await postObservations(db,posts(50),deadline,b.remaining("cc"),undefined,b);
   assert.equal(results.posted,Math.min(5,resultCount));
   assert.equal(results.deferred,resultCount-results.posted);
   assert.equal(calls,hasPcar?20:30);
   assert.equal(bids.deferred,50-bids.posted);
   assert.equal(b.remaining("pcar"),hasPcar?10:0);
  }
  const empty=auctionDispatchBudget(false);while(empty.take("cc")){}
  calls=0;let prepared=0;
  const r=await postObservations(db,posts(4),Date.now()+5000,40,async p=>{prepared++;return p;},empty);
  assert.equal(r.deferred,4);assert.equal(calls,0);assert.equal(prepared,0);
 }finally{globalThis.fetch=original;}
});
Deno.test("failed canonical acknowledgements consume dispatch but never count as landed",async()=>{
 for(const body of [{success:false},{success:true},{success:true,observation_id:""},{observation_id:"id"}]) assert.equal(admissionConfirmed(true,body),false);
 assert.equal(admissionConfirmed(false,{success:true,observation_id:"id"}),false);
 const original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({success:false});
 try{const b=auctionDispatchBudget(true);const r=await postObservations(db,posts(8),Date.now()+5000,20,undefined,b);
  assert.equal(r.posted,0);assert.equal(r.errors.length,3);assert.equal(r.deferred,5);assert.equal(b.receipt().attempted,3);
 }finally{globalThis.fetch=original;}
});

Deno.test("failed, malformed and slow optional results never block current native admissions",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({success:true,observation_id:"native-receipt"});};
 try {
  for(const collect of [
   async()=>{throw TypeError("network failed");},
   async()=>{JSON.parse("malformed");throw Error("unreachable");},
   async(signal:AbortSignal)=>new Promise<never>((_resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("aborted")))),
  ]) {
   calls=0;const budget=auctionDispatchBudget(true);
   // Ten seconds are reserved; this gives optional collection only twenty milliseconds.
   const deadline=Date.now()+10_020;
   const result=await postResultsBeforeBids(db,collect,deadline,budget);
   assert.equal(result.posted,0);assert.equal(result.pending_unknown,true);assert.equal(result.errors.length,1);
   const bids=await postObservations(db,posts(25),deadline,budget.remaining("cc"),undefined,budget);
   assert.equal(bids.posted,20);assert.equal(bids.deferred,5);assert.equal(calls,20);
  }
 }finally{globalThis.fetch=original;}
});
Deno.test("results held reads and uncertain admission cannot consume reserved live-capture time",async()=>{
 const original=globalThis.fetch;
 try {
  for(const stage of ["held","admission"]) {
   let heldSignal:AbortSignal|undefined, admissionSignal:AbortSignal|undefined;
   const boundedDb:any={from(){const q:any={select(){return q;},eq(){return q;},in(){return q;},abortSignal(s:AbortSignal){heldSignal=s;return q;},
    then(resolve:any,reject:any){if(stage==="held") heldSignal!.addEventListener("abort",()=>reject(Error("held aborted")));
     else resolve({data:[],error:null});}};return q;}};
   globalThis.fetch=async(_url,init)=>{admissionSignal=init?.signal as AbortSignal;
    return await new Promise<Response>((_resolve,reject)=>admissionSignal!.addEventListener("abort",()=>reject(Error("admission aborted"))));};
   const budget=auctionDispatchBudget(true),started=Date.now(),deadline=started+10_030;
   const result=await postResultsBeforeBids(boundedDb,async()=>({posts:posts(1),sold_index:1,followed_closed:0}),deadline,budget);
   assert.equal(result.posted,0);assert.equal(result.pending_unknown,true);assert.ok(Date.now()-started<1000);
   assert.equal(heldSignal?.aborted,true);assert.equal(budget.receipt().attempted,stage==="admission"?1:0);
   if(stage==="admission")assert.equal(admissionSignal?.aborted,true);
   globalThis.fetch=async()=>Response.json({success:true,observation_id:"current-native"});
   const bids=await postObservations(db,posts(25),deadline,budget.remaining("cc"),undefined,budget);
   assert.equal(bids.posted,stage==="admission"?19:20);
   assert.equal(budget.receipt().attempted,20);
  }
 }finally{globalThis.fetch=original;}
});
