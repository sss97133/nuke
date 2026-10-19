/**
 * What a Facebook Marketplace listing's own retained text says, read line by line. Pure: no fetch, no inference.
 *
 * A card's content_text is the immutable packet testimony (fb_sweep_jobs.metadata.batch). Every fact here is a quote of
 * one displayed line, so it can be replayed from that packet; a line that is not shown leaves its fact absent, never
 * guessed. The title is the seller's own words in Facebook's vehicle form ("1976 Chevrolet corvette Coupe 2D"): the form
 * appends body style, doors, cab and bed, which are read off before the shared identity parser sees the title.
 */
import { parseVehicleTitle } from "../ingest/vehicleTitle.ts";

export const FACTS_METHOD = "fb-listing-facts-v1";

export interface TitleIdentity {
  year: number | null; make: string | null; model: string | null;
  body_style?: string; doors?: number; bed?: string;
}

const BODY = /\s+(Coupe|Sedan|Hatchback|Convertible|Wagon|SUV|Pickup|Minivan|Van|Truck)\s+(\d)D\b/i;
const BED = /\s+(Long|Short|Standard|Extra Long) Bed\b/i;
const BED_LENGTH = /\s+\d+(\.\d+)?\s*ft\b/i;

export function titleIdentity(title: string | null | undefined): TitleIdentity {
  let text = String(title ?? "").replace(/\ufeff/g, "").trim();
  const out: Omit<TitleIdentity, "year" | "make" | "model"> = {};
  const body = text.match(BODY);
  if (body) {
    out.body_style = body[1][0].toUpperCase() + body[1].slice(1).toLowerCase();
    out.doors = Number(body[2]);
    text = text.slice(0, body.index) + text.slice(body.index! + body[0].length);
  }
  const bed = text.match(BED);
  if (bed) { out.bed = bed[1].toLowerCase(); text = text.slice(0, bed.index) + text.slice(bed.index! + bed[0].length); }
  text = text.replace(BED_LENGTH, "").trim();
  const parsed = parseVehicleTitle(text);
  return { year: parsed.year, make: parsed.make, model: parsed.model, ...out };
}

interface DisplayedText { displayed_text?: string; listed_label?: string | null; rendered_images?: { url?: string; alt?: string }[] }

export function readContentText(contentText: string | null | undefined): DisplayedText {
  if (!contentText) return {};
  try {
    const v = JSON.parse(contentText);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return { displayed_text: contentText }; }
}

function lines(text: string | undefined): string[] {
  return String(text ?? "").split("\n").map((l) => l.replace(/\ufeff/g, "").trim());
}

/** The lines between a heading and the next heading the page draws (or a blank-line run). */
function block(all: string[], heading: RegExp, end: RegExp, max = 24): string[] {
  const at = all.findIndex((l) => heading.test(l));
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of all.slice(at + 1, at + 1 + max)) { if (end.test(l)) break; if (l) out.push(l); }
  return out;
}

const VEHICLE_END = /^(seller['’]?s description|description|seller information|seller details|location|today['’]?s picks)$/i;
const SELLER_END = /^(ad|today['’]?s picks|send seller a message|message|send|related listings|more from this seller)$/i;

export interface VehicleFacts {
  mileage?: number; transmission?: string; fuel_type?: string; exterior_color?: string; interior_color?: string;
  owners?: { count: number; at_least: boolean }; title_status?: string; paid_off?: boolean; condition?: string;
  damage_statement?: string; lines: string[];
}

/** Facebook's "About this vehicle" block, shown on the listing page only (search cards have none). */
export function vehicleFacts(displayedText: string | undefined): VehicleFacts {
  const about = block(lines(displayedText), /^about this vehicle$/i, VEHICLE_END);
  const f: VehicleFacts = { lines: about };
  for (const l of about) {
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^Driven ([\d,]+) (miles|kilometers|km)$/i))) {
      const n = Number(m[1].replaceAll(",", ""));
      if (Number.isFinite(n)) f.mileage = /^k/i.test(m[2]) ? Math.round(n * 0.621371) : n;
    } else if ((m = l.match(/^(Automatic|Manual) transmission$/i))) f.transmission = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    else if ((m = l.match(/^Fuel type: (.+)$/i))) f.fuel_type = m[1].trim();
    else if ((m = l.match(/^Exterior color:\s*([^·]*?)\s*(?:·\s*Interior color:\s*(.*))?$/i))) {
      if (m[1]) f.exterior_color = m[1];
      if (m[2]?.trim()) f.interior_color = m[2].trim();
    } else if ((m = l.match(/^Interior color:\s*(.+)$/i))) f.interior_color = m[1].trim();
    else if ((m = l.match(/^(\d+)(\+)? owners?$/i))) f.owners = { count: Number(m[1]), at_least: !!m[2] };
    else if ((m = l.match(/^(Clean|Salvage|Rebuilt|Lien|Missing|No|Bonded|Parts only) title$/i))) f.title_status = m[1].toLowerCase();
    else if (/^This vehicle is paid off$/i.test(l)) f.paid_off = true;
    else if ((m = l.match(/^(Excellent|Very good|Good|Fair|Poor) condition$/i))) f.condition = m[1].toLowerCase();
    else if (/damage|problems/i.test(l)) f.damage_statement = l;
  }
  return f;
}

