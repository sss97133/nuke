// Signed-in job loop, end to end in a real browser against the dev server, with Supabase mocked at the network
// (mockSupabase.mjs). Each test asserts the exact writer arguments the UI sends after its explicit confirm, and the
// privacy rules a visitor sees. Run: node --test e2e/jobs.e2e.mjs (Playwright resolved via NODE_PATH, as in CI).
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { startDevServer } from './devServer.mjs';
import { mockSupabase, persona } from './mockSupabase.mjs';
import {
  COMPLETION_HASH, HASH, INSP, QUOTE, SCOPE_HASH, WO, emptyReader, header, inspection, invoices, jobPath, jobReaders, offers, operations, quotes, viewer,
} from './fixtures.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const CUSTOMER = persona('00000000-0000-4000-b000-00000000c001', 'e2ebuyer');
const TECH = persona('00000000-0000-4000-b000-00000000c002', 'e2etech');
const SHOP = persona('00000000-0000-4000-b000-00000000c003', 'e2eshop');
const INSPECTOR = persona('00000000-0000-4000-b000-00000000c004', 'e2einspector');
const TIMEOUT = 30_000;

let server, browser;

before(async () => {
  server = await startDevServer();
  browser = await chromium.launch();
  // Warm the dev server (dependency optimisation can force one reload on first visit).
  const ctx = await browser.newContext();
  await mockSupabase(ctx, { readers: jobReaders(viewer('visitor')) });
  const page = await ctx.newPage();
  await page.goto(`${server.base}/jobs/${WO}`, { timeout: 120_000 });
  await page.getByRole('heading', { name: 'E2E exhaust job' }).waitFor({ timeout: 120_000 });
  await ctx.close();
}, { timeout: 240_000 });

after(async () => { await browser?.close(); server?.stop(); });

async function open(path, opts) {
  const ctx = await browser.newContext();
  const writes = await mockSupabase(ctx, opts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(TIMEOUT);
  await page.goto(`${server.base}${path}`);
  return { ctx, page, writes };
}

const dialog = (page) => page.getByRole('dialog');
const onlyWrite = (writes, rpc) => {
  const hits = writes.filter(w => w.rpc === rpc);
  assert.equal(hits.length, 1, `${rpc} called ${hits.length} times: ${JSON.stringify(writes)}`);
  return hits[0].args;
};
async function waitForWrite(writes, rpc) {
  for (let i = 0; i < 100 && !writes.some(w => w.rpc === rpc); i++) await new Promise(r => setTimeout(r, 100));
  return onlyWrite(writes, rpc);
}

describe('visitor privacy', () => {
  it('sees prices but no payments, balances, contact fields or Sign launchers', async () => {
    const v = viewer('visitor');
    // Even if a reader sent party money to a visitor, the page must not show it.
    const leaky = { ...invoices(v), payments: [{ witness_side: 'payee', amount: 812.34, currency: 'USD', paid_at: '2026-10-02T00:00:00Z', reference: 'private@example.test' }],
      reconciliation: { state: 'partially_paid', balance_due: 777.77, currency: 'USD' } };
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { readers: jobReaders(v, { work_order_invoices_read: leaky, work_order_quotes_read: quotes(v) }) });
    await page.getByRole('heading', { name: 'Invoice and payment' }).waitFor();
    const text = await page.locator('article').innerText();
    assert.match(text, /\$1,590\.00/);
    for (const leak of ['812.34', '777.77', 'private@example.test', '@e2e.invalid']) assert.ok(!text.includes(leak), `visitor saw ${leak}`);
    assert.equal(await page.locator('.job-sign').count(), 0);
    assert.equal(await page.getByRole('link', { name: 'MESSAGES' }).count(), 0);
    assert.deepEqual(writes, []);
    await ctx.close();
  });
});

