
-- This SQL will create the token_stakes table to support staking functionality
CREATE TABLE IF NOT EXISTS token_stakes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  token_id UUID NOT NULL REFERENCES tokens(id),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  predicted_roi NUMERIC NOT NULL DEFAULT 0,
  actual_roi NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create RLS policies for the token_stakes table
ALTER TABLE token_stakes ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to read only their own stakes
CREATE POLICY "Users can read their own stakes" ON token_stakes
  FOR SELECT USING (auth.uid() = user_id);

-- Policy to allow users to insert their own stakes
CREATE POLICY "Users can insert their own stakes" ON token_stakes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy to allow users to update only their own stakes
CREATE POLICY "Users can update their own stakes" ON token_stakes
  FOR UPDATE USING (auth.uid() = user_id);

-- Add timestamp trigger for updated_at
ALTER TABLE token_stakes ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();
CREATE TRIGGER token_stakes_updated_at
  BEFORE UPDATE ON token_stakes
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();

-- Make sure token_holdings table exists for managing user token balances
CREATE TABLE IF NOT EXISTS token_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  token_id UUID REFERENCES tokens(id),
  balance NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_transaction_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(user_id, token_id)
);

-- Create RLS policies for token_holdings
ALTER TABLE token_holdings ENABLE ROW LEVEL SECURITY;

-- Policy to allow users to read only their own holdings
CREATE POLICY "Users can read their own holdings" ON token_holdings
  FOR SELECT USING (auth.uid() = user_id);

-- Policy to allow users to insert their own holdings
CREATE POLICY "Users can insert their own holdings" ON token_holdings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy to allow users to update only their own holdings
CREATE POLICY "Users can update their own holdings" ON token_holdings
  FOR UPDATE USING (auth.uid() = user_id);

-- Add timestamp trigger for token_holdings updated_at
CREATE TRIGGER token_holdings_updated_at
  BEFORE UPDATE ON token_holdings
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();
