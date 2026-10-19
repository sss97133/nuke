/**
 * The listings a Barn Finds post links to.
 *
 * A post is an editorial feature of a car listed elsewhere: Barn Finds chose the car, wrote it up and links to the seller's
 * listing. That link is the join from the post to the listing's own record (one vehicle, many citations), so it is read
 * from the article and reduced to the key the listing's platform is held under (vehicle_events.source_platform +
 * source_listing_id / source_url).
 *
 * Roles: 'subject' is the link the article gives for this car ("available on eBay", "listed here on Facebook
 * Marketplace"); 'reference' is any other listing link in the article (comparables, earlier sales); 'reader' is a link a
 * commenter posted. Only a subject is ever bound to a vehicle.
 *
 * Once a listing ends, Barn Finds rewrites the article's link to its own /old/?car=<slug> page (anchor class "old"),
 * whose slug is reused across posts. Such a subject is kept with link_state 'replaced_by_barnfinds' and no key: the
 * listing it pointed at is not recoverable from the page.
 */

import { decodeEntities, stripTags } from "./parseArticle.ts";

export type ListingPlatform = "ebay_motors" | "craigslist" | "facebook_marketplace" | "bat" | "cars_and_bids" | "hemmings" | "classiccars-com";

export interface ListingLink {
  platform: ListingPlatform;
  /** The platform's listing key as held in vehicle_events.source_listing_id, when the URL carries one. */
  listing_key: string | null;
  /** The URL with tracking and affiliate parameters removed. */
  url: string;
}

export interface CitedListing extends Partial<ListingLink> {
  role: "subject" | "reference" | "reader";
  link_state: "live" | "replaced_by_barnfinds";
  /** The platform the article names in the anchor or its sentence when the link itself is gone (e.g. "eBay"). */
  named_platform: string | null;
  anchor_text: string;
  raw_url: string;
}

const NAMED: [RegExp, ListingPlatform][] = [
  [/\bebay\b/i, "ebay_motors"],
  [/\bcraigslist\b/i, "craigslist"],
  [/\bfacebook\b|\bmarketplace\b/i, "facebook_marketplace"],
  [/\bbring a trailer\b|\bBaT\b/, "bat"],
  [/\bcars ?(?:&|and) ?bids\b/i, "cars_and_bids"],
  [/\bhemmings\b/i, "hemmings"],
  [/\bclassic ?cars(?:\.com)?\b/i, "classiccars-com"],
];

function platformNamed(text: string): ListingPlatform | null {
  for (const [re, p] of NAMED) if (re.test(text)) return p;
  return null;
}

/** An eBay item id from a direct item link or a rover/affiliate redirect (item=, mpre=<encoded item URL>). */
function ebayItemId(u: URL): string | null {
  const direct = u.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})(?:$|[/?])/)?.[1] ?? u.pathname.match(/\/itm\/(\d{9,15})/)?.[1];
  if (direct) return direct;
  for (const k of ["item", "itemid", "ItemId"]) {
    const v = u.searchParams.get(k);
    if (v && /^\d{9,15}$/.test(v)) return v;
  }
  const mpre = u.searchParams.get("mpre") ?? u.searchParams.get("loc");
  if (mpre) {
    try { return ebayItemId(new URL(mpre)); } catch { /* not a URL */ }
  }
  return null;
}