export interface SellerFacts { rating_count?: number; badges: string[]; joined_year?: number }

/** The seller block's displayed counts and badges. The name is read by the runner; it is not a key. */
export function sellerFacts(displayedText: string | undefined): SellerFacts {
  const seller = block(lines(displayedText), /^seller (information|details)$/i, SELLER_END, 8);
  const f: SellerFacts = { badges: [] };
  for (const l of seller) {
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^\((\d+)\)$/))) f.rating_count = Number(m[1]);
    else if ((m = l.match(/^Joined Facebook in (\d{4})$/i))) f.joined_year = Number(m[1]);
    else if (/ on Marketplace$/i.test(l)) f.badges.push(l);
  }
  return f;
}

/** "Listed 3 days ago in X": whole days since posting, a lower bound. Unknown phrasing stays null. */
export function listedDaysAgo(label: string | null | undefined): number | null {
  const m = String(label ?? "").match(/^Listed (?:(a|an|\d+)\s+(minute|hour|day|week|month)s?|(over a) (week|month)) ago\b/i);
  if (!m) return null;
  const n = m[1] ? (/^an?$/i.test(m[1]) ? 1 : Number(m[1])) : 1;
  const unit = (m[2] ?? m[4]).toLowerCase();
  return unit === "minute" || unit === "hour" ? 0 : unit === "day" ? n : unit === "week" ? n * 7 : n * 30;
}

/**
 * The listing's own gallery from a rendered listing page's images. The page also draws "Today's picks" (other people's
 * listings, center-cropped square tiles: stp=c…), avatars (under 400 px) and ads (t45.1600-4 creatives). Measured on
 * 127 retained listing pages, 2026-10-19: median 29 images captured, 10 kept, none left empty.
 */
export function galleryPhotos(urls: string[] | null | undefined, sizes: unknown): string[] {
  const dims = Array.isArray(sizes) ? sizes : [];
  return (urls ?? []).filter((url, i) => {
    const w = Array.isArray(dims[i]) ? Number(dims[i][0]) : NaN;
    if (/[?&]stp=c\d/.test(url)) return false;
    if (/\/t45\.1600-4\//.test(url)) return false;
    return !(Number.isFinite(w) && w < 400);
  });
}

export interface ListingFacts {
  method: string;
  title: TitleIdentity;
  vehicle?: VehicleFacts;
  seller?: SellerFacts;
  listed_label?: string;
  listed_days_ago?: number;
  photos_kept?: number;
  photos_seen?: number;
}

export interface FilledFields {
  parsed_year?: number | null; parsed_make?: string | null; parsed_model?: string | null; mileage?: number;
  transmission?: string; fuel_type?: string; exterior_color?: string; interior_color?: string;
  image_url?: string | null; all_images?: string[] | null;
}

/** The input with every absent field the packet's own text states filled in, and the facts it was read from. */
export function withListingFacts<T extends Record<string, any>>(body: T): T & FilledFields & { listing_facts: ListingFacts } {
  const ctx = readContentText(body.content_text);
  const title = titleIdentity(body.title);
  const facts: ListingFacts = { method: FACTS_METHOD, title };
  const out: Record<string, any> = { ...body };
  const fill = (key: string, value: unknown) => { if (out[key] == null && value != null) out[key] = value; };

  fill("parsed_year", title.year);
  fill("parsed_make", title.make);
  fill("parsed_model", title.model);

  const v = vehicleFacts(ctx.displayed_text);
  if (v.lines.length) {
    facts.vehicle = v;
    fill("mileage", v.mileage);
    fill("transmission", v.transmission);
    fill("fuel_type", v.fuel_type);
    fill("exterior_color", v.exterior_color);
    fill("interior_color", v.interior_color);
  }
  const s = sellerFacts(ctx.displayed_text);
  if (s.rating_count != null || s.joined_year != null || s.badges.length) facts.seller = s;

  if (ctx.listed_label) {
    facts.listed_label = ctx.listed_label;
    const days = listedDaysAgo(ctx.listed_label);
    if (days != null) facts.listed_days_ago = days;
  }

  if (body.agent_context?.session_type === "browser_listing_page" && Array.isArray(body.all_images)) {
    const kept = galleryPhotos(body.all_images, body.agent_context?.image_sizes);
    facts.photos_seen = body.all_images.length;
    facts.photos_kept = kept.length;
    out.all_images = kept.length ? kept : null;
    out.image_url = kept[0] ?? null;
  } else if (out.image_url == null) {
    const card = ctx.rendered_images?.find((i) => typeof i?.url === "string" && /fbcdn\.net/.test(i.url))?.url;
    if (card) { out.image_url = card; fill("all_images", [card]); }
  }
  out.listing_facts = facts;
  return out as T & FilledFields & { listing_facts: ListingFacts };
}
