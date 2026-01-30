-- ═══════════════════════════════════════════════════════════════════════════════
-- SMS-BASED TECHNICIAN ONBOARDING SYSTEM
-- For old-school technicians who won't download apps but will text photos for $$$
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- CORE CONCEPT:
-- 1. Technician texts photos to dedicated number
-- 2. AI identifies vehicle, work type, and logs the event
-- 3. Technician gets paid based on documented work
-- 4. Profile builds automatically from photo submissions
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: technician_phone_links
-- Maps phone numbers to user profiles (or creates pre-profiles)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS technician_phone_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number TEXT UNIQUE NOT NULL,  -- E.164 format: +17025551234
  phone_hash TEXT UNIQUE NOT NULL,    -- SHA256 for privacy

  -- Profile linking
  user_id UUID REFERENCES profiles(id),  -- NULL until they create account
  external_identity_id UUID REFERENCES external_identities(id),

  -- Pre-profile data (before they create account)
  display_name TEXT,
  specialties TEXT[] DEFAULT '{}',

  -- Onboarding state
  onboarding_status TEXT DEFAULT 'pending_verification'
    CHECK (onboarding_status IN (
      'pending_verification',  -- Just texted in, need to verify
      'verified',              -- Phone verified via code
      'active',                -- Actively submitting work
      'paused',                -- Temporarily stopped
      'churned'                -- No activity in 30+ days
    )),

  -- Who invited them
  invited_by UUID REFERENCES profiles(id),
  invitation_code TEXT,

  -- Work context
  primary_shop_id UUID REFERENCES businesses(id),  -- Where they mainly work
  assigned_vehicles UUID[] DEFAULT '{}',  -- Vehicles they're currently working on

  -- AI assistant preferences
  reminder_frequency TEXT DEFAULT 'daily'
    CHECK (reminder_frequency IN ('none', 'daily', 'twice_daily', 'per_session')),
  preferred_language TEXT DEFAULT 'en',
  ai_personality TEXT DEFAULT 'friendly',  -- friendly, professional, minimal

  -- Payment tracking
  payment_method TEXT,  -- 'venmo', 'zelle', 'paypal', 'check'
  payment_handle TEXT,  -- @username or email
  pending_payout NUMERIC(10,2) DEFAULT 0,
  total_earned NUMERIC(10,2) DEFAULT 0,

  -- Stats
  photos_submitted INTEGER DEFAULT 0,
  work_sessions_logged INTEGER DEFAULT 0,
  last_submission_at TIMESTAMPTZ,
  last_reminder_sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_tech_phone_hash ON technician_phone_links(phone_hash);
CREATE INDEX idx_tech_phone_status ON technician_phone_links(onboarding_status);
CREATE INDEX idx_tech_phone_invited_by ON technician_phone_links(invited_by);
CREATE INDEX idx_tech_phone_shop ON technician_phone_links(primary_shop_id);

COMMENT ON TABLE technician_phone_links IS 'Links technician phone numbers to profiles for SMS-based work logging';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: sms_work_submissions
-- Each photo/text submission from a technician
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sms_work_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,

  -- Raw message data
  from_phone TEXT NOT NULL,
  message_sid TEXT UNIQUE,  -- Twilio message ID
  message_body TEXT,
  media_urls TEXT[] DEFAULT '{}',
  received_at TIMESTAMPTZ DEFAULT NOW(),

  -- AI processing
  ai_processed_at TIMESTAMPTZ,
  ai_interpretation JSONB,  -- Full AI response
  confidence_score NUMERIC(3,2),  -- 0.00 to 1.00

  -- Extracted data
  detected_vehicle_id UUID REFERENCES vehicles(id),
  detected_vehicle_hints JSONB,  -- Year, make, model, color if no match
  detected_work_type TEXT,  -- 'body_work', 'paint', 'mechanical', etc.
  detected_description TEXT,  -- AI-generated description of work shown

  -- Timeline event creation
  timeline_event_id UUID REFERENCES vehicle_timeline_events(id),
  observation_id UUID REFERENCES vehicle_observations(id),

  -- Payout
  payout_amount NUMERIC(10,2),
  payout_status TEXT DEFAULT 'pending'
    CHECK (payout_status IN ('pending', 'approved', 'paid', 'disputed')),

  -- Status
  processing_status TEXT DEFAULT 'received'
    CHECK (processing_status IN (
      'received',       -- Just came in
      'processing',     -- AI analyzing
      'needs_context',  -- AI needs more info (will ask follow-up)
      'processed',      -- Successfully interpreted
      'logged',         -- Created timeline event
      'failed'          -- Couldn't process
    )),

  -- Follow-up
  follow_up_question TEXT,
  follow_up_response TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_submissions_tech ON sms_work_submissions(technician_phone_link_id);
