-- ═══════════════════════════════════════════════════════════════════════════════
-- FULL SMS ONBOARDING & ENGAGEMENT SYSTEM
-- Phone-first profile building, payments, job offers, dopamine hits
-- ═══════════════════════════════════════════════════════════════════════════════

-- Add profile/onboarding fields to technician_phone_links
ALTER TABLE technician_phone_links
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS location_city TEXT,
  ADD COLUMN IF NOT EXISTS location_state TEXT,
  ADD COLUMN IF NOT EXISTS years_experience INTEGER,
  ADD COLUMN IF NOT EXISTS certifications TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS payment_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT 'start',
  ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS magic_link_token TEXT,
  ADD COLUMN IF NOT EXISTS magic_link_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lifetime_photos INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifetime_jobs INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(2,1),
  ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Job/Contract Offers
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sms_job_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,

  -- Job details
  title TEXT NOT NULL,
  description TEXT,
  vehicle_id UUID REFERENCES vehicles(id),
  shop_id UUID REFERENCES businesses(id),
  offered_by UUID REFERENCES profiles(id),

  -- Compensation
  pay_type TEXT CHECK (pay_type IN ('hourly', 'flat', 'per_photo', 'commission')),
  pay_rate NUMERIC(8,2),
  estimated_hours NUMERIC(5,1),
  estimated_total NUMERIC(10,2),

  -- Schedule
  start_date DATE,
  end_date DATE,
  deadline TIMESTAMPTZ,

  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'in_progress', 'completed', 'cancelled', 'expired')),
  offered_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  response_method TEXT,
  completed_at TIMESTAMPTZ,

  -- Terms
  terms_url TEXT,
  terms_accepted BOOLEAN DEFAULT false,
  terms_accepted_at TIMESTAMPTZ,

  -- Payout tracking
  actual_hours NUMERIC(6,1),
  actual_payout NUMERIC(10,2),
  payout_status TEXT DEFAULT 'pending' CHECK (payout_status IN ('pending', 'approved', 'processing', 'sent', 'received')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_offers_tech ON sms_job_offers(technician_phone_link_id);
CREATE INDEX IF NOT EXISTS idx_job_offers_status ON sms_job_offers(status);
CREATE INDEX IF NOT EXISTS idx_job_offers_shop ON sms_job_offers(shop_id);
CREATE INDEX IF NOT EXISTS idx_job_offers_pending ON sms_job_offers(status, expires_at) WHERE status = 'pending';

COMMENT ON TABLE sms_job_offers IS 'Job offers sent to technicians via SMS';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Payment Notifications - Dopamine tracking
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS payment_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,
  payout_id UUID REFERENCES technician_payout_log(id),

  notification_type TEXT NOT NULL CHECK (notification_type IN (
    'work_logged',      -- Instant: photo received
    'work_approved',    -- Manager approved the work
    'payment_approved', -- Payment batch approved
    'payment_sent',     -- Money sent to their account
    'payment_arriving', -- ETA notification
    'payment_received', -- Confirmed received
    'weekly_summary',   -- Weekly stats
    'milestone'         -- Achievement unlocked
  )),

  amount NUMERIC(10,2),
  message_sent TEXT,
  message_sid TEXT, -- Twilio message ID

  -- Timing for payment notifications
  estimated_arrival TEXT,
  estimated_arrival_at TIMESTAMPTZ,
  actual_arrival_at TIMESTAMPTZ,

  -- Engagement tracking
  opened_link BOOLEAN DEFAULT false,
  responded BOOLEAN DEFAULT false,
  response_text TEXT,

  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_notif_tech ON payment_notifications(technician_phone_link_id);
CREATE INDEX IF NOT EXISTS idx_payment_notif_type ON payment_notifications(notification_type);

COMMENT ON TABLE payment_notifications IS 'Dopamine hit tracking - every positive notification sent';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Milestones & Achievements
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS technician_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,

  milestone_type TEXT NOT NULL,
  milestone_value INTEGER,

  -- Examples:
  -- 'photos_10', 'photos_50', 'photos_100'
  -- 'earned_100', 'earned_500', 'earned_1000'
  -- 'streak_7', 'streak_30' (days in a row)
  -- 'rating_5' (got a 5-star rating)
  -- 'first_job', 'jobs_10'

  achieved_at TIMESTAMPTZ DEFAULT NOW(),
  notified_at TIMESTAMPTZ,

  UNIQUE(technician_phone_link_id, milestone_type)
);

