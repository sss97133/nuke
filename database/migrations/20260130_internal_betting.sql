-- n-zero Internal Betting System
-- Users bet on auction outcomes, platform takes rake

-- ============================================
-- CORE TABLES
-- ============================================

-- Markets (betting opportunities)
CREATE TABLE IF NOT EXISTS betting_markets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What are we betting on?
  market_type text NOT NULL, -- 'auction_over_under', 'weekly_gross', 'make_vs_make', 'record_breaker'
  title text NOT NULL,
  description text,

  -- Link to source data
  vehicle_id uuid REFERENCES vehicles(id), -- For single-auction bets

  -- The line/threshold
  line_value numeric, -- e.g., 150000 for "over/under $150k"
  line_description text, -- e.g., "Over $150,000"

  -- Market status
  status text DEFAULT 'open', -- 'open', 'locked', 'settled', 'cancelled'

  -- Timing
  opens_at timestamptz DEFAULT now(),
  locks_at timestamptz NOT NULL, -- No more bets after this (usually auction end - 1hr)
  settles_at timestamptz, -- When we resolve

  -- Resolution
  outcome text, -- 'yes', 'no', 'push' (tie/cancelled)
  resolution_value numeric, -- Actual value (e.g., final sale price)
  resolution_source text, -- Where we got the data
  resolved_at timestamptz,
  resolved_by uuid, -- Admin who resolved (or 'system')

  -- Pool tracking
  total_yes_amount numeric DEFAULT 0,
  total_no_amount numeric DEFAULT 0,
  total_bettors int DEFAULT 0,

  -- House settings
  rake_percent numeric DEFAULT 5.0, -- Platform fee on winnings
  min_bet numeric DEFAULT 100, -- Minimum bet in cents ($1)
  max_bet numeric DEFAULT 10000, -- Maximum bet in cents ($100)

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Individual bets placed by users
CREATE TABLE IF NOT EXISTS bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,
  market_id uuid REFERENCES betting_markets(id) ON DELETE CASCADE,

  -- The bet
  side text NOT NULL, -- 'yes' or 'no'
  amount numeric NOT NULL, -- In cents

  -- Odds at time of bet (for pari-mutuel, this is pool-based)
  odds_at_placement numeric, -- Decimal odds
  potential_payout numeric, -- What they'd win (before rake)

  -- Status
  status text DEFAULT 'active', -- 'active', 'won', 'lost', 'pushed', 'cancelled'

  -- Settlement
  payout numeric, -- Actual payout after rake (null until settled)
  rake_paid numeric, -- Platform fee paid
  settled_at timestamptz,

  created_at timestamptz DEFAULT now()
);

