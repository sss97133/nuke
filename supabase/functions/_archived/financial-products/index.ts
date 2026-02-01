/**
 * Financial Products API
 *
 * Manages Insurance, Lending, and Payment products.
 * Ready for partner integration - just plug in API keys.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const productType = url.searchParams.get('type'); // 'insurance', 'lending', 'payments'

    // Get current user
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    if (authHeader) {
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      userId = user?.id || null;
    }

    // ==========================================
    // STATUS - Get all product availability
    // ==========================================
    if (action === 'status') {
      const { data: config } = await supabase
        .from('platform_config')
        .select('config_key, config_value')
        .in('config_key', ['insurance_enabled', 'lending_enabled', 'payments_enabled', 'demo_mode']);

      const configMap: Record<string, any> = {};
      for (const c of config || []) {
        configMap[c.config_key] = c.config_value;
      }

      // Get partner counts
      const { count: insurancePartners } = await supabase
        .from('insurance_partners')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      const { count: lendingPartners } = await supabase
        .from('lending_partners')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      const { count: paymentProcessors } = await supabase
        .from('payment_processors')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      return new Response(JSON.stringify({
        demo_mode: configMap.demo_mode?.enabled ?? true,
        products: {
          insurance: {
            enabled: configMap.insurance_enabled?.enabled ?? false,
            demo_mode: configMap.insurance_enabled?.demo_mode ?? true,
            active_partners: insurancePartners || 0,
            types: ['agreed_value', 'storage', 'transit', 'gap', 'title'],
          },
          lending: {
            enabled: configMap.lending_enabled?.enabled ?? false,
            demo_mode: configMap.lending_enabled?.demo_mode ?? true,
            active_partners: lendingPartners || 0,
            types: ['vehicle_bond', 'restoration_loan', 'inventory_line', 'purchase_finance'],
          },
          payments: {
            enabled: configMap.payments_enabled?.enabled ?? true,
            demo_mode: configMap.payments_enabled?.demo_mode ?? true,
            active_processors: paymentProcessors || 0,
            methods: ['card', 'ach', 'wire'],
          },
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ==========================================
    // INSURANCE - Quote, Bind, Claims
    // ==========================================
    if (productType === 'insurance') {
      if (action === 'quote') {
        const body = await req.json();
        const { vehicle_id, coverage_amount, product_type = 'agreed_value' } = body;

        // Get active insurance partner
        const { data: partner } = await supabase
          .from('insurance_partners')
          .select('*')
          .eq('is_active', true)
          .single();

        if (!partner) {
          return new Response(JSON.stringify({
            error: 'No insurance partner available',
            demo_mode: true,
            message: 'Insurance quotes will be available when a partner is connected',
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Demo quote calculation
        const premium = coverage_amount * 0.015; // 1.5% of coverage
        const deductible = Math.min(coverage_amount * 0.02, 2500);

        const { data: quote, error } = await supabase
          .from('insurance_quotes')
          .insert({
            user_id: userId,
            vehicle_id,
            partner_id: partner.id,
            coverage_amount,
            deductible,
            premium_amount: premium,
            term_months: 12,
            status: 'quoted',
            valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
            quote_data: { product_type, calculated_at: new Date().toISOString() },
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(JSON.stringify({
          success: true,
          quote,
          demo_mode: partner.sandbox_mode,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'list_policies') {
        const { data: policies } = await supabase
          .from('insurance_policies')
          .select('*, insurance_partners(partner_name)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        return new Response(JSON.stringify({ policies: policies || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ==========================================
    // LENDING - Applications, Loans
    // ==========================================
    if (productType === 'lending') {
      if (action === 'estimate') {
        const body = await req.json();
        const { vehicle_value, loan_amount, term_months = 36 } = body;

        const ltv = loan_amount / vehicle_value;
        const baseRate = 0.0899;
        const riskPremium = ltv > 0.6 ? 0.02 : 0;
        const apr = baseRate + riskPremium;

        // Monthly payment calculation (amortization)
        const monthlyRate = apr / 12;
        const payment = loan_amount * (monthlyRate * Math.pow(1 + monthlyRate, term_months)) /
                       (Math.pow(1 + monthlyRate, term_months) - 1);

        return new Response(JSON.stringify({
          estimate: {
            loan_amount,
            vehicle_value,
            ltv_ratio: ltv,
            apr: apr,
            term_months,
            monthly_payment: Math.round(payment * 100) / 100,
            total_interest: Math.round((payment * term_months - loan_amount) * 100) / 100,
            origination_fee: Math.round(loan_amount * 0.02 * 100) / 100,
          },
          demo_mode: true,
          disclaimer: 'This is an estimate. Actual terms depend on credit approval.',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'apply') {
        const body = await req.json();

        const { data: application, error } = await supabase
          .from('loan_applications')
          .insert({
            user_id: userId,
            vehicle_id: body.vehicle_id,
            requested_amount: body.loan_amount,
            requested_term_months: body.term_months,
            purpose: body.purpose || 'purchase',
            vehicle_value: body.vehicle_value,
            ltv_ratio: body.loan_amount / body.vehicle_value,
            status: 'submitted',
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(JSON.stringify({
          success: true,
          application,
          demo_mode: true,
          next_steps: [
            'Application received',
            'Credit check pending (demo)',
            'Vehicle appraisal required',
            'Final approval within 2-3 business days',
          ],
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'list_loans') {
        const { data: loans } = await supabase
          .from('loans')
          .select('*, lending_partners(partner_name)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false });

        return new Response(JSON.stringify({ loans: loans || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ==========================================
    // PAYMENTS - Methods, Transactions
    // ==========================================
    if (productType === 'payments') {
      if (action === 'list_methods') {
        const { data: methods } = await supabase
          .from('user_payment_methods')
          .select('id, method_type, display_name, last_four, card_brand, bank_name, is_default, is_verified')
          .eq('user_id', userId)
          .order('is_default', { ascending: false });

        return new Response(JSON.stringify({ methods: methods || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'add_method') {
        // In production, this would integrate with Stripe/Plaid
        const body = await req.json();

        const { data: method, error } = await supabase
          .from('user_payment_methods')
          .insert({
            user_id: userId,
            method_type: body.method_type,
            display_name: body.display_name,
            last_four: body.last_four,
            card_brand: body.card_brand,
            bank_name: body.bank_name,
            is_verified: false, // Requires verification in production
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(JSON.stringify({
          success: true,
          method,
          demo_mode: true,
          message: 'Payment method added (demo mode - not charged)',
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'list_transactions') {
        const { data: transactions } = await supabase
          .from('payment_transactions')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50);

        return new Response(JSON.stringify({ transactions: transactions || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ==========================================
    // PARTNERS - List available partners
    // ==========================================
    if (action === 'list_partners') {
      const [insurance, lending, payments] = await Promise.all([
        supabase.from('insurance_partners').select('id, partner_name, partner_type, supported_products, is_active, sandbox_mode'),
        supabase.from('lending_partners').select('id, partner_name, partner_type, min_loan_amount, max_loan_amount, base_rate, is_active, sandbox_mode'),
        supabase.from('payment_processors').select('id, processor_name, processor_type, supported_methods, is_active, sandbox_mode'),
      ]);

      return new Response(JSON.stringify({
        partners: {
          insurance: insurance.data || [],
          lending: lending.data || [],
          payments: payments.data || [],
        },
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      error: 'Unknown action',
      available_actions: ['status', 'list_partners', 'quote', 'estimate', 'apply', 'list_policies', 'list_loans', 'list_methods', 'add_method', 'list_transactions'],
      product_types: ['insurance', 'lending', 'payments'],
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
