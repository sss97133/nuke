-- ============================================================================
-- Betting RLS policies & settle_market push/cancel support
-- ============================================================================
-- RLS is already enabled and basic SELECT policies exist.
-- This migration:
--   1. Makes place_bet and settle_market SECURITY DEFINER so writes work
--      through these functions even without INSERT/UPDATE RLS policies.
--   2. Replaces settle_market to handle p_outcome = 'push' (refund all bets).
-- ============================================================================

-- 1. Make place_bet SECURITY DEFINER
-- First get the current definition and recreate with SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.place_bet(
  p_user_id uuid,
  p_market_id uuid,
  p_side text,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market betting_markets%ROWTYPE;
  v_wallet betting_wallets%ROWTYPE;
  v_bet_id uuid;
  v_total_pool numeric;
  v_side_pool numeric;
  v_odds numeric;
BEGIN
  -- Validate side
  IF p_side NOT IN ('yes', 'no') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Side must be yes or no');
  END IF;

  -- Get market
  SELECT * INTO v_market FROM betting_markets WHERE id = p_market_id FOR UPDATE;

  IF v_market IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market not found');
  END IF;

  IF v_market.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market is not open');
  END IF;

  IF now() >= v_market.locks_at THEN
    -- Auto-lock the market
    UPDATE betting_markets SET status = 'locked', updated_at = now() WHERE id = p_market_id;
    RETURN jsonb_build_object('success', false, 'error', 'Market is locked');
  END IF;

  -- Validate amount
  IF p_amount < v_market.min_bet THEN
    RETURN jsonb_build_object('success', false, 'error', 'Below minimum bet');
  END IF;
  IF p_amount > v_market.max_bet THEN
    RETURN jsonb_build_object('success', false, 'error', 'Exceeds maximum bet');
  END IF;

  -- Get wallet
  SELECT * INTO v_wallet FROM betting_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No wallet found');
  END IF;

  IF v_wallet.balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance');
  END IF;

  -- Calculate odds at time of placement
  v_total_pool := v_market.total_yes_amount + v_market.total_no_amount + p_amount;
  v_side_pool := CASE WHEN p_side = 'yes' THEN v_market.total_yes_amount ELSE v_market.total_no_amount END + p_amount;
  v_odds := CASE WHEN v_side_pool > 0 THEN v_total_pool / v_side_pool ELSE 2 END;

  -- Create bet
  INSERT INTO bets (user_id, market_id, side, amount, odds_at_placement, potential_payout, status)
  VALUES (p_user_id, p_market_id, p_side, p_amount, v_odds, p_amount * v_odds * (1 - v_market.rake_percent / 100), 'active')
  RETURNING id INTO v_bet_id;

  -- Debit wallet
  UPDATE betting_wallets
  SET balance = balance - p_amount,
      total_wagered = COALESCE(total_wagered, 0) + p_amount,
      updated_at = now()
  WHERE user_id = p_user_id;

  -- Record transaction
  INSERT INTO betting_transactions (user_id, type, amount, bet_id, market_id, balance_before, balance_after, description)
  VALUES (p_user_id, 'bet_placed', p_amount, v_bet_id, p_market_id, v_wallet.balance, v_wallet.balance - p_amount, 'Placed bet');

  -- Update market totals
  IF p_side = 'yes' THEN
    UPDATE betting_markets
    SET total_yes_amount = total_yes_amount + p_amount,
        total_bettors = total_bettors + 1,
        updated_at = now()
    WHERE id = p_market_id;
  ELSE
    UPDATE betting_markets
    SET total_no_amount = total_no_amount + p_amount,
        total_bettors = total_bettors + 1,
        updated_at = now()
    WHERE id = p_market_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'bet_id', v_bet_id,
    'odds', v_odds,
    'amount', p_amount
  );
END;
$$;