CREATE INDEX idx_sms_submissions_status ON sms_work_submissions(processing_status);
CREATE INDEX idx_sms_submissions_vehicle ON sms_work_submissions(detected_vehicle_id);
CREATE INDEX idx_sms_submissions_received ON sms_work_submissions(received_at);
CREATE INDEX idx_sms_submissions_payout ON sms_work_submissions(payout_status) WHERE payout_status = 'pending';

COMMENT ON TABLE sms_work_submissions IS 'Individual SMS/MMS submissions from technicians';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: sms_conversations
-- Track conversation state for multi-turn interactions
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,

  -- Conversation state
  state TEXT DEFAULT 'idle'
    CHECK (state IN (
      'idle',                  -- No active conversation
      'awaiting_vehicle',      -- Asked which vehicle
      'awaiting_work_type',    -- Asked what kind of work
      'awaiting_description',  -- Asked for description
      'awaiting_confirmation', -- Confirming interpretation
      'onboarding_name',       -- Getting their name
      'onboarding_payment',    -- Getting payment info
      'onboarding_complete'    -- Just finished onboarding
    )),

  -- Context for current conversation
  context JSONB DEFAULT '{}',

  -- Current vehicle being discussed
  current_vehicle_id UUID REFERENCES vehicles(id),

  -- Message history (last N messages for context)
  recent_messages JSONB DEFAULT '[]',

  -- Timing
  started_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_sms_conv_tech ON sms_conversations(technician_phone_link_id);

COMMENT ON TABLE sms_conversations IS 'Tracks multi-turn SMS conversation state';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: sms_reminders
-- Scheduled reminders to technicians
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sms_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,

  -- Reminder type
  reminder_type TEXT NOT NULL
    CHECK (reminder_type IN (
      'daily_checkin',         -- "Hey, working on anything today?"
      'vehicle_followup',      -- "How's the K10 coming along?"
      'photo_request',         -- "Can you send progress pics?"
      'payment_ready',         -- "You've got $X ready to pay out"
      'onboarding_nudge',      -- "Complete your profile to get paid!"
      'welcome',               -- Initial welcome message
      'verification_code'      -- Phone verification
    )),

  -- Content
  message_template TEXT,
  message_params JSONB DEFAULT '{}',

  -- Related entities
  vehicle_id UUID REFERENCES vehicles(id),

  -- Scheduling
  scheduled_for TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,

  -- Response tracking
  response_received BOOLEAN DEFAULT FALSE,
  response_submission_id UUID REFERENCES sms_work_submissions(id),

  -- Status
  status TEXT DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'sent', 'delivered', 'failed', 'cancelled')),

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_reminders_tech ON sms_reminders(technician_phone_link_id);
CREATE INDEX idx_sms_reminders_scheduled ON sms_reminders(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX idx_sms_reminders_pending ON sms_reminders(status) WHERE status = 'scheduled';

COMMENT ON TABLE sms_reminders IS 'Scheduled SMS reminders to technicians';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: technician_payout_log
-- Payment history for technicians
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS technician_payout_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,

  -- Payout details
  amount NUMERIC(10,2) NOT NULL,
  payment_method TEXT NOT NULL,
  payment_handle TEXT,

  -- What's being paid for
  submission_ids UUID[] DEFAULT '{}',
  work_summary TEXT,  -- AI-generated summary of work paid for

  -- Transaction
  transaction_ref TEXT,  -- External payment reference
  initiated_by UUID REFERENCES profiles(id),  -- Who approved/initiated

  -- Status
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

  initiated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  notes TEXT
);

