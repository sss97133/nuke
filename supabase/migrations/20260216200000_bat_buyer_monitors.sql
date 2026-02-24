-- Buyer monitoring system: parallel to bat_seller_monitors
-- Tracks BaT buyer profiles and discovers their auction wins

CREATE TABLE IF NOT EXISTS bat_buyer_monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  buyer_username TEXT NOT NULL,
  buyer_url TEXT,
  is_active BOOLEAN DEFAULT true,
  check_frequency_hours INTEGER DEFAULT 12,
  last_checked_at TIMESTAMPTZ,
  last_win_found_at TIMESTAMPTZ,
  total_wins_found INTEGER DEFAULT 0,
  wins_processed INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(buyer_username)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bat_buyer_monitor_check
  ON bat_buyer_monitors (last_checked_at) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_bat_buyer_monitor_username
  ON bat_buyer_monitors (buyer_username);

-- Updated_at trigger (reuse existing function)
CREATE TRIGGER update_bat_buyer_monitor_updated_at
  BEFORE UPDATE ON bat_buyer_monitors
  FOR EACH ROW EXECUTE FUNCTION update_watchlist_updated_at();

-- Enable RLS
ALTER TABLE bat_buyer_monitors ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role full access on bat_buyer_monitors"
  ON bat_buyer_monitors FOR ALL
  USING (auth.role() = 'service_role');

-- Organization members can view their monitors
CREATE POLICY "Org members can view buyer monitors"
  ON bat_buyer_monitors FOR SELECT
  USING (
    organization_id IS NULL
    OR EXISTS (
      SELECT 1 FROM business_user_roles bur
      WHERE bur.business_id = bat_buyer_monitors.organization_id
        AND bur.user_id = auth.uid()
    )
  );

-- Cron: check buyer monitors every 12 hours
SELECT cron.schedule(
  'bat-buyer-monitor-sweep',
  '30 */12 * * *',
  $$
  SELECT net.http_post(
    url := 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/process-bat-buyer-monitors',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(
        current_setting('app.settings.service_role_key', true),
        current_setting('app.service_role_key', true)
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) AS request_id;
  $$
);

-- Seed: add serialcollector as first monitored buyer
INSERT INTO bat_buyer_monitors (buyer_username, buyer_url, notes)
VALUES ('Serialcollector', 'https://bringatrailer.com/member/serialcollector/', '70+ wins, $7.7M+ spent on BaT')
ON CONFLICT (buyer_username) DO NOTHING;
