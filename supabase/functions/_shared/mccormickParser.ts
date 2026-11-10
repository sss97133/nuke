import { htmlToText } from "./htmlToText.ts";

export const MCCORMICK_PARSER = "mccormick_html_v1";
export const MCCORMICK_CATALOG_PARSER = "mccormick_catalog_v1";
const origin = "https://www.classic-carauction.com";
const text = (s: string) => htmlToText(s).replace(/[ \t]+/g, " ").trim();
const known = (s?: string) => s && !/^(?:TBA|TMU|N\/?A|unknown|none|-+)$/i.test(s.trim()) ? s.trim() : null;
function visible(html: string): string {
  let old: string;
  do { old = html; html = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ""); } while (old !== html);
  return html;
}
/** auctionid identifies an appearance; auctionnbr identifies its room, never its vehicle. */
export function mccormickTarget(raw: string): { id: string; auction: string | null; url: string; archive: boolean; showroom?: boolean } | null {
  try {
    const u = new URL(raw), ids = u.searchParams.getAll("auctionid"), auctions = u.searchParams.getAll("auctionnbr");
    if (/^https?:$/.test(u.protocol) && /^(www\.)?classic-carauction\.com$/i.test(u.hostname)
      && !u.username && !u.password && !u.port && /^\/Showroom-Inventory\/?$/i.test(u.pathname)
      && u.searchParams.getAll("id").length === 1 && /^[1-9]\d{0,9}$/.test(u.searchParams.get("id")!)
      && u.searchParams.getAll("sp").length === 1 && u.searchParams.get("sp") === "1"
      && [...u.searchParams.keys()].every(k => ["id", "sp"].includes(k))) {
      const id = u.searchParams.get("id")!;
      return { id: `showroom:${id}`, auction: null, archive: false, showroom: true,
        url: `${origin}/Showroom-Inventory?sp=1&id=${id}` };
    }
    if (!/^https?:$/.test(u.protocol) || !/^(www\.)?classic-carauction\.com$/i.test(u.hostname)
      || u.username || u.password || u.port || !/^\/(auction-cars|featured-cars|auction-results)\/?$/i.test(u.pathname)
      || ids.length !== 1 || !/^[1-9]\d{0,9}$/.test(ids[0]) || auctions.length > 1
      || (auctions.length && !/^[1-9]\d{0,3}$/.test(auctions[0]))) return null;
    const archive = /^\/auction-results/i.test(u.pathname);
    if (archive && auctions.length !== 1) return null;
    const auction = archive ? auctions[0] : null;
    return { id: ids[0], auction, archive, url: archive
      ? `${origin}/auction-results?auctionnbr=${auction}&auctionid=${ids[0]}`
      : `${origin}/auction-cars?auctionid=${ids[0]}` };
  } catch { return null; }
}

export interface McCormickLot {
  source_id: string; source_url: string; auction_number: string | null; auction_dates_text: string | null;
  title: string; lot_number: string; year: number | null; make: string | null; model: string | null;
  vin: string | null; description: string; raw_fields: Record<string, string>; condition_ratings: Record<string, string>;
  image_urls: string[]; presentation: "archive" | "unknown" | "showroom";
  asking_claim?: { amount: number; currency: null; literal: string } | null;
  result_claim: { status: "sold" | "no_sale"; amount: number; currency_symbol: "$"; currency: null; fee_basis: "unknown"; literal: string } | null;
  evidence_scope?: "detail_unavailable" | "catalog_row" | "featured_card";
  description_is_excerpt?: boolean;
}

