-- Describe publishing_contacts: the 38 columns with no COMMENT ON COLUMN (0 of 38 described before, v_schema_atlas on
-- prod, 2026-10-10 08:30Z) and a table comment (it had none). Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself").
--
-- METHOD (read 2026-10-10 08:31-08:34Z UTC):
--   Columns, defaults, constraints, indexes, policies and grants from information_schema, pg_constraint, pg_indexes and
--   pg_policy; fill, ranges and categorical counts counted on the whole table (17,006 rows); JSONB key sets by
--   jsonb_object_keys. No column value is quoted here: the table holds people's names and addresses.
--   Writers from code at origin/main 483775947: tools/publishing/publishing_migration.py (the CREATE TABLE, run by
--   hand; there is no file for it in supabase/migrations), tools/publishing/ingest_publishing_data.py (ingest_contacts:
--   one INSERT pass from the local SQLite table person_profiles in an email-archive database, skipped when the owner
--   already has rows), and the local scorers that filled person_profiles before the copy:
--   tools/publishing/universal_email_extraction.py (counts, first/last seen, active months, phase, warmth,
--   trajectory, language), tools/publishing/compute_reliability.py (reliability, ghost status and risk, iMessage
--   match, cross-channel), tools/publishing/compute_role_spectrum.py (role_spectrum).
--   Readers: none in supabase/functions or nuke_frontend names the table (grep at 483775947).
--   nuke_frontend/src/pages/publishing/PersonProfile.tsx shows the same field names, served by
--   tools/publishing/serve_data.py from the local SQLite file, not from this table.
-- LIMITS:
--   One hand load: every row was created between 2026-04-14 00:28:56Z and 00:29:51Z and none was updated after.
--   The scores are the local scripts' outputs as of their run (their "today" is 2026-04-08 in
--   universal_email_extraction.py), frozen at the copy; nothing recomputes them. The code that set years_active,
--   credit_count, credit_roles, publications_worked, primary_publication, professional_title, org_name and org_role in
--   person_profiles is not in this repo (no assignment found under tools/publishing); their meaning below comes from
--   the column names, the ingest mapping and the measured fill, and says so.
--   owner_id is one placeholder uuid on all 17,006 rows, not a row of auth.users (0 matches), so the owner policies
--   admit no signed-in user; only service_role reads the rows.
--   publishing_communications (17,006 rows) has a foreign key to this table, but contact_id is NULL on every row
--   (0 distinct values, 2026-10-10 08:33Z): the key is declared and unfilled.

BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.publishing_contacts IS
'Correspondent profiles from a publishing operator''s email archive: one row per distinct email address (17,006 rows, 17,006 distinct addresses, 2026-10-10), copied once on 2026-04-14 by tools/publishing/ingest_publishing_data.py from the local SQLite table person_profiles (addresses the extractor flagged as noise were excluded at the copy). Counts, dates and scores were computed by local scripts over the archive (and, for 12 rows, an iMessage export) before the copy and are frozen as of that run. Private by policy: privacy_tier is private on every row, RLS admits only owner_id = auth.uid(), and owner_id is a placeholder uuid with no auth user, so only service_role reads it. No foreign key out; publishing_communications.contact_id points in but is unfilled. Not keyed to external_identities or organizations. Clocks: first_seen/last_seen are event times from message dates; created_at is ingest time.';

-- ── Identity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.id IS
'Surrogate key of the row. Unit: none (uuid). Source: gen_random_uuid() default at the copy. Referenced by publishing_communications.contact_id (foreign key), which is NULL on all 17,006 of its rows (2026-10-10). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.owner_id IS
'The operator whose archive the row came from. Unit: none (uuid). Source: the OWNER_ID constant of ingest_publishing_data.py, a deterministic placeholder (pattern 00000000-0000-4000-a000-...) the script says will be linked to an auth account later; one value on all 17,006 rows and not present in auth.users (2026-10-10). No foreign key. The RLS policies compare it to auth.uid(). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.name IS
'Display name of the correspondent, private. Unit: text. Source: the most common sender/recipient display name seen for the address in the archive (universal_email_extraction.py); when none was seen the ingest writes the email address instead, which is the case on 8,073 of 17,006 rows (2026-10-10). Not verified against any identity record. Grain: one correspondent address. Clock: n/a (as of the extraction run).';
COMMENT ON COLUMN public.publishing_contacts.email IS
'The correspondent''s email address, private; the natural key of the row (17,006 distinct of 17,006, though no UNIQUE constraint enforces it). Unit: text. Source: message headers in the archive. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.domain IS
'Domain of the address. Unit: text (host name). Source: the most common domain seen for the address, else the part after @; equals the part after @ on 17,005 of 17,006 rows (2026-10-10). Text, not a key to organizations. Grain: one correspondent address. Clock: n/a.';