CREATE INDEX idx_payout_tech ON technician_payout_log(technician_phone_link_id);
CREATE INDEX idx_payout_status ON technician_payout_log(status);

COMMENT ON TABLE technician_payout_log IS 'Payment history for SMS-based technicians';

-- ═══════════════════════════════════════════════════════════════════════════════
-- TABLE: vehicle_tech_assignments
-- Which vehicles each technician is assigned to work on
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS vehicle_tech_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) NOT NULL,
  technician_phone_link_id UUID REFERENCES technician_phone_links(id) NOT NULL,

  -- Assignment details
  assigned_by UUID REFERENCES profiles(id),
  work_types TEXT[] DEFAULT '{}',  -- What they're assigned to do
  estimated_hours NUMERIC(5,1),
  hourly_rate NUMERIC(6,2),
  flat_rate NUMERIC(8,2),

  -- Status
  status TEXT DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),

  -- Progress
  photos_received INTEGER DEFAULT 0,
  hours_logged NUMERIC(6,1) DEFAULT 0,

  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  UNIQUE(vehicle_id, technician_phone_link_id)
);

CREATE INDEX idx_tech_assign_vehicle ON vehicle_tech_assignments(vehicle_id);
CREATE INDEX idx_tech_assign_tech ON vehicle_tech_assignments(technician_phone_link_id);
CREATE INDEX idx_tech_assign_active ON vehicle_tech_assignments(status) WHERE status = 'active';

