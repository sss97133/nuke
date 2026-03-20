/**
 * transfer-status-api
 *
 * Lightweight public-facing endpoint returning transfer state for a vehicle.
 * Used by VehicleHeader badge, SDK, and any public consumer.
 *
 * Returns only non-sensitive fields — no contact info, no payment details.
 *
 * GET/POST /transfer-status-api?vehicle_id={uuid}
 * POST     { vehicle_id } or { transfer_id }
 *
 * Response:
 * {
 *   transfer_id, vehicle_id, status, agreed_price,
 *   sale_date, inbox_email,
 *   progress: { completed, total_required, pct },
 *   current_milestone: { type, label, status, deadline_at },
 *   next_milestone:    { type, label, deadline_at },
 *   days_since_activity: number | null,
 *   seller: { handle, platform, claimed: bool } | null,
 *   buyer:  { handle, platform, claimed: bool } | null,
 * }
 * or { transfer: null } if no active transfer for this vehicle
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MILESTONE_LABELS: Record<string, string> = {
  agreement_reached:       'Deal agreed',
  contact_exchanged:       'Contact exchanged',
  discussion_complete:     'Discussion complete',
  contract_drafted:        'Contract drafted',
  contract_signed_seller:  'Seller signed',
  contract_signed_buyer:   'Buyer signed',
  deposit_triggered:       'Deposit requested',
  deposit_sent:            'Deposit sent',
  deposit_received:        'Deposit received',
  deposit_confirmed:       'Deposit confirmed',
  full_payment_triggered:  'Payment requested',
  full_payment_sent:       'Payment sent',
  full_payment_received:   'Payment received',
  payment_confirmed:       'Payment confirmed',
  inspection_scheduled:    'Inspection scheduled',
  inspection_live:         'Inspection in progress',
  inspection_completed:    'Inspection done',
  insurance_triggered:     'Insurance requested',
  insurance_confirmed:     'Insurance confirmed',
  title_sent:              'Title mailed',
  title_in_transit:        'Title in transit',
  title_received:          'Title received',
  shipping_requested:      'Shipping requested',
  shipping_initiated:      'Vehicle picked up',
  vehicle_arrived:         'Vehicle delivered',
  transfer_complete:       'Transfer complete',
  obligations_defined:     'Obligations set',
  obligation_met:          'Obligation fulfilled',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Accept both GET (?vehicle_id=) and POST ({vehicle_id})
  let vehicle_id: string | null = null;
  let transfer_id: string | null = null;

  if (req.method === 'GET') {
    const url = new URL(req.url);
    vehicle_id = url.searchParams.get('vehicle_id');
    transfer_id = url.searchParams.get('transfer_id');
  } else {
    try {
      const body = await req.json();
      vehicle_id = body.vehicle_id ?? null;
      transfer_id = body.transfer_id ?? null;
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
  }

  if (!vehicle_id && !transfer_id) {
    return json({ error: 'vehicle_id or transfer_id required' }, 400);
  }

  // Fetch transfer
  let query = supabase
    .from('ownership_transfers')
    .select(`
      id, vehicle_id, status, agreed_price, currency, sale_date,
      inbox_email, last_milestone_at, stalled_at, created_at,
      milestones:transfer_milestones(
        sequence, milestone_type, status, required, deadline_at, completed_at
      ),
      seller:external_identities!from_identity_id(platform, handle, claimed_by_user_id),
      buyer:external_identities!to_identity_id(platform, handle, claimed_by_user_id)
    `);

  if (transfer_id) {
    query = query.eq('id', transfer_id);
  } else {
    query = query
      .eq('vehicle_id', vehicle_id!)
      .in('status', ['pending', 'in_progress', 'stalled'])
      .order('created_at', { ascending: false })
      .limit(1);
  }

  const { data, error } = transfer_id
    ? await query.single()
    : await query.maybeSingle();

  if (error) return json({ error: String(error) }, 500);
  if (!data) return json({ transfer: null });

  const milestones = (data.milestones ?? []).sort(
    (a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence,
  );

  // Progress: count required milestones only (skipped don't count against you)
  const requiredMs = milestones.filter((m: { required: boolean; status: string }) =>
    m.required && m.status !== 'skipped',
  );
  const completedRequired = requiredMs.filter(
    (m: { status: string }) => m.status === 'completed',
  ).length;
  const totalRequired = requiredMs.length;
  const pct = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

  // Current milestone: first non-completed, non-skipped
  const currentMs = milestones.find(
    (m: { status: string }) => m.status !== 'completed' && m.status !== 'skipped',
  ) ?? null;

  // Next milestone after current
  const nextMs = currentMs
    ? milestones.find(
        (m: { status: string; sequence: number }) =>
          m.status !== 'completed' &&
          m.status !== 'skipped' &&
          m.sequence > currentMs.sequence,
      ) ?? null
    : null;

  // Days since last activity
  const lastActivity = data.last_milestone_at ?? data.created_at;
  const daysSince = lastActivity
    ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const formatMs = (m: { milestone_type: string; status: string; deadline_at: string | null } | null) =>
    m
      ? {
          type: m.milestone_type,
          label: MILESTONE_LABELS[m.milestone_type] ?? m.milestone_type,
          status: m.status,
          deadline_at: m.deadline_at,
        }
      : null;

  const formatParty = (identity: { platform: string; handle: string; claimed_by_user_id: string | null } | null) =>
    identity
      ? {
          handle: identity.handle,
          platform: identity.platform,
          claimed: !!identity.claimed_by_user_id,
        }
      : null;

  return json({
    transfer_id: data.id,
    vehicle_id: data.vehicle_id,
    status: data.status,
    agreed_price: data.agreed_price,
    currency: data.currency,
    sale_date: data.sale_date,
    inbox_email: data.inbox_email,
    progress: { completed: completedRequired, total: totalRequired, pct },
    current_milestone: formatMs(currentMs),
    next_milestone: formatMs(nextMs),
    days_since_activity: daysSince,
    seller: formatParty(data.seller),
    buyer: formatParty(data.buyer),
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