-- ── Professional (filled on 1,050 rows that carry production credits) ──────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.professional_title IS
'Job title for the person as recorded in person_profiles; filled on 1,024 of 17,006 rows (2026-10-10). Unit: text. Source: copied from person_profiles.professional_title; the code that set it is not in this repo, so whether it was parsed from signatures, mastheads or entered by hand is Unknown. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.org_name IS
'Current organization name as recorded in person_profiles (copied from its current_org column); filled on 1,050 rows, the same rows that have a credit_count above 0 (2026-10-10). Unit: text, not a key to organizations. Source: person_profiles.current_org; the code that set it is not in this repo (Unknown method). Grain: one correspondent address. Clock: n/a; "current" means as of the local run, not as of today.';
COMMENT ON COLUMN public.publishing_contacts.org_role IS
'Role at org_name as recorded in person_profiles (copied from current_role); filled on the same 1,050 rows as org_name. Unit: text. Source: person_profiles.current_role; setting code not in this repo (Unknown method). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.publications_worked IS
'The publications the person is credited on, as one text value; filled on the same 1,050 rows as org_name. Unit: text (a list serialized as text; the separator is not documented). Source: person_profiles.publications_worked; setting code not in this repo, presumably the production-credit rebuild (tools/publishing/rebuild_production_credits.py counts credits per person) but that link is Unknown. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.credit_count IS
'Number of production credits (masthead or page credits) attributed to the person. Unit: count. Default 0; above 0 on 1,050 of 17,006 rows, maximum 3,651 (2026-10-10). Source: person_profiles.credit_count, NULL copied as 0; setting code not in this repo (Unknown which credit table and match rule). Grain: one correspondent address. Clock: n/a (as of the local run).';
COMMENT ON COLUMN public.publishing_contacts.credit_roles IS
'The roles named in those credits, as one text value; filled on the same 1,050 rows. Unit: text (serialized list; format not documented). Source: person_profiles.credit_roles; setting code not in this repo. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.primary_publication IS
'The publication the person is most associated with; filled on 352 of 17,006 rows (2026-10-10). Unit: text, not a key. Source: person_profiles.primary_publication; the selection rule is not in this repo (Unknown). Grain: one correspondent address. Clock: n/a.';

-- ── Activity ────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.first_seen IS
'Date of the earliest message in the archive that involves the address. Unit: timestamptz (from ISO message dates). Source: universal_email_extraction.py, minimum of the message dates seen for the address. Filled on 17,000 of 17,006 rows; range 2012-01-12 .. 2026-04-08 (2026-10-10). Grain: one correspondent address. Clock: event time (message date).';
COMMENT ON COLUMN public.publishing_contacts.last_seen IS
'Date of the latest message in the archive that involves the address; never before first_seen (0 rows). Unit: timestamptz. Source: universal_email_extraction.py, maximum message date. Filled on 17,000 rows; range 2012-01-13 .. 2026-04-09 (2026-10-10). The archive''s cut-off, not the end of the relationship. Grain: one correspondent address. Clock: event time (message date).';
COMMENT ON COLUMN public.publishing_contacts.active_months IS
'Number of distinct calendar months (YYYY-MM) with at least one message involving the address. Unit: count of months, maximum 169 (2026-10-10). Source: universal_email_extraction.py (len of the set of message months). Default 0. Grain: one correspondent address. Clock: n/a (derived from event times).';
COMMENT ON COLUMN public.publishing_contacts.years_active IS
'Span of years between first_seen and last_seen. Unit: years, maximum 13 (2026-10-10). Source: person_profiles.years_active; the code is not in this repo. Measured: equals year(last_seen) - year(first_seen) on 12,779 of 17,006 rows and that difference + 1 on 302, so the exact rule is Unknown. Default 0. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.is_cross_publication IS
'True when the person is credited on more than one publication; true on 52 rows, all with publications_worked filled (2026-10-10). Unit: boolean. Source: person_profiles.is_cross_publication, copied with bool(); setting code not in this repo (rule Unknown). Grain: one correspondent address. Clock: n/a.';

