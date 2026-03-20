/**
 * transfer-automator
 *
 * Seeds and manages ownership transfers automatically. Called by:
 * - DB trigger when auction_events.outcome becomes 'sold'
 * - Direct API call for manual/listing-based transfers
 * - Cron for staleness/overdue sweeps
 *
 * Actions:
 *   seed_from_auction   — create transfer from a sold auction_events row
 *   seed_from_listing   — create transfer from a direct listing sale
 *   staleness_sweep     — mark overdue milestones + stalled transfers
 *   get_transfer        — return full transfer state with milestones
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Default milestones seeded for every auction-triggered transfer.
// Sequences are intentional gaps (10-step) so we can insert between them later.
const AUCTION_MILESTONES = [
  { sequence: 10,  milestone_type: 'agreement_reached',      required: true,  deadline_days: 1  },
  { sequence: 20,  milestone_type: 'contact_exchanged',       required: true,  deadline_days: 3  },
  { sequence: 30,  milestone_type: 'discussion_complete',     required: false, deadline_days: 7  },
  { sequence: 40,  milestone_type: 'deposit_triggered',       required: true,  deadline_days: 5  },
  { sequence: 50,  milestone_type: 'deposit_sent',            required: true,  deadline_days: 7  },
  { sequence: 60,  milestone_type: 'deposit_received',        required: true,  deadline_days: 10 },
  { sequence: 70,  milestone_type: 'deposit_confirmed',       required: true,  deadline_days: 12 },
  { sequence: 80,  milestone_type: 'inspection_scheduled',    required: false, deadline_days: 14 },
  { sequence: 90,  milestone_type: 'inspection_live',         required: false, deadline_days: 21 },
  { sequence: 100, milestone_type: 'inspection_completed',    required: false, deadline_days: 25 },
  { sequence: 110, milestone_type: 'full_payment_triggered',  required: true,  deadline_days: 28 },
  { sequence: 120, milestone_type: 'full_payment_sent',       required: true,  deadline_days: 35 },
  { sequence: 130, milestone_type: 'full_payment_received',   required: true,  deadline_days: 40 },
  { sequence: 140, milestone_type: 'payment_confirmed',       required: true,  deadline_days: 42 },
  { sequence: 150, milestone_type: 'title_sent',              required: true,  deadline_days: 45 },
  { sequence: 160, milestone_type: 'title_in_transit',        required: true,  deadline_days: 50 },
  { sequence: 170, milestone_type: 'title_received',          required: true,  deadline_days: 60 },
  { sequence: 180, milestone_type: 'transfer_complete',       required: true,  deadline_days: 60 },
];

// Shipping milestones — appended when vehicle is not local pickup
const SHIPPING_MILESTONES = [
  { sequence: 155, milestone_type: 'shipping_requested',  required: true, deadline_days: 43 },
  { sequence: 157, milestone_type: 'shipping_initiated',  required: true, deadline_days: 48 },
  { sequence: 165, milestone_type: 'vehicle_arrived',     required: true, deadline_days: 58 },
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case 'seed_from_auction':
        return await seedFromAuction(supabase, body);
      case 'seed_from_listing':
        return await seedFromListing(supabase, body);
      case 'staleness_sweep':
        return await stalenessSweep(supabase);
      case 'get_transfer':
        return await getTransfer(supabase, body);
      case 'update_contacts':
        return await updateContacts(supabase, body);
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error('[transfer-automator] error:', err);
    return json({ error: String(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// seed_from_auction
// Creates an ownership_transfer from a sold auction_events row.
// Idempotent — if transfer already exists for this trigger_id, returns it.
//
// suppress_notifications:
//   When true, skips the fire-and-forget notify-transfer-parties call.
//   Required when running historical backfill (crons 223-227) to avoid
//   sending 150K+ emails/SMSes to buyers and sellers of old auction records.
//   Set to true for any batch seeding. Only set false (default) for new,
//   live auction closes where parties actually need to be notified.
// ---------------------------------------------------------------------------
async function seedFromAuction(supabase: ReturnType<typeof createClient>, body: {
  auction_event_id: string;
  include_shipping?: boolean;
  suppress_notifications?: boolean;
}) {
  const { auction_event_id, include_shipping = false, suppress_notifications = false } = body;

  if (!auction_event_id) return json({ error: 'auction_event_id required' }, 400);

  // Fetch the auction event
  const { data: ae, error: aeErr } = await supabase
    .from('auction_events')
    .select('*')
    .eq('id', auction_event_id)
    .single();

  if (aeErr || !ae) return json({ error: 'auction_event not found', detail: aeErr }, 404);
  if (ae.outcome !== 'sold') return json({ error: 'auction_event outcome is not sold', outcome: ae.outcome }, 400);

  // Idempotency: check if transfer already exists for this trigger
  const { data: existing } = await supabase
    .from('ownership_transfers')
    .select('id, status')
    .eq('trigger_id', auction_event_id)
    .eq('trigger_table', 'auction_events')
    .maybeSingle();

  if (existing) {
    return json({ transfer_id: existing.id, status: existing.status, created: false });
  }

  const vehicle_id = ae.vehicle_id;
  const agreed_price = ae.winning_bid ?? ae.high_bid ?? null;
  const sale_date = ae.auction_end_date ?? ae.updated_at;

  // Resolve seller external_identity (by platform handle)
  const from_identity_id = await resolveIdentity(supabase, ae.source, ae.seller_name);
  const to_identity_id = await resolveIdentity(supabase, ae.source, ae.winning_bidder ?? ae.high_bidder);

  // Resolve user ids from claimed identities
  const from_user_id = await resolveUserFromIdentity(supabase, from_identity_id);
  const to_user_id = await resolveUserFromIdentity(supabase, to_identity_id);

  // Generate per-transfer inbox email address (first 8 chars of UUID, no dashes)
  const shortId = auction_event_id.replace(/-/g, '').slice(0, 10);
  const inbox_email = `t-${shortId}@nuke.ag`;

  // Create the transfer
  const { data: transfer, error: transferErr } = await supabase
    .from('ownership_transfers')
    .insert({
      vehicle_id,
      trigger_type: 'auction',
      trigger_id: auction_event_id,
      trigger_table: 'auction_events',
      agreed_price,
      currency: 'USD',
      status: 'in_progress',
      sale_date,
      inbox_email,
      from_identity_id: from_identity_id ?? undefined,
      to_identity_id: to_identity_id ?? undefined,
      from_user_id: from_user_id ?? undefined,
      to_user_id: to_user_id ?? undefined,
    })
    .select()
    .single();

  if (transferErr || !transfer) {
    return json({ error: 'Failed to create transfer', detail: transferErr }, 500);
  }

  // Seed milestones
  const milestones = buildMilestones(transfer.id, sale_date, include_shipping);
  const { error: msErr } = await supabase.from('transfer_milestones').insert(milestones);
  if (msErr) console.error('[transfer-automator] milestone insert error:', msErr);

  // Mark the first milestone (agreement_reached) as completed at sale_date
  await supabase
    .from('transfer_milestones')
    .update({ status: 'completed', completed_at: sale_date })
    .eq('transfer_id', transfer.id)
    .eq('milestone_type', 'agreement_reached');

  // Set vehicles.current_transfer_id
  await supabase
    .from('vehicles')
    .update({ current_transfer_id: transfer.id })
    .eq('id', vehicle_id);

  // Notify parties — fire-and-forget, never blocks the seed response
  // Skip when suppress_notifications=true (e.g. historical backfill runs)
  if (!suppress_notifications) {
    fireAndForgetNotify(transfer.id, 'seeded');
  }

  console.log(`[transfer-automator] seeded transfer ${transfer.id} for vehicle ${vehicle_id} (notifications ${suppress_notifications ? 'suppressed' : 'sent'})`);

  return json({
    transfer_id: transfer.id,
    vehicle_id,
    inbox_email,
    from_identity_id,
    to_identity_id,
    agreed_price,
    milestones_seeded: milestones.length,
    created: true,
  });
}

// ---------------------------------------------------------------------------
// seed_from_listing
// Creates a transfer from a non-auction (listing/private_sale) trigger.
// ---------------------------------------------------------------------------
async function seedFromListing(supabase: ReturnType<typeof createClient>, body: {
  vehicle_id: string;
  agreed_price?: number;
  sale_date?: string;
  seller_identity_id?: string;
  buyer_identity_id?: string;
  seller_user_id?: string;
  buyer_user_id?: string;
  trigger_type?: 'listing' | 'private_sale' | 'gift' | 'inheritance';
  include_shipping?: boolean;
  notes?: string;
  suppress_notifications?: boolean;
}) {
  const {
    vehicle_id,
    agreed_price,
    sale_date = new Date().toISOString(),
    seller_identity_id,
    buyer_identity_id,
    seller_user_id,
    buyer_user_id,
    trigger_type = 'private_sale',
    include_shipping = false,
    suppress_notifications = false,
  } = body;

  if (!vehicle_id) return json({ error: 'vehicle_id required' }, 400);

  // Check for existing in-progress transfer on this vehicle
  const { data: existing } = await supabase
    .from('ownership_transfers')
    .select('id, status')
    .eq('vehicle_id', vehicle_id)
    .in('status', ['pending', 'in_progress'])
    .maybeSingle();

  if (existing) {
    return json({ transfer_id: existing.id, status: existing.status, created: false });
  }

  const { data: transfer, error } = await supabase
    .from('ownership_transfers')
    .insert({
      vehicle_id,
      trigger_type,
      agreed_price: agreed_price ?? null,
      currency: 'USD',
      status: 'in_progress',
      sale_date,
      from_identity_id: seller_identity_id ?? undefined,
      to_identity_id: buyer_identity_id ?? undefined,
      from_user_id: seller_user_id ?? undefined,
      to_user_id: buyer_user_id ?? undefined,
    })
    .select()
    .single();

  if (error || !transfer) return json({ error: 'Failed to create transfer', detail: error }, 500);

  const milestones = buildMilestones(transfer.id, sale_date, include_shipping);
  await supabase.from('transfer_milestones').insert(milestones);

  await supabase
    .from('vehicles')
    .update({ current_transfer_id: transfer.id })
    .eq('id', vehicle_id);

  // Notify parties — fire-and-forget, never blocks the seed response
  // suppress_notifications=true silences these for private_sale/listing backfill runs
  if (!suppress_notifications) {
    fireAndForgetNotify(transfer.id, 'seeded');
  }

  return json({ transfer_id: transfer.id, vehicle_id, milestones_seeded: milestones.length, created: true, notifications_sent: !suppress_notifications });
}

// ---------------------------------------------------------------------------
// staleness_sweep
// Marks overdue milestones + stalled transfers. Run every 4h via cron.
// ---------------------------------------------------------------------------
async function stalenessSweep(supabase: ReturnType<typeof createClient>) {
  const now = new Date().toISOString();

  // Mark milestones overdue where deadline has passed and not yet completed
  const { data: overdueMs, error: msErr } = await supabase
    .from('transfer_milestones')
    .update({ status: 'overdue' })
    .lt('deadline_at', now)
    .in('status', ['pending', 'in_progress'])
    .select('id');

  // Mark transfers stalled if no milestone activity for 14 days
  const staleDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: stalledTs, error: tsErr } = await supabase
    .from('ownership_transfers')
    .update({ status: 'stalled', stalled_at: now })
    .eq('status', 'in_progress')
    .lt('last_milestone_at', staleDate)
    .select('id');

  return json({
    overdue_milestones: overdueMs?.length ?? 0,
    stalled_transfers: stalledTs?.length ?? 0,
    sweep_at: now,
    errors: [msErr, tsErr].filter(Boolean),
  });
}

// ---------------------------------------------------------------------------
// get_transfer
// Returns full transfer record with milestones, documents, and party info.
// ---------------------------------------------------------------------------
async function getTransfer(supabase: ReturnType<typeof createClient>, body: {
  transfer_id?: string;
  vehicle_id?: string;
}) {
  const { transfer_id, vehicle_id } = body;

  let query = supabase
    .from('ownership_transfers')
    .select(`
      *,
      milestones:transfer_milestones(* ),
      documents:transfer_documents(*),
      payments:transfer_payments(*),
      communications:transfer_communications(id, direction, source, subject, received_at, milestone_type_inferred),
      seller_identity:external_identities!from_identity_id(id, platform, handle, display_name, claimed_by_user_id),
      buyer_identity:external_identities!to_identity_id(id, platform, handle, display_name, claimed_by_user_id)
    `);

  if (transfer_id) query = query.eq('id', transfer_id);
  else if (vehicle_id) query = query.eq('vehicle_id', vehicle_id).order('created_at', { ascending: false }).limit(1);
  else return json({ error: 'transfer_id or vehicle_id required' }, 400);

  const { data, error } = transfer_id ? await query.single() : await query.maybeSingle();
  if (error) return json({ error: error?.message ?? JSON.stringify(error) }, 500);
  if (!data) return json({ error: 'Transfer not found' }, 404);

  return json({ transfer: data });
}

// ---------------------------------------------------------------------------
// update_contacts
// Set buyer/seller phone + email for routing incoming SMS/email.
// Called manually or when buyer/seller contact info becomes known.
// ---------------------------------------------------------------------------
async function updateContacts(supabase: ReturnType<typeof createClient>, body: {
  transfer_id: string;
  buyer_phone?: string;
  buyer_email?: string;
  seller_phone?: string;
  seller_email?: string;
}) {
  const { transfer_id, buyer_phone, buyer_email, seller_phone, seller_email } = body;
  if (!transfer_id) return json({ error: 'transfer_id required' }, 400);

  const updates: Record<string, string> = {};
  if (buyer_phone) updates.buyer_phone = buyer_phone.replace(/\D/g, '').replace(/^1/, ''); // normalize to 10-digit
  if (buyer_email) updates.buyer_email = buyer_email.toLowerCase().trim();
  if (seller_phone) updates.seller_phone = seller_phone.replace(/\D/g, '').replace(/^1/, '');
  if (seller_email) updates.seller_email = seller_email.toLowerCase().trim();

  const { data, error } = await supabase
    .from('ownership_transfers')
    .update(updates)
    .eq('id', transfer_id)
    .select('id, inbox_email, buyer_phone, buyer_email, seller_phone, seller_email')
    .single();

  if (error) return json({ error: String(error) }, 500);
  return json({ transfer: data, updated: Object.keys(updates) });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMilestones(
  transfer_id: string,
  sale_date: string,
  include_shipping: boolean,
) {
  const base = new Date(sale_date).getTime();
  const allMilestones = include_shipping
    ? [...AUCTION_MILESTONES, ...SHIPPING_MILESTONES].sort((a, b) => a.sequence - b.sequence)
    : AUCTION_MILESTONES;

  return allMilestones.map((m) => ({
    transfer_id,
    sequence: m.sequence,
    milestone_type: m.milestone_type,
    status: 'pending',
    required: m.required,
    deadline_at: new Date(base + m.deadline_days * 24 * 60 * 60 * 1000).toISOString(),
  }));
}

async function resolveIdentity(
  supabase: ReturnType<typeof createClient>,
  platform: string | null,
  handle: string | null,
): Promise<string | null> {
  if (!handle || !platform) return null;

  // Try to find existing external_identity for this platform/handle
  const { data } = await supabase
    .from('external_identities')
    .select('id')
    .eq('platform', platform.toLowerCase())
    .ilike('handle', handle.trim())
    .maybeSingle();

  if (data) return data.id;

  // Create a ghost shell for this identity
  const { data: created } = await supabase
    .from('external_identities')
    .insert({
      platform: platform.toLowerCase(),
      handle: handle.trim(),
      display_name: handle.trim(),
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  return created?.id ?? null;
}

async function resolveUserFromIdentity(
  supabase: ReturnType<typeof createClient>,
  identity_id: string | null,
): Promise<string | null> {
  if (!identity_id) return null;
  const { data } = await supabase
    .from('external_identities')
    .select('claimed_by_user_id')
    .eq('id', identity_id)
    .single();
  return data?.claimed_by_user_id ?? null;
}

// Fire-and-forget call to notify-transfer-parties.
// Never awaited at call sites — a notification failure must never break a seed.
function fireAndForgetNotify(transfer_id: string, event: string, milestone_type?: string): void {
  const url = `${SUPABASE_URL}/functions/v1/notify-transfer-parties`;
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ transfer_id, event, milestone_type }),
  }).catch((err) => {
    console.warn(`[transfer-automator] notify-transfer-parties failed (non-fatal):`, err);
  });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
