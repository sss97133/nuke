import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIGNUP_BONUS = 10000; // $100 in cents

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Get user from auth header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace('Bearer ', '')
  );

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { action, amount } = await req.json();

  try {
    if (action === 'claim_signup_bonus') {
      // Check if user already has a wallet
      const { data: existingWallet } = await supabase
        .from('betting_wallets')
        .select('id, balance')
        .eq('user_id', user.id)
        .single();

      if (existingWallet) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Signup bonus already claimed',
          balance: existingWallet.balance,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Create wallet with signup bonus
      const { data: wallet, error } = await supabase
        .from('betting_wallets')
        .insert({
          user_id: user.id,
          balance: SIGNUP_BONUS,
          total_deposited: SIGNUP_BONUS,
        })
        .select()
        .single();

      if (error) throw error;

      // Record transaction
      await supabase.from('betting_transactions').insert({
        user_id: user.id,
        type: 'deposit',
        amount: SIGNUP_BONUS,
        balance_before: 0,
        balance_after: SIGNUP_BONUS,
        description: 'Signup bonus - $100 free credits',
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Welcome! $100 bonus credited to your account',
        balance: wallet.balance,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'get_wallet') {
      // Get or create wallet
      let { data: wallet } = await supabase
        .from('betting_wallets')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (!wallet) {
        // Auto-create with signup bonus for new users
        const { data: newWallet } = await supabase
          .from('betting_wallets')
          .insert({
            user_id: user.id,
            balance: SIGNUP_BONUS,
            total_deposited: SIGNUP_BONUS,
          })
          .select()
          .single();

        await supabase.from('betting_transactions').insert({
          user_id: user.id,
          type: 'deposit',
          amount: SIGNUP_BONUS,
          balance_before: 0,
          balance_after: SIGNUP_BONUS,
          description: 'Signup bonus - $100 free credits',
        });

        wallet = newWallet;
      }

      // Get active bets
      const { data: activeBets } = await supabase
        .from('bets')
        .select('*, betting_markets(title, status, locks_at)')
        .eq('user_id', user.id)
        .eq('status', 'active');

      // Get recent transactions
      const { data: transactions } = await supabase
        .from('betting_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      return new Response(JSON.stringify({
        wallet,
        active_bets: activeBets || [],
        transactions: transactions || [],
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'add_credits') {
      // For now, just add play credits (would integrate Stripe for real money)
      const addAmount = Math.min(amount || 10000, 100000); // Max $1000 at a time

      // Get current wallet
      const { data: wallet } = await supabase
        .from('betting_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .single();

      if (!wallet) {
        return new Response(JSON.stringify({ error: 'Wallet not found' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const newBalance = wallet.balance + addAmount;

      // Update wallet
      await supabase
        .from('betting_wallets')
        .update({
          balance: newBalance,
          total_deposited: supabase.rpc('increment', { x: addAmount }),
        })
        .eq('user_id', user.id);

      // Record transaction
      await supabase.from('betting_transactions').insert({
        user_id: user.id,
        type: 'deposit',
        amount: addAmount,
        balance_before: wallet.balance,
        balance_after: newBalance,
        description: `Added $${(addAmount / 100).toFixed(2)} play credits`,
      });

      return new Response(JSON.stringify({
        success: true,
        added: addAmount,
        balance: newBalance,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