describe('quotes', () => {
  it('customer accepts the quote and the writer gets the server hash', async () => {
    const v = viewer('client', ['customer'], [{ action: 'accept_quote', rpc: 'accept_work_order_quote', args: { p_quote_id: QUOTE, p_quote_hash: HASH } }]);
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(viewer('client', ['customer']), { work_order_quotes_read: quotes(v) }) });
    const sign = page.getByRole('group', { name: 'Accept quote' });
    await sign.getByRole('button', { name: 'Review and sign' }).click();
    assert.equal(writes.length, 0);
    await sign.getByText('It does not say').waitFor();
    await sign.getByRole('button', { name: 'Sign: Accept quote' }).click();
    assert.deepEqual(await waitForWrite(writes, 'accept_work_order_quote'), { p_quote_id: QUOTE, p_quote_hash: HASH });
    await ctx.close();
  });

  it('provider issues a quote from the job operations', async () => {
    const v = viewer('provider', ['performer'], [], { issuer_actions: [{ action: 'issue_quote', rpc: 'issue_work_order_quote',
      args: { p_work_order_id: WO, p_lines: [], p_deposit: null, p_valid_until: null, p_supersedes_quote_id: null, p_release_conditions: null },
      release_conditions_vocabulary: ['customer_completion_sign', 'photos_in_window', { kind: 'days_signed', days: '1..90' }] }] });
    const q = { ...quotes(v), current_quote: null, history: [], acceptance: { state: 'not_accepted' } };
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { who: TECH, readers: jobReaders(viewer('provider', ['performer']), { work_order_quotes_read: q, work_order_operations_read: operations }) });
    await page.getByRole('button', { name: 'Issue a quote' }).click();
    const d = dialog(page);
    await d.getByLabel('Line 1 amount').fill('1200');
    await d.getByRole('checkbox', { name: /customer confirms/i }).check();
    await d.getByRole('button', { name: 'Issue quote' }).click();
    const args = await waitForWrite(writes, 'issue_work_order_quote');
    assert.equal(args.p_work_order_id, WO);
    assert.deepEqual(args.p_lines, [{ ref_kind: 'operation', ref_id: 'op-1', description: 'Fabricate long tube headers', pricing_basis: 'flat', amount: 1200, currency: 'USD' }]);
    assert.deepEqual(args.p_release_conditions, [{ kind: 'customer_completion_sign' }]);
    await d.getByText('Quote issued').waitFor();
    await ctx.close();
  });
});

describe('completion', () => {
  it('provider marks the work done, then the customer confirms it, each pinned to its hash', async () => {
    const pv = viewer('provider', ['performer'], [{ action: 'issue_invoice', rpc: 'issue_work_order_invoice', args: { p_work_order_id: WO } }]);
    let s = await open(`/jobs/${WO}`, { who: TECH, readers: jobReaders(viewer('provider', ['performer']), { work_order_invoices_read: invoices(pv, { withInvoice: false }) }) });
    await s.page.getByRole('button', { name: 'Mark the work done' }).click();
    await dialog(s.page).getByLabel('Note').fill('Headers in, no leaks');
    await dialog(s.page).getByRole('button', { name: 'Mark done' }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'attest_work_completion'), { p_work_order_id: WO, p_scope_hash: SCOPE_HASH, p_note: 'Headers in, no leaks', p_evidence: null });
    await s.ctx.close();

    const cv = viewer('client', ['customer']);
    const attested = { provider_attestation: { completion_id: 'comp-1', completion_hash: COMPLETION_HASH, signed_at: '2026-10-19T18:00:00Z', signer_role: 'performer' } };
    s = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(cv, { work_order_job_path_read: jobPath(cv, attested) }) });
    await s.page.getByRole('button', { name: 'Confirm the work is done' }).click();
    await dialog(s.page).getByRole('button', { name: "Confirm it's done" }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'accept_work_completion'), { p_work_order_id: WO, p_completion_id: 'comp-1', p_completion_hash: COMPLETION_HASH });
    await s.ctx.close();
  });
});

describe('invoice and payment', () => {
  it('provider invoices from the accepted quote, then the customer records paying', async () => {
    const pv = viewer('provider', ['performer'], [{ action: 'issue_invoice', rpc: 'issue_work_order_invoice', args: { p_work_order_id: WO } }]);
    let s = await open(`/jobs/${WO}`, { who: TECH, readers: jobReaders(viewer('provider', ['performer']), {
      work_order_invoices_read: invoices(pv, { withInvoice: false }), work_order_quotes_read: quotes(viewer('provider', ['performer']), { accepted: true }) }) });
    await s.page.getByRole('button', { name: 'Issue an invoice' }).click();
    await dialog(s.page).getByRole('button', { name: 'Issue invoice' }).click();
    const inv = await waitForWrite(s.writes, 'issue_work_order_invoice');
    assert.equal(inv.p_quote_id, QUOTE);
    assert.deepEqual(inv.p_lines.map(l => [l.quote_line, l.description, l.amount, l.quantity]), [[0, 'Fabricate long tube headers', 1200, null], [1, 'Install exhaust', 130, 3]]);
    await s.ctx.close();

    const cv = viewer('client', ['customer'], [{ action: 'record_payment', rpc: 'record_work_order_payment', args: { p_invoice_id: 'inv-1' }, as: 'payer' }]);
    s = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(viewer('client', ['customer']), { work_order_invoices_read: invoices(cv) }) });
    await s.page.getByRole('button', { name: 'Record a payment' }).click();
    const d = dialog(s.page);
    await d.getByText("Nuke records payments; it doesn't move money.").first().waitFor();
    await d.getByLabel('Payment amount').fill('1590');
    await d.getByLabel('Payment method').selectOption('zelle');
    await d.getByRole('button', { name: 'Record payment' }).click();
    const pay = await waitForWrite(s.writes, 'record_work_order_payment');
    assert.equal(pay.p_invoice_id, 'inv-1');
    assert.equal(pay.p_amount, 1590);
    assert.equal(pay.p_currency, 'USD');
    assert.equal(pay.p_method, 'zelle');
    await s.ctx.close();
  });
});