/** The listing a URL points at, keyed the way that platform's records hold it; null for anything that is not a listing. */
export function canonicalListingLink(raw: string): ListingLink | null {
  let u: URL;
  try { u = new URL(decodeEntities(raw.trim())); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const path = u.pathname.replace(/\/+$/, "");

  if (/(^|\.)ebay\.[a-z.]+$/.test(host)) {
    const id = ebayItemId(u);
    return id ? { platform: "ebay_motors", listing_key: id, url: `https://www.ebay.com/itm/${id}` } : null;
  }
  if (/(^|\.)craigslist\.org$/.test(host) && !host.startsWith("images.")) {
    const id = path.match(/\/(\d{9,12})\.html$/)?.[1] ?? null;
    if (id) return { platform: "craigslist", listing_key: id, url: `https://${host}${path}` };
    if (/^\/view\/d\/[^/]+\/[A-Za-z0-9]+$/.test(path)) return { platform: "craigslist", listing_key: null, url: `https://www.craigslist.org${path}` };
    return null;
  }
  if (host === "facebook.com" || host === "m.facebook.com" || host === "web.facebook.com") {
    const id = path.match(/^\/marketplace\/item\/(\d{6,20})$/)?.[1];
    return id ? { platform: "facebook_marketplace", listing_key: id, url: `https://www.facebook.com/marketplace/item/${id}/` } : null;
  }
  if (host === "bringatrailer.com") {
    const slug = path.match(/^\/listing\/([a-z0-9-]+)$/i)?.[1]?.toLowerCase();
    return slug ? { platform: "bat", listing_key: slug, url: `https://bringatrailer.com/listing/${slug}/` } : null;
  }
  if (host === "carsandbids.com") {
    const m = path.match(/^\/auctions\/([A-Za-z0-9]{6,12})(?:\/([a-z0-9-]+))?$/i);
    return m ? { platform: "cars_and_bids", listing_key: m[1], url: `https://carsandbids.com/auctions/${m[1]}${m[2] ? `/${m[2].toLowerCase()}` : ""}` } : null;
  }
  if (host === "hemmings.com") {
    const id = path.match(/^\/classifieds\/.*?[/-](\d{6,9})(?:\.html)?$/)?.[1];
    return id ? { platform: "hemmings", listing_key: id, url: `https://hemmings.com${path}` } : null;
  }
  if (host === "classiccars.com") {
    const id = path.match(/^\/listings\/view\/(\d{5,9})(?:\/|$)/)?.[1];
    return id ? { platform: "classiccars-com", listing_key: id, url: `https://classiccars.com${path}` } : null;
  }
  return null;
}

const text = (html: string) => decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();

/** The anchor or the words just before it say "this car is listed here". */
const SUBJECT_ANCHOR = /\bhere\b|\b(?:on|at|via)\s+(?:ebay|craigslist|facebook|marketplace|hemmings|bring a trailer|bat|cars ?(?:&|and) ?bids|classic ?cars)\b|^(?:ebay|craigslist|facebook(?: marketplace)?|hemmings|bring a trailer|cars ?(?:&|and) ?bids)$/i;
const SUBJECT_LEAD = /\b(?:listed|available|offered|advertised|posted|spotted|found|for sale|listing it|find it|has it listed|is up for auction|up for grabs|selling it)\s*(?:it\s*)?(?:here\s*)?(?:on\s*)?(?:the\s*)?$/i;
/** Words that make a link a comparable or an earlier sale, not this car. */
const NOT_SUBJECT = /\b(?:sold|sells|went for|comparable|similar|one like|recent auction|previous(?:ly)?|last (?:ebay )?auction|earlier|here is one|here's one|this one sold|(?:is|here's|and) another|another (?:one|example)|other examples?)\b/i;

function anchors(html: string): { href: string; inner: string; tag: string; index: number }[] {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    tag: m[1], inner: m[2], index: m.index ?? 0,
    href: decodeEntities(m[1].match(/\bhref=["']([^"']+)["']/i)?.[1] ?? ""),
  }));
}

/**
 * Every listing link in the article and the comments. `article` is the post body (entry-content), `commentsHtml` the
 * comment thread. The first article link that the anchor or its lead-in names as this car's listing is the subject.
 */
export function citedListings(article: string, commentsHtml: string): CitedListing[] {
  const out: CitedListing[] = [];
  let subjectTaken = false;
  for (const a of anchors(article)) {
    const anchor = text(a.inner);
    const before = text(article.slice(Math.max(0, a.index - 400), a.index)).slice(-120);
    const after = text(article.slice(a.index, a.index + a.inner.length + 400).replace(/^<a\b[^>]*>[\s\S]*?<\/a>/i, "")).slice(0, 60);
    const replaced = /^\/old\/\?car=|^https?:\/\/(?:www\.)?barnfinds\.com\/old\/\?car=/i.test(a.href);
    const link = replaced ? null : canonicalListingLink(a.href);
    if (!link && !replaced) continue;
    // The words of the anchor's own sentence: before it (back to the last sentence end) and after it (to the next one).
    const lead = /[.!?]["'”’)]?$/.test(before) ? "" : (before.split(/(?<=[.!?])\s+/).pop() ?? "");
    const tail = after.split(/(?<=[.!?])\s+/)[0] ?? "";
    const sentence = `${lead} ${anchor}`;
    const looksSubject = (SUBJECT_ANCHOR.test(anchor) || SUBJECT_LEAD.test(lead)) && !NOT_SUBJECT.test(`${sentence} ${tail}`);
    const role = !subjectTaken && looksSubject ? "subject" : "reference";
    if (role === "subject") subjectTaken = true;
    out.push({
      ...(link ?? {}),
      role,
      link_state: replaced ? "replaced_by_barnfinds" : "live",
      named_platform: platformNamed(anchor) ?? platformNamed(sentence) ?? null,
      anchor_text: anchor.slice(0, 120),
      raw_url: a.href.slice(0, 500),
    });
  }
  for (const a of anchors(commentsHtml)) {
    const link = canonicalListingLink(a.href);
    if (!link) continue;
    out.push({ ...link, role: "reader", link_state: "live", named_platform: null, anchor_text: text(a.inner).slice(0, 120), raw_url: a.href.slice(0, 500) });
  }
  return out;
}

/** The subject that can be joined to a listing record: a live link with a platform. */
export function bindableSubject(cites: CitedListing[]): (CitedListing & ListingLink) | null {
  const s = cites.find((c) => c.role === "subject" && c.link_state === "live" && c.platform && c.url);
  return s ? (s as CitedListing & ListingLink) : null;
}
