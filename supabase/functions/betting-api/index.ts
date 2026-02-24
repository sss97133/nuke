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
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const url = new URL(req.url);
  const path = url.pathname.replace('/betting-api', '');

  try {
    // GET /markets - list open markets
    if (req.method === 'GET' && path === '/markets') {
      const { data: markets } = await supabase
        .from('v_open_markets')
        .select('*')
        .order('locks_at', { ascending: true });

      return new Response(JSON.stringify({ markets: markets || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET /markets/:id - get single market with bet breakdown
    if (req.method === 'GET' && path.startsWith('/markets/')) {
      const marketId = path.split('/')[2];

      const { data: market } = await supabase
        .from('betting_markets')
        .select('*')
        .eq('id', marketId)
        .single();

      if (!market) {
        return new Response(JSON.stringify({ error: 'Market not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Get bet distribution
      const { data: bets } = await supabase
        .from('bets')
        .select('side, amount, user_id')
        .eq('market_id', marketId)
        .eq('status', 'active');

      const yesPool = bets?.filter(b => b.side === 'yes').reduce((s, b) => s + b.amount, 0) || 0;
      const noPool = bets?.filter(b => b.side === 'no').reduce((s, b) => s + b.amount, 0) || 0;
      const totalPool = yesPool + noPool;

      // Calculate odds
      const yesOdds = totalPool > 0 ? totalPool / (yesPool || 1) : 2;
      const noOdds = totalPool > 0 ? totalPool / (noPool || 1) : 2;

      return new Response(JSON.stringify({
        market,
        pools: { yes: yesPool, no: noPool, total: totalPool },
        odds: { yes: yesOdds, no: noOdds },
        bettors: bets?.length || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /bet - place a bet
    if (req.method === 'POST' && path === '/bet') {
      const { user_id, market_id, side, amount } = await req.json();

      if (!user_id || !market_id || !side || !amount) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data, error } = await supabase.rpc('place_bet', {
        p_user_id: user_id,
        p_market_id: market_id,
        p_side: side,
        p_amount: amount,
      });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /wallet/deposit - add funds (demo/test)
    if (req.method === 'POST' && path === '/wallet/deposit') {
      const { user_id, amount } = await req.json();

      // Upsert wallet
      await supabase.from('betting_wallets').upsert({
        user_id,
        balance: amount,
        total_deposited: amount,
      }, { onConflict: 'user_id' });

      // Update existing balance
      const { data: wallet } = await supabase
        .from('betting_wallets')
        .select('balance')
        .eq('user_id', user_id)
        .single();

      await supabase.from('betting_wallets')
        .update({
          balance: (wallet?.balance || 0) + amount,
          total_deposited: (wallet?.balance || 0) + amount,
        })
        .eq('user_id', user_id);

      // Record transaction
      await supabase.from('betting_transactions').insert({
        user_id,
        type: 'deposit',
        amount,
        description: `Demo deposit of $${(amount / 100).toFixed(2)}`,
      });

      return new Response(JSON.stringify({ success: true, deposited: amount }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET /wallet/:user_id - get wallet balance
    if (req.method === 'GET' && path.startsWith('/wallet/')) {
      const userId = path.split('/')[2];

      const { data: wallet } = await supabase
        .from('betting_wallets')
        .select('*')
        .eq('user_id', userId)
        .single();

      const { data: activeBets } = await supabase
        .from('bets')
        .select('*, betting_markets(title, status, locks_at)')
        .eq('user_id', userId)
        .eq('status', 'active');

      return new Response(JSON.stringify({
        wallet: wallet || { balance: 0 },
        active_bets: activeBets || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // GET /leaderboard - top bettors
    if (req.method === 'GET' && path === '/leaderboard') {
      const { data: leaders } = await supabase
        .from('v_betting_leaderboard')
        .select('*')
        .limit(20);

      return new Response(JSON.stringify({ leaderboard: leaders || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /settle - settle a market (admin only)
    if (req.method === 'POST' && path === '/settle') {
      const { market_id, outcome, resolution_value } = await req.json();

      const { data, error } = await supabase.rpc('settle_market', {
        p_market_id: market_id,
        p_outcome: outcome,
        p_resolution_value: resolution_value,
      });

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // POST /markets/create - create a new market
    if (req.method === 'POST' && path === '/markets/create') {
      const body = await req.json();

      const { data: market, error } = await supabase
        .from('betting_markets')
        .insert({
          market_type: body.market_type || 'auction_over_under',
          title: body.title,
          description: body.description,
          line_value: body.line_value,
          line_description: body.line_description,
          locks_at: body.locks_at,
          min_bet: body.min_bet || 100,
          max_bet: body.max_bet || 10000,
          rake_percent: body.rake_percent || 5,
        })
        .select()
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ market }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not found', path }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
