-- Describe comment_persona_signals: all 33 columns, none had a COMMENT ON COLUMN (0 of 33 described before, catalog count
-- on prod, 2026-10-07) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 224,369 rows on 2026-10-07 02:54Z by exact count (equal to
-- the atlas estimate), no insert or update since the statistics counters began, last extracted_at 2026-04-13.
--
-- METHOD (read 2026-10-07 UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants and existing comments from pg_attribute,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, information_schema and pg_description. Fill, values, date windows and
--   the relations between columns are exact counts over the whole table (80 MB heap, read only). That every comment_id still
--   resolves in auction_comments was tested on a 3% block sample (TABLESAMPLE SYSTEM (3) REPEATABLE (20261007), 6,878 rows;
--   the full anti-join timed out at 55 s). What anon and authenticated can read comes from counts under SET LOCAL ROLE in
--   read-only transactions. "Filled" means non-NULL and, for text, non-blank; arrays count non-empty.
--   Writers and readers from code at origin/main 031dea1f2 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps) and git history: scripts/persona-assembly-line.sh, the creating migration
--   20260129_commenter_personas.sql, the roll-up 20260206_aggregate_author_personas.sql, the one live SQL function that names
--   the table (aggregate_author_personas), the absence of triggers, cron jobs and views, write_receipts (no rows),
--   pg_stat_user_tables (0 writes since the counters began) and pipeline_registry (no rows for this table or its
--   projection; none is added: the second writer is not in the repo, so there is no owner to name).
-- LIMITS:
--   The two writers are told apart by model_used and by which columns they fill. The heuristic-v1 writer is not in the repo
--   or in git history (git log -S heuristic-v1 finds nothing), so what its rules are is read from the data: relations such
--   as is_serious_buyer = (intent = buying) hold on every row. Comment text and handles are described by column, never
--   quoted. Quoted values are categorical codes, model stamps, key and function names only: no names, handles, contacts,
--   ids or amounts.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said the table is filled by scripts/persona-assembly-line.sh, which wrote 0.4% of the rows; 99.6%
--   come from a heuristic-v1 run that is not in the repo. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.comment_persona_signals IS
'Per-comment persona signals: one row per Bring a Trailer auction comment with tone, expertise, intent and behavior scores (grain: one comment; comment_id is unique in the data, 224,369 distinct values, though no constraint enforces it). 224,369 rows on 2026-10-07 for 33,586 commenter handles on 537 vehicles; platform bat on every row. Created by migration 20260129_commenter_personas.sql; no foreign key. Two writers, told apart by model_used: scripts/persona-assembly-line.sh (run by hand against a local Ollama llama3.1:8b model, 952 rows, 2026-01-30 00:15 .. 01:19, confidence 0.70, which leaves the trust booleans NULL) and a heuristic-v1 run that is not in the repo (223,417 rows inserted in five minutes on 2026-04-13 05:24 .. 05:29, confidence 0.55, rule scores (tone_helpful and tone_technical take 71 and 100 distinct values against the model steps of 0.1), which fills the trust booleans). Nothing is scheduled: no pg_cron job, no trigger. Reader: only the SQL function aggregate_author_personas(), which rolls the rows up into author_personas (363 rows, built once on 2026-02-06 from the 952 llama rows, so the 223,417 heuristic rows are in no aggregate); nothing else in the database reads the table and in the repo only the assembly line reads it (a duplicate check before each insert), so it is a candidate for the drop list or for a re-aggregation, a decision not made here. Never filled: author_id, expertise_areas, shows_specific_knowledge, cites_sources. is_serious_buyer and is_seller_shill repeat intent on the heuristic rows. comment_text duplicates the public comment at scoring time. 9,265 rows (4.1%) hold a vehicle_id that is not in vehicles (no foreign key); a 3% block sample found no comment_id missing from auction_comments. extracted_at (2026-01-30 .. 2026-04-13) is our scoring time, not the comment time. RLS is on and only service_role has a policy, so anon and authenticated see 0 rows (counted under SET ROLE, 2026-10-07). Personal data: author_username is the public handle of a commenter and comment_text can mention people; values are not quoted.';

