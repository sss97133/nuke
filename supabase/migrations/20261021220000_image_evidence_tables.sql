-- =====================================================================================================
-- BLOCK M1a  supabase/migrations/20261021220000_image_evidence_tables.sql
-- feat(db): image evidence tables, guards and owner-only reads
--
-- (v4) M1a is the inert store: nine tables, their guards (ENABLE ALWAYS, outermost-writer check), RLS and grants.
-- First of three migrations that replace v2's single M1 (rules-violation v2: one push made the inert store and the
-- testimony-writing promotion path live together). Each is one transaction and self-consistent:
--   M1a (this) 9 tables, the insert guard, the append-only guard, RLS and table grants. Inert: nothing can write a
--       row until M1w's writers exist. (v5, guard-mechanism v4 #4) Through the API an owner session reads only his
--       own rows (RLS); service-role key holders (the jobs, every edge function), postgres and the read-only
--       BYPASSRLS roles read every row, as with any table here. The readers filter by user themselves (M1w).
--   M1w writers that never touch testimony, owner decisions and the readers.          Waits for M1a.
--   M1p the promotion path, shipped with every testimony writer disabled.             Waits for M1w.
-- New objects only: no ALTER of an existing table, no FK to vehicle_images/vehicles, no trigger on an existing
-- table, no cron. Crons 499/501 read only image_observations.
-- Capability preflight (check-capability-before-mint.mjs on origin/main 34d7d56c, (v5, rules-channels v4 #7) re-run
-- 2026-10-20 for every M1a/M1w table, view and function name, 51 queries: design/final-v5/preflight/preflight-v5.out;
-- 44 CLEAR, 7 STOP, each answered here and in the PR bodies):
--   "image vehicle candidates" -> STOP vehicle_images: vehicle_images rows are filings (testimony read by the
--     public gallery and by crons 499/501); a proposal there IS a filing. Candidates are not filings. Extended
--     instead: the filing path itself (attribute_testimony / relink_testimony / hold) is reused unchanged.
--   "evidence links" -> STOP account_link_claims / work_sessions: those link people/accounts (actor identity)
--     and photo days; neither holds a money or document row tied to a vehicle with confidence and supersession.
--   "get vehicle day records" -> STOP get_vehicle_specs (public bulk vehicle data models): those are public
--     per-vehicle facts; this reader is a private per-day read of the owner's own evidence rows under owner-only
--     RLS. Nothing to extend; answered in PR-3's body. (rules-violation v3)
--   (v5) "evidence status" / "v evidence status" -> STOP-DEAD-NAME "Poll declared listing feeds": a token match on
--     that row's avoid text ("registry status ... source evidence landed"). This is the owner-decision status of an
--     evidence row (proposed / confirmed / rejected); it has nothing to do with listing feeds. Kept.
--   (v5) "evidence candidates for images" -> STOP "Job evidence (Library photos)" (attach_job_evidence,
--     job_evidence_candidates_read): those attach the owner's photos to a work order. This is an internal reader of
--     image -> vehicle attribution candidates; it attaches nothing and reads no work order. Kept.
--   (v5) "image appearances" -> STOP image_appearances ("Mac Photos library sync": image_identities ->
--     image_appearances): this store never writes the image spine. A Photos item with no vehicle_images row is an
--     evidence_links row of source_kind 'photos_item' that cites the image_appearances row (source_table
--     'image_appearances', checked to be his by seen_by) when one exists, else 'photos:<uuid>'. Live 2026-10-20 the
--     spine holds no Photos-library appearances yet (local_filesystem and camera_capture only).
--   all other names CLEAR. PR-2a adds CAPABILITY_MAP rows for the store, its writers and readers.
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

-- ---------------------------------------------------------------------------------------------------
-- 1.0 Vocabulary
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evidence_pass_names() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ARRAY[
    -- image passes, cheapest first
    'listing_class','time_offset','photos_join','photos_album','file_hash_twin','exif_neighbour',
    'day_context','legacy_suggestion','claim_import','jev_choice','paid_vision','combined','owner_review','audit_sample',
    -- non-image evidence passes (v3: pnl_allocation reads the pinned disposition P&L; custody_bounds proposes
    -- acquisition/sale windows for any vehicle from first/last own-photo day, jackets, listings and Messages)
    'ledger_vendor_date','pnl_allocation','gmail_order','messages_mention','receipt_vehicle_id','qb_correlation',
    'deal_document','vin_decode','identity_compare','account_map','custody_bounds',
    -- (v3, file-mode gap 13) BaT emails and listing pages; claims inferred from other evidence
    'listing_watch','change_infer',
    -- run kinds that are not passes
    'loop','time_rule_gate','exit_test','review_sheet','promote','repin','publication','probe']::text[]
$$;

-- Entity keys: who a party is, never what the money was for (OWNER-DECISIONS 5).
CREATE OR REPLACE FUNCTION public.evidence_entity_key_ok(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p IS NULL OR p ~ '^(owner|owner_business:[a-z0-9_]+|third_party:[a-z0-9_]+|unknown)$'
$$;

CREATE OR REPLACE FUNCTION public.evidence_account_ref_ok(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p IS NULL OR p ~ '^(ledger_account|bank_account|nuke_org):[A-Za-z0-9_.:-]+$'
$$;

-- (v4, sql-apply v3 / rules-violation v3) The writers that may be the OUTERMOST function of a call that writes these
-- tables (M1w and M1p define them; the names are fixed here so the guard ships with the store). A writer reached
-- through any other function is refused by the guards below. Adding a writer later is a migration that changes this
-- list (reviewed like any other).
CREATE OR REPLACE FUNCTION public.evidence_writer_names() RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT ARRAY[
    -- M1w: runs, proposals, answers, decisions
    'evidence_open_run','evidence_close_run','evidence_record_answers','propose_image_candidates',
    'propose_capture_time_claims','confirm_capture_times_by_rule','propose_evidence_links','propose_account_entities',
    'propose_change_claim','propose_claim_support','record_day_context','decide_evidence',
    -- M1p: promotion path
    'evidence_record_reverts','evidence_probe_write','promote_image','record_promotion_failure',
    'evidence_repin_after_merge','publish_image']::text[]
$$;

-- ---------------------------------------------------------------------------------------------------
-- 1.1 Runs
--   v3: 'review_answers' runs hold the owner's verbatim answers per sheet row (rules-violation v2, agent channel);
--   'probe' runs are written only by evidence_probe_write, which times the write inside the database (the size
--   gate no longer trusts an elapsed time the job reports); cost_usd is computed by evidence_close_run from the
--   run's config price, not from a price literal in the schema.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.evidence_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_run_id  uuid REFERENCES public.evidence_runs(id),
  user_id        uuid NOT NULL,
  run_kind       text NOT NULL CHECK (run_kind IN ('daily','backfill','pilot','audit','calibration','exit_test','review',
                                                   'review_answers','probe','promote','repin')),
  pass           text NOT NULL,
  producer       text NOT NULL,                              -- 'script:scripts/evidence/pass_photos_join.py', 'jev:<alias>'
  code_version   text NOT NULL,                              -- git sha of scripts/evidence on origin/main
  config         jsonb NOT NULL,                             -- thresholds; review: {"sheet_sha256","items","rows"}; review_answers:
                                                             -- {"sheet_run","message_ref","rows":{"<n>":{"verbatim","sha256","answer"}}};
                                                             -- (v5) a payment-source run: {"coverage_to","covers_accounts":[..]}
  scope          jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_from  date,
  evidence_to    date,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed','aborted')),
  counts         jsonb,
  scoreboard     jsonb,
  gap_picked     text,
  input_tokens   bigint NOT NULL DEFAULT 0,
  cost_usd       numeric(12,6),                              -- input_tokens x config.price_usd_per_input_token, set at close
  CONSTRAINT er_pass_ok CHECK (pass = ANY (public.evidence_pass_names())),
  CONSTRAINT er_window CHECK (evidence_to IS NULL OR evidence_from IS NULL OR evidence_to >= evidence_from),
  CONSTRAINT er_closed CHECK ((status = 'running') = (finished_at IS NULL)),
  -- (v4, rules-violation v3) a review sheet stores, per row, the targets that row asks about
  -- ({"rows": {"<n>": {"targets": [{"kind": "image_candidate", "id": ...}, {"kind": "payment", "key": ...}]}}}); an
  -- agent decision may decide only targets its cited row names (decide_evidence, evidence_row_covers).
  CONSTRAINT er_review_shape CHECK (run_kind <> 'review' OR (config ? 'sheet_sha256' AND (config->>'items') ~ '^[0-9]+$'
    AND jsonb_typeof(config->'rows') = 'object')),
  CONSTRAINT er_answers_shape CHECK (run_kind <> 'review_answers' OR (
    (config->>'sheet_run') ~ '^[0-9a-f-]{36}$' AND nullif(btrim(config->>'message_ref'), '') IS NOT NULL
    AND jsonb_typeof(config->'rows') = 'object'
    -- (v5, rules-channels v4 #1) every answer row carries the structured reading of his words, written by
    -- evidence_record_answers: {"decision": confirmed|rejected|unsure, and optionally the place he named}
    AND NOT jsonb_path_exists(config->'rows', '$.* ? (!exists(@.answer.decision) || !(@.answer.decision == "confirmed" || @.answer.decision == "rejected" || @.answer.decision == "unsure"))'))),
  -- (v5, readers v4 #3) money coverage is a property of a payment source (a bank or card export, a payment feed): a run
  -- that records coverage_to names the accounts it covers, and only payment-source passes record it
  CONSTRAINT er_coverage_source CHECK (NOT (config ? 'coverage_to') OR (
    pass IN ('ledger_vendor_date','qb_correlation','receipt_vehicle_id')
    AND (config->>'coverage_to') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND jsonb_typeof(config->'covers_accounts') = 'array' AND jsonb_array_length(config->'covers_accounts') > 0)),
  CONSTRAINT er_probe_shape CHECK (run_kind <> 'probe' OR config->>'measured_by' = 'evidence_probe_write')
);
CREATE INDEX er_user_started ON public.evidence_runs (user_id, started_at DESC);
CREATE INDEX er_parent ON public.evidence_runs (parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE INDEX er_probe ON public.evidence_runs (user_id, finished_at DESC) WHERE run_kind = 'probe';
-- (v4, rules-violation v3) one stored answer set per review sheet; a correction is a new sheet
CREATE UNIQUE INDEX er_one_answers_per_sheet ON public.evidence_runs ((config->>'sheet_run')) WHERE run_kind = 'review_answers';

-- ---------------------------------------------------------------------------------------------------
-- 1.2 Image -> vehicle candidates (proposals only)
--   v3: frame_role 'also_in_frame' lets one photo count for a second truck in the frame without filing it there
--   (exit-test v2: multi-truck frames); subject_key names a vehicle that has no row yet ('vin:<17-char VIN>' or
--   'label:<album label>'), with vehicle_id NULL, until a profile exists (profile creation is nuke-04's).
--   (v4, exit-test v3) a no-row truck can be the subject or also_in_frame; two no-row trucks in one frame from one
--   pass are two current rows (the one-current key uses the subject_key when there is no vehicle).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.image_vehicle_candidates (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL,
  run_id           uuid NOT NULL REFERENCES public.evidence_runs(id),
  image_id         uuid NOT NULL,
  vehicle_id       uuid,
  verdict          text NOT NULL CHECK (verdict IN ('is_vehicle','not_vehicle','other_vehicle','ambiguous','listing_evidence')),
  frame_role       text NOT NULL DEFAULT 'subject' CHECK (frame_role IN ('subject','also_in_frame')),
  subject_key      text,
  pass             text NOT NULL,
  join_key         text NOT NULL,
  confidence       numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  probabilities    jsonb,
  candidate_set    uuid[],
  ambiguity_group  uuid,
  evidence         jsonb NOT NULL,
  -- 'third_party' = a photo of the vehicle not taken by the owner in custody (seller camera, listing preview)
  image_class      text NOT NULL DEFAULT 'own' CHECK (image_class IN ('own','third_party','listing','document','unknown')),
  album_link_id    uuid,                    -- photos_album pass rows point at the album-map link they came from
  pass_captured_on date,
  supersedes       uuid,
  superseded_by    uuid,
  superseded_at    timestamptz,
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ivc_pass_ok CHECK (pass = ANY (public.evidence_pass_names())),
  CONSTRAINT ivc_evidence_nonempty CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0),
  CONSTRAINT ivc_vehicle_shape CHECK (
    (verdict = 'is_vehicle' AND (vehicle_id IS NOT NULL OR subject_key IS NOT NULL))
    OR (verdict = 'listing_evidence' AND vehicle_id IS NOT NULL)
    OR (verdict IN ('not_vehicle','other_vehicle') AND vehicle_id IS NULL)
    OR verdict = 'ambiguous'),
  CONSTRAINT ivc_also_in_frame CHECK (frame_role = 'subject' OR verdict = 'is_vehicle'),
  CONSTRAINT ivc_subject_key CHECK (subject_key IS NULL OR (vehicle_id IS NULL AND subject_key ~ '^(vin|album|label):[A-Za-z0-9_.:-]+$')),
  CONSTRAINT ivc_album_link CHECK ((pass = 'photos_album') = (album_link_id IS NOT NULL))
);
-- (v5, readers v4 #2) one current row per USER, image, vehicle (or subject_key) and pass: another user's pass never
-- supersedes the owner's row
CREATE UNIQUE INDEX ivc_one_current ON public.image_vehicle_candidates
  (user_id, image_id, coalesce(vehicle_id::text, subject_key, '-'), pass) WHERE superseded_by IS NULL;
CREATE INDEX ivc_image        ON public.image_vehicle_candidates (image_id, user_id) WHERE superseded_by IS NULL;
CREATE INDEX ivc_vehicle_day  ON public.image_vehicle_candidates (vehicle_id, pass_captured_on) WHERE superseded_by IS NULL;
CREATE INDEX ivc_user_day     ON public.image_vehicle_candidates (user_id, pass_captured_on) WHERE superseded_by IS NULL;
CREATE INDEX ivc_album_link   ON public.image_vehicle_candidates (album_link_id) WHERE album_link_id IS NOT NULL AND superseded_by IS NULL;
CREATE INDEX ivc_run          ON public.image_vehicle_candidates (run_id);

-- ---------------------------------------------------------------------------------------------------
-- 1.3 Capture-time claims (vehicle_images.taken_at is never touched)
--   Rules (join-index facts 2026-10-20: the stored offset is a property of the upload batch and the photo's
--   time zone, not of the source; a flat correction is wrong):
--     photos_exif_join  the row's camera stem joined ONE Photos item; corrected = that item's EXIF instant.
--                       Confirmed by check:photos_exif_join only if offset_seconds (stored - corrected, checked
--                       arithmetically) is a whole number of hours in the run's allowed set and the match is
--                       unique within +/-12 h. Exact sources (ssd_blast, iphoto) land here with offset 0.
--     batch_offset_v1   no Photos match; the offset of its upload batch. batch_key is 'source|created day|tz'
--                       or, when a day has fewer than 50 joined rows, the pooled 'source|pool|tz period' key
--                       (v3, exit-test v2: small daily capture_relay batches never reached 50).
--     owner             the owner says when it was taken.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.image_capture_time_claims (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL,
  run_id                uuid NOT NULL REFERENCES public.evidence_runs(id),
  image_id              uuid NOT NULL,
  stored_taken_at       timestamptz,
  corrected_taken_at    timestamptz NOT NULL,
  offset_seconds        integer,               -- stored_taken_at - corrected_taken_at
  local_offset_minutes  smallint,
  captured_on           date NOT NULL,
  rule                  text NOT NULL CHECK (rule IN ('photos_exif_join','batch_offset_v1','owner')),
  batch_key             text,                  -- 'user_upload|2025-11-12|-0800' or 'capture_relay_ios|pool|2026-PDT'
  witness               jsonb NOT NULL,        -- {"photos_uuid":..,"stem":..,"unique_match":true} | {"batch_key":..}
  confidence            numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  supersedes            uuid,
  superseded_by         uuid,
  superseded_at         timestamptz,
  created_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ictc_batch CHECK (rule <> 'batch_offset_v1' OR batch_key IS NOT NULL)
);
-- (v5, readers v4 #2) one current claim per user and image
CREATE UNIQUE INDEX ictc_one_current ON public.image_capture_time_claims (user_id, image_id) WHERE superseded_by IS NULL;
CREATE INDEX ictc_user_day ON public.image_capture_time_claims (user_id, captured_on) WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- 1.4 Evidence links: a non-image source row (or one fact of it) tied to a vehicle
--   source_key is a plain column set by the writer and CHECKed. Multi-fact sources carry a mandatory anchor.
--   v3 (rules-violation v2, characterisation): a link stores what the source states and where it is placed, never
--   what the money was for in tax terms. role is placement and direction only: payment_out / payment_in (a payment
--   placed on this vehicle), assertion (a document states a figure; not a payment), supports / contradicts /
--   context. source_label is the source's own words for the line ('Labor', 'Zelle painter'), copied, never
--   inferred. cost_category keeps only physical kinds (no labour, own_labour or sale_proceeds).
--   payment_key names the one payment a link is or describes: every link sharing it is ONE payment
--   ('owner:<answers ref>' when the only source is the owner's own statement).
--   allocated_cents: the share of the payment placed on this vehicle (a receipt split across trucks).
--   from_account_ref / to_account_ref: the paying and the receiving account (one link, both sides).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.evidence_links (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  run_id             uuid NOT NULL REFERENCES public.evidence_runs(id),
  vehicle_id         uuid,
  subject_key        text,
  source_kind        text NOT NULL CHECK (source_kind IN (
                       'bank_line','ledger_line','pnl_line','gmail_order','gmail_message','message','receipt','qb_transaction',
                       'payment_event','journal_entry','deal_jacket','deal_document','photos_album','work_session',
                       'listing','calendar_item','note','vehicle_field','owner_statement',
                       -- (v4, exit-test v3) a Photos item with no vehicle_images row (videos, photos never uploaded)
                       'photos_item')),
  source_table       text,
  source_row_id      uuid,
  external_ref       text,                  -- 'ledger:<ledger file>:<line id>', 'pnl:disposition:<bank ref>', 'photos:<uuid>'
  anchor             text,                  -- one fact of a multi-fact source: 'sale', 'acquired_date', 'line:labour'
  source_key         text NOT NULL,         -- coalesce(source_table||':'||source_row_id, external_ref) || coalesce('#'||anchor,'')
  source_sha256      text,
  source_label       text CHECK (source_label IS NULL OR length(source_label) <= 60),
  occurred_on        date,                  -- the source's own date (ledger: posting date)
  transaction_on     date,                  -- (v3, file-mode gap 16) card/transaction date when the source has both
  direction          text CHECK (direction IN ('out','in','none')),
  amount_cents       bigint,                -- as stated by the source; database only
  allocated_cents    bigint,
  cost_category      text CHECK (cost_category IN ('purchase','parts','paint','transport','storage','fees','other')),
  counterparty_label text,                  -- business name or role ('painter'); never contact details
  role               text NOT NULL CHECK (role IN ('payment_out','payment_in','assertion','supports','contradicts','context')),
  payment_key        text CHECK (payment_key IS NULL OR payment_key ~ '^(bank|ledger|payment_event|qb|owner):[A-Za-z0-9_.:#-]+$'),
  -- (v4, exit-test v3) never the literal 'unknown' on a link: an unknown party is NULL, so the reader falls back to
  -- the owner-confirmed account map (a literal 'unknown' would shadow it forever)
  -- (v5, rules-channels v4 #4) whose money it was (owner vs one of his businesses) is his call: a pass may name only
  -- a third party the source itself names (the vendor of a card line, the buyer of a sale); 'owner' and
  -- 'owner_business:*' come from his confirmed account map, or from his own statement (el_entity_owner_word)
  payer_entity       text CHECK (payer_entity IS DISTINCT FROM 'unknown' AND public.evidence_entity_key_ok(payer_entity)),
  payee_entity       text CHECK (payee_entity IS DISTINCT FROM 'unknown' AND public.evidence_entity_key_ok(payee_entity)),
  from_account_ref   text CHECK (public.evidence_account_ref_ok(from_account_ref)),
  to_account_ref     text CHECK (public.evidence_account_ref_ok(to_account_ref)),
  pass               text NOT NULL,
  join_key           text NOT NULL,
  confidence         numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),   -- this link's vehicle placement
  payment_join_confidence numeric(4,3) CHECK (payment_join_confidence IS NULL OR (payment_join_confidence BETWEEN 0 AND 1
                       AND payment_key IS NOT NULL)),  -- (v3, gap 4) how sure the source is this payment (order <-> bank line)
  evidence           jsonb NOT NULL,
  summary            text CHECK (summary IS NULL OR length(summary) <= 60),
  supersedes         uuid,
  superseded_by      uuid,
  superseded_at      timestamptz,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT el_source_named CHECK ((source_table IS NOT NULL AND source_row_id IS NOT NULL) OR external_ref IS NOT NULL),
  CONSTRAINT el_source_key_ok CHECK (source_key = coalesce(source_table || ':' || source_row_id::text, external_ref) || coalesce('#' || anchor, '')),
  CONSTRAINT el_anchor_required CHECK (source_kind NOT IN ('deal_jacket','deal_document','journal_entry','vehicle_field') OR anchor IS NOT NULL),
  CONSTRAINT el_money_shape CHECK (
    (role NOT IN ('payment_out','payment_in') OR (amount_cents IS NOT NULL AND direction IN ('out','in')))
    -- (v3, gap 5) an order or document with no usable total is still an assertion (listed, never summed) while no
    -- payment is joined to it; (v4, exit-test v3) or it joins a payment by payment_key with a payment_join_confidence
    -- (the payment's own source carries the amount; the assertion is never summed itself)
    AND (role <> 'assertion' OR (direction IN ('out','in')
         AND (amount_cents IS NOT NULL OR payment_key IS NULL OR payment_join_confidence IS NOT NULL)))),
  CONSTRAINT el_direction_role CHECK ((role <> 'payment_out' OR direction = 'out') AND (role <> 'payment_in' OR direction = 'in')),
  CONSTRAINT el_allocation CHECK (allocated_cents IS NULL OR (allocated_cents >= 0 AND amount_cents IS NOT NULL AND allocated_cents <= abs(amount_cents))),
  CONSTRAINT el_subject_key CHECK (subject_key IS NULL OR (vehicle_id IS NULL AND subject_key ~ '^(vin|album|label):[A-Za-z0-9_.:-]+$')),
  CONSTRAINT el_entity_owner_word CHECK (source_kind = 'owner_statement' OR pass = 'owner_review'
    OR ((payer_entity IS NULL OR payer_entity LIKE 'third_party:%') AND (payee_entity IS NULL OR payee_entity LIKE 'third_party:%'))),
  -- (v5, rules-channels v4 #5) a link resting on the owner's word cites his stored answer: an owner_statement link's
  -- external_ref is 'answers:<answers run>#<row>' and an 'owner:' payment key is 'owner:answers:<answers run>#<row>'
  -- (the writer checks that the answer exists and is his)
  CONSTRAINT el_owner_word_cited CHECK ((source_kind <> 'owner_statement' OR external_ref ~ '^answers:[0-9a-f-]{36}#[0-9]+$')
    AND (payment_key IS NULL OR payment_key NOT LIKE 'owner:%' OR payment_key ~ '^owner:answers:[0-9a-f-]{36}#[0-9]+$')),
  CONSTRAINT el_pass_ok CHECK (pass = ANY (public.evidence_pass_names())),
  CONSTRAINT el_evidence_nonempty CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0)
);
-- (v5, readers v4 #2) per user: another user's link with the same source never supersedes the owner's
CREATE UNIQUE INDEX el_one_current ON public.evidence_links
  (user_id, source_key, coalesce(vehicle_id::text, subject_key, '-')) WHERE superseded_by IS NULL;
CREATE INDEX el_vehicle_day ON public.evidence_links (vehicle_id, occurred_on) WHERE superseded_by IS NULL;
CREATE INDEX el_user_day    ON public.evidence_links (user_id, occurred_on) WHERE superseded_by IS NULL;
CREATE INDEX el_source_key  ON public.evidence_links (user_id, source_key) WHERE superseded_by IS NULL;
CREATE INDEX el_payment_key ON public.evidence_links (user_id, payment_key) WHERE superseded_by IS NULL AND payment_key IS NOT NULL;

-- 1.4b Account and entity map (owner-confirmed): which account or Nuke organization is whose.
CREATE TABLE public.evidence_account_entities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  run_id         uuid NOT NULL REFERENCES public.evidence_runs(id),
  account_ref    text NOT NULL CHECK (account_ref IS NOT NULL AND public.evidence_account_ref_ok(account_ref)),
  entity_key     text NOT NULL CHECK (public.evidence_entity_key_ok(entity_key)),
  confidence     numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence       jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) > 0),
  supersedes     uuid,
  superseded_by  uuid,
  superseded_at  timestamptz,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX eae_one_current ON public.evidence_account_entities (user_id, account_ref) WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- 1.5 Change claims and their support
--   trade_in_cents on a sale; survivor_vehicle_id on same_vehicle_as (the row nuke-04 keeps); support rows say
--   which attribute they bear on ('about').
--   v3: 'worked_on' (custody domain) records a vehicle the owner worked on but does not own (a customer's, his
--   father's); it may name a vehicle outside his scope, and once he confirms it the vehicle enters scope.
--   'work_performed' (physical domain) records work done in a window and, in party_entity, who did it (the owner
--   or a third party such as the painter), so labour by others has a worker and days without any pay
--   characterisation.
--   (v4, exit-test v3) a truck with no Nuke row can still be 'worked_on' or have 'work_performed': vehicle_id NULL
--   and subject_key set (exactly one of the two).
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.vehicle_change_claims (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  run_id              uuid NOT NULL REFERENCES public.evidence_runs(id),
  vehicle_id          uuid,
  subject_key         text,
  claim_domain        text NOT NULL CHECK (claim_domain IN ('physical','custody','money','record')),
  kind                text NOT NULL CHECK (kind IN (
                        'acquisition','sale','listing','transport','worked_on','work_performed',
                        'part_installed','part_removed','paint','body','lift','suspension','engine','interior','detail','repair','inspection',
                        'same_vehicle_as','vin_is','model_is','other')),
  occurred_from       date,
  occurred_to         date,
  amount_cents        bigint,
  trade_in_cents      bigint,
  related_vehicle_id  uuid,
  survivor_vehicle_id uuid,
  party_entity        text CHECK (public.evidence_entity_key_ok(party_entity)),
  asserted_value      jsonb,
  summary             text NOT NULL,
  confidence          numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  supersedes          uuid,
  superseded_by       uuid,
  superseded_at       timestamptz,
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vcc_range CHECK (occurred_to IS NULL OR occurred_from IS NULL OR occurred_to >= occurred_from),
  CONSTRAINT vcc_identity_target CHECK (kind <> 'same_vehicle_as' OR related_vehicle_id IS NOT NULL),
  CONSTRAINT vcc_survivor CHECK (survivor_vehicle_id IS NULL OR (kind = 'same_vehicle_as' AND survivor_vehicle_id IN (vehicle_id, related_vehicle_id))),
  CONSTRAINT vcc_trade_in CHECK (trade_in_cents IS NULL OR (kind IN ('sale','acquisition') AND trade_in_cents >= 0)),
  CONSTRAINT vcc_party CHECK (party_entity IS NULL OR kind IN ('work_performed','worked_on','acquisition','sale')),
  -- (v5, rules-channels v4 #4) a pass names a third party the source names, or the owner as the one who did the
  -- work; never which of his entities bought or sold (that is his call, through the account map)
  CONSTRAINT vcc_party_not_entity CHECK (party_entity IS NULL OR party_entity LIKE 'third_party:%'
    OR (party_entity = 'owner' AND kind IN ('work_performed','worked_on'))),
  CONSTRAINT vcc_subject CHECK ((vehicle_id IS NOT NULL) <> (subject_key IS NOT NULL)
    AND (subject_key IS NULL OR (kind IN ('worked_on','work_performed') AND subject_key ~ '^(vin|album|label):[A-Za-z0-9_.:-]+$')))
);
CREATE INDEX vcc_vehicle ON public.vehicle_change_claims (vehicle_id, kind, occurred_from) WHERE superseded_by IS NULL;
CREATE INDEX vcc_related ON public.vehicle_change_claims (related_vehicle_id) WHERE superseded_by IS NULL AND related_vehicle_id IS NOT NULL;
CREATE INDEX vcc_user_kind ON public.vehicle_change_claims (user_id, kind) WHERE superseded_by IS NULL;
CREATE INDEX vcc_subject_key ON public.vehicle_change_claims (subject_key) WHERE superseded_by IS NULL AND subject_key IS NOT NULL;

CREATE TABLE public.vehicle_change_claim_support (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id       uuid NOT NULL REFERENCES public.vehicle_change_claims(id),
  user_id        uuid NOT NULL,
  evidence_kind  text NOT NULL CHECK (evidence_kind IN ('image_candidate','evidence_link','capture_time_claim','vehicle_image','work_session','change_claim')),
  evidence_id    uuid NOT NULL,
  stance         text NOT NULL CHECK (stance IN ('supports','contradicts')),
  about          text NOT NULL CHECK (about IN ('date','amount','party','vehicle','identity','condition','other')),
  weight         numeric(4,3) NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 1),
  note           text CHECK (note IS NULL OR length(note) <= 120),
  superseded_by  uuid,
  superseded_at  timestamptz,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vccs_claim ON public.vehicle_change_claim_support (claim_id) WHERE superseded_by IS NULL;
CREATE INDEX vccs_evidence ON public.vehicle_change_claim_support (evidence_kind, evidence_id) WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- 1.6 Day context (floor set per user, local day, place cluster)
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.user_day_vehicle_context (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL,
  run_id         uuid NOT NULL REFERENCES public.evidence_runs(id),
  day            date NOT NULL,
  place_cluster  text NOT NULL,
  vehicle_id     uuid NOT NULL,
  confidence     numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  basis          text[] NOT NULL CHECK (basis <@ ARRAY['custody_window','confirmed_photo_pm14d','album_items_that_day','open_change_claim',
                                                       'work_session','worked_on','owner',
                                                       -- (v3, gap 9) pre-acquisition yard visits and place matches
                                                       'proposed_photo_that_day','gps_place_match']::text[] AND cardinality(basis) > 0),
  supersedes     uuid,
  superseded_by  uuid,
  superseded_at  timestamptz,
  created_by     text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX udvc_one_current ON public.user_day_vehicle_context (user_id, day, place_cluster, vehicle_id) WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------------------------------
-- 1.7 Decisions (append-only)
--   Channels: 'human:<uid>' only from the owner's own JWT through the API (owner_page / owner_app /
--   owner_physical_check). A job transcribing an answer the owner gave in chat writes 'agent:<session>' with
--   on_behalf_of = the owner, review_ref 'review:<sheet run>#<row>' (the question) and, v3, detail.answer_ref
--   'answers:<answers run>#<row>' plus detail.answer_sha256 (his verbatim answer, stored in that run). 'implied:<id>'
--   marks rejections implied by a confirm. Machines (rule:/check:) may confirm only capture times.
--   v3: every row carries detail.writer (the function that wrote it); promotion trusts only decide_evidence rows.
-- ---------------------------------------------------------------------------------------------------
CREATE TABLE public.evidence_decisions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL,
  target_kind       text NOT NULL CHECK (target_kind IN ('image_candidate','capture_time_claim','evidence_link','album_map',
                                                         'change_claim','day_context','account_entity','image_publication')),
  target_id         uuid NOT NULL,          -- image_publication: the vehicle_images id; album_map: the photos_album link id
  decision          text NOT NULL CHECK (decision IN ('confirmed','rejected','promoted','promotion_blocked','revert_detected')),
  decided_by        text NOT NULL CHECK (decided_by ~ '^(human:[0-9a-f-]{36}|agent:[A-Za-z0-9_.-]{3,64}|rule:[a-z0-9_.]+|check:[a-z0-9_.]+|writer:[a-z_]+|implied:[0-9a-f-]{36})$'),
  on_behalf_of      uuid,
  review_ref        text,
  review_method     text CHECK (review_method IN ('owner_chat_review','owner_page','owner_app','owner_physical_check')),
  reason            text NOT NULL,
  detail            jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_image_id   uuid,
  audit_id          uuid,
  pin_claim_id      uuid,
  retired_claim_ids uuid[],
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ed_writer_stamp CHECK (nullif(detail->>'writer', '') IS NOT NULL),
  -- (v5, rules-channels v4 #3) an owner decision comes from a step-up (aal2) session; the guard stamps the session's
  -- assurance level, auth methods and session id from the JWT
  CONSTRAINT ed_human_traceable CHECK (decided_by NOT LIKE 'human:%' OR
    (nullif(btrim(review_ref),'') IS NOT NULL AND review_method IN ('owner_page','owner_app','owner_physical_check')
     AND detail->>'aal' = 'aal2')),
  CONSTRAINT ed_agent_traceable CHECK (decided_by NOT LIKE 'agent:%' OR
    (on_behalf_of IS NOT NULL AND review_method = 'owner_chat_review' AND review_ref ~ '^review:[0-9a-f-]{36}#[0-9]+$'
     AND (detail->>'answer_ref') ~ '^answers:[0-9a-f-]{36}#[0-9]+$' AND (detail->>'answer_sha256') ~ '^[0-9a-f]{64}$')),
  CONSTRAINT ed_no_machine_attribution CHECK (
    decision <> 'confirmed' OR decided_by ~ '^(human|agent):' OR target_kind = 'capture_time_claim'),
  CONSTRAINT ed_promotion_shape CHECK (
    decision IN ('confirmed','rejected') OR (target_kind IN ('image_candidate','image_publication') AND decided_by LIKE 'writer:%'))
);
CREATE INDEX ed_target ON public.evidence_decisions (target_kind, target_id, created_at DESC);
CREATE INDEX ed_user_created ON public.evidence_decisions (user_id, created_at DESC);
CREATE INDEX ed_result_image ON public.evidence_decisions (result_image_id, created_at DESC) WHERE result_image_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------
-- 1.8 Guards
--   v3's insert guard trusted session_user = 'authenticator' plus a transaction-local token. Two live paths got
--   past it (sql-apply v3, rules-violation v3, both reproduced on scratch PG17): (1) the q.sh role may set the
--   session replication mode, which silences triggers created in default mode; (2) a postgres-owned SECURITY
--   DEFINER function that runs caller SQL (live execute_recovery_sql(text), EXECUTE to service_role) runs inside a
--   PostgREST session, can set any custom setting (the token, the JWT claims) and so passed both tests.
--   v4 guard (both triggers, fired ALWAYS):
--     a. session_user = 'authenticator' (q.sh and any other direct login are refused; a non-superuser cannot change
--        session_user, live pg_roles 2026-10-20);
--     b. the PostgREST role setting is service_role or authenticated (current_setting('role'); PostgreSQL refuses
--        SET ROLE / set_config('role') inside any SECURITY DEFINER function, so no definer RPC can change it);
--     c. the OUTERMOST function on the call stack (the last line of PG_CONTEXT, written by PostgreSQL, not by the
--        caller) is one of evidence_writer_names(). A writer called from inside execute_recovery_sql, a DO block or any
--        other function is refused, so the arbitrary-SQL RPC can neither INSERT nor call a writer with forged claims;
--     d. an owner session (role authenticated) writes only through decide_evidence, and a 'human:<uid>' decision
--        needs role authenticated with that uid in the JWT; an 'agent:' decision needs role service_role. The guard
--        stamps the role and the outermost writer into every decision's detail (api_role, outer_writer).
--   The transaction-local token evidence.writer is still set by the writers and checked, as a convention only.
--   (v5, guard-mechanism v4 #5) "Outermost" means the outermost frame PG_CONTEXT shows. A caller that leaves no frame
--   (an inlined LANGUAGE sql wrapper, a view, a rule) is not seen; making one needs DDL in public (no API role has
--   CREATE there, live 2026-10-20) and the daily sweep flags any public view or function other than the writers whose
--   body names a writer (PLAN M10).
--   (v5) e. a 'human:' decision also needs a step-up session: auth.jwt()->>'aal' = 'aal2'. The guard stamps aal, the
--      auth methods (amr) and the session id into the decision (rules-channels v4 #3: the human channel attests the
--      owner's credential; a second factor makes an agent-side session much harder to come by).
--   What is left is DDL by the table owner (ALTER TABLE ... DISABLE TRIGGER, DROP TRIGGER, CREATE OR REPLACE of a
--   writer): possible from q.sh and from any arbitrary-SQL definer RPC and forbidden by db-safety outside a migration.
--   (v5, guard-mechanism v4 #1) It is NOT reliably audited or detected in the database. Since 20261021210000 (#2396)
--   ddl_audit_command_end, ddl_audit_sql_drop and view_write_guard fire ALWAYS, so a replication-mode session no longer
--   silences the DDL audit; but the owner can still disable or drop an event trigger, event triggers do not fire for
--   commands on event triggers, and a session may turn its statement logging off. A trigger disabled and re-enabled
--   inside one transaction leaves the end state (27 triggers 'A', unchanged md5s) that the in-database check reads, and
--   rows written meanwhile can carry any stamp. Detection of owner DDL stays outside the database: PLAN M10b matches
--   every evidence row against the runner's manifest of writer-call returns and, for owner decisions, the API request
--   log. The guard does not claim more than that.
--   Append-only guard: compares OLD and NEW; refuses everything except the supersession stamp and closing a run, and
--   only under the same caller rule (v3 let any owner-role session stamp a supersession).
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evidence_caller_check(p_table text) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
DECLARE v_ctx text; v_lines text[]; v_outer text; v_writer text; v_role text;
BEGIN
  IF session_user::text IS DISTINCT FROM 'authenticator' THEN
    RAISE EXCEPTION '%: rows are written only by the evidence writers through the API (session %)', p_table, session_user
      USING ERRCODE = '42501';
  END IF;
  v_role := coalesce(current_setting('role', true), 'none');
  IF v_role NOT IN ('service_role', 'authenticated') THEN
    RAISE EXCEPTION '%: API role % may not write evidence', p_table, v_role USING ERRCODE = '42501';
  END IF;
  GET DIAGNOSTICS v_ctx = PG_CONTEXT;
  v_lines := regexp_split_to_array(v_ctx, E'\n');
  v_outer := v_lines[array_length(v_lines, 1)];
  v_writer := substring(v_outer from '^PL/pgSQL function ([a-z_]+)\(');
  IF v_writer IS NULL OR NOT (v_writer = ANY (public.evidence_writer_names())) THEN
    RAISE EXCEPTION '%: the outermost caller is not an evidence writer (%)', p_table, left(v_outer, 120) USING ERRCODE = '42501';
  END IF;
  IF v_role = 'authenticated' AND v_writer <> 'decide_evidence' THEN
    RAISE EXCEPTION '%: an owner session writes only through decide_evidence', p_table USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('evidence.writer', true), '') <> 'on' THEN
    RAISE EXCEPTION '%: writer token missing', p_table USING ERRCODE = '42501';
  END IF;
  RETURN v_role || ':' || v_writer;
END $$;

CREATE OR REPLACE FUNCTION public.evidence_insert_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_c text; v_role text; v_writer text;
BEGIN
  v_c := public.evidence_caller_check(TG_TABLE_NAME);
  v_role := split_part(v_c, ':', 1); v_writer := split_part(v_c, ':', 2);
  IF TG_TABLE_NAME = 'evidence_decisions' THEN
    IF NEW.decided_by LIKE 'human:%' AND (v_role <> 'authenticated' OR v_writer <> 'decide_evidence'
         OR substr(NEW.decided_by, 7) IS DISTINCT FROM (SELECT auth.uid())::text) THEN
      RAISE EXCEPTION 'evidence_decisions: an owner decision comes only from the owner''s own session' USING ERRCODE = '42501';
    END IF;
    -- (v5, rules-channels v4 #3) and only from a step-up (aal2) session; the session facts are stamped
    IF NEW.decided_by LIKE 'human:%' THEN
      IF coalesce((SELECT auth.jwt())->>'aal', '') <> 'aal2' THEN
        RAISE EXCEPTION 'evidence_decisions: an owner decision needs a step-up (aal2) session' USING ERRCODE = '42501';
      END IF;
      NEW.detail := NEW.detail || jsonb_build_object('aal', (SELECT auth.jwt())->>'aal',
                      'session_id', (SELECT auth.jwt())->>'session_id',
                      'amr', (SELECT jsonb_agg(DISTINCT e->>'method') FROM jsonb_array_elements(coalesce((SELECT auth.jwt())->'amr', '[]'::jsonb)) e));
    END IF;
    IF NEW.decided_by LIKE 'agent:%' AND (v_role <> 'service_role' OR v_writer <> 'decide_evidence') THEN
      RAISE EXCEPTION 'evidence_decisions: an agent decision comes only from a service-role job through decide_evidence' USING ERRCODE = '42501';
    END IF;
    NEW.detail := NEW.detail || jsonb_build_object('api_role', v_role, 'outer_writer', v_writer);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.evidence_append_only_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE o jsonb; n jsonb;
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION '%: append-only; supersede instead', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'evidence_decisions' THEN
    RAISE EXCEPTION 'evidence_decisions: append-only; write a later decision' USING ERRCODE = '42501';
  END IF;
  PERFORM public.evidence_caller_check(TG_TABLE_NAME);
  o := to_jsonb(OLD); n := to_jsonb(NEW);
  IF o ? 'superseded_by' AND o->>'superseded_by' IS NULL AND n->>'superseded_by' IS NOT NULL
     AND n->>'superseded_at' IS NOT NULL
     AND (n - 'superseded_by' - 'superseded_at') = (o - 'superseded_by' - 'superseded_at') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'evidence_runs' AND o->>'status' = 'running'
     AND (n - 'finished_at' - 'status' - 'counts' - 'scoreboard' - 'gap_picked' - 'input_tokens' - 'cost_usd')
       = (o - 'finished_at' - 'status' - 'counts' - 'scoreboard' - 'gap_picked' - 'input_tokens' - 'cost_usd')
     AND (n->>'input_tokens')::bigint >= (o->>'input_tokens')::bigint THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%: in-place update refused; write a superseding row', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

-- (v4, sql-apply v3) Created, then set to fire ALWAYS (also under a session replication setting).
-- (v5, guard-mechanism v4 #3) Consequence, accepted: a logical DATA-ONLY restore of these tables (rows loaded in
-- replication mode into the existing schema) is refused row by row, because its session is not PostgREST's. A full
-- pg_dump restore (it creates the triggers after loading the data, and keeps ENABLE ALWAYS), a branch (replays the
-- migrations) and PITR (physical) are unaffected. A data-only restore of these nine tables is unsupported except
-- through a reviewed migration written for that restore (PLAN section 7); never DISABLE TRIGGER by hand.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_runs','image_vehicle_candidates','image_capture_time_claims','evidence_links',
                           'evidence_account_entities','vehicle_change_claims','vehicle_change_claim_support',
                           'user_day_vehicle_context','evidence_decisions'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.evidence_insert_guard()', t||'_insert_guard', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.evidence_append_only_guard()', t||'_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.evidence_append_only_guard()', t||'_no_truncate', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', t, t||'_insert_guard');
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', t, t||'_append_only');
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', t, t||'_no_truncate');
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------------
-- 1.9 RLS and grants: through the API an owner session reads only his own rows; no API role writes; no vehicle-public
--     policy. (v5, guard-mechanism v4 #4) RLS is not FORCEd and service_role is BYPASSRLS: the jobs (service_role)
--     read every user's rows, as do postgres and the read-only BYPASSRLS roles. The jobs need that (scoreboard, exit
--     test, review sheet); the readers therefore filter by user themselves (M1w, readers v4 #1).
-- ---------------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_runs','image_vehicle_candidates','image_capture_time_claims','evidence_links',
                           'evidence_account_entities','vehicle_change_claims','vehicle_change_claim_support',
                           'user_day_vehicle_context','evidence_decisions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()))', t||'_owner_read', t);
  END LOOP;
END $$;

-- Function grants. Supabase's default ACL for postgres-owned functions in public is {postgres=X, service_role=X};
-- every function is revoked from PUBLIC, anon, authenticated and service_role first, then granted explicitly.
REVOKE ALL ON FUNCTION public.evidence_pass_names(), public.evidence_entity_key_ok(text), public.evidence_account_ref_ok(text),
  public.evidence_writer_names(), public.evidence_caller_check(text),
  public.evidence_insert_guard(), public.evidence_append_only_guard()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evidence_pass_names(), public.evidence_entity_key_ok(text), public.evidence_account_ref_ok(text),
  public.evidence_writer_names()
  TO authenticated, service_role;
-- the guards and evidence_caller_check: no grant to any role (trigger functions run as the trigger fires, as the
-- function owner inside the definer writers).
COMMIT;
