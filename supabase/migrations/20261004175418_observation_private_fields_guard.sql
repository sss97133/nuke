-- Extend the existing privacy marking after an owner-reported public observation
-- exposed a person's name in prose beside total_paid / balance_remaining.
-- Those two financial keys were missing from the owner-only rule. Name-key
-- spellings also need case-insensitive snake_case / camelCase recognition.
-- No testimony, policies, grants, owner access or service-role access is changed.
SET statement_timeout = '60s';
SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.observation_is_public(p_kind public.observation_kind, p_data jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT p_kind IN ('listing', 'sale_result', 'comment', 'bid', 'specification', 'condition', 'media', 'splice')
     AND COALESCE(p_data::text, '') !~* ('"(invoice_number|line_items|subtotal|tax|total_amount|receipt_id|file_url'
                                         '|receipt_type|vendor_address|client_billing|billing|billed_usd|paid_usd|cost_usd'
                                         '|price_usd|amount_usd|payment_method|payment|payments|amount_paid|balance_due'
                                         '|order_number|order_contents|order|client|correct_owner|prior_owner_id'
                                         '|correct_owner_discovered_person_id|customer_name|client_name|email|phone'
                                         '|total_?paid|balance_?remaining|full_?name|first_?name|last_?name'
                                         '|given_?name|family_?name|legal_?name|buyer_?name|seller_?name'
                                         '|owner_?name|person_?name|technician_?name|participant_?name|contact_?name)"\s*:')
     AND NOT (p_kind IN ('condition', 'media') AND COALESCE(p_data::text, '') ~* '(invoice|receipt|\$\s?[0-9])');
$$;

COMMENT ON FUNCTION public.observation_is_public(public.observation_kind, jsonb) IS
  'Public observation eligibility for a public vehicle: existing permitted kinds, excluding money/receipt/person JSON keys at any depth. Includes total_paid, balance_remaining and explicit personal-name keys; matching is case-insensitive and added keys accept snake_case/camelCase. This is row withholding, not prose redaction or name-publication consent. Free-text names without marked JSON remain unclassified; evidence pages withhold unreviewed prose/artifacts separately. Vehicle user/owner/uploader and service-role access remain governed by existing policies. 2026-10-04.';