-- ── Source comment ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.comment_persona_signals.id IS
'Surrogate key of the signal row. Unit: none (uuid). Source: gen_random_uuid() default. No foreign key points at it and nothing reads it; the working key is comment_id. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.comment_id IS
'The auction comment that was scored: auction_comments.id, with no foreign key. Filled on every row; 224,369 distinct values, so one row per comment in practice, though no unique constraint or index backs it (the assembly line checks for an existing row with a REST read per comment, which scans this table). A 3% block sample (6,878 rows) found none missing from auction_comments; merges and retirements of comment rows can make an id stop resolving later. Unit: none (uuid). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.author_username IS
'Handle of the commenter as shown on the auction site, NOT NULL (the assembly line writes anonymous when it is missing). The only key to the author: 33,586 distinct handles on 224,369 rows (2026-10-07), and with platform the group key of aggregate_author_personas(). Copied from auction_comments.author_username at scoring time, so spelling and case are as scraped and one person can appear under variants. No foreign key and no index on prod (the creating file declared persona_signals_author, which prod lacks). A public pseudonym but personal data: values are not quoted. Unit: none (text). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.author_id IS
'Normalized author entity, intended by the creating file ("normalized author entity if we have it"). NULL on every row (2026-10-07); no writer sets it and no foreign key exists. The author key that exists now is auction_comments.author_external_identity_id (external_identities); this table was never keyed to it. Unit: none (uuid). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.vehicle_id IS
'Vehicle the comment was made on: a vehicles.id copied from auction_comments.vehicle_id, no foreign key. Filled on every row; 537 distinct vehicles, so each carries about 420 scored comments on average. 9,265 rows (4.1%) point at a vehicle that is not in vehicles (2026-10-07). Index persona_signals_vehicle. Unit: none (uuid). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.platform IS
'Auction site of the comment, default bat, no CHECK. bat on all 224,369 rows (2026-10-07): scoring only ever ran on Bring a Trailer comments. With author_username it is the group key of aggregate_author_personas(). Index persona_signals_platform. Unit: none (text). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.comment_text IS
'Text of the comment, copied from auction_comments.comment_text when scored. Filled on every row, 20 .. 14,496 characters, mean 178 (2026-10-07); the llama script skips comments under 20 characters and the heuristic run kept the same floor. A duplicate of public auction text at scoring time, so later edits or retirements of the source are not reflected here; the table is closed to anon and authenticated (0 rows visible). Free public text that can mention people, so values are not quoted. Unit: none (text). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.comment_length IS
'Length of comment_text in characters, written by the scorer. Equals char_length(comment_text) on every row (2026-10-07); 20 .. 14,496. Averaged into author_personas.avg_comment_length by aggregate_author_personas(). Unit: characters (integer). Grain: one comment. Clock: as of the scoring.';

-- ── Tone ────────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.comment_persona_signals.tone_helpful IS
'How helpful the comment is, 0 .. 1 (1 very helpful). Filled on every row. llama3.1:8b rows hold the model rating on a 0 .. 10 scale divided by 10 (steps of 0.1: 10 distinct values, 0.00 .. 0.90, mean 0.37); heuristic-v1 rows hold rule scores (71 distinct values, 0.01 .. 0.80, mean 0.28), so the two writers are not comparable. The llama script falls back to 0.50 when the model reply has no number; no row carries the full fallback set. Averaged into author_personas.avg_tone_helpful. Unit: score, 0 .. 1 (numeric(3,2)). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.tone_technical IS
'How technical the comment is, 0 .. 1 (1 very technical, 0 casual). Filled on every row. llama3.1:8b rows 0.10 .. 0.90 in steps of 0.1 (mean 0.49); heuristic-v1 rows 100 distinct values, 0.01 .. 1.00, mean 0.18. The llama script falls back to 0.50 when the reply has no number. aggregate_author_personas() uses its mean above 0.6 with an expert or professional expertise to name a helpful_expert. Unit: score, 0 .. 1 (numeric(3,2)). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.tone_friendly IS
'How friendly the comment is, 0 .. 1 (1 warm, 0 cold). Filled on every row. llama3.1:8b rows 0.00 .. 1.00 in steps of 0.1 (mean 0.44); heuristic-v1 rows 8 distinct values, 0.10 .. 1.00, mean 0.57. The llama script falls back to 0.50 when the reply has no number. Averaged into author_personas.avg_tone_friendly. Unit: score, 0 .. 1 (numeric(3,2)). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.tone_confident IS
'How confident the comment sounds, 0 .. 1 (1 very confident, 0 uncertain). Filled on every row. llama3.1:8b rows 0.00 .. 1.00 in steps of 0.1 (mean 0.67); heuristic-v1 rows only 5 distinct values, 0.40 .. 1.00, mean 0.75, so it separates little. The llama script falls back to 0.50 when the reply has no number. Averaged into author_personas.avg_tone_confident. Unit: score, 0 .. 1 (numeric(3,2)). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.tone_snarky IS
'How snarky or sarcastic the comment is, 0 .. 1 (1 very sarcastic, 0 sincere). Filled on every row. llama3.1:8b rows 0.00 .. 0.90 in steps of 0.1 (mean 0.14); heuristic-v1 rows 7 distinct values, 0.10 .. 0.80, mean 0.11. The llama script falls back to 0.20 when the reply has no number. aggregate_author_personas() names a critic when the mean exceeds 0.5. Unit: score, 0 .. 1 (numeric(3,2)). Grain: one comment. Clock: as of the scoring.';

