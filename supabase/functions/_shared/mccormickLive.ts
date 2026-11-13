import { htmlToText } from "./htmlToText.ts";
import { mccormickTarget, mccormickVisibleHtml } from "./mccormickParser.ts";

export const MCCORMICK_LIVE_METHOD = "mccormick_live_v1";
export const MCCORMICK_ORIGIN = "https://www.classic-carauction.com";
const plain = (html: string) => htmlToText(mccormickVisibleHtml(html)).replace(/\s+/g, " ").trim();
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const day = (month: string, d: number, year: number) => {
  const m = months.indexOf(month.toLowerCase());
  const date = new Date(Date.UTC(year, m, d));
  if (m < 0 || year < 2000 || year > 2100 || date.getUTCMonth() !== m || date.getUTCDate() !== d) throw Error("mccormick_invalid_sale_day");
  return date.toISOString().slice(0, 10);
};
export type McCormickSale = { auction_number: string; sale_key: string; name: string; starts_on: string; ends_on: string;
  location: string; source_url: string; lots_listed: number | null };
export type McCormickInventoryRow = { native_id: string; source_url: string; inventory_kind: "auction" | "showroom";
  sale_key: string | null; lot_number: string; year: number | null; make: string; model: string; title: string;
  source_status: "scheduled" | "available" | "sold"; asking_amount: number | null; currency: null; run_on: string | null };

export function mccormickLiveLinks(html: string) {
  const text = plain(html), match = text.match(/Auction\s+(\d+)\s+is\s+OPEN\s+for\s+registration/i);
  if (!match) throw Error("mccormick_current_auction_not_identified");
  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].flatMap(m => {
    try { const u = new URL(m[1].replace(/&amp;/g, "&"), MCCORMICK_ORIGIN);
      return u.origin === MCCORMICK_ORIGIN && !u.username && !u.password ? [u.href] : [];
    } catch { return []; }
  });
  const event = links.find(url => new URL(url).pathname.toLowerCase() === `/auction-${match[1]}`);
  // The footer's "Our Next Auction" can link to the previous auction. The
  // registration number and an actually advertised matching page must agree.
  if (!event) throw Error("mccormick_current_event_link_missing");
  const future = html.match(/Future Auction Dates[\s\S]{0,1800}?href=["']([^"']*news_stories\.cfm\?newsid=\d+)["']/i)?.[1];
  const futureUrl = future ? new URL(future.replace(/&amp;/g, "&"), MCCORMICK_ORIGIN) : null;
  if (futureUrl && futureUrl.origin !== MCCORMICK_ORIGIN) throw Error("mccormick_future_schedule_external");
  return { auction_number: match[1], event_url: event, future_url: futureUrl?.href ?? null };
}

export function parseMcCormickSale(html: string, sourceUrl: string): McCormickSale {
  const u = new URL(sourceUrl), pathNumber = u.pathname.match(/^\/Auction-(\d+)$/i)?.[1];
  if (u.origin !== MCCORMICK_ORIGIN || !pathNumber) throw Error("mccormick_event_url_invalid");
  const m = plain(html).match(/Our next auction will be our (\d+)(?:st|nd|rd|th) event\.\s*It will take place ([a-z]+) (\d{1,2})\s*-\s*(\d{1,2}),?\s*(\d{4}) at ([^.]+)/i);
  if (!m || m[1] !== pathNumber) throw Error("mccormick_event_identity_or_dates_missing");
  const starts = day(m[2], Number(m[3]), Number(m[5])), ends = day(m[2], Number(m[4]), Number(m[5]));
  if (ends < starts || Date.parse(ends) - Date.parse(starts) > 6 * 86400000) throw Error("mccormick_event_span_invalid");
  return { auction_number: m[1], sale_key: `mccormicks-${m[1]}`, name: `McCormick’s Auction ${m[1]}`,
    starts_on: starts, ends_on: ends, location: m[6].trim(), source_url: sourceUrl, lots_listed: null };
}

export function parseMcCormickFutureSales(html: string, sourceUrl: string): McCormickSale[] {
  const u = new URL(sourceUrl);
  if (u.origin !== MCCORMICK_ORIGIN || u.pathname !== "/news_stories.cfm" || !/^\d+$/.test(u.searchParams.get("newsid") ?? "")) throw Error("mccormick_schedule_url_invalid");
  const text = plain(html), location = text.match(/All events taking place at our usual location,\s*([^.]+)/i)?.[1];
  if (!location) throw Error("mccormick_future_location_missing");
  const sales: McCormickSale[] = [];
  for (const m of text.matchAll(/Our\s+(\d+)(?:st|nd|rd|th)\s+auction will take place\s+([a-z]+)\s+([\d\s,&a-z]+?)\s+(\d{4})(?=\s|$)/gi)) {
    const days = [...m[3].matchAll(/\d{1,2}/g)].map(x => Number(x[0]));
    if (days.length < 1 || days.length > 4 || days.some((d, i) => i > 0 && d !== days[i - 1] + 1)) throw Error("mccormick_future_days_invalid");
    sales.push({ auction_number: m[1], sale_key: `mccormicks-${m[1]}`, name: `McCormick’s Auction ${m[1]}`,
      starts_on: day(m[2], days[0], Number(m[4])), ends_on: day(m[2], days.at(-1)!, Number(m[4])),
      location, source_url: sourceUrl, lots_listed: null });
  }
  if (!sales.length || new Set(sales.map(s => s.sale_key)).size !== sales.length) throw Error("mccormick_future_schedule_unrecognized");
  return sales;
}