CREATE INDEX IF NOT EXISTS idx_milestones_tech ON technician_milestones(technician_phone_link_id);

COMMENT ON TABLE technician_milestones IS 'Achievement tracking for gamification';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Message Templates - Extended
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO sms_message_templates (template_key, template_text, variables, category, personality) VALUES
-- Profile building
('ask_selfie', E'Want to add a profile pic? Just text me a selfie!', '{}', 'onboarding', 'friendly'),
('selfie_saved', E'Looking good {name}! Profile pic saved. \U0001F4F8', '{name}', 'onboarding', 'friendly'),
('ask_location', E'What city/state are you based in?', '{}', 'onboarding', 'friendly'),
('ask_experience', E'How many years have you been wrenching?', '{}', 'onboarding', 'friendly'),
('ask_specialties', E'What do you specialize in? (body work, paint, mechanical, electrical, etc)', '{}', 'onboarding', 'friendly'),
('ask_payment_handle', E'Almost done! Whats your {method} handle? (like @username or email)', '{method}', 'onboarding', 'friendly'),
('payment_handle_saved', E'Locked in! Payments go to {handle} \U0001F389', '{handle}', 'onboarding', 'friendly'),
('profile_complete', E'You are all set {name}! Send work photos anytime and get paid. \U0001F4AA', '{name}', 'onboarding', 'friendly'),

-- Dopamine hits - Work
('work_received', E'\U0001F4F8 Got it! Processing...', '{}', 'dopamine', 'friendly'),
('work_logged_simple', E'\U00002705 Logged to {vehicle}!', '{vehicle}', 'dopamine', 'friendly'),
('work_logged_full', E'\U00002705 {work_type} on {vehicle} logged! +${value} pending', '{work_type,vehicle,value}', 'dopamine', 'friendly'),
('work_approved', E'\U0001F44D {approver} approved your work on {vehicle}!', '{approver,vehicle}', 'dopamine', 'friendly'),

-- Dopamine hits - Money
('payout_approved', E'\U0001F4B0 ${amount} approved! Sending to {method} now...', '{amount,method}', 'dopamine', 'friendly'),
('payout_sent', E'\U00002705 ${amount} sent to {handle}! Arrives {eta}', '{amount,handle,eta}', 'dopamine', 'friendly'),
('payout_received', E'\U0001F389 ${amount} just landed! Nice work.', '{amount}', 'dopamine', 'friendly'),

-- Summaries
('daily_summary', E'\U0001F4CA Today: {photos} photos, ${earned} earned', '{photos,earned}', 'summary', 'friendly'),
('weekly_summary', E'\U0001F4CA This week: {photos} photos \U00002022 {jobs} jobs \U00002022 ${earned} earned. {streak_msg}', '{photos,jobs,earned,streak_msg}', 'summary', 'friendly'),
('monthly_summary', E'\U0001F3C6 {month} recap: {photos} photos \U00002022 ${earned} total \U00002022 Top work: {top_vehicle}', '{month,photos,earned,top_vehicle}', 'summary', 'friendly'),

-- Milestones
('milestone_photos', E'\U0001F3C6 MILESTONE: {count} photos logged! You are on fire!', '{count}', 'milestone', 'friendly'),
('milestone_earned', E'\U0001F3C6 MILESTONE: ${amount} lifetime earnings! Keep grinding!', '{amount}', 'milestone', 'friendly'),
('milestone_streak', E'\U0001F525 {days} day streak! Consistency pays.', '{days}', 'milestone', 'friendly'),
('milestone_first_job', E'\U0001F389 First job complete! Welcome to the crew.', '{}', 'milestone', 'friendly'),

-- Job offers
('job_offer_simple', E'\U0001F527 Job: {title} - {pay}. YES to accept, NO to pass.', '{title,pay}', 'job', 'friendly'),
('job_offer_full', E'\U0001F527 New job!\n{title} at {shop}\n{pay}\nStart: {start_date}\nReply YES or NO', '{title,shop,pay,start_date}', 'job', 'friendly'),
('job_accepted', E'\U00002705 Locked in! {title} is yours. Details: {url}', '{title,url}', 'job', 'friendly'),
('job_declined', E'No worries. Ill hit you up when something better comes along.', '{}', 'job', 'friendly'),
('job_reminder', E'\U000023F0 Reminder: {title} starts {when}. Ready?', '{title,when}', 'job', 'friendly'),
('job_completed', E'\U0001F389 {title} marked complete! ${payout} coming your way.', '{title,payout}', 'job', 'friendly'),

