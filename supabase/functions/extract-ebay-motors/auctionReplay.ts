/** Bounded delivery receipts for already-read, already-owned auction states.
 * Native pages remain in the archive after delivery; this is not an identity queue. */
import { retainFetchedCapture } from "../_shared/archiveFetch.ts";
import { deletedLookup, handleHash, handleHashes, tombstoneItem } from "./deletedMembers.ts";
import { listingKey, type EbayItem } from "./browseMap.ts";

export const REPLAY_KEY = "ebay_auction_snapshot_replay_v1";
export const MAX_REPLAY = 1000;
const MAX_BYTES = 2_097_152;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface AuctionRead { url: string; readAt: string; method: "search" | "getItem"; response: any; items: EbayItem[] }
export interface ReplayCandidate { key: string; vehicleId: string; url: string; endAt: string }
export interface ReplayEntry extends ReplayCandidate { snapshotId: string; sha256: string; readAt: string; pageUrl: string; method: "search" | "getItem" }
export interface ReplayStore {
  load(deadline: number): Promise<ReplayEntry[]>;
  retain(page: AuctionRead, candidates: ReplayCandidate[], deadline: number): Promise<ReplayEntry[]>;
  summary(entry: ReplayEntry, deadline: number): Promise<EbayItem>;
  merge(additions: ReplayEntry[], acknowledgements: ReplayEntry[], deadline: number): Promise<{ pending: number; overflow: number }>;
}
export const replayToken = (e: ReplayEntry) => `${e.key}|${e.vehicleId}|${e.snapshotId}|${e.readAt}`;
export const closingFirst = (a: ReplayEntry, b: ReplayEntry) => Date.parse(a.endAt) - Date.parse(b.endAt) || a.key.localeCompare(b.key);
function valid(e: ReplayEntry): boolean {
  return /^\d{9,15}$/.test(e?.key) && UUID.test(e.vehicleId) && UUID.test(e.snapshotId)
    && /^[0-9a-f]{64}$/.test(e.sha256) && Number.isFinite(Date.parse(e.readAt))
    && Number.isFinite(Date.parse(e.endAt)) && ["search", "getItem"].includes(e.method)
    && [`https://ebay.com/itm/${e.key}`, `https://www.ebay.com/itm/${e.key}`].includes(e.url)
    && e.pageUrl.startsWith("https://api.ebay.com/buy/browse/v1/");
}
export function decodeReplay(value: any): ReplayEntry[] {
  if (value == null) return [];
  if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > MAX_REPLAY
    || value.entries.some((e: ReplayEntry) => !valid(e))
    || new Set(value.entries.map((e: ReplayEntry) => e.key)).size !== value.entries.length)
    throw Error("auction replay state invalid; no replay or overwrite");
  return value.entries;
}
/** A stale worker may acknowledge only the receipt it actually read. A newer
 * capture replaces pending delivery, while both original archives remain. */
export function mergeReplay(current: ReplayEntry[], additions: ReplayEntry[], acknowledgements: ReplayEntry[]) {
  const ack = new Set(acknowledgements.map(replayToken));
  const byKey = new Map(current.filter(e => !ack.has(replayToken(e))).map(e => [e.key, e]));
  for (const e of additions) {
    if (!valid(e)) throw Error("invalid auction replay receipt");
    if (ack.has(replayToken(e))) continue;
    const held = byKey.get(e.key);
    if (held && (held.vehicleId !== e.vehicleId))
      throw Error("auction replay identity conflict; existing owner preserved");
    if (held && Date.parse(e.readAt) === Date.parse(held.readAt) && (held.sha256 !== e.sha256 || held.snapshotId !== e.snapshotId))
      throw Error("auction replay same-clock capture conflict; existing receipt preserved");
    if (!held || Date.parse(e.readAt) > Date.parse(held.readAt)) byKey.set(e.key, e);
  }
  const all = [...byKey.values()].sort(closingFirst);
  return { entries: all.slice(0, MAX_REPLAY), overflow: Math.max(0, all.length - MAX_REPLAY) };
}
function signal(deadline: number): AbortSignal {
  const left = deadline - Date.now();
  if (left <= 0) throw Error("auction replay deadline reached");
  return AbortSignal.timeout(Math.min(left, 10_000));
}
const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, "0")).join("");

