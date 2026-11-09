/**
 * T6: instant BaT ingest on a coverage miss.
 *
 * When a pasted Bring a Trailer lot is not in Nuke yet, evaluate_listing asks the canonical BaT writer
 * (extract-bat-core, service role) to land it, waits at most ~10 s, then evaluates the landed vehicle.
 * Only a timeout or a failed write falls back to the old path (log_listing_coverage queues the URL).
 *
 * Pure helpers + an injected invoker so the edge function, tests and the regression harness can each
 * supply their own transport (the harness and unit tests never call a real writer).
 */

/** Calls a Supabase edge function with the service role. Resolves to the parsed JSON body. */
export type InvokeFunction = (
  name: string,
  body: Record<string, unknown>,
  opts: { timeoutMs: number },
) => Promise<{ status: number; body: Record<string, unknown> }>;

export const INSTANT_INGEST_BUDGET_MS = 10_000;

/**
 * Canonical BaT lot URL (https://bringatrailer.com/listing/<slug>/) for a pasted URL or the URL the page
 * fetch landed on (a `?p=<post id>` shortlink redirects to the lot). null when neither is a BaT lot page.
 */
export function batLotUrl(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const c of candidates) {
    if (!c) continue;
    let u: URL;
    try {
      u = new URL(c);
    } catch {
      continue;
    }
    if (!/(^|\.)bringatrailer\.com$/i.test(u.hostname)) continue;
    const m = u.pathname.match(/^\/listing\/([a-z0-9][a-z0-9-]*)\/?$/i);
    if (m) return `https://bringatrailer.com/listing/${m[1].toLowerCase()}/`;
  }
  return null;
}

export type InstantIngestResult =
  | {
    status: "ingested";
    vehicle_id: string;
    created: boolean;
    ms: number;
    extractor: string;
  }
  | { status: "timeout"; ms: number; budget_ms: number }
  | { status: "failed"; ms: number; error: string }
  | { status: "skipped"; reason: string };

// Per-isolate guard so an anonymous caller cannot turn evaluate_listing into a bulk writer. Over the cap
// the miss is queued exactly as before (the scheduled extractors still land it).
const WINDOW_MS = 5 * 60_000;
const MAX_PER_WINDOW = 20;
const recent: number[] = [];
const inFlight = new Map<string, Promise<InstantIngestResult>>();

/** Test hook: clears the per-isolate rate window. */
export function _resetInstantIngestState(): void {
  recent.length = 0;
  inFlight.clear();
}

function takeSlot(now: number): boolean {
  while (recent.length && now - recent[0]! > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  return true;
}

/**
 * Lands one BaT lot through extract-bat-core inside `budgetMs`. Never throws.
 * A timeout does NOT cancel the server-side write (the extractor may still finish); the caller queues the
 * URL anyway and the queue worker finds the vehicle already landed (extract-bat-core is idempotent by URL).
 */
export async function instantIngestBat(
  invoke: InvokeFunction | undefined,
  lotUrl: string,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<InstantIngestResult> {
  if (!invoke) {
    return { status: "skipped", reason: "no service invoker configured" };
  }
  const now = opts.now ?? Date.now;
  const budget = opts.budgetMs ?? INSTANT_INGEST_BUDGET_MS;
  const existing = inFlight.get(lotUrl);
  if (existing) return existing;
  if (!takeSlot(now())) {
    return {
      status: "skipped",
      reason: "instant-ingest rate cap reached; queued instead",
    };
  }
  const started = now();
  const run = (async (): Promise<InstantIngestResult> => {
    let timer: number | undefined;
    try {
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(
          () => resolve("timeout"),
          budget,
        ) as unknown as number;
      });
      const call = invoke("extract-bat-core", {
        url: lotUrl,
        prefer_snapshot: false,
      }, { timeoutMs: budget });
      const res = await Promise.race([call, timeout]);
      const ms = now() - started;
      if (res === "timeout") {
        return { status: "timeout", ms, budget_ms: budget };
      }
      const b = res.body || {};
      if (res.status >= 400 || b.success !== true) {
        const e = typeof b.error === "string" ? b.error : `HTTP ${res.status}`;
        return { status: "failed", ms, error: e.slice(0, 300) };
      }
      const created = Array.isArray(b.created_vehicle_ids)
        ? (b.created_vehicle_ids as unknown[])
        : [];
      const updated = Array.isArray(b.updated_vehicle_ids)
        ? (b.updated_vehicle_ids as unknown[])
        : [];
      const id = String(created[0] ?? updated[0] ?? b.vehicle_id ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return {
          status: "failed",
          ms,
          error: "extractor reported success without a vehicle id",
        };
      }
      return {
        status: "ingested",
        vehicle_id: id,
        created: created.length > 0,
        ms,
        extractor: typeof b.extractor_version === "string"
          ? b.extractor_version
          : "extract-bat-core",
      };
    } catch (e) {
      const ms = now() - started;
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort|timed? ?out/i.test(msg)) {
        return { status: "timeout", ms, budget_ms: budget };
      }
      return { status: "failed", ms, error: msg.slice(0, 300) };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  })();
  inFlight.set(lotUrl, run);
  try {
    return await run;
  } finally {
    inFlight.delete(lotUrl);
  }
}

/** Service-role invoker for the deployed edge runtime. The key never leaves this closure. */
export function serviceInvoker(
  supabaseUrl: string,
  serviceKey: string,
): InvokeFunction {
  return async (name, body, { timeoutMs }) => {
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = await res.json().catch(() => ({
      success: false,
      error: `HTTP ${res.status}: non-JSON response`,
    }));
    return {
      status: res.status,
      body: (parsed && typeof parsed === "object")
        ? parsed as Record<string, unknown>
        : {},
    };
  };
}
