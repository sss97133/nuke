import { linkAuctionCommentIdentities, sha256Hex, type AuctionCommentRow } from "../_shared/batAuctionRecord.ts";
import { observationClockMicroseconds } from "../_shared/observationContentHash.ts";

export const RETAINED_IDENTITY_MODE = "retained_bat_source_account_v1";
type Source = AuctionCommentRow & { id: string; created_at: string; external_identity_id: string | null; author_external_identity_id: string | null };
type Identity = { id: string; handle: string; metadata?: Record<string, any> | null };
export class RetainedIdentityConflict extends Error {}
export function retainedIdentitySelector(body: Record<string, unknown>): string | null {
  return body.mode === RETAINED_IDENTITY_MODE && typeof body.source_comment_id === "string" &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.source_comment_id) &&
    Object.keys(body).every(k => ["mode", "source_comment_id"].includes(k)) ? body.source_comment_id : null;
}
export async function retainedIdentityTupleHash(row: Source): Promise<string | null> {
  const event = observationClockMicroseconds(row.posted_at), recorded = observationClockMicroseconds(row.created_at);
  if (event === null || recorded === null) return null;
  return sha256Hex(JSON.stringify([row.id, row.vehicle_id, row.platform, row.author_username, row.bat_author_id,
    row.source_url, event.toString(), recorded.toString(), row.content_hash]));
}
function publisherIds(identity: Identity): unknown[] {
  const m = identity.metadata ?? {};
  return [m.bat_author_id, m.bat_publisher_author_id, m.retained_bat_source_account?.publisher_author_id]
    .filter(x => x !== undefined && x !== null);
}
function compatible(identity: Identity, source: Source) {
  return identity.handle === source.author_username && publisherIds(identity).every(id =>
    Number.isSafeInteger(Number(id)) && Number(id) === source.bat_author_id);
}
export interface RetainedIdentityStore {
  readSource(id: string): Promise<Source | null>;
  publicVehicle(id: string): Promise<boolean>;
  accountComments(handle: string): Promise<Array<{ bat_author_id: number | null }>>;
  find(handles: string[]): Promise<Identity[]>;
  // Canonical insert-ignore path only: preserve existing/concurrent rows.
  insertMissing(rows: Array<{ platform: "bat"; handle: string; profile_url: string; metadata: Record<string, unknown> }>): Promise<void>;
  refreshProfile(handle: string): Promise<void>;
}
export async function ingestRetainedIdentity(store: RetainedIdentityStore,
  sourceId: string) {
  const source = await store.readSource(sourceId);
  if (!source || source.id !== sourceId || source.platform !== "bat" ||
    !Number.isSafeInteger(source.bat_author_id) || source.bat_author_id! <= 0 ||
    !source.author_username || /^(unknown|anonymous)$/i.test(source.author_username.trim()) ||
    source.author_username !== source.author_username.trim() ||
    typeof source.content_hash !== "string" || !/^[0-9a-f]{64}$/i.test(source.content_hash) ||
    !/^https:\/\/bringatrailer\.com\/listing\/[^/?#]+\/?$/.test(source.source_url) ||
    await retainedIdentityTupleHash(source) === null || !await store.publicVehicle(source.vehicle_id)) {
    throw new RetainedIdentityConflict("Retained source is unavailable or ineligible");
  }
  const sourceTupleHash = await retainedIdentityTupleHash(source);
  const publisherId = source.bat_author_id!;
  const comments = await store.accountComments(source.author_username);
  if (!comments.length || comments.length > 1000 || comments.some(c =>
    c.bat_author_id != null && c.bat_author_id !== publisherId)) {
    throw new RetainedIdentityConflict("Publisher account disagreement or profile replay cap exceeded");
  }
  // Exact indexable variants, not fuzzy matching or forced alias reconciliation.
  let variants = [""];
  for (const character of source.author_username) {
    const choices = /[a-z]/i.test(character) ? [...new Set([character.toLowerCase(), character.toUpperCase()])] : [character];
    variants = variants.flatMap(prefix => choices.map(c => prefix + c));
    if (variants.length > 256) throw new RetainedIdentityConflict("Alias inspection exceeds bounded scope");
  }
  const candidates = await store.find(variants);
  if (candidates.some(c => !compatible(c, source)) || new Set(candidates.map(c => c.id)).size > 1 ||
    [source.external_identity_id, source.author_external_identity_id].filter(Boolean).some(id =>
      !candidates.some(c => c.id === id && compatible(c, source)))) {
    throw new RetainedIdentityConflict("Existing publisher identity or ambiguous alias conflicts");
  }
  let inserted = false;
  const linked = await linkAuctionCommentIdentities([source], {
    async find(handles) {
      const found = await store.find(handles);
      if (found.some(c => !compatible(c, source)) || found.length > 1) throw new RetainedIdentityConflict("Concurrent publisher identity conflicts");
      return found;
    },
    async insertMissing(rows) {
      await store.insertMissing(rows.map(row => ({ ...row, metadata: {
        retained_bat_source_account: { method: RETAINED_IDENTITY_MODE, source_comment_id: source.id,
          publisher_author_id: publisherId, source_url: source.source_url, source_hash: source.content_hash,
          source_event_at: source.posted_at, source_recorded_at: source.created_at,
          source_event_at_basis: "retained_posted_at", source_event_clock_origin: "unknown_legacy_fallback_possible",
          claim_role: "published_source_account", source_lineage: "untyped_metadata_citation",
          source_platform: "bat", source_handle: source.author_username, person_identity: "unknown" },
      } })));
      inserted = true; // Attempted insert; a concurrent winner is not new growth.
    },
  });
  const current = await store.readSource(sourceId);
  if (!current || await retainedIdentityTupleHash(current) !== sourceTupleHash ||
    current.external_identity_id !== source.external_identity_id ||
    current.author_external_identity_id !== source.author_external_identity_id) {
    throw new RetainedIdentityConflict("Retained source changed; profile replay withheld");
  }
  await store.refreshProfile(source.author_username);
  const identityId = linked[0].external_identity_id;
  return { success: true, source_comment_id: source.id, identity_id: identityId,
    insert_attempted: inserted, new_relationships: "verify_committed_profile_delta",
    native_comment_binding: source.external_identity_id === null ? "unresolved" : "unchanged",
    publisher_alias_coverage: "exact_case_variants_and_same_handle_evidence_only", person_identity: "unknown",
    source_lineage: "untyped_metadata_citation",
    source_citation: { source_comment_id: source.id, source_hash: source.content_hash,
      source_url: source.source_url, source_platform: "bat", source_handle: source.author_username,
      publisher_author_id: publisherId, source_event_at: source.posted_at, source_recorded_at: source.created_at,
      source_event_at_basis: "retained_posted_at", source_event_clock_origin: "unknown_legacy_fallback_possible" },
  };
}

/** Existing intake adapter. No INSERT/UPDATE/DELETE of auction_comments. */
export function retainedIdentityStore(db: any): RetainedIdentityStore {
  const finite = (query: any) => query.abortSignal(AbortSignal.timeout(10000));
  const data = async (query: any) => { const r = await finite(query); if (r.error) throw new Error("Retained identity read/write unavailable"); return r.data; };
  return {
    readSource: id => data(db.from("auction_comments").select("*").eq("id", id).maybeSingle()),
    publicVehicle: async id => Boolean(await data(db.from("vehicles").select("id").eq("id", id)
      .eq("is_public", true).is("deleted_at", null).or("listing_kind.is.null,listing_kind.neq.non_vehicle_item").maybeSingle())),
    accountComments: handle => data(db.from("auction_comments").select("bat_author_id").eq("platform", "bat")
      .eq("author_username", handle).limit(1001)),
    find: handles => data(db.from("external_identities").select("id,handle,metadata").eq("platform", "bat").in("handle", handles)),
    insertMissing: async rows => { await data(db.from("external_identities").upsert(rows, { onConflict: "platform,handle", ignoreDuplicates: true })); },
    refreshProfile: async handle => { await data(db.rpc("refresh_bat_user_profile", { p_username: handle })); },
  };
}
