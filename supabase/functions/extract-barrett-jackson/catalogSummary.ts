// Pure reading of one Barrett-Jackson catalog page for the stage-1 enumeration: title, docket-vehicle links, docket/event links,
// pagination params, candidate "N lots/vehicles/results" totals, a JSON pagination total, and whether the page is a challenge.
// No imports, so its test runs in CI without the remote Supabase packages. Tested in catalogSummary.test.ts.

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
  const text = html.replace(/<script[\s\S]*?<\/script[^>]*>|<style[\s\S]*?<\/style[^>]*>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const totals = [...text.matchAll(/\b([\d,]{1,7})\s+(vehicles?|lots?|results?|items?|cars?)\b/gi)].slice(0, 8).map((m) => ({ text: m[0], n: Number(m[1].replace(/,/g, "")) })).filter((t) => Number.isFinite(t.n));
  let jsonTotal: number | null = null;
  const jt = html.match(/"pagination"\s*:\s*\{[^}]*"total"\s*:\s*(\d+)/);
  if (jt) jsonTotal = Number(jt[1]);
  return { title, vehicleLinks, docketLinks, eventLinks, pageParams, totals, jsonTotal, challenge: BLOCK_RE.test(html.slice(0, 20000)) && html.length < 80000 };
}