-- 2. Replace settle_market with push/cancel handling + SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.settle_market(
  p_market_id uuid,
  p_outcome text,
  p_resolution_value numeric,
  p_resolved_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market betting_markets%ROWTYPE;
  v_bet RECORD;
  v_total_pool numeric;
  v_winning_pool numeric;
  v_payout_ratio numeric;
  v_payout numeric;
  v_rake numeric;
  v_bets_settled int := 0;
  v_wallet betting_wallets%ROWTYPE;
BEGIN
  -- Get market
  SELECT * INTO v_market FROM betting_markets WHERE id = p_market_id FOR UPDATE;

  IF v_market IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market not found');
  END IF;

  IF v_market.status = 'settled' OR v_market.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market already settled/cancelled');
  END IF;

  -- ================================================================
  -- PUSH: Refund all bets, cancel market
  -- ================================================================
  IF p_outcome = 'push' THEN
    FOR v_bet IN SELECT * FROM bets WHERE market_id = p_market_id AND status = 'active' LOOP
      -- Mark bet as pushed
      UPDATE bets
      SET status = 'pushed', payout = v_bet.amount, settled_at = now()
      WHERE id = v_bet.id;

      -- Refund wallet
      SELECT * INTO v_wallet FROM betting_wallets WHERE user_id = v_bet.user_id;

      UPDATE betting_wallets
      SET balance = balance + v_bet.amount,
          updated_at = now()
      WHERE user_id = v_bet.user_id;

      -- Record refund transaction
      INSERT INTO betting_transactions (user_id, type, amount, bet_id, market_id, balance_before, balance_after, description)
      VALUES (
        v_bet.user_id, 'bet_refund', v_bet.amount, v_bet.id, p_market_id,
        COALESCE(v_wallet.balance, 0), COALESCE(v_wallet.balance, 0) + v_bet.amount,
        'Market cancelled - bet refunded'
      );

      v_bets_settled := v_bets_settled + 1;
    END LOOP;

    -- Cancel market
    UPDATE betting_markets
    SET status = 'cancelled',
        outcome = 'push',
        resolution_value = p_resolution_value,
        resolved_at = now(),
        resolved_by = p_resolved_by,
        updated_at = now()
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'success', true,
      'outcome', 'push',
      'bets_refunded', v_bets_settled
    );
  END IF;

  -- ================================================================
  -- NORMAL SETTLEMENT: yes or no wins
  -- ================================================================

  -- Calculate pools
  v_total_pool := v_market.total_yes_amount + v_market.total_no_amount;

  IF p_outcome = 'yes' THEN
    v_winning_pool := v_market.total_yes_amount;
  ELSE
    v_winning_pool := v_market.total_no_amount;
  END IF;

  -- Payout ratio (how much winners get per dollar bet)
  IF v_winning_pool > 0 THEN
    v_payout_ratio := v_total_pool / v_winning_pool;
  ELSE
    v_payout_ratio := 1; -- Refund if no winners
  END IF;

  -- Settle each bet
  FOR v_bet IN SELECT * FROM bets WHERE market_id = p_market_id AND status = 'active' LOOP
    IF v_bet.side = p_outcome THEN
      -- Winner
      v_payout := v_bet.amount * v_payout_ratio;
      v_rake := v_payout * (v_market.rake_percent / 100);
      v_payout := v_payout - v_rake;

      UPDATE bets
      SET status = 'won', payout = v_payout, rake_paid = v_rake, settled_at = now()
      WHERE id = v_bet.id;

      -- Credit wallet
      UPDATE betting_wallets
      SET balance = balance + v_payout,
          total_won = total_won + v_payout,
          total_rake_paid = total_rake_paid + v_rake,
          bets_won = bets_won + 1,
          updated_at = now()
      WHERE user_id = v_bet.user_id;

      -- Record transaction
      INSERT INTO betting_transactions (user_id, type, amount, bet_id, market_id, description)
      VALUES (v_bet.user_id, 'bet_won', v_payout, v_bet.id, p_market_id, 'Won bet, payout after rake');

    ELSE
      -- Loser
      UPDATE bets
      SET status = 'lost', payout = 0, settled_at = now()
      WHERE id = v_bet.id;

      UPDATE betting_wallets
      SET bets_lost = bets_lost + 1, updated_at = now()
      WHERE user_id = v_bet.user_id;

      INSERT INTO betting_transactions (user_id, type, amount, bet_id, market_id, description)
      VALUES (v_bet.user_id, 'bet_lost', 0, v_bet.id, p_market_id, 'Lost bet');
    END IF;

    v_bets_settled := v_bets_settled + 1;
  END LOOP;

  -- Update market
  UPDATE betting_markets
  SET status = 'settled',
      outcome = p_outcome,
      resolution_value = p_resolution_value,
      resolved_at = now(),
      resolved_by = p_resolved_by,
      updated_at = now()
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', true,
    'outcome', p_outcome,
    'bets_settled', v_bets_settled,
    'total_pool', v_total_pool,
    'payout_ratio', v_payout_ratio
  );
END;
$$;
