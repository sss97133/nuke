/**
 * eBay Marketplace Account Deletion in the eBay doors. eBay tells us when a member deletes their account (ebay-account-deletion
 * records the notice in ebay_deletion_requests as the sha256 of the handle only); from then on nothing we hold may name them.
 *
 *   memberHandles(text)            the eBay member handles a stored page or getItem body names; the seller's are marked
 *   handleHash(handle)             sha256 hex of the lower-cased handle            (SQL: ebay_member_sha256)
 *   redactHandles(text, handles)   every token-bounded mention -> [deleted eBay user] (SQL: ebay_redact_handles)
 *   redactContact(text)            e-mail addresses and phone numbers -> [contact through Nuke] (SQL: text_redact_contact)
 *   tombstoneItem / tombstonePage  what the landers run before they store anything: a deleted member's handle goes first
 *   honourDeletions                action honour_deletions (cron ebay-deletion-honour): every place scanned by hash, every copy
 *                                  redacted (SQL places by redact_ebay_deleted_member, stored pages rewritten here), then
 *                                  finish_ebay_deletions stamps status and a counts-only receipt
 *   readStoredHandles              action member_handles: each stored page read once for the handles it names, so a later
 *                                  deletion request finds it by hash without reading it again
 * No handle is ever logged or returned: reports carry counts and hashes only.
 */
import { mustWrite } from "../_shared/writeResult.ts";

const NAME = "[A-Za-z0-9][A-Za-z0-9._*\\-]{1,63}";
/** Where an eBay page or getItem body names a member, and whether that member is the listing's seller. */
const SELLER_PATTERNS = [
  new RegExp(`"username"\\s*:\\s*"(${NAME})"`, "g"),            // the getItem seller object
  new RegExp(`ebay\\.com/usr/(${NAME})`, "gi"),                  // the store link in a description, the seller card
  new RegExp(`ebay\\.com/sch/(${NAME})/m\\.html`, "gi"),        // "seller's other items" (2020s pages)
];
const MEMBER_URL = new RegExp(`[?&;](?:amp;)?(?:userid|user_id|_ssn|ssn|sellerid|seller_id|uid)=(${NAME})`, "gi"); // feedback, other items (2000s pages)
const LABELLED = new RegExp(`(Seller info|Seller information|Seller|Member id|User ID|High bidder|Winning bidder|Bidder|Buyer)\\s*:?\\s*` +
  `(?:Member id\\s+)?(${NAME})\\s*\\(\\s*(?:Feedback Score Of\\s*)?\\d+`, "gi");   // "Seller: name ( 123 )", "High bidder: name ( 45 )"

const textOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ");

/** Every member handle the text names, lower-cased, true when it is named as the seller. */
export function memberHandles(text: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const add = (h: string, seller: boolean) => { const k = h.toLowerCase(); out.set(k, (out.get(k) ?? false) || seller); };
  if (!text) return out;
  for (const re of SELLER_PATTERNS) for (const m of text.matchAll(re)) add(m[1], true);
  for (const m of text.matchAll(MEMBER_URL)) add(m[1], false);
  for (const m of textOf(text).matchAll(LABELLED)) add(m[2], /^(seller|member id)/i.test(m[1]));
  return out;
}

export async function handleHash(handle: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(handle.trim().toLowerCase()));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const sha256Hex = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const REDACTED = "[deleted eBay user]";
const esc = (s: string) => s.replace(/[^A-Za-z0-9]/g, "\\$&");
/** Every token-bounded, case-insensitive mention of each handle -> [deleted eBay user] (a sentence's closing period is not part of a handle). */
export function redactHandles(text: string, handles: Iterable<string>): string {
  let v = text;
  for (const h of handles) {
    if (!h?.trim()) continue;
    v = v.replace(new RegExp(`(?<![A-Za-z0-9_*.\\-])${esc(h.trim())}(?![A-Za-z0-9_*\\-])(?!\\.[A-Za-z0-9_])`, "gi"), REDACTED);
  }
  return v;
}

/** text_redact_contact's two patterns: e-mail addresses, then phone numbers. */
export function redactContact(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "[contact through Nuke]")
    .replace(/(\(\d{3}\)|\b\d{3})[-. )]*\d{3}[-. ]*\d{4}(?![0-9])/g, "[contact through Nuke]");
}

/** On an archived item page the seller's description sits between ngvi_desc_div and eBay's next section (archivePage.ts
 *  descriptionHtml); only there are phone numbers the seller's (elsewhere a 10-digit run is an item number). */