COMMENT ON TABLE vehicle_tech_assignments IS 'Vehicle-to-technician work assignments';

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTION: hash_phone_number
-- Consistent phone hashing for privacy
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION hash_phone_number(phone TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN encode(sha256(phone::bytea), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTION: create_or_get_technician_link
-- Upserts a phone number and returns the link record
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_or_get_technician_link(
  p_phone_number TEXT,
  p_invited_by UUID DEFAULT NULL,
  p_shop_id UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_phone_hash TEXT;
  v_link_id UUID;
BEGIN
  v_phone_hash := hash_phone_number(p_phone_number);

  INSERT INTO technician_phone_links (
    phone_number,
    phone_hash,
    invited_by,
    primary_shop_id,
    onboarding_status
  ) VALUES (
    p_phone_number,
    v_phone_hash,
    p_invited_by,
    p_shop_id,
    'pending_verification'
  )
  ON CONFLICT (phone_hash) DO UPDATE SET
    updated_at = NOW()
  RETURNING id INTO v_link_id;

  RETURN v_link_id;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- VIEW: technician_leaderboard
-- Gamification: show who's submitting the most work
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW technician_leaderboard AS
SELECT
  tpl.id,
  tpl.display_name,
  COALESCE(p.display_name, tpl.display_name, 'Anonymous Tech') as name,
  tpl.photos_submitted,
  tpl.work_sessions_logged,
  tpl.total_earned,
  tpl.primary_shop_id,
  b.business_name as shop_name,
  tpl.specialties,
  tpl.last_submission_at,
  CASE
    WHEN tpl.last_submission_at > NOW() - INTERVAL '1 day' THEN 'hot'
    WHEN tpl.last_submission_at > NOW() - INTERVAL '7 days' THEN 'active'
    WHEN tpl.last_submission_at > NOW() - INTERVAL '30 days' THEN 'cooling'
    ELSE 'dormant'
  END as activity_status,
  -- Streak calculation
  (
    SELECT COUNT(DISTINCT DATE(received_at))
    FROM sms_work_submissions sws
    WHERE sws.technician_phone_link_id = tpl.id
    AND sws.received_at > NOW() - INTERVAL '30 days'
  ) as days_active_last_30
FROM technician_phone_links tpl
LEFT JOIN profiles p ON p.id = tpl.user_id
LEFT JOIN businesses b ON b.id = tpl.primary_shop_id
WHERE tpl.onboarding_status IN ('verified', 'active')
ORDER BY tpl.photos_submitted DESC;

COMMENT ON VIEW technician_leaderboard IS 'Ranked technicians by activity for gamification';

-- ═══════════════════════════════════════════════════════════════════════════════
-- MESSAGE TEMPLATES (for AI assistant)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sms_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT UNIQUE NOT NULL,
  template_text TEXT NOT NULL,
  variables TEXT[] DEFAULT '{}',  -- Placeholder variables like {name}, {vehicle}
  category TEXT,
  language TEXT DEFAULT 'en',
  personality TEXT DEFAULT 'friendly',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default templates
INSERT INTO sms_message_templates (template_key, template_text, variables, category, personality) VALUES
-- Onboarding
('welcome', 'Hey! Welcome to Nuke. Send me photos of your work and I''ll log it automatically. What should I call you?', '{}', 'onboarding', 'friendly'),
('onboarding_payment', 'Got it, {name}! How do you want to get paid? (venmo/zelle/paypal)', '{name}', 'onboarding', 'friendly'),
('onboarding_complete', 'You''re all set, {name}! Just text me photos when you''re working and I''ll handle the rest. 📸', '{name}', 'onboarding', 'friendly'),

-- Daily reminders
('daily_checkin', 'Hey {name}, working on anything today? Send me a pic!', '{name}', 'reminder', 'friendly'),
('vehicle_followup', 'How''s the {vehicle} coming along? Would love to see some progress pics!', '{name,vehicle}', 'reminder', 'friendly'),

-- Work logging
('photo_received', 'Got it! Looks like {work_type} on {vehicle}. Adding to the timeline. 👍', '{work_type,vehicle}', 'confirmation', 'friendly'),
('need_vehicle_context', 'Nice work! Which vehicle is this on? (Reply with year/make/model or just the name)', '{}', 'clarification', 'friendly'),
('need_work_context', 'Cool pic! What kind of work is this? (bodywork, paint, mechanical, etc)', '{}', 'clarification', 'friendly'),

-- Payment
('payment_ready', 'Hey {name}! You''ve got ${amount} ready for payout. Want me to send it to your {payment_method}?', '{name,amount,payment_method}', 'payment', 'friendly'),
('payment_sent', 'Done! ${amount} sent to {payment_handle}. Keep up the great work! 💪', '{amount,payment_handle}', 'payment', 'friendly'),

-- Professional variants
('welcome_pro', 'Welcome to Nuke. Please reply with your name to begin logging work.', '{}', 'onboarding', 'professional'),
('photo_received_pro', 'Logged: {work_type} on {vehicle}.', '{work_type,vehicle}', 'confirmation', 'professional')
ON CONFLICT (template_key) DO NOTHING;

COMMENT ON TABLE sms_message_templates IS 'Message templates for SMS AI assistant';

-- ═══════════════════════════════════════════════════════════════════════════════
-- SUMMARY
-- ═══════════════════════════════════════════════════════════════════════════════

-- Tables created:
-- 1. technician_phone_links - Maps phones to profiles
-- 2. sms_work_submissions - Individual photo submissions
-- 3. sms_conversations - Multi-turn conversation state
-- 4. sms_reminders - Scheduled nudges
-- 5. technician_payout_log - Payment history
-- 6. vehicle_tech_assignments - Who's working on what
-- 7. sms_message_templates - AI response templates

-- The flow:
-- 1. You invite technician: text them or give them the number
-- 2. They text "Hey" or send a photo
-- 3. AI onboards them (name, payment method)
-- 4. When they send work photos:
--    a. AI identifies vehicle (or asks)
--    b. AI identifies work type (or asks)
--    c. Creates timeline event
--    d. Tracks toward payout
-- 5. When payout threshold hit, you approve and pay them
-- 6. Their profile builds automatically from all submissions

