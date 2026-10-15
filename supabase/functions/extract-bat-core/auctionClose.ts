/**
 * When a BaT lot's auction is over, and which earlier end rows of its listing a closing read replaces.
 *
 * A running lot has no end event: its scheduled end and its current bid are not a result. Before 4.5.0 every read
 * wrote one anyway, so a live 1997 911 Carrera 4S showed "BaT ended • bid to $109,993" dated its scheduled end
 * while bidding stood at $250,000 (2026-10-15; 1,302 of the 1,305 auction_ended rows dated 10-15..25 were written
 * before their day). timeline_events had no correction path, so that row stood, and the sale added a second one.
 */

/** BaT shows "Checking for last second bids..." once the countdown ends; the result lands within that window. */
export const END_SETTLE_MS = 10 * 60 * 1000;

export type CloseBasis = "sale" | "auction_record" | "end_passed" | "running" | "unknown";

/** Over = the page carries a result (a sale or the closing record), or its own end passed at least END_SETTLE_MS
 *  before the page was read. The read clock is the page's (a snapshot keeps its
 *  fetch time), never the extraction time: a page captured while the lot ran shows a running lot. */
export function auctionClose(p: {
  hasSale: boolean;
  recordClosed: boolean;
  endAt: string | null;
  readAt: string | null;
}): { over: boolean; basis: CloseBasis } {
  if (p.hasSale) return { over: true, basis: "sale" };
  if (p.recordClosed) return { over: true, basis: "auction_record" };
  const end = p.endAt ? Date.parse(p.endAt) : NaN;
  const read = p.readAt ? Date.parse(p.readAt) : NaN;
  if (!Number.isFinite(end) || !Number.isFinite(read)) return { over: false, basis: "unknown" };
  return read - end >= END_SETTLE_MS ? { over: true, basis: "end_passed" } : { over: false, basis: "running" };
}

export const END_EVENT_TYPES = ["auction_sold", "auction_reserve_not_met", "auction_ended"] as const;

export interface EndRow {
  id: string;
  event_type: string;
  event_date: string;
  created_at: string;
  metadata: Record<string, any> | null;
  /** the writer; only this extractor's own rows are retired here */
  data_source?: string | null;
}

/** An auction_ended row written before the end it names: data-ends when the row recorded it, else its day. */
export function writtenBeforeItsEnd(r: EndRow): boolean {
  if (r.event_type !== "auction_ended") return false;
  const m = r.metadata ?? {};
  const end = m.occurred_at_source === "data-ends" && m.occurred_at ? Date.parse(m.occurred_at) : Date.parse(`${r.event_date}T00:00:00Z`);
  const created = Date.parse(r.created_at);
  return Number.isFinite(end) && Number.isFinite(created) && created < end;
}

/** One listing, one end. keepId: the row that already states this end (none = insert one). retire: this listing's
 *  auction_ended rows the end replaces (written while it ran, on another day, or beside a result). A sold or
 *  reserve-not-met row is never retired here: those are results, corrected only with their own evidence. Nor is
 *  another writer's row: it can stand in for the end, but only extract-bat-core's own rows are retired. */
export function planEndRows(rows: EndRow[], want: { eventType: string; eventDate: string }): { keepId: string | null; retire: EndRow[] } {
  const keep = rows.find((r) => r.event_type === want.eventType && r.event_date === want.eventDate && !writtenBeforeItsEnd(r));
  const retire = rows.filter((r) =>
    r.event_type === "auction_ended" && r.id !== keep?.id && (r.data_source ?? "extract-bat-core") === "extract-bat-core" &&
    (writtenBeforeItsEnd(r) || r.event_date !== want.eventDate || want.eventType !== "auction_ended")
  );
  return { keepId: keep?.id ?? null, retire };
}
