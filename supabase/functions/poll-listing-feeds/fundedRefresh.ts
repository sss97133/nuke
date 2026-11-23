import { FUNDING_SOURCE, readRefreshQuote, refreshQuote } from "../create-api-access-checkout/sourceRefresh.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

/** Ordinary and contributed polls share this lease only for explicitly enabled
 * funding policies. An absent policy leaves existing polling behavior alone. */
export async function claimConfiguredSourceLease(db: any, source: string, run: string): Promise<((knownComplete: boolean) => Promise<void>) | null> {
  const { data, error } = await db.from('platform_config').select('config_value').eq('config_key','source_refresh_funding').maybeSingle();
  if (error) throw Error('Source funding policy unavailable');
  const policy=data?.config_value;
  const enabled=policy?.enabled===true && Object.keys(policy.sources ?? {}).some(key=>refreshQuote(key,policy,{})?.feed_source===source);
  if (!enabled) return async()=>{};
  const { data: lease, error: claimError }=await db.rpc('claim_source_refresh_feed_lease', {p_source:source,p_run:run,p_lease:crypto.randomUUID()});
  if (claimError) throw Error('Shared source lease unavailable');
  if (!lease) return null;
  return async (knownComplete:boolean)=>{
    const {error:releaseError}=await db.rpc('finish_source_refresh_feed_lease',{p_lease:lease,p_run:run,p_complete:knownComplete});
    if(releaseError)throw Error('Shared source lease result unacknowledged');
  };
}

/** A failed begin receipt precedes all source work, so it cannot have incurred a
 * source/provider attempt. After begin, errors conservatively require review. */
export async function beginLeasedSourceAttempt(receipt: any, feedId: string, finish: (complete:boolean)=>Promise<void>): Promise<void> {
  try { await receipt.begin(feedId); }
  catch (error) { await finish(true); throw error; }
}

export function sourceAttemptKnownComplete(result:any):boolean {
  return !!result && !result.error;
}

/** Interpret acknowledged child progress, never the HTTP dispatch alone. Any
 * uncertain started attempt needs reconciliation rather than another paid run. */
export function fundedOutcome(run: any, source: string): { status: string; result: Record<string, unknown> } {
  const targets = run?.metadata?.targets;
  if (!run || run.metadata?.contract !== "source_intake_run_v1" || !Array.isArray(targets) ||
      targets.length > 1 || targets.some((t: any) => t.source !== source ||
        t.attempted_at !== null && (typeof t.attempted_at !== "string" || !Number.isFinite(Date.parse(t.attempted_at))))) {
    return { status: "needs_review", result: { reason: "refresh_progress_unavailable" } };
  }
  const attempted = targets.some((t: any) => t.attempted_at !== null);
  if (!attempted && ["completed", "throttled"].includes(run.status)) return { status: "funded", result: { reason: "waiting_for_source_schedule" } };
  if (run.status !== "completed" || targets.some((t: any) => t.state !== "completed")) {
    return { status: "needs_review", result: { reason: "refresh_attempt_needs_review" } };
  }
  const counts = targets[0]?.counts ?? {};
  if (![counts.queue_rows_acknowledged, counts.landed_ledger_acknowledged].every(n => Number.isSafeInteger(n) && n >= 0)) {
    return { status: "needs_review", result: { reason: "refresh_progress_unavailable" } };
  }
  return { status: "completed", result: { reason: "feed_refresh_completed",
    queued: counts.queue_rows_acknowledged ?? 0, ingested: counts.landed_ledger_acknowledged ?? 0 } };
}

/** Drained by the existing general feed schedule. No new schedule, forced
 * backoff reset, source enable switch or provider purchase is hidden here. */
export async function dispatchFundedRefresh(db: any, fetcher: typeof fetch = fetch): Promise<Record<string, unknown> | null> {
  const { data: rows, error } = await db.from("extraction_runs").select("id,status,started_at,metadata")
    .eq("source", FUNDING_SOURCE).in("status", ["funded", "dispatching"])
    .order("metadata->>checked_at", { nullsFirst: true }).order("started_at").order("id").limit(10);
  if (error) throw new Error("Funded refresh queue unavailable");
  for (const row of rows ?? []) {
    const result = await dispatchRow(db, row, fetcher);
    if (result) return result;
  }
  return null;
}

async function dispatchRow(db: any, row: any, fetcher: typeof fetch): Promise<Record<string, unknown> | null> {
  let metadata = row.metadata;
  if (row.status === "funded") {
    if (metadata.amount_cents !== 0) {
      const { error }=await db.from('extraction_runs').update({status:'needs_review',metadata:{...metadata,
        result:{reason:'provider_budget_not_connected'}}}).eq('id',row.id).eq('status','funded');
      if(error)throw Error('Paid source budget hold unavailable');
      return {request_id:row.id,status:'needs_review',result:{reason:'provider_budget_not_connected'}};
    }
    const quote = await readRefreshQuote(db, metadata.source, true);
    if (!quote || quote.feed_source !== metadata.feed_source || quote.provider !== metadata.provider ||
        quote.billing_reference !== metadata.billing_reference) {
      // Rotate held requests so one changed source cannot starve other payers.
      const { error: heldError } = await db.from("extraction_runs").update({ metadata: {
        ...metadata, checked_at: new Date().toISOString() } }).eq("id", row.id).eq("status", "funded");
      if (heldError) throw new Error("Funded refresh hold status unavailable");
      return null;
    }
    const { data: claimed, error: claimError } = await db.rpc("claim_source_refresh_dispatch", {
      p_request: row.id, p_run: crypto.randomUUID(),
    });
    if (claimError) throw new Error("Funded refresh claim unavailable");
    if (!claimed) return null;
    metadata = claimed;
    const key = projectSecretKey();
    try {
      // One existing enabled feed, under current per-source controls. The child
      // run id is durably saved before dispatch, so a lost response is readable.
      await fetcher(`${Deno.env.get("SUPABASE_URL")}/functions/v1/poll-listing-feeds`, {
        method: "POST", headers: { apikey: key!, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        signal: AbortSignal.timeout(110_000), body: JSON.stringify({ funding_dispatch: true,
          intake_run_id: metadata.run_id, source: quote.feed_source, batch_size: 1,
          max_ingests: Math.min(quote.max_ingests, metadata.max_ingests) }),
      });
    } catch { /* Reconcile durable child progress below; never repeat an uncertain call. */ }
  } else if (Date.now() - Date.parse(metadata.dispatched_at) < 180_000) {
    return null;
  }
  const { data: run, error: readError } = await db.from("extraction_runs").select("status,metadata")
    .eq("id", metadata.run_id).eq("source", "poll-listing-feeds").maybeSingle();
  if (readError) throw new Error("Funded refresh progress unavailable");
  // An in-flight child keeps its lease. A later schedule reconciles it.
  if (run?.status === "running" && Date.now() - Date.parse(metadata.dispatched_at) < 180_000) return { request_id: row.id, status: "dispatching" };
  const outcome = fundedOutcome(run, metadata.feed_source);
  const { data: finished, error: finishError } = await db.from("extraction_runs").update({ status: outcome.status,
    completed_at: outcome.status === "funded" ? null : new Date().toISOString(), metadata: { ...metadata,
      dispatch_lease_held: outcome.status === "needs_review", result: outcome.result } })
    .eq("id", row.id).eq("status", "dispatching").eq("metadata->>run_id", metadata.run_id).select("id");
  if (finishError || finished?.length !== 1) throw new Error("Funded refresh result unacknowledged");
  return { request_id: row.id, status: outcome.status, result: outcome.result };
}