describe('co-sign', () => {
  it('co-signs an offer acting for the shop the server names', async () => {
    const v = viewer('org_member', ['org_owner'], [{ action: 'cosign_provider', rpc: 'cosign_provider', args: { p_work_order_id: WO, p_offer_id: 'offer-1' },
      as: { attestor_kind: 'organization' },
      acting_for: [{ kind: 'organization', name: 'E2E Garage', p_cut: { organization_id: 'org-e2e' } }, { kind: 'user', p_cut: { as: 'self' } }] }]);
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { who: SHOP, readers: jobReaders(viewer('org_member', ['org_owner']), { work_order_offers_read: offers(v) }) });
    await page.getByRole('button', { name: 'Co-sign this technician' }).click();
    const d = dialog(page);
    await d.getByLabel('Co-sign as').selectOption({ label: 'E2E Garage' });
    await d.getByRole('checkbox', { name: /Permission/ }).check();
    await d.getByLabel('Scope').fill('Lift and TIG welder at E2E Garage for this job');
    await d.getByLabel('Cut', { exact: true }).selectOption('share_of_labor_line');
    await d.getByLabel('Cut value').fill('10');
    await d.getByRole('button', { name: 'Co-sign' }).click();
    assert.deepEqual(await waitForWrite(writes, 'cosign_provider'), { p_work_order_id: WO, p_offer_id: 'offer-1', p_kinds: ['permission'],
      p_scope: 'Lift and TIG welder at E2E Garage for this job', p_cut: { basis: 'share_of_labor_line', percentage: 10, organization_id: 'org-e2e' } });
    await ctx.close();
  });
});

describe('shop bookings', () => {
  it('customer asks for a bay, then the shop confirms it from its queue', async () => {
    const cv = viewer('client', ['customer'], [{ action: 'reserve_facility', rpc: 'reserve_facility', as: 'customer',
      args: { p_work_order_id: WO, p_asset_id: null, p_from: null, p_until: null, p_terms: null },
      facilities: [{ kind: 'organization', name: 'E2E Garage', organization_id: 'org-e2e' }],
      binds: ['a request for one declared asset for the window; it occupies capacity only when the facility confirms'], does_not_bind: ['payment', 'vehicle access'] }]);
    const facility = { organization: { kind: 'organization', name: 'E2E Garage', organization_id: 'org-e2e' }, assets_by_kind: [{ kind: 'lift', capacity_total: 1, assets: [{ asset_id: 'asset-1', label: 'Lift A', capacity: 1, busy: [] }] }] };
    let s = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(viewer('client', ['customer']), { work_order_job_path_read: jobPath(cv), facility_read: facility }) });
    await s.page.getByRole('button', { name: 'Book a bay' }).click();
    const d = dialog(s.page);
    await d.getByLabel('Space').waitFor();
    await d.getByLabel('From').fill('2030-01-07T08:00');
    await d.getByLabel('Until').fill('2030-01-07T17:00');
    await d.getByRole('button', { name: 'Ask the shop' }).click();
    const r = await waitForWrite(s.writes, 'reserve_facility');
    assert.equal(r.p_asset_id, 'asset-1');
    assert.equal(r.p_terms, null);
    assert.ok(Date.parse(r.p_until) > Date.parse(r.p_from));
    await s.ctx.close();

    const queue = { as_of: '2026-10-19T19:00:00Z', viewer: viewer('self'), coverage: { returned: 1, total: 1 },
      items: [{ kind: 'facility_reservation_to_confirm', ref_id: 'res-1', work_order_id: WO, display_title: 'E2E exhaust job', vehicle_label: header.vehicle_label,
        clock: { requested_at: '2026-10-19T18:00:00Z', from: '2030-01-07T16:00:00Z', until: '2030-01-08T01:00:00Z' },
        summary: { asset: { asset_id: 'asset-1', kind: 'lift', label: 'Lift A', capacity: 1 }, organization: { kind: 'organization', name: 'E2E Garage' },
          requester_role: 'customer', requested_by: { kind: 'user', handle: 'e2ebuyer' }, terms: null, capacity_free: true },
        sign: { rpc: 'confirm_facility_reservation', args_hint: { p_reservation_id: 'res-1', p_hash: 'e'.repeat(64) },
          binds: ['one capacity slot of this asset for the window'], does_not_bind: ['payment'] } }] };
    s = await open('/work', { who: SHOP, readers: { my_signature_queue: queue, my_work_orders: { rows: [], coverage: { returned: 0, total_for_viewer: 0 }, as_of: '2026-10-19T19:00:00Z' } } });
    await s.page.getByRole('button', { name: 'Confirm booking' }).click();
    await dialog(s.page).getByRole('button', { name: 'Confirm booking' }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'confirm_facility_reservation'), { p_reservation_id: 'res-1', p_hash: 'e'.repeat(64) });
    await s.ctx.close();
  });
});