-- Terms & Auth
('terms_link', E'Before we start, check out the terms: {url} - Reply ACCEPT when ready', '{url}', 'legal', 'friendly'),
('terms_accepted', E'\U00002705 Terms accepted. Lets get to work!', '{}', 'legal', 'friendly'),
('magic_link', E'Tap to log in (15 min): {url}', '{url}', 'auth', 'friendly'),
('verify_code', E'Your code: {code} (5 min)', '{code}', 'auth', 'friendly'),

-- Re-engagement
('nudge_inactive', E'Hey {name}! Been a minute. Got any work to log?', '{name}', 'engagement', 'friendly'),
('nudge_payment_waiting', E'{name}, you have ${amount} waiting! Send a photo to keep it rolling.', '{name,amount}', 'engagement', 'friendly')

ON CONFLICT (template_key) DO UPDATE SET
  template_text = EXCLUDED.template_text,
  variables = EXCLUDED.variables,
  category = EXCLUDED.category;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Functions
-- ═══════════════════════════════════════════════════════════════════════════════

-- Check and award milestones
CREATE OR REPLACE FUNCTION check_technician_milestones(p_tech_id UUID)
RETURNS TABLE(milestone_type TEXT, just_achieved BOOLEAN) AS $$
DECLARE
  v_photos INTEGER;
  v_earned NUMERIC;
  v_jobs INTEGER;
BEGIN
  -- Get current stats
  SELECT photos_submitted, total_earned, lifetime_jobs
  INTO v_photos, v_earned, v_jobs
  FROM technician_phone_links WHERE id = p_tech_id;

  -- Photo milestones
  FOREACH milestone_type IN ARRAY ARRAY['photos_10', 'photos_50', 'photos_100', 'photos_500'] LOOP
    IF v_photos >= CAST(SPLIT_PART(milestone_type, '_', 2) AS INTEGER) THEN
      INSERT INTO technician_milestones (technician_phone_link_id, milestone_type, milestone_value)
      VALUES (p_tech_id, milestone_type, v_photos)
      ON CONFLICT (technician_phone_link_id, milestone_type) DO NOTHING
      RETURNING TRUE INTO just_achieved;
      IF just_achieved THEN RETURN NEXT; END IF;
    END IF;
  END LOOP;

  -- Earning milestones
  FOREACH milestone_type IN ARRAY ARRAY['earned_100', 'earned_500', 'earned_1000', 'earned_5000'] LOOP
    IF v_earned >= CAST(SPLIT_PART(milestone_type, '_', 2) AS INTEGER) THEN
      INSERT INTO technician_milestones (technician_phone_link_id, milestone_type, milestone_value)
      VALUES (p_tech_id, milestone_type, v_earned::INTEGER)
      ON CONFLICT (technician_phone_link_id, milestone_type) DO NOTHING
      RETURNING TRUE INTO just_achieved;
      IF just_achieved THEN RETURN NEXT; END IF;
    END IF;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Generate magic link token
CREATE OR REPLACE FUNCTION generate_magic_link(p_tech_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_token TEXT;
BEGIN
  v_token := encode(gen_random_bytes(32), 'base64');
  v_token := replace(replace(replace(v_token, '+', '-'), '/', '_'), '=', '');

  UPDATE technician_phone_links
  SET magic_link_token = v_token,
      magic_link_expires_at = NOW() + INTERVAL '15 minutes'
  WHERE id = p_tech_id;

  RETURN v_token;
END;
$$ LANGUAGE plpgsql;

-- Verify magic link
CREATE OR REPLACE FUNCTION verify_magic_link(p_token TEXT)
RETURNS UUID AS $$
DECLARE
  v_tech_id UUID;
BEGIN
  SELECT id INTO v_tech_id
  FROM technician_phone_links
  WHERE magic_link_token = p_token
    AND magic_link_expires_at > NOW();

  IF v_tech_id IS NOT NULL THEN
    UPDATE technician_phone_links
    SET magic_link_token = NULL, magic_link_expires_at = NULL
    WHERE id = v_tech_id;
  END IF;

  RETURN v_tech_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Summary
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'SMS FULL ONBOARDING SYSTEM READY';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Tables: sms_job_offers, payment_notifications, technician_milestones';
  RAISE NOTICE 'Functions: check_technician_milestones, generate_magic_link, verify_magic_link';
  RAISE NOTICE 'Templates: ~30 dopamine-optimized messages';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
