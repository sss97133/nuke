/**
 * eBay Browse API client for Cars & Trucks (category 6001). JSON API calls with an application token; counts every call
 * it makes so the sweep can spend the day's quota (5,000 Browse calls a day by default, raised only by eBay's Application
 * Growth Check) in the owner's order.
 */
import { appToken, ebayApiBase } from "../_shared/ebayAuth.ts";
import type { EbayItem } from "./browseMap.ts";

export const CATEGORY_CARS_TRUCKS = "6001";
const SCOPE = "https://api.ebay.com/oauth/api_scope";

export class QuotaExceeded extends Error { constructor(m: string) { super(m); this.name = "QuotaExceeded"; } }
export class ItemGone extends Error { constructor(public itemId: string) { super(`item ${itemId} not found`); this.name = "ItemGone"; } }
export class EbayApiError extends Error { constructor(public status: number, m: string) { super(m); this.name = "EbayApiError"; } }

export interface SearchSummary extends EbayItem { thumbnailImages?: unknown[] }
export interface SearchPage {
  total: number; itemSummaries: SearchSummary[]; next: string | null;
  aspectDistributions?: { localizedAspectName?: string; aspectValueDistributions?: { localizedAspectValue?: string; matchCount?: number }[] }[];
}

export class BrowseClient {
  calls = 0;
  constructor(
    private fetchFn: typeof fetch = fetch,
    private marketplace = Deno.env.get("EBAY_MARKETPLACE_ID") || "EBAY_MOTORS_US",
  ) {}

  private async get(path: string, params: Record<string, string> = {}): Promise<any> {
    const token = await appToken(SCOPE);
    if (!token) throw new EbayApiError(401, "no eBay application token (EBAY_CLIENT_ID / EBAY_CLIENT_SECRET missing or refused)");
    const qs = new URLSearchParams(params).toString();
    this.calls++;
    const r = await this.fetchFn(`${ebayApiBase()}${path}${qs ? `?${qs}` : ""}`, { // guardrail-allow: raw-fetch (eBay JSON API, bearer token)
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": this.marketplace, Accept: "application/json" },
    });
    if (r.status === 429) throw new QuotaExceeded(`eBay answered 429 on ${path}`);
    const text = await r.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    if (r.status === 404) return { __notFound: true, body };
    if (!r.ok) {
      const eid = body?.errors?.[0]?.errorId;
      if (eid === 2001 || eid === 2003) throw new QuotaExceeded(`eBay error ${eid}: ${body?.errors?.[0]?.message ?? ""}`);
      throw new EbayApiError(r.status, `eBay ${r.status} on ${path}: ${(body?.errors?.[0]?.message ?? text).slice(0, 300)}`);
    }
    return body;
  }

  /** Remaining Browse calls today per eBay's own counter (Analytics API getRateLimits), or null when it does not say. */
  async remainingToday(): Promise<{ remaining: number; limit: number; resetAt: string | null } | null> {
    try {
      const j = await this.get("/developer/analytics/v1_beta/rate_limit/", { api_context: "buy", api_name: "Browse" });
      const rates = (j?.rateLimits ?? []).flatMap((l: any) => (l.resources ?? []).flatMap((r: any) => r.rates ?? []));
      const day = rates.find((r: any) => /day|86400/i.test(String(r.timeWindow))) ?? rates[0];
      if (!day || typeof day.remaining !== "number") return null;
      return { remaining: day.remaining, limit: Number(day.limit ?? 0), resetAt: day.reset ?? null };
    } catch (e) {
      if (e instanceof QuotaExceeded) throw e;
      console.warn("[ebay] rate-limit read failed:", (e as Error).message);
      return null;
    }
  }

  /** One page of category 6001, newest first. `aspectFilter` is the already-built `categoryId:6001,<Aspect>:{..}` value. */
  async search(opts: { aspectFilter?: string; filter?: string; offset?: number; limit?: number; fieldgroups?: string; sort?: string }): Promise<SearchPage> {
    const p: Record<string, string> = {
      category_ids: CATEGORY_CARS_TRUCKS, limit: String(opts.limit ?? 200), offset: String(opts.offset ?? 0),
      sort: opts.sort ?? "newlyListed",
    };
    if (opts.aspectFilter) p.aspect_filter = opts.aspectFilter;
    if (opts.filter) p.filter = opts.filter;
    if (opts.fieldgroups) p.fieldgroups = opts.fieldgroups;
    const j = await this.get("/buy/browse/v1/item_summary/search", p);
    if (j?.__notFound) return { total: 0, itemSummaries: [], next: null };
    return { total: Number(j.total ?? 0), itemSummaries: j.itemSummaries ?? [], next: j.next ?? null, aspectDistributions: j.aspectDistributions };
  }

  /** The category's aspect names and values with counts. The Year aspect is read from here, never assumed. */
  async aspectRefinements(): Promise<NonNullable<SearchPage["aspectDistributions"]>> {
    const j = await this.search({ limit: 1, fieldgroups: "ASPECT_REFINEMENTS" });
    return j.aspectDistributions ?? [];
  }

  /** Full item. Throws ItemGone on 404 (eBay's answer for a listing that has ended and aged out). Returns the raw JSON. */
  async getItem(itemId: string): Promise<any> {
    const j = await this.get(`/buy/browse/v1/item/${encodeURIComponent(itemId)}`);
    if (j?.__notFound) throw new ItemGone(itemId);
    return j;
  }
}

/** The Year aspect's exact name and the year values eBay lists for the category, with counts. */
export function yearAspect(dist: NonNullable<SearchPage["aspectDistributions"]>): { name: string; counts: Map<number, number> } | null {
  const d = dist.find((x) => /^year$/i.test((x.localizedAspectName ?? "").trim()));
  if (!d?.localizedAspectName) return null;
  const counts = new Map<number, number>();
  for (const v of d.aspectValueDistributions ?? []) {
    const y = Number(v.localizedAspectValue);
    if (Number.isInteger(y)) counts.set(y, Number(v.matchCount ?? 0));
  }
  return { name: d.localizedAspectName, counts };
}

export const aspectFilterFor = (name: string, years: number[]) => `categoryId:${CATEGORY_CARS_TRUCKS},${name}:{${years.join("|")}}`;
