import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { dispatchFundedRefresh, fundedOutcome, claimConfiguredSourceLease, beginLeasedSourceAttempt, sourceAttemptKnownComplete } from "./fundedRefresh.ts";

const target = { source: "fixture", attempted_at: "2026-10-30T00:00:00Z", state: "completed",
  counts: { queue_rows_acknowledged: 2, landed_ledger_acknowledged: 1 } };
const run = (targets: any[], status = "completed") => ({ status, metadata: { contract: "source_intake_run_v1", targets } });
Deno.test("paid refresh completion requires same-source acknowledged child work", () => {
  assertEquals(fundedOutcome(null, "fixture").status, "needs_review");
  assertEquals(fundedOutcome(run([target]), "other").status, "needs_review");
  assertEquals(fundedOutcome(run([target], "running"), "fixture").status, "needs_review");
});

function queueFixture(enabled = true) {
  const policy = { enabled, sources: { fixture: { enabled: true, needs_funding: false, feed_source: "fixture",
    provider: "anthropic", amount_cents: 0, max_ingests: 2, replenishment_mode: "subscription_credit", allow_provider_charges: false,
    billing_verified: true, billing_reference: "fixture-billing" } } };
  const requests: any[] = [{ id: "funded-request", source: "source-refresh-funding", status: "funded",
    started_at: "2026-10-30T00:00:00Z", metadata: { source: "fixture", feed_source: "fixture", provider: "anthropic",
      amount_cents: 0, max_ingests: 2, billing_reference: "fixture-billing" } }];
  const db = { rpc: async (_name: string, args: any) => {
    const row = requests.find(r => r.id === args.p_request && r.status === 'funded');
    if (!row || requests.some(r => r.metadata?.feed_source === row.metadata.feed_source && r.metadata?.dispatch_lease_held)) return { data: null };
    row.status = 'dispatching';
    row.metadata = { ...row.metadata, run_id: args.p_run, dispatched_at: new Date().toISOString(), dispatch_lease_held: true };
    return { data: structuredClone(row.metadata) };
  }, from(table: string) {
    const filters: ((r: any) => boolean)[] = []; let update: any; let limit = Infinity;
    const records = () => table === "extraction_runs" ? requests : table === "platform_config"
      ? [{ config_key: "source_refresh_funding", config_value: policy }] : [{ id: "feed", enabled: true, source_slug: "fixture" }];
    const get = (r: any, k: string) => k.startsWith("metadata->>") ? r.metadata?.[k.slice(11)] : r[k];
    const execute = () => {
      const rows = records().filter(r => filters.every(f => f(r))).slice(0, limit);
      if (update) for (const row of rows) Object.assign(row, update);
      return { data: structuredClone(rows) };
    };
    const q: any = { select: () => q, order: () => q, limit: (n: number) => { limit = n; return q; },
      eq: (k: string, v: any) => { filters.push(r => get(r, k) === v); return q; },
      in: (k: string, vs: any[]) => { filters.push(r => vs.includes(get(r, k))); return q; },
      update: (value: any) => { update = value; return q; },
      maybeSingle: async () => { const x = execute(); return { data: x.data[0] ?? null }; },
      then: (resolve: any) => Promise.resolve(execute()).then(resolve) };
    return q;
  } };
  return { db, requests };
}

Deno.test("concurrent schedules dispatch one funded request once and reconcile a lost response", async () => {
  const f = queueFixture(); let calls = 0;
  const fetcher = async (_url: any, init: any) => {
    calls++;
    const body = JSON.parse(init.body);
    assertEquals(body.source, "fixture"); assertEquals(body.batch_size, 1); assertEquals(body.max_ingests, 2);
    assertEquals(body.force, undefined);
    f.requests.push({ id: body.intake_run_id, source: "poll-listing-feeds", ...run([target]) });
    throw new Error("response lost after child work was retained");
  };
  await Promise.all([dispatchFundedRefresh(f.db, fetcher as typeof fetch), dispatchFundedRefresh(f.db, fetcher as typeof fetch)]);
  assertEquals(calls, 1); assertEquals(f.requests[0].status, "completed");
  await dispatchFundedRefresh(f.db, fetcher as typeof fetch); assertEquals(calls, 1);
});

