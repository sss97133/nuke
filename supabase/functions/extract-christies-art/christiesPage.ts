/**
 * Christie's public HTML pages, parsed as printed. Pure: no network, no database. Two pages:
 *
 *   lot page   https://www.christies.com/en/lot/lot-{object_id}
 *              The lot header component (window.chrComponents.lotHeader_*) carries data.symbols_list, the symbols the house
 *              prints against the lot: [{ code "S02", version, symbol "○♦", name "Third party guarantee", description }]
 *              (saved 2026-11-09: lot-6609192.html, lot-6609196.html). Kept exactly as printed: no symbol is mapped to a meaning
 *              here; a reader that wants "guaranteed" reads the printed name and description and says so.
 *   schedule   https://www.christies.com/en/help/buying-guide-important-information/financial-information
 *              "COMPLETE BUYER'S PREMIUM SCHEDULE FOR ALL COLLECTING CATEGORIES, EXCEPT WINE AND GOODING CHRISTIE'S
 *              (Effective 1 September 2026)": one row per sale site, rates and thresholds as printed (saved 2026-11-09:
 *              financial-information.html).
 */

export interface PrintedSymbol { code: string | null; version: string | null; symbol: string | null; name: string | null; description: string | null }
export interface LotHeader {
  object_id: string | null;
  lot_id_txt: string | null;
  price_realised_txt: string | null;
  symbols_printed: PrintedSymbol[] | null; // null: the page carried no symbols_list at all; []: it printed none
}

const str = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** The JSON value starting at s[i] (an array or object), string-aware, or null. */
function jsonAt(s: string, i: number): unknown {
  const open = s[i];
  if (open !== "[" && open !== "{") return null;
  let depth = 0, inStr = false;
  for (let j = i; j < s.length && j - i < 200_000; j++) {
    const c = s[j];
    if (inStr) { if (c === "\\") j++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") { depth--; if (depth === 0) { try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; } } }
  }
  return null;
}

/** The lot header of a lot page: identity, the printed price label value, and the printed symbols. Null when absent. */
export function lotHeader(html: string): LotHeader | null {
  const at = html.search(/window\.chrComponents\.lotHeader_[A-Za-z0-9_]*\s*=\s*\{/);
  if (at < 0) return null;
  const obj = jsonAt(html, html.indexOf("{", at)) as { data?: { lots?: Record<string, unknown>[]; symbols_list?: unknown } } | null;
  if (!obj?.data) return null;
  const lot = obj.data.lots?.[0] ?? {};
  const raw = obj.data.symbols_list;
  const symbols_printed = Array.isArray(raw)
    ? raw.slice(0, 20).map((x: Record<string, unknown>) => ({
      code: str(x?.code, 20), version: str(x?.version, 20), symbol: str(x?.symbol, 20), name: str(x?.name, 200), description: str(x?.description),
    }))
    : null;
  return { object_id: str(lot.object_id, 20), lot_id_txt: str(lot.lot_id_txt, 20), price_realised_txt: str(lot.price_realised_txt, 60), symbols_printed };
}

/** The display strings the profile already renders for Bonhams symbols (string[]): code, glyph and name as printed. */
export function symbolLabels(symbols: PrintedSymbol[]): string[] {
  return symbols.map((s) => [s.code, s.symbol, s.name].filter(Boolean).join(" ")).filter(Boolean).slice(0, 10);
}

function text(html: string): string {
  // Strip tags until nothing changes, so a tag rebuilt by a removal ("<scr<b>ipt>") cannot survive.
  let s = html.replace(/<br\s*\/?>/gi, "\n");
  for (let prev = ""; prev !== s;) { prev = s; s = s.replace(/<[^<>]*>/g, ""); }
  // "&amp;" is decoded last, so "&amp;nbsp;" stays the literal text "&nbsp;" and is not unescaped twice.
  return s.replace(/&pound;/g, "£").replace(/&euro;/g, "€").replace(/&rsquo;/g, "’").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

export interface PrintedScheduleRow { site: string; rates: string[]; thresholds: string[] }
/** The first schedule table on the financial-information page, as printed: one row per sale site. */
export function premiumScheduleRows(html: string): { effective_txt: string | null; rows: PrintedScheduleRow[] } {
  const eff = text(html).match(/\(Effective ([^)]+)\)/);
  const t0 = html.indexOf("<table"), t1 = html.indexOf("</table>", t0);
  const rows: PrintedScheduleRow[] = [];
  if (t0 >= 0 && t1 > t0) {
    for (const tr of html.slice(t0, t1).split(/<tr[^>]*>/i).slice(1)) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => text(m[1]).split("\n").map((x) => x.trim()).filter(Boolean));
      if (cells.length === 3) rows.push({ site: cells[0].join(" "), rates: cells[1], thresholds: cells[2] });
    }
  }
  return { effective_txt: eff ? eff[1].trim() : null, rows };
}