describe('contact', () => {
  it('a customer asks to contact a technician, the technician accepts, and they write in the thread', async () => {
    const profile = { as_of: '2026-10-19T19:00:00Z', viewer: { context: 'visitor', slots: [] }, money: 'not_reported',
      subject: { kind: 'user', handle: 'e2etech', profile_id: TECH.id, city: 'Example City', state: 'NV', member_since: '2025-09-07T00:00:00Z' },
      claims: { account: { profession: 'mechanic', expertise_areas: [] }, actor_records: [] }, capabilities: { items: [] }, tools: {}, facilities: [],
      vouched_for_by: { items: [] }, identity_bridge: { state: 'none' }, work_record: {},
      contact: { action: 'contact_via_nuke', available: true, request: { writer: 'request_contact', context_kind: 'profile', context_id: TECH.id, recipient_user_id: TECH.id, recipient_actor_id: null } } };
    const limits = { as_of: '2026-10-19T19:00:00Z', incoming: [], outgoing: [], limits: { requests_per_day: 10, requests_sent_last_day: 3 } };
    let s = await open('/providers/e2etech', { who: CUSTOMER, tables: { profiles: [{ id: TECH.id }] },
      readers: { provider_profile_read: profile, my_contact_requests: limits, provider_job_record_read: { rows: [], coverage: { returned: 0, total_for_subject: 0 } },
        provider_productivity_read: { days: [], totals: { days_with_activity: 0 } } } });
    await s.page.getByText('You can send 7 more requests today.').waitFor();
    await s.page.getByRole('button', { name: 'Contact via Nuke' }).click();
    await s.page.locator('textarea').fill('Could you weld stainless headers next week?');
    await s.page.getByRole('button', { name: 'Review' }).click();
    await s.page.getByText('It does not say').waitFor();
    await s.page.getByRole('button', { name: 'Send request' }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'request_contact'), { p_context_kind: 'profile', p_context_id: TECH.id, p_message: 'Could you weld stainless headers next week?',
      p_recipient_user_id: TECH.id, p_recipient_actor_id: null, p_recipient_organization_id: null });
    await s.ctx.close();

    const inbox = { as_of: '2026-10-19T19:00:00Z', limits: { requests_per_day: 10, requests_sent_last_day: 0 }, outgoing: [],
      incoming: [{ request_id: 'req-c1', direction: 'incoming', status: 'pending', created_at: '2026-10-19T18:30:00Z', message: 'Could you weld stainless headers next week?',
        counterpart: { kind: 'user', handle: 'e2ebuyer' }, recipient_kind: 'user', context: { kind: 'profile', label: null }, thread: { messages: 0 }, actions: ['respond_contact_request'] }] };
    s = await open('/messages', { who: TECH, readers: { my_contact_requests: inbox } });
    await s.page.getByText('From @e2ebuyer').waitFor();
    await s.page.getByRole('button', { name: 'Accept', exact: true }).click();
    await dialog(s.page).getByRole('button', { name: 'Accept request' }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'respond_contact_request'), { p_id: 'req-c1', p_accept: true });
    await s.ctx.close();

    const thread = { as_of: '2026-10-19T19:00:00Z', can_post: true,
      request: { request_id: 'req-c1', direction: 'incoming', status: 'accepted', counterpart: { kind: 'user', handle: 'e2ebuyer' }, recipient_kind: 'user', message: 'Could you weld stainless headers next week?' },
      messages: [] };
    s = await open('/messages/req-c1', { who: TECH, readers: { contact_thread_read: thread } });
    await s.page.getByRole('heading', { name: 'Conversation with @e2ebuyer' }).waitFor();
    await s.page.getByRole('textbox', { name: 'Message' }).fill('Yes, Tuesday works.');
    await s.page.getByRole('button', { name: 'Send' }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'post_contact_message'), { p_request_id: 'req-c1', p_body: 'Yes, Tuesday works.' });
    await s.ctx.close();
  });
});

