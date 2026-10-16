// Barrett-Jackson catalog enumeration, stage 1 (owner decision 2026-10-16: we read the public catalog despite robots.txt, politely).
// readCatalogPages fetches the listed barrett-jackson.com pages with our own identified user agent through archiveFetch (each capture
// is retained as a listing_page_snapshots row), at most one request every 3 s, and stops on the first sign of blocking (403, 429 or
// a challenge page, three in a row). summarizePage turns a page into the few facts stage 1 needs: title, how many docket-vehicle links
// it carries, pagination links, and candidate "N lots/vehicles/results" totals. Pure parts tested in catalogProbe.test.ts.

import { archiveFetch } from "../_shared/archiveFetch.ts";

export interface PageSummary {
  title: string | null;
  vehicleLinks: number;
  docketLinks: string[];
  eventLinks: string[];
  pageParams: number[];
  totals: { text: string; n: number }[];
  jsonTotal: number | null;
  challenge: boolean;
}

const BLOCK_RE = /(just a moment|cf_chl_opt|attention required|access denied|verify you are human|captcha)/i;

export function summarizePage(html: string): PageSummary {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  const vehicleLinks = new Set([...html.matchAll(/\/docket\/vehicle\/[a-z0-9-]+/gi)].map((m) => m[0])).size;
  const docketLinks = [...new Set([...html.matchAll(/href=["'](?:https?:\/\/(?:www\.)?barrett-jackson\.com)?(\/[a-z0-9-]+\/docket)\/?["']/gi)].map((m) => m[1]))].slice(0, 400);
  const eventLinks = [...new Set([...html.matchAll(/href=["'](?:https?:\/\/(?:www\.)?barrett-jackson\.com)?(\/(?:events?|auctions?)\/[a-z0-9\/_-]+)["']/gi)].map((m) => m[1]))].slice(0, 200);
  const pageParams = [...new Set([...html.matchAll(/[?&;]page=(\d{1,4})/g)].map((m) => Number(m[1])))].sort((a, b) => a - b).slice(-12);
  const text = html.replace(/<script[\s\S]*?<\/script\s*>|<style[\s\S]*?<\/style\s*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const totals = [...text.matchAll(/\b([\d,]{1,7})\s+(vehicles?|lots?|results?|items?|cars?)\b/gi)].slice(0, 8).map((m) => ({ text: m[0], n: Number(m[1].replace(/,/g, "")) })).filter((t) => Number.isFinite(t.n));
  let jsonTotal: number | null = null;
  const jt = html.match(/"pagination"\s*:\s*\{[^}]*"total"\s*:\s*(\d+)/);
  if (jt) jsonTotal = Number(jt[1]);
  return { title, vehicleLinks, docketLinks, eventLinks, pageParams, totals, jsonTotal, challenge: BLOCK_RE.test(html.slice(0, 20000)) && html.length < 80000 };
}

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