-- ── Expertise and intent ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.comment_persona_signals.expertise_level IS
'Expertise the comment shows, free text with no CHECK, filled on every row: enthusiast 145,786 (65.0%), novice 60,228, professional 12,375, expert 5,980 (2026-10-07). The llama script writes enthusiast when the model reply names none of the four words, so on those rows enthusiast can be a default. aggregate_author_personas() takes the most frequent value per author. Unit: none (text; the creating comment lists novice, enthusiast, expert, professional). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.expertise_areas IS
'Subject areas of the expertise, a text array (the creating file gives porsche, air-cooled, restoration as examples). NULL on every row (2026-10-07); neither writer sets it. Unit: none (text array). Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.shows_specific_knowledge IS
'Whether the comment shows specific knowledge (the creating file groups it with expertise). NULL on every row (2026-10-07); neither writer sets it. Unit: boolean. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.cites_sources IS
'Whether the comment cites a source. NULL on every row (2026-10-07); neither writer sets it. Unit: boolean. Grain: one comment. Clock: n/a.';
COMMENT ON COLUMN public.comment_persona_signals.intent IS
'Why the commenter is there, free text with no CHECK, filled on every row: socializing 143,135 (63.8%), learning 35,349, buying 24,471, selling 14,195, critiquing 5,125, advising 2,094 (2026-10-07; the creating file also lists showing_off, which no row holds). The llama script writes socializing when the model reply names none of the six words, so on those rows it can be a default. aggregate_author_personas() takes the most frequent value per author. Unit: none (text). Grain: one comment. Clock: as of the scoring.';

-- ── Trust signals (heuristic-v1 only) ───────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.comment_persona_signals.is_serious_buyer IS
'Whether the commenter reads as a serious buyer. NULL on the 952 llama rows (the script does not write it) and set on the 223,417 heuristic-v1 rows, true on 24,129 (10.8%, 2026-10-07). On every heuristic row it equals intent = buying, so it restates intent and is not a separate signal. aggregate_author_personas() uses its any-true with a buying intent to name a serious_buyer. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.is_tire_kicker IS
'Whether the commenter reads as interested without intent to buy. NULL on the 952 llama rows and set on the 223,417 heuristic-v1 rows, true on 1,693 (0.76%, 2026-10-07): 249 on learning intent and 1,444 on other intents. Read by nothing. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.is_seller_shill IS
'Whether the commenter reads as a shill for the seller. NULL on the 952 llama rows and set on the 223,417 heuristic-v1 rows, true on 13,901 (6.2%, 2026-10-07). On every heuristic row it equals intent = selling, so it marks comments classed as selling intent and holds no evidence of an undisclosed link to the seller. Read by nothing. Unit: boolean. Grain: one comment. Clock: as of the scoring.';