describe('inspection', () => {
  it('the accepted inspector records findings against the checklist', async () => {
    const v = viewer('provider', ['inspector'], [{ action: 'record_findings', rpc: 'record_inspection_findings', args: { p_inspection_work_order_id: INSP } }]);
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { who: INSPECTOR, readers: jobReaders(viewer('provider', ['inspector']), { work_order_inspection_read: inspection(v) }) });
    await page.getByRole('button', { name: 'Record inspection findings' }).click();
    const d = dialog(page);
    await d.getByLabel('Summary').fill('Solid truck, minor seep');
    await d.getByLabel('Item 1 verdict').selectOption('supports');
    await d.getByLabel('Item 1 finding').fill('Frame straight, no repairs found');
    await d.getByLabel('Item 1 system').selectOption('undercarriage');
    await d.getByLabel('Overall condition').selectOption('good');
    await d.getByRole('button', { name: 'Record findings' }).click();
    assert.deepEqual(await waitForWrite(writes, 'record_inspection_findings'), { p_inspection_work_order_id: INSP, p_findings: {
      summary: 'Solid truck, minor seep', overall_condition: 'good',
      findings: [{ finding: 'Frame straight, no repairs found', severity: 'info', item_id: 'frame', verdict: 'supports', system: 'undercarriage' }] } });
    await ctx.close();
  });

  it('the owner grants access and a party attaches their own photos, never a refused one', async () => {
    const ov = viewer('client', ['vehicle_access'], [{ action: 'grant_inspection_access', rpc: 'grant_inspection_access', args: { p_inspection_work_order_id: INSP },
      permission_state: 'not_established', binds: ['your permission, as the verified owner, for the accepted inspector to inspect this vehicle within the scope you state'],
      does_not_bind: ['access to your account or records', 'payment', 'the sale of the vehicle'] }]);
    let s = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(viewer('client', ['vehicle_access']), { work_order_inspection_read: inspection(ov) }) });
    await s.page.getByRole('button', { name: 'Let an inspector see your car' }).click();
    await dialog(s.page).getByLabel('Scope').fill('Driveway only, no test drive');
    await dialog(s.page).getByRole('button', { name: 'Grant access' }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'grant_inspection_access'), { p_inspection_work_order_id: INSP, p_scope: 'Driveway only, no test drive', p_window: null });
    await s.ctx.close();

    const ev = { ...emptyReader(viewer('provider', ['performer'])), attachments: [],
      viewer: { ...viewer('provider', ['performer']), actions: [{ action: 'attach_evidence', rpc: 'attach_job_evidence', args: { p_work_order_id: WO } }] } };
    const candidates = { as_of: '2026-10-19T19:00:00Z', work_orders: [{ work_order_id: WO, role: 'performer' }],
      items: [{ image_id: 'img-1', work_order_id: WO, captured_at: '2026-10-18T15:00:00Z', image_url: null }],
      coverage: { returned: 1, not_attachable_excluded: 2 },
      sign: { rpc: 'attach_job_evidence', binds: ['your statement that these own photos document this job'], does_not_bind: ['image visibility or ownership', 'completion', 'payment'] } };
    s = await open(`/jobs/${WO}`, { who: TECH, readers: jobReaders(viewer('provider', ['performer']), { work_order_evidence_read: ev, job_evidence_candidates_read: candidates }) });
    await s.page.getByRole('button', { name: 'Attach photos to this job' }).click();
    const d = dialog(s.page);
    await d.getByText(/2 of your photos from this job's window can't be attached/).waitFor();
    await d.getByRole('checkbox', { name: /Photo/ }).check();
    await d.getByRole('button', { name: 'Attach photos' }).click();
    assert.deepEqual(await waitForWrite(s.writes, 'attach_job_evidence'), { p_work_order_id: WO, p_image_ids: ['img-1'], p_operation_id: null, p_note: null });
    await s.ctx.close();
  });
});

