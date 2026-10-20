/**
 * Shared transfer seeding rules (transfer-automator, transfer-advance).
 *
 * A sold auction lot is a RECORDED SALE, not a completed transfer (decided 2026-10-20, the evidence ladder): a scraper can
 * observe the hammer and nothing after it. So a transfer seeded from a lot starts as `recorded_unconfirmed` with only the
 * completed `agreement_reached` milestone; the deal pipeline (deposit ... title) is created if a party engages, which is
 * what moves the transfer to `in_progress`. A lot the same seller listed again is not a transfer at all
 * (ownership_fold_flags relist_same_seller) and is not seeded. The listing-seeded path keeps the full pipeline.
 */

export const RECORDED_STATUS = 'recorded_unconfirmed';

/** Statuses a transfer can be advanced from (a party signal, a manual advance, a lookup by vehicle). */
export const ADVANCEABLE_STATUSES = ['pending', 'in_progress', RECORDED_STATUS] as const;

// Default milestones for a deal run through Nuke. Sequences are intentional gaps (10-step) so we can insert between them later.
export const AUCTION_MILESTONES = [
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

// Shipping milestones: appended when the vehicle is not local pickup
export const SHIPPING_MILESTONES = [
  { sequence: 155, milestone_type: 'shipping_requested',  required: true, deadline_days: 43 },
  { sequence: 157, milestone_type: 'shipping_initiated',  required: true, deadline_days: 48 },
  { sequence: 165, milestone_type: 'vehicle_arrived',     required: true, deadline_days: 58 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The full pipeline for a deal run through Nuke (listing-seeded transfers). */
export function buildMilestones(transfer_id: string, sale_date: string, include_shipping: boolean) {
  const base = new Date(sale_date).getTime();
  const all = include_shipping
    ? [...AUCTION_MILESTONES, ...SHIPPING_MILESTONES].sort((a, b) => a.sequence - b.sequence)
    : AUCTION_MILESTONES;
  return all.map((m) => ({
    transfer_id,
    sequence: m.sequence,
    milestone_type: m.milestone_type,
    status: 'pending',
    required: m.required,
    deadline_at: new Date(base + m.deadline_days * DAY_MS).toISOString(),
  }));
}

/** A recorded sale: the hammer is the only step a scraper observed, so it is the only milestone, already completed. */
export function buildRecordedSaleMilestones(transfer_id: string, sale_date: string) {
  const first = AUCTION_MILESTONES[0];
  return [{
    transfer_id,
    sequence: first.sequence,
    milestone_type: first.milestone_type,
    status: 'completed',
    required: first.required,
    deadline_at: new Date(new Date(sale_date).getTime() + first.deadline_days * DAY_MS).toISOString(),
    completed_at: sale_date,
  }];
}

/** The pipeline milestones a recorded sale does not have yet, for when a party engages. */
export function missingPipelineMilestones(transfer_id: string, sale_date: string, existing_types: string[]) {
  const have = new Set(existing_types);
  return buildMilestones(transfer_id, sale_date, false).filter((m) => !have.has(m.milestone_type));
}

// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

/**
 * True when the fold has flagged the lot as relisted by the same seller right after it was recorded as sold: the sale did
 * not hand the vehicle on, so no transfer is seeded for it. The flag exists only once the fold has seen the later lot, so
 * this is a best effort at seed time; the relabel function closes the rest.
 */
export async function lotWasRelisted(supabase: SupabaseLike, auction_event_id: string): Promise<boolean> {
  const { data } = await supabase
    .from('ownership_fold_flags')
    .select('id')
    .eq('auction_event_id', auction_event_id)
    .eq('reason', 'relist_same_seller')
    .is('resolved_at', null)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

/**
 * A party engaging with a recorded sale needs the deal pipeline: creates the milestones the transfer lacks. A transfer in any
 * other status is left alone. Returns true when the transfer is a recorded sale (its status is moved by the caller).
 */
export async function ensurePipelineMilestones(supabase: SupabaseLike, transfer_id: string): Promise<boolean> {
  const { data: transfer } = await supabase
    .from('ownership_transfers')
    .select('status, sale_date')
    .eq('id', transfer_id)
    .maybeSingle();
  if (!transfer || transfer.status !== RECORDED_STATUS) return false;

  const { data: have } = await supabase
    .from('transfer_milestones')
    .select('milestone_type')
    .eq('transfer_id', transfer_id);
  const rows = missingPipelineMilestones(
    transfer_id,
    transfer.sale_date ?? new Date().toISOString(),
    (have ?? []).map((m: { milestone_type: string }) => m.milestone_type),
  );
  if (rows.length > 0) {
    await supabase.from('transfer_milestones').upsert(rows, { onConflict: 'transfer_id,milestone_type', ignoreDuplicates: true });
  }
  return true;
}