-- ── Engagement behaviors ────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.comment_persona_signals.asks_questions IS
'Whether the comment asks a question. Never NULL, and false is a default: the llama script writes false whenever the model reply does not match yes, so false is not a measured no. True on 36,945 rows (16.5%, 2026-10-07): 139 llama rows and 36,806 heuristic-v1 rows, where it is true on every learning-intent row (35,290) and on 1,516 others. Counted into author_personas.comments_with_questions. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.answers_questions IS
'Whether the comment answers a question. Never NULL; false is a default (see asks_questions). True on 27,090 rows (12.1%, 2026-10-07): 614 llama rows and 26,476 heuristic-v1 rows. Counted into author_personas.comments_with_answers. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.gives_advice IS
'Whether the comment gives advice. Never NULL; false is a default (see asks_questions). True on 4,466 rows (2.0%, 2026-10-07): 210 llama rows and 4,256 heuristic-v1 rows. Counted into author_personas.comments_with_advice. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.makes_jokes IS
'Whether the comment makes a joke. Never NULL; false is a default (see asks_questions). True on 6,555 rows (2.9%, 2026-10-07): 54 llama rows and 6,501 heuristic-v1 rows. Not counted into author_personas. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.critiques_others IS
'Whether the comment critiques another commenter or the seller. Never NULL; false is a default (see asks_questions). True on 5,888 rows (2.6%, 2026-10-07): 179 llama rows and 5,709 heuristic-v1 rows. Counted into author_personas.comments_critical. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.supports_others IS
'Whether the comment supports another commenter. Never NULL; false is a default (see asks_questions). True on 31,068 rows (13.8%, 2026-10-07): 356 llama rows and 30,712 heuristic-v1 rows. Counted into author_personas.comments_supportive. Unit: boolean. Grain: one comment. Clock: as of the scoring.';

-- ── Claims (heuristic-v1 only) ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.comment_persona_signals.makes_claims IS
'Whether the comment makes a factual claim. NULL on the 952 llama rows and set on the 223,417 heuristic-v1 rows, true on 4,060 (1.8%, 2026-10-07). Read by nothing. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.claims_verifiable IS
'Whether the claims could be checked. NULL on the 952 llama rows and set on the 223,417 heuristic-v1 rows, true on 19,021 (8.5%, 2026-10-07); only 1,147 of those also have makes_claims true (17,874 are true without a claim), so it is not conditional on a claim being made. Read by nothing. Unit: boolean. Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.admits_uncertainty IS
'Whether the comment admits uncertainty. NULL on the 952 llama rows and set on the 223,417 heuristic-v1 rows, true on 18,531 (8.3%, 2026-10-07). Read by nothing. Unit: boolean. Grain: one comment. Clock: as of the scoring.';

-- ── Meta ────────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.comment_persona_signals.extracted_at IS
'When the comment was scored: default now(); nullable in the catalog and filled on every row. Two windows: 952 rows on 2026-01-30 00:15 .. 01:19 (the llama run) and 223,417 rows on 2026-04-13 05:24 .. 05:29 (the heuristic-v1 run). Our scoring time, not the time the comment was posted (that is auction_comments.posted_at). aggregate_author_personas() stores its minimum and maximum per author as author_personas.first_seen and last_seen, so those are scoring times, not the author first and last comment. Unit: timestamptz. Grain: one comment. Clock: ingest time (the scoring).';
COMMENT ON COLUMN public.comment_persona_signals.model_used IS
'Stamp of the scorer, free text, filled on every row: llama3.1:8b 952 rows (scripts/persona-assembly-line.sh hard-codes it and the local Ollama server it calls) and heuristic-v1 223,417 rows (a run that is not in the repo). It is the only way to tell which columns a row can have: the trust and claim booleans are NULL on llama rows. Unit: none (text). Grain: one comment. Clock: as of the scoring.';
COMMENT ON COLUMN public.comment_persona_signals.confidence IS
'Confidence the writer gave the row, 0 .. 1, numeric(3,2): 0.70 on every llama row (a constant in the script) and 0.55 on every heuristic-v1 row (2026-10-07). A constant per writer, not a per-row measure. Not read by aggregate_author_personas(). Unit: probability, 0 .. 1 (numeric(3,2)). Grain: one comment. Clock: as of the scoring.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.comment_persona_signals'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'comment_persona_signals: every column has a comment';
  ELSE
    RAISE NOTICE 'comment_persona_signals columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
