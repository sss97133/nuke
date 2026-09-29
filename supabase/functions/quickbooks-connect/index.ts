/**
 * QuickBooks OAuth Integration
 *
 * Handles OAuth flow and data sync with QuickBooks for financial statements.
 * Used to pull financials for SEC filings.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { authenticateWriter, requireWriteAuth } from '../_shared/writeGuard.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QUICKBOOKS_CLIENT_ID = Deno.env.get('QUICKBOOKS_CLIENT_ID');
const QUICKBOOKS_CLIENT_SECRET = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
const QUICKBOOKS_REDIRECT_URI = Deno.env.get('QUICKBOOKS_REDIRECT_URI') || 'https://nuke.ag/api/quickbooks/callback';
const QUICKBOOKS_ENVIRONMENT = Deno.env.get('QUICKBOOKS_ENVIRONMENT') || 'sandbox'; // 'sandbox' or 'production'

const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API_BASE = QUICKBOOKS_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // The connected QuickBooks company is the owner's own books, and "signed in" means anyone (sign-up is
  // open and auto-confirmed). So past the write guard, only the service key or the company owner's own
  // sign-in may call any action (financials, company_info, pull_transactions, the OAuth steps). 2026-09-29.
  const verdict = await authenticateWriter(req);
  if (!verdict.ok || verdict.caller.kind !== 'service_role') {
    const callerId = verdict.ok && (verdict.caller.kind === 'user' || verdict.caller.kind === 'api_key')
      ? verdict.caller.userId
      : null;
    const { data: owner } = await supabase
      .from('parent_company')
      .select('owner_user_id')
      .eq('legal_name', 'NUKE LTD')
      .maybeSingle();
    if (!callerId || !owner?.owner_user_id || callerId !== owner.owner_user_id) {
      return new Response(JSON.stringify({ error: 'forbidden', reason: 'owner only' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'status';

    // Action: pull posted transactions (Purchase + Deposit) into qb_transactions (2026-09-28).
    // The old loader read a one-time export file, so the books stopped at 2026-04-02. Raw lines only:
    // no vendor-category attribution (receipts:reconcile asks who paid and what for). Ids match the
    // export's scheme ("purchase-<Id>-<n>"), so re-pulling an overlapping range updates, never duplicates.
    // Bank-feed items still "For review" in QuickBooks are not visible to the API until accepted.
    if (action === 'pull_transactions') {
      const since = url.searchParams.get('since') || '2026-04-01';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('since must be YYYY-MM-DD');
      const { data: company, error: cErr } = await supabase
        .from('parent_company').select('*').not('quickbooks_realm_id', 'is', null).limit(1).single();
      if (cErr || !company) throw new Error('QuickBooks not connected');
      let accessToken = company.quickbooks_access_token;
      if (new Date(company.quickbooks_token_expires_at) < new Date()) accessToken = await refreshToken(supabase, company);
      const realmId = company.quickbooks_realm_id;

      const rows: any[] = [];
      const counts: Record<string, number> = {};
      for (const entity of ['Purchase', 'Deposit']) {
        let start = 1;
        counts[entity] = 0;
        for (let page = 0; page < 200; page++) {
          const q = `select * from ${entity} where TxnDate >= '${since}' startposition ${start} maxresults 500`;
          const res = await fetch(`${QB_API_BASE}/v3/company/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=70`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
          });
          if (!res.ok) throw new Error(`${entity} query HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
          const body = await res.json();
          const txns: any[] = body?.QueryResponse?.[entity] || [];
          counts[entity] += txns.length;
          for (const t of txns) {
            const lines = (t.Line || []).filter((l: any) => typeof l.Amount === 'number' && l.DetailType !== 'SubTotalLineDetail');
            lines.forEach((l: any, i: number) => {
              if (entity === 'Purchase') {
                const sign = t.Credit === true ? -1 : 1;
                rows.push({
                  qb_id: `purchase-${t.Id}-${i + 1}`, qb_type: 'Purchase', date: t.TxnDate,
                  vendor_name: t.EntityRef?.name ?? null, total_amount: sign * Number(t.TotalAmt ?? 0),
                  line_description: l.Description ?? null, line_amount: sign * Number(l.Amount),
                  line_account_name: l.AccountBasedExpenseLineDetail?.AccountRef?.name ?? l.ItemBasedExpenseLineDetail?.ItemRef?.name ?? null,
                  memo: t.PrivateNote ?? null, doc_number: t.DocNumber ?? null, payment_type: t.PaymentType ?? null,
                  payment_account: t.AccountRef?.name ?? null, updated_at: new Date().toISOString(),
                });
              } else {
                const d = l.DepositLineDetail || {};
                rows.push({
                  qb_id: `deposit-${t.Id}-${i + 1}`, qb_type: 'Deposit', date: t.TxnDate,
                  vendor_name: d.Entity?.name ?? null, total_amount: Number(t.TotalAmt ?? 0),
                  line_description: l.Description ?? null, line_amount: Number(l.Amount),
                  line_account_name: d.AccountRef?.name ?? null, memo: t.PrivateNote ?? null,
                  doc_number: t.DocNumber ?? null, payment_type: d.PaymentMethodRef?.name ?? null,
                  payment_account: t.DepositToAccountRef?.name ?? null, updated_at: new Date().toISOString(),
                });
              }
            });
          }
          if (txns.length < 500) break;
          start += 500;
        }
      }
      let upserted = 0;
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabase.from('qb_transactions').upsert(rows.slice(i, i + 200), { onConflict: 'qb_id' });
        if (error) throw new Error(`upsert failed at ${i}: ${error.message}`);
        upserted += Math.min(200, rows.length - i);
      }
      const dates = rows.map((r) => r.date).sort();
      return new Response(JSON.stringify({ success: true, since, transactions: counts, lines: rows.length, upserted,
        first_date: dates[0] ?? null, last_date: dates[dates.length - 1] ?? null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Get OAuth URL to start connection
    if (action === 'auth_url') {
      const state = crypto.randomUUID();
      const scope = 'com.intuit.quickbooks.accounting';

      const authUrl = `${QB_AUTH_URL}?` + new URLSearchParams({
        client_id: QUICKBOOKS_CLIENT_ID || '',
        redirect_uri: QUICKBOOKS_REDIRECT_URI,
        response_type: 'code',
        scope,
        state,
      }).toString();

      return new Response(JSON.stringify({
        auth_url: authUrl,
        state,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Handle OAuth callback
    if (action === 'callback') {
      const code = url.searchParams.get('code');
      const realmId = url.searchParams.get('realmId');

      if (!code || !realmId) {
        throw new Error('Missing code or realmId');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(QB_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${btoa(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: QUICKBOOKS_REDIRECT_URI,
        }),
      });

      const tokens = await tokenResponse.json();

      if (tokens.error) {
        throw new Error(tokens.error_description || tokens.error);
      }

      // Store tokens
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

      await supabase
        .from('parent_company')
        .update({
          quickbooks_realm_id: realmId,
          quickbooks_access_token: tokens.access_token,
          quickbooks_refresh_token: tokens.refresh_token,
          quickbooks_token_expires_at: expiresAt.toISOString(),
          quickbooks_connected_at: new Date().toISOString(),
        })
        .eq('legal_name', 'NUKE LTD');

      return new Response(JSON.stringify({
        success: true,
        message: 'QuickBooks connected successfully',
        realm_id: realmId,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Get financial reports
    if (action === 'financials') {
      const { data: company } = await supabase
        .from('parent_company')
        .select('*')
        .eq('legal_name', 'NUKE LTD')
        .single();

      if (!company?.quickbooks_access_token) {
        throw new Error('QuickBooks not connected');
      }

      // Check if token needs refresh
      let accessToken = company.quickbooks_access_token;
      if (new Date(company.quickbooks_token_expires_at) < new Date()) {
        accessToken = await refreshToken(supabase, company);
      }

      const realmId = company.quickbooks_realm_id;

      // Fetch Balance Sheet
      const balanceSheet = await fetchReport(accessToken, realmId, 'BalanceSheet');

      // Fetch Profit & Loss
      const profitLoss = await fetchReport(accessToken, realmId, 'ProfitAndLoss');

      // Fetch Cash Flow
      const cashFlow = await fetchReport(accessToken, realmId, 'CashFlow');

      return new Response(JSON.stringify({
        success: true,
        reports: {
          balance_sheet: balanceSheet,
          profit_and_loss: profitLoss,
          cash_flow: cashFlow,
        },
        generated_at: new Date().toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: Get company info from QuickBooks
    if (action === 'company_info') {
      const { data: company } = await supabase
        .from('parent_company')
        .select('*')
        .eq('legal_name', 'NUKE LTD')
        .single();

      if (!company?.quickbooks_access_token) {
        throw new Error('QuickBooks not connected');
      }

      let accessToken = company.quickbooks_access_token;
      if (new Date(company.quickbooks_token_expires_at) < new Date()) {
        accessToken = await refreshToken(supabase, company);
      }

      const response = await fetch(
        `${QB_API_BASE}/v3/company/${company.quickbooks_realm_id}/companyinfo/${company.quickbooks_realm_id}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
          },
        }
      );

      const data = await response.json();

      return new Response(JSON.stringify({
        success: true,
        company_info: data.CompanyInfo,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Default: Return connection status
    const { data: company } = await supabase
      .from('parent_company')
      .select('legal_name, quickbooks_realm_id, quickbooks_connected_at, quickbooks_token_expires_at')
      .eq('legal_name', 'NUKE LTD')
      .single();

    return new Response(JSON.stringify({
      connected: !!company?.quickbooks_realm_id,
      company: company?.legal_name,
      connected_at: company?.quickbooks_connected_at,
      token_expires: company?.quickbooks_token_expires_at,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message,
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function refreshToken(supabase: any, company: any): Promise<string> {
  const response = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: company.quickbooks_refresh_token,
    }),
  });

  const tokens = await response.json();

  if (tokens.error) {
    throw new Error('Failed to refresh token: ' + tokens.error);
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await supabase
    .from('parent_company')
    .update({
      quickbooks_access_token: tokens.access_token,
      quickbooks_refresh_token: tokens.refresh_token,
      quickbooks_token_expires_at: expiresAt.toISOString(),
    })
    .eq('id', company.id);

  return tokens.access_token;
}

async function fetchReport(accessToken: string, realmId: string, reportName: string): Promise<any> {
  const response = await fetch(
    `${QB_API_BASE}/v3/company/${realmId}/reports/${reportName}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    }
  );

  const data = await response.json();
  return data;
}
