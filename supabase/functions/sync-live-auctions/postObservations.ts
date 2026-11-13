import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import type { ObservationPost } from "./boards.ts";

export type DispatchLane = "cc" | "pcar" | "bat";

/** One invocation's measured internal-call ceiling; failed attempts still consume a slot. */
export function auctionDispatchBudget(hasPcar: boolean) {
  const used = { cc: 0, pcar: 0, bat: 0 };
  const remaining = (lane: DispatchLane) => {
    const total = 30 - used.cc - used.pcar - used.bat;
    if (lane === "pcar") return Math.max(0, Math.min(total, (hasPcar ? 10 : 0) - used.pcar));
    const reserve = hasPcar ? 10 - used.pcar : 0;
    return Math.max(0, Math.min(total - reserve, (lane === "bat" ? 10 : hasPcar ? 20 : 30) - used[lane]));
  };
  return { remaining, take(lane: DispatchLane) {
    if (!remaining(lane)) return false;
    used[lane]++; return true;
  }, receipt: () => ({ limit: 30, attempted: used.cc + used.pcar + used.bat, ...used }) };
}
export type AuctionDispatchBudget = ReturnType<typeof auctionDispatchBudget>;
export function admissionConfirmed(ok: boolean, body: any): boolean {
  return ok && body?.success === true && typeof body.observation_id === "string" && body.observation_id.length > 0;
}

/**
 * Posts observations through ingest-observation, skipping those already held (same kind and source_identifier), a few
 * at a time, until the deadline; what is left is posted on a later run (it is still not held then).
 */
export async function postObservations(
  supabase: any,
  posts: ObservationPost[],
  deadline: number,
  maxPosts: number,
  prepare?: (post: ObservationPost) => Promise<ObservationPost | null>,
  budget?: AuctionDispatchBudget,
  signal?: AbortSignal,
): Promise<{ candidates: number; held: number; posted: number; deferred: number; errors: string[] }> {
  const out = { candidates: posts.length, held: 0, posted: 0, deferred: 0, errors: [] as string[] };
  const have = new Set<string>();
  for (let i = 0; i < posts.length; i += 100) {
    const chunk = posts.slice(i, i + 100);
    for (const kind of new Set(chunk.map((p) => p.kind))) {
      const query = supabase.from("vehicle_observations").select("source_identifier").eq("kind", kind)
        .in("source_identifier", chunk.filter((p) => p.kind === kind).map((p) => p.source_identifier));
      const { data, error } = await (signal ? query.abortSignal(signal) : query);
      if (error) { out.errors.push(`held check: ${error.message}`); out.deferred = posts.length; return out; }
      for (const r of (data ?? []) as { source_identifier: string }[]) have.add(`${kind}|${r.source_identifier}`);
    }
  }
  const todo = posts.filter((p) => !have.has(`${p.kind}|${p.source_identifier}`));
  out.held = posts.length - todo.length;
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = projectSecretKey() ?? "";
  // Normal 2026-11-09 runs admitted 30 then refused the next three internal calls.
  // The shared invocation allowance includes other houses/comments; maxPosts bounds this stage.
  // A refusal leaves the remaining canonical claims retryable on a later genuine source read.
  let stop = false;
  for (let i = 0; i < todo.length;) {
    if (stop || Date.now() > deadline || i >= maxPosts || (budget && !budget.remaining("cc"))) { out.deferred += todo.length - i; break; }
    const batch = todo.slice(i, Math.min(i + 3, maxPosts));
    i += batch.length;
    await Promise.all(batch.map(async (p) => {
      try {
        const payload = prepare ? await prepare(p) : p;
        if (payload === null) { out.held++; return; } // confirmed concurrent admission, no new archive/post
        if (signal?.aborted || Date.now() > deadline || (budget && !budget.take("cc"))) { out.deferred++; return; }
        const res = await fetch(`${base}/functions/v1/ingest-observation`, {
          signal,
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const admitted = await res.json().catch(() => null);
        if (admissionConfirmed(res.ok, admitted)) out.posted++;
        else {
          out.errors.push(`${p.source_identifier}: admission not confirmed (HTTP ${res.status})`);
          if (res.ok || res.status === 429 || res.status >= 500) stop = true;
        }
      } catch (e) {
        out.errors.push(`${p.source_identifier}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
        stop = true;
      }
    }));
  }
  return out;
}


/** Optional sold-index work may use five seconds, reserving ten for the already-read live board. */
export async function postResultsBeforeBids(
  supabase: any,
  collect: (signal: AbortSignal) => Promise<{ posts: ObservationPost[]; sold_index: number; followed_closed: number }>,
  deadline: number,
  budget: AuctionDispatchBudget,
) {
  const resultDeadline = Math.min(Date.now() + 5_000, deadline - 10_000);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = (message: string) => ({ candidates: null, held: null, posted: null, deferred: null,
    sold_index: null, followed_closed: null,
    pending_unknown: true, errors: [message] });
  if (Date.now() >= resultDeadline) return unavailable("results deferred: reserved live capture time");
  try {
    return await Promise.race([
      (async () => {
        const collected = await collect(controller.signal);
        if (controller.signal.aborted) throw Error("results deferred: collection deadline");
        const result = await postObservations(supabase, collected.posts, resultDeadline,
          Math.min(5, budget.remaining("cc")), undefined, budget, controller.signal);
        if (controller.signal.aborted) throw Error("results deferred: admission outcome unconfirmed at deadline");
        return { ...result, pending_unknown: false, sold_index: collected.sold_index, followed_closed: collected.followed_closed };
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error("results deferred: collection/admission deadline; pending outcome unconfirmed")); }, resultDeadline - Date.now());
      }),
    ]);
  } catch (error) {
    return unavailable(`results unavailable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