const DESC_END = /Questions and answers|Seller assumes all responsibility|id="rtm_html_|Back to home page/;
export function redactDescriptionContact(html: string): string {
  const start = html.search(/<div[^>]+id="ngvi_desc_div"[^>]*>/i);
  if (start < 0) return html;
  const rest = html.slice(start);
  const end = rest.search(DESC_END);
  const len = end < 0 ? Math.min(rest.length, 60_000) : end;
  return html.slice(0, start) + redactContact(rest.slice(0, len)) + rest.slice(len);
}

/** sha256 of every handle a body names, and of those named as its seller: what a stored page's metadata carries. */
export async function handleHashes(text: string): Promise<{ member: string[]; seller: string[]; byHash: Map<string, string> }> {
  const found = memberHandles(text), byHash = new Map<string, string>(), seller: string[] = [];
  for (const [h, isSeller] of found) { const k = await handleHash(h); byHash.set(k, h); if (isSeller) seller.push(k); }
  return { member: [...byHash.keys()].sort(), seller: [...new Set(seller)].sort(), byHash };
}

export type Lookup = (hashes: string[]) => Promise<Set<string>>;
/** Which hashes belong to an eBay account deletion (rpc ebay_deleted_member_hashes). Throws on a failed read: a lander that cannot
 *  ask must not store the page. */
export function deletedLookup(supabase: any): Lookup {
  return async (hashes) => {
    if (!hashes.length) return new Set();
    const r = mustWrite("deleted-member lookup", await supabase.rpc("ebay_deleted_member_hashes", { p_hashes: hashes.slice(0, 1000) }));
    return new Set<string>((r.data ?? []) as string[]);
  };
}

/** A getItem body (or an archived page mapped to one) before landing: a deleted member's handle goes everywhere in it; when they
 *  are the seller, the seller object goes and the description's contact details with it. */
export async function tombstoneItem(lookup: Lookup, raw: any): Promise<{ raw: any; deleted: number }> {
  const { byHash } = await handleHashes(JSON.stringify(raw ?? {}));
  const sellerHash = raw?.seller?.username ? await handleHash(String(raw.seller.username)) : null;
  if (sellerHash) byHash.set(sellerHash, String(raw.seller.username).toLowerCase());
  if (!byHash.size) return { raw, deleted: 0 };
  const gone = await lookup([...byHash.keys()]);
  if (!gone.size) return { raw, deleted: 0 };
  const names = [...byHash].filter(([k]) => gone.has(k)).map(([, h]) => h);
  const out = { ...raw };
  if (sellerHash && gone.has(sellerHash)) {
    out.seller = {};
    for (const k of ["description", "shortDescription", "subtitle"]) if (typeof out[k] === "string") out[k] = redactContact(out[k]);
  }
  return { raw: JSON.parse(redactHandles(JSON.stringify(out), names)), deleted: names.length };
}

/** A stored page (archived HTML) before it is stored or parsed: the same, and the hashes of the handles left on it. */
export async function tombstonePage(lookup: Lookup, html: string): Promise<{ html: string; deleted: number; member: string[]; seller: string[] }> {
  const first = await handleHashes(html);
  const gone = first.byHash.size ? await lookup([...first.byHash.keys()]) : new Set<string>();
  if (!gone.size) return { html, deleted: 0, member: first.member, seller: first.seller };
  const names = [...first.byHash].filter(([k]) => gone.has(k)).map(([, h]) => h);
  const out = redactHandles(first.seller.some((k) => gone.has(k)) ? redactDescriptionContact(html) : html, names);
  const left = await handleHashes(out);
  return { html: out, deleted: names.length, member: left.member, seller: left.seller };
}

// ---- the worker ----------------------------------------------------------------------------------------------------------------

export const PLACES = ["vehicle_events", "vehicle_observations", "listing_page_snapshots", "external_identities", "ebay_parts_catalog"] as const;
const PAGE: Record<string, number> = { vehicle_events: 5000, vehicle_observations: 3000, listing_page_snapshots: 3000 };
const BUCKET = "listing-snapshots";

interface Scan {
  at: string | null; complete: boolean; scanned: Record<string, number>; not_assessed: number;
  members: Map<string, { seller: Set<string>; mention: Set<string>; places: Set<string> }>;
}

async function scanAll(supabase: any, deadline: number): Promise<Scan> {
  const s: Scan = { at: null, complete: true, scanned: {}, not_assessed: 0, members: new Map() };
  for (const place of PLACES) {
    let after: string | null = null;
    do {
      if (Date.now() > deadline) { s.complete = false; return s; }
      const r: { data: any } = mustWrite(`scan ${place}`, await supabase.rpc("ebay_deletion_scan", { p_place: place, p_after: after, p_limit: PAGE[place] ?? 1000 }));
      const page: any = r.data ?? {};
      s.at ??= page.at ?? null;
      s.scanned[place] = (s.scanned[place] ?? 0) + Number(page.scanned ?? 0);
      s.not_assessed += Number(page.not_assessed ?? 0);
      for (const m of page.matches ?? []) {
        const e = s.members.get(m.member_sha256) ?? { seller: new Set<string>(), mention: new Set<string>(), places: new Set<string>() };
        if (m.listing_key) (m.role === "seller" ? e.seller : e.mention).add(String(m.listing_key));
        e.places.add(place);
        s.members.set(m.member_sha256, e);
      }
      after = page.next_after ?? null;
    } while (after);
  }
  return s;
}

