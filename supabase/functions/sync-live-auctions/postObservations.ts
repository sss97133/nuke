import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import type { ObservationPost } from "./boards.ts";

/**
 * Posts observations through ingest-observation, skipping those already held (same kind and source_identifier), a few
 * at a time, until the deadline; what is left is posted on a later run (it is still not held then).
 */
export async function postObservations(
  supabase: any,
  posts: ObservationPost[],
  deadline: number,
  maxPosts: number,
  prepare?: (post: ObservationPost) => Promise<ObservationPost>,
): Promise<{ candidates: number; held: number; posted: number; deferred: number; errors: string[] }> {
  const out = { candidates: posts.length, held: 0, posted: 0, deferred: 0, errors: [] as string[] };
  const have = new Set<string>();
  for (let i = 0; i < posts.length; i += 100) {
    const chunk = posts.slice(i, i + 100);
    for (const kind of new Set(chunk.map((p) => p.kind))) {
      const { data, error } = await supabase.from("vehicle_observations").select("source_identifier").eq("kind", kind)
        .in("source_identifier", chunk.filter((p) => p.kind === kind).map((p) => p.source_identifier));
      if (error) { out.errors.push(`held check: ${error.message}`); return out; }
      for (const r of (data ?? []) as { source_identifier: string }[]) have.add(`${kind}|${r.source_identifier}`);
    }
  }
  const todo = posts.filter((p) => !have.has(`${p.kind}|${p.source_identifier}`));
  out.held = posts.length - todo.length;
  const base = Deno.env.get("SUPABASE_URL") ?? "";
  const key = projectSecretKey() ?? "";
  // Function-to-function calls share the platform's per-trace budget (2026-11-08: a 200-post first run was refused at
  // about 60 and the refusal took the whole sync with it), so a run posts at most maxPosts, three at a time, and stops
  // at the first refusal; the rest are still not held and post on a later run.
  let stop = false;
  for (let i = 0; i < todo.length;) {
    if (stop || Date.now() > deadline || i >= maxPosts) { out.deferred += todo.length - i; break; }
    const batch = todo.slice(i, Math.min(i + 3, maxPosts));
    i += batch.length;
    await Promise.all(batch.map(async (p) => {
      try {
        const payload = prepare ? await prepare(p) : p;
        if (Date.now() > deadline) { out.deferred++; return; }
        const res = await fetch(`${base}/functions/v1/ingest-observation`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const admitted = await res.json().catch(() => null);
        if (res.ok && admitted?.success === true && typeof admitted.observation_id === "string") out.posted++;
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