export function auctionReplayStore(sb: any): ReplayStore {
  const pages = new Map<string, any>();
  const readState = async (deadline: number) => {
    const r = await sb.from("system_state").select("value,updated_at").eq("key", REPLAY_KEY).maybeSingle().abortSignal(signal(deadline));
    if (r.error) throw Error("auction replay state read failed");
    return { entries: decodeReplay(r.data?.value), stamp: r.data?.updated_at as string | undefined };
  };
  return {
    async load(deadline) { return (await readState(deadline)).entries; },
    async retain(page, candidates, deadline) {
      if (!candidates.length) return [];
      if (!Number.isFinite(Date.parse(page.readAt)) || Date.parse(page.readAt) > Date.now()
        || page.items.length > 200 || !page.items.length || !page.response
        || !page.url.startsWith("https://api.ebay.com/buy/browse/v1/")) throw Error("invalid auction native page");
      // Reuse existing account-deletion policy before retaining full native JSON.
      // Each database request shares this stage's remaining deadline.
      const bounded = {
        from: (table: string) => ({
          insert: (row: any) => sb.from(table).insert(row).abortSignal(signal(deadline)),
          select: (columns: string) => sb.from(table).select(columns).abortSignal(signal(deadline)),
        }),
        rpc: (name: string, args: any) => sb.rpc(name, args).abortSignal(signal(deadline)),
        storage: { from: () => ({ download: async () => ({ data: null, error: "replay requires inline retained page" }) }) },
      };
      const handles = await handleHashes(JSON.stringify(page.items));
      // tombstoneItem also checks explicit usernames outside its text-pattern
      // grammar (for example one-character handles); preserve that coverage.
      const known = new Set(handles.byHash.values());
      const memberHashes = new Set(handles.member);
      for (const item of page.items) if (item.seller?.username && !known.has(String(item.seller.username).toLowerCase())) {
        memberHashes.add(await handleHash(String(item.seller.username)));
        known.add(String(item.seller.username).toLowerCase());
      }
      const gone = await deletedLookup(bounded)([...memberHashes]);
      const lookup = async (keys: string[]) => new Set(keys.filter(k => gone.has(k)));
      // The complete item set was checked above. With no deleted handles, each
      // item's identical lookup would return empty; avoid thousands of duplicate
      // regex scans/hashes across a full pass. Redaction stays unchanged otherwise.
      const items = gone.size === 0 ? page.items
        : await Promise.all(page.items.map(async item => (await tombstoneItem(lookup, item)).raw));
      const response = page.method === "search" ? { ...page.response, itemSummaries: items } : items[0];
      const body = JSON.stringify({ page_read_at: page.readAt, read_method: page.method, response });
      if (new TextEncoder().encode(body).length > MAX_BYTES) throw Error("auction replay page exceeds retention byte cap");
      const remainingHandles = await handleHashes(body);
      const pageUrl = new URL(page.url);
      pageUrl.searchParams.sort();
      const receipt = await retainFetchedCapture(bounded, { platform: "ebay_motors", url: pageUrl.href,
        html: body, httpStatus: 200, fetchedAt: page.readAt,
        metadata: { capture_kind: "auction_replay_page", representation: "native_json_with_capture_clock",
          member_handles_sha256: remainingHandles.member, seller_handles_sha256: remainingHandles.seller } });
      if ("reason" in receipt) throw Error(`auction page retention ${receipt.status}: ${receipt.reason}`);
      if (Date.parse(receipt.fetched_at) !== Date.parse(page.readAt)) throw Error("auction page capture clock mismatch");
      return candidates.map(c => {
        if (items.filter(i => listingKey(i) === c.key).length !== 1) throw Error("auction page member missing or ambiguous");
        const entry = { ...c, snapshotId: receipt.snapshot_id, sha256: receipt.html_sha256,
          readAt: receipt.fetched_at, pageUrl: pageUrl.href, method: page.method };
        if (!valid(entry)) throw Error("auction page owner invalid");
        return entry;
      });
    },
    async summary(entry, deadline) {
      signal(deadline);
      if (!valid(entry)) throw Error("invalid replay entry");
      let cached = pages.get(entry.snapshotId);
      if (!cached) {
        const r = await sb.from("listing_page_snapshots").select("id,platform,listing_url,fetched_at,html,html_sha256,success,http_status,metadata")
          .eq("id", entry.snapshotId).maybeSingle().abortSignal(signal(deadline));
        const row = r.data;
        if (r.error || !row || row.platform !== "ebay_motors" || row.listing_url !== entry.pageUrl
          || row.success !== true || row.http_status !== 200 || row.metadata?.capture_kind !== "auction_replay_page"
          || typeof row.html !== "string" || new TextEncoder().encode(row.html).length > MAX_BYTES
          || row.html_sha256 !== entry.sha256 || await hash(row.html) !== entry.sha256
          || Date.parse(row.fetched_at) !== Date.parse(entry.readAt)) throw Error("auction replay retained page verification failed");
        const page = JSON.parse(row.html);
        if (page.read_method !== entry.method || page.page_read_at !== entry.readAt
          && Date.parse(page.page_read_at) !== Date.parse(entry.readAt)) throw Error("auction replay page clock or method differs");
        cached = { page, sha256: entry.sha256, readAt: entry.readAt, pageUrl: entry.pageUrl, method: entry.method };
        pages.set(entry.snapshotId, cached);
      }
      if (cached.sha256 !== entry.sha256 || cached.readAt !== entry.readAt || cached.pageUrl !== entry.pageUrl
        || cached.method !== entry.method) throw Error("auction replay cached receipt differs");
      const page = cached.page;
      const items = entry.method === "search" ? page.response?.itemSummaries : [page.response];
      if (!Array.isArray(items) || items.length > 200) throw Error("auction replay native items invalid");
      const matches = items.filter(i => listingKey(i) === entry.key);
      if (matches.length !== 1 || !matches[0].buyingOptions?.includes("AUCTION")
        || matches[0].itemEndDate !== entry.endAt) throw Error("auction replay lot membership differs");
      return matches[0];
    },
    async merge(additions, acknowledgements, deadline) {
      for (let retry = 0; retry < 3; retry++) {
        const prior = await readState(deadline);
        const next = mergeReplay(prior.entries, additions, acknowledgements);
        if (!additions.length && !acknowledgements.length) return { pending: next.entries.length, overflow: next.overflow };
        const stamp = new Date(Math.max(Date.now(), Date.parse(prior.stamp ?? "") + 1 || 0)).toISOString();
        const row = { key: REPLAY_KEY, value: { version: 1, entries: next.entries }, updated_at: stamp };
        const write = prior.stamp ? sb.from("system_state").update(row).eq("key", REPLAY_KEY).eq("updated_at", prior.stamp)
          : sb.from("system_state").insert(row);
        const r = await write.select("key").abortSignal(signal(deadline));
        if (!r.error && r.data?.length === 1) return { pending: next.entries.length, overflow: next.overflow };
        if (r.error && r.error.code !== "23505") throw Error("auction replay state write failed");
      }
      throw Error("auction replay state changed concurrently; retained pages kept, merge deferred");
    },
  };
}