describe('publication', () => {
  const REFUSAL = 'Remove names and contact details from the job title and description before opening it; contact goes through Nuke';
  const pub = (visibility, actions) => ({ work_order_id: WO, visibility, requirements: 0, listed_in_open_requirements: false, last_sign: null,
    as_of: '2026-10-19T19:00:00Z', viewer: { party: actions.length > 0, actions } });
  const openAction = (refused = null) => ({ action: 'publish_work_order', rpc: 'publish_work_order', args: { p_work_order_id: WO, p_visibility: 'open' }, visibility: 'open',
    refused_reason: refused, binds: ['your statement that this job is open: technicians near you can see its needs and offer'], does_not_bind: ['a price', 'payment'] });

  it('the vehicle owner publishes a job open after confirming', async () => {
    const cv = viewer('client', ['customer']);
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(cv, {
      work_order_publication_read: pub('not_published', [openAction(), { action: 'publish_work_order', rpc: 'publish_work_order', args: { p_work_order_id: WO, p_visibility: 'invite_only' }, visibility: 'invite_only' }]) }) });
    await page.getByText('Not published').waitFor();
    await page.getByRole('button', { name: 'Publish: open to technicians' }).click();
    const d = dialog(page);
    await d.getByText('Your statement that this job is open').waitFor();
    assert.equal(writes.length, 0);
    await d.getByRole('button', { name: 'Publish: open to technicians' }).click();
    assert.deepEqual(await waitForWrite(writes, 'publish_work_order'), { p_work_order_id: WO, p_visibility: 'open' });
    await ctx.close();
  });

  it('shows the server refusal instead of a confirm when contact details block open, and a visitor sees only the state', async () => {
    const cv = viewer('client', ['customer']);
    let s = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(cv, { work_order_publication_read: pub('invite_only', [openAction(REFUSAL)]) }) });
    const b = s.page.getByRole('button', { name: 'Change to open' });
    await b.waitFor();
    assert.equal(await b.isDisabled(), true);
    await s.page.getByText(REFUSAL).waitFor();
    assert.equal(s.writes.length, 0);
    await s.ctx.close();

    s = await open(`/jobs/${WO}`, { readers: jobReaders(viewer('visitor'), { work_order_publication_read: pub('open', []) }) });
    await s.page.getByText('Open — technicians near you can offer').waitFor();
    assert.equal(await s.page.getByRole('group', { name: 'Publish this job' }).count(), 0);
    await s.ctx.close();
  });
});

describe('business invite', () => {
  it('a business opens the shared link, sees the need, and claims by its e-mail domain', async () => {
    const ORG = '00000000-0000-4000-a000-00000000e2ea';
    const TOKEN = 'f'.repeat(64);
    const onNuke = { state: 'not_on_nuke_yet', label: 'Not on Nuke yet', owners_active: 0, members_active: 0, claimed_via: [],
      claim: { writer: 'claim_organization', methods: ['domain_email', 'document'], domain: 'e2eparts.example', domain_email_rule: "your confirmed sign-in e-mail is at this website's domain" } };
    const redeemed = { invite_id: 'inv-e2e', duplicate: false, organization: { kind: 'organization', name: 'E2E Parts', organization_id: ORG }, on_nuke: onNuke,
      claim: { writer: 'claim_organization', args: { p_organization_id: ORG }, domain_email_qualifies: true, methods: ['domain_email', 'document'] },
      requirement: { requirement_id: 'req-1', work_order_id: WO, kind: 'skill', description: 'Exhaust repair and fabrication', still_open: true,
        offer: { writer: 'offer_on_requirement', args: { p_requirement_id: 'req-1' } } }, membership_changed: false, email_returned: false };
    const { ctx, page, writes } = await open(`/supplier-invite/${TOKEN}`, { who: SHOP, readers: { redeem_supplier_invite: redeemed } });
    // The mock answers writers with { ok: true }; this reader-shaped answer stands in for redeem's real return.
    await ctx.route('https://e2e-mock.supabase.co/rest/v1/rpc/redeem_supplier_invite', async (route) => {
      writes.push({ rpc: 'redeem_supplier_invite', args: route.request().postDataJSON() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(redeemed) });
    });
    assert.equal(writes.length, 0);
    await page.getByRole('button', { name: 'Open the invite' }).click();
    await page.getByText('Exhaust repair and fabrication').waitFor();
    assert.deepEqual(onlyWrite(writes, 'redeem_supplier_invite'), { p_token: TOKEN });
    await page.getByRole('button', { name: 'Claim E2E Parts' }).click();
    await dialog(page).getByText('never shows or stores it').waitFor();
    await dialog(page).getByRole('button', { name: 'Claim this business' }).click();
    assert.deepEqual(await waitForWrite(writes, 'claim_organization'), { p_organization_id: ORG, p_method: 'domain_email', p_evidence: null });
    await ctx.close();
  });
});

