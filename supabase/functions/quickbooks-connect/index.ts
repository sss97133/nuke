/**
 * QuickBooks OAuth Integration
 *
 * Handles OAuth flow and data sync with QuickBooks for financial statements.
 * Used to pull financials for SEC filings.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const QUICKBOOKS_CLIENT_ID = Deno.env.get('QUICKBOOKS_CLIENT_ID');
const QUICKBOOKS_CLIENT_SECRET = Deno.env.get('QUICKBOOKS_CLIENT_SECRET');
const QUICKBOOKS_REDIRECT_URI = Deno.env.get('QUICKBOOKS_REDIRECT_URI') || 'https://n-zero.dev/api/quickbooks/callback';
const QUICKBOOKS_ENVIRONMENT = Deno.env.get('QUICKBOOKS_ENVIRONMENT') || 'sandbox'; // 'sandbox' or 'production'

const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const QB_API_BASE = QUICKBOOKS_ENVIRONMENT === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'status';

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
        .eq('legal_name', 'Nuke Ltd');

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
        .eq('legal_name', 'Nuke Ltd')
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
        .eq('legal_name', 'Nuke Ltd')
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
      .eq('legal_name', 'Nuke Ltd')
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
