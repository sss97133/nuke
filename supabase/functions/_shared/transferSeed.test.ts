// Contract for the transfer seeding rules: a sold lot is a recorded sale (recorded_unconfirmed, the hammer milestone only),
// a party engaging creates the pipeline and moves it to in_progress, a lot the same seller relisted is not seeded, and the
// listing-seeded path keeps the full pipeline. Run: deno test --no-check --allow-read supabase/functions/_shared/transferSeed.test.ts
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  ADVANCEABLE_STATUSES,
  AUCTION_MILESTONES,
  buildMilestones,
  buildRecordedSaleMilestones,
  ensurePipelineMilestones,
  lotWasRelisted,
  missingPipelineMilestones,
  RECORDED_STATUS,
  SHIPPING_MILESTONES,
} from './transferSeed.ts';

const SALE = '2026-10-01T20:00:00.000Z';

Deno.test('a recorded sale has one milestone: the hammer, completed at the sale date', () => {
  const rows = buildRecordedSaleMilestones('t1', SALE);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].milestone_type, 'agreement_reached');
  assertEquals(rows[0].status, 'completed');
  assertEquals(rows[0].completed_at, SALE);
  assertEquals(rows[0].transfer_id, 't1');
});

Deno.test('the listing-seeded pipeline is unchanged: every step pending with a deadline, shipping steps sorted in', () => {
  const rows = buildMilestones('t2', SALE, false);
  assertEquals(rows.length, AUCTION_MILESTONES.length);
  assert(rows.every((r) => r.status === 'pending'));
  assertEquals(rows[0].deadline_at, '2026-10-02T20:00:00.000Z');
  const shipped = buildMilestones('t2', SALE, true);
  assertEquals(shipped.length, AUCTION_MILESTONES.length + SHIPPING_MILESTONES.length);
  assertEquals(shipped.map((r) => r.sequence), [...shipped.map((r) => r.sequence)].sort((a, b) => a - b));
});

Deno.test('a recorded sale can be advanced like a pending or in-progress transfer', () => {
  assert(ADVANCEABLE_STATUSES.includes('pending'));
  assert(ADVANCEABLE_STATUSES.includes('in_progress'));
  assert(ADVANCEABLE_STATUSES.includes(RECORDED_STATUS));
  assertEquals(RECORDED_STATUS, 'recorded_unconfirmed');
});

Deno.test('the pipeline a recorded sale lacks is every step but the hammer', () => {
  const missing = missingPipelineMilestones('t3', SALE, ['agreement_reached']);
  assertEquals(missing.length, AUCTION_MILESTONES.length - 1);
  assert(missing.every((m) => m.milestone_type !== 'agreement_reached' && m.status === 'pending'));
  assertEquals(missingPipelineMilestones('t3', SALE, AUCTION_MILESTONES.map((m) => m.milestone_type)).length, 0);
});

// A minimal stand-in for the supabase client: every chained call returns the builder; the awaited/terminal call returns the
// canned result for the table; inserts and upserts are recorded.
function fake(tables: Record<string, { data: unknown }>) {
  const calls: { table: string; op: string; rows?: unknown; opts?: unknown }[] = [];
  const client = {
    from(table: string) {
      const result = tables[table] ?? { data: null };
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is', 'in', 'limit', 'order']) builder[m] = () => builder;
      builder.maybeSingle = () => Promise.resolve(result);
      builder.then = (resolve: (v: unknown) => void) => resolve(result);
      builder.upsert = (rows: unknown, opts: unknown) => { calls.push({ table, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }); };
      builder.insert = (rows: unknown) => { calls.push({ table, op: 'insert', rows }); return Promise.resolve({ error: null }); };
      return builder;
    },
  };
  return { client, calls };
}

Deno.test('a lot the fold flagged as relisted by the same seller is not seeded; an unflagged lot is', async () => {
  assertEquals(await lotWasRelisted(fake({ ownership_fold_flags: { data: { id: 'f1' } } }).client, 'lot1'), true);
  assertEquals(await lotWasRelisted(fake({ ownership_fold_flags: { data: null } }).client, 'lot1'), false);
});

Deno.test('a party engaging with a recorded sale gets the pipeline created; any other status is left alone', async () => {
  const recorded = fake({
    ownership_transfers: { data: { status: RECORDED_STATUS, sale_date: SALE } },
    transfer_milestones: { data: [{ milestone_type: 'agreement_reached' }] },
  });
  assertEquals(await ensurePipelineMilestones(recorded.client, 't4'), true);
  assertEquals(recorded.calls.length, 1);
  assertEquals(recorded.calls[0].op, 'upsert');
  assertEquals((recorded.calls[0].rows as unknown[]).length, AUCTION_MILESTONES.length - 1);
  assertEquals(recorded.calls[0].opts, { onConflict: 'transfer_id,milestone_type', ignoreDuplicates: true });

  const inProgress = fake({ ownership_transfers: { data: { status: 'in_progress', sale_date: SALE } } });
  assertEquals(await ensurePipelineMilestones(inProgress.client, 't5'), false);
  assertEquals(inProgress.calls.length, 0);

  const missing = fake({ ownership_transfers: { data: null } });
  assertEquals(await ensurePipelineMilestones(missing.client, 't6'), false);
});

Deno.test('the two functions use the rules: auction seeds are recorded sales, the engagement path accepts them, the listing path is unchanged', () => {
  const automator = Deno.readTextFileSync(new URL('../transfer-automator/index.ts', import.meta.url));
  const advance = Deno.readTextFileSync(new URL('../transfer-advance/index.ts', import.meta.url));
  // seed_from_auction: recorded status, the one hammer milestone, the relist check; no inline pipeline, no current_transfer_id
  const auction = automator.slice(automator.indexOf('async function seedFromAuction'), automator.indexOf('async function seedFromListing'));
  assert(auction.includes('status: RECORDED_STATUS'));
  assert(auction.includes('buildRecordedSaleMilestones('));
  assert(auction.includes('lotWasRelisted('));
  assert(!auction.includes("status: 'in_progress'"));
  assert(!auction.includes('buildMilestones('));
  assert(!auction.includes('update({ current_transfer_id'));
  // seed_from_listing keeps the full pipeline and its status
  const listing = automator.slice(automator.indexOf('async function seedFromListing'), automator.indexOf('async function stalenessSweep'));
  assert(listing.includes("status: 'in_progress'"));
  assert(listing.includes('buildMilestones('));
  assert(listing.includes('update({ current_transfer_id'));
  // transfer-advance: no filter that would drop a recorded sale, and the status step takes it
  assert(!advance.includes(".in('status', ['pending', 'in_progress'])"));
  assertEquals(advance.split('[...ADVANCEABLE_STATUSES]').length - 1, 2);
  assert(advance.includes(".in('status', ['pending', RECORDED_STATUS])"));
  assertEquals(advance.split('ensurePipelineMilestones(supabase, transfer_id)').length - 1, 2);
});