/** Parse each complete source document once, then resolve every lot against
 * the same agreed ranges. Re-tokenizing the full catalog per lot exceeds the
 * Edge CPU allowance on a real sale roster. */
export function mccormickRunDayReader(sale: McCormickSale, catalogHtml: string, scheduleHtml: string): (lot: string) => string | null {
  const catalog = plain(catalogHtml), schedule = plain(scheduleHtml);
  const ranges = [...catalog.matchAll(/Lots\s+(\d+)\s*-\s*(\d+)\s+(Friday|Saturday|Sunday)/gi)];
  const monthPattern = months.join("|");
  const calendarDays = new Map<string, string>();
  const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let t = Date.parse(sale.starts_on + "T12:00:00Z"); t <= Date.parse(sale.ends_on + "T12:00:00Z"); t += 86400000) {
    const date = new Date(t); calendarDays.set(weekdays[date.getUTCDay()], date.toISOString().slice(0, 10));
  }
  const rules = ranges.map(range => {
    const weekday = range[3].toLowerCase();
    const section = schedule.match(new RegExp(`\\b${weekday},?\\s+(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?([\\s\\S]*?)(?=\\b(?:FRIDAY|SATURDAY|SUNDAY),?\\s+(?:${monthPattern})\\s+\\d|Classic Car Auctions|$)`, "i"));
    const stated = section?.[3].match(/LOTS\s+(\d+)\s*-\s*(\d+)/i);
    const statedDay = stated ? day(section![1], Number(section![2]), Number(sale.starts_on.slice(0, 4))) : null;
    return { low: Number(range[1]), high: Number(range[2]), statedLow: stated ? Number(stated[1]) : null,
      statedHigh: stated ? Number(stated[2]) : null, on: statedDay && calendarDays.get(weekday) === statedDay ? statedDay : null };
  });
  return (lot: string) => {
    if (!/^\d+$/.test(lot)) return null;
    const number = Number(lot), matches = rules.filter(r => number >= r.low && number <= r.high);
    if (matches.length !== 1) return null;
    const rule = matches[0];
    return rule.on && rule.statedLow !== null && rule.statedHigh !== null
      && number >= rule.statedLow && number <= rule.statedHigh ? rule.on : null;
  };
}

/** Only a run day stated by both current catalog and schedule is projected. */
export function mccormickRunDay(lot: string, sale: McCormickSale, catalogHtml: string, scheduleHtml: string): string | null {
  return mccormickRunDayReader(sale, catalogHtml, scheduleHtml)(lot);
}

/** Enumerate real linked rows; a bad/empty page never becomes a complete empty roster. */
export function parseMcCormickInventory(html: string, kind: "auction" | "showroom", sale?: McCormickSale): McCormickInventoryRow[] {
  const base = `${MCCORMICK_ORIGIN}/${kind === "auction" ? "auction-cars" : "Showroom-Inventory"}`;
  const page = plain(html);
  if (kind === "auction" && (!sale || !page.includes(`Auction ${sale.auction_number} Auction Cars`))) throw Error("mccormick_catalog_sale_mismatch");
  if (kind === "showroom" && !page.includes("Showroom Inventory")) throw Error("mccormick_showroom_catalog_missing");
  const rows: McCormickInventoryRow[] = [], ids = new Set<string>();
  for (const row of html.matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)) {
    const links = [...row[1].matchAll(/href=["']([^"']+)["']/gi)].flatMap(m => {
      try { const target = mccormickTarget(new URL(m[1].replace(/&amp;/g, "&"), base).href);
        return target && Boolean(target.showroom) === (kind === "showroom") && !target.archive ? [target] : [];
      } catch { return []; }
    });
    if (!links.length) continue;
    if (new Set(links.map(t => t.id)).size !== 1) throw Error("mccormick_catalog_row_identity_conflict");
    const target = links[0], cells = [...row[1].matchAll(/<TD\b[^>]*>([\s\S]*?)<\/TD>/gi)].map(m => plain(m[1]));
    const yearCell = cells[kind === "auction" ? 2 : 1], make = cells[kind === "auction" ? 3 : 2], model = cells[kind === "auction" ? 4 : 3];
    if (cells.length !== 6 || !cells[0] || !make || !model || ids.has(target.id)) throw Error("mccormick_catalog_row_invalid_or_duplicate");
    ids.add(target.id);
    const year = /^\d{4}$/.test(yearCell) && Number(yearCell) >= 1885 && Number(yearCell) <= 2100 ? Number(yearCell) : null;
    let amount: number | null = null;
    if (kind === "showroom") {
      if (!/^(?:Available|SOLD)$/i.test(cells[5])) throw Error("mccormick_showroom_status_unknown");
      const m = cells[4].match(/^\$\s*(\d[\d,]*(?:\.\d{2})?)$/);
      if (m) amount = Number(m[1].replace(/,/g, ""));
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw Error("mccormick_showroom_amount_invalid");
    }
    rows.push({ native_id: target.id, source_url: target.url, inventory_kind: kind, sale_key: sale?.sale_key ?? null,
      lot_number: cells[0], year, make, model, title: `${yearCell} ${make} ${model}`,
      source_status: kind === "auction" ? "scheduled" : cells[5].toLowerCase() === "sold" ? "sold" : "available",
      asking_amount: amount, currency: null, run_on: null });
    if (rows.length > 1200) throw Error("mccormick_catalog_bound_exceeded");
  }
  if (!rows.length) throw Error("mccormick_catalog_empty_or_unrecognized");
  return rows;
}