-- ── Behavioral scores (the operator''s private assessment; filled on the 2,644 addresses with 10 or more messages) ──

COMMENT ON COLUMN public.publishing_contacts.reliability_score IS
'Composite reliability score from compute_reliability.py: 0.25 responsiveness + 0.15 consistency + 0.20 (1 - ghost_risk) + 0.10 cross_channel + 0.15 reciprocity + 0.15 volume_bonus, each part in 0 .. 1 and kept in reliability_factors. Computed only for addresses with 10 or more sent + received emails: filled on 2,644 of 17,006 rows, range 0.228 .. 0.823 (2026-10-10). Unit: score 0 .. 1, uncalibrated heuristic weights. Grain: one correspondent address. Clock: n/a; as of the local run, recency terms measured against the run date.';
COMMENT ON COLUMN public.publishing_contacts.reliability_factors IS
'The parts of reliability_score as a JSON object with 14 keys on all 2,644 filled rows: responsiveness, email_resp_score, email_resp_hours, imsg_resp_score, imsg_resp_hours, consistency (active_months / span months, capped at 1), ghost_risk, ghost_risk_inverse, ghost_status, cross_channel (channels / 2), reciprocity (min(sent, received) / max), volume_bonus (log10(messages) / 3.5, capped at 1), total_messages, channels. Unit: JSONB; hours are hours, scores 0 .. 1. Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a (as of the local run).';
COMMENT ON COLUMN public.publishing_contacts.ghost_status IS
'Silence class from compute_reliability.py, by days since last_seen at the run: low_volume (fewer than 20 messages; 1,108 rows), active (under 30 days; 219), cooling (30-89 days and consistency 0.3 or more; 81), dormant (30-89 days with lower consistency, or 90-364 days; 240), ghosted (365 days or more; 996); NULL on the 14,362 addresses with fewer than 10 messages (2026-10-10). Unit: text class, no CHECK. Grain: one correspondent address. Clock: n/a; relative to the run date, so it ages without being recomputed.';
COMMENT ON COLUMN public.publishing_contacts.ghost_risk IS
'Silence risk paired with ghost_status: days since last_seen at the run / 365, capped at 1 (at 0.95 for the 90-364-day dormant class), 1 for ghosted. Unit: score 0 .. 1; filled on 2,644 rows, range 0 .. 1 (2026-10-10). Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a; relative to the run date.';
COMMENT ON COLUMN public.publishing_contacts.responsiveness_hours IS
'Intended: average hours the contact took to reply (compute_reliability.py writes the email reply average into person_profiles.responsiveness_hours). NULL on all 17,006 rows here (2026-10-10): the value did not reach this table; reliability_factors.email_resp_hours holds it for scored rows. Unit: hours. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.relationship_phase IS
'Relationship phase from universal_email_extraction.py, by months since last_seen at its run (fixed date 2026-04-08) and active_months: new (under 3 months ago, under 3 active months; 471 rows), sustained (under 3 months ago, 3 or more active months; 580), growing (3-11 months ago, 3 or fewer active months; 1,133), fading (3-11 months ago, more than 3 active months; 426), dormant (12 months or more, or no date; 14,396) (2026-10-10). Unit: text class, no CHECK. Grain: one correspondent address. Clock: n/a; relative to 2026-04-08.';
COMMENT ON COLUMN public.publishing_contacts.relationship_warmth IS
'Warmth score from universal_email_extraction.py: min(1, ln(sent + received + 1) / ln(200) x recency x reciprocity), recency 1.0 under 6 months since last_seen, 0.7 under 18, 0.4 under 36, else 0.15 (relative to 2026-04-08); reciprocity 1.5 when mail went both ways, else 1.0. Unit: score 0 .. 1; filled on all rows, range 0 .. 1 (2026-10-10). Grain: one correspondent address. Clock: n/a; relative to 2026-04-08.';
COMMENT ON COLUMN public.publishing_contacts.trajectory IS
'Direction of contact frequency from universal_email_extraction.py: the message dates split in half by count; rising when the second half spans more than 1.2 x the first half''s distinct months, declining under 0.8 x, else stable (also stable with fewer than 4 messages). Values: stable 13,511, rising 2,316, declining 1,179 (2026-10-10). Unit: text class, no CHECK. Grain: one correspondent address. Clock: n/a.';

