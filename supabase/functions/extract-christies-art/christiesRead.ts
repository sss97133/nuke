/** Christie's public results JSON, read politely. No database. Shared by the edge function and the dry run. */
import {
  artDepartment, christiesLotRecord, saleNumber, type ChristiesEvent, type ChristiesLot, type ChristiesLotRecord,
} from "./christiesLot.ts";

export const HOST = "https://www.christies.com";
export const MAX_REQUESTS = 6;
export const GAP_MS = 2000;
export const PAGE_SIZE = 100;
/** Plain UA: on 2026-11-09 a self-identifying bot UA was tarpitted (no response in 20 s) while "Mozilla/5.0" got 200 in ~1 s. */
const UA = "Mozilla/5.0";
const TIMEOUT_MS = 20_000;

/** A polite reader: one request at a time, GAP_MS apart, at most MAX_REQUESTS per run. */
export class Reader {
  requests = 0;
  private last = 0;
  constructor(private readonly max = MAX_REQUESTS, private readonly gap = GAP_MS) {}
  get exhausted(): boolean { return this.requests >= this.max; }
  async json<T>(path: string): Promise<{ status: number; data: T | null }> {
    if (this.exhausted) return { status: 0, data: null };
    const wait = this.last + this.gap - Date.now();
    if (this.requests > 0 && wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.requests += 1;
    this.last = Date.now();
    let res: Response;
    try {
      res = await fetch(`${HOST}${path}`, { // guardrail-allow: raw-fetch
        headers: { "User-Agent": UA, "Accept": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      return { status: 408, data: null }; // timeout or network error: callers stop the run, like a 429
    }
    if (!res.ok) return { status: res.status, data: null };
    return { status: res.status, data: await res.json() as T };
  }
}

export const calendarPath = (year: number, month: number) =>
  `/api/discoverywebsite/auctioncalendar/auctionresults?language=en&month=${month}&year=${year}`;
export const lotsPath = (ev: ChristiesEvent, page: number, size = PAGE_SIZE) =>
  `/api/discoverywebsite/auctionpages/lotsearch?action=paging&language=en&page=${page}&pagesize=${size}` +
  `&saleid=${encodeURIComponent(ev.event_id)}&salenumber=${encodeURIComponent(saleNumber(ev) ?? "")}&saletype=Sale&sortby=LotNumber`;

/** The art sales of one month, in the calendar's order (the order is stable, so a sale index is a position). */
export async function artSales(reader: Reader, year: number, month: number): Promise<{ status: number; sales: ChristiesEvent[] }> {
  const { status, data } = await reader.json<{ events?: ChristiesEvent[] }>(calendarPath(year, month));
  return { status, sales: (data?.events ?? []).filter((e) => artDepartment(e) !== null && saleNumber(e) !== null) };
}

/** Every lot of one sale mapped, page by page, while the read budget lasts. complete = every page was read. */
export async function saleLots(reader: Reader, ev: ChristiesEvent, ctx: { page: number; pass: number }, size = PAGE_SIZE):
  Promise<{ status: number; complete: boolean; records: ChristiesLotRecord[]; outside: number }> {
  const records: ChristiesLotRecord[] = [];
  let outside = 0;
  for (let page = 1; ; page++) {
    if (reader.exhausted) return { status: 0, complete: false, records, outside };
    const { status, data } = await reader.json<{ lots?: ChristiesLot[]; total_hits_filtered?: number }>(lotsPath(ev, page, size));
    if (!data) return { status, complete: false, records, outside };
    const readAt = new Date().toISOString();
    for (const lot of data.lots ?? []) {
      const rec = christiesLotRecord(lot, ev, { readAt, ...ctx });
      if (rec) records.push(rec); else outside += 1;
    }
    const total = Number(data.total_hits_filtered) || 0;
    if (!data.lots?.length || page * size >= total) return { status, complete: true, records, outside };
  }
}
