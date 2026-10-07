-- 20261007121000_stack_s61_funding_fit.sql
--
-- Stack registry (20261007014500, PR #721): stack S61 version 1, "Funding opportunity fit", the opportunity stack of case
-- ledger 13.9 and 13.9.1 (owner, 2026-10-07 04:30Z and 05:00Z): "opportunity as a logical conclusion with confidence
-- scores based on nodes of data", "how far we are from the opportunity", and "this is the seed round to develop this
-- into a model for entities". A funding program is an organization with published criteria; its awards are dated
-- outcome rows keyed to awardee organizations, places and programs; the applicant is an organization in the same ledger
-- with the criteria as keyed claims. The distance is the criteria not met plus the fit to the winners' cohort, shown
-- with the missing keys before any number (13.1 point 3). Status measured: the needs are written and stack_coverage
-- measures them; nothing is built beyond the log's intake path.
--
-- WHAT EXISTS ON 2026-10-07 (read live, 06:00Z..06:15Z):
--   fn_schema_proposal_apply registers an approved add_source proposal with its declared reader (PR #766, live 06:02Z).
--   Proposals open, filed 06:05Z by the night agent: 8684c1c9 add_source sbir-gov-awards (SBIR.gov bulk award file,
--   tier 1, trust 0.90), 97b3c2d5 add_source nsf-awards-api (NSF awards API, tier 1, trust 0.95), 6fc618ee
--   add_observation_kind funding_award. Until the owner approves them no award row exists.
--   scripts/data/declared-source-reader.mjs maps each award to one ingest-observation payload: kind activity,
--   structured_data.kind_detail funding_award, relation awarded_to, subject the funder organization. Dry runs: 2,927 of
--   2,927 NSF Phase I awards since award year 2015 from the SBIR.gov file; 3,342 of 7,926 NSF API records (Phase I,
--   fiscal years 2015-2025); no missing date or identifier.
--   No organizations row for the National Science Foundation: create-org-from-url needs a signed-in user.
--   Applicant: organizations f32ea08c (Nuke); the program's criteria are not recorded as claims about it.
--
-- NEEDS (15, across all nine layers). The registry reads them structurally (stack_coverage comment).
--   log        observation_sources, observation_extractors, vehicle_observations (tables). The three tables exist with
--              rows, so these read present before any award lands; the notes name the rows the stack needs. The lead's
--              draft named the registry rows as an intake need; an intake need reads the newest value of one clock column
--              across a table and cannot single out two rows, so they are table needs with the rows in the note.
--   key        awardee organization key, research institution key, person subject (abstract, missing)
--   dimension  funding program and phase, funding topic code (abstract, missing: staged as text in structured_data);
--              place entity (abstract, existing substrate) for the awardee's state
--   fold       awards per organization per year (abstract, missing)
--   baseline   award baseline by state, topic and year (abstract, missing)
--   residual   applicant distance from award winners (abstract, missing)
--   feature    funding criteria coverage for an applicant (abstract, missing): employee count, state of registration,
--              ownership share, PI hours, place of work, as owner-input observations on f32ea08c
--   prediction funding invitation probability (abstract, missing; a thesis vein later)
--   outcome    pitch result (abstract, missing)
-- Coverage will read 3 of 15 (0.2): the three log tables. That number counts tables, not award rows.
--
-- SUBSTRATES: eleven new rows, undeclared (declared_table NULL), so every need on them reads missing; 'place entity' and
-- the registry's grammar are reused. Declaring a table for a substrate later moves this stack with no new version.
-- SCHEMA_LAW: no table, column, kind, vocabulary value or function. Rows only, in the registry's own tables, by the
-- registry's writer (a migration file). Every insert is idempotent (ON CONFLICT DO NOTHING); a replay adds nothing.
-- No owner words beyond the ledger's quotes; no private data (the applicant is named by id).
-- Contract: supabase/sql/test_stack_registry.sql (PostgreSQL 17, CI job metric-fold-health-contract), extended to apply
-- this file after SA v2 and check the version row, its needs, its substrates, the reader and the replay.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

INSERT INTO public.stack_substrates (substrate, note, source, registered_by)
VALUES
  ('awardee organization key',
   'An award''s awardee keyed to organizations.id by name, UEI or DUNS. On 2026-10-07 the awardee is text in the award row''s structured_data (name, city, state, zip; UEI on NSF API rows, DUNS on some SBIR.gov rows). The organization resolver is the candidate reader (case ledger 13.9.1 point 4).',
   'data-machine-cases.md 13.9.1 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('research institution key',
   'An STTR award''s research institution keyed to organizations.id. SBIR.gov rows name it (RI Name; 252 distinct institutions on NSF Phase I awards since 2015, docs/POSITIONING.md 2026-10-07); NSF API rows name it only in the abstract.',
   'data-machine-cases.md 13.9.1 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('person subject',
   'A first-class person subject for observations, distinct from user (an auth account) and external_identity (a platform handle). Named as the structural blocker in docs/features/organization-entity/SPEC.md 1.5. Award PIs and co-PIs are people.',
   'docs/features/organization-entity/SPEC.md 1.5; data-machine-cases.md 13.9.1 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('funding program and phase',
   'Program (SBIR, STTR) and phase (Phase I, Phase II, Fast-Track) of an award as keyed values. Staged as text in structured_data (program, phase, fund_program_name) on 2026-10-07.',
   'data-machine-cases.md 13.9 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('funding topic code',
   'The topic of an award: the SBIR.gov topic code (NSF codes such as AI, BT, MD) or the NSF program element (code and name). Staged as text in structured_data (topic_code, program_element) on 2026-10-07.',
   'data-machine-cases.md 13.9 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('awards per organization per year',
   'Awards, amounts and phases folded per awardee organization per fiscal year, with employees at award and the later Phase II. Needs the awardee organization key.',
   'data-machine-cases.md 13.9.1 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('award baseline by state, topic and year',
   'The shape of the winners'' cohort: awards per state, topic and fiscal year, and employees at award. Winners only: the funding rate is published only in aggregate (about 16% of NSF Phase I proposals, 2008-2017).',
   'data-machine-cases.md 13.9, 13.9.1; docs/POSITIONING.md (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('applicant distance from award winners',
   'One applicant''s keys measured against the award baseline (team size, state, topic, track): the residual of the opportunity stack.',
   'data-machine-cases.md 13.9 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('funding criteria coverage for an applicant',
   'A program''s published criteria held as keyed, dated claims about one applicant (employee count, state of registration, ownership share, PI hours, place of work) and the share met. For NSF SBIR/STTR the criteria are in solicitation NSF 26-510.',
   'data-machine-cases.md 13.9 (2026-10-07); docs/POSITIONING.md Path and clock', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('funding invitation probability',
   'P(invited to a full proposal) and P(funded) for an applicant and a program, pre-registered as a thesis vein and graded on the outcome. The pitch-to-invitation rate is not published.',
   'data-machine-cases.md 13.9 (2026-10-07)', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'),
  ('pitch result',
   'The answer to a Project Pitch (invited or not) and the later award decision, each dated, recorded by the applicant.',
   'data-machine-cases.md 13.9 (2026-10-07); docs/POSITIONING.md Path and clock', 'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07')
ON CONFLICT (substrate) DO NOTHING;

INSERT INTO public.stacks
  (stack_id, version, name, question, family, path, external_dimensions, who_cares, scoring, status,
   thesis_vein_id, thesis_vein_version, source, supersedes_version, registered_by)
VALUES (
  'S61', 1, 'Funding opportunity fit',
  'How far is the company from a given funding program''s award, and which keys are missing?',
  NULL,
  ARRAY[
    'log: staged, not landed. Each award is one observation (kind activity, structured_data.kind_detail funding_award, relation awarded_to) on the funder organization, from two declared sources: sbir-gov-awards (the SBIR.gov bulk award file) and nsf-awards-api (the NSF awards API), read by scripts/data/declared-source-reader.mjs through ingest-observation. On 2026-10-07 both are add_source proposals awaiting approval; dry runs map 2,927 and 3,342 NSF Phase I awards. Readers: vehicle_observations, observation_sources, observation_extractors',
    'key: missing, named. Awardee name, UEI or DUNS to organizations.id; STTR research institution to organizations.id; PI to a person subject, which does not exist (docs/features/organization-entity/SPEC.md 1.5). The funder is the subject of every award row; its organization row does not exist yet',
    'dimension: staged as text. Program (SBIR, STTR), phase, topic code or NSF program element, and the awardee''s state, city and zip sit in structured_data; none is a keyed dimension yet',
    'fold: missing, named. Awards, amounts and phases per awardee per fiscal year, with employees at award and the later Phase II',
    'baseline: missing, named. Awards per state, topic and fiscal year: the shape of the winners. Winners only; the odds need the proposal denominator, published only in aggregate',
    'residual: missing, named. The applicant''s keys against the winners'' baseline: team size, state, topic, track (SBIR or STTR)',
    'feature: missing, named. The program''s criteria as keyed claims about the applicant, organization f32ea08c first: employee count, state of registration, ownership share, PI hours, place of work; each an owner-input observation, none recorded',
    'prediction: missing, named. P(invited to a full proposal) and P(funded) for an applicant and a program, as a pre-registered thesis vein; the pitch-to-invitation rate is not published',
    'outcome: missing, named. The Project Pitch answer (invited or not) and the award decision, dated, recorded by the applicant'
  ]::text[],
  ARRAY[
    'a program''s published eligibility criteria (NSF SBIR/STTR: solicitation NSF 26-510)',
    'the historical Phase I funding rate, aggregate only (about 16%, 2008-2017; National Academies, SSTI)'
  ]::text[],
  'The owner deciding whether and how to pitch a program (SBIR or STTR); then any organization in the ledger measured against a program.',
  'Graded when the pitch result arrives: the pre-registered invitation probability against invited or not, then the funding probability against the award decision.',
  'measured',
  NULL, NULL,
  'data-machine-cases.md 13.9 and 13.9.1 (owner, 2026-10-07 04:30Z and 05:00Z); docs/POSITIONING.md "What winners look like" and "Path and clock"; schema_proposals 8684c1c9 (sbir-gov-awards), 97b3c2d5 (nsf-awards-api), 6fc618ee (funding_award), filed 2026-10-07 06:05Z; PR #766 (the add_source drain).',
  NULL,
  'claude-code (Opus 5.5) night-expansion for the owner, 2026-10-07'
)
ON CONFLICT (stack_id, version) DO NOTHING;

INSERT INTO public.stack_needs (stack_id, version, layer, kind, object, denominator, fresh_within, note)
SELECT 'S61', 1, v.layer, v.kind, v.object, v.denominator, v.fresh_within, v.note
FROM (VALUES
  ('log',        'table',    'observation_sources',                        NULL, NULL::interval, 'the registry rows sbir-gov-awards and nsf-awards-api (add_source proposals 8684c1c9 and 97b3c2d5, open 2026-10-07); a table-level reading, present before the two rows exist'),
  ('log',        'table',    'observation_extractors',                     NULL, NULL,           'their declared readers sbir-gov-awards-declared-reader and nsf-awards-api-declared-reader, registered with the sources on approval'),
  ('log',        'table',    'vehicle_observations',                       NULL, NULL,           'each award as kind activity, structured_data.kind_detail funding_award, on the funder organization; 0 rows on 2026-10-07, dry runs map 2,927 and 3,342'),
  ('key',        'abstract', 'awardee organization key',                   NULL, NULL,           'awardee name, UEI or DUNS to organizations.id; text in structured_data today'),
  ('key',        'abstract', 'research institution key',                   NULL, NULL,           'STTR research institution to organizations.id; the track is a function of this edge (case ledger 13.9 point 2)'),
  ('key',        'abstract', 'person subject',                             NULL, NULL,           'PI to a person subject; the structural blocker in docs/features/organization-entity/SPEC.md 1.5'),
  ('dimension',  'abstract', 'funding program and phase',                  NULL, NULL,           'program and phase as keyed values; staged as text'),
  ('dimension',  'abstract', 'funding topic code',                         NULL, NULL,           'SBIR.gov topic code or NSF program element; staged as text'),
  ('dimension',  'abstract', 'place entity',                               NULL, NULL,           'the awardee''s state, city and zip as a place; staged as text'),
  ('fold',       'abstract', 'awards per organization per year',           NULL, NULL,           'awards, amounts and phases per awardee per fiscal year, with employees at award'),
  ('baseline',   'abstract', 'award baseline by state, topic and year',    NULL, NULL,           'the winners'' cohort shape per state, topic and fiscal year'),
  ('residual',   'abstract', 'applicant distance from award winners',      NULL, NULL,           'the applicant''s team size, state, topic and track against the baseline'),
  ('feature',    'abstract', 'funding criteria coverage for an applicant', NULL, NULL,           'employee count, state of registration, ownership share, PI hours, place of work for organization f32ea08c, as owner-input observations; none recorded on 2026-10-07'),
  ('prediction', 'abstract', 'funding invitation probability',             NULL, NULL,           'P(invited) and P(funded) per applicant and program; a thesis vein later'),
  ('outcome',    'abstract', 'pitch result',                               NULL, NULL,           'the Project Pitch answer and the award decision, dated')
) AS v(layer, kind, object, denominator, fresh_within, note)
WHERE EXISTS (SELECT 1 FROM public.stacks s WHERE s.stack_id = 'S61' AND s.version = 1)
ON CONFLICT (stack_id, version, layer, object) DO NOTHING;

COMMIT;