-- ── Role intelligence and cross-channel ─────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.role_spectrum IS
'Multi-source role profile from compute_role_spectrum.py, for people with production credits or 50 or more emails: a JSON object with total_emails_scanned, observed (roles from keyword matches in email subjects and previews, with counts), cited (masthead and page credit roles) and summary (top 3 observed plus distinct cited roles); 1 row also has platform (a best-effort profile lookup). Filled on 1,263 of 17,006 rows (2026-10-10). Unit: JSONB. Grain: one correspondent address. Clock: n/a (as of the local run).';
COMMENT ON COLUMN public.publishing_contacts.imessage_contact IS
'The iMessage handle matched to this address, private; filled on 12 rows (2026-10-10). Unit: text. Source: compute_reliability.py, matched first by exact email, else by exact lower-cased full name against the iMessage export (a name match can be a different person). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.imessage_volume IS
'Number of iMessage messages with the matched handle. Unit: count; above 0 on the same 12 rows as imessage_contact, default 0 (2026-10-10). Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.cross_channel_score IS
'Channels observed / 2: 0.5 for email only, 1.0 for email plus iMessage. Unit: score; filled on the 2,644 scored rows, range 0.5 .. 1 (2026-10-10). Source: compute_reliability.py. Grain: one correspondent address. Clock: n/a.';

-- ── Communication summary ───────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.total_sent IS
'Messages in the archive sent by this address: universal_email_extraction.py adds 1 when the address is the From of a message. Unit: count, default 0, NULL copied as 0; above 0 on 9,343 rows (2026-10-10). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.total_received IS
'Messages in the archive addressed to this address: universal_email_extraction.py adds 1 for each message with the address in To. Unit: count, default 0; above 0 on 9,182 rows (2026-10-10). Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.total_cc IS
'Messages where the address appeared in Cc. Unit: count, default 0; above 0 on 6,558 rows (2026-10-10). Source: universal_email_extraction.py. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.preferred_language IS
'Most common detected language of the address''s messages, default en when none was detected. Values: en 14,668, fr 2,286, mixed 52 (2026-10-10). Unit: text code, no CHECK. Source: universal_email_extraction.py. Grain: one correspondent address. Clock: n/a.';

-- ── Classification and clocks ───────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.publishing_contacts.is_noise IS
'Whether the address is noise (lists, automated senders). The ingest copied only person_profiles rows with is_noise = 0 and writes false, so it is false on all 17,006 rows (2026-10-10); noise addresses are absent, not flagged. Unit: boolean, default false. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.privacy_tier IS
'Visibility class: private, published or mutual (CHECK). private on all 17,006 rows, written as a constant by the ingest (2026-10-10). Nothing reads it for access control; the RLS policies use owner_id. Unit: text class. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.source IS
'Provenance label of the row: email_intelligence on all 17,006 rows (column default; the ingest does not set it). Names the local email-archive pipeline, not a source record id. Unit: text. Grain: one correspondent address. Clock: n/a.';
COMMENT ON COLUMN public.publishing_contacts.created_at IS
'When the row was inserted, default now(): 2026-04-14 00:28:56Z .. 00:29:51Z for every row (one hand run of ingest_publishing_data.py). Not when the person was first seen (first_seen). Unit: timestamptz. Grain: one correspondent address. Clock: ingest time.';
COMMENT ON COLUMN public.publishing_contacts.updated_at IS
'Default now() at insert; no trigger maintains it. Equal to created_at on every row: no row has changed since the load (2026-10-10). Unit: timestamptz. Grain: one correspondent address. Clock: ingest time.';

DO $$
DECLARE
  v_missing int;
BEGIN
  SELECT count(*) INTO v_missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.publishing_contacts'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF v_missing > 0 THEN
    RAISE NOTICE 'publishing_contacts: % columns still have no comment (a column was added after 2026-10-10)', v_missing;
  END IF;
END $$;

COMMIT;