describe('backup suppliers and business offers', () => {
  const notOnNuke = { organization: { kind: 'organization', organization_id: 'org-cool', name: 'Champion Cooling' }, profile_public: true, times: 3, last_on: '2026-01-23',
    role: 'plan_b_supplier', label: 'paid for this before on Nuke (3 times)', kinds_matched: ['cooling_parts'], on_nuke: { state: 'not_on_nuke_yet', label: 'Not on Nuke yet' }, can_receive_requests: false };
  const claimed = { organization: { kind: 'organization', organization_id: 'org-summit', name: 'Summit Racing' }, profile_public: true, times: 5, last_on: '2026-02-04',
    role: 'plan_b_supplier', label: 'paid for this before on Nuke (5 times)', kinds_matched: ['auto_parts'], on_nuke: { state: 'claimed', label: 'Claimed on Nuke', offer_capable: true }, can_receive_requests: true };
  const open_reqs = { as_of: '2026-10-19T19:00:00Z', next_after: null, coverage: { returned: 1, total_open: 1 }, viewer: viewer('client', ['customer']),
    contact: { action: 'contact_via_nuke', available: true }, rows: [{ requirement_id: 'req-1', work_order_id: WO, requirement_kind: 'skill', description: 'Radiator recore',
      display_title: 'E2E exhaust job', vehicle_label: header.vehicle_label, plan_b_suppliers: [notOnNuke, claimed], match: [] }] };

  it('the customer invites a business not on Nuke from the job page, and invites a claimed one to offer', async () => {
    const cv = viewer('client', ['customer']);
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { who: CUSTOMER, readers: jobReaders(cv, { open_requirements_read: open_reqs }) });
    const section = page.getByRole('region', { name: 'Backup suppliers for your requests' });
    await section.waitFor();
    assert.equal(await section.getByRole('link', { name: 'Not on Nuke yet — invite them' }).getAttribute('href'), '/org/org-cool?requirement=req-1');
    await section.getByText('Claimed on Nuke').waitFor();
    await section.getByRole('button', { name: 'Invite to offer' }).click();
    await dialog(page).getByRole('button', { name: 'Send invitation' }).click();
    const args = await waitForWrite(writes, 'request_contact');
    assert.equal(args.p_recipient_organization_id, 'org-summit');
    assert.equal(args.p_context_kind, 'requirement');
    assert.equal(args.p_context_id, 'req-1');
    await ctx.close();
  });

  it('a visitor sees offers from a business with its Claimed on Nuke badge, and no supplier invites', async () => {
    const v = viewer('visitor');
    const offersRead = { ...offers(v), requirements: [{ requirement_id: 'req-1', requirement_kind: 'skill', description: 'Radiator recore',
      offers: [{ offer_id: 'org-offer', offer_kind: 'organization', offer_rung: 'verified_claimant', terms_hash: 'd'.repeat(64),
        provider: { kind: 'organization', organization_id: 'org-summit', name: 'Summit Racing', on_nuke: 'Claimed on Nuke', evidence_rung: 'verified_claimant' },
        terms: { lines: [] }, acceptance: { state: 'not_accepted' }, co_signs: [] }] }] };
    const { ctx, page } = await open(`/jobs/${WO}`, { readers: jobReaders(v, { work_order_offers_read: offersRead, open_requirements_read: open_reqs }) });
    await page.getByText('Summit Racing · Claimed on Nuke').waitFor();
    assert.equal(await page.getByRole('region', { name: 'Backup suppliers for your requests' }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Not on Nuke yet — invite them' }).count(), 0);
    await ctx.close();
  });
});

describe('job market', () => {
  it('a visitor reads the market as plain counts, with no ids, names or amounts', async () => {
    const market = JSON.parse(readFileSync(new URL('../src/pages/work/marketFixture.json', import.meta.url), 'utf8'));
    const { ctx, page, writes } = await open('/work/market', { readers: { job_market_health_read: market } });
    await page.getByRole('heading', { name: 'The job market on Nuke' }).waitFor();
    const text = await page.locator('article[aria-label="The job market on Nuke"]').innerText();
    for (const s of ['39 open requests', '1 technician linked by evidence', '23 requests have a backup supplier', '0 businesses claimed yet']) assert.ok(text.includes(s), `missing: ${s}`);
    assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|@|\$\d/);
    assert.deepEqual(writes, []);
    await ctx.close();
  });
});