const chunks = <T>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** Rewrite one stored page (and its markdown) in Storage, at the same path, without the member; returns the spellings it read.
 *  `known` are the spellings the structured copies hold (ebay_member_spellings): a page can name the member without a label. */
async function rewriteStored(supabase: any, snap: any, sha: string, sold: boolean, known: string[]): Promise<{ changed: boolean; handles: string[] }> {
  const parts: string[] = [], handles = new Set<string>();
  let htmlSha: string | null = null, htmlLen: number | null = null, left: { member: string[]; seller: string[] } | null = null;
  for (const [part, path] of [["html", snap.html_storage_path], ["markdown", snap.markdown_storage_path]] as const) {
    if (!path) continue;
    const dl = await supabase.storage.from(BUCKET).download(path);
    if (dl.error || !dl.data) throw new Error(`stored ${part} of snapshot ${snap.id}: ${dl.error?.message ?? "no body"}`);
    const text = await dl.data.text();
    const { byHash } = await handleHashes(text);
    const names = [...new Set([...[...byHash].filter(([k]) => k === sha).map(([, h]) => h), ...known])];
    if (!names.length) continue;
    for (const n of names) handles.add(n);   // each hashes to the member (the page's by the filter, the known by ebay_member_spellings)
    const out = redactHandles(sold && part === "html" ? redactDescriptionContact(text) : text, names);
    if (out === text) continue;
    const bytes = new TextEncoder().encode(out);
    mustWrite(`rewrite stored ${part} of snapshot ${snap.id}`, await supabase.storage.from(BUCKET)
      .upload(path, bytes, { contentType: dl.data.type || (part === "html" ? "text/html" : "text/markdown"), upsert: true }));
    parts.push(part);
    if (part === "html") { htmlSha = await sha256Hex(bytes); htmlLen = bytes.length; left = await handleHashes(out); }
    else if (!left) left = await handleHashes(out);
  }
  if (!parts.length) return { changed: false, handles: [...handles] };
  const m = mustWrite(`stored page receipt ${snap.id}`, await supabase.rpc("mark_ebay_snapshot_redacted", {
    p_snapshot_id: snap.id, p_html_sha256: htmlSha, p_content_length: htmlLen,
    p_member_handles_sha256: left?.member ?? [], p_seller_handles_sha256: left?.seller ?? [], p_parts: parts,
  }));
  if (m.data?.ok === false) throw new Error(`stored page receipt ${snap.id}: ${m.data.why}`);
  return { changed: true, handles: [...handles] };
}

export interface HonourReport {
  action: "honour_deletions"; ok: boolean; dry_run: boolean; cutoff: string | null; complete: boolean; not_assessed: number;
  scanned: Record<string, number>; members_matched: number; listings_matched: number; changed: Record<string, number>;
  residual_members: number; refused_rows: number; finish: unknown; errors: string[]; ms: number;
}

