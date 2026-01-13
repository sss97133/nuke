import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config({ path: '.env.local' });
dotenv.config();

function env(name: string): string | undefined {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length ? v.trim() : undefined;
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function parseUSD(input: string, name: string): number {
  const v = Number(input);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Invalid ${name}: ${input}`);
  return v;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function moneyToCents(usd: number): number {
  return Math.round(usd * 100);
}

async function main() {
  if (env('RUN_INVOICE_CASHFLOW_INTEGRATION_TEST') !== 'true') {
    console.log('[invoice-cashflow-it] Skipping (set RUN_INVOICE_CASHFLOW_INTEGRATION_TEST=true to run)');
    return;
  }

  const supabaseUrl = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(supabaseUrl, serviceKey);

  const runId = env('TEST_RUN_ID') ?? `it_${crypto.randomUUID()}`;
  const includePayouts = env('INVOICE_CASHFLOW_TEST_INCLUDE_PAYOUTS') === 'true';

  const desiredInvoiceTotalUSD = parseUSD(env('INVOICE_CASHFLOW_TEST_INVOICE_TOTAL_USD') ?? '10', 'INVOICE_CASHFLOW_TEST_INVOICE_TOTAL_USD');
  const desiredDeltaUSD = parseUSD(env('INVOICE_CASHFLOW_TEST_DELTA_USD') ?? '1', 'INVOICE_CASHFLOW_TEST_DELTA_USD');

  const created: {
    orgId?: string;
    invoiceId?: string;
    dealId?: string;
    claimId?: string;
    userId?: string;
  } = {};

  console.log(`[invoice-cashflow-it] run_id=${runId} include_payouts=${includePayouts}`);

  try {
    // Prefer a disposable invoice if we can insert one; otherwise fall back to TEST_INVOICE_ID.
    const providedInvoiceId = env('TEST_INVOICE_ID');

    if (!providedInvoiceId) {
      console.log('[invoice-cashflow-it] No TEST_INVOICE_ID set; attempting to create a disposable org + invoice...');

      const orgName = `IT Cashflow Org (${runId})`;
      const { data: orgRow, error: orgErr } = await supabase
        .from('businesses')
        .insert({
          business_name: orgName,
          is_public: false,
          status: 'active',
          metadata: { integration_test: true, run_id: runId },
        })
        .select('id')
        .single();

      if (orgErr) throw orgErr;
      created.orgId = orgRow.id;

      const today = new Date().toISOString().slice(0, 10);
      const invoiceNumber = `IT-${runId}`;

      const { data: invRow, error: invErr } = await supabase
        .from('generated_invoices')
        .insert({
          business_id: created.orgId,
          invoice_number: invoiceNumber,
          invoice_date: today,
          due_date: today,
          subtotal: desiredInvoiceTotalUSD,
          tax_amount: 0,
          total_amount: desiredInvoiceTotalUSD,
          amount_paid: 0,
          amount_due: desiredInvoiceTotalUSD,
          payment_status: 'unpaid',
          status: 'draft',
          public_access_enabled: false,
          html_content: null,
        })
        .select('id,business_id,total_amount,amount_paid,amount_due')
        .single();

      if (invErr) throw invErr;
      created.invoiceId = invRow.id;
      console.log(`[invoice-cashflow-it] Created disposable invoice ${created.invoiceId} (org=${created.orgId})`);
    } else {
      created.invoiceId = providedInvoiceId;
      console.log(`[invoice-cashflow-it] Using provided invoice ${created.invoiceId}`);
    }

    // Load invoice + org context
    const { data: invoice, error: invLoadErr } = await supabase
      .from('generated_invoices')
      .select('id,business_id,invoice_number,total_amount,amount_paid,amount_due,payment_status')
      .eq('id', created.invoiceId)
      .single();

    if (invLoadErr) throw invLoadErr;
    if (!invoice?.business_id) throw new Error('Invoice missing business_id (organization); cannot test invoice->cashflow');

    const orgId = String(invoice.business_id);
    created.orgId = created.orgId ?? orgId;

    // Optional: create a temporary deal+claim to ensure a payout is generated.
    // WARNING: This will transfer funds to a user if payouts settle (we attempt cleanup).
    if (includePayouts) {
      console.log('[invoice-cashflow-it] Creating temporary claimant user + cashflow deal/claim...');

      const userEmail = `it-cashflow+${runId}@example.com`;
      const userPassword = crypto.randomBytes(16).toString('hex');

      const { data: userRes, error: userErr } = await supabase.auth.admin.createUser({
        email: userEmail,
        password: userPassword,
        email_confirm: true,
      });

      if (userErr) throw userErr;
      created.userId = userRes.user?.id;
      if (!created.userId) throw new Error('Failed to create temp auth user (missing id)');

      const { data: dealRow, error: dealErr } = await supabase
        .from('cashflow_deals')
        .insert({
          deal_type: 'revenue_share',
          subject_type: 'organization',
          subject_organization_id: orgId,
          title: `IT Invoice Cashflow Deal (${runId})`,
          status: 'active',
          is_public: false,
          priority: 0,
          rate_bps: 5000, // 50%
          metadata: { integration_test: true, run_id: runId },
        })
        .select('id')
        .single();

      if (dealErr) throw dealErr;
      created.dealId = dealRow.id;

      const { data: claimRow, error: claimErr } = await supabase
        .from('cashflow_claims')
        .insert({
          deal_id: created.dealId,
          claimant_user_id: created.userId,
          invested_cents: 10_000,
          status: 'active',
          metadata: { integration_test: true, run_id: runId },
        })
        .select('id')
        .single();

      if (claimErr) throw claimErr;
      created.claimId = claimRow.id;
    }

    // Apply a payment delta to trigger the DB pipeline
    const total = Number(invoice.total_amount ?? 0);
    const oldPaid = Number(invoice.amount_paid ?? 0);
    const oldDue = Number(invoice.amount_due ?? Math.max(0, total - oldPaid));

    if (!Number.isFinite(total) || total <= 0) throw new Error(`Invoice total_amount is invalid: ${invoice.total_amount}`);
    if (!Number.isFinite(oldPaid) || oldPaid < 0) throw new Error(`Invoice amount_paid is invalid: ${invoice.amount_paid}`);
    if (!Number.isFinite(oldDue) || oldDue < 0) throw new Error(`Invoice amount_due is invalid: ${invoice.amount_due}`);
    if (oldDue <= 0) throw new Error('Invoice has no amount_due remaining; choose an unpaid/partially-paid invoice or create a disposable one');

    const deltaUSD = Math.min(desiredDeltaUSD, oldDue);
    const newPaid = oldPaid + deltaUSD;
    const newDue = Math.max(0, total - newPaid);
    const newPaymentStatus = newDue <= 0 ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

    const startTs = new Date().toISOString();
    console.log(`[invoice-cashflow-it] Applying payment delta $${deltaUSD.toFixed(2)} to invoice ${invoice.id}...`);

    const { error: payErr } = await supabase
      .from('generated_invoices')
      .update({
        amount_paid: newPaid,
        amount_due: newDue,
        payment_status: newPaymentStatus,
      })
      .eq('id', invoice.id);

    if (payErr) throw payErr;

    // Wait for triggers to run (should be fast, but give it a moment)
    await sleep(500);

    const expectedDeltaCents = moneyToCents(deltaUSD);

    let eventId: string | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const { data: events, error: evErr } = await supabase
        .from('cashflow_events')
        .select('id,amount_cents,occurred_at,processed_at,processing_error,source_ref,subject_organization_id')
        .eq('source_type', 'invoice_payment')
        .eq('source_ref', invoice.id)
        .order('occurred_at', { ascending: false })
        .limit(5);

      if (evErr) throw evErr;

      const match = (events || []).find((e: any) => {
        const cents = Number(e.amount_cents);
        const occurred = String(e.occurred_at || '');
        return cents === expectedDeltaCents && occurred >= startTs;
      });

      if (match && match.processed_at && !match.processing_error) {
        eventId = match.id;
        break;
      }

      await sleep(500);
    }

    if (!eventId) {
      throw new Error(
        `Did not observe a processed cashflow_event for this payment delta (expected ${expectedDeltaCents} cents)`,
      );
    }

    console.log(`[invoice-cashflow-it] ✅ cashflow_events row created + processed (event_id=${eventId})`);

    if (includePayouts && created.claimId) {
      const { data: payouts, error: poErr } = await supabase
        .from('cashflow_payouts')
        .select('id,claim_id,amount_cents,paid_cents,status')
        .eq('event_id', eventId);

      if (poErr) throw poErr;

      const p = (payouts || []).find((row: any) => row.claim_id === created.claimId);
      if (!p) throw new Error('Expected a payout for the test claim, but none was created');

      if (String(p.status) !== 'paid' || Number(p.paid_cents) !== Number(p.amount_cents)) {
        throw new Error(`Expected payout to settle as paid, got status=${p.status} paid_cents=${p.paid_cents} amount_cents=${p.amount_cents}`);
      }

      console.log(`[invoice-cashflow-it] ✅ cashflow_payouts row created + settled (payout_id=${p.id})`);
    }

    // Run the audit RPC for a quick sanity snapshot
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // last 5 minutes
    const { data: audit, error: auditErr } = await supabase.rpc('audit_invoice_cashflow_pipeline', {
      p_since: since,
      p_limit: 10,
    });
    if (auditErr) throw auditErr;

    console.log('[invoice-cashflow-it] Audit snapshot (last 5 minutes):');
    console.log(JSON.stringify(audit, null, 2));

    console.log('[invoice-cashflow-it] ✅ PASS');
  } finally {
    // Best-effort cleanup (only safe when we created disposable records)
    // Note: We cannot safely revert a payment delta on a real invoice (it would leave the ledger changed).
    if (created.invoiceId && !env('TEST_INVOICE_ID')) {
      await supabase.from('generated_invoices').delete().eq('id', created.invoiceId);
    }

    if (created.dealId) {
      await supabase.from('cashflow_deals').delete().eq('id', created.dealId);
    }

    if (created.orgId && !env('TEST_INVOICE_ID')) {
      await supabase.from('businesses').delete().eq('id', created.orgId);
    }

    if (created.userId) {
      // Best-effort: delete user-scoped cash rows if these tables exist and are exposed via PostgREST.
      await supabase.from('cash_transactions').delete().eq('user_id', created.userId);
      await supabase.from('user_cash_balances').delete().eq('user_id', created.userId);
      await supabase.auth.admin.deleteUser(created.userId);
    }
  }
}

main().catch((e) => {
  console.error('[invoice-cashflow-it] ❌ FAIL');
  console.error(e?.message || String(e));
  process.exitCode = 1;
});

