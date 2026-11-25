// Who may act on an ownership transfer through transfer-advance (2026-11-25).
//
// Signed in is anyone while sign-up is open, and every write here runs with the service key, so the caller's right to
// the named transfer is decided here, on the same parsed body the handler then uses:
// - the service key or an active admin: any action on any transfer;
// - otherwise only a party action (ingest_signal, advance_manual, get_next_milestone) on a transfer whose from_user_id or
//   to_user_id is the verified caller, or whose buyer or seller access token the caller sends (the /t/ party page);
// - ingest_email and ingest_sms (inbound webhooks) are the service key or an admin only.
// A refusal never says whether the transfer exists.

export const PARTY_ACTIONS = new Set(['ingest_signal', 'advance_manual', 'get_next_milestone']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TransferParties {
  from_user_id: string | null;
  to_user_id: string | null;
  buyer_access_token: string | null;
  seller_access_token: string | null;
}

export type TransferAccess =
  | { ok: true; via: 'privileged' | 'party_user' | 'party_token'; actingUserId: string | null }
  | { ok: false; status: 403; error: string };

/** The access token a party request carries: top-level access_token, or signal_metadata.token as the page sends it. */
export function partyToken(body: Record<string, unknown>): string | null {
  if (typeof body.access_token === 'string') return body.access_token;
  const meta = body.signal_metadata as Record<string, unknown> | null | undefined;
  return meta && typeof meta === 'object' && typeof meta.token === 'string' ? meta.token : null;
}

export async function decideTransferAccess(
  body: Record<string, unknown>,
  caller: { privileged: boolean; userId: string | null },
  loadTransfer: (id: string) => Promise<TransferParties | null>,
): Promise<TransferAccess> {
  if (caller.privileged) return { ok: true, via: 'privileged', actingUserId: caller.userId };
  const refuse: TransferAccess = {
    ok: false,
    status: 403,
    error: 'a party to this transfer, or the service key or an admin, is required',
  };
  if (typeof body.action !== 'string' || !PARTY_ACTIONS.has(body.action)) return refuse;
  if (typeof body.transfer_id !== 'string' || !UUID.test(body.transfer_id)) return refuse;
  const t = await loadTransfer(body.transfer_id);
  if (!t) return refuse;
  if (caller.userId && (t.from_user_id === caller.userId || t.to_user_id === caller.userId)) {
    return { ok: true, via: 'party_user', actingUserId: caller.userId };
  }
  const token = partyToken(body);
  if (token && UUID.test(token) && (t.buyer_access_token === token || t.seller_access_token === token)) {
    return { ok: true, via: 'party_token', actingUserId: null };
  }
  return refuse;
}

/**
 * The body an action runs with. Who did it is the verified caller, never the body: a party user or an admin is named as
 * itself, a token caller as nobody. Only the service key (no user of its own; the inbound webhooks and jobs) keeps the
 * body's completed_by_user_id / user_id. existing_comm_id (rewrite a stored communication's classification and
 * milestone link) is kept only for the service key or an admin.
 */
export function scopeBodyToCaller(body: Record<string, unknown>, access: TransferAccess): Record<string, unknown> {
  if (!access.ok) return body;
  if (access.via === 'privileged' && access.actingUserId === null) return body;
  const scoped: Record<string, unknown> = {
    ...body,
    completed_by_user_id: access.actingUserId,
    user_id: access.actingUserId,
  };
  if (access.via !== 'privileged') delete scoped.existing_comm_id;
  return scoped;
}

/** signal_metadata as stored: never with the party's access token in it (parties can read each other's messages). */
export function storableSignalMetadata(meta: unknown): unknown {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta ?? null;
  const { token: _token, access_token: _accessToken, ...rest } = meta as Record<string, unknown>;
  return rest;
}