function emptyLot(id: string, source_url: string): McCormickLot {
  return { source_id: id, source_url, auction_number: null, auction_dates_text: null,
    title: "", lot_number: "", year: null, make: null, model: null, vin: null, description: "",
    raw_fields: {}, condition_ratings: {}, image_urls: [], presentation: "unknown", result_claim: null };
}
function ownImages(section: string): string[] {
  const urls = new Set<string>();
  for (const tag of section.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(tag[1].replace(/&amp;/g, "&"), origin);
      if (u.origin === origin && !u.username && !u.password && /^\/upload\/(?:Auction\/)?[^?#]+\.(?:jpe?g|png|gif|webp)$/i.test(u.pathname)) urls.add(u.href);
    } catch { /* Invalid photo locators are not evidence. */ }
  }
  return [...urls];
}

/** Current catalog's explicit cells, not a URL slug or a guessed vehicle ID. */
export function parseMcCormickCatalogLot(html: string, source_url: string, id: string): McCormickLot {
  if (source_url !== `${origin}/auction-cars`) throw new Error("mccormick_catalog_route_unsupported");
  const matches = [...visible(html).matchAll(/<TR\b[^>]*>([\s\S]*?)<\/TR>/gi)].filter(row =>
    [...row[1].matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].some(a => {
      try { return mccormickTarget(new URL(a[1].replace(/&amp;/g, "&"), source_url).href)?.id === id; } catch { return false; }
    }));
  if (matches.length !== 1) throw new Error("mccormick_catalog_identity_missing_or_ambiguous");
  const linkedIds = new Set([...matches[0][1].matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)].map(a => {
    try { return mccormickTarget(new URL(a[1].replace(/&amp;/g, "&"), source_url).href)?.id; } catch { return undefined; }
  }).filter(Boolean));
  if (linkedIds.size !== 1) throw new Error("mccormick_catalog_row_identity_conflict");
  const cells = [...matches[0][1].matchAll(/<TD\b[^>]*>([\s\S]*?)<\/TD>/gi)].map(c => text(c[1]));
  if (cells.length !== 6 || !/^\d{4}$/.test(cells[2]) || !known(cells[3]) || !known(cells[4]) || !cells[0]) throw new Error("mccormick_catalog_cells_invalid");
  return { ...emptyLot(id, source_url), evidence_scope: "catalog_row", lot_number: cells[0],
    title: `${cells[2]} ${cells[3]} ${cells[4]}`, year: Number(cells[2]), make: cells[3], model: cells[4],
    raw_fields: { "Model Year": cells[2], Make: cells[3], "Body Style": cells[5] }, image_urls: ownImages(matches[0][1]) };
}

