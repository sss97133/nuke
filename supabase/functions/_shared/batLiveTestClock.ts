import { strict as assert } from "node:assert";

// Control the collector's clock and waits together. Real one-second timers can
// wake just before its threshold, making short fixtures skip a heartbeat/ping.
export async function withCollectorClock(run:()=>Promise<void>) {
  const realNow=Date.now,realSetTimeout=globalThis.setTimeout,realClearTimeout=globalThis.clearTimeout;
  let now=realNow(),nextId=0,pump:ReturnType<typeof globalThis.setTimeout>|undefined;
  const timers=new Map<number,{at:number;run:()=>void}>();
  const schedule=()=>{
    if(pump!==undefined||!timers.size)return;
    pump=realSetTimeout(()=>{
      pump=undefined;
      const next=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(next){timers.delete(next[0]);now=Math.max(now,next[1].at);next[1].run();}
      schedule();
    },0);
  };
  Date.now=()=>now;
  globalThis.setTimeout=((handler:Parameters<typeof setTimeout>[0],delay=0,...args:unknown[])=>{
    assert.equal(typeof handler,"function");
    const id=++nextId;
    timers.set(id,{at:now+Math.max(0,delay),run:()=>{(handler as (...args:unknown[])=>void)(...args);}});
    schedule();return id;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout=(id)=>{if(typeof id==="number")timers.delete(id);};
  try { await run(); }
  finally {
    if(pump!==undefined)realClearTimeout(pump);
    Date.now=realNow;globalThis.setTimeout=realSetTimeout;globalThis.clearTimeout=realClearTimeout;
  }
}