-- User betting wallet/balance
CREATE TABLE IF NOT EXISTS betting_wallets (
  user_id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,

  balance numeric DEFAULT 0, -- Available to bet (cents)
  total_deposited numeric DEFAULT 0,
  total_withdrawn numeric DEFAULT 0,
  total_wagered numeric DEFAULT 0,
  total_won numeric DEFAULT 0,
  total_rake_paid numeric DEFAULT 0,

  -- Stats
  bets_placed int DEFAULT 0,
  bets_won int DEFAULT 0,
  bets_lost int DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Transaction ledger for wallets
CREATE TABLE IF NOT EXISTS betting_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users ON DELETE CASCADE,

  type text NOT NULL, -- 'deposit', 'withdrawal', 'bet_placed', 'bet_won', 'bet_lost', 'bet_refund', 'rake'
  amount numeric NOT NULL, -- Positive = credit, negative = debit

  -- References
  bet_id uuid REFERENCES bets(id),
  market_id uuid REFERENCES betting_markets(id),

  -- Balance tracking
  balance_before numeric,
  balance_after numeric,

  description text,
  created_at timestamptz DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_betting_markets_status ON betting_markets(status);
CREATE INDEX IF NOT EXISTS idx_betting_markets_vehicle ON betting_markets(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_betting_markets_locks ON betting_markets(locks_at) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_bets_user ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_market ON bets(market_id);
CREATE INDEX IF NOT EXISTS idx_bets_status ON bets(status);

CREATE INDEX IF NOT EXISTS idx_betting_transactions_user ON betting_transactions(user_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Place a bet
CREATE OR REPLACE FUNCTION place_bet(
  p_user_id uuid,
  p_market_id uuid,
  p_side text,
  p_amount numeric
) RETURNS jsonb AS $$
DECLARE
  v_market betting_markets%ROWTYPE;
  v_wallet betting_wallets%ROWTYPE;
  v_bet_id uuid;
  v_potential_payout numeric;
BEGIN
  -- Get market
  SELECT * INTO v_market FROM betting_markets WHERE id = p_market_id FOR UPDATE;

  IF v_market IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market not found');
  END IF;

  IF v_market.status != 'open' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market is not open');
  END IF;

  IF now() > v_market.locks_at THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market is locked');
  END IF;

  IF p_amount < v_market.min_bet THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bet below minimum');
  END IF;

  IF p_amount > v_market.max_bet THEN
    RETURN jsonb_build_object('success', false, 'error', 'Bet above maximum');
  END IF;

  -- Get/create wallet
  INSERT INTO betting_wallets (user_id, balance)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT * INTO v_wallet FROM betting_wallets WHERE user_id = p_user_id FOR UPDATE;

  IF v_wallet.balance < p_amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient balance', 'balance', v_wallet.balance);
  END IF;

  -- Calculate potential payout (simple pari-mutuel)
  -- If you bet YES, you split the NO pool (and vice versa)
  IF p_side = 'yes' THEN
    v_potential_payout := p_amount + (p_amount * v_market.total_no_amount / GREATEST(v_market.total_yes_amount + p_amount, 1));
  ELSE
    v_potential_payout := p_amount + (p_amount * v_market.total_yes_amount / GREATEST(v_market.total_no_amount + p_amount, 1));
  END IF;

  -- Create bet
  INSERT INTO bets (user_id, market_id, side, amount, potential_payout)
  VALUES (p_user_id, p_market_id, p_side, p_amount, v_potential_payout)
  RETURNING id INTO v_bet_id;

  -- Deduct from wallet
  UPDATE betting_wallets
  SET balance = balance - p_amount,
      total_wagered = total_wagered + p_amount,
      bets_placed = bets_placed + 1,
      updated_at = now()
  WHERE user_id = p_user_id;

  -- Record transaction
  INSERT INTO betting_transactions (user_id, type, amount, bet_id, market_id, balance_before, balance_after, description)
  VALUES (p_user_id, 'bet_placed', -p_amount, v_bet_id, p_market_id, v_wallet.balance, v_wallet.balance - p_amount,
          'Bet ' || p_amount || ' on ' || p_side);

  -- Update market pools
  IF p_side = 'yes' THEN
    UPDATE betting_markets SET total_yes_amount = total_yes_amount + p_amount, total_bettors = total_bettors + 1 WHERE id = p_market_id;
  ELSE
    UPDATE betting_markets SET total_no_amount = total_no_amount + p_amount, total_bettors = total_bettors + 1 WHERE id = p_market_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'bet_id', v_bet_id,
    'amount', p_amount,
    'side', p_side,
    'potential_payout', v_potential_payout
  );
END;
$$ LANGUAGE plpgsql;

-- Settle a market
CREATE OR REPLACE FUNCTION settle_market(
  p_market_id uuid,
  p_outcome text, -- 'yes' or 'no'
  p_resolution_value numeric,
  p_resolved_by uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_market betting_markets%ROWTYPE;
  v_bet RECORD;
  v_total_pool numeric;
  v_winning_pool numeric;
  v_payout_ratio numeric;
  v_payout numeric;
  v_rake numeric;
  v_bets_settled int := 0;
BEGIN
  -- Get market
  SELECT * INTO v_market FROM betting_markets WHERE id = p_market_id FOR UPDATE;

  IF v_market IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market not found');
  END IF;

  IF v_market.status = 'settled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Market already settled');
  END IF;

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
$$ LANGUAGE plpgsql;

-- ============================================
-- VIEWS
-- ============================================

-- Open markets with odds
CREATE OR REPLACE VIEW v_open_markets AS
SELECT
  bm.*,
  v.year, v.make, v.model,
  v.source_url as auction_url,
  CASE
    WHEN bm.total_yes_amount + bm.total_no_amount = 0 THEN 50
    ELSE ROUND(100.0 * bm.total_yes_amount / (bm.total_yes_amount + bm.total_no_amount), 1)
  END as implied_yes_prob,
  bm.total_yes_amount + bm.total_no_amount as total_pool
FROM betting_markets bm
LEFT JOIN vehicles v ON v.id = bm.vehicle_id
WHERE bm.status = 'open' AND bm.locks_at > now()
ORDER BY bm.locks_at ASC;

-- User's active bets
CREATE OR REPLACE VIEW v_user_bets AS
SELECT
  b.*,
  bm.title as market_title,
  bm.status as market_status,
  bm.outcome as market_outcome,
  bm.locks_at,
  bm.total_yes_amount + bm.total_no_amount as total_pool
FROM bets b
JOIN betting_markets bm ON bm.id = b.market_id
ORDER BY b.created_at DESC;

-- Leaderboard
CREATE OR REPLACE VIEW v_betting_leaderboard AS
SELECT
  bw.user_id,
  bw.total_won - bw.total_wagered + bw.balance as net_profit,
  bw.bets_won,
  bw.bets_lost,
  CASE WHEN bw.bets_won + bw.bets_lost > 0
    THEN ROUND(100.0 * bw.bets_won / (bw.bets_won + bw.bets_lost), 1)
    ELSE 0
  END as win_rate,
  bw.total_wagered
FROM betting_wallets bw
WHERE bw.bets_placed > 0
ORDER BY net_profit DESC;
