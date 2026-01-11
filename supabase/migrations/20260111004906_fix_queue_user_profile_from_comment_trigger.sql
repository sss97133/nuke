-- Fix: auction_comments inserts were failing because queue_user_profile_from_comment()
-- referenced NEW.bat_username / NEW.platform, which do not exist on auction_comments.
--
-- Symptom: extract-auction-comments returns 500 and auction_comments stops updating.
-- Root error (Postgres): 42703 record "new" has no field "bat_username"
--
-- This patch makes the trigger function resilient across tables by using JSON access
-- (missing columns become NULL instead of throwing), and normalizes 'bringatrailer' -> 'bat'.

CREATE OR REPLACE FUNCTION public.queue_user_profile_from_comment()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_profile_url TEXT;
  v_platform TEXT;
  v_username TEXT;
BEGIN
  -- Safely extract username from either:
  -- - auction_comments.author_username
  -- - bat_comments.bat_username
  v_username := NULLIF(to_jsonb(NEW)->>'author_username', '');
  IF v_username IS NULL THEN
    v_username := NULLIF(to_jsonb(NEW)->>'bat_username', '');
  END IF;

  -- Safely extract platform (auction_comments has it; bat_comments does not)
  v_platform := NULLIF(to_jsonb(NEW)->>'platform', '');
  v_platform := COALESCE(v_platform, 'bat');

  -- Normalize known aliases
  IF v_platform = 'bringatrailer' THEN
    v_platform := 'bat';
  END IF;

  -- Skip if we still don't have a username
  IF v_username IS NULL OR v_username = '' THEN
    RETURN NEW;
  END IF;

  -- Build profile URL based on platform
  CASE v_platform
    WHEN 'bat' THEN
      v_profile_url := 'https://bringatrailer.com/member/' || encode_uri_component(v_username) || '/';
    WHEN 'cars_and_bids' THEN
      v_profile_url := 'https://carsandbids.com/users/' || encode_uri_component(v_username);
    WHEN 'pcarmarket' THEN
      v_profile_url := 'https://www.pcarmarket.com/author/' || encode_uri_component(v_username) || '/';
    ELSE
      -- Unknown platform, skip
      RETURN NEW;
  END CASE;

  -- Queue the profile URL (idempotent - won't duplicate pending entries)
  INSERT INTO public.user_profile_queue (
    profile_url,
    platform,
    username,
    external_identity_id,
    discovered_via,
    source_vehicle_id,
    source_comment_id,
    priority
  )
  VALUES (
    v_profile_url,
    v_platform,
    v_username,
    NEW.external_identity_id,
    'comment',
    NEW.vehicle_id,
    NEW.id,
    50
  )
  ON CONFLICT (profile_url, platform)
  WHERE status = 'pending'
  DO NOTHING;

  RETURN NEW;
END;
$function$;

