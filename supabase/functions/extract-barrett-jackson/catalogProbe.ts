// Barrett-Jackson catalog enumeration, stage 1 (owner decision 2026-10-16: we read the public catalog despite robots.txt, politely).
// readCatalogPages fetches the listed barrett-jackson.com pages with our own identified user agent through archiveFetch (each capture
// is retained as a listing_page_snapshots row), at most one request every 3 s, and stops on the first sign of blocking (403, 429 or
// a challenge page, three in a row). summarizePage turns a page into the few facts stage 1 needs: title, how many docket-vehicle links
// it carries, pagination links, and candidate "N lots/vehicles/results" totals. Pure parts tested in catalogProbe.test.ts.

import { archiveFetch } from "../_shared/archiveFetch.ts";
import { summarizePage, type PageSummary } from "./catalogSummary.ts";

export interface CatalogRead { url: string; status: number | null; bytes: number; snapshotId: string | null; ms: number; summary: PageSummary | null; error: string | null }

export async function readCatalogPages(urls: string[], opts: { delayMs?: number } = {}): Promise<{ reads: CatalogRead[]; stopped: string | null }> {
  const delay = Math.max(opts.delayMs ?? 3000, 3000);
  const reads: CatalogRead[] = [];
  let blocked = 0;
  let stopped: string | null = null;
  for (const url of urls) {
    if (!/^https:\/\/(www\.)?barrett-jackson\.com\//.test(url)) { reads.push({ url, status: null, bytes: 0, snapshotId: null, ms: 0, summary: null, error: "not a barrett-jackson.com URL" }); continue; }
    const t0 = Date.now();
    // useFirecrawl false; the generic fetch sends our identified agent (NukeListingCollector), never a browser or Googlebot agent.
    const r = await archiveFetch(url, { platform: "barrett-jackson", useFirecrawl: false, skipCache: true, callerName: "extract-barrett-jackson-catalog", directFetchOptions: { publicOnly: true, timeout: 25_000 } });
    const summary = r.html ? summarizePage(r.html) : null;
    reads.push({ url, status: r.statusCode, bytes: r.html?.length ?? 0, snapshotId: r.snapshotId, ms: Date.now() - t0, summary, error: r.error });
    const sign = r.statusCode === 403 || r.statusCode === 429 || summary?.challenge === true;
    blocked = sign ? blocked + 1 : 0;
    if (sign && reads.length === 1) { stopped = `first_sign_of_blocking:${r.statusCode ?? "challenge"}`; break; }
    if (blocked >= 3) { stopped = "three_blocked_in_a_row"; break; }
    await new Promise((res) => setTimeout(res, delay));
  }
  return { reads, stopped };
}