export async function honourDeletions(supabase: any, o: { dryRun?: boolean; budgetMs?: number } = {}): Promise<HonourReport> {
  const t0 = Date.now(), deadline = t0 + (o.budgetMs ?? 120_000);
  const rep: HonourReport = { action: "honour_deletions", ok: true, dry_run: o.dryRun === true, cutoff: null, complete: false, not_assessed: 0,
    scanned: {}, members_matched: 0, listings_matched: 0, changed: {}, residual_members: 0, refused_rows: 0, finish: null, errors: [], ms: 0 };
  const add = (into: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + Number(v); };
  try {
    const scan = await scanAll(supabase, deadline);
    Object.assign(rep, { cutoff: scan.at, complete: scan.complete, not_assessed: scan.not_assessed, scanned: scan.scanned, members_matched: scan.members.size,
      listings_matched: [...scan.members.values()].reduce((n, e) => n + new Set([...e.seller, ...e.mention]).size, 0) });
    if (o.dryRun || !scan.at) return rep;

    const results: { member_sha256: string; changed: Record<string, number>; residual: number; refused: number }[] = [];
    for (const [sha, e] of scan.members) {
      const changed: Record<string, number> = {}; let refused = 0;
      try {
        const seller = [...e.seller], mention = [...e.mention].filter((k) => !e.seller.has(k)), handles = new Set<string>();
        for (const keys of chunks([...seller, ...mention], 200)) {
          const known = (mustWrite("spellings", await supabase.rpc("ebay_member_spellings", { p_member_sha256: sha, p_listing_keys: keys })).data ?? []) as string[];
          const snaps = mustWrite("stored pages", await supabase.rpc("ebay_listing_storage_snapshots", { p_listing_keys: keys })).data ?? [];
          for (const s of snaps) {
            const r = await rewriteStored(supabase, s, sha, e.seller.has(String(s.listing_key)), known);
            for (const h of r.handles) handles.add(h);
            if (r.changed) changed.listing_page_snapshots_stored = (changed.listing_page_snapshots_stored ?? 0) + 1;
          }
        }
        const batches = chunks([...seller.map((k) => ["s", k]), ...mention.map((k) => ["m", k])], 200);
        for (const b of batches.length ? batches : [[]]) {
          const red = mustWrite("redact", await supabase.rpc("redact_ebay_deleted_member", { p_member_sha256: sha,
            p_seller_keys: b.filter(([r]) => r === "s").map(([, k]) => k), p_mention_keys: b.filter(([r]) => r === "m").map(([, k]) => k),
            p_handles: [...handles] })).data ?? {};
          add(changed, red.changed ?? {});
          refused += (red.refused ?? []).length;
        }
      } catch (err) {
        refused += 1;
        rep.errors.push(`member ${sha.slice(0, 12)}: ${(err as Error).message}`.slice(0, 300));
      }
      add(rep.changed, changed); rep.refused_rows += refused;
      results.push({ member_sha256: sha, changed, residual: 0, refused });
    }

    // Every copy gone? The same scan again, for the members this run changed; a member still found stays pending.
    if (results.some((r) => Object.values(r.changed).some((n) => n > 0))) {
      const again = await scanAll(supabase, deadline);
      if (!again.complete) { rep.complete = false; rep.errors.push("time ran out before the residual scan finished; statuses wait for the next run"); }
      for (const r of results) if (again.members.has(r.member_sha256)) { r.residual = 1; rep.residual_members++; }
    }
    if (!rep.complete) return rep;
    const fin = mustWrite("finish", await supabase.rpc("finish_ebay_deletions", { p_cutoff: scan.at, p_results: results,
      p_scan: { complete: rep.complete, not_assessed: rep.not_assessed, scanned: rep.scanned } }));
    rep.finish = fin.data;
  } catch (err) {
    rep.errors.push((err as Error).message.slice(0, 400));
  } finally {
    rep.ms = Date.now() - t0;
    if (rep.errors.length) rep.ok = false;
  }
  return rep;
}

// ---- the stored pages, read once for the handles they name -------------------------------------------------------------------

export interface HandlesReport { action: "member_handles"; ok: boolean; pages: number; written: number; next_after: string | null; errors: string[] }

export async function readStoredHandles(supabase: any, o: { after?: string | null; listings?: number } = {}): Promise<HandlesReport> {
  const rep: HandlesReport = { action: "member_handles", ok: true, pages: 0, written: 0, next_after: null, errors: [] };
  try {
    const todo = mustWrite("handles todo", await supabase.rpc("ebay_snapshot_handles_todo", { p_after: o.after ?? null, p_limit: o.listings ?? 40 })).data ?? {};
    rep.next_after = todo.next_after ?? null;
    const rows: { snapshot_id: string; member_handles_sha256: string[]; seller_handles_sha256: string[] }[] = [];
    const queue = [...(todo.rows ?? [])];
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => { for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        let text = "";
        if (s.inline) {
          const r = mustWrite("inline body", await supabase.from("listing_page_snapshots").select("html").eq("id", s.id).maybeSingle());
          text = r.data?.html ?? "";
        } else {
          const path = s.html_storage_path ?? s.markdown_storage_path;
          const dl = await supabase.storage.from(BUCKET).download(path);
          if (dl.error || !dl.data) throw new Error(dl.error?.message ?? "no body");
          text = await dl.data.text();
        }
        const h = await handleHashes(text);
        rows.push({ snapshot_id: s.id, member_handles_sha256: h.member, seller_handles_sha256: h.seller });
        rep.pages++;
      } catch (err) {
        rep.errors.push(`snapshot ${s.id}: ${(err as Error).message}`.slice(0, 200));
      }
    } }));   // six stored pages at a time
    for (const c of chunks(rows, 200)) rep.written += Number(mustWrite("handles write", await supabase.rpc("set_ebay_snapshot_handles", { p_rows: c })).data?.updated ?? 0);
  } catch (err) {
    rep.errors.push((err as Error).message.slice(0, 300));
  }
  if (rep.errors.length) rep.ok = false;
  return rep;
}
