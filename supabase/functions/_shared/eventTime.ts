// eventTime.ts — when a thing happened (occurred_at) vs when it reached Nuke (created_at).
//
// created_at is upload time. A photo taken in June and uploaded in October is a June event; treating
// it as "current" is what dated Skylar's backlog wrong. Every ingest path stamps:
//   occurred_at  the event's own clock (EXIF taken_at, receipt transaction date), or null if unknown
//   ingest_kind  'live'     the event happened within LIVE_WINDOW of arriving
//                'backfill' an older event arriving late (a camera-roll backlog)
//                'import'   copied from another system (its clocks are that system's)
//                null       no event time, so we can't tell

export type IngestKind = "live" | "backfill" | "import";

export const LIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

/** Parse an ISO timestamp or YYYY-MM-DD date; null for missing or unparseable. */
export function parseEventTime(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? `${value.trim()}T12:00:00Z` : value.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function classifyIngest(
  occurredAt: Date | null,
  receivedAt: Date,
  opts: { imported?: boolean; liveWindowMs?: number } = {},
): IngestKind | null {
  if (opts.imported) return "import";
  if (!occurredAt) return null;
  const window = opts.liveWindowMs ?? LIVE_WINDOW_MS;
  return receivedAt.getTime() - occurredAt.getTime() > window ? "backfill" : "live";
}

/** Fields to merge into an insert/update payload. Future-dated clocks are not trusted. */
export function eventStamp(
  occurred: unknown,
  receivedAt: Date = new Date(),
  opts: { imported?: boolean } = {},
): { occurred_at: string | null; ingest_kind: IngestKind | null } {
  let at = parseEventTime(occurred);
  if (at && at.getTime() - receivedAt.getTime() > LIVE_WINDOW_MS) at = null;
  return { occurred_at: at ? at.toISOString() : null, ingest_kind: classifyIngest(at, receivedAt, opts) };
}

/** A receipt's event date: transaction, then receipt, then purchase date. */
export function receiptOccurredAt(r: {
  transaction_date?: string | null;
  receipt_date?: string | null;
  purchase_date?: string | null;
}): string | null {
  return r.transaction_date ?? r.receipt_date ?? r.purchase_date ?? null;
}
