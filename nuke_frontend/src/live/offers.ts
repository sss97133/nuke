/**
 * offers — the deep offer ledger + watch, the write side of the Live Floor.
 *
 * An OFFER is testimony about the rig, not a private DM. It writes through the
 * single canonical path (ingest-observation) as a `kind:'offer'` observation with
 * full provenance — who, how much, when, on which listing. It is never a raw
 * client INSERT into a testimony table (that's blocked by invariant). Offers then
 * accrue: their count/shape on a vehicle is a demand-legitimacy signal, the
 * buy-side twin of proof-of-work. We do NOT track seller responsiveness — the
 * lens points at the vehicle, not the person.
 *
 * WATCH reuses the existing follow substrate (user_subscriptions) — no new table.
 */

import { supabase } from '../lib/supabase';

export interface OfferInput {
  vehicleId: string;
  amountCents: number;
  note?: string;
  listingId?: string;
  ymm?: string;
}

/** Write an offer as a provenanced observation. Returns the ingest result. */
export async function makeOffer(input: OfferInput): Promise<{ ok: boolean; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return { ok: false, error: 'Sign in to make an offer' };
  if (!input.amountCents || input.amountCents <= 0) return { ok: false, error: 'Enter an amount' };

  const body = {
    source_slug: 'nuke-marketplace',
    kind: 'offer',
    observed_at: new Date().toISOString(),
    vehicle_id: input.vehicleId,
    content_text: `Offer: $${(input.amountCents / 100).toLocaleString()}${input.note ? ` — ${input.note}` : ''}`,
    structured_data: {
      amount_cents: input.amountCents,
      currency: 'USD',
      status: 'open',
      offered_by: userId,
      listing_id: input.listingId ?? null,
      ymm: input.ymm ?? null,
      note: input.note ?? null,
    },
    observer_raw: { user_id: userId, channel: 'live-floor' },
  };

  const { data, error } = await supabase.functions.invoke('ingest-observation', { body });
  if (error) return { ok: false, error: error.message };
  const dataErr = (data as { error?: unknown } | null)?.error;
  if (dataErr) return { ok: false, error: String(dataErr) };
  return { ok: true };
}

/** Watch (follow) a vehicle — reuses the follow substrate. Idempotent. */
export async function watchVehicle(vehicleId: string): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return { ok: false, error: 'Sign in to watch' };

  const { data: existing } = await supabase
    .from('user_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .eq('subscription_type', 'vehicle_status_change')
    .eq('target_id', vehicleId)
    .eq('is_active', true)
    .maybeSingle();
  if (existing) return { ok: true, already: true };

  const { data: vehicle } = await supabase
    .from('vehicles')
    .select('asking_price, current_value, sale_price')
    .eq('id', vehicleId)
    .single();
  const priceAtFollow = vehicle?.sale_price || vehicle?.asking_price || vehicle?.current_value || null;

  const { error } = await supabase.from('user_subscriptions').insert({
    user_id: userId,
    subscription_type: 'vehicle_status_change',
    target_id: vehicleId,
    followed_at: new Date().toISOString(),
    price_at_follow: priceAtFollow,
    is_active: true,
    filters: { auction_updates: true, price_changes: true, status_changes: true },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Offer counts per vehicle — the legitimacy read. Returns a map id → count.
 * This is what turns "6 offers, 3 over ask" into a signal on the card.
 */
export async function getOfferCounts(vehicleIds: string[]): Promise<Record<string, number>> {
  if (!vehicleIds.length) return {};
  const { data, error } = await supabase
    .from('vehicle_observations')
    .select('vehicle_id')
    .eq('kind', 'offer')
    .eq('is_superseded', false) // withdrawn/voided offers don't count toward the signal
    .in('vehicle_id', vehicleIds);
  if (error || !data) return {};
  const counts: Record<string, number> = {};
  for (const row of data as Array<{ vehicle_id: string }>) {
    counts[row.vehicle_id] = (counts[row.vehicle_id] || 0) + 1;
  }
  return counts;
}