Deno.test("disabled source never dispatches; unknown child outcome is retained for review without another attempt", async () => {
  const held = queueFixture(false); let calls = 0;
  const fail = async () => { calls++; throw new Error("unknown delivery"); };
  await dispatchFundedRefresh(held.db, fail as typeof fetch); assertEquals(calls, 0);
  assertEquals(held.requests[0].status, "funded");
  const f = queueFixture();
  await dispatchFundedRefresh(f.db, fail as typeof fetch);
  assertEquals(f.requests[0].status, "needs_review");
  assertEquals(f.requests[0].metadata.dispatch_lease_held, true);
  f.requests.push({ ...structuredClone(f.requests[0]), id: 'another-payer', status: 'funded',
    metadata: { ...f.requests[0].metadata, dispatch_lease_held: false } });
  await dispatchFundedRefresh(f.db, fail as typeof fetch); assertEquals(calls, 1);
});

Deno.test("different payers cannot dispatch the same feed concurrently", async () => {
  const f=queueFixture();
  f.requests.push({ ...structuredClone(f.requests[0]), id:'second-payer' });
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release=resolve; });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started=resolve; });
  let calls=0;
  const fetcher=async () => { calls++; started(); await pending; throw Error('uncertain response'); };
  const first=dispatchFundedRefresh(f.db,fetcher as typeof fetch);
  await ready;
  await dispatchFundedRefresh(f.db,fetcher as typeof fetch);
  assertEquals(calls,1);
  release(); await first;
  assertEquals(f.requests[1].status,'funded');
});

Deno.test('paid receipt cannot dispatch without connected source budget accounting',async()=>{
  const f=queueFixture();f.requests[0].metadata.amount_cents=300;
  let calls=0;
  await dispatchFundedRefresh(f.db,async()=>{calls++;throw Error('must not call provider');});
  assertEquals(calls,0);assertEquals(f.requests[0].status,'needs_review');
  assertEquals(f.requests[0].metadata.result.reason,'provider_budget_not_connected');
});

Deno.test('ordinary and funded callers share an enabled source lease; absent policy changes no work',async()=>{
  let held=false,calls=0;const outcomes:boolean[]=[];
  const policy={enabled:true,sources:{alias:{enabled:true,feed_source:'fixture',provider:'anthropic',needs_funding:false,amount_cents:0,
    max_ingests:2,replenishment_mode:'subscription_credit',allow_provider_charges:false,billing_verified:true,billing_reference:'fixture-capacity'}}};
  const db={from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:{config_value:policy}})}),
    rpc:async(name:string,args:any)=>{calls++;if(name==='claim_source_refresh_feed_lease'){if(held)return{data:null};held=true;return{data:args.p_lease};}
      outcomes.push(args.p_complete);held=!args.p_complete;return{};}};
  const normal=await claimConfiguredSourceLease(db,'fixture','normal-run');
  assertEquals(typeof normal,'function');assertEquals(await claimConfiguredSourceLease(db,'fixture','funded-run'),null);
  await normal!(true);const funded=await claimConfiguredSourceLease(db,'fixture','funded-run');await funded!(false);
  assertEquals(outcomes,[true,false]);assertEquals(await claimConfiguredSourceLease(db,'fixture','another-run'),null);
  const before=calls;await (await claimConfiguredSourceLease(db,'unconfigured-source','run'))!(true);assertEquals(calls,before);
  policy.sources.alias.billing_verified=false;
  await (await claimConfiguredSourceLease(db,'fixture','unverified-policy'))!(true);assertEquals(calls,before);
});

Deno.test('definite no-attempt releases its lease; source errors never imply zero provider cost',async()=>{
  const outcomes:boolean[]=[];
  await assertRejects(()=>beginLeasedSourceAttempt({begin:async()=>{throw Error('receipt unavailable');}},'feed',async complete=>{outcomes.push(complete);}));
  assertEquals(outcomes,[true]);
  assertEquals(sourceAttemptKnownComplete(undefined),false);
  assertEquals(sourceAttemptKnownComplete({error:'acknowledged HTTP error; billing unknown'}),false);
  assertEquals(sourceAttemptKnownComplete({error:null,new_ingested:0}),true);
});
Deno.test("scheduled waits remain funded; failed or uncertain attempts never trigger another paid attempt", () => {
  assertEquals(fundedOutcome(run([]), "fixture").status, "funded");
  assertEquals(fundedOutcome(run([{ ...target, attempted_at: null, state: "deferred" }]), "fixture").status, "funded");
  assertEquals(fundedOutcome(run([{ ...target, state: "failed" }]), "fixture").status, "needs_review");
  assertEquals(fundedOutcome(run([{ ...target, counts: {} }]), "fixture").status, "needs_review");
  assertEquals(fundedOutcome(run([target]), "fixture"), { status: "completed",
    result: { reason: "feed_refresh_completed", queued: 2, ingested: 1 } });
});