describe('parts from eBay', () => {
  // Finder reply in the shape extract-ebay-motors action "parts" returns (synthetic values; parts.test.ts covers eBay's shapes).
  const listing = { item_id: '157375338850', item_url: 'https://www.ebay.com/itm/157375338850?fits=Year%3A1983', title: 'E2E mechanical fuel pump',
    image_url: null, price: 23.59, currency: 'USD', shipping: 0, shipping_basis: 'free', total: 23.59, condition: 'New', condition_id: '1000',
    condition_class: 0, seller: { username: 'e2eseller', feedback_percentage: 99.9, feedback_score: 6000 }, item_location: { postal_prefix: '372**', country: 'US' },
    fit: 'exact', fit_properties: [{ name: 'Year', value: '1983' }], part_match: { state: 'names_part', word: 'pump' }, title_years_other: null,
    observed_at: new Date().toISOString(), rank: 1, why: ['Exact fit: eBay matched Year 1983', '$23.59 delivered: lowest of 12'] };
  const finder = { ok: true, refused: null, calls: { browse: 1, taxonomy: 7 }, quota: { daily_cap: 300, used_today: 5 },
    parts: [{ query: 'Borla S-Type muffler', status: 'searched', ebay_total: 12, read: 12, exact_read: 12, possible_read: 0, unknown_read: 0,
      category: { id: '33555', name: 'Exhaust' }, observed_at: listing.observed_at, browse_calls: 1, shortlist: [listing],
      fitment: { established: true, note: 'eBay checks fit on Year, Make, Model', steps: [] } }] };

  it('a shop owner searches, reads why, and approves one listing only at the Sign, with a reason', async () => {
    const v = viewer('org_member', ['org_owner']);
    const ops = { ...operations, part_approval: { approver_role: 'organization_owner' } };
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { who: SHOP, readers: jobReaders(v, { work_order_operations_read: ops }),
      functions: { 'extract-ebay-motors': finder } });
    await page.getByRole('region', { name: 'Parts from eBay' }).waitFor();
    await page.getByRole('checkbox', { name: 'Borla S-Type muffler' }).check();
    await page.getByRole('button', { name: 'Find exact-fit listings (1)' }).click();
    const link = page.getByRole('link', { name: 'Open on eBay' });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), listing.item_url);
    await page.getByRole('button', { name: 'Approve for this job' }).click();
    assert.deepEqual(writes, []);
    await page.getByRole('button', { name: 'Sign: approve this listing' }).click();
    const args = await waitForWrite(writes, 'approve_job_part_listing');
    assert.equal(args.p_work_order_id, WO);
    assert.equal(args.p_work_order_part_id, 'part-1');
    assert.equal(args.p_reason, 'Exact fit: eBay matched Year 1983; $23.59 delivered: lowest of 12');
    assert.equal(args.p_listing.item_id, '157375338850');
    assert.equal(args.p_listing.fit, 'exact');
    await ctx.close();
  });

  it('a visitor gets no finder; the hand-off page lists the approved listing with its eBay link', async () => {
    const approved = { ...operations.parts[0], approved_listings: [{ approval_id: 'ap-1', approved_at: listing.observed_at, approver_role: 'organization_owner', listing }] };
    const ops = { ...operations, part_approval: { approver_role: null }, parts: [approved] };
    const { ctx, page, writes } = await open(`/jobs/${WO}`, { readers: jobReaders(viewer('visitor'), { work_order_operations_read: ops }) });
    await page.getByRole('link', { name: 'Parts to buy' }).waitFor();
    assert.equal(await page.getByRole('region', { name: 'Parts from eBay' }).count(), 0);
    await page.getByRole('link', { name: 'Parts to buy' }).click();
    await page.getByRole('heading', { name: 'Parts to buy' }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open on eBay' }).getAttribute('href'), listing.item_url);
    assert.deepEqual(writes, []);
    await ctx.close();
  });
});