/** A featured card can retain its excerpt/gallery even when its detail route is unavailable. */
export function parseMcCormickFeaturedLot(html: string, source_url: string, identity: McCormickLot): McCormickLot | null {
  if (source_url !== `${origin}/featured-cars`) throw new Error("mccormick_featured_route_unsupported");
  const body = visible(html);
  const headings = [...body.matchAll(/<div\b[^>]*class=["']bcopy12["'][^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*<b>([^<>]+)<\/b>\s*<\/a>/gi)];
  if (!headings.length) throw new Error("mccormick_featured_catalog_format_unknown");
  const matches = headings.filter(h => {
    try { return mccormickTarget(new URL(h[1].replace(/&amp;/g, "&"), source_url).href)?.id === identity.source_id; } catch { return false; }
  });
  if (!matches.length) return null; // Only absence within this successfully captured catalog.
  if (matches.length !== 1) throw new Error("mccormick_featured_identity_ambiguous");
  const heading = matches[0], next = headings[headings.indexOf(heading) + 1];
  const section = body.slice(heading.index!, next?.index);
  const lot = text(section.match(/Lot Number\s+([^<]+)/i)?.[1] ?? "");
  const title = text(heading[2]);
  if (title !== identity.title || lot !== identity.lot_number) throw new Error("mccormick_featured_identity_disagreement");
  const description = section.match(/<div\b[^>]*class=["']bcopy10["'][^>]*>([\s\S]*?)<br\s*\/?>/i)?.[1];
  return { ...emptyLot(identity.source_id, source_url), evidence_scope: "featured_card", title, lot_number: lot,
    year: identity.year, make: identity.make, model: identity.model,
    description: description ? text(description) : "", description_is_excerpt: true,
    image_urls: ownImages([...section.matchAll(/<a\b[^>]*\brel=["']example_group["'][^>]*>/gi)].map(a => a[0]).join("")) };
}

/** Native labeled claims, keeping specifications and component ratings in separate sections. */
export function parseMcCormickLot(html: string, url: string): McCormickLot {
  const target = mccormickTarget(url);
  if (!target) throw new Error("invalid_mccormick_listing_url");
  if (target.showroom) return parseMcCormickShowroomLot(html, target.url);
  const body = visible(html);
  const heading = body.match(/<div\b[^>]*class=["']bcopy12["'][^>]*>\s*<b>([^<>]+)<\/b>\s*<br\s*\/?>\s*Lot Nbr\.\s*([^<]+)/i);
  if (!heading && text(body).includes("Sorry, but details about this car are not available.")) {
    return { ...emptyLot(target.id, target.url), evidence_scope: "detail_unavailable",
      description: "Sorry, but details about this car are not available." };
  }
  if (!heading) throw new Error("mccormick_lot_heading_missing");
  const start = heading.index!;
  const end = body.indexOf("<!end car details>", start);
  // Old source templates concatenate HTML documents and reuse table IDs; scope to the actual detail block.
  const detail = body.slice(start, end < 0 ? undefined : end);
  const infoStart = detail.indexOf("Vehicle Info:"), ratingsStart = detail.indexOf("Component Ratings:");
  if (infoStart < 0 || ratingsStart < infoStart) throw new Error("mccormick_attribute_sections_missing");
  const fields = (section: string) => {
    const out: Record<string, string> = {};
    for (const row of section.matchAll(/<TD\b[^>]*>\s*<div\b[^>]*>([^<>]+:)\s*<\/TD>\s*<TD\b[^>]*>\s*<div\b[^>]*>([\s\S]*?)<\/TD>/gi)) {
      const k = text(row[1]).replace(/:$/, "");
      if (!k || /^(Vehicle Info|Component Ratings)$/.test(k)) continue;
      const value = text(row[2]);
      if (k in out && out[k] !== value) throw new Error("mccormick_conflicting_field");
      out[k] = value;
    }
    return out;
  };
  const raw = fields(detail.slice(infoStart, ratingsStart));
  const ratings = fields(detail.slice(ratingsStart));
  // First section row starts before the marker. Read each remaining simple row independently.
  const title = text(heading[1]), lot = text(heading[2]);
  const year = /^\d{4}$/.test(raw["Model Year"] ?? "") ? Number(raw["Model Year"]) : null;
  const make = known(raw.Make);
  if (year && make && !title.toUpperCase().startsWith(`${year} ${make.toUpperCase()} `)) throw new Error("mccormick_identity_claim_mismatch");
  const model = year && make ? known(title.slice(`${year} ${make}`.length)) : null;
  const owner = detail.match(/Owner Comments:\s*<\/TD>\s*<TD\b[^>]*>([\s\S]*?)<\/TD>/i);
  const images = new Set<string>();
  // Only the detail's own photo/slideshow tags, never navigation, sponsors or another lot.
  const photoStart = body.lastIndexOf('<IMG ID="Picture1"', start);
  const photoSection = body.slice(photoStart >= 0 ? photoStart : start, start) + detail.slice(0, detail.indexOf("Owner Comments:"));
  for (const tag of photoSection.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(tag[1].replace(/&amp;/g, "&"), origin);
      if (u.origin !== origin || u.username || u.password || !/^\/upload\/(?:Auction\/)?[^?#]+\.(?:jpe?g|png|gif|webp)$/i.test(u.pathname)) continue;
      // Older archives have one uploaded thumbnail, current pages expose full slides.
      images.add(u.href);
    } catch { /* A malformed image URL is not evidence. */ }
  }
  const auction = text(body.slice(0, start)).match(/Auction\s+(\d+)\s*(?:Results)?(?:\s*\(([^)]+)\))?(?:\s|$)/g)?.at(-1);
  const number = auction?.match(/Auction\s+(\d+)/)?.[1] ?? null;
  if (target.archive && number !== target.auction) throw new Error("mccormick_auction_mismatch");
  const resultText = text(detail.slice(0, infoStart));
  const sold = resultText.match(/Sold for:\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  const high = resultText.match(/(?:High Bid|No Sale)\s*:?\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  const match = sold ?? high;
  const vin = known(raw["Vin No."]);
  return { source_id: target.id, source_url: target.url, auction_number: target.auction,
    auction_dates_text: target.archive ? auction?.match(/\(([^)]+)\)/)?.[1] ?? null : null,
    title, lot_number: lot, year, make, model, vin: vin && /^[A-HJ-NPR-Z0-9]{5,17}$/i.test(vin) ? vin.toUpperCase() : null,
    description: owner ? text(owner[1]) : "", raw_fields: raw, condition_ratings: ratings,
    image_urls: [...images], presentation: target.archive ? "archive" : "unknown",
    result_claim: match ? { status: sold ? "sold" : "no_sale", amount: Number(match[1].replace(/,/g, "")),
      currency_symbol: "$", currency: null, fee_basis: "unknown", literal: match[0] } : null };
}

/** A showroom id and its stock number are different keys; neither is an auction id. */
export function parseMcCormickShowroomLot(html: string, url: string): McCormickLot {
  const target = mccormickTarget(url);
  if (!target?.showroom) throw Error("invalid_mccormick_showroom_url");
  const body = visible(html);
  const heading = body.match(/<div\b[^>]*class=["']bcopy12["'][^>]*>\s*<b>([^<>]+)<\/b>\s*<br\s*\/?>\s*Stock No\.\s*([^<\r\n]+)/i);
  if (!heading) throw Error("mccormick_showroom_heading_missing");
  const detail = body.slice(heading.index!);
  const ratingStart = detail.search(/<B>Component<\/B>/i);
  const specifications = ratingStart >= 0 ? detail.slice(0, ratingStart) : detail;
  const raw: Record<string, string> = {};
  for (const row of specifications.matchAll(/<TD\b[^>]*>\s*<div\b[^>]*>([^<>]+:)\s*<\/TD>\s*<TD\b[^>]*>\s*<div\b[^>]*>([\s\S]*?)<\/TD>/gi)) {
    const key = text(row[1]).replace(/:$/, "");
    if (key === "Owner Comments") continue;
    const value = text(row[2]);
    if (key in raw && raw[key] !== value) throw Error("mccormick_conflicting_field");
    raw[key] = value;
  }
  const title = text(heading[1]), year = /^\d{4}$/.test(raw["Model Year"] ?? "") ? Number(raw["Model Year"]) : null;
  const make = known(raw.Make);
  if (!make || !year || !title.toUpperCase().startsWith(`${year} ${make.toUpperCase()} `)) throw Error("mccormick_showroom_identity_incomplete");
  const ownerStart = detail.indexOf("Owner Comments:");
  const beforeOwner = detail.slice(0, ownerStart >= 0 ? ownerStart : detail.length);
  const info = text(beforeOwner);
  const offered = info.match(/Offered at:\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  const sold = info.match(/Sold for:\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  const owner = detail.match(/Owner Comments:\s*<\/TD>\s*<TD\b[^>]*>([\s\S]*?)<\/TD>/i);
  const photoStart = body.lastIndexOf('<IMG ID="Picture1"', heading.index!);
  const own = body.slice(photoStart >= 0 ? photoStart : heading.index!, heading.index!) + beforeOwner;
  const images = [...own.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)=["']([^"']+)["']/gi)].flatMap(tag => {
    try { const u = new URL(tag[1].replace(/&amp;/g, "&"), origin);
      return u.origin === origin && /^\/upload\/showroom\/[^?#]+\.(?:jpe?g|png|gif|webp)$/i.test(u.pathname) ? [u.href] : [];
    } catch { return []; }
  });
  const vin = known(raw["Vin No."]);
  return { ...emptyLot(target.id, target.url), title, year, make, model: known(title.slice(`${year} ${make}`.length)),
    lot_number: text(heading[2]), raw_fields: raw, presentation: "showroom", description: owner ? text(owner[1]) : "",
    vin: vin && /^[A-HJ-NPR-Z0-9]{5,17}$/i.test(vin) ? vin.toUpperCase() : null, image_urls: [...new Set(images)],
    asking_claim: offered ? { amount: Number(offered[1].replace(/,/g, "")), currency: null, literal: offered[0] } : null,
    result_claim: sold ? { status: "sold", amount: Number(sold[1].replace(/,/g, "")), currency_symbol: "$", currency: null, fee_basis: "unknown", literal: sold[0] } : null };
}

/** Follow advertised lot and event links only; never guess numeric listing IDs. */
export function mccormickLinks(html: string, base: string): { lots: string[]; catalogs: string[] } {
  const lots = new Set<string>(), catalogs = new Set<string>();
  for (const m of visible(html).matchAll(/<a\b[^>]*\bhref=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"), base);
      if (u.origin !== origin || u.username || u.password) continue;
      const target = mccormickTarget(u.href);
      if (target) { lots.add(target.url); continue; }
      if (/^\/Auction-\d+$/i.test(u.pathname)) catalogs.add(origin + u.pathname);
      else if (/^\/(?:auction-cars|featured-cars)\/?$/i.test(u.pathname) && !u.search) catalogs.add(origin + u.pathname);
      else if (/^\/auction-results\/?$/i.test(u.pathname) && /^\d+$/.test(u.searchParams.get("auctionnbr") ?? "") && !u.searchParams.has("auctionid")) {
        catalogs.add(`${origin}/auction-results?auctionnbr=${u.searchParams.get("auctionnbr")}`);
      }
    } catch { /* Ignore navigation outside the advertised public catalogs. */ }
  }
  return { lots: [...lots], catalogs: [...catalogs] };
}
