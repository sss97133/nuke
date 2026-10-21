-- =====================================================================================================
-- BLOCK M1w  supabase/migrations/20261021221000_image_evidence_writers_and_readers.sql
-- feat(db): image evidence writers, owner decisions and day readers
--
-- Second of three. Needs M1a. Writes evidence rows only: nothing here touches vehicle_images, vehicles,
-- image_observations or any other testimony table. Everything the Thu load, the review sheet and the evidence-level
-- exit test need is here; promotion is M1p.
-- Caller rule: every writer refuses unless the session came in through PostgREST (session_user = 'authenticator')
-- with the service_role JWT AND the PostgREST role setting service_role (v4: a JWT claim is a setting any SQL can
-- change; the role setting cannot be changed inside a SECURITY DEFINER function). (v8) decide_evidence is the
-- exception: it accepts ONLY the owner's own JWT with the role setting 'authenticated' and (v5) a step-up (aal2)
-- session, (v6) which the auth server's own session records must show was stepped up with an established second factor
-- in the last 15 minutes. No job decides: service_role has no EXECUTE on it, and its body refuses any other caller
-- ('agent_channel_disabled'). q.sh (session_user postgres) is refused even after `SET request.jwt.claim.role`. M1a's
-- guards refuse any row whose outermost caller is not one of these writers.
-- (v8) DECISIONS ARE HIS HAND ONLY. The agent channel of v3-v7 (a job transcribing his chat answer into an
-- 'agent:<session>' decision) is removed: no 'agent:' decided_by row can be written. His chat answers are still stored
-- word for word against the sheet rows they answer (evidence_record_answers: verbatim, sha256, an optional structured
-- reading, one transcription per message); storing an answer decides nothing and changes no reader. He confirms them
-- himself, from his own step-up session in the app, one at a time or in bulk (evidence_answers_to_confirm lists what
-- waits for him). Owner statements ("the shop paid") and owner capture times ("no, it was the 17th") are written only
-- by decide_evidence on that confirmation, never by a job (owner_answer_missing).
-- (v4, rules-violation v3; v5) The preflight STOPs ("get vehicle day records", "evidence status", "evidence
-- candidates for images", "image appearances") are answered in M1a's header.
-- (v5) What changed from v4, by objection (DESIGN-v5 "Changes from v4"):
--   * every writer, decision lookup and reader is keyed by user (readers v4 #1, #2);
--   * an agent decision is bound to his ANSWER (rules-channels v4 #1, #2); owner_statement links cite his stored
--     answer (#5); a pass names only third parties as payer/payee (#4); record_day_context keeps decided rows (#8);
--   * money coverage per payment-source account (readers #3) and the other reader fixes (#4-#9);
--   * writers return every id they create, for the out-of-database manifest (guard-mechanism v4 #1, PLAN M10b).
-- (v6) What changed from v5, by objection (DESIGN-v6 "Changes from v5"; AC = agent-channel v5, RU = readers-user-scope
-- v5):
--   * a review-sheet row asks ONE question: evidence_open_run stores, per row, the question (the decision kind), what it
--     asks (the place, or who paid), the place it asks about, the frame role or money class it is about and the keys
--     and images it covers (AC1). An answer is checked against that row when it is stored: it may name only a place of
--     the row's own dimension, "yes" names the asked place and "no" never does (AC4), and a vehicle it names is his or
--     on the row (AC11, AC-scan: looked up by uuid);
--   * decide_evidence decides only the row's question; a placed answer confirms only at the place he named and rejects
--     only the asked target or a target in an exclusive slot (the photo's subject, an unallocated placement of one
--     payment, one album, one account), never an also-in-frame truck, an allocated share, a publication or a time
--     (AC2, AC3, AC12); "no, it is Y" keeps the frame role (AC5) and the money role (AC7), confirms through the same
--     checks, and uses an owner_review row instead of a row a pass wrote after the sheet (AC6); a row the passes
--     re-wrote with the same question since the sheet is still the row he was asked about (AC13, AC15);
--   * "newer than his answer" is measured from when the sheet was made, not when the answer was stored (AC8);
--   * one chat message is transcribed once (AC10);
--   * an owner statement cites a "who paid / who received" row about that money, sits where that row's target sits,
--     names the row target it answers and the entity he named (AC9);
--   * the human channel checks the auth server's records: an aal2 session row with a verified second factor at least
--     7 days old, stepped up in the last 15 minutes; the factor and step-up time are stamped (AC-aal);
--   * publication status and "decided since" are per user, and only the photo's own user or a user who can edit its
--     vehicle decides its publication (RU1); work sessions are read for the reading user only (RU2); a windowed read
--     never sums an undated payment (RU3); a closed account or a third party's account no longer holds every
--     unattributed assertion at awaiting_statement, and a lagging account is asked about (RU4); a confirmed capture
--     time stands against an identical or not-stronger re-proposal and rule 'owner' needs his cited answer (RU5);
--     a read names its user (RU6); merge lineage is resolved the same way in every session (RU7); every list in the
--     readers has a total order (RU8); coverage dates and accounts are validated (RU9).
-- (v7) What changed from v6, by objection (DESIGN-v7 "Changes from v6"; D = decide-v6, F = readers-v6):
--   * a successor is "the row he was asked about" only when its meaning is unchanged: a claim's asserted value and
--     wording, a link's dates, category, kind and label, a candidate's exact verdict and image class (D1);
--   * an owner statement is the money its who-paid row asked about: that row's one target, its payment key (or his
--     word as the key when it has none), its direction, its amount, its date (or none), its category (or none) (D2);
--   * "newer than his answer" is measured from the FIRST sheet that asked the same question about the same rows and
--     was not answered on that row, so a re-opened copy of a sheet cannot move the bound later (D3);
--   * a chat message has one spelling: '<source>:<message id>' with no path, and the message id is unique across
--     every answers run of every user (D4, F8);
--   * a row whose own targets place nothing (a "no truck" verdict, an unplaced card line) is a yes/no row: asked
--     place 'none' (D6);
--   * a relation another user's truck enters scope by must be confirmed; answers and decisions use only confirmed
--     relations (D7);
--   * two no-row keys of different kinds (vin: and label:/album:), or a row and the vin: key of its own VIN, may be
--     one truck: neither an implied nor a placed reject crosses between them (D5);
--   * capture times: his "no" no longer freezes the photo on the rejected day; a rejected claim is replaced by a
--     newer one and the photo reads undated meanwhile; an owner claim replaces another only on his newer word; every
--     skipped row is counted (F1, F2);
--   * publication is decided only by the photo's own user (its user, else its vehicle's uploader, else the owner of
--     record) (F3);
--   * the candidate reader plans per call with the real image count and computes each photo's day without a
--     self-join (F4);
--   * his who-paid statement closes who_paid / who_received (F5); support follows a superseded link to its own
--     successor (F6); an uncovered account is waited on by name, "closed" is the newest run's word, and coverage
--     cannot be in the future (F7); every reader checks its user, and lineage is told only for vehicles in the
--     caller's scope (F8).
-- (v8) What changed from v7 (DESIGN-v8 "Changes from v7"; lead directive: the agent channel does not ship):
--   * decide_evidence takes the owner's own step-up session only. A service-role caller is refused twice: no EXECUTE
--     grant, and the body raises 'agent_channel_disabled' (should a grant ever return). The answer-binding helpers
--     that existed only for agent decisions are gone (evidence_row_covers, evidence_answer_allows, evidence_first_asked,
--     evidence_human_decided_since, evidence_owner_time_cited, evidence_time_word_at), and so are the agent checks
--     (human_decision_newer, human_decision_stands, the first-asked bound);
--   * evidence_record_answers stores his words only: verbatim, sha256 and, when the transcriber gives one, a structured
--     reading (checked as before, so a reading the app may show him is never inverted or outside his scope); with no
--     reading the row is stored as {"decision":"unsure","unread":true}. Storing writes no decision;
--   * a who-paid row is answered by his own decision in the app (p_answer {"entity_key"} citing his stored chat answer):
--     decide_evidence writes the owner statement (the asked money, evidence_statement_for, checked by
--     evidence_statement_problem), its support row on an acquisition/sale claim, and his confirmation of the
--     statement; the row's own target is not decided by it. A who-paid row asks only about money with no payment
--     source (no payment key: a jacket line, an unpaid order) or about an acquisition/sale claim; a payment with a
--     source line gets its payer from the account map. propose_evidence_links refuses every owner statement and
--     'owner:' key (owner_answer_missing);
--   * "no, it was the <day>" on a capture time is his decision in the app (p_answer {"captured_on"}): decide_evidence
--     rejects the claim, writes the owner claim for that day and confirms it. propose_capture_time_claims refuses rule
--     'owner' (owner_answer_missing);
--   * implied rejections, "his own word" in the readers (a day he rejected, a truck he rejected for a photo) and the
--     writers' "already decided" checks count human decisions only;
--   * evidence_answers_to_confirm (new, read-only): his stored answers with each sheet row's targets, their current
--     rows, whether a re-written row still asks the same question (evidence_same_question, evidence_successor_of,
--     evidence_current_of), and when he last decided it, for the app's "you said X in chat" confirmations; a decision
--     that cites a stored answer is refused per target on a row re-written with another meaning since
--     (evidence_rewritten_from, 'row_changed_since_answer').
-- (v9) What changed from v8 (DESIGN-v9 "Changes from v8"; the v8 four-lens pass: writers W1-W4 and M1-M8, readers
-- R-T1-R-T3, R-P1, R-R3, ship F1):
--   * a capture time he rejected stays rejected: the same instant proposed again for that photo, whichever claim his
--     "no" sits on (current or since replaced), is 'already_rejected' and never machine-confirmed (W1);
--   * his answers are stored per chat message: a reply spread over several messages is stored message by message on
--     the sheet he was sent (several answers runs per sheet: M1a's one-per-sheet index er_one_answers_per_sheet is
--     dropped here and replaced by the plain index er_answers_by_sheet, the one change to an M1a object, made while
--     evidence_runs is empty); only on a sheet that was sent (closed 'done') and only for a message written after it
--     was sent (p_message_at); a decision citing a stored answer cites his latest answer to that row and lands only on
--     the row's own targets, a same-question successor of one, or (a row that names a slot, not a row) a row of his
--     in that slot ('not_on_answered_row', 'row_changed_since_answer'); a re-ask row (reask_of
--     'review:<sheet>#<row>') copies the original row as it was frozen (W2, M1-M4, M8);
--   * a who-paid row never asks about a payment source line (bank, card or ledger line, payment event, QB
--     transaction, P&L line), keyed or not; his confirmed statement whose money a keyed payment carries is listed
--     under 'stated', never summed, and its payer still closes who_paid (W3);
--   * a pass may not supersede a claim his who-paid statement answers; his newer statement supersedes every statement
--     answering the claim or any row it was re-written from (W4, M7);
--   * his word on a photo and a truck is read across the truck's identity (merge lineage and his confirmed
--     same_vehicle_as pairs, evidence_truck_key): the writer returns 'already_rejected' for a row on a truck he said
--     no to, or at a place other than the subject he confirmed; the readers read his latest word per photo, truck and
--     frame role (human or implied), give 'rejected' to a row he answered through another row or by confirming
--     another subject, and the scoreboard view and evidence_candidate_status read the day reader's own status (R-T1,
--     R-T2, R-T3);
--   * evidence_answers_to_confirm probes decisions by target (R-P1) and lists each answer's message time; a signed-in
--     role with no user id is refused (R-R3); account-map and owner-time skips are itemized (M5, M6); the file applies
--     twice (F1).
-- (v11) What changed from v10 (DESIGN-v11 "Changes from v10"; the v10 round, patch level):
--   * the day reader hands evidence_answered_elsewhere only the photos that carry his confirmed subject (a read with no
--     statistics cost 1.4 s at 10x, v9 0.8 s);
--   * (v11 patch, before merge) decide_evidence refuses another user's row ('not your evidence', 42501) right after loading
--     it, before p_expected, a claim's day, a link's kind, a photo's state or a who-paid row's money is compared (79bfe891
--     answered another user's candidate with its photo's current vehicle and his "no, it was <day>" with the claim's day);
--     every target kind now refuses with that one message (a photo's was 'photo % is not yours to publish');
--   * (v11 patch, before merge) propose_image_candidates' "same row again" test compares the stored evidence (a photo
--     filed on a merged-away row was re-written on every run); a sheet asks one question once about one target, in any
--     shape (re-check N1); acquisition_conflict asks once per group of claims within 30 days of each other (N2);
--   * a capture-time proposal waits on the photo's current claim lock before its day check (R1: a Photos join racing
--     his "no" to that day was machine-confirmed); a candidate stores the row the photo is filed on when that row is the
--     truck the pass names (R2: photos a merge did not move); a sheet asks a question once (R3);
--   * 'stated' is lists only (no total of statements): each statement dated by what it answers, with 'counts'; only a
--     counting statement is covered; a windowed read lists statements dated in it and the undated ones under
--     stated.undated (money F1, F2); acquisition_conflict only for overlapping deals (M1).
-- (v10) What changed from v9 (DESIGN-v10 "Changes from v9"; the focused round on v9: answers A1, A2, A4; trucks F1-F3;
-- money F1-F5; the lead's money decision):
--   * in this first ship an owner statement is never summed: vehicle_accounting_evidence bands keyed payments only and
--     lists every confirmed statement under 'stated' (with an informational covered_cents); 'acquisition_conflict' asks
--     which of two current acquisition (or sale) claims is the deal (money F1-F4);
--   * one list of payment sources, evidence_is_payment_source: a journal entry is one, a P&L line is not (money F3, F5);
--   * a re-ask keeps the question's first asking (asked_first): the latest-answer rule and the answers reader read one
--     question across sheets (A1); on a slot row a confirm citing "yes, it is <place>" lands only at that place, and on
--     a money slot row only on a placement (not a contradiction or a share of that payment) (A2);
--     full indexes for the answers reader's slot probes (A4);
--   * his "no" to a capture time is about the day: any instant on that day is 'already_rejected' and the batch gate
--     skips it (trucks F1); a candidate stores the photo's own vehicle row, never the merge survivor (trucks F2); the
--     day reader's "answered by his confirmed subject" test runs in a definer helper about his own rows, and a row with
--     no VIN is not known to differ from a VIN (trucks F3).
-- =====================================================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

-- (v6, AC10; v7, D4/F8) one stored transcription per chat message: the message id (the part of message_ref after
-- '<source>:', the transcript's own id for that message) is unique across every user's answers runs, so a copied
-- sheet, a second spelling or a second user cannot carry a second reading of the same words. (v8) A stored answer
-- decides nothing; the index keeps the record of his words single for the app's confirmations and for M10b.
-- (v9, F1) Every index and view here is created IF NOT EXISTS / OR REPLACE: the deploy helper can apply this file
-- twice, and the second apply changes nothing.
CREATE UNIQUE INDEX IF NOT EXISTS er_one_answers_per_message ON public.evidence_runs ((split_part(config->>'message_ref', ':', 2)))
  WHERE run_kind = 'review_answers';

-- (v9, W2) A reply he spreads over several chat messages is stored message by message on the sheet he was sent: one
-- answers run per message, several per sheet. M1a's er_one_answers_per_sheet (one answers run per sheet) is dropped and
-- replaced by a plain index for the lookup by sheet. This is the one change M1w makes to an M1a object; it is made while
-- evidence_runs is empty (0 rows live on 2026-10-20), and PR-1's own contract test applies M1a alone.
DROP INDEX IF EXISTS public.er_one_answers_per_sheet;
CREATE INDEX IF NOT EXISTS er_answers_by_sheet ON public.evidence_runs ((config->>'sheet_run')) WHERE run_kind = 'review_answers';

-- (v7, F1) the candidate reader reads every capture-time claim of an image (current and since replaced) to find the
-- days his own word rejected ((v8) his human decisions); one index on M1a's table (empty at deploy)
CREATE INDEX IF NOT EXISTS ictc_user_image ON public.image_capture_time_claims (user_id, image_id);

-- (v10, A4) the answers reader probes every candidate of a photo, and every link of a payment or source key, his slot
-- rows name, current or since replaced: M1a's indexes on those columns are partial (current rows only), so the probe
-- was a sequential scan per answer row (8,000 answer rows over 50,000 candidates passed the app's 15 s limit). Full
-- indexes on M1a's tables (empty at deploy).
CREATE INDEX IF NOT EXISTS ivc_user_image ON public.image_vehicle_candidates (user_id, image_id);
CREATE INDEX IF NOT EXISTS el_user_payment_key ON public.evidence_links (user_id, payment_key) WHERE payment_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS el_user_source_key ON public.evidence_links (user_id, source_key);

-- ---------------------------------------------------------------------------------------------------
-- 2.1 Status, identity and scope helpers
-- ---------------------------------------------------------------------------------------------------
-- (v6, RU1) Whose photo an image is, for its publication status: the image's user, else its vehicle's owner of record.
-- (v7, F3) For a photo with no user, the vehicle's uploader comes before the owner of record: a sale or an owner_id
-- change on the truck does not hand the photos he took to the buyer, and only this user decides a publication.
CREATE OR REPLACE FUNCTION public.evidence_image_user(p_image_id uuid) RETURNS uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(vi.user_id, v.uploaded_by, v.user_id, v.owner_id)
    FROM public.vehicle_images vi LEFT JOIN public.vehicles v ON v.id = vi.vehicle_id
   WHERE vi.id = p_image_id
$$;

-- A target's status is the latest confirmed/rejected decision on it. (v6, RU1) A publication decision is keyed by the
-- image id, which several users can reach, so it is read per user: the user given, else the photo's own user.
-- Every other kind targets one user's row, and only that user decides it.
CREATE OR REPLACE FUNCTION public.evidence_status(p_target_kind text, p_target_id uuid, p_user_id uuid DEFAULT NULL) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT d.decision FROM public.evidence_decisions d
                    WHERE d.target_kind = p_target_kind AND d.target_id = p_target_id AND d.decision IN ('confirmed','rejected')
                      AND CASE WHEN p_target_kind = 'image_publication'
                               THEN d.user_id = coalesce(p_user_id, public.evidence_image_user(p_target_id))
                               ELSE p_user_id IS NULL OR d.user_id = p_user_id END
                    ORDER BY d.created_at DESC, d.id DESC LIMIT 1), 'proposed')
$$;

-- Follow merged_into_vehicle_id to the surviving row (at most 5 hops); NULL when the chain does not end.
-- (v6, RU7) SECURITY DEFINER, returning ids only: an owner session cannot see a private merged duplicate that has none
-- of his owner columns (live vehicles RLS), so an INVOKER resolution gave his session a different lineage than a
-- service-role read.
CREATE OR REPLACE FUNCTION public.evidence_resolve_vehicle(p_vehicle_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH RECURSIVE ch(id, merged_into, depth) AS (
    SELECT v.id, v.merged_into_vehicle_id, 0 FROM public.vehicles v WHERE v.id = p_vehicle_id
    UNION ALL
    SELECT v.id, v.merged_into_vehicle_id, ch.depth + 1 FROM ch JOIN public.vehicles v ON v.id = ch.merged_into
     WHERE ch.depth < 5)
  SELECT id FROM ch WHERE merged_into IS NULL ORDER BY depth DESC LIMIT 1
$$;

-- Denominator ("his vehicles", 133 for the owner on 2026-10-20): not deleted, not merged, owned/uploaded/created.
CREATE OR REPLACE FUNCTION public.evidence_fleet_vehicle_ids(p_user_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT v.id FROM public.vehicles v
   WHERE (v.owner_id = p_user_id OR v.uploaded_by = p_user_id OR v.user_id = p_user_id)
     AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
$$;

-- Writer scope. The vehicles evidence may be written against:
--   a. his vehicles, including rows since merged (resolved to their survivor);
--   b. a vehicle named by a current, not rejected same_vehicle_as / sale / acquisition claim anchored on (a);
--   c. vehicles whose journal_entries / deal_jackets entity is a Nuke organization the owner confirmed as his;
--   d. (v3) vehicles he confirmed he worked on without owning them (a confirmed 'worked_on' claim).
-- Scope allows EVIDENCE rows only. Testimony (promotion) additionally needs user_can_edit_vehicle on the target.
-- (v7, D7) b. needs his CONFIRMED claim when the related vehicle is another user's (any owner column naming someone
-- else); a proposed claim brings in only a vehicle that is his or nobody's (a sold truck's row with no owner link). With
-- p_confirmed_only (answers and decisions) b. counts confirmed claims only: a pass's proposal never widens what his
-- answer may name or what a decision may confirm.
CREATE OR REPLACE FUNCTION public.evidence_scope_vehicle_ids(p_user_id uuid, p_confirmed_only boolean DEFAULT false) RETURNS SETOF uuid
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT public.evidence_resolve_vehicle(v.id) AS id FROM public.vehicles v
     WHERE (v.owner_id = p_user_id OR v.uploaded_by = p_user_id OR v.user_id = p_user_id)
       AND (v.deleted_at IS NULL OR v.merged_into_vehicle_id IS NOT NULL)),
  related AS (
    SELECT x.id FROM (
      SELECT public.evidence_resolve_vehicle(k.related_vehicle_id) AS id, public.evidence_status('change_claim', k.id) AS st
        FROM public.vehicle_change_claims k
       WHERE k.user_id = p_user_id AND k.superseded_by IS NULL AND k.related_vehicle_id IS NOT NULL
         AND k.kind IN ('same_vehicle_as','sale','acquisition')
         AND public.evidence_resolve_vehicle(k.vehicle_id) IN (SELECT id FROM base)) x
     WHERE x.st = 'confirmed'
        OR (NOT p_confirmed_only AND x.st <> 'rejected'
            AND NOT EXISTS (SELECT 1 FROM public.vehicles r WHERE r.id = x.id
                              AND (r.owner_id <> p_user_id OR r.uploaded_by <> p_user_id OR r.user_id <> p_user_id)))),
  mine AS (
    SELECT substr(a.account_ref, 10)::uuid AS org_id FROM public.evidence_account_entities a
     WHERE a.user_id = p_user_id AND a.superseded_by IS NULL AND a.account_ref LIKE 'nuke_org:%'
       AND a.entity_key ~ '^(owner|owner_business:)' AND public.evidence_status('account_entity', a.id) = 'confirmed'),
  entity AS (
    SELECT public.evidence_resolve_vehicle(x.vehicle_id) AS id FROM (
      SELECT je.vehicle_id, je.entity_id FROM public.journal_entries je WHERE je.vehicle_id IS NOT NULL AND je.entity_id IN (SELECT org_id FROM mine)
      UNION
      SELECT dj.vehicle_id, dj.entity_id FROM public.deal_jackets dj WHERE dj.vehicle_id IS NOT NULL AND dj.entity_id IN (SELECT org_id FROM mine)) x),
  worked AS (
    SELECT public.evidence_resolve_vehicle(k.vehicle_id) AS id FROM public.vehicle_change_claims k
     WHERE k.user_id = p_user_id AND k.superseded_by IS NULL AND k.kind = 'worked_on'
       AND public.evidence_status('change_claim', k.id) = 'confirmed')
  SELECT DISTINCT s.id FROM (SELECT id FROM base UNION SELECT id FROM related UNION SELECT id FROM entity UNION SELECT id FROM worked) s
    JOIN public.vehicles v ON v.id = s.id AND v.deleted_at IS NULL
$$;

-- Image eligibility against a precomputed scope array (writers compute the scope once per call). (v3, file-mode gap
-- 12) a row the dedupe marked as a copy (is_duplicate, via mark_as_duplicate) is not eligible either: its keeper is.
CREATE OR REPLACE FUNCTION public.evidence_image_eligible(p_user_id uuid, p_image_id uuid, p_scope uuid[]) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vehicle_images vi
     WHERE vi.id = p_image_id AND NOT coalesce(vi.is_superseded, false) AND NOT coalesce(vi.is_duplicate, false)
       AND (vi.user_id = p_user_id OR (vi.user_id IS NULL AND vi.vehicle_id = ANY (p_scope))))
$$;

-- Identity set for readers: the resolved vehicle and every vehicle joined to it by the user's confirmed
-- same_vehicle_as claims, (v5, readers v4 #6) closed transitively (bounded), each expanded to the ids merged into it
-- (any depth <= 5), so one truck with three rows reads the same from any of them. (v5, readers v4 #2) Only the given
-- user's claims count: another user's pair never changes his identity.
-- (v6, RU7) SECURITY DEFINER, returning vehicle ids only, so the lineage is the same in his own session (where vehicles
-- RLS hides a private duplicate with no owner columns) and in a service-role read. A signed-in caller always gets his
-- own pairs (the user argument is ignored for him), so the definer reads no other user's claims for him.
-- (v7, F8) The body is evidence_identity_set_of (INVOKER, no grant: it runs only inside the definer wrapper below,
-- as its owner); the wrapper evidence_identity_set is the SECURITY DEFINER entry point.
CREATE OR REPLACE FUNCTION public.evidence_identity_set_of(p_vehicle_id uuid, p_user_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH RECURSIVE me AS (
    SELECT CASE WHEN coalesce(current_setting('role', true), '') = 'authenticated' THEN (SELECT auth.uid()) ELSE p_user_id END AS uid),
  pairs AS (
    SELECT public.evidence_resolve_vehicle(k.vehicle_id) AS a, public.evidence_resolve_vehicle(k.related_vehicle_id) AS b
      FROM public.vehicle_change_claims k
     WHERE k.kind = 'same_vehicle_as' AND k.superseded_by IS NULL AND k.user_id = (SELECT uid FROM me)
       AND public.evidence_status('change_claim', k.id) = 'confirmed'),
  edges AS (SELECT a, b FROM pairs WHERE a IS NOT NULL AND b IS NOT NULL
            UNION SELECT b, a FROM pairs WHERE a IS NOT NULL AND b IS NOT NULL),
  reach(id, depth) AS (
    SELECT coalesce(public.evidence_resolve_vehicle(p_vehicle_id), p_vehicle_id), 0
    UNION
    SELECT e.b, r.depth + 1 FROM reach r JOIN edges e ON e.a = r.id WHERE r.depth < 8),
  lineage(id, depth) AS (
    SELECT DISTINCT id, 0 FROM reach
    UNION
    SELECT v.id, l.depth + 1 FROM public.vehicles v JOIN lineage l ON v.merged_into_vehicle_id = l.id WHERE l.depth < 5)
  SELECT array_agg(DISTINCT id ORDER BY id) FROM lineage WHERE id IS NOT NULL
$$;

-- (v7, F8) A signed-in caller is told the lineage only of a vehicle in his own scope; for any other vehicle id the set
-- is that id alone (no survivor, no merged duplicates of another user's truck).
CREATE OR REPLACE FUNCTION public.evidence_identity_set(p_vehicle_id uuid, p_user_id uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN coalesce(current_setting('role', true), '') = 'authenticated'
               AND NOT (EXISTS (SELECT 1 FROM public.vehicles v                       -- his own row: the cheap, usual case
                                 WHERE v.id = coalesce(public.evidence_resolve_vehicle(p_vehicle_id), p_vehicle_id)
                                   AND (SELECT auth.uid()) IN (v.owner_id, v.uploaded_by, v.user_id))
                        OR coalesce(public.evidence_resolve_vehicle(p_vehicle_id), p_vehicle_id)
                           = ANY (ARRAY(SELECT public.evidence_scope_vehicle_ids((SELECT auth.uid())))))
              THEN ARRAY[p_vehicle_id]
              ELSE public.evidence_identity_set_of(p_vehicle_id, p_user_id) END
$$;

-- (v9, R-T1/R-T2) The truck a candidate names, as one place: for a vehicle row, the least id of its identity set (merge
-- lineage and his confirmed same_vehicle_as pairs, evidence_identity_set), so every id of one truck gives the same key
-- and a photo's rows group by truck whatever id a pass named; for a truck with no row, its subject_key; NULL for no
-- truck. A signed-in caller is told the identity only of vehicles in his scope (evidence_identity_set), as every read.
CREATE OR REPLACE FUNCTION public.evidence_truck_key(p_vehicle_id uuid, p_subject_key text, p_user_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_vehicle_id IS NULL THEN p_subject_key
              ELSE (SELECT min(x::text) FROM unnest(public.evidence_identity_set(p_vehicle_id, p_user_id)) x) END
$$;

-- (v9, R-T3) evidence_candidate_status moved below the day reader (2.5): it now returns the day reader's own status.

-- ---------------------------------------------------------------------------------------------------
-- 2.2 Writers: shared caller rule
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evidence_assert_job() RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = public, pg_temp AS $$
BEGIN
  IF session_user::text IS DISTINCT FROM 'authenticator' OR coalesce(auth.role(), '') <> 'service_role'
     OR coalesce(current_setting('role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'evidence writers: inspection jobs through the API only (service_role JWT; session %)', session_user
      USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('evidence.writer', 'on', true);       -- transaction-local token the insert guard checks
END $$;

-- (v6, AC2/AC7/AC12) The money class of a link, which decides what a placed answer may touch:
--   'placement' a payment or a document figure placed on a vehicle, unallocated (one payment, one place: exclusive);
--   'share'     the same with allocated_cents (a split receipt: shares are not exclusive);
--   'album'     a Photos album mapped to a vehicle (exclusive); 'contradicts'; 'other' (supports, context).
-- (v8) Used to describe a sheet row (evidence_sheet_row: which places a stored reading may name) and by the human
-- "no, it is Y" on a link (only a placement is re-placed); no agent decision reads it.
-- (v10, money F3/F5) The one list of payment sources: a line that IS a payment (a bank or card line, a ledger line, a
-- payment event, a QB transaction, a journal entry: live journal_entries are mostly bank-feed postings). Its payer is its
-- account's, so no who-paid question is asked of it, and the reader takes a payment's date and amount from it. A P&L
-- line is not one (it cannot carry a payment key: M1a's CHECK refuses 'pnl:'), nor is anything that only asserts money
-- (a receipt, an order, a jacket line, a message). Every refusal site and the reader read this function.
CREATE OR REPLACE FUNCTION public.evidence_is_payment_source(p_kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(p_kind IN ('bank_line','ledger_line','payment_event','qb_transaction','journal_entry'), false)
$$;

CREATE OR REPLACE FUNCTION public.evidence_link_class(p_role text, p_allocated bigint, p_source_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_source_kind = 'photos_album' THEN 'album'
              WHEN p_role IN ('payment_out','payment_in','assertion') THEN CASE WHEN p_allocated IS NULL THEN 'placement' ELSE 'share' END
              WHEN p_role = 'contradicts' THEN 'contradicts'
              ELSE 'other' END
$$;

-- (v6) One decision target as a sheet row describes it: whose row, where it places its subject (the resolved
-- vehicle, else the no-row subject_key; 'entity:<key>' for an account map row; 'day:<date>' for a capture time; NULL
-- for a publication, a day-context row's truck aside), when it was written, whether its slot is exclusive (only one
-- answer can be right: a photo's subject, an unallocated placement of one payment, one album, one account, one capture
-- time), and its keys. (v8) Read only by evidence_sheet_row, which freezes a review row's question, asked place and
-- keys for the storage checks of evidence_record_answers and for the app; the agent channel that compared answers
-- with it is gone.
CREATE OR REPLACE FUNCTION public.evidence_target_profile(p_kind text, p_id uuid)
RETURNS TABLE(user_id uuid, place text, created_at timestamptz, exclusive boolean, link_class text, pass text, image_id uuid,
              frame text, payment_key text, source_key text, account_ref text, claim_kind text, is_current boolean)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT c.user_id, coalesce(public.evidence_resolve_vehicle(c.vehicle_id)::text, c.subject_key), c.created_at,
         c.frame_role = 'subject', NULL::text, c.pass, c.image_id, c.frame_role, NULL::text, NULL::text, NULL::text, NULL::text,
         c.superseded_by IS NULL
    FROM public.image_vehicle_candidates c WHERE p_kind = 'image_candidate' AND c.id = p_id
  UNION ALL
  SELECT l.user_id, coalesce(public.evidence_resolve_vehicle(l.vehicle_id)::text, l.subject_key), l.created_at,
         public.evidence_link_class(l.role, l.allocated_cents, l.source_kind) IN ('placement','album'),
         public.evidence_link_class(l.role, l.allocated_cents, l.source_kind), l.pass, NULL::uuid, NULL::text,
         l.payment_key, l.source_key, NULL::text, NULL::text, l.superseded_by IS NULL
    FROM public.evidence_links l
   WHERE l.id = p_id AND ((p_kind = 'evidence_link' AND l.source_kind <> 'photos_album') OR (p_kind = 'album_map' AND l.source_kind = 'photos_album'))
  UNION ALL
  SELECT k.user_id, coalesce(public.evidence_resolve_vehicle(k.vehicle_id)::text, k.subject_key), k.created_at, false, NULL::text,
         NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text, NULL::text, k.kind, k.superseded_by IS NULL
    FROM public.vehicle_change_claims k WHERE p_kind = 'change_claim' AND k.id = p_id
  UNION ALL
  SELECT u.user_id, public.evidence_resolve_vehicle(u.vehicle_id)::text, u.created_at, false, NULL::text, NULL::text, NULL::uuid,
         NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, u.superseded_by IS NULL
    FROM public.user_day_vehicle_context u WHERE p_kind = 'day_context' AND u.id = p_id
  UNION ALL
  SELECT a.user_id, 'entity:' || a.entity_key, a.created_at, true, NULL::text, NULL::text, NULL::uuid, NULL::text, NULL::text,
         NULL::text, a.account_ref, NULL::text, a.superseded_by IS NULL
    FROM public.evidence_account_entities a WHERE p_kind = 'account_entity' AND a.id = p_id
  UNION ALL
  SELECT t.user_id, 'day:' || t.captured_on::text, t.created_at, true, NULL::text, t.rule, t.image_id, NULL::text, NULL::text,
         NULL::text, NULL::text, NULL::text, t.superseded_by IS NULL
    FROM public.image_capture_time_claims t WHERE p_kind = 'capture_time_claim' AND t.id = p_id
  UNION ALL
  SELECT public.evidence_image_user(vi.id), NULL::text, NULL::timestamptz, false, NULL::text, NULL::text, vi.id, NULL::text,
         NULL::text, NULL::text, NULL::text, NULL::text, true
    FROM public.vehicle_images vi WHERE p_kind = 'image_publication' AND vi.id = p_id
$$;

-- (v6, AC1/AC4) A review-sheet row, as stored: the targets the job listed, plus what the row asks, derived here from
-- those targets and frozen with the sheet:
--   question     the one decision kind the row asks about (image_candidate, image_publication, capture_time_claim,
--                evidence_link, album_map, account_entity, change_claim, day_context); a row whose targets imply two
--                kinds is refused; a row that lists only images must name its question;
--   asks         'place' (is it here / where is it) or 'party' (who paid or received: (v8) answered only by his own
--                decision in the app, which writes the owner statement; the row's target itself is not decided);
--   asked_place  the one place the row's own targets sit (NULL when the row asks "where?", 'multi' when its targets
--                sit in several places: such a row takes only a bare yes or no); (v7, D6) 'none' when its own targets
--                place nothing (a "no truck in frame" verdict, a payment placed on no truck): a yes/no row, where "yes"
--                keeps the target as it is, "no" rejects it and "no, it is Y" names Y;
--   frame        for photos: the frame role it asks about ('subject' by default, 'mixed' takes only a bare answer);
--   link_class   for money: the class it asks about (placement, share, album, contradicts, other, 'mixed');
--   places, images, payment_keys, source_keys, accounts: what the row covers.
CREATE OR REPLACE FUNCTION public.evidence_sheet_row(p_user_id uuid, p_key text, p_row jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  t jsonb; pr record; v_kinds text[] := '{}'; v_q text; v_asks text; v_places text[] := '{}'; v_frames text[] := '{}';
  v_classes text[] := '{}'; v_images text[] := '{}'; v_pkeys text[] := '{}'; v_skeys text[] := '{}'; v_accts text[] := '{}';
  v_claim_kinds text[] := '{}'; v_frame text; v_class text; v_asked text; v_own int := 0;
  c_kinds CONSTANT text[] := ARRAY['image_candidate','image_publication','capture_time_claim','evidence_link','album_map',
                                   'account_entity','change_claim','day_context'];
BEGIN
  IF jsonb_typeof(p_row->'targets') IS DISTINCT FROM 'array' OR jsonb_array_length(p_row->'targets') NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'sheet row % lists 1..200 targets', p_key USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT * FROM jsonb_array_elements(p_row->'targets') LOOP
    IF t->>'kind' = ANY (c_kinds) THEN
      v_kinds := v_kinds || (t->>'kind');
    ELSIF t->>'kind' = 'payment' THEN v_kinds := v_kinds || 'evidence_link'::text; v_pkeys := v_pkeys || (t->>'key');
    ELSIF t->>'kind' = 'source'  THEN v_kinds := v_kinds || 'evidence_link'::text; v_skeys := v_skeys || (t->>'key');
    ELSIF t->>'kind' = 'account' THEN v_kinds := v_kinds || 'account_entity'::text; v_accts := v_accts || (t->>'key');
    ELSIF t->>'kind' = 'image'   THEN v_images := v_images || (t->>'id');
    END IF;
  END LOOP;
  v_kinds := ARRAY(SELECT DISTINCT k FROM unnest(v_kinds) k ORDER BY k);
  IF cardinality(v_kinds) > 1 THEN
    RAISE EXCEPTION 'sheet row % asks about more than one kind of thing (%): one question per row', p_key, v_kinds USING ERRCODE = '22023';
  END IF;
  v_q := v_kinds[1];
  IF p_row ? 'question' THEN
    IF v_q IS NOT NULL AND v_q IS DISTINCT FROM p_row->>'question' THEN
      RAISE EXCEPTION 'sheet row %: question % does not match its targets (%)', p_key, p_row->>'question', v_q USING ERRCODE = '22023';
    END IF;
    v_q := p_row->>'question';
  END IF;
  IF v_q IS NULL OR NOT (v_q = ANY (c_kinds)) THEN
    RAISE EXCEPTION 'sheet row % lists only images: name its question (image_candidate, image_publication or capture_time_claim)', p_key
      USING ERRCODE = '22023';
  END IF;
  IF cardinality(v_images) > 0 AND v_q NOT IN ('image_candidate','image_publication','capture_time_claim') THEN
    RAISE EXCEPTION 'sheet row % lists an image but asks about %', p_key, v_q USING ERRCODE = '22023';
  END IF;
  -- the row's own targets of that kind (rows of this user; an id that names nothing of his covers only itself)
  FOR t IN SELECT * FROM jsonb_array_elements(p_row->'targets') x WHERE x->>'kind' = v_q LOOP
    IF coalesce(t->>'id', '') !~ '^[0-9a-f-]{36}$' THEN
      RAISE EXCEPTION 'sheet row %: target % needs an id', p_key, t USING ERRCODE = '22023';
    END IF;
    SELECT * INTO pr FROM public.evidence_target_profile(v_q, (t->>'id')::uuid) LIMIT 1;
    CONTINUE WHEN NOT FOUND OR (v_q <> 'image_publication' AND pr.user_id IS DISTINCT FROM p_user_id);
    v_own := v_own + 1;
    IF pr.place IS NOT NULL       THEN v_places := v_places || pr.place;
    ELSIF v_q <> 'image_publication' THEN v_places := v_places || 'none'::text;   -- (v7, D6) a target that places nothing
    END IF;
    IF pr.frame IS NOT NULL       THEN v_frames := v_frames || pr.frame; END IF;
    IF pr.link_class IS NOT NULL  THEN v_classes := v_classes || pr.link_class; END IF;
    IF pr.image_id IS NOT NULL    THEN v_images := v_images || pr.image_id::text; END IF;
    IF pr.payment_key IS NOT NULL THEN v_pkeys := v_pkeys || pr.payment_key; END IF;
    IF pr.source_key IS NOT NULL  THEN v_skeys := v_skeys || pr.source_key; END IF;
    IF pr.account_ref IS NOT NULL THEN v_accts := v_accts || pr.account_ref; END IF;
    IF pr.claim_kind IS NOT NULL  THEN v_claim_kinds := v_claim_kinds || pr.claim_kind; END IF;
  END LOOP;
  v_places := ARRAY(SELECT DISTINCT x FROM unnest(v_places) x ORDER BY x);
  v_frames := ARRAY(SELECT DISTINCT x FROM unnest(v_frames) x ORDER BY x);
  v_classes := ARRAY(SELECT DISTINCT x FROM unnest(v_classes) x ORDER BY x);
  v_images := ARRAY(SELECT DISTINCT x FROM unnest(v_images) x ORDER BY x);
  v_pkeys := ARRAY(SELECT DISTINCT x FROM unnest(v_pkeys) x ORDER BY x);
  v_skeys := ARRAY(SELECT DISTINCT x FROM unnest(v_skeys) x ORDER BY x);
  v_accts := ARRAY(SELECT DISTINCT x FROM unnest(v_accts) x ORDER BY x);
  v_claim_kinds := ARRAY(SELECT DISTINCT x FROM unnest(v_claim_kinds) x ORDER BY x);
  v_asks := coalesce(p_row->>'asks', 'place');
  IF v_asks NOT IN ('place','party') THEN
    RAISE EXCEPTION 'sheet row %: asks is place or party', p_key USING ERRCODE = '22023';
  END IF;
  v_frame := CASE WHEN v_q <> 'image_candidate' THEN NULL
                  WHEN cardinality(v_frames) = 0 THEN coalesce(p_row->>'frame', 'subject')
                  WHEN cardinality(v_frames) = 1 THEN v_frames[1] ELSE 'mixed' END;
  IF v_q = 'image_candidate' AND (v_frame NOT IN ('subject','also_in_frame','mixed')
       OR (p_row ? 'frame' AND p_row->>'frame' IS DISTINCT FROM v_frame)) THEN
    RAISE EXCEPTION 'sheet row %: frame % does not match its candidates (%)', p_key, p_row->>'frame', v_frame USING ERRCODE = '22023';
  END IF;
  v_class := CASE WHEN v_q = 'album_map' THEN 'album' WHEN v_q <> 'evidence_link' THEN NULL
                  WHEN cardinality(v_classes) = 0 THEN 'placement'
                  WHEN cardinality(v_classes) = 1 THEN v_classes[1] ELSE 'mixed' END;
  v_asked := CASE cardinality(v_places) WHEN 0 THEN NULL WHEN 1 THEN v_places[1] ELSE 'multi' END;
  -- (v7, D2) a who-paid row asks about exactly one thing of his (one placement link or one acquisition/sale claim),
  -- so the statement that answers it is that money and nothing else
  IF v_asks = 'party' AND (v_asked IS NULL OR v_asked IN ('multi','none') OR v_own <> 1
       OR jsonb_array_length(p_row->'targets') <> 1
       OR NOT ((v_q = 'evidence_link' AND v_class = 'placement')
               OR (v_q = 'change_claim' AND v_claim_kinds <@ ARRAY['acquisition','sale']::text[] AND cardinality(v_claim_kinds) = 1))) THEN
    RAISE EXCEPTION 'sheet row %: a who-paid row asks about one placement of money or one acquisition or sale, in one place', p_key
      USING ERRCODE = '22023';
  END IF;
  -- (v8) and only about money no payment source carries (a jacket line, an order with no bank line): a payment with a
  -- source line (a payment key) gets its payer from the account map, so its who-paid question is the account's row.
  -- His statement then has a key of its own and confirming it never bands another link's payment.
  IF v_asks = 'party' AND v_q = 'evidence_link' AND cardinality(v_pkeys) > 0 THEN
    RAISE EXCEPTION 'sheet row %: this money has a payment source (%); ask whose account paid it (an account row), not who paid', p_key, v_pkeys
      USING ERRCODE = '22023';
  END IF;
  -- (v9, W3) nor about a line of a payment source, keyed or not: that money's payer is its account's (an account row).
  -- (v10, money F3/F5) one list, evidence_is_payment_source: a journal entry is one (bank-feed postings), a P&L line
  -- is not (it has no payment key; who paid a P&L parts line with no bank line is his to say)
  IF v_asks = 'party' AND v_q = 'evidence_link' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_row->'targets') tt(e) JOIN public.evidence_links l ON l.id = (tt.e->>'id')::uuid
        WHERE tt.e->>'kind' = 'evidence_link' AND l.user_id = p_user_id
          AND public.evidence_is_payment_source(l.source_kind)) THEN
    RAISE EXCEPTION 'sheet row %: this money is a payment source line; ask whose account paid it (an account row), not who paid', p_key
      USING ERRCODE = '22023';
  END IF;
  RETURN p_row || jsonb_build_object('question', v_q, 'asks', v_asks, 'asked_place', v_asked, 'frame', v_frame,
                                     'link_class', v_class, 'places', to_jsonb(v_places), 'images', to_jsonb(v_images),
                                     'payment_keys', to_jsonb(v_pkeys), 'source_keys', to_jsonb(v_skeys), 'accounts', to_jsonb(v_accts));
END $$;

CREATE OR REPLACE FUNCTION public.evidence_open_run(
  p_user_id uuid, p_run_kind text, p_pass text, p_producer text, p_code_version text, p_config jsonb,
  p_scope jsonb DEFAULT '{}'::jsonb, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_parent_run_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_config jsonb := coalesce(p_config, '{}'::jsonb); v_rows jsonb; v_d date; v_k text; v_e jsonb; v_orig jsonb;
BEGIN
  PERFORM public.evidence_assert_job();
  IF p_run_kind IN ('probe','review_answers') THEN
    RAISE EXCEPTION 'run kind % is written only by its own writer', p_run_kind USING ERRCODE = '42501';
  END IF;
  -- (v8) 'owner_review' rows are his: decide_evidence writes them (his "no, it is Y", his statement, his day) on the
  -- run of the row he decided or of the answer he confirmed. A job cannot open a run that would read as his review.
  IF p_pass = 'owner_review' THEN
    RAISE EXCEPTION 'owner_answer_missing: owner_review rows are written only by his own decisions (decide_evidence), never by a job run'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'unknown user'; END IF;
  IF p_parent_run_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM evidence_runs WHERE id = p_parent_run_id AND user_id = p_user_id AND status = 'running') THEN
    RAISE EXCEPTION 'parent run is not a running run of this user';
  END IF;
  -- (v4, rules-violation v3) a review sheet names, for every row 1..items, the targets the row asks about
  -- ((v9, W2) or, for a re-ask, the row it asks again: reask_of)
  IF p_run_kind = 'review' AND (
       jsonb_typeof(v_config->'rows') IS DISTINCT FROM 'object'
       OR (v_config->>'items') !~ '^[0-9]+$' OR (v_config->>'items')::int NOT BETWEEN 1 AND 500
       OR (SELECT count(*) FROM jsonb_object_keys(v_config->'rows')) <> (v_config->>'items')::int
       OR EXISTS (SELECT 1 FROM jsonb_each(v_config->'rows') e
                   WHERE coalesce(CASE WHEN e.key ~ '^[0-9]+$' THEN e.key::int END, 0) NOT BETWEEN 1 AND (v_config->>'items')::int
                      OR jsonb_typeof(e.value) IS DISTINCT FROM 'object'
                      OR CASE WHEN jsonb_typeof(e.value->'targets') = 'array' THEN jsonb_array_length(e.value->'targets') = 0
                              ELSE e.value ? 'targets' OR NOT (e.value ? 'reask_of') END
                      OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.value->'targets') = 'array'
                                                                         THEN e.value->'targets' ELSE '[]'::jsonb END) t
                                  WHERE NOT (t->>'kind' IN ('image','image_candidate','evidence_link','album_map','change_claim',
                                                            'capture_time_claim','day_context','account_entity','image_publication')
                                             AND t->>'id' ~ '^[0-9a-f-]{36}$')
                                    AND NOT (t->>'kind' IN ('payment','source') AND nullif(t->>'key','') IS NOT NULL)
                                    AND NOT (t->>'kind' = 'account' AND public.evidence_account_ref_ok(t->>'key') AND t->>'key' IS NOT NULL)))) THEN
    RAISE EXCEPTION 'a review sheet lists targets for every row (rows.<n>.targets)' USING ERRCODE = '22023';
  END IF;
  -- (v6, AC1/AC4) every row states its one question and the place it asks about, frozen with the sheet
  IF p_run_kind = 'review' THEN
    -- (v9, M8) at most 10,000 targets on one sheet (500 rows of 20 open in about 3 s; 500 of 200 ran past the
    -- statement timeout): a larger sheet is several sheets. Counted before freezing, and again after (re-asks copy).
    IF (SELECT sum(CASE WHEN jsonb_typeof(r.value->'targets') = 'array' THEN jsonb_array_length(r.value->'targets') ELSE 0 END)
          FROM jsonb_each(v_config->'rows') r) > 10000 THEN
      RAISE EXCEPTION 'a review sheet lists at most 10000 targets in all; split it' USING ERRCODE = '22023';
    END IF;
    v_rows := '{}'::jsonb;
    FOR v_k, v_e IN SELECT * FROM jsonb_each(v_config->'rows') LOOP
      IF v_e ? 'reask_of' THEN
        -- (v9, W2) a re-ask asks a row he was sent before, exactly as it was frozen then: its targets, question and
        -- asked place are copied from that row, never re-picked from the rows as the passes have them now, so a
        -- decision citing his answer to the re-ask is still checked against the row he was first asked about
        IF coalesce(v_e->>'reask_of', '') !~ '^review:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#[0-9]+$' THEN
          RAISE EXCEPTION 'sheet row %: reask_of is review:<sheet run>#<row>', v_k USING ERRCODE = '22023';
        END IF;
        v_orig := NULL;
        SELECT o.config->'rows'->(substring(v_e->>'reask_of' from '#([0-9]+)$')) INTO v_orig FROM evidence_runs o
         WHERE o.id = substring(v_e->>'reask_of' from '^review:([0-9a-f-]{36})#')::uuid AND o.user_id = p_user_id
           AND o.run_kind = 'review' AND o.pass = 'review_sheet' AND o.status = 'done';
        IF v_orig IS NULL OR v_orig->>'question' IS NULL THEN
          RAISE EXCEPTION 'sheet row %: reask_of names no row of a sheet of yours that was sent and states its question', v_k
            USING ERRCODE = '22023';
        END IF;
        IF (v_e ? 'targets' AND (SELECT jsonb_agg(t ORDER BY t::text) FROM jsonb_array_elements(v_e->'targets') t)
                              IS DISTINCT FROM (SELECT jsonb_agg(t ORDER BY t::text) FROM jsonb_array_elements(v_orig->'targets') t))
           OR EXISTS (SELECT 1 FROM jsonb_each(v_e) f WHERE f.key NOT IN ('reask_of','targets','asked_first') AND f.value IS DISTINCT FROM v_orig->f.key) THEN
          RAISE EXCEPTION 'sheet row %: a re-ask asks the original row unchanged (its targets and question as frozen); a changed question is a new row', v_k
            USING ERRCODE = '22023';
        END IF;
        -- (v10, A1) and the question's first asking, kept along a chain of re-asks (the root's own asked_first, else the
        -- row this re-asks): his answers on any of these rows are answers to one question, and only the latest is cited
        v_rows := v_rows || jsonb_build_object(v_k, v_orig || jsonb_build_object('reask_of', v_e->>'reask_of',
                                                    'asked_first', coalesce(v_orig->>'asked_first', v_e->>'reask_of')));
      ELSE
        -- (v10, A1) a fresh row is its own first asking: an asked_first the job sends is dropped
        v_rows := v_rows || jsonb_build_object(v_k, public.evidence_sheet_row(p_user_id, v_k, v_e) - 'asked_first');
      END IF;
    END LOOP;
    IF (SELECT sum(jsonb_array_length(r.value->'targets')) FROM jsonb_each(v_rows) r) > 10000 THEN
      RAISE EXCEPTION 'a review sheet lists at most 10000 targets in all; split it' USING ERRCODE = '22023';
    END IF;
    -- (v11, R3) a sheet asks a question once: two re-asks of one question (one first asking) on one sheet would give his
    -- one message two answers to it with nothing to tell which is the later (the list marked one replaced, the writer
    -- accepted both)
    IF EXISTS (SELECT 1 FROM jsonb_each(v_rows) r WHERE r.value ? 'asked_first'
                GROUP BY r.value->>'asked_first' HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'a sheet asks a question once: two rows of this sheet re-ask the same question' USING ERRCODE = '22023';
    END IF;
    -- (v11 patch, re-check N1) nor ask one question twice about one target, in any shape: two fresh rows, or a re-ask
    -- (which carries the targets of the row it re-asks, frozen with it) beside a fresh row. A row's targets here are the
    -- ones its answer lands on (evidence_answer_fits): its own targets of the question's kind, else the slot it names (an
    -- image, a payment or source key, an account). Two rows that differ only in the slot they also list (two sources
    -- contradicting one payment) ask different questions.
    IF EXISTS (SELECT 1 FROM jsonb_each(v_rows) r
                CROSS JOIN LATERAL jsonb_array_elements(r.value->'targets') t
                WHERE t->>'kind' = r.value->>'question'
                   OR (t->>'kind' IN ('image','payment','source','account')
                       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.value->'targets') o WHERE o->>'kind' = r.value->>'question'))
                GROUP BY r.value->>'question', coalesce(r.value->>'asks', 'place'), t->>'kind', coalesce(t->>'id', t->>'key')
               HAVING count(DISTINCT r.key) > 1) THEN
      RAISE EXCEPTION 'a sheet asks a question once: two rows of this sheet ask the same question about one target' USING ERRCODE = '22023';
    END IF;
    v_config := v_config || jsonb_build_object('rows', v_rows);
  END IF;
  -- (v6, RU9) a payment source's coverage is a real date and names accounts; (RU4) closed_accounts are accounts whose
  -- final statement this export is (their coverage is complete), a subset of covers_accounts
  IF v_config ? 'coverage_to' THEN
    BEGIN
      v_d := (v_config->>'coverage_to')::date;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'coverage_to % is not a date', v_config->>'coverage_to' USING ERRCODE = '22023';
    END;
    -- (v7, F7c) a statement cannot cover days that have not happened (one typo would turn every later assertion into
    -- unpaid_assertion). The run's evidence window is not a bound: a pass may place a narrower window of lines from a
    -- statement it read through coverage_to.
    IF v_d > current_date THEN
      RAISE EXCEPTION 'coverage_to % is later than today', v_d USING ERRCODE = '22023';
    END IF;
    IF (v_config->>'coverage_to') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       OR jsonb_typeof(v_config->'covers_accounts') IS DISTINCT FROM 'array' OR jsonb_array_length(v_config->'covers_accounts') = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_config->'covers_accounts') a
                   WHERE jsonb_typeof(a) <> 'string' OR NOT public.evidence_account_ref_ok(a #>> '{}'))
       OR (v_config ? 'closed_accounts' AND (jsonb_typeof(v_config->'closed_accounts') IS DISTINCT FROM 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_config->'closed_accounts') a
                       WHERE jsonb_typeof(a) <> 'string' OR NOT (v_config->'covers_accounts' @> jsonb_build_array(a))))) THEN
      RAISE EXCEPTION 'a payment-source run records coverage_to (YYYY-MM-DD) with covers_accounts, a list of account refs; closed_accounts is a subset of them'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_config ? 'closed_accounts' THEN
    RAISE EXCEPTION 'closed_accounts goes with coverage_to on a payment-source run' USING ERRCODE = '22023';
  END IF;
  INSERT INTO evidence_runs(parent_run_id, user_id, run_kind, pass, producer, code_version, config, scope, evidence_from, evidence_to)
  VALUES (p_parent_run_id, p_user_id, p_run_kind, p_pass, p_producer, p_code_version, v_config, coalesce(p_scope,'{}'), p_from, p_to)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- cost_usd = input_tokens x config.price_usd_per_input_token (the vendor's published price, kept in run config,
-- never in the schema); NULL when the run carries no price.
-- (v8, wording) Run lifecycle: every run evidence_open_run writes, a review sheet ('review') included, is opened
-- running and closed here once (a review run when its sheet is sent; its config, the rows, never changes). Answers
-- runs ('review_answers', evidence_record_answers) and probes (evidence_probe_write) are written closed and are never
-- closed here. (v5/v6 text said review runs were "never running"; the code has always opened them running.)
CREATE OR REPLACE FUNCTION public.evidence_close_run(
  p_run_id uuid, p_status text, p_counts jsonb, p_input_tokens bigint DEFAULT 0,
  p_scoreboard jsonb DEFAULT NULL, p_gap_picked text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.evidence_assert_job();
  IF p_status NOT IN ('done','failed','aborted') THEN RAISE EXCEPTION 'close status must be done, failed or aborted'; END IF;
  UPDATE evidence_runs
     SET finished_at = now(), status = p_status, counts = p_counts,
         input_tokens = input_tokens + coalesce(p_input_tokens, 0),
         cost_usd = (input_tokens + coalesce(p_input_tokens, 0)) * nullif(config->>'price_usd_per_input_token', '')::numeric,
         scoreboard = p_scoreboard, gap_picked = p_gap_picked
   WHERE id = p_run_id AND status = 'running' AND run_kind NOT IN ('probe','review_answers');
  IF NOT FOUND THEN RAISE EXCEPTION 'run % is not a running run', p_run_id; END IF;
END $$;

-- (v6) The place a stored answer names, in the same terms as evidence_target_profile: the resolved vehicle, the no-row
-- subject_key, 'entity:<key>', or 'day:<date>'; NULL for a bare yes/no.
CREATE OR REPLACE FUNCTION public.evidence_answer_place(p_answer jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_answer ? 'vehicle_id' THEN coalesce(public.evidence_resolve_vehicle((p_answer->>'vehicle_id')::uuid)::text, p_answer->>'vehicle_id')
              WHEN p_answer ? 'subject_key' THEN p_answer->>'subject_key'
              WHEN p_answer ? 'entity_key' THEN 'entity:' || (p_answer->>'entity_key')
              WHEN p_answer ? 'captured_on' THEN 'day:' || ((p_answer->>'captured_on')::date)::text END
$$;

-- The owner's answers to one review sheet, verbatim. p_rows = {"<sheet row>": {"verbatim": "<his words>", "answer":
-- {...}}}; the sha256 of each answer is computed here. p_message_ref names the chat message the answer came from:
-- (v7, D4) exactly '<source>:<message id>', where the message id is the chat transcript's own id for that message (a
-- uuid for a Claude session) and the source names where it was read (the session id); no path, no second colon. It is
-- stored lower-cased, and the message id is unique across every answers run of every user.
-- (v8) STORAGE ONLY. Storing an answer decides nothing, writes no decision and changes no reader: his words wait here,
-- against the sheet row they answer, until he confirms them himself in the app (evidence_answers_to_confirm lists them;
-- decide_evidence records his own decision and may cite the stored answer as p_answer_ref). The answers run is written
-- closed ('done') and never changes.
-- (v5, rules-channels v4 #1; v8: optional) "answer" is the transcriber's structured reading of his words, stored next
-- to them and fixed from then on: {"decision": "confirmed" | "rejected" | "unsure"} plus, when he named one, ONE place.
-- It is what the app may show him as "you said X"; it decides nothing. A row stored with no reading is kept as
-- {"decision":"unsure","unread":true} (M1a's er_answers_shape needs a decision on every row): the app shows his words
-- only. A reading that is given is checked, so the app never shows an inverted reading, a place of another dimension or
-- a truck outside his scope:
-- (v6) The reading is checked against the sheet row it answers (evidence_sheet_row):
--   * AC1/AC3: the place must be of the row's own dimension: a truck ("vehicle_id", or "subject_key" for a truck with
--     no row) for a photo, an album or an unallocated placement of money; an account's owner ("entity_key") for an
--     account row; a day ("captured_on") for a capture time; nothing for a publication, a day-context row, a change
--     claim, a share of a split payment or a contradiction. A who-paid row ('asks' party) takes {"decision":
--     "confirmed", "entity_key": who paid or received}.
--   * AC4: a yes names the asked place or none ({"decision":"confirmed"}); "no, it is Y" is {"decision":"rejected",
--     "vehicle_id": Y} with Y not the asked place; "no, not that one" is a bare {"decision":"rejected"}. A row that asks
--     "where?" (no asked place) takes {"decision":"confirmed", <the place>} or unsure; a row whose targets sit in
--     several places takes only a bare yes or no.
--   * AC11/AC-scan: a vehicle is looked up by its uuid and must be in his scope or be a place the row names; (v7, D7)
--     his scope here counts only relations he confirmed.
--   * AC10: one message is transcribed once (er_one_answers_per_message); (v7, D4/F8) keyed by the message id alone.
--   * (v7, D6) a row whose own targets place nothing (asked place 'none') takes a bare yes or no, or "no, it is Y".
-- (v9, W2) One answers run per chat MESSAGE, stored on the sheet that message answers: a reply he spreads over several
--   messages is several answers runs on that one sheet (v4-v8 allowed one per sheet and sent the rest to "a new sheet",
--   which froze the rows as the passes had re-written them, so his words could be confirmed on a row he never saw).
--   p_message_at is the message's own time in the chat transcript. An answer is stored only on a sheet that was sent
--   (closed 'done' when it was sent: a running sheet was never sent, an aborted or failed one was withdrawn) and only
--   for a message written after it was sent ('message_predates_sheet'), so a sheet opened after he spoke can never
--   carry what he said. No clock-skew allowance: a reply follows the sheet by far more than the skew of two NTP clocks,
--   and an allowance would let a copy sheet opened within it take the message. M10b compares message_at with the
--   transcript. (M1) at least one row; (M3) the "stored once" error names no stored run (it can be another user's);
--   (M4) at most 20,000 characters of his words per row.
CREATE OR REPLACE FUNCTION public.evidence_record_answers(
  p_user_id uuid, p_sheet_run uuid, p_message_ref text, p_rows jsonb, p_producer text, p_code_version text,
  p_message_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s evidence_runs%ROWTYPE; k text; v jsonb; a jsonb; rc jsonb; v_rows jsonb := '{}'::jsonb; v_id uuid; v_ref text;
        v_allowed text[]; v_keys text[]; v_place text; v_asked text; v_veh uuid; v_scope uuid[]; v_d date;
        n_read int := 0;
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO s FROM evidence_runs WHERE id = p_sheet_run AND user_id = p_user_id AND run_kind = 'review' AND pass = 'review_sheet';
  IF NOT FOUND THEN RAISE EXCEPTION 'no review sheet % for this owner', p_sheet_run USING ERRCODE = '22023'; END IF;
  -- (v9, W2/M2) only a sheet that was sent to him
  IF s.status <> 'done' THEN
    RAISE EXCEPTION 'sheet_not_sent: sheet % is %, never sent (a sheet is closed done when it is sent); his answers are stored only on the sheet he was sent',
      p_sheet_run, s.status USING ERRCODE = '22023';
  END IF;
  v_ref := lower(btrim(p_message_ref));
  -- (v7, D4) one spelling per message: '<source>:<message id>', no path, no second colon
  IF coalesce(v_ref, '') !~ '^[a-z0-9_-]+:[a-z0-9_-]+$' OR length(v_ref) > 200 OR jsonb_typeof(p_rows) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'message_ref is <source>:<message id> (the transcript''s own message id; no path, no second colon) and a rows object is required'
      USING ERRCODE = '22023';
  END IF;
  -- (v9, M1) at least one answered row: an empty set would use up the message id
  IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_rows)) THEN
    RAISE EXCEPTION 'a stored answer has at least one row' USING ERRCODE = '22023';
  END IF;
  -- (v9, W2) the message answers this sheet: written after the sheet was sent, and not in the future
  IF p_message_at IS NULL OR p_message_at < s.finished_at THEN
    RAISE EXCEPTION 'message_predates_sheet: message % (written %) is older than sheet % (sent %); store it on the sheet it answers',
      v_ref, p_message_at, p_sheet_run, s.finished_at USING ERRCODE = '22023';
  END IF;
  IF p_message_at > now() + interval '5 seconds' THEN
    RAISE EXCEPTION 'message time % is in the future', p_message_at USING ERRCODE = '22023';
  END IF;
  -- (v6, AC10; v7, D4/F8) one message, one transcription, whatever the source prefix and whoever it is stored for;
  -- (v9, M3) the error names no stored run
  IF EXISTS (SELECT 1 FROM evidence_runs a
              WHERE a.run_kind = 'review_answers' AND split_part(a.config->>'message_ref', ':', 2) = split_part(v_ref, ':', 2)) THEN
    RAISE EXCEPTION 'message % is already stored; a message is stored once', v_ref USING ERRCODE = '23505';
  END IF;
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(p_user_id, true));     -- (v7, D7) confirmed relations only
  FOR k, v IN SELECT * FROM jsonb_each(p_rows) LOOP
    IF k !~ '^[0-9]+$' OR NOT (s.config->'rows' ? k) OR nullif(btrim(v->>'verbatim'), '') IS NULL THEN
      RAISE EXCEPTION 'answer row % is not a row of the sheet or has no verbatim text', k USING ERRCODE = '22023';
    END IF;
    -- (v9, M4) his words, bounded
    IF length(v->>'verbatim') > 20000 THEN
      RAISE EXCEPTION 'answer row %: at most 20000 characters of his words per row', k USING ERRCODE = '22023';
    END IF;
    rc := s.config->'rows'->k;
    IF rc->>'question' IS NULL THEN
      RAISE EXCEPTION 'sheet row % states no question (a sheet written before v6): put it on a new sheet', k USING ERRCODE = '22023';
    END IF;
    -- (v8) no reading given: his words alone are stored, marked unread
    IF NOT (v ? 'answer') OR jsonb_typeof(v->'answer') = 'null' THEN
      v_rows := v_rows || jsonb_build_object(k, jsonb_build_object('verbatim', v->>'verbatim',
                  'sha256', encode(sha256(convert_to(v->>'verbatim', 'UTF8')), 'hex'),
                  'answer', jsonb_build_object('decision', 'unsure', 'unread', true)));
      CONTINUE;
    END IF;
    n_read := n_read + 1;
    v_asked := rc->>'asked_place';
    v_allowed := CASE
      WHEN rc->>'asks' = 'party' THEN ARRAY['entity_key']
      WHEN v_asked = 'multi' OR rc->>'frame' = 'mixed' OR rc->>'link_class' = 'mixed' THEN ARRAY[]::text[]
      WHEN rc->>'question' = 'image_candidate' THEN ARRAY['vehicle_id','subject_key']
      WHEN rc->>'question' = 'evidence_link' AND rc->>'link_class' = 'placement' THEN ARRAY['vehicle_id','subject_key']
      WHEN rc->>'question' = 'album_map' THEN ARRAY['vehicle_id']
      WHEN rc->>'question' = 'account_entity' THEN ARRAY['entity_key']
      WHEN rc->>'question' = 'capture_time_claim' THEN ARRAY['captured_on']
      ELSE ARRAY[]::text[] END;
    a := v->'answer';
    v_keys := CASE WHEN jsonb_typeof(a) = 'object' THEN ARRAY(SELECT jsonb_object_keys(a)) ELSE NULL END;
    IF v_keys IS NULL OR coalesce(a->>'decision', '') NOT IN ('confirmed','rejected','unsure')
       OR NOT (v_keys <@ (ARRAY['decision'] || v_allowed))
       OR cardinality(v_keys) > 2
       OR (a->>'decision' = 'unsure' AND a <> jsonb_build_object('decision', 'unsure')) THEN
      RAISE EXCEPTION 'answer row % (asking % about %) takes {decision confirmed|rejected|unsure} and at most one of %',
        k, coalesce(rc->>'asks', 'place'), rc->>'question', v_allowed USING ERRCODE = '22023';
    END IF;
    IF a ? 'vehicle_id' THEN
      IF coalesce(a->>'vehicle_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM vehicles WHERE id = (a->>'vehicle_id')::uuid) THEN          -- (v6, AC-scan) by the primary key
        RAISE EXCEPTION 'answer row %: vehicle % does not exist', k, a->>'vehicle_id' USING ERRCODE = '22023';
      END IF;
      v_veh := public.evidence_resolve_vehicle((a->>'vehicle_id')::uuid);
      IF v_veh IS NULL OR NOT (v_veh = ANY (v_scope) OR rc->'places' @> to_jsonb(v_veh::text)) THEN   -- (v6, AC11)
        RAISE EXCEPTION 'answer row %: vehicle % is neither his nor on the row', k, a->>'vehicle_id' USING ERRCODE = '22023';
      END IF;
    END IF;
    IF a ? 'subject_key' AND coalesce(a->>'subject_key', '') !~ '^(vin|album|label):[A-Za-z0-9_.:-]+$' THEN
      RAISE EXCEPTION 'answer row %: subject_key is vin:, album: or label:', k USING ERRCODE = '22023';
    END IF;
    IF a ? 'entity_key' AND (a->>'entity_key' IS NULL OR NOT public.evidence_entity_key_ok(a->>'entity_key')) THEN
      RAISE EXCEPTION 'answer row %: entity_key is owner, owner_business:<x>, third_party:<x> or unknown', k USING ERRCODE = '22023';
    END IF;
    IF a ? 'captured_on' THEN
      BEGIN v_d := (a->>'captured_on')::date;
      EXCEPTION WHEN others THEN RAISE EXCEPTION 'answer row %: captured_on is a date', k USING ERRCODE = '22023'; END;
    END IF;
    v_place := public.evidence_answer_place(a);
    IF rc->>'asks' = 'party' THEN
      IF a->>'decision' <> 'unsure' AND (a->>'decision' <> 'confirmed' OR NOT (a ? 'entity_key')) THEN
        RAISE EXCEPTION 'answer row % asks who paid or received: {"decision":"confirmed","entity_key":<who>} or unsure', k USING ERRCODE = '22023';
      END IF;
    ELSIF a->>'decision' <> 'unsure' AND cardinality(v_allowed) > 0 THEN
      -- (v6, AC4) the reading cannot invert: "yes" names the asked place, "no" never does
      IF v_asked IS NOT NULL AND a->>'decision' = 'confirmed' AND v_place IS NOT NULL AND v_place IS DISTINCT FROM v_asked THEN
        RAISE EXCEPTION 'answer row %: a yes names the place the row asks about (%); another place is {"decision":"rejected", <that place>}', k, v_asked
          USING ERRCODE = '22023';
      END IF;
      IF v_asked IS NOT NULL AND a->>'decision' = 'rejected' AND v_place IS NOT DISTINCT FROM v_asked THEN
        RAISE EXCEPTION 'answer row %: "no" to the place the row asks about is a bare {"decision":"rejected"}', k USING ERRCODE = '22023';
      END IF;
      IF v_asked IS NULL AND (a->>'decision' = 'rejected' OR v_place IS NULL) THEN
        RAISE EXCEPTION 'answer row % asks where: the reading is {"decision":"confirmed", <the place he named>} or unsure', k USING ERRCODE = '22023';
      END IF;
    END IF;
    v_rows := v_rows || jsonb_build_object(k, jsonb_build_object('verbatim', v->>'verbatim',
                'sha256', encode(sha256(convert_to(v->>'verbatim', 'UTF8')), 'hex'), 'answer', a));
  END LOOP;
  INSERT INTO evidence_runs(user_id, run_kind, pass, producer, code_version, config, status, finished_at, counts)
  VALUES (p_user_id, 'review_answers', 'review_sheet', p_producer, p_code_version,
          jsonb_build_object('sheet_run', p_sheet_run, 'message_ref', v_ref, 'message_at', p_message_at, 'rows', v_rows), 'done', now(),
          jsonb_build_object('answers', (SELECT count(*) FROM jsonb_object_keys(v_rows)), 'readings', n_read))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- 2.3a Propose image candidates. Vehicle ids are resolved through merge lineage. A candidate may always name the
--   vehicle the image is filed on now when that vehicle is the owner's, deleted or not (v3, revert-race v2: a photo
--   on a soft-deleted profile must be reviewable and rejectable). (v4, exit-test v3) A candidate may also name a live
--   vehicle outside his scope (a customer's or a family business's truck the same day): it is stored as a proposal
--   marked out_of_scope_vehicle; decide_evidence still refuses to confirm it until the vehicle is in scope (a confirmed
--   worked_on claim), and promotion still needs user_can_edit_vehicle.
-- (v9, R-T2) The previous row of the pass is found across the truck's identity: a row written before a merge names the
--   merged id, a row his confirmed same_vehicle_as pair joins names the other row; his decided row is 'already_decided'
--   whatever id the pass names now. His word on this photo and this truck, on whichever row it sits (any pass, any id
--   of the truck, this frame role; his latest human or implied decision), is kept: a "no" returns 'already_rejected'.
-- (v9, R-T1) A subject row at a place other than the subject he confirmed for this photo (evidence_places_distinct, or
--   a no-truck verdict against a truck) is answered by that confirmation: 'already_rejected' with
--   confirmed_candidate_id. Both checks are read only when he decided something on the photo.
CREATE OR REPLACE FUNCTION public.propose_image_candidates(p_run_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r evidence_runs%ROWTYPE; x jsonb; v_prev image_vehicle_candidates%ROWTYPE; v_new uuid; v_given uuid; v_veh uuid; v_cur uuid;
  v_has_prev boolean; v_out jsonb := '[]'::jsonb; n_new int := 0; n_same int := 0; v_scope uuid[];
  v_img uuid; v_truck text; v_frame text; v_word text; v_wid uuid; v_store uuid; v_ev jsonb;
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT r FROM evidence_runs WHERE id = p_run_id AND status = 'running';
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION '1..500 rows per call';
  END IF;
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(r.user_id));
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_given := (x->>'vehicle_id')::uuid;
    v_veh := CASE WHEN v_given IS NULL THEN NULL ELSE public.evidence_resolve_vehicle(v_given) END;
    IF NOT public.evidence_image_eligible(r.user_id, (x->>'image_id')::uuid, v_scope) THEN
      v_out := v_out || jsonb_build_object('image_id', x->>'image_id', 'result', 'image_not_eligible'); CONTINUE;
    END IF;
    IF v_given IS NOT NULL AND (v_veh IS NULL OR NOT (v_veh = ANY (v_scope))) THEN
      SELECT vi.vehicle_id INTO v_cur FROM vehicle_images vi WHERE vi.id = (x->>'image_id')::uuid;
      IF v_given = v_cur AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = v_cur
                                       AND r.user_id IN (v.owner_id, v.uploaded_by, v.user_id)) THEN
        v_veh := v_given;                                  -- the filing as it stands, so it can be confirmed or rejected
      ELSIF v_veh IS NOT NULL AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = v_veh AND v.deleted_at IS NULL) THEN
        x := jsonb_set(x, '{evidence}', x->'evidence' || jsonb_build_array(jsonb_build_object('kind','out_of_scope_vehicle','id',v_veh)));
      ELSE
        v_out := v_out || jsonb_build_object('image_id', x->>'image_id', 'result', 'vehicle_not_in_scope'); CONTINUE;
      END IF;
    END IF;
    IF (r.pass = 'photos_album') <> (x->>'album_link_id' IS NOT NULL) THEN
      RAISE EXCEPTION 'photos_album rows (and only they) carry album_link_id';
    END IF;
    v_img := (x->>'image_id')::uuid;
    -- (v10, F2) the row names the vehicle row the photo belongs to, never the merge survivor: the id the pass named or,
    -- when the photo sits on the survivor because a merge moved it there from a row still merged into it, that row
    -- (live unmerge_vehicle returns a photo to its merged_from_vehicle_id, so his decision stays with the photo). Readers
    -- and writers resolve the truck at read time (evidence_truck_key, evidence_identity_set). v9 stored the survivor,
    -- so a decision made while two trucks were merged stayed on the survivor after an unmerge.
    -- (v11, R2) and a photo the merge did not move (filed on the survivor all along, or kept on the merged-away row
    -- because the survivor already held its file) is stored on the row it is filed on, when that row is the truck the
    -- pass names: v10 stored the id the pass named, so his yes moved to the other truck on an unmerge (live: at least
    -- 5,000 photos sit on merged-away rows)
    v_store := v_given;
    IF v_given IS NOT NULL THEN
      SELECT CASE WHEN vi.merged_from_vehicle_id IS NOT NULL AND vi.vehicle_id = v_veh
                       AND public.evidence_resolve_vehicle(vi.merged_from_vehicle_id) = v_veh THEN vi.merged_from_vehicle_id
                  WHEN vi.vehicle_id IS NOT NULL AND public.evidence_resolve_vehicle(vi.vehicle_id) = v_veh THEN vi.vehicle_id
                  ELSE v_given END INTO v_store
        FROM vehicle_images vi WHERE vi.id = v_img;
      v_store := coalesce(v_store, v_given);
    END IF;
    -- (v11 patch, runner db harness) the evidence as it is stored: a row on another id of the named truck carries
    -- named_by_pass, so the "same row again" test compares the stored form (79bfe891 compared the pass's own evidence and
    -- re-wrote every undecided row of a photo filed on a merged-away row under a new id on each run)
    v_ev := CASE WHEN v_store IS DISTINCT FROM v_given
                 THEN x->'evidence' || jsonb_build_array(jsonb_build_object('kind','named_by_pass','id',v_given))
                 ELSE x->'evidence' END;
    SELECT * INTO v_prev FROM image_vehicle_candidates
     WHERE image_id = v_img AND user_id = r.user_id                                 -- (v5, readers v4 #2) his row only
       AND coalesce(vehicle_id::text, subject_key, '-') = coalesce(v_store::text, x->>'subject_key', '-')
       AND pass = r.pass AND superseded_by IS NULL FOR UPDATE;
    v_has_prev := FOUND;
    -- (v9, R-T2) not found under the id as given: the same truck under another id is the previous row
    IF NOT v_has_prev AND v_veh IS NOT NULL AND EXISTS (
         SELECT 1 FROM image_vehicle_candidates o WHERE o.image_id = v_img AND o.user_id = r.user_id AND o.pass = r.pass
            AND o.superseded_by IS NULL AND o.vehicle_id IS NOT NULL AND o.vehicle_id <> v_store) THEN
      SELECT * INTO v_prev FROM image_vehicle_candidates
       WHERE image_id = v_img AND user_id = r.user_id AND pass = r.pass AND superseded_by IS NULL
         AND vehicle_id = ANY (public.evidence_identity_set(v_veh, r.user_id))
       ORDER BY created_at DESC, id LIMIT 1 FOR UPDATE;
      v_has_prev := FOUND;
    END IF;
    IF v_has_prev THEN
      IF EXISTS (SELECT 1 FROM evidence_decisions d WHERE d.target_kind = 'image_candidate' AND d.target_id = v_prev.id) THEN
        v_out := v_out || jsonb_build_object('image_id', x->>'image_id', 'result', 'already_decided', 'candidate_id', v_prev.id); CONTINUE;
      END IF;
      IF v_prev.verdict = x->>'verdict' AND v_prev.confidence = (x->>'confidence')::numeric
         AND v_prev.evidence = v_ev AND v_prev.join_key = x->>'join_key'
         AND v_prev.image_class = coalesce(x->>'image_class','own') AND v_prev.frame_role = coalesce(x->>'frame_role','subject') THEN
        n_same := n_same + 1; CONTINUE;
      END IF;
    END IF;
    -- (v9, R-T2/R-T1) his word on this photo, read only when he decided something on it
    IF EXISTS (SELECT 1 FROM image_vehicle_candidates o JOIN evidence_decisions d ON d.target_kind = 'image_candidate' AND d.target_id = o.id
                WHERE o.image_id = v_img AND o.user_id = r.user_id AND o.superseded_by IS NULL
                  AND (d.decided_by LIKE 'human:%' OR d.decided_by LIKE 'implied:%')) THEN
      v_truck := public.evidence_truck_key(v_veh, x->>'subject_key', r.user_id);
      v_frame := coalesce(x->>'frame_role', 'subject');
      v_word := NULL; v_wid := NULL;
      SELECT o.id, d.decision INTO v_wid, v_word FROM image_vehicle_candidates o
        CROSS JOIN LATERAL (SELECT y.decision, y.created_at, y.id FROM evidence_decisions y
                             WHERE y.target_kind = 'image_candidate' AND y.target_id = o.id AND y.decision IN ('confirmed','rejected')
                               AND (y.decided_by LIKE 'human:%' OR y.decided_by LIKE 'implied:%')
                             ORDER BY y.created_at DESC, y.id DESC LIMIT 1) d
       WHERE o.image_id = v_img AND o.user_id = r.user_id AND o.superseded_by IS NULL AND o.frame_role = v_frame
         AND coalesce(public.evidence_truck_key(o.vehicle_id, o.subject_key, r.user_id), 'none:' || o.verdict)
             = coalesce(v_truck, 'none:' || (x->>'verdict'))
       ORDER BY d.created_at DESC, d.id DESC LIMIT 1;
      IF v_word = 'rejected' THEN
        v_out := v_out || jsonb_build_object('image_id', x->>'image_id', 'result', 'already_rejected', 'candidate_id', v_wid); CONTINUE;
      END IF;
      IF v_frame = 'subject' THEN
        v_wid := NULL;
        SELECT o.id INTO v_wid FROM image_vehicle_candidates o
         WHERE o.image_id = v_img AND o.user_id = r.user_id AND o.superseded_by IS NULL AND o.frame_role = 'subject'
           AND (SELECT y.decision || '|' || split_part(y.decided_by, ':', 1) FROM evidence_decisions y
                 WHERE y.target_kind = 'image_candidate' AND y.target_id = o.id AND y.decision IN ('confirmed','rejected')
                 ORDER BY y.created_at DESC, y.id DESC LIMIT 1) = 'confirmed|human'
           AND (public.evidence_places_distinct(public.evidence_truck_key(o.vehicle_id, o.subject_key, r.user_id), v_truck)
                OR (o.verdict IN ('not_vehicle','other_vehicle')) <> (x->>'verdict' IN ('not_vehicle','other_vehicle')))
         ORDER BY o.id LIMIT 1;
        IF v_wid IS NOT NULL THEN
          v_out := v_out || jsonb_build_object('image_id', x->>'image_id', 'result', 'already_rejected', 'confirmed_candidate_id', v_wid);
          CONTINUE;
        END IF;
      END IF;
    END IF;
    v_new := gen_random_uuid();
    IF v_has_prev THEN
      UPDATE image_vehicle_candidates SET superseded_by = v_new, superseded_at = now() WHERE id = v_prev.id;
    END IF;
    INSERT INTO image_vehicle_candidates(id, user_id, run_id, image_id, vehicle_id, verdict, frame_role, subject_key, pass, join_key,
        confidence, probabilities, candidate_set, ambiguity_group, evidence, image_class, album_link_id, pass_captured_on, supersedes, created_by)
    VALUES (v_new, r.user_id, r.id, (x->>'image_id')::uuid, v_store, x->>'verdict', coalesce(x->>'frame_role','subject'), x->>'subject_key',
        r.pass, x->>'join_key', (x->>'confidence')::numeric, x->'probabilities',
        (SELECT array_agg(e::uuid) FROM jsonb_array_elements_text(coalesce(x->'candidate_set','[]')) e),
        (x->>'ambiguity_group')::uuid,
        v_ev,
        coalesce(x->>'image_class','own'), (x->>'album_link_id')::uuid,
        (x->>'pass_captured_on')::date, CASE WHEN v_has_prev THEN v_prev.id END, r.producer);
    n_new := n_new + 1;
    v_out := v_out || jsonb_build_object('image_id', x->>'image_id', 'result', 'proposed', 'candidate_id', v_new);
  END LOOP;
  RETURN jsonb_build_object('run_id', p_run_id, 'proposed', n_new, 'unchanged', n_same, 'items', v_out);
END $$;

-- 2.3b Propose capture-time claims. A Photos join is machine-confirmed only when the offset is checked here, not
--   assumed: stored - corrected must equal the stated offset, be a whole number of hours, sit in the run's allowed
--   set (config.allowed_offset_hours, default {0,3,4,6,7,8}) and come from a unique stem match.
--   Precision rule (v3, file-mode gap 1): Photos instants carry milliseconds and stored taken_at whole seconds,
--   so the whole-hour test allows a residual under 1 second; offset_seconds is stored as the whole-hour value and the
--   residual is kept in the witness.
-- (v5, readers v4 #2) The current claim looked up and superseded is the run owner's own.
-- (v6, RU5) One current claim per image is replaced only by something better:
--   * an identical claim (same rule, instant, day, offset, batch, zone) is 'unchanged', never re-written;
--   * a confirmed claim stands ('kept_stronger') unless the new one is confirmed here at a higher rank
--     (photos_exif_join > batch_offset_v1).
--   Returns the ids it wrote (claims and machine confirmations) for the runner's manifest (PLAN M10b).
-- (v7, F1) His word on the current claim:
--   * a claim he REJECTED no longer blocks the image: any new claim for another instant replaces it (the photo reads
--     undated until one is confirmed; evidence_candidates_for_images); the rejected time proposed again is
--     'already_rejected';
--   * a claim he CONFIRMED stands ('already_decided'): only his newer word in the app replaces it;
--   * every row it skips is counted: image_not_eligible, stored_time_changed, already_decided, already_rejected.
-- (v8) A job never writes his word. Rule 'owner' (the day he says a photo was taken) is written only by
--   decide_evidence, on his own "no, it was <day>" in the app, and confirmed there by that same decision; a job row with
--   rule 'owner' is refused and counted as 'owner_answer_missing' (v6's cited-answer path, evidence_owner_time_cited,
--   and v7's word-age comparison, evidence_time_word_at, are gone with the agent channel). "His word" on a claim is
--   his human decision.
-- (v9, W1) His "no" to an instant stands whichever claim it sits on: an instant whose latest human decision on ANY claim
--   of this user and photo at that instant (current or since replaced) is a rejection is 'already_rejected', never
--   written and never machine-confirmed. (v7 read his word on the current claim only, so a batch-offset claim replacing
--   the one he rejected let the next Photos join bring the same instant back, machine-confirmed.)
-- (v10, F1) ... or on that DAY: his "no" to a capture time is about the day (the sheet asks it, the reader blanks it), so
--   any instant on a day he rejected for the photo is 'already_rejected' (v9 matched the exact instant only, and a
--   whole-second copy, a 4 h batch offset or a second Photos match on the same day came back confirmed), and the batch
--   gate (confirm_capture_times_by_rule) never confirms a claim on such a day. His newer confirm of that day lifts both.
--   (M6) the photos of the rows refused as owner_answer_missing are returned (owner_answer_missing_ids).
CREATE OR REPLACE FUNCTION public.propose_capture_time_claims(p_run_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r evidence_runs%ROWTYPE; x jsonb; v_prev image_capture_time_claims%ROWTYPE; v_new uuid; v_stored timestamptz; v_corr timestamptz; v_off int;
  v_raw numeric; v_resid numeric; n int := 0; n_conf int := 0; n_kept int := 0; n_same int := 0; n_miss int := 0; v_scope uuid[];
  v_allowed int[]; v_ids uuid[] := '{}'; v_dec uuid; v_dec_ids uuid[] := '{}'; v_new_conf boolean; v_cur_conf boolean;
  n_inel int := 0; n_moved int := 0; n_decided int := 0; n_rej int := 0; v_his text; v_miss_ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT r FROM evidence_runs WHERE id = p_run_id AND status = 'running';
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '1..500 rows per call'; END IF;
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(r.user_id));
  v_allowed := coalesce((SELECT array_agg(e::int) FROM jsonb_array_elements_text(r.config->'allowed_offset_hours') e), ARRAY[0,3,4,6,7,8]);
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    -- (v8) his word is written only by his own decision (decide_evidence), never by a job
    IF x->>'rule' = 'owner' THEN
      n_miss := n_miss + 1; v_miss_ids := v_miss_ids || to_jsonb(x->>'image_id'); CONTINUE;
    END IF;
    IF NOT public.evidence_image_eligible(r.user_id, (x->>'image_id')::uuid, v_scope) THEN n_inel := n_inel + 1; CONTINUE; END IF;
    SELECT taken_at INTO v_stored FROM vehicle_images WHERE id = (x->>'image_id')::uuid;
    IF v_stored IS DISTINCT FROM (x->>'stored_taken_at')::timestamptz THEN n_moved := n_moved + 1; CONTINUE; END IF;   -- compare-and-set witness
    v_corr := (x->>'corrected_taken_at')::timestamptz;
    v_raw := CASE WHEN v_stored IS NULL THEN NULL ELSE extract(epoch FROM v_stored - v_corr) END;
    v_off := CASE WHEN v_raw IS NULL THEN NULL
                  WHEN abs(v_raw - round(v_raw / 3600) * 3600) < 1 THEN (round(v_raw / 3600) * 3600)::int
                  ELSE round(v_raw)::int END;
    v_resid := v_raw - v_off;
    v_new_conf := x->>'rule' = 'photos_exif_join' AND coalesce((x#>>'{witness,unique_match}')::boolean, false)
                  AND v_off IS NOT NULL AND v_off = (x->>'offset_seconds')::int
                  AND v_off % 3600 = 0 AND (abs(v_off) / 3600) = ANY (v_allowed);
    -- (v11, R1) wait on the current claim's row lock first: a "no" being committed on it holds that lock
    -- (decide_evidence takes it FOR UPDATE), and the day check and the reads below then take snapshots that see it. v10
    -- ran the day check on a snapshot from before his "no" committed, so a Photos join on that day was written after his
    -- lock released and machine-confirmed in this statement, where the gate never sees it.
    PERFORM 1 FROM image_capture_time_claims
     WHERE image_id = (x->>'image_id')::uuid AND user_id = r.user_id AND superseded_by IS NULL FOR UPDATE;
    -- (v9, W1) the instant he rejected, on any claim of this photo (current or since replaced), proposed again;
    -- (v10, F1) or any instant on the DAY he rejected: his "no" is about the day (the sheet asks the day, and a "no"
    -- naming the claim's own day is refused), so another instant on it (a whole-second copy, a batch offset, a second
    -- Photos match) is refused too, until his newer word confirms that day
    IF (SELECT d.decision FROM image_capture_time_claims p
          JOIN evidence_decisions d ON d.target_kind = 'capture_time_claim' AND d.target_id = p.id
                                   AND d.decided_by LIKE 'human:%' AND d.decision IN ('confirmed','rejected')
         WHERE p.user_id = r.user_id AND p.image_id = (x->>'image_id')::uuid
           AND (p.corrected_taken_at = v_corr OR p.captured_on = (x->>'captured_on')::date)
         ORDER BY d.created_at DESC, d.id DESC LIMIT 1) = 'rejected' THEN
      n_rej := n_rej + 1; CONTINUE;
    END IF;
    v_prev := NULL;
    SELECT * INTO v_prev FROM image_capture_time_claims
     WHERE image_id = (x->>'image_id')::uuid AND user_id = r.user_id AND superseded_by IS NULL;
    IF v_prev.id IS NOT NULL THEN
      -- (v7, F1; v8: his human decisions) his latest word on the current claim, if any
      v_his := (SELECT d.decision FROM evidence_decisions d
                 WHERE d.target_kind = 'capture_time_claim' AND d.target_id = v_prev.id AND d.decided_by LIKE 'human:%'
                   AND d.decision IN ('confirmed','rejected')
                 ORDER BY d.created_at DESC, d.id DESC LIMIT 1);
      -- (v6, RU5) the same claim again is not news
      IF v_his IS DISTINCT FROM 'rejected'
         AND v_prev.rule = x->>'rule' AND v_prev.corrected_taken_at = v_corr AND v_prev.captured_on = (x->>'captured_on')::date
         AND v_prev.offset_seconds IS NOT DISTINCT FROM v_off AND v_prev.batch_key IS NOT DISTINCT FROM x->>'batch_key'
         AND v_prev.local_offset_minutes IS NOT DISTINCT FROM (x->>'local_offset_minutes')::smallint THEN
        n_same := n_same + 1; CONTINUE;
      END IF;
      IF v_his = 'confirmed' THEN
        n_decided := n_decided + 1; CONTINUE;                -- he confirmed this time; only his newer word in the app replaces it
      ELSIF v_his IS NULL THEN
        v_cur_conf := public.evidence_status('capture_time_claim', v_prev.id) = 'confirmed';
        IF v_cur_conf AND NOT (v_new_conf AND (CASE x->>'rule' WHEN 'photos_exif_join' THEN 2 ELSE 1 END)
                                              > (CASE v_prev.rule WHEN 'owner' THEN 3 WHEN 'photos_exif_join' THEN 2 ELSE 1 END)) THEN
          n_kept := n_kept + 1; CONTINUE;                   -- a confirmed claim stands against a weaker or unconfirmed one
        END IF;
      END IF;
    END IF;
    v_new := gen_random_uuid();
    IF v_prev.id IS NOT NULL THEN
      UPDATE image_capture_time_claims SET superseded_by = v_new, superseded_at = now() WHERE id = v_prev.id;
    END IF;
    INSERT INTO image_capture_time_claims(id, user_id, run_id, image_id, stored_taken_at, corrected_taken_at, offset_seconds,
        local_offset_minutes, captured_on, rule, batch_key, witness, confidence, supersedes, created_by)
    VALUES (v_new, r.user_id, r.id, (x->>'image_id')::uuid, v_stored, v_corr, v_off,
        (x->>'local_offset_minutes')::smallint, (x->>'captured_on')::date, x->>'rule', x->>'batch_key',
        CASE WHEN v_resid IS NOT NULL AND v_resid <> 0 THEN x->'witness' || jsonb_build_object('residual_seconds', round(v_resid, 3))
             ELSE x->'witness' END,
        (x->>'confidence')::numeric, v_prev.id, r.producer);
    n := n + 1; v_ids := v_ids || v_new;
    IF v_new_conf THEN
      INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, reason, detail)
      VALUES (r.user_id, 'capture_time_claim', v_new, 'confirmed', 'check:photos_exif_join',
              'unique stem match; stored minus Photos instant is a whole allowed hour offset',
              jsonb_build_object('writer', 'propose_capture_time_claims', 'offset_seconds', v_off))
      RETURNING id INTO v_dec;
      n_conf := n_conf + 1; v_dec_ids := v_dec_ids || v_dec;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('proposed', n, 'machine_confirmed', n_conf, 'kept_stronger', n_kept, 'unchanged', n_same,
                            'owner_answer_missing', n_miss, 'image_not_eligible', n_inel, 'stored_time_changed', n_moved,
                            'already_decided', n_decided, 'already_rejected', n_rej,
                            'ids', to_jsonb(v_ids), 'decision_ids', to_jsonb(v_dec_ids), 'owner_answer_missing_ids', v_miss_ids);
END $$;

-- 2.3c Gated batch-rule confirmation: the gate run's counts hold per-batch agreement
--   {"batches": {"<batch_key>": {"joined": n, "agreement": 0.995, "offset_seconds": 14400, "worst_day_agreement": 0.99,
--                                "days": {"<upload day>": {"joined": n, "agreement": 0.995, "offset_seconds": 14400}}}}}.
--   A pooled key ('source|pool|tz period') also needs every contributing day to agree (worst_day_agreement), and
--   (v4, exit-test v3) the claim's OWN upload day (witness.upload_day) must be a contributing day with at least 10
--   joined rows agreeing at 0.99 on the same offset: the offset is a property of the upload batch, so a day that
--   contributed no joined rows is never confirmed by its neighbours.
CREATE OR REPLACE FUNCTION public.confirm_capture_times_by_rule(p_gate_run_id uuid, p_claim_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g evidence_runs%ROWTYPE; v_id uuid; n int := 0; c image_capture_time_claims%ROWTYPE; b jsonb; v_dec uuid; v_dec_ids uuid[] := '{}';
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT g FROM evidence_runs WHERE id = p_gate_run_id AND pass = 'time_rule_gate' AND status = 'done';
  IF cardinality(p_claim_ids) > 1000 THEN RAISE EXCEPTION 'at most 1000 claims per call'; END IF;
  FOREACH v_id IN ARRAY p_claim_ids LOOP
    SELECT * INTO c FROM image_capture_time_claims WHERE id = v_id AND superseded_by IS NULL AND rule = 'batch_offset_v1' AND user_id = g.user_id;
    CONTINUE WHEN NOT FOUND;
    b := g.counts->'batches'->c.batch_key;
    CONTINUE WHEN b IS NULL OR coalesce((b->>'joined')::int, 0) < 50 OR coalesce((b->>'agreement')::numeric, 0) < 0.99
               OR (c.batch_key LIKE '%|pool|%' AND coalesce((b->>'worst_day_agreement')::numeric, 0) < 0.99)
               OR (b->>'offset_seconds')::int IS DISTINCT FROM c.offset_seconds;
    CONTINUE WHEN c.batch_key LIKE '%|pool|%' AND (
                  c.witness->>'upload_day' IS NULL
                  OR coalesce((b->'days'->(c.witness->>'upload_day')->>'joined')::int, 0) < 10
                  OR coalesce((b->'days'->(c.witness->>'upload_day')->>'agreement')::numeric, 0) < 0.99
                  OR (b->'days'->(c.witness->>'upload_day')->>'offset_seconds')::int IS DISTINCT FROM c.offset_seconds);
    CONTINUE WHEN EXISTS (SELECT 1 FROM evidence_decisions d WHERE d.target_kind = 'capture_time_claim' AND d.target_id = c.id);
    -- (v10, F1) never on a day he said no to for this photo (his latest human word on any claim of it on that day)
    CONTINUE WHEN (SELECT d.decision FROM image_capture_time_claims p
                     JOIN evidence_decisions d ON d.target_kind = 'capture_time_claim' AND d.target_id = p.id
                                              AND d.decided_by LIKE 'human:%' AND d.decision IN ('confirmed','rejected')
                    WHERE p.user_id = c.user_id AND p.image_id = c.image_id AND p.captured_on = c.captured_on
                    ORDER BY d.created_at DESC, d.id DESC LIMIT 1) = 'rejected';
    INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, reason, detail)
    VALUES (c.user_id, 'capture_time_claim', c.id, 'confirmed', 'rule:batch_offset_v1', 'batch gate passed',
            jsonb_build_object('writer', 'confirm_capture_times_by_rule', 'gate_run_id', g.id, 'batch_key', c.batch_key))
    RETURNING id INTO v_dec;
    n := n + 1; v_dec_ids := v_dec_ids || v_dec;
  END LOOP;
  RETURN jsonb_build_object('confirmed', n, 'gate_run_id', g.id, 'decision_ids', to_jsonb(v_dec_ids));
END $$;

-- (v4, exit-test v3) A cited Nuke row must be the owner's. receipts, payment_events and work_sessions carry user_id;
-- qb_transactions, journal_entries and deal_jackets are keyed by organization and vehicle: they count when the
-- organization is one he confirmed as his (account map, nuke_org:<id>) or the row's vehicle is in his scope. Any other
-- table is refused until a check for it is written here.
CREATE OR REPLACE FUNCTION public.evidence_source_row_ok(p_user_id uuid, p_table text, p_row_id uuid, p_scope uuid[]) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_orgs uuid[];
BEGIN
  v_orgs := ARRAY(SELECT substr(a.account_ref, 10)::uuid FROM evidence_account_entities a
                   WHERE a.user_id = p_user_id AND a.superseded_by IS NULL AND a.account_ref LIKE 'nuke_org:%'
                     AND a.entity_key ~ '^(owner|owner_business:)' AND public.evidence_status('account_entity', a.id) = 'confirmed');
  RETURN CASE p_table
    WHEN 'receipts'        THEN EXISTS (SELECT 1 FROM receipts WHERE id = p_row_id AND user_id = p_user_id)
    WHEN 'payment_events'  THEN EXISTS (SELECT 1 FROM payment_events WHERE id = p_row_id AND user_id = p_user_id)
    WHEN 'work_sessions'   THEN EXISTS (SELECT 1 FROM work_sessions WHERE id = p_row_id AND user_id = p_user_id)
    WHEN 'qb_transactions' THEN EXISTS (SELECT 1 FROM qb_transactions q WHERE q.id = p_row_id
                                          AND (q.organization_id = ANY (v_orgs) OR q.vehicle_id = ANY (p_scope)))
    WHEN 'journal_entries' THEN EXISTS (SELECT 1 FROM journal_entries j WHERE j.id = p_row_id
                                          AND (j.entity_id = ANY (v_orgs) OR j.vehicle_id = ANY (p_scope)))
    WHEN 'deal_jackets'    THEN EXISTS (SELECT 1 FROM deal_jackets d WHERE d.id = p_row_id
                                          AND (d.entity_id = ANY (v_orgs) OR d.vehicle_id = ANY (p_scope)))
    -- (v5, rules-channels v4 #7) a Photos item already on the image spine: its appearance row, seen by him
    WHEN 'image_appearances' THEN EXISTS (SELECT 1 FROM image_appearances a WHERE a.id = p_row_id AND a.seen_by = p_user_id)
    ELSE false END;
END $$;

-- (v7, D2) Is an owner statement the money its who-paid row asked about? The row has one target of his (evidence_sheet_row):
--   * a link T (an unallocated placement): the statement has T's direction (payment_out for out, payment_in for in), T's
--     payment key (his word 'owner:<answer ref>' only when T has none), T's amount (or, when T has none and a payment
--     key, the amount of that payment's own source line), no allocation, T's date or none, T's category or none;
--   * an acquisition (sale) claim K: payment_out (payment_in), his word as the payment key, K's amount or its cash part
--     (amount less trade-in), a date inside K's window or none, category 'purchase' or none for an acquisition;
--   * and its answers_row_target names that target.
--   Returns NULL when it is, else the reason ('statement_not_the_asked_money').
--   (v8) It now guards the statement decide_evidence builds on his own who-paid decision (evidence_statement_for); no
--   job proposes a statement any more. A who-paid link target has no payment key (evidence_sheet_row), so the key is
--   always his word.
CREATE OR REPLACE FUNCTION public.evidence_statement_problem(p_user_id uuid, x jsonb, p_rc jsonb, p_aref text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE t jsonb; tl evidence_links%ROWTYPE; tk vehicle_change_claims%ROWTYPE; v_amt bigint; v_on date := (x->>'occurred_on')::date;
        v_dir text; v_key text := x->>'payment_key'; v_cents bigint := (x->>'amount_cents')::bigint;
BEGIN
  SELECT e INTO t FROM jsonb_array_elements(p_rc->'targets') e WHERE e->>'kind' = p_rc->>'question' AND e->>'id' ~ '^[0-9a-f-]{36}$' LIMIT 1;
  IF t IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(x->'evidence', '[]'::jsonb)) e
                               WHERE e->>'kind' = 'answers_row_target' AND e->>'ref' = t->>'id') THEN
    RETURN 'owner_answer_missing';
  END IF;
  IF x->>'allocated_cents' IS NOT NULL OR x->>'role' NOT IN ('payment_out','payment_in') THEN
    RETURN 'statement_not_the_asked_money';
  END IF;
  IF p_rc->>'question' = 'evidence_link' THEN
    SELECT * INTO tl FROM evidence_links WHERE id = (t->>'id')::uuid AND user_id = p_user_id;
    IF NOT FOUND THEN RETURN 'owner_answer_missing'; END IF;
    v_dir := tl.direction;
    v_amt := coalesce(tl.amount_cents,
                      (SELECT max(o.amount_cents) FROM evidence_links o
                        WHERE o.user_id = p_user_id AND o.payment_key = tl.payment_key AND o.superseded_by IS NULL
                          AND public.evidence_is_payment_source(o.source_kind)));
    IF v_key IS DISTINCT FROM coalesce(tl.payment_key, 'owner:' || p_aref)
       OR v_amt IS NULL OR v_cents IS DISTINCT FROM v_amt
       OR (v_on IS NOT NULL AND v_on IS DISTINCT FROM tl.occurred_on AND v_on IS DISTINCT FROM tl.transaction_on)
       OR (x->>'cost_category' IS NOT NULL AND x->>'cost_category' IS DISTINCT FROM tl.cost_category) THEN
      RETURN 'statement_not_the_asked_money';
    END IF;
  ELSE
    SELECT * INTO tk FROM vehicle_change_claims WHERE id = (t->>'id')::uuid AND user_id = p_user_id AND kind IN ('acquisition','sale');
    IF NOT FOUND THEN RETURN 'owner_answer_missing'; END IF;
    v_dir := CASE tk.kind WHEN 'acquisition' THEN 'out' ELSE 'in' END;
    IF v_key IS DISTINCT FROM 'owner:' || p_aref OR tk.amount_cents IS NULL
       OR NOT (v_cents = tk.amount_cents OR v_cents = tk.amount_cents - coalesce(tk.trade_in_cents, 0))
       OR (v_on IS NOT NULL AND (v_on < coalesce(tk.occurred_from, v_on) OR v_on > coalesce(tk.occurred_to, tk.occurred_from, v_on)))
       OR (x->>'cost_category' IS NOT NULL AND (tk.kind <> 'acquisition' OR x->>'cost_category' <> 'purchase')) THEN
      RETURN 'statement_not_the_asked_money';
    END IF;
  END IF;
  IF x->>'direction' IS DISTINCT FROM v_dir OR x->>'role' <> (CASE v_dir WHEN 'in' THEN 'payment_in' ELSE 'payment_out' END) THEN
    RETURN 'statement_not_the_asked_money';
  END IF;
  RETURN NULL;
END $$;

-- (v8) The owner statement his own who-paid decision records: the money the row asked about, read from its one target
--   (or that target's current successor asking the same question), in the shape evidence_statement_problem checks:
--   * a placement link T (no payment key: the who-paid row rule): T's direction and role, his word as the payment key
--     ('owner:' || the stored answer he confirmed), T's amount, T's date, T's category and source label, T's place;
--   * an acquisition (sale) claim K: payment_out (payment_in), his word as the key, K's cash part (amount less
--     trade-in), K's day when its window is one day (else no date), category 'purchase' for an acquisition, K's vehicle;
--   * the entity he named on the paying side (payer for money out, payee for money in); the other side unknown (NULL);
--   * evidence: the row target it answers (answers_row_target), the row now, and the review row.
--   Returns the link as jsonb; NULL when the target is not his money.
CREATE OR REPLACE FUNCTION public.evidence_statement_for(p_user_id uuid, p_kind text, p_target uuid, p_aref text, p_entity text,
                                                         p_row_target uuid, p_review_ref text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE tl evidence_links%ROWTYPE; tk vehicle_change_claims%ROWTYPE; v_dir text;
BEGIN
  IF p_kind = 'evidence_link' THEN
    SELECT * INTO tl FROM evidence_links WHERE id = p_target AND user_id = p_user_id AND source_kind <> 'photos_album';
    IF NOT FOUND OR tl.direction IS NULL OR tl.direction NOT IN ('out','in') THEN RETURN NULL; END IF;
    v_dir := tl.direction;
    RETURN jsonb_build_object(
      'vehicle_id', public.evidence_resolve_vehicle(tl.vehicle_id), 'subject_key', tl.subject_key,
      'source_kind', 'owner_statement', 'external_ref', p_aref, 'occurred_on', tl.occurred_on,
      'direction', v_dir, 'amount_cents', tl.amount_cents, 'cost_category', tl.cost_category, 'source_label', tl.source_label,
      'role', CASE v_dir WHEN 'in' THEN 'payment_in' ELSE 'payment_out' END,
      'payment_key', coalesce(tl.payment_key, 'owner:' || p_aref),
      'payer_entity', CASE WHEN v_dir = 'out' THEN p_entity END, 'payee_entity', CASE WHEN v_dir = 'in' THEN p_entity END,
      'evidence', jsonb_build_array(jsonb_build_object('kind', 'answers_row_target', 'ref', p_row_target),
                                    jsonb_build_object('kind', 'link', 'id', tl.id),
                                    jsonb_build_object('kind', 'review', 'ref', p_review_ref)));
  ELSIF p_kind = 'change_claim' THEN
    SELECT * INTO tk FROM vehicle_change_claims WHERE id = p_target AND user_id = p_user_id AND kind IN ('acquisition','sale');
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_dir := CASE tk.kind WHEN 'acquisition' THEN 'out' ELSE 'in' END;
    RETURN jsonb_build_object(
      'vehicle_id', public.evidence_resolve_vehicle(tk.vehicle_id), 'subject_key', NULL,
      'source_kind', 'owner_statement', 'external_ref', p_aref,
      'occurred_on', CASE WHEN tk.occurred_from IS NOT NULL AND coalesce(tk.occurred_to, tk.occurred_from) = tk.occurred_from
                          THEN tk.occurred_from END,
      'direction', v_dir, 'amount_cents', tk.amount_cents - coalesce(tk.trade_in_cents, 0),
      'cost_category', CASE WHEN tk.kind = 'acquisition' THEN 'purchase' END, 'source_label', NULL,
      'role', CASE v_dir WHEN 'in' THEN 'payment_in' ELSE 'payment_out' END, 'payment_key', 'owner:' || p_aref,
      'payer_entity', CASE WHEN v_dir = 'out' THEN p_entity END, 'payee_entity', CASE WHEN v_dir = 'in' THEN p_entity END,
      'evidence', jsonb_build_array(jsonb_build_object('kind', 'answers_row_target', 'ref', p_row_target),
                                    jsonb_build_object('kind', 'claim', 'id', tk.id),
                                    jsonb_build_object('kind', 'review', 'ref', p_review_ref)));
  END IF;
  RETURN NULL;
END $$;

-- 2.3d Propose evidence links. Re-proposing the same (source_key, vehicle) supersedes an undecided row of the same
--   user. A row may name no vehicle and a subject_key instead (a truck with no Nuke row yet), or no vehicle at all
--   (unallocated; listed in the day record).
--   (v5, rules-channels v4 #4) payer_entity / payee_entity: a pass may name only a third party the source names
--   ('third_party:<x>'); whether it was his money or one of his businesses' is his call, read from his confirmed
--   account map (or his own statement). A row that names 'owner' or 'owner_business:*' is refused
--   (entity_is_owners_call).
--   (v5-v7) A link resting on his word (source_kind 'owner_statement', or a payment key 'owner:...') was accepted here
--   when it cited his stored answer to a who-paid row and was exactly the money that row asked about.
--   (v8, lead directive) A job never writes his word: every owner statement and every 'owner:' key is refused here
--   ('owner_answer_missing'). His statement is written by decide_evidence when he answers the who-paid row himself in
--   the app (with the same "asked money" rule, evidence_statement_problem), and confirmed by that decision.
CREATE OR REPLACE FUNCTION public.propose_evidence_links(p_run_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r evidence_runs%ROWTYPE; x jsonb; v_key text; v_given uuid; v_veh uuid; v_prev evidence_links%ROWTYPE; v_new uuid;
        n int := 0; v_out jsonb := '[]'; v_scope uuid[];
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT r FROM evidence_runs WHERE id = p_run_id AND status = 'running';
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '1..500 rows per call'; END IF;
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(r.user_id));
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_given := (x->>'vehicle_id')::uuid;
    v_veh := CASE WHEN v_given IS NULL THEN NULL ELSE public.evidence_resolve_vehicle(v_given) END;
    v_key := coalesce((x->>'source_table') || ':' || (x->>'source_row_id'), x->>'external_ref') || coalesce('#' || (x->>'anchor'), '');
    -- (v8) his word comes only from his own decision (decide_evidence on a who-paid row), never from a job
    IF x->>'source_kind' = 'owner_statement' OR x->>'payment_key' LIKE 'owner:%' THEN
      v_out := v_out || jsonb_build_object('ref', v_key, 'result', 'owner_answer_missing'); CONTINUE;
    END IF;
    IF v_given IS NOT NULL AND (v_veh IS NULL OR NOT (v_veh = ANY (v_scope))) THEN
      v_out := v_out || jsonb_build_object('ref', v_key, 'result', 'vehicle_not_in_scope'); CONTINUE;
    END IF;
    IF x->>'source_table' IS NOT NULL
       AND NOT public.evidence_source_row_ok(r.user_id, x->>'source_table', (x->>'source_row_id')::uuid, v_scope) THEN
      v_out := v_out || jsonb_build_object('ref', v_key, 'result', 'source_not_users'); CONTINUE;
    END IF;
    -- (v4, exit-test v3) an unknown party is NULL, never the literal 'unknown' (the CHECK refuses it)
    x := x || jsonb_build_object('payer_entity', nullif(x->>'payer_entity', 'unknown'), 'payee_entity', nullif(x->>'payee_entity', 'unknown'));
    IF coalesce(x->>'payer_entity', 'third_party:') NOT LIKE 'third_party:%'
       OR coalesce(x->>'payee_entity', 'third_party:') NOT LIKE 'third_party:%' THEN
      -- (v5, rules-channels v4 #4) owner vs business is his call (account map), never a pass's
      v_out := v_out || jsonb_build_object('ref', v_key, 'result', 'entity_is_owners_call'); CONTINUE;
    END IF;
    SELECT * INTO v_prev FROM evidence_links WHERE user_id = r.user_id AND source_key = v_key     -- (v5) his row only
       AND coalesce(vehicle_id::text, subject_key, '-') = coalesce(v_veh::text, x->>'subject_key', '-') AND superseded_by IS NULL FOR UPDATE;
    IF FOUND AND EXISTS (SELECT 1 FROM evidence_decisions d WHERE d.target_kind IN ('evidence_link','album_map') AND d.target_id = v_prev.id) THEN
      v_out := v_out || jsonb_build_object('ref', v_key, 'result', 'already_decided', 'link_id', v_prev.id); v_prev := NULL; CONTINUE;
    END IF;
    v_new := gen_random_uuid();
    IF v_prev.id IS NOT NULL THEN UPDATE evidence_links SET superseded_by = v_new, superseded_at = now() WHERE id = v_prev.id; END IF;
    INSERT INTO evidence_links(id, user_id, run_id, vehicle_id, subject_key, source_kind, source_table, source_row_id, external_ref, anchor,
        source_key, source_sha256, source_label, occurred_on, transaction_on, direction, amount_cents, allocated_cents, cost_category,
        counterparty_label, role, payment_key, payer_entity, payee_entity, from_account_ref, to_account_ref, pass, join_key, confidence,
        payment_join_confidence, evidence, summary, supersedes, created_by)
    VALUES (v_new, r.user_id, r.id, v_veh, x->>'subject_key', x->>'source_kind', x->>'source_table', (x->>'source_row_id')::uuid,
        x->>'external_ref', x->>'anchor', v_key, x->>'source_sha256', x->>'source_label', (x->>'occurred_on')::date,
        (x->>'transaction_on')::date, x->>'direction',
        (x->>'amount_cents')::bigint, (x->>'allocated_cents')::bigint, x->>'cost_category', x->>'counterparty_label',
        x->>'role', x->>'payment_key', x->>'payer_entity', x->>'payee_entity', x->>'from_account_ref', x->>'to_account_ref',
        r.pass, x->>'join_key', (x->>'confidence')::numeric, (x->>'payment_join_confidence')::numeric, x->'evidence', x->>'summary',
        v_prev.id, r.producer);
    n := n + 1;
    v_out := v_out || jsonb_build_object('ref', v_key, 'result', CASE WHEN v_prev.id IS NULL THEN 'proposed' ELSE 'superseded' END, 'link_id', v_new);
    v_prev := NULL;
  END LOOP;
  RETURN jsonb_build_object('proposed', n, 'items', v_out);
END $$;

-- 2.3e Propose account/entity map rows (the owner confirms them; tax characterisation is never stored).
-- (v9, M5) A row he decided is kept and reported, as by the other writers: skipped [{account_ref, result
-- 'already_decided', id}] and the count already_decided.
CREATE OR REPLACE FUNCTION public.propose_account_entities(p_run_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r evidence_runs%ROWTYPE; x jsonb; v_prev uuid; v_new uuid; n int := 0; v_ids uuid[] := '{}'; v_skipped jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT r FROM evidence_runs WHERE id = p_run_id AND status = 'running';
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '1..200 rows per call'; END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    SELECT id INTO v_prev FROM evidence_account_entities WHERE user_id = r.user_id AND account_ref = x->>'account_ref' AND superseded_by IS NULL;
    IF v_prev IS NOT NULL AND EXISTS (SELECT 1 FROM evidence_decisions d WHERE d.target_kind = 'account_entity' AND d.target_id = v_prev) THEN
      v_skipped := v_skipped || jsonb_build_object('account_ref', x->>'account_ref', 'result', 'already_decided', 'id', v_prev);
      CONTINUE;
    END IF;
    v_new := gen_random_uuid();
    IF v_prev IS NOT NULL THEN UPDATE evidence_account_entities SET superseded_by = v_new, superseded_at = now() WHERE id = v_prev; END IF;
    INSERT INTO evidence_account_entities(id, user_id, run_id, account_ref, entity_key, confidence, evidence, supersedes, created_by)
    VALUES (v_new, r.user_id, r.id, x->>'account_ref', x->>'entity_key', (x->>'confidence')::numeric, x->'evidence', v_prev, r.producer);
    n := n + 1; v_ids := v_ids || v_new;
  END LOOP;
  RETURN jsonb_build_object('proposed', n, 'ids', to_jsonb(v_ids), 'already_decided', jsonb_array_length(v_skipped), 'skipped', v_skipped);
END $$;

-- Shared support-row check and insert (used by propose_change_claim and propose_claim_support).
CREATE OR REPLACE FUNCTION public.evidence_insert_support(p_claim_id uuid, p_user_id uuid, p_producer text, p_support jsonb, p_scope uuid[])
RETURNS int LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE s jsonb; v_ok boolean; n int := 0;
BEGIN
  IF current_setting('evidence.writer', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'evidence_insert_support: writers only' USING ERRCODE = '42501';
  END IF;
  FOR s IN SELECT * FROM jsonb_array_elements(coalesce(p_support,'[]')) LOOP
    v_ok := CASE s->>'evidence_kind'
      WHEN 'image_candidate'    THEN EXISTS (SELECT 1 FROM image_vehicle_candidates WHERE id = (s->>'evidence_id')::uuid AND user_id = p_user_id)
      WHEN 'evidence_link'      THEN EXISTS (SELECT 1 FROM evidence_links WHERE id = (s->>'evidence_id')::uuid AND user_id = p_user_id)
      WHEN 'capture_time_claim' THEN EXISTS (SELECT 1 FROM image_capture_time_claims WHERE id = (s->>'evidence_id')::uuid AND user_id = p_user_id)
      WHEN 'change_claim'       THEN EXISTS (SELECT 1 FROM vehicle_change_claims WHERE id = (s->>'evidence_id')::uuid AND user_id = p_user_id)
      WHEN 'vehicle_image'      THEN public.evidence_image_eligible(p_user_id, (s->>'evidence_id')::uuid, p_scope)
      WHEN 'work_session'       THEN EXISTS (SELECT 1 FROM work_sessions WHERE id = (s->>'evidence_id')::uuid AND user_id = p_user_id)
      ELSE false END;
    IF NOT v_ok THEN RAISE EXCEPTION 'support row % is not this user''s', s; END IF;
    INSERT INTO vehicle_change_claim_support(claim_id, user_id, evidence_kind, evidence_id, stance, about, weight, note, created_by)
    VALUES (p_claim_id, p_user_id, s->>'evidence_kind', (s->>'evidence_id')::uuid, s->>'stance', coalesce(s->>'about','other'),
            coalesce((s->>'weight')::numeric, 1), s->>'note', p_producer);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- 2.3f Propose one change claim with its support rows. A 'worked_on' claim may name a vehicle outside scope (it is
--   the question "did you work on this truck?"); every other kind needs the vehicle in scope.
--   (v4, exit-test v3) 'worked_on' and 'work_performed' may name a truck with no row by subject_key (vehicle_id NULL).
--   custody_bounds (the daily pass over every vehicle) proposes only an UPPER bound for acquisition (occurred_to = the
--   first own-photo day, no occurred_from, confidence <= 0.5) and never a sale; it writes nothing when a non-rejected
--   acquisition claim from any other pass (a deal document, a ledger line, the owner) exists on the identity. The first
--   own photo can be a pre-purchase visit (a seller's yard before the deal), so it is never the acquisition date.
CREATE OR REPLACE FUNCTION public.propose_change_claim(p_run_id uuid, p_claim jsonb, p_support jsonb, p_supersedes uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r evidence_runs%ROWTYPE; v_new uuid := gen_random_uuid(); v_veh uuid; v_scope uuid[];
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT r FROM evidence_runs WHERE id = p_run_id AND status = 'running';
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(r.user_id));
  v_veh := CASE WHEN p_claim->>'vehicle_id' IS NULL THEN NULL ELSE public.evidence_resolve_vehicle((p_claim->>'vehicle_id')::uuid) END;
  IF p_claim->>'vehicle_id' IS NULL AND p_claim->>'subject_key' IS NOT NULL AND p_claim->>'kind' IN ('worked_on','work_performed') THEN
    NULL;                                                   -- a truck with no Nuke row (vcc_subject checks the key)
  ELSIF v_veh IS NULL OR NOT (v_veh = ANY (v_scope)) THEN
    IF NOT (p_claim->>'kind' = 'worked_on' AND v_veh IS NOT NULL AND EXISTS (SELECT 1 FROM vehicles WHERE id = v_veh AND deleted_at IS NULL)) THEN
      RAISE EXCEPTION 'vehicle % not in scope', p_claim->>'vehicle_id' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF r.pass = 'custody_bounds' THEN
    IF p_claim->>'kind' IS DISTINCT FROM 'acquisition' OR p_claim->>'occurred_from' IS NOT NULL OR p_claim->>'occurred_to' IS NULL
       OR coalesce((p_claim->>'confidence')::numeric, 1) > 0.5 THEN
      RAISE EXCEPTION 'custody_bounds proposes only an acquisition upper bound (occurred_to, no occurred_from, confidence <= 0.5), never a sale'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM vehicle_change_claims k JOIN evidence_runs er ON er.id = k.run_id
                WHERE k.user_id = r.user_id                                          -- (v5, readers v4 #2) his own claims
                  AND k.vehicle_id = ANY (public.evidence_identity_set(v_veh, r.user_id)) AND k.superseded_by IS NULL AND k.kind = 'acquisition'
                  AND er.pass <> 'custody_bounds' AND public.evidence_status('change_claim', k.id) <> 'rejected') THEN
      RETURN NULL;                                          -- a sourced acquisition exists; custody_bounds stays out
    END IF;
  END IF;
  IF p_claim->>'related_vehicle_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM vehicles WHERE id = (p_claim->>'related_vehicle_id')::uuid) THEN
    RAISE EXCEPTION 'related vehicle does not exist';
  END IF;
  IF p_supersedes IS NOT NULL THEN
    -- (v9, W4) his word on a claim is his decision on it AND his who-paid statement answering it (the statement, or
    -- its support row on the claim): a pass adds support to such a claim, never re-writes it (a re-written claim
    -- left his statement on the old row, reopened who_paid and, answered again, left two statements)
    IF EXISTS (SELECT 1 FROM evidence_decisions d WHERE d.target_kind='change_claim' AND d.target_id = p_supersedes AND d.decided_by LIKE 'human:%')
       OR EXISTS (SELECT 1 FROM vehicle_change_claim_support s WHERE s.claim_id = p_supersedes AND s.user_id = r.user_id
                    AND s.superseded_by IS NULL AND s.created_by LIKE 'human:%')
       OR EXISTS (SELECT 1 FROM evidence_links o WHERE o.user_id = r.user_id AND o.superseded_by IS NULL AND o.source_kind = 'owner_statement'
                    AND (o.evidence @> jsonb_build_array(jsonb_build_object('kind', 'answers_row_target', 'ref', p_supersedes))
                         OR o.evidence @> jsonb_build_array(jsonb_build_object('kind', 'claim', 'id', p_supersedes)))) THEN
      RAISE EXCEPTION 'claim % carries an owner decision (his decision or his who-paid statement); a pass may not supersede it (add support with propose_claim_support)', p_supersedes;
    END IF;
    UPDATE vehicle_change_claims SET superseded_by = v_new, superseded_at = now()
     WHERE id = p_supersedes AND user_id = r.user_id AND superseded_by IS NULL;
    -- (v9, M7) what it replaces is a current claim of this user; nothing else is recorded as replaced
    IF NOT FOUND THEN
      RAISE EXCEPTION 'claim % is not a current claim of this user: nothing to supersede', p_supersedes USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO vehicle_change_claims(id, user_id, run_id, vehicle_id, subject_key, claim_domain, kind, occurred_from, occurred_to,
      amount_cents, trade_in_cents, related_vehicle_id, survivor_vehicle_id, party_entity, asserted_value, summary, confidence,
      supersedes, created_by)
  VALUES (v_new, r.user_id, r.id, v_veh, CASE WHEN v_veh IS NULL THEN p_claim->>'subject_key' END, p_claim->>'claim_domain', p_claim->>'kind',
      (p_claim->>'occurred_from')::date, (p_claim->>'occurred_to')::date, (p_claim->>'amount_cents')::bigint,
      (p_claim->>'trade_in_cents')::bigint, (p_claim->>'related_vehicle_id')::uuid, (p_claim->>'survivor_vehicle_id')::uuid,
      p_claim->>'party_entity', p_claim->'asserted_value', p_claim->>'summary', (p_claim->>'confidence')::numeric, p_supersedes, r.producer);
  PERFORM public.evidence_insert_support(v_new, r.user_id, r.producer, p_support, v_scope);
  RETURN v_new;
END $$;

-- 2.3g Add support rows to a current claim, whether or not the owner has decided it (v3, exit-test v2: who_paid and
--   who_received could not close because support was written only when a claim was created, and a confirmed claim
--   cannot be superseded). Support never changes the claim or its decision; it is what the readers check.
CREATE OR REPLACE FUNCTION public.propose_claim_support(p_run_id uuid, p_claim_id uuid, p_support jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r evidence_runs%ROWTYPE; v_scope uuid[];
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT r FROM evidence_runs WHERE id = p_run_id AND status = 'running';
  IF NOT EXISTS (SELECT 1 FROM vehicle_change_claims WHERE id = p_claim_id AND user_id = r.user_id AND superseded_by IS NULL) THEN
    RAISE EXCEPTION 'claim % is not a current claim of this user', p_claim_id USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_support) <> 'array' OR jsonb_array_length(p_support) NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION '1..50 support rows per call'; END IF;
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(r.user_id));
  RETURN public.evidence_insert_support(p_claim_id, r.user_id, r.producer, p_support, v_scope);
END $$;

-- 2.3h Record the day's floor set. (v4, exit-test v3) A live vehicle outside his scope (a customer's truck on the
--   floor that day) is recorded too, as context, and listed under out_of_scope in the result; a vehicle that does not
--   exist or is deleted is returned as skipped.
--   (v5, rules-channels v4 #8) A row the owner decided is never superseded by a later run, as in the other propose_*
--   writers; it is returned as already_decided. ((v8) "decided" is his human decision; no agent rows exist.)
CREATE OR REPLACE FUNCTION public.record_day_context(p_run_id uuid, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r evidence_runs%ROWTYPE; x jsonb; v_prev uuid; v_new uuid; n int := 0; v_scope uuid[]; v_skipped jsonb := '[]'::jsonb;
        v_outside jsonb := '[]'::jsonb; v_ids uuid[] := '{}';
BEGIN
  PERFORM public.evidence_assert_job();
  SELECT * INTO STRICT r FROM evidence_runs WHERE id = p_run_id AND status = 'running';
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION '1..500 rows per call'; END IF;
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(r.user_id));
  FOR x IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    IF NOT ((x->>'vehicle_id')::uuid = ANY (v_scope)) THEN
      IF NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.id = (x->>'vehicle_id')::uuid AND v.deleted_at IS NULL) THEN
        v_skipped := v_skipped || jsonb_build_object('day', x->>'day', 'vehicle_id', x->>'vehicle_id', 'result', 'vehicle_not_found');
        CONTINUE;
      END IF;
      v_outside := v_outside || jsonb_build_object('day', x->>'day', 'vehicle_id', x->>'vehicle_id');
    END IF;
    SELECT id INTO v_prev FROM user_day_vehicle_context WHERE user_id = r.user_id AND day = (x->>'day')::date
       AND place_cluster = x->>'place_cluster' AND vehicle_id = (x->>'vehicle_id')::uuid AND superseded_by IS NULL;
    IF v_prev IS NOT NULL AND EXISTS (SELECT 1 FROM evidence_decisions d WHERE d.target_kind = 'day_context' AND d.target_id = v_prev
                                         AND d.decided_by LIKE 'human:%') THEN
      v_skipped := v_skipped || jsonb_build_object('day', x->>'day', 'vehicle_id', x->>'vehicle_id', 'result', 'already_decided', 'id', v_prev);
      CONTINUE;
    END IF;
    v_new := gen_random_uuid();
    IF v_prev IS NOT NULL THEN UPDATE user_day_vehicle_context SET superseded_by = v_new, superseded_at = now() WHERE id = v_prev; END IF;
    INSERT INTO user_day_vehicle_context(id, user_id, run_id, day, place_cluster, vehicle_id, confidence, basis, supersedes, created_by)
    VALUES (v_new, r.user_id, r.id, (x->>'day')::date, x->>'place_cluster', (x->>'vehicle_id')::uuid, (x->>'confidence')::numeric,
            ARRAY(SELECT jsonb_array_elements_text(x->'basis')), v_prev, r.producer);
    n := n + 1; v_ids := v_ids || v_new;
  END LOOP;
  RETURN jsonb_build_object('recorded', n, 'skipped', v_skipped, 'out_of_scope', v_outside, 'ids', to_jsonb(v_ids));
END $$;

-- (v6, AC13/AC15) Is row b the same question as row a (same table, same user): the same photo, truck and frame role;
-- the same instant and day; the same source, place, role, payment, amounts, parties and accounts; the same account and
-- owner; the same day, place and truck; the same claim kind, truck, window, amounts and parties. Confidence, evidence
-- and basis may differ: a pass re-scoring a row does not change what he was asked.
-- (v7, D1) Everything that says WHAT the row states must match too: a candidate's exact verdict and image class; a
-- link's kind, dates (occurred_on, transaction_on), cost category and source label (its anchor is in source_key); a
-- claim's domain, asserted value and summary. A successor that changes any of them is a new question.
-- (v8) Advisory, with evidence_successor_of: no agent decision is bound by it any more. It tells the app whether a row
-- he answered in chat was re-written since with the same meaning (evidence_answers_to_confirm), and it bounds his own
-- who-paid decision to the money the row asked about (decide_evidence). A re-written row whose meaning changed is a
-- new question: the app asks it again.
CREATE OR REPLACE FUNCTION public.evidence_same_question(p_kind text, p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_kind = 'image_candidate' THEN EXISTS (
      SELECT 1 FROM public.image_vehicle_candidates a, public.image_vehicle_candidates b
       WHERE a.id = p_a AND b.id = p_b AND a.user_id = b.user_id AND a.image_id = b.image_id AND a.frame_role = b.frame_role
         AND coalesce(public.evidence_resolve_vehicle(a.vehicle_id)::text, a.subject_key) IS NOT DISTINCT FROM
             coalesce(public.evidence_resolve_vehicle(b.vehicle_id)::text, b.subject_key)
         AND a.verdict = b.verdict AND a.image_class = b.image_class)
    WHEN p_kind = 'capture_time_claim' THEN EXISTS (
      SELECT 1 FROM public.image_capture_time_claims a, public.image_capture_time_claims b
       WHERE a.id = p_a AND b.id = p_b AND a.user_id = b.user_id AND a.image_id = b.image_id
         AND a.corrected_taken_at = b.corrected_taken_at AND a.captured_on = b.captured_on)
    WHEN p_kind IN ('evidence_link','album_map') THEN EXISTS (
      SELECT 1 FROM public.evidence_links a, public.evidence_links b
       WHERE a.id = p_a AND b.id = p_b AND a.user_id = b.user_id AND a.source_key = b.source_key
         AND coalesce(public.evidence_resolve_vehicle(a.vehicle_id)::text, a.subject_key) IS NOT DISTINCT FROM
             coalesce(public.evidence_resolve_vehicle(b.vehicle_id)::text, b.subject_key)
         AND a.role = b.role AND a.payment_key IS NOT DISTINCT FROM b.payment_key AND a.direction IS NOT DISTINCT FROM b.direction
         AND a.amount_cents IS NOT DISTINCT FROM b.amount_cents AND a.allocated_cents IS NOT DISTINCT FROM b.allocated_cents
         AND a.payer_entity IS NOT DISTINCT FROM b.payer_entity AND a.payee_entity IS NOT DISTINCT FROM b.payee_entity
         AND a.from_account_ref IS NOT DISTINCT FROM b.from_account_ref AND a.to_account_ref IS NOT DISTINCT FROM b.to_account_ref
         AND a.source_kind = b.source_kind AND a.anchor IS NOT DISTINCT FROM b.anchor
         AND a.occurred_on IS NOT DISTINCT FROM b.occurred_on AND a.transaction_on IS NOT DISTINCT FROM b.transaction_on
         AND a.cost_category IS NOT DISTINCT FROM b.cost_category AND a.source_label IS NOT DISTINCT FROM b.source_label)
    WHEN p_kind = 'account_entity' THEN EXISTS (
      SELECT 1 FROM public.evidence_account_entities a, public.evidence_account_entities b
       WHERE a.id = p_a AND b.id = p_b AND a.user_id = b.user_id AND a.account_ref = b.account_ref AND a.entity_key = b.entity_key)
    WHEN p_kind = 'day_context' THEN EXISTS (
      SELECT 1 FROM public.user_day_vehicle_context a, public.user_day_vehicle_context b
       WHERE a.id = p_a AND b.id = p_b AND a.user_id = b.user_id AND a.day = b.day AND a.place_cluster = b.place_cluster
         AND a.vehicle_id = b.vehicle_id)
    WHEN p_kind = 'change_claim' THEN EXISTS (
      SELECT 1 FROM public.vehicle_change_claims a, public.vehicle_change_claims b
       WHERE a.id = p_a AND b.id = p_b AND a.user_id = b.user_id AND a.kind = b.kind
         AND a.vehicle_id IS NOT DISTINCT FROM b.vehicle_id AND a.subject_key IS NOT DISTINCT FROM b.subject_key
         AND a.occurred_from IS NOT DISTINCT FROM b.occurred_from AND a.occurred_to IS NOT DISTINCT FROM b.occurred_to
         AND a.amount_cents IS NOT DISTINCT FROM b.amount_cents AND a.trade_in_cents IS NOT DISTINCT FROM b.trade_in_cents
         AND a.related_vehicle_id IS NOT DISTINCT FROM b.related_vehicle_id AND a.survivor_vehicle_id IS NOT DISTINCT FROM b.survivor_vehicle_id
         AND a.party_entity IS NOT DISTINCT FROM b.party_entity
         AND a.claim_domain = b.claim_domain AND a.asserted_value IS NOT DISTINCT FROM b.asserted_value AND a.summary = b.summary)
    ELSE false END
$$;

-- (v6, AC13/AC15) Is p_to the current successor of the sheet's row p_from (reached through the supersedes chain, at
-- most 50 hops) and still the same question? (v8) Advisory, as evidence_same_question.
CREATE OR REPLACE FUNCTION public.evidence_successor_of(p_kind text, p_from uuid, p_to uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v uuid := p_to; i int;
BEGIN
  IF p_from = p_to THEN RETURN true; END IF;
  FOR i IN 1..50 LOOP
    v := CASE
      WHEN p_kind = 'image_candidate' THEN (SELECT supersedes FROM image_vehicle_candidates WHERE id = v)
      WHEN p_kind = 'capture_time_claim' THEN (SELECT supersedes FROM image_capture_time_claims WHERE id = v)
      WHEN p_kind IN ('evidence_link','album_map') THEN (SELECT supersedes FROM evidence_links WHERE id = v)
      WHEN p_kind = 'account_entity' THEN (SELECT supersedes FROM evidence_account_entities WHERE id = v)
      WHEN p_kind = 'day_context' THEN (SELECT supersedes FROM user_day_vehicle_context WHERE id = v)
      WHEN p_kind = 'change_claim' THEN (SELECT supersedes FROM vehicle_change_claims WHERE id = v) END;
    EXIT WHEN v IS NULL;
    IF v = p_from THEN RETURN public.evidence_same_question(p_kind, p_from, p_to); END IF;
  END LOOP;
  RETURN false;
END $$;

-- (v8) The row a target has become: follow superseded_by forward (at most 50 hops) to the row nothing newer replaces;
-- the target itself when it is current; NULL when the id names no row of that kind (or the chain is longer than 50). A
-- publication's target is the image itself. Read by evidence_answers_to_confirm (advisory, for the app).
CREATE OR REPLACE FUNCTION public.evidence_current_of(p_kind text, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v uuid := p_id; nx uuid; i int;
BEGIN
  IF p_kind = 'image_publication' THEN RETURN p_id; END IF;
  FOR i IN 1..50 LOOP
    IF p_kind = 'image_candidate' THEN SELECT superseded_by INTO nx FROM image_vehicle_candidates WHERE id = v;
    ELSIF p_kind = 'capture_time_claim' THEN SELECT superseded_by INTO nx FROM image_capture_time_claims WHERE id = v;
    ELSIF p_kind IN ('evidence_link','album_map') THEN SELECT superseded_by INTO nx FROM evidence_links WHERE id = v;
    ELSIF p_kind = 'account_entity' THEN SELECT superseded_by INTO nx FROM evidence_account_entities WHERE id = v;
    ELSIF p_kind = 'day_context' THEN SELECT superseded_by INTO nx FROM user_day_vehicle_context WHERE id = v;
    ELSIF p_kind = 'change_claim' THEN SELECT superseded_by INTO nx FROM vehicle_change_claims WHERE id = v;
    ELSE RETURN NULL; END IF;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF nx IS NULL THEN RETURN v; END IF;
    v := nx;
  END LOOP;
  RETURN NULL;
END $$;

-- (v8) Which of a sheet row's own targets was the row p_id re-written from (followed back through supersedes, at most
-- 50 hops)? NULL when p_id is one of them, or descends from none of them. With evidence_same_question it lets
-- decide_evidence refuse a decision that cites his stored answer but would land on a row whose meaning changed since he
-- answered (the D1 hazard, now on his own one-tap confirmation: 'row_changed_since_answer').
CREATE OR REPLACE FUNCTION public.evidence_rewritten_from(p_kind text, p_row jsonb, p_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v uuid := p_id; i int; v_ids uuid[];
BEGIN
  v_ids := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(coalesce(p_row->'targets', '[]'::jsonb)) e
                  WHERE e->>'kind' = p_kind AND e->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  IF cardinality(v_ids) = 0 OR p_id = ANY (v_ids) THEN RETURN NULL; END IF;
  FOR i IN 1..50 LOOP
    v := CASE
      WHEN p_kind = 'image_candidate' THEN (SELECT supersedes FROM image_vehicle_candidates WHERE id = v)
      WHEN p_kind = 'capture_time_claim' THEN (SELECT supersedes FROM image_capture_time_claims WHERE id = v)
      WHEN p_kind IN ('evidence_link','album_map') THEN (SELECT supersedes FROM evidence_links WHERE id = v)
      WHEN p_kind = 'account_entity' THEN (SELECT supersedes FROM evidence_account_entities WHERE id = v)
      WHEN p_kind = 'day_context' THEN (SELECT supersedes FROM user_day_vehicle_context WHERE id = v)
      WHEN p_kind = 'change_claim' THEN (SELECT supersedes FROM vehicle_change_claims WHERE id = v) END;
    EXIT WHEN v IS NULL;
    IF v = ANY (v_ids) THEN RETURN v; END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- (v9, W2) Does a decision that cites his stored answer land on what that answer was about? The answer was stored
-- against one sheet row, frozen when the sheet was made (or copied from the row a re-ask names), and he gave it after
-- that sheet was sent (p_sent_at, the sheet's finished_at). The row must ask about the decided kind, and the target must
-- be:
--   one of the row's own targets, or a successor of one that still asks the same question ('fits');
--   on a row that names no row of that kind but a slot (an image, a payment or source key, an account): a row of his in
--     that slot (a candidate in the frame role the row asks about) that was there when the sheet was sent, or a
--     successor of that row that still asks the same question ('fits');
--   a successor of a row target, or of a slot row, whose meaning changed since:
--     {"result": "row_changed_since_answer", "asked_target": <the row he was asked about>};
--   anything else (another row, another question, another user's row, a row the passes added to the slot after the
--   sheet was sent): 'not_on_answered_row'.
-- (v10, A2) On a slot row the stored reading is the only record of which row he picked: a confirm citing a reading
--   that says yes and names a place ("thats the A truck", an account's owner, a day) lands only on a row at that place
--   (the truck as evidence_truck_key keys it, 'entity:<key>', 'day:<date>'); another row of the slot is
--   {"result": "not_on_answered_row", "answered_place": <the place he named>} (v9 confirmed the other truck's row and
--   implied-rejected the truck he named). A bare or unread reading keeps the rule above. And a money slot row asks
--   where the payment goes ('placement'): a row of the slot in another class (a contradiction, a share) is another
--   question (v9 confirmed a contradiction of the truck he named on his "yes, that truck", which rejects that payment
--   there).
-- v8 refused only a changed successor of a listed id, so an answer stored on a sheet copied after the passes re-wrote a
-- row (or a row a pass re-wrote in a slot) could be confirmed on what he never saw; v9 also stores answers only on the
-- sheet they answer (evidence_record_answers).
CREATE OR REPLACE FUNCTION public.evidence_answer_fits(p_row jsonb, p_kind text, p_id uuid, p_user_id uuid, p_sent_at timestamptz,
                                                       p_reading jsonb, p_decision text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_ids uuid[]; v_was uuid; v_slot boolean := false; v uuid; v_at timestamptz; i int; v_named text; v_here text;
BEGIN
  IF p_row IS NULL OR p_row->>'question' IS DISTINCT FROM p_kind THEN
    RETURN jsonb_build_object('result', 'not_on_answered_row');
  END IF;
  v_ids := ARRAY(SELECT (e->>'id')::uuid FROM jsonb_array_elements(coalesce(p_row->'targets', '[]'::jsonb)) e
                  WHERE e->>'kind' = p_kind AND e->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
  IF p_id = ANY (v_ids) THEN RETURN jsonb_build_object('result', 'fits'); END IF;
  v_was := public.evidence_rewritten_from(p_kind, p_row, p_id);
  IF v_was IS NOT NULL THEN
    IF public.evidence_same_question(p_kind, v_was, p_id) THEN RETURN jsonb_build_object('result', 'fits'); END IF;
    RETURN jsonb_build_object('result', 'row_changed_since_answer', 'asked_target', v_was);
  END IF;
  IF cardinality(v_ids) > 0 THEN RETURN jsonb_build_object('result', 'not_on_answered_row'); END IF;
  -- a slot row: in the slot the row names
  v_slot := CASE p_kind
    WHEN 'image_candidate' THEN EXISTS (
      SELECT 1 FROM image_vehicle_candidates c WHERE c.id = p_id AND c.user_id = p_user_id
         AND coalesce(p_row->'images', '[]'::jsonb) @> to_jsonb(c.image_id::text) AND c.frame_role = coalesce(p_row->>'frame', 'subject'))
    WHEN 'capture_time_claim' THEN EXISTS (
      SELECT 1 FROM image_capture_time_claims t WHERE t.id = p_id AND t.user_id = p_user_id
         AND coalesce(p_row->'images', '[]'::jsonb) @> to_jsonb(t.image_id::text))
    WHEN 'image_publication' THEN coalesce(p_row->'images', '[]'::jsonb) @> to_jsonb(p_id::text)
    WHEN 'evidence_link' THEN EXISTS (
      SELECT 1 FROM evidence_links l WHERE l.id = p_id AND l.user_id = p_user_id AND l.source_kind <> 'photos_album'
         AND ((l.payment_key IS NOT NULL AND coalesce(p_row->'payment_keys', '[]'::jsonb) @> to_jsonb(l.payment_key))
              OR coalesce(p_row->'source_keys', '[]'::jsonb) @> to_jsonb(l.source_key))
         AND public.evidence_link_class(l.role, l.allocated_cents, l.source_kind) = coalesce(p_row->>'link_class', 'placement'))
    WHEN 'album_map' THEN EXISTS (
      SELECT 1 FROM evidence_links l WHERE l.id = p_id AND l.user_id = p_user_id AND l.source_kind = 'photos_album'
         AND coalesce(p_row->'source_keys', '[]'::jsonb) @> to_jsonb(l.source_key))
    WHEN 'account_entity' THEN EXISTS (
      SELECT 1 FROM evidence_account_entities a WHERE a.id = p_id AND a.user_id = p_user_id
         AND coalesce(p_row->'accounts', '[]'::jsonb) @> to_jsonb(a.account_ref))
    ELSE false END;
  IF NOT v_slot THEN RETURN jsonb_build_object('result', 'not_on_answered_row'); END IF;
  IF p_kind = 'image_publication' THEN RETURN jsonb_build_object('result', 'fits'); END IF;
  -- and there when the sheet was sent, or re-written since from the row that was (followed back, at most 50 hops)
  IF p_sent_at IS NOT NULL THEN
    v := p_id; v_was := NULL;
    FOR i IN 0..50 LOOP
      EXIT WHEN v IS NULL;
      v_at := CASE p_kind
        WHEN 'image_candidate' THEN (SELECT created_at FROM image_vehicle_candidates WHERE id = v)
        WHEN 'capture_time_claim' THEN (SELECT created_at FROM image_capture_time_claims WHERE id = v)
        WHEN 'account_entity' THEN (SELECT created_at FROM evidence_account_entities WHERE id = v)
        ELSE (SELECT created_at FROM evidence_links WHERE id = v) END;
      IF v_at <= p_sent_at THEN v_was := v; EXIT; END IF;
      v := CASE p_kind
        WHEN 'image_candidate' THEN (SELECT supersedes FROM image_vehicle_candidates WHERE id = v)
        WHEN 'capture_time_claim' THEN (SELECT supersedes FROM image_capture_time_claims WHERE id = v)
        WHEN 'account_entity' THEN (SELECT supersedes FROM evidence_account_entities WHERE id = v)
        ELSE (SELECT supersedes FROM evidence_links WHERE id = v) END;
    END LOOP;
    IF v_was IS NULL THEN RETURN jsonb_build_object('result', 'not_on_answered_row'); END IF;
    IF v_was <> p_id AND NOT public.evidence_same_question(p_kind, v_was, p_id) THEN
      RETURN jsonb_build_object('result', 'row_changed_since_answer', 'asked_target', v_was);
    END IF;
  END IF;
  -- (v10, A2) a "yes, it is <place>" reading: the row he confirms is at that place
  IF p_decision = 'confirmed' AND p_reading->>'decision' = 'confirmed' AND public.evidence_answer_place(p_reading) IS NOT NULL THEN
    v_named := CASE WHEN p_reading ? 'vehicle_id' THEN public.evidence_truck_key((p_reading->>'vehicle_id')::uuid, NULL, p_user_id)
                    ELSE public.evidence_answer_place(p_reading) END;
    v_here := CASE p_kind
      WHEN 'image_candidate' THEN (SELECT public.evidence_truck_key(c.vehicle_id, c.subject_key, p_user_id) FROM image_vehicle_candidates c WHERE c.id = p_id)
      WHEN 'capture_time_claim' THEN (SELECT 'day:' || t.captured_on::text FROM image_capture_time_claims t WHERE t.id = p_id)
      WHEN 'account_entity' THEN (SELECT 'entity:' || a.entity_key FROM evidence_account_entities a WHERE a.id = p_id)
      ELSE (SELECT public.evidence_truck_key(l.vehicle_id, l.subject_key, p_user_id) FROM evidence_links l WHERE l.id = p_id) END;
    IF v_named IS DISTINCT FROM v_here THEN
      RETURN jsonb_build_object('result', 'not_on_answered_row', 'answered_place', public.evidence_answer_place(p_reading));
    END IF;
  END IF;
  RETURN jsonb_build_object('result', 'fits');
END $$;

-- (v8) Removed with the agent channel (they bound an agent decision to his stored answer and never ran for his own
-- decisions): evidence_first_asked (v7, D3: "newer" measured from the first sheet that asked), evidence_row_covers
-- (v4/v6: the row covers the target), evidence_answer_allows (v5/v6: the answer supports the decision),
-- evidence_human_decided_since (v5/v6: human_decision_newer); and, in 2.3b, evidence_owner_time_cited and
-- evidence_time_word_at (v6/v7: an owner capture time from his cited answer).

-- (v7, D5) Are two places known to be different trucks? The same place is not; two vehicle rows are (merge lineage
-- is already resolved); two no-row keys of the same kind with different values are (two VINs, two albums, two
-- labels); a no-truck verdict ('none' or NULL) and a truck are. A row and a vin: key are the same truck when the row's
-- own VIN is that VIN. A vin: key and a label:/album: key, or a label: and an album: key, may be ONE truck seen two
-- ways (the plate read and the album of the blue truck with no row yet): not known to differ. Nothing is rejected
-- across places that are not known to differ.
-- (v8) Read by his own subject confirms (the implied rejections in decide_evidence); the agent's placed rejects are gone.
-- (v9, R-T1) Also read by propose_image_candidates (a row at another place than the subject he confirmed) and by the
-- day reader, on truck keys (evidence_truck_key).
-- (v10, trucks F3) No API grant again: called only inside definer functions (decide_evidence, propose_image_candidates,
-- evidence_answered_elsewhere), so the VIN it compares is read the same way in every session (v9 read it under the
-- caller's RLS, and the job and his app disagreed about a row naming another user's private truck), and no caller can
-- ask it about a vehicle of his choosing (no VIN oracle).
CREATE OR REPLACE FUNCTION public.evidence_places_distinct(p_a text, p_b text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH k AS (
    SELECT coalesce(p_a, 'none') AS a, coalesce(p_b, 'none') AS b,
           CASE WHEN p_a ~ '^[0-9a-f]{8}-[0-9a-f]{4}-' THEN 'row' WHEN coalesce(p_a, 'none') = 'none' THEN 'none' ELSE split_part(p_a, ':', 1) END AS ka,
           CASE WHEN p_b ~ '^[0-9a-f]{8}-[0-9a-f]{4}-' THEN 'row' WHEN coalesce(p_b, 'none') = 'none' THEN 'none' ELSE split_part(p_b, ':', 1) END AS kb)
  SELECT CASE
    WHEN a = b THEN false
    WHEN ka = kb OR ka = 'none' OR kb = 'none' THEN true
    -- (v10, trucks note) a row and a VIN differ only when the row HAS a VIN on record and it is another (a row with no VIN
    -- is not known to be another truck)
    WHEN ka = 'row' AND kb = 'vin' THEN EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = a::uuid AND nullif(btrim(v.vin), '') IS NOT NULL
                                                  AND upper(v.vin) <> upper(substr(b, 5)))
    WHEN kb = 'row' AND ka = 'vin' THEN EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = b::uuid AND nullif(btrim(v.vin), '') IS NOT NULL
                                                  AND upper(v.vin) <> upper(substr(a, 5)))
    WHEN ka = 'row' OR kb = 'row' THEN true
    ELSE false END
  FROM k
$$;

-- (v6, AC-aal) The owner channel's step-up, read from the auth server's own records (not only from the token):
--   * the token's session is an auth.sessions row of this user at aal2 with the factor it was stepped up with;
--   * that factor is his, verified, of a second-factor type (totp, webauthn, phone), and was enrolled at least 7 days
--     ago (a factor minted today, for instance by a key holder through an admin-made session, does not count yet; PLAN
--     M10b reads the auth audit log for factor and link events on his account);
--   * the session passed that second factor within the last 15 minutes (auth.mfa_amr_claims.updated_at, which the auth
--     server refreshes on each verification): an act, not a session that once passed it.
--   Returns what is stamped into the decision ('step_up': session, factor, factor type and age, the verification time
--   and the token's amr with timestamps).
CREATE OR REPLACE FUNCTION public.evidence_step_up(p_uid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_jwt jsonb := (SELECT auth.jwt()); v_sid uuid; v_aal text; v_factor uuid; v_ftype text; v_fstatus text;
        v_fcreated timestamptz; v_at timestamptz;
BEGIN
  IF coalesce(v_jwt->>'session_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'an owner decision needs a signed-in session id' USING ERRCODE = '42501';
  END IF;
  v_sid := (v_jwt->>'session_id')::uuid;
  SELECT s.aal::text, s.factor_id INTO v_aal, v_factor FROM auth.sessions s WHERE s.id = v_sid AND s.user_id = p_uid;
  IF NOT FOUND OR v_aal IS DISTINCT FROM 'aal2' OR v_factor IS NULL THEN
    RAISE EXCEPTION 'the auth server has no step-up (aal2) record for this session' USING ERRCODE = '42501';
  END IF;
  SELECT f.factor_type::text, f.status::text, f.created_at INTO v_ftype, v_fstatus, v_fcreated
    FROM auth.mfa_factors f WHERE f.id = v_factor AND f.user_id = p_uid;
  IF NOT FOUND OR v_fstatus IS DISTINCT FROM 'verified' OR v_ftype NOT IN ('totp','webauthn','phone') THEN
    RAISE EXCEPTION 'the session was not stepped up with a verified second factor of yours' USING ERRCODE = '42501';
  END IF;
  IF v_fcreated > now() - interval '7 days' THEN
    RAISE EXCEPTION 'your second factor was enrolled less than 7 days ago; owner decisions open on %', (v_fcreated + interval '7 days')::date
      USING ERRCODE = '42501';
  END IF;
  SELECT max(c.updated_at) INTO v_at FROM auth.mfa_amr_claims c
   WHERE c.session_id = v_sid AND c.authentication_method IN ('totp','mfa/totp','mfa/phone','mfa/webauthn','phone','webauthn');
  IF v_at IS NULL OR v_at < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'verify your second factor again: this session last passed it more than 15 minutes ago' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('session_id', v_sid, 'factor_id', v_factor, 'factor_type', v_ftype, 'factor_created_at', v_fcreated,
                            'verified_at', v_at, 'amr', coalesce(v_jwt->'amr', '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------------------------------
-- 2.4 Owner decisions (no testimony writes here)
--   (v8, lead directive) ONE CHANNEL: the owner's own JWT through the API -> 'human:<uid>'. Decisions are his hand
--   only. service_role has no EXECUTE on this function, and the body refuses any caller that is not his own step-up
--   session ('agent_channel_disabled', 42501), so no 'agent:' row is ever written (M1a's guard admits an 'agent:' row
--   only from decide_evidence under service_role). His chat answers are stored by evidence_record_answers and decide
--   nothing until he confirms them here. p_agent_session is kept in the signature only so that a caller still on the
--   v7 contract is told 'agent_channel_disabled'; any value is refused.
--   (v5, rules-channels v4 #3) The channel needs a step-up session (JWT aal = 'aal2'); M1a's guard stamps the assurance
--   level, auth methods and session id. (v6, AC-aal) It also needs the auth server's records to show that step-up with
--   an established factor within 15 minutes (evidence_step_up), stamped as detail.step_up. Both channels need
--   session_user = 'authenticator' (PostgREST); q.sh is refused whatever claims it SETs.
--   (v8) p_answer_ref (optional): the stored chat answer he is confirming in the app, 'answers:<answers run>#<row>', his
--   answers to the sheet row p_review_ref names ('review:<sheet run>#<same row>'). Its sha256 and the transcriber's
--   reading are copied into the decision (detail.answer_ref, answer_sha256, stored_reading) so M4a can measure how often
--   the stored reading matched what he decided. It never changes what he decides, with one guard: a decision citing
--   his answer is not written on a row the passes re-wrote with another meaning since that answer (evidence_rewritten_from
--   + evidence_same_question: 'row_changed_since_answer', reported per target, nothing written).
--   (v8) p_answer (optional): what he says in the app beyond yes or no, one key:
--     {"entity_key": <who paid or received>} with 'confirmed' on a who-paid row (asks 'party'): his owner statement
--       (below); the row's own target is not decided by it;
--     {"captured_on": <day>} with 'rejected' on one capture-time claim ("no, it was <day>"): the claim is rejected, an
--       owner claim for that day is written in its place and confirmed by this same decision.
--   Image candidates need p_expected {candidate_id: vehicle_id the owner saw, or null}.
--   A confirm of a 'subject' candidate implied-rejects every other current subject candidate of that image that names
--   a different vehicle, (v5, readers v4 #5) or a different no-row subject_key, or a different verdict; (v7, D5) only
--   places known to differ (evidence_places_distinct). An 'also_in_frame' confirm implies nothing. (v8, lead (c))
--   Implied rejections come only from his own confirms (they are the only confirms of a candidate there are).
--   "No, it is Y" (rejected + p_reassign_vehicle_id): confirms, through this same function and its checks, Y's row in
--   the same slot: (v6, AC5) a candidate of the same frame role, (AC7) a link of the same payment or source in the same
--   role, unallocated (never a contradiction); his owner_review row first, else the strongest current row, else a new
--   owner_review row; returns the id it confirmed. (v8) The v6 restriction to "a row the sheet could have shown"
--   bound the agent's reading of an old answer; he decides what he sees now, so it is gone.
--   (v7, F3) A publication is decided only by the photo's own user (evidence_image_user).
--   (v7, D7) A confirm, and the reassign, need the vehicle in his scope through CONFIRMED relations.
--   (v5) Every decision id written (implied rejections, the reassign's confirm, the statement and the owner time
--   included) is returned, for M10b's match against the API request log.
-- Who paid (v8, lead (b)): his statement exists only on his own decision. With p_answer {"entity_key": E}, p_review_ref
--   'review:<sheet>#<row>' naming a who-paid row of his about this kind of target, p_answer_ref his stored answer to
--   that row (M1a's el_owner_word_cited makes a statement cite a stored answer), and one target (the row's target, or
--   its current successor asking the same question, evidence_successor_of): the statement is built from that target
--   (evidence_statement_for), checked to be the money the row asked about (evidence_statement_problem), written as an
--   owner_review link of source_kind 'owner_statement' (on the answers run), supported on the acquisition/sale claim it
--   answers (about 'party'), and confirmed by this decision. An earlier statement answering the same target is
--   superseded, with its support row (his newer word). A row with no stored answer cannot carry a statement until M1a2
--   (PLAN) lets a statement cite his decision instead ('statement_needs_stored_answer').
-- (v9) What changed:
--   * W2: a decision citing his stored answer cites his LATEST answer to that sheet row (a later message answering the
--     same row replaces the earlier one: raised, naming the later answer) and lands per target only where the answer
--     was about (evidence_answer_fits: 'not_on_answered_row', 'row_changed_since_answer'). "No, it is Y" confirms Y's
--     row through this function without the citation (the answer named Y; Y's row is not a target of the row);
--   * W3: no statement on a payment source line, keyed or not;
--   * W4: his newer statement supersedes every current statement answering this target, the row target, or any row
--     either was re-written from (the supersedes chains), with its support row;
--   * R-T1/R-T2: places are compared as trucks (evidence_truck_key: merge lineage and his confirmed same_vehicle_as
--     pairs): a confirm implies "not that truck" only for a truck known to differ, and a reject implies it for every
--     current subject row of the same truck under any of its ids.
-- ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_evidence(
  p_target_kind text, p_target_ids uuid[], p_decision text, p_reason text,
  p_review_ref text, p_review_method text,
  p_actor_user_id uuid DEFAULT NULL, p_expected jsonb DEFAULT NULL, p_reassign_vehicle_id uuid DEFAULT NULL,
  p_agent_session text DEFAULT NULL, p_answer_ref text DEFAULT NULL, p_answer jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
SET lock_timeout = '2s' AS $$
DECLARE
  v_owner uuid; v_by text; v_id uuid; v_user uuid; v_vehicle uuid; v_image uuid; v_cur uuid; v_dec uuid;
  v_new uuid; v_scope uuid[]; v_verdict text; v_frame text; v_subject text; v_stamp jsonb;
  c image_vehicle_candidates%ROWTYPE; l evidence_links%ROWTYPE; t image_capture_time_claims%ROWTYPE;
  v_out jsonb := '[]'::jsonb; v_sub jsonb; v_api_role text := coalesce(current_setting('role', true), '');
  v_rowcfg jsonb; v_asha text; v_reading jsonb; v_party text; v_day date; v_rt uuid; x jsonb; v_bad text;
  v_link uuid; v_sup uuid; v_superseded uuid[]; v_oc uuid; v_ocdec uuid; v_fit jsonb;
  v_implied uuid[]; v_redec uuid; v_note text; v_yveh uuid; v_old uuid;
  v_aid uuid; v_amsg timestamptz; v_astart timestamptz; v_later uuid; v_chain uuid[]; v_w uuid; v_start uuid; i int; v_truck text;
  v_sent timestamptz; v_root text; v_later_row text;
BEGIN
  IF p_decision NOT IN ('confirmed','rejected') THEN RAISE EXCEPTION 'decision must be confirmed or rejected'; END IF;
  IF nullif(btrim(p_reason),'') IS NULL OR nullif(btrim(p_review_ref),'') IS NULL OR p_review_method IS NULL THEN
    RAISE EXCEPTION 'reason, review_ref and review_method are required' USING ERRCODE = '22023';
  END IF;
  IF cardinality(p_target_ids) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION '1..200 targets per call'; END IF;
  IF session_user::text IS DISTINCT FROM 'authenticator' THEN
    RAISE EXCEPTION 'decisions come only through the API (session %)', session_user USING ERRCODE = '42501';
  END IF;

  -- (v8, lead directive) the agent channel is disabled: a job never decides, whatever it cites
  IF coalesce(auth.role(),'') = 'service_role' OR v_api_role = 'service_role' OR p_agent_session IS NOT NULL THEN
    RAISE EXCEPTION 'agent_channel_disabled: decisions are recorded only from the owner''s own step-up session; store his chat answers with evidence_record_answers and let him confirm them in the app'
      USING ERRCODE = '42501';
  END IF;
  -- (v4, rules-violation v3) the channel is keyed on the PostgREST role setting as well as the JWT claim: a SECURITY
  -- DEFINER function can rewrite the claims but not the role setting, and M1a's guard refuses a decision whose
  -- outermost caller is not decide_evidence itself.
  IF NOT (coalesce(auth.role(),'') = 'authenticated' AND v_api_role = 'authenticated') THEN
    RAISE EXCEPTION 'decisions come only from the owner''s own signed-in step-up session' USING ERRCODE = '42501';
  END IF;
  v_owner := auth.uid();
  IF v_owner IS NULL OR (p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_owner) THEN
    RAISE EXCEPTION 'sign in required' USING ERRCODE = '42501';
  END IF;
  IF p_review_method NOT IN ('owner_page','owner_app','owner_physical_check') THEN
    RAISE EXCEPTION 'an owner JWT decides through owner_page, owner_app or owner_physical_check' USING ERRCODE = '22023';
  END IF;
  -- (v5, rules-channels v4 #3) a step-up session: his second factor, not only a signed-in session
  IF coalesce((SELECT auth.jwt())->>'aal', '') <> 'aal2' THEN
    RAISE EXCEPTION 'an owner decision needs a step-up (aal2) session: verify your second factor first' USING ERRCODE = '42501';
  END IF;
  v_by := 'human:' || v_owner::text;
  -- (v6, AC-aal) and the auth server's records show a recent step-up with an established factor
  v_stamp := jsonb_build_object('writer', 'decide_evidence', 'step_up', public.evidence_step_up(v_owner));

  -- (v8) the stored chat answer he is confirming, when the app shows one: his answers to the row review_ref names
  IF p_answer_ref IS NOT NULL THEN
    IF p_answer_ref !~ '^answers:[0-9a-f-]{36}#[0-9]+$' OR p_review_ref !~ '^review:[0-9a-f-]{36}#[0-9]+$'
       OR substring(p_answer_ref from '#([0-9]+)$') IS DISTINCT FROM substring(p_review_ref from '#([0-9]+)$') THEN
      RAISE EXCEPTION 'answer_ref answers:<answers run>#<row> cites your answer to the row review_ref names (review:<sheet run>#<same row>)'
        USING ERRCODE = '22023';
    END IF;
    SELECT a.config->'rows'->(substring(p_answer_ref from '#([0-9]+)$'))->>'sha256',
           a.config->'rows'->(substring(p_answer_ref from '#([0-9]+)$'))->'answer',
           a.id, coalesce((a.config->>'message_at')::timestamptz, a.started_at), a.started_at
      INTO v_asha, v_reading, v_aid, v_amsg, v_astart FROM evidence_runs a
     WHERE a.id = substring(p_answer_ref from '^answers:([0-9a-f-]{36})#')::uuid AND a.user_id = v_owner
       AND a.run_kind = 'review_answers' AND a.status = 'done'
       AND a.config->>'sheet_run' = substring(p_review_ref from '^review:([0-9a-f-]{36})#');
    IF v_asha IS NULL THEN
      RAISE EXCEPTION 'answer_ref is not your stored answer to that sheet row' USING ERRCODE = '22023';
    END IF;
    -- (v10, A1) the question the cited row asks: its first asking (every re-ask of it shares that key), else the row
    SELECT coalesce(sh.config->'rows'->(substring(p_review_ref from '#([0-9]+)$'))->>'asked_first', p_review_ref) INTO v_root
      FROM evidence_runs sh WHERE sh.id = substring(p_review_ref from '^review:([0-9a-f-]{36})#')::uuid AND sh.user_id = v_owner;
    -- (v9, W2; v10, A1) his latest answer to that question, on whichever sheet asked it: a later message of his that
    -- answers the same question (the same row, the row it re-asks, or another re-ask of it) replaces this one
    SELECT a2.id, k2.key INTO v_later, v_later_row FROM evidence_runs a2
      JOIN evidence_runs s2 ON s2.id = (a2.config->>'sheet_run')::uuid AND s2.user_id = v_owner
                           AND s2.run_kind = 'review' AND s2.pass = 'review_sheet'
     CROSS JOIN LATERAL jsonb_object_keys(a2.config->'rows') k2(key)
     WHERE a2.user_id = v_owner AND a2.run_kind = 'review_answers' AND a2.status = 'done' AND a2.id <> v_aid
       AND coalesce(s2.config->'rows'->k2.key->>'asked_first', 'review:' || s2.id::text || '#' || k2.key) = v_root
       AND (coalesce((a2.config->>'message_at')::timestamptz, a2.started_at), a2.started_at, a2.id::text) > (v_amsg, v_astart, v_aid::text)
     ORDER BY coalesce((a2.config->>'message_at')::timestamptz, a2.started_at) DESC, a2.started_at DESC, a2.id::text DESC LIMIT 1;
    IF v_later IS NOT NULL THEN
      RAISE EXCEPTION 'a later message of yours answers that row: answers:%#% replaces this answer', v_later, v_later_row
        USING ERRCODE = '22023';
    END IF;
    v_stamp := v_stamp || jsonb_build_object('answer_ref', p_answer_ref, 'answer_sha256', v_asha, 'stored_reading', v_reading);
  END IF;

  -- (v8) what he says beyond yes or no
  IF p_answer IS NOT NULL THEN
    IF jsonb_typeof(p_answer) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_answer)) <> 1
       OR NOT (p_answer ? 'entity_key' OR p_answer ? 'captured_on') THEN
      RAISE EXCEPTION 'p_answer is {"entity_key": <who paid or received>} on a who-paid row, or {"captured_on": <day>} with a capture-time "no"'
        USING ERRCODE = '22023';
    END IF;
    IF p_answer ? 'entity_key' THEN
      v_party := p_answer->>'entity_key';
      IF v_party IS NULL OR v_party = 'unknown' OR NOT public.evidence_entity_key_ok(v_party) OR p_decision <> 'confirmed'
         OR p_target_kind NOT IN ('evidence_link','change_claim') OR cardinality(p_target_ids) <> 1 OR p_reassign_vehicle_id IS NOT NULL THEN
        RAISE EXCEPTION 'who paid: one target, decision confirmed, entity_key owner, owner_business:<x> or third_party:<x>'
          USING ERRCODE = '22023';
      END IF;
    ELSE
      BEGIN
        v_day := (p_answer->>'captured_on')::date;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'captured_on is a date' USING ERRCODE = '22023';
      END;
      IF v_day IS NULL OR p_target_kind <> 'capture_time_claim' OR p_decision <> 'rejected' OR cardinality(p_target_ids) <> 1 THEN
        RAISE EXCEPTION '"no, it was <day>": one capture-time claim, decision rejected, captured_on the day you name' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('evidence.writer', 'on', true);
  v_scope := ARRAY(SELECT public.evidence_scope_vehicle_ids(v_owner, true));   -- (v7, D7) confirmed relations only
  -- (v8) the sheet row review_ref names, when it is one of his
  IF p_review_ref ~ '^review:[0-9a-f-]{36}#[0-9]+$' THEN
    SELECT config->'rows'->(substring(p_review_ref from '#([0-9]+)$')), finished_at INTO v_rowcfg, v_sent FROM evidence_runs
     WHERE id = substring(p_review_ref from '^review:([0-9a-f-]{36})#')::uuid AND user_id = v_owner
       AND run_kind = 'review' AND pass = 'review_sheet';
  END IF;

  -- (v8, lead (b)) Who paid: his statement, written and confirmed here, and nowhere else
  IF v_party IS NOT NULL THEN
    IF v_rowcfg IS NULL OR coalesce(v_rowcfg->>'asks', 'place') <> 'party' OR v_rowcfg->>'question' IS DISTINCT FROM p_target_kind THEN
      RAISE EXCEPTION 'who paid is answered on a who-paid row of yours about this %: review_ref review:<sheet run>#<row>', p_target_kind
        USING ERRCODE = '22023';
    END IF;
    IF p_answer_ref IS NULL THEN
      RAISE EXCEPTION 'statement_needs_stored_answer: an owner statement cites your stored chat answer to that row (p_answer_ref)'
        USING ERRCODE = '22023';
    END IF;
    v_id := p_target_ids[1];
    -- (v11 patch, reviewer) whose row it is before anything about it is compared, as for every other decision
    IF EXISTS (SELECT 1 FROM evidence_links WHERE p_target_kind = 'evidence_link' AND id = v_id AND superseded_by IS NULL
                                              AND user_id IS DISTINCT FROM v_owner
               UNION ALL
               SELECT 1 FROM vehicle_change_claims WHERE p_target_kind = 'change_claim' AND id = v_id AND superseded_by IS NULL
                                                    AND user_id IS DISTINCT FROM v_owner) THEN
      RAISE EXCEPTION 'not your evidence' USING ERRCODE = '42501';
    END IF;
    v_rt := (SELECT (e->>'id')::uuid FROM jsonb_array_elements(v_rowcfg->'targets') e
              WHERE e->>'kind' = p_target_kind AND e->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' LIMIT 1);
    IF v_rt IS NULL OR NOT public.evidence_successor_of(p_target_kind, v_rt, v_id) THEN
      RAISE EXCEPTION 'target % is not the money that who-paid row asked about, or it changed since: ask again', v_id USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM evidence_links WHERE p_target_kind = 'evidence_link' AND id = v_id AND user_id = v_owner AND superseded_by IS NULL
                   UNION ALL
                   SELECT 1 FROM vehicle_change_claims WHERE p_target_kind = 'change_claim' AND id = v_id AND user_id = v_owner AND superseded_by IS NULL) THEN
      RETURN jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', v_id, 'result', 'not_current')));
    END IF;
    -- (v8) a keyed payment, (v9, W3) or any payment source line, keyed or not ((v10) evidence_is_payment_source)
    IF EXISTS (SELECT 1 FROM evidence_links WHERE p_target_kind = 'evidence_link' AND id = v_id
                 AND (payment_key IS NOT NULL OR public.evidence_is_payment_source(source_kind))) THEN
      RAISE EXCEPTION 'this money has a payment source; its payer comes from the account map (an account row), not a statement'
        USING ERRCODE = '22023';
    END IF;
    x := public.evidence_statement_for(v_owner, p_target_kind, v_id, p_answer_ref, v_party, v_rt, p_review_ref);
    v_bad := CASE WHEN x IS NULL THEN 'statement_not_the_asked_money' ELSE public.evidence_statement_problem(v_owner, x, v_rowcfg, p_answer_ref) END;
    IF v_bad IS NOT NULL THEN
      RETURN jsonb_build_object('items', jsonb_build_array(jsonb_build_object('id', v_id, 'result', v_bad)));
    END IF;
    v_vehicle := (x->>'vehicle_id')::uuid;
    IF v_vehicle IS NOT NULL AND NOT (v_vehicle = ANY (v_scope)) THEN
      RAISE EXCEPTION 'vehicle % is outside your evidence scope', v_vehicle USING ERRCODE = '42501';
    END IF;
    v_link := gen_random_uuid();
    -- (v9, W4) the money this answers, under every id it had: the target, the row target, and every row either was
    -- re-written from (their supersedes chains, at most 50 hops each)
    v_chain := ARRAY[v_id, v_rt];
    FOREACH v_start IN ARRAY ARRAY[v_id, v_rt] LOOP
      v_w := v_start;
      FOR i IN 1..50 LOOP
        v_w := CASE p_target_kind WHEN 'change_claim' THEN (SELECT supersedes FROM vehicle_change_claims WHERE id = v_w AND user_id = v_owner)
                                  ELSE (SELECT supersedes FROM evidence_links WHERE id = v_w AND user_id = v_owner) END;
        EXIT WHEN v_w IS NULL OR v_w = ANY (v_chain);
        v_chain := v_chain || v_w;
      END LOOP;
    END LOOP;
    -- his newer word replaces every earlier statement answering the same money
    WITH old AS (
      UPDATE evidence_links o SET superseded_by = v_link, superseded_at = now()
       WHERE o.user_id = v_owner AND o.superseded_by IS NULL AND o.source_kind = 'owner_statement'
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(o.evidence) e
                      WHERE (e->>'kind' = 'answers_row_target' AND e->>'ref' = ANY (v_chain::text[]))
                         OR (e->>'kind' IN ('link','claim') AND e->>'id' = ANY (v_chain::text[])))
      RETURNING o.id)
    SELECT array_agg(id ORDER BY id) INTO v_superseded FROM old;
    INSERT INTO evidence_links(id, user_id, run_id, vehicle_id, subject_key, source_kind, external_ref, source_key, source_label,
        occurred_on, direction, amount_cents, cost_category, role, payment_key, payer_entity, payee_entity, pass, join_key,
        confidence, evidence, summary, supersedes, created_by)
    VALUES (v_link, v_owner, substring(p_answer_ref from '^answers:([0-9a-f-]{36})#')::uuid, v_vehicle, x->>'subject_key',
        'owner_statement', p_answer_ref, p_answer_ref, x->>'source_label', (x->>'occurred_on')::date, x->>'direction',
        (x->>'amount_cents')::bigint, x->>'cost_category', x->>'role', x->>'payment_key', x->>'payer_entity', x->>'payee_entity',
        'owner_review', 'owner:who_paid', 1.000, x->'evidence', left('his statement: ' || v_party, 60), v_superseded[1], v_by);
    IF p_target_kind = 'change_claim' THEN
      v_sup := gen_random_uuid();
      INSERT INTO vehicle_change_claim_support(id, claim_id, user_id, evidence_kind, evidence_id, stance, about, weight, note, created_by)
      VALUES (v_sup, v_id, v_owner, 'evidence_link', v_link, 'supports', 'party', 1, 'his own statement: who paid or received', v_by);
      UPDATE vehicle_change_claim_support s SET superseded_by = v_sup, superseded_at = now()
       WHERE s.user_id = v_owner AND s.superseded_by IS NULL AND s.evidence_kind = 'evidence_link'
         AND s.evidence_id = ANY (coalesce(v_superseded, '{}'::uuid[]));
    END IF;
    INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, review_ref, review_method, reason, detail)
    VALUES (v_owner, 'evidence_link', v_link, 'confirmed', v_by, p_review_ref, p_review_method, p_reason,
            v_stamp || jsonb_build_object('question', 'party', 'answer', p_answer, 'asked_target', v_rt, 'decided_target', v_id))
    RETURNING id INTO v_dec;
    RETURN jsonb_build_object('items', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
             'id', v_id, 'result', 'statement_recorded', 'statement_link_id', v_link, 'decision_id', v_dec, 'support_id', v_sup,
             'superseded_statement_ids', to_jsonb(v_superseded)))));
  END IF;

  FOREACH v_id IN ARRAY p_target_ids LOOP
    v_vehicle := NULL; v_image := NULL; v_user := NULL; v_new := NULL; v_verdict := NULL; v_frame := NULL; v_subject := NULL;
    c := NULL; l := NULL; t := NULL; v_implied := NULL; v_sub := NULL; v_redec := NULL; v_note := NULL; v_oc := NULL; v_ocdec := NULL;
    IF p_target_kind = 'image_candidate' THEN
      SELECT * INTO c FROM image_vehicle_candidates WHERE id = v_id AND superseded_by IS NULL FOR UPDATE;
      IF NOT FOUND THEN v_out := v_out || jsonb_build_object('id', v_id, 'result', 'not_current'); CONTINUE; END IF;
      v_user := c.user_id; v_vehicle := c.vehicle_id; v_image := c.image_id; v_verdict := c.verdict; v_frame := c.frame_role;
      v_subject := c.subject_key;
      -- (v11 patch, reviewer) whose row it is, before any detail of it: 79bfe891 compared p_expected first and answered
      -- another user's id with changed_since_review and that photo's current vehicle
      IF v_user IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'not your evidence' USING ERRCODE = '42501'; END IF;
      IF p_expected IS NULL OR NOT (p_expected ? v_id::text) THEN
        RAISE EXCEPTION 'image decisions need p_expected for %', v_id USING ERRCODE = '22023';
      END IF;
      SELECT vehicle_id INTO v_cur FROM vehicle_images WHERE id = c.image_id;
      IF coalesce(to_jsonb(v_cur), 'null'::jsonb) IS DISTINCT FROM p_expected->v_id::text THEN
        v_out := v_out || jsonb_build_object('id', v_id, 'result', 'changed_since_review', 'current_vehicle_id', v_cur); CONTINUE;
      END IF;
    ELSIF p_target_kind IN ('evidence_link','album_map') THEN
      SELECT * INTO l FROM evidence_links WHERE id = v_id AND superseded_by IS NULL FOR UPDATE;
      IF NOT FOUND THEN v_out := v_out || jsonb_build_object('id', v_id, 'result', 'not_current'); CONTINUE; END IF;
      v_user := l.user_id; v_vehicle := l.vehicle_id;
      -- (v11 patch, reviewer) whose row it is before its kind (an album link or not) is told
      IF v_user IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'not your evidence' USING ERRCODE = '42501'; END IF;
      IF (p_target_kind = 'album_map') <> (l.source_kind = 'photos_album') THEN
        v_out := v_out || jsonb_build_object('id', v_id, 'result', 'not_current'); CONTINUE;
      END IF;
    ELSIF p_target_kind = 'change_claim' THEN
      SELECT user_id, CASE WHEN kind = 'worked_on' THEN NULL ELSE vehicle_id END INTO v_user, v_vehicle
        FROM vehicle_change_claims WHERE id = v_id AND superseded_by IS NULL;
    ELSIF p_target_kind = 'capture_time_claim' THEN
      SELECT * INTO t FROM image_capture_time_claims WHERE id = v_id AND superseded_by IS NULL FOR UPDATE;
      v_user := t.user_id;
      -- (v11 patch, reviewer) whose claim it is before its day is compared with his answer (79bfe891 raised the day
      -- error first, telling another user the claim's day)
      IF v_user IS NOT NULL AND v_user IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'not your evidence' USING ERRCODE = '42501'; END IF;
      -- (v8) "no, it was <day>" names another day than the one this claim says
      IF v_day IS NOT NULL AND t.captured_on = v_day THEN
        RAISE EXCEPTION '"no, it was %" names the day this claim already says; a "no" names another day', v_day USING ERRCODE = '22023';
      END IF;
    ELSIF p_target_kind = 'day_context' THEN
      SELECT user_id, vehicle_id INTO v_user, v_vehicle FROM user_day_vehicle_context WHERE id = v_id AND superseded_by IS NULL;
    ELSIF p_target_kind = 'account_entity' THEN
      SELECT user_id INTO v_user FROM evidence_account_entities WHERE id = v_id AND superseded_by IS NULL;
    ELSIF p_target_kind = 'image_publication' THEN
      -- (v6, RU1) never another user's photo that his scope merely reaches (a worked_on claim he confirmed himself);
      -- (v7, F3) only the photo's own user decides it: its user, else its vehicle's uploader, else its owner of record
      -- (a contributor or editor of the vehicle does not). (v11 patch, reviewer) whose photo it is comes first, then
      -- whether it is current and in his scope (79bfe891 checked those first for a photo that was not his)
      IF EXISTS (SELECT 1 FROM vehicle_images WHERE id = v_id) THEN
        IF public.evidence_image_user(v_id) IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'not your evidence' USING ERRCODE = '42501'; END IF;
        IF public.evidence_image_eligible(v_owner, v_id, v_scope) THEN v_user := v_owner; END IF;
      END IF;
    ELSE
      RAISE EXCEPTION 'unknown target kind %', p_target_kind;
    END IF;
    IF v_user IS NULL THEN v_out := v_out || jsonb_build_object('id', v_id, 'result', 'not_current'); CONTINUE; END IF;
    IF v_user IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'not your evidence' USING ERRCODE = '42501'; END IF;
    IF p_decision = 'confirmed' AND v_vehicle IS NOT NULL AND NOT (public.evidence_resolve_vehicle(v_vehicle) = ANY (v_scope)) THEN
      RAISE EXCEPTION 'vehicle % is outside your evidence scope', v_vehicle USING ERRCODE = '42501';
    END IF;
    -- (v8, D1 on his own confirmation) a decision that cites his stored answer never lands on a row the passes
    -- re-wrote with another meaning since he answered: reported, nothing written; the app asks the new row afresh.
    -- (v9, W2) nor anywhere else than where that answer was about (evidence_answer_fits)
    IF p_answer_ref IS NOT NULL THEN
      v_fit := public.evidence_answer_fits(v_rowcfg, p_target_kind, v_id, v_owner, v_sent, v_reading, p_decision);
      IF v_fit->>'result' <> 'fits' THEN
        v_out := v_out || (jsonb_build_object('id', v_id) || v_fit); CONTINUE;
      END IF;
    END IF;

    INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, review_ref, review_method, reason, detail)
    VALUES (v_owner, p_target_kind, v_id, p_decision, v_by, p_review_ref, p_review_method, p_reason,
            v_stamp || CASE WHEN p_target_kind = 'image_candidate' THEN jsonb_build_object('expected_vehicle_id', p_expected->v_id::text) ELSE '{}'::jsonb END
                    || CASE WHEN v_day IS NOT NULL THEN jsonb_build_object('answer', p_answer) ELSE '{}'::jsonb END)
    RETURNING id INTO v_dec;

    -- A confirm of a subject candidate rejects every other current subject candidate of the image that disagrees.
    -- (v5, readers v4 #5) two no-row trucks disagree by subject_key; (readers v4 #2) only his own candidates.
    -- (v7, D5) only places KNOWN to be other trucks (evidence_places_distinct): a vin: key and the album label of one
    -- no-row truck, or a row and the vin: key of its own VIN, are left as they are.
    -- (v8, lead (c)) only his own confirm implies anything (v_by is always 'human:' now; stated, not assumed).
    -- (v9, R-T1/R-T2) places compared as trucks (evidence_truck_key): one truck under two ids is one place.
    IF p_target_kind = 'image_candidate' AND p_decision = 'confirmed' AND v_frame = 'subject' AND v_by LIKE 'human:%' THEN
      v_truck := public.evidence_truck_key(v_vehicle, v_subject, v_owner);
      WITH ins AS (
        INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, reason, detail)
        SELECT v_owner, 'image_candidate', o.id, 'rejected', 'implied:'||v_dec::text, 'owner confirmed another answer for this image',
               jsonb_build_object('writer', 'decide_evidence', 'implied_by', v_dec)
          FROM image_vehicle_candidates o
         WHERE o.image_id = v_image AND o.user_id = v_owner AND o.superseded_by IS NULL AND o.id <> v_id AND o.frame_role = 'subject'
           AND (public.evidence_places_distinct(public.evidence_truck_key(o.vehicle_id, o.subject_key, v_owner), v_truck)
                OR o.verdict IN ('not_vehicle','other_vehicle') <> (v_verdict IN ('not_vehicle','other_vehicle')))
           AND public.evidence_status('image_candidate', o.id) <> 'rejected'
        RETURNING id)
      SELECT array_agg(id) INTO v_implied FROM ins;
    END IF;

    -- A reject of a subject candidate also rejects the image's other current subject candidates for the same truck
    -- (same vehicle through merge lineage; (v9, R-T2) and his confirmed same_vehicle_as pairs: the truck's identity
    -- set), so an earlier "yes" cannot outlive a later "no" (one image, one answer).
    IF p_target_kind = 'image_candidate' AND p_decision = 'rejected' AND v_frame = 'subject' AND v_vehicle IS NOT NULL AND v_by LIKE 'human:%' THEN
      WITH ins AS (
        INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, reason, detail)
        SELECT v_owner, 'image_candidate', o.id, 'rejected', 'implied:'||v_dec::text, 'owner rejected this truck for this image',
               jsonb_build_object('writer', 'decide_evidence', 'implied_by', v_dec)
          FROM image_vehicle_candidates o
         WHERE o.image_id = v_image AND o.user_id = v_owner AND o.superseded_by IS NULL AND o.id <> v_id AND o.frame_role = 'subject'
           AND o.vehicle_id IS NOT NULL
           AND (o.vehicle_id = ANY (public.evidence_identity_set(v_vehicle, v_owner))
                OR public.evidence_resolve_vehicle(o.vehicle_id) = public.evidence_resolve_vehicle(v_vehicle))
           AND public.evidence_status('image_candidate', o.id) <> 'rejected'
        RETURNING id)
      SELECT array_agg(id) INTO v_implied FROM ins;
    END IF;

    -- (v8) "No, it was <day>": his day replaces the claim he rejected, written and confirmed by this decision
    IF p_target_kind = 'capture_time_claim' AND v_day IS NOT NULL THEN
      v_oc := gen_random_uuid();
      UPDATE image_capture_time_claims SET superseded_by = v_oc, superseded_at = now() WHERE id = t.id;
      INSERT INTO image_capture_time_claims(id, user_id, run_id, image_id, stored_taken_at, corrected_taken_at, offset_seconds,
          local_offset_minutes, captured_on, rule, batch_key, witness, confidence, supersedes, created_by)
      SELECT v_oc, v_owner, t.run_id, t.image_id, vi.taken_at, t.corrected_taken_at + (v_day - t.captured_on) * interval '1 day',
             CASE WHEN vi.taken_at IS NULL THEN NULL
                  ELSE round(extract(epoch FROM vi.taken_at - (t.corrected_taken_at + (v_day - t.captured_on) * interval '1 day')))::int END,
             t.local_offset_minutes, v_day, 'owner', NULL,
             jsonb_build_object('decision_ref', v_dec, 'day_only', true, 'answer', p_answer)
               || CASE WHEN p_answer_ref IS NOT NULL THEN jsonb_build_object('answer_ref', p_answer_ref) ELSE '{}'::jsonb END,
             1.000, t.id, v_by
        FROM (SELECT 1) one LEFT JOIN vehicle_images vi ON vi.id = t.image_id;
      INSERT INTO evidence_decisions(user_id, target_kind, target_id, decision, decided_by, review_ref, review_method, reason, detail)
      VALUES (v_owner, 'capture_time_claim', v_oc, 'confirmed', v_by, p_review_ref, p_review_method, p_reason,
              v_stamp || jsonb_build_object('answer', p_answer, 'from_rejection', v_dec))
      RETURNING id INTO v_ocdec;
    END IF;

    -- "No, it is vehicle Y."
    IF p_decision = 'rejected' AND p_reassign_vehicle_id IS NOT NULL THEN
      v_yveh := public.evidence_resolve_vehicle(p_reassign_vehicle_id);
      IF v_yveh IS NULL OR NOT (v_yveh = ANY (v_scope)) THEN
        RAISE EXCEPTION 'vehicle % is outside your evidence scope', p_reassign_vehicle_id USING ERRCODE = '42501';
      END IF;
      IF p_target_kind = 'image_candidate' THEN
        -- (v6, AC5) the same frame role: "the truck in the background is Y" is about the background, never the subject
        SELECT o.id INTO v_new FROM image_vehicle_candidates o
         WHERE o.image_id = c.image_id AND o.user_id = v_owner AND o.vehicle_id = v_yveh AND o.superseded_by IS NULL
           AND o.verdict IN ('is_vehicle','listing_evidence') AND o.frame_role = c.frame_role
         ORDER BY (o.pass = 'owner_review') DESC, o.confidence DESC, o.id LIMIT 1;
        IF v_new IS NULL THEN
          IF EXISTS (SELECT 1 FROM image_vehicle_candidates o WHERE o.image_id = c.image_id AND o.user_id = v_owner
                       AND o.vehicle_id = v_yveh AND o.pass = 'owner_review' AND o.superseded_by IS NULL) THEN
            v_note := 'reassign_needs_review';             -- his own earlier answer put that truck in the other frame role
          ELSE
            v_new := gen_random_uuid();
            INSERT INTO image_vehicle_candidates(id, user_id, run_id, image_id, vehicle_id, verdict, frame_role, pass, join_key, confidence,
                evidence, image_class, pass_captured_on, created_by)
            VALUES (v_new, c.user_id, c.run_id, c.image_id, v_yveh, 'is_vehicle', c.frame_role, 'owner_review',
                'owner:'||p_review_method, 1.000,
                jsonb_build_array(jsonb_build_object('kind','candidate','id',c.id), jsonb_build_object('kind','review','ref',p_review_ref)),
                c.image_class, c.pass_captured_on, v_by);
          END IF;
        END IF;
        IF v_new IS NOT NULL THEN
          -- (v9, W2) Y's row is not a target of the answered row, so the confirm of Y does not cite the answer (this
          -- rejection, which named Y, does)
          v_sub := public.decide_evidence('image_candidate', ARRAY[v_new], 'confirmed', p_reason, p_review_ref, p_review_method,
                    v_owner, jsonb_build_object(v_new::text, p_expected->v_id::text), NULL, NULL, NULL, NULL);
        END IF;
      ELSIF p_target_kind = 'evidence_link' THEN
        IF public.evidence_link_class(l.role, l.allocated_cents, l.source_kind) <> 'placement' THEN
          v_note := 'reassign_not_a_placement';            -- a share, a contradiction or a context link is not re-placed
        ELSE
          -- (v6, AC7) a link of the same payment or source in the same role, unallocated (never a contradiction)
          SELECT o.id INTO v_new FROM evidence_links o
           WHERE o.user_id = v_owner AND o.superseded_by IS NULL
             AND (o.source_key = l.source_key OR (l.payment_key IS NOT NULL AND o.payment_key = l.payment_key))
             AND o.role = l.role AND o.allocated_cents IS NULL AND o.source_kind <> 'photos_album'
             AND public.evidence_resolve_vehicle(o.vehicle_id) = v_yveh
           ORDER BY (o.source_key = l.source_key) DESC, (o.pass = 'owner_review') DESC, o.confidence DESC, o.id LIMIT 1;
          IF v_new IS NULL THEN
            v_old := NULL;
            SELECT o.id INTO v_old FROM evidence_links o
             WHERE o.user_id = v_owner AND o.source_key = l.source_key AND o.vehicle_id = v_yveh AND o.superseded_by IS NULL;
            IF v_old IS NOT NULL AND EXISTS (SELECT 1 FROM evidence_decisions d WHERE d.target_kind = 'evidence_link' AND d.target_id = v_old) THEN
              v_note := 'reassign_needs_review';           -- a decided row of the same source already sits on Y
            ELSE
              v_new := gen_random_uuid();
              IF v_old IS NOT NULL THEN                     -- an undecided pass row of the same source on Y: his word replaces it
                UPDATE evidence_links SET superseded_by = v_new, superseded_at = now() WHERE id = v_old;
              END IF;
              INSERT INTO evidence_links(id, user_id, run_id, vehicle_id, source_kind, source_table, source_row_id, external_ref, anchor, source_key,
                  source_sha256, source_label, occurred_on, transaction_on, direction, amount_cents, allocated_cents, cost_category, counterparty_label,
                  role, payment_key, payer_entity, payee_entity, from_account_ref, to_account_ref, pass, join_key, confidence,
                  payment_join_confidence, evidence, summary, supersedes, created_by)
              VALUES (v_new, l.user_id, l.run_id, v_yveh, l.source_kind, l.source_table, l.source_row_id,
                  l.external_ref, l.anchor, l.source_key, l.source_sha256, l.source_label, l.occurred_on, l.transaction_on, l.direction,
                  l.amount_cents, NULL, l.cost_category, l.counterparty_label, l.role, l.payment_key, l.payer_entity, l.payee_entity,
                  l.from_account_ref, l.to_account_ref, 'owner_review', 'owner:'||p_review_method, 1.000, l.payment_join_confidence,
                  jsonb_build_array(jsonb_build_object('kind','link','id',l.id), jsonb_build_object('kind','review','ref',p_review_ref)),
                  l.summary, v_old, v_by);
            END IF;
          END IF;
          IF v_new IS NOT NULL THEN
            -- (v6, AC7) through the same checks as any decision of his
            v_sub := public.decide_evidence('evidence_link', ARRAY[v_new], 'confirmed', p_reason, p_review_ref, p_review_method,
                      v_owner, NULL, NULL, NULL, NULL, NULL);
          END IF;
        END IF;
      END IF;
      v_redec := (v_sub->'items'->0->>'decision_id')::uuid;
    END IF;
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object('id', v_id, 'result', p_decision, 'decision_id', v_dec, 'reassigned_to', v_new,
                        'implied_decision_ids', to_jsonb(v_implied), 'reassign_decision_id', v_redec, 'reassign_result', v_sub,
                        'reassign_note', v_note, 'owner_claim_id', v_oc, 'owner_claim_decision_id', v_ocdec));
  END LOOP;
  RETURN jsonb_build_object('items', v_out);
END $$;

-- ---------------------------------------------------------------------------------------------------
-- 2.5 Readers (security_invoker views and INVOKER functions: RLS decides what a caller sees)
--   v3 (exit-test v2 / sql-apply v2, reader cost): readers no longer read a store-wide view with window functions.
--   evidence_candidates_for_images takes the image ids first (from an index on vehicle or on day), then computes
--   status and the one effective day per image for those images only.
--   (v6, RU8) every list a reader returns has a total order, so two reads of the same rows are byte-identical.
-- ---------------------------------------------------------------------------------------------------
-- (v6, RU1) the latest decision per user and target: a publication decision of another user is his own row here
CREATE OR REPLACE VIEW public.v_evidence_status WITH (security_invoker = true) AS
SELECT DISTINCT ON (d.user_id, d.target_kind, d.target_id)
       d.target_kind, d.target_id, d.user_id, d.decision AS status, d.decided_by,
       split_part(d.decided_by, ':', 1) AS channel, d.on_behalf_of, d.review_ref, d.review_method,
       d.created_at AS decided_at, d.id AS decision_id
  FROM public.evidence_decisions d
 WHERE d.decision IN ('confirmed','rejected')
 ORDER BY d.user_id, d.target_kind, d.target_id, d.created_at DESC, d.id DESC;

CREATE OR REPLACE VIEW public.v_image_capture_time WITH (security_invoker = true) AS
SELECT c.image_id, c.user_id, c.corrected_taken_at AS capture_at, c.captured_on, c.local_offset_minutes, c.rule, c.id AS claim_id
  FROM public.image_capture_time_claims c
 WHERE c.superseded_by IS NULL
   AND public.evidence_status('capture_time_claim', c.id) = 'confirmed';

-- (v5, readers v4 #1) Whose evidence a read shows. Every reader filters every evidence table by this one user, so a
-- service-role read (BYPASSRLS: the runner, the scoreboard, the exit test) shows the same rows as that user's own RLS
-- read, never a mix of users.
-- (v6, RU6) A signed-in caller reads his own evidence (naming another user raises). Any other caller must name the
-- user: a read never guesses it from the vehicle (a vehicle with no owner columns gave a valid-looking empty read, and
-- a sold truck's buyer would have become the default reader).
-- (v9, R-R3) A signed-in role (authenticated, or anon) reads only the user its token names: a token with no subject
-- reads nothing (v8 then trusted p_user_id, and the one SECURITY DEFINER reader showed that user's stored words). A
-- named user is trusted only for a job (service_role through the API) or a session outside the API (q.sh, the
-- scoreboard); any other API role is refused.
CREATE OR REPLACE FUNCTION public.evidence_reader_user(p_vehicle_id uuid, p_user_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := (SELECT auth.uid()); v_role text := coalesce(current_setting('role', true), '');
BEGIN
  IF v_role IN ('authenticated','anon') THEN
    IF v_uid IS NULL THEN
      RAISE EXCEPTION 'a signed-in read needs your user id; this token names none' USING ERRCODE = '42501';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'a signed-in read shows only your own evidence' USING ERRCODE = '42501';
    END IF;
    RETURN v_uid;
  END IF;
  IF session_user::text = 'authenticator' AND v_role <> 'service_role' THEN
    RAISE EXCEPTION 'through the API a read names its user only as a job (service_role)' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'name the user whose evidence to read (p_user_id); a read never guesses it from the vehicle' USING ERRCODE = '22023';
  END IF;
  -- (v7, F8) a named user exists
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'unknown user %', p_user_id USING ERRCODE = '22023';
  END IF;
  RETURN p_user_id;
END $$;

-- (v10, trucks F3) The subject rows of these photos that his own confirmed subject answers: rows with no decision of
-- their own at a place known to differ from a subject he confirmed for the photo (evidence_places_distinct on truck
-- keys), or of the other verdict class. For the day reader (R-T1's read rule). SECURITY DEFINER so a VIN is read the same
-- way in his session and the job's; it answers only about the reading user's own candidate rows (a signed-in caller:
-- himself only; a job: the user it names), which only jobs write, so no caller can ask it about a vehicle of his choosing.
-- It starts from his confirmed subject decisions on these photos (the day reader already reads every candidate once), so
-- the reads cost what v9's did (100x scale: one vehicle 2.2-2.4 s v10, 2.3 s v9, same machine and data).
CREATE OR REPLACE FUNCTION public.evidence_answered_elsewhere(p_image_ids uuid[], p_user_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS MATERIALIZED (
    SELECT CASE WHEN coalesce(current_setting('role', true), '') IN ('authenticated','anon')
                THEN CASE WHEN (SELECT auth.uid()) = p_user_id THEN p_user_id END
                WHEN session_user::text = 'authenticator' AND coalesce(current_setting('role', true), '') <> 'service_role' THEN NULL
                ELSE p_user_id END AS uid),
  conf AS MATERIALIZED (
    SELECT c.image_id, public.evidence_truck_key(c.vehicle_id, c.subject_key, (SELECT uid FROM u)) AS truck,
           (c.verdict IN ('not_vehicle','other_vehicle')) AS no_truck
      FROM public.evidence_decisions x
      JOIN public.image_vehicle_candidates c ON c.id = x.target_id
     WHERE x.user_id = (SELECT uid FROM u) AND x.target_kind = 'image_candidate' AND x.decision = 'confirmed'
       AND x.decided_by LIKE 'human:%'
       AND c.image_id = ANY (p_image_ids) AND c.user_id = (SELECT uid FROM u) AND c.superseded_by IS NULL
       AND c.frame_role = 'subject' AND cardinality(p_image_ids) > 0
       AND NOT EXISTS (SELECT 1 FROM public.evidence_decisions y
                        WHERE y.target_kind = 'image_candidate' AND y.target_id = c.id AND y.decision IN ('confirmed','rejected')
                          AND (y.created_at, y.id) > (x.created_at, x.id)))
  SELECT DISTINCT o.id
    FROM conf JOIN public.image_vehicle_candidates o
      ON o.image_id = conf.image_id AND o.user_id = (SELECT uid FROM u) AND o.superseded_by IS NULL AND o.frame_role = 'subject'
   WHERE NOT EXISTS (SELECT 1 FROM public.evidence_decisions z
                      WHERE z.target_kind = 'image_candidate' AND z.target_id = o.id AND z.decision IN ('confirmed','rejected'))
     AND (public.evidence_places_distinct(conf.truck, public.evidence_truck_key(o.vehicle_id, o.subject_key, (SELECT uid FROM u)))
          OR conf.no_truck <> (o.verdict IN ('not_vehicle','other_vehicle')))
$$;

-- Current candidates of the given images, with reader status and ONE effective day per image (a confirmed capture
-- time, else the combined row's day, else the earliest day any pass used), so an image never counts on two days.
-- (v5, readers v4 #1/#2) one user's candidates and time claims only; (#7) the confirmed times are aggregated per
-- image once and the album-reject test is a join, so the cost grows linearly with the images.
-- (v7, F4) One pass, no set-to-set join: each current candidate of the images is read once (index on image), and
-- everything else is an index lookup from that row (its latest decision, the image's one current capture time and
-- its latest decision, its album link and that link's latest decision); the image's day and the "he rejected this
-- truck for this photo" test are window aggregates over those rows. With no join between two row sets, a wrong row
-- estimate cannot turn into a nested loop over thousands of rows (v6 joined the candidates to an aggregate of
-- themselves, and a 10-row guess for ANY($1) made that quadratic).
-- (v7, F1) A photo with no confirmed capture time is never dated on a day he said was wrong: when the pass day is
-- the day of a capture-time claim his own word rejected (that claim current or since replaced by an unconfirmed one),
-- the photo is undated (captured_on NULL) until a time is confirmed.
-- (v8) "His own word" is his human decision (there is no other); a stored chat answer changes nothing here.
-- (v9, R-T1/R-T2/R-T3) His word on a photo is read per truck, not per row:
--   * a row's truck is its identity (evidence_truck_key, one call per vehicle id named here): rows naming one truck
--     under two ids (a merge, his confirmed same_vehicle_as pair) are one truck;
--   * his word on (photo, truck, frame role) is his LATEST human or implied decision on any of its rows: a row with no
--     decision of its own on a truck he said no to for this photo reads 'rejected' (v8 read only an album row that way,
--     only by raw vehicle id, and counted human rejections alone, so an implied "not this truck" and a merged id were
--     missed);
--   * a subject row with no decision of its own at a place known to differ from the subject he confirmed for this
--     photo (evidence_places_distinct, or a no-truck verdict against a truck) reads 'rejected': his confirmation
--     answered it (the implied rejection his confirm writes for the rows that existed then, read for rows written
--     since or concurrently);
--   * only then may an album row read 'confirmed_by_album_map' (the album's truck is the row's truck).
--   evidence_candidate_status and v_image_candidates_current return this same status (one implementation).
CREATE OR REPLACE FUNCTION public.evidence_candidates_for_images(p_image_ids uuid[], p_user_id uuid)
RETURNS TABLE(id uuid, user_id uuid, image_id uuid, vehicle_id uuid, verdict text, frame_role text, subject_key text, pass text,
              confidence numeric, image_class text, album_link_id uuid, pass_captured_on date, status text, decided_by text,
              captured_on date, time_unverified boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  WITH c AS (
    SELECT c.id, c.user_id, c.image_id, c.vehicle_id, c.verdict, c.frame_role, c.subject_key, c.pass, c.confidence, c.image_class,
           c.album_link_id, c.pass_captured_on, d.decision, d.decided_by, d.created_at AS decided_at, d.id AS decision_id,
           t.t_day, t.no_days, a.album_vehicle
      FROM public.image_vehicle_candidates c
      LEFT JOIN LATERAL (SELECT x.decision, x.decided_by, x.created_at, x.id FROM public.evidence_decisions x
                          WHERE x.target_kind = 'image_candidate' AND x.target_id = c.id AND x.decision IN ('confirmed','rejected')
                          ORDER BY x.created_at DESC, x.id DESC LIMIT 1) d ON true
      LEFT JOIN LATERAL (    -- the image's capture-time claims of this user (ictc_user_image): the current one's day when
                             -- it is confirmed, and every day his own word ((v8) his human decision) rejected, current or
                             -- since replaced
        SELECT min(tc.captured_on) FILTER (WHERE tc.superseded_by IS NULL AND y.decision = 'confirmed') AS t_day,
               array_agg(tc.captured_on) FILTER (WHERE y.decision = 'rejected' AND y.decided_by LIKE 'human:%') AS no_days
          FROM public.image_capture_time_claims tc
          LEFT JOIN LATERAL (SELECT x.decision, x.decided_by FROM public.evidence_decisions x
                              WHERE x.target_kind = 'capture_time_claim' AND x.target_id = tc.id AND x.decision IN ('confirmed','rejected')
                              ORDER BY x.created_at DESC, x.id DESC LIMIT 1) y ON true
         WHERE tc.user_id = c.user_id AND tc.image_id = c.image_id) t ON true
      LEFT JOIN LATERAL (    -- his own album link, when he confirmed that album's map
        SELECT l.vehicle_id AS album_vehicle FROM public.evidence_links l
         WHERE l.id = c.album_link_id AND l.user_id = c.user_id
           AND (SELECT x.decision FROM public.evidence_decisions x
                 WHERE x.target_kind = 'album_map' AND x.target_id = l.id AND x.decision IN ('confirmed','rejected')
                 ORDER BY x.created_at DESC, x.id DESC LIMIT 1) = 'confirmed') a ON true
     WHERE c.image_id = ANY (p_image_ids) AND c.user_id = p_user_id AND c.superseded_by IS NULL),
  tk AS MATERIALIZED (   -- (v9) one truck key per vehicle id named here (rows and album links)
    SELECT v.vid, public.evidence_truck_key(v.vid, NULL, p_user_id) AS truck
      FROM (SELECT c.vehicle_id AS vid FROM c WHERE c.vehicle_id IS NOT NULL
            UNION SELECT c.album_vehicle FROM c WHERE c.album_vehicle IS NOT NULL) v),
  -- (v11, no-statistics cost) the helper is handed only the photos that carry his confirmed subject (the rows above
  -- already say which): handed every photo of a vehicle, an unanalyzed database scanned his candidates and tested each
  -- against the whole array (10x read without statistics: 1.4 s, v9 0.8 s; this: 0.8 s)
  ae AS MATERIALIZED (SELECT x AS id FROM public.evidence_answered_elsewhere(
         ARRAY(SELECT DISTINCT c.image_id FROM c WHERE c.frame_role = 'subject' AND c.decision = 'confirmed' AND c.decided_by LIKE 'human:%'),
         p_user_id) x),
  k AS (
    SELECT c.*, coalesce(tv.truck, c.subject_key) AS truck, ta.truck AS album_truck,
           (c.verdict IN ('not_vehicle','other_vehicle')) AS no_truck,
           (c.decided_by LIKE 'human:%' OR c.decided_by LIKE 'implied:%') AS his
      FROM c LEFT JOIN tk tv ON tv.vid = c.vehicle_id LEFT JOIN tk ta ON ta.vid = c.album_vehicle),
  w AS (
    SELECT k.*,
           coalesce(min(k.pass_captured_on) FILTER (WHERE k.pass = 'combined') OVER (PARTITION BY k.image_id),
                    min(k.pass_captured_on) OVER (PARTITION BY k.image_id)) AS pass_day,
           -- (v9) his latest word on this photo, this truck and this frame role, whichever row carries it
           first_value(CASE WHEN k.his THEN k.decision END)
             OVER (PARTITION BY k.image_id, k.frame_role, coalesce(k.truck, 'none:' || k.verdict)
                   ORDER BY k.his DESC NULLS LAST, k.decided_at DESC NULLS LAST, k.decision_id DESC NULLS LAST) AS truck_word,
           -- (v9; v10, F3) answered by another subject he confirmed for this photo (evidence_answered_elsewhere)
           k.id IN (SELECT ae.id FROM ae) AS answered_elsewhere
      FROM k)
  SELECT w.id, w.user_id, w.image_id, w.vehicle_id, w.verdict, w.frame_role, w.subject_key, w.pass, w.confidence, w.image_class,
         w.album_link_id, w.pass_captured_on,
         CASE WHEN w.decision IS NOT NULL THEN w.decision
              WHEN w.truck_word = 'rejected' THEN 'rejected'
              WHEN w.frame_role = 'subject' AND w.answered_elsewhere THEN 'rejected'
              WHEN w.album_truck IS NOT NULL AND w.album_truck = w.truck THEN 'confirmed_by_album_map'
              ELSE 'proposed' END,
         w.decided_by,
         CASE WHEN w.t_day IS NOT NULL THEN w.t_day
              WHEN w.pass_day = ANY (coalesce(w.no_days, '{}'::date[])) THEN NULL::date
              ELSE w.pass_day END,
         w.t_day IS NULL
    FROM w
$$;

-- Candidate status as one candidate: (v9, R-T3) the day reader's own status for it (evidence_candidates_for_images
-- over its photo), so the scoreboard view, promotion (M1p) and the day readers never disagree (v8 kept a second copy of
-- the rule here that counted any rejection ever made, where the day reader counted his latest word); a row since
-- replaced has its own decision only.
CREATE OR REPLACE FUNCTION public.evidence_candidate_status(p_candidate_id uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN c.superseded_by IS NULL
              THEN (SELECT r.status FROM public.evidence_candidates_for_images(ARRAY[c.image_id], c.user_id) r WHERE r.id = c.id)
              ELSE public.evidence_status('image_candidate', c.id) END
    FROM public.image_vehicle_candidates c
   WHERE c.id = p_candidate_id
$$;

-- For the scoreboard (one owner, batch): current candidates with status, no day computation. (A service-role read
-- sees every user's rows here; the scoreboard filters by its :uid.) (v9, R-T3) The status is the day reader's: one call
-- of evidence_candidates_for_images per user over his current photos (the user filter reaches that call through the
-- join on user_id), not a per-row status function.
CREATE OR REPLACE VIEW public.v_image_candidates_current WITH (security_invoker = true) AS
SELECT c.*, r.status
  FROM (SELECT DISTINCT k.user_id FROM public.image_vehicle_candidates k WHERE k.superseded_by IS NULL) u
 CROSS JOIN LATERAL public.evidence_candidates_for_images(
         ARRAY(SELECT DISTINCT k.image_id FROM public.image_vehicle_candidates k WHERE k.user_id = u.user_id AND k.superseded_by IS NULL),
         u.user_id) r
  JOIN public.image_vehicle_candidates c ON c.id = r.id AND c.user_id = u.user_id;

-- Custody window of an identity set: the acquisition and sale claims.
--   (v4, exit-test v3) Ranked: owner-confirmed first; then sourced claims before custody_bounds' upper bounds; then
--   claims with a start date; then confidence; then the newest. A window with no start date is 'unknown' (work_days
--   then reads "unknown", never an empty list), and its upper bound is shown as acquired_by.
--   (v5, readers v4 #1) the given user's claims only. (v6, RU8) ties broken by id.
CREATE OR REPLACE FUNCTION public.evidence_custody(p_ids uuid[], p_user_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH k AS (
    SELECT k.*, public.evidence_status('change_claim', k.id) AS st, coalesce(er.pass = 'custody_bounds', false) AS bound_only
      FROM public.vehicle_change_claims k LEFT JOIN public.evidence_runs er ON er.id = k.run_id
     WHERE k.vehicle_id = ANY (p_ids) AND k.user_id = p_user_id AND k.superseded_by IS NULL AND k.kind IN ('acquisition','sale')),
  acq AS (SELECT * FROM k WHERE kind = 'acquisition' AND st <> 'rejected'
           ORDER BY (st = 'confirmed') DESC, bound_only, (occurred_from IS NOT NULL) DESC, confidence DESC, created_at DESC, id LIMIT 1),
  sal AS (SELECT * FROM k WHERE kind = 'sale' AND st <> 'rejected'
           ORDER BY (st = 'confirmed') DESC, bound_only, confidence DESC, created_at DESC, id LIMIT 1)
  SELECT jsonb_build_object(
    'from', (SELECT occurred_from FROM acq),
    'acquired_by', (SELECT occurred_to FROM acq WHERE occurred_from IS NULL),
    'to',   (SELECT coalesce(occurred_to, occurred_from) FROM sal),
    'acquisition_claim', (SELECT id FROM acq), 'sale_claim', (SELECT id FROM sal),
    'status', CASE WHEN NOT EXISTS (SELECT 1 FROM acq) OR (SELECT occurred_from FROM acq) IS NULL THEN 'unknown'
                   WHEN (SELECT st FROM acq) = 'confirmed' AND coalesce((SELECT st FROM sal), 'confirmed') = 'confirmed' THEN 'confirmed'
                   ELSE 'proposed' END)
$$;

-- Vehicle day records. NULL p_from/p_to = all evidence for the identity set. (v5) p_user_id: whose evidence
-- (evidence_reader_user); (readers v4 #9) a day after a dated sale is outside custody even when the start is unknown.
-- (v6, RU2) work sessions are the reading user's own, like every other row here.
CREATE OR REPLACE FUNCTION public.get_vehicle_day_records(p_vehicle_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
                                                          p_user_id uuid DEFAULT NULL)
RETURNS TABLE(day date, in_custody boolean, own_photos bigint, own_photos_confirmed bigint, own_photos_album bigint,
              own_photos_proposed_high bigint, own_photos_proposed_other bigint, also_in_frame_photos bigint, third_party_photos bigint,
              listing_photos bigint, document_photos bigint, time_unverified bigint, sessions bigint, session_ids uuid[],
              evidence_links jsonb, change_claims jsonb, photos_items_not_in_nuke bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
WITH u AS (SELECT public.evidence_reader_user(p_vehicle_id, p_user_id) AS uid),
ids AS (SELECT unnest(public.evidence_identity_set(p_vehicle_id, (SELECT uid FROM u))) AS vid),
cust AS (SELECT public.evidence_custody(ARRAY(SELECT vid FROM ids), (SELECT uid FROM u)) AS j),
win AS (SELECT coalesce(p_from, '1900-01-01'::date) AS f, coalesce(p_to, '2999-12-31'::date) AS t),
imgs AS (SELECT DISTINCT c.image_id FROM image_vehicle_candidates c
          WHERE c.vehicle_id IN (SELECT vid FROM ids) AND c.user_id = (SELECT uid FROM u) AND c.superseded_by IS NULL),
cand AS (
  SELECT c.* FROM public.evidence_candidates_for_images(ARRAY(SELECT image_id FROM imgs), (SELECT uid FROM u)) c
   WHERE c.vehicle_id IN (SELECT vid FROM ids)
     AND c.captured_on BETWEEN (SELECT f FROM win) AND (SELECT t FROM win) AND c.status <> 'rejected'
     AND c.verdict IN ('is_vehicle','listing_evidence')            -- ambiguous rows are unallocated, never a photo day
     AND (c.pass IN ('combined','owner_review') OR c.status IN ('confirmed','confirmed_by_album_map'))),
photos AS (
  SELECT captured_on AS day,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'own' AND frame_role = 'subject')                                          AS own_photos,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'own' AND frame_role = 'subject' AND status = 'confirmed')                 AS confirmed,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'own' AND frame_role = 'subject' AND status = 'confirmed_by_album_map')    AS album,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'own' AND frame_role = 'subject' AND status = 'proposed' AND confidence >= 0.85) AS high,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'own' AND frame_role = 'subject' AND status = 'proposed' AND confidence < 0.85)  AS other,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'own' AND frame_role = 'also_in_frame')                                    AS also,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'third_party')                                                             AS third,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'listing')                                                                 AS listing,
         -- (v3, gap 10) the owner's photo of a document about the truck (a printed settlement sheet): a dated trace, not work
         count(DISTINCT image_id) FILTER (WHERE image_class = 'document')                                                                AS document,
         count(DISTINCT image_id) FILTER (WHERE image_class = 'own' AND frame_role = 'subject' AND time_unverified)                      AS tu
    FROM cand GROUP BY 1),
money AS (
  SELECT l.occurred_on AS day,
         jsonb_agg(jsonb_build_object('link_id', l.id, 'kind', l.source_kind, 'ref', l.source_key, 'role', l.role, 'label', l.source_label,
                   'direction', l.direction, 'payment_key', l.payment_key, 'category', l.cost_category, 'confidence', l.confidence,
                   'status', public.evidence_status('evidence_link', l.id)) ORDER BY l.created_at, l.id)
           FILTER (WHERE l.source_kind <> 'photos_item') AS links,
         -- (v4, exit-test v3) Photos items with no vehicle_images row (videos, photos never uploaded), by capture day
         count(*) FILTER (WHERE l.source_kind = 'photos_item') AS photos_items
    FROM evidence_links l
   WHERE l.vehicle_id IN (SELECT vid FROM ids) AND l.user_id = (SELECT uid FROM u) AND l.superseded_by IS NULL
     AND l.occurred_on BETWEEN (SELECT f FROM win) AND (SELECT t FROM win)
     AND public.evidence_status('evidence_link', l.id) <> 'rejected'
   GROUP BY 1),
sess AS (
  SELECT w.session_date AS day, count(*) AS n, array_agg(w.id ORDER BY w.id) AS sids
    FROM work_sessions w WHERE w.vehicle_id IN (SELECT vid FROM ids)
     AND w.user_id = (SELECT uid FROM u)                               -- (v6, RU2) his sessions only
     AND w.session_date BETWEEN (SELECT f FROM win) AND (SELECT t FROM win) GROUP BY 1),
claims AS (
  SELECT k.occurred_from AS day,
         jsonb_agg(jsonb_build_object('claim_id', k.id, 'kind', k.kind, 'to', k.occurred_to, 'summary', k.summary, 'party', k.party_entity,
                   'confidence', k.confidence, 'status', public.evidence_status('change_claim', k.id)) ORDER BY k.kind, k.id) AS cl
    FROM vehicle_change_claims k WHERE k.vehicle_id IN (SELECT vid FROM ids) AND k.user_id = (SELECT uid FROM u) AND k.superseded_by IS NULL
     AND k.occurred_from BETWEEN (SELECT f FROM win) AND (SELECT t FROM win) GROUP BY 1),
days AS (SELECT day FROM photos UNION SELECT day FROM money UNION SELECT day FROM sess UNION SELECT day FROM claims)
SELECT d.day,
       CASE WHEN (SELECT j->>'to' FROM cust) IS NOT NULL AND d.day > (SELECT (j->>'to')::date FROM cust) THEN false
            WHEN (SELECT j->>'from' FROM cust) IS NULL THEN NULL
            ELSE d.day >= (SELECT (j->>'from')::date FROM cust) AND d.day <= coalesce((SELECT (j->>'to')::date FROM cust), 'infinity'::date) END,
       coalesce(p.own_photos,0), coalesce(p.confirmed,0), coalesce(p.album,0), coalesce(p.high,0), coalesce(p.other,0),
       coalesce(p.also,0), coalesce(p.third,0), coalesce(p.listing,0), coalesce(p.document,0), coalesce(p.tu,0), coalesce(s.n,0),
       s.sids, m.links, k.cl, coalesce(m.photos_items, 0)
  FROM days d
  LEFT JOIN photos p ON p.day = d.day LEFT JOIN money m ON m.day = d.day
  LEFT JOIN sess s ON s.day = d.day LEFT JOIN claims k ON k.day = d.day
 ORDER BY d.day
$$;

-- The accounting question as one read (v3).
--   work_days: days with the owner's own photos (subject) INSIDE the custody window; days before/after and days
--     with custody unknown are listed apart.
--   Money is placement only: where a payment the sources show belongs, with what confidence and on whose word;
--   never what it was for in tax terms (OWNER-DECISIONS 5).
--   One payment = one payment_key. Its status on this identity is decided at the payment level (v3, exit-test v2):
--     the latest owner decision on ANY link carrying the key here wins (a confirmed 'contradicts' link counts as a
--     rejection); else 'placed_elsewhere' when the owner confirmed it on a vehicle outside the identity; else
--     'contested' when a non-rejected link for it sits on another vehicle (unless both sides carry allocated_cents:
--     a split receipt is shares, checked by 'over_allocated'); else 'disputed' when a source here
--     contradicts it; else the best proposed band. confirmed/high/med/low are summed (cents = the link's
--     allocated_cents when set, else the amount from the payment source); the rest are listed, never summed.
--   Links with no payment behind them (jacket lines, unjoined orders) are 'asserted_unpaid', listed only.
--   Payer and payee come from the link, else from the owner-confirmed account map via from/to_account_ref.
--   (v5) readers v4 #1: one user's evidence; rules-channels v4 #4: owner/business only from his map or statement;
--     readers v4 #3: coverage per payment-source account; #8: a window selects payments by their own date and lists a
--     payment dated outside it under payments_outside_window; #9: who_paid is not asked of an upper bound,
--     undated_own_photos is counted.
--   (v6) Changes, by objection:
--     RU3: a windowed read (p_from or p_to set) never bands or sums a payment with no date; it is listed under
--       payments_undated (an all-evidence read still bands it);
--     RU4: an account whose final statement a run recorded (closed_accounts) is complete, and an account his
--       confirmed map gives to a third party is not his; money_sources_cover_to is the oldest coverage of his OPEN
--       accounts; an assertion waiting for a statement names the accounts it waits on (waiting_on); an open account
--       whose coverage lags his newest is asked about (money_source_behind: is it closed, or is an export missing?);
--     RU8: every list has a total order.
--   (v9, W3) a band 'stated' under costs and money_received for a statement a keyed payment carried exactly.
--   (v10, lead decision) In this first ship an owner statement is never summed: costs and money_received band keyed
--     payments only, each once; every confirmed statement is listed under the top-level 'stated' (cents, payer or payee,
--     direction, the claim or link it answers and its status, covered_cents and the keyed payments that could be it);
--     it still closes who_paid / who_received. The open question acquisition_conflict names two or more current
--     acquisition (or sale) claims on the truck.
--   (v11 patch, re-check N2) acquisition_conflict asks once per group of claims within 30 days of each other.
--   (v11, lead decision; money F1, F2, M1) 'stated' is lists only, never a total of statements: v10's cents_out /
--     cents_in summed statements whose claim or link he had rejected, replaced or moved, and an undated statement in
--     every windowed read. stated.statements: each statement dated by what it answers (answers.on), with 'counts' (what
--     it answers is current and not rejected); only a counting statement is covered by keyed payments (each payment
--     covers at most one, a rejected payment none). A windowed read lists the statements dated inside it and, under
--     stated.undated, those with no date at all (as payments_undated). acquisition_conflict asks only about claims
--     whose windows overlap or fall within 30 days of each other (bought, sold, bought back is not a conflict).
CREATE OR REPLACE FUNCTION public.vehicle_accounting_evidence(p_vehicle_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL,
                                                              p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
WITH u AS (SELECT public.evidence_reader_user(p_vehicle_id, p_user_id) AS uid),
ids AS (SELECT unnest(public.evidence_identity_set(p_vehicle_id, (SELECT uid FROM u))) AS vid),
win AS (SELECT coalesce(p_from, '1900-01-01'::date) AS f, coalesce(p_to, '2999-12-31'::date) AS t,
               (p_from IS NOT NULL OR p_to IS NOT NULL) AS windowed),
cust AS (SELECT public.evidence_custody(ARRAY(SELECT vid FROM ids), (SELECT uid FROM u)) AS j),
-- (v4, exit-test v3) a confirmed 'unknown' mapping ("no idea whose") does not count as mapped
mapped AS (SELECT a.account_ref, a.entity_key FROM evidence_account_entities a
            WHERE a.user_id = (SELECT uid FROM u) AND a.superseded_by IS NULL AND a.entity_key <> 'unknown'
              AND public.evidence_status('account_entity', a.id) = 'confirmed'),
-- (v5, readers v4 #3) how far each payment-source account has been read: the newest coverage_to of his runs that
-- cover it; (v6, RU4) closed when a run recorded its final statement; (v7, F7b) closed is the word of the NEWEST run
-- covering the account (a later export that is not final reopens it)
cov_acct AS (SELECT acct, max((r.config->>'coverage_to')::date) AS d,
                    (array_agg(coalesce(r.config->'closed_accounts', '[]'::jsonb) @> to_jsonb(acct)
                               ORDER BY r.started_at DESC, r.id DESC))[1] AS closed
               FROM evidence_runs r CROSS JOIN LATERAL jsonb_array_elements_text(r.config->'covers_accounts') acct
              WHERE r.user_id = (SELECT uid FROM u) AND r.config ? 'coverage_to' AND r.status IN ('running','done')
              GROUP BY acct),
-- (v6, RU4) the accounts that could still be missing a payment: open, and not a third party's by his confirmed map
cov_open AS (SELECT ca.acct, ca.d FROM cov_acct ca
              WHERE NOT ca.closed AND NOT EXISTS (SELECT 1 FROM mapped m WHERE m.account_ref = ca.acct AND m.entity_key LIKE 'third_party:%')),
cov AS (SELECT min(d) AS d, max(d) AS newest FROM cov_open),
claims AS (
  SELECT k.*, public.evidence_status('change_claim', k.id) AS status, coalesce(er.pass = 'custody_bounds', false) AS bound_only,
         (SELECT jsonb_agg(jsonb_build_object('kind', s.evidence_kind, 'id', coalesce(cur.id, s.evidence_id), 'stance', s.stance,
                                              'about', s.about, 'weight', s.weight) ORDER BY s.created_at, s.id)
            FROM vehicle_change_claim_support s
            LEFT JOIN LATERAL (   -- support that cites a link since superseded follows it to the current link (same source and vehicle)
              -- (v7, F6) the same one-current key (source, then vehicle or no-row subject): exactly one current row
              SELECT l2.id FROM evidence_links l1
                JOIN evidence_links l2 ON l2.user_id = l1.user_id AND l2.source_key = l1.source_key
                                      AND coalesce(l2.vehicle_id::text, l2.subject_key, '-') = coalesce(l1.vehicle_id::text, l1.subject_key, '-')
                                      AND l2.superseded_by IS NULL
               WHERE s.evidence_kind = 'evidence_link' AND l1.id = s.evidence_id ORDER BY l2.id LIMIT 1) cur ON true
           WHERE s.claim_id = k.id AND s.user_id = k.user_id AND s.superseded_by IS NULL) AS support
    FROM vehicle_change_claims k LEFT JOIN evidence_runs er ON er.id = k.run_id
   WHERE k.vehicle_id IN (SELECT vid FROM ids) AND k.user_id = (SELECT uid FROM u) AND k.superseded_by IS NULL),
claims_live AS (SELECT * FROM claims WHERE status <> 'rejected'),
-- (v11 patch, re-check N2) the acquisition (sale) claims that could be one deal: claims of one kind whose windows overlap
-- or fall within 30 days of each other form one group (a sweep over the claims ordered by start: a claim starts a new
-- group when it begins more than 30 days after every earlier claim ended); a claim with no dates may be any deal, so a
-- kind that has one is one group. acquisition_conflict asks once per group of two or more.
deal_c AS (
  SELECT c.id, c.kind, coalesce(c.occurred_from, c.occurred_to) AS f, coalesce(c.occurred_to, c.occurred_from) AS t,
         bool_or(c.occurred_from IS NULL AND c.occurred_to IS NULL) OVER (PARTITION BY c.kind) AS kind_undated
    FROM claims_live c WHERE c.kind IN ('acquisition','sale') AND NOT c.bound_only),
deal_g AS (
  SELECT d.id, d.kind,
         CASE WHEN d.kind_undated THEN 0
              ELSE sum(CASE WHEN d.prev_t IS NULL OR d.f - 30 > d.prev_t THEN 1 ELSE 0 END)
                     OVER (PARTITION BY d.kind ORDER BY d.f, d.t, d.id) END AS grp
    FROM (SELECT x.*, max(x.t) OVER (PARTITION BY x.kind ORDER BY x.f, x.t, x.id
                                     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prev_t
            FROM deal_c x) d),
links_all AS (
  SELECT l.*, d.decision AS owner_decision, d.created_at AS decided_at, coalesce(d.decision, 'proposed') AS status,
         coalesce(l.payer_entity, (SELECT m.entity_key FROM mapped m WHERE m.account_ref = l.from_account_ref)) AS payer,
         coalesce(l.payee_entity, (SELECT m.entity_key FROM mapped m WHERE m.account_ref = l.to_account_ref)) AS payee
    FROM evidence_links l
    LEFT JOIN LATERAL (SELECT x.decision, x.created_at FROM evidence_decisions x
                        WHERE x.target_kind = 'evidence_link' AND x.target_id = l.id AND x.decision IN ('confirmed','rejected')
                        ORDER BY x.created_at DESC, x.id DESC LIMIT 1) d ON true
   WHERE l.vehicle_id IN (SELECT vid FROM ids) AND l.user_id = (SELECT uid FROM u) AND l.superseded_by IS NULL),
links AS (SELECT * FROM links_all WHERE occurred_on IS NULL OR occurred_on BETWEEN (SELECT f FROM win) AND (SELECT t FROM win)),
-- (v10, lead decision) his owner statements are not payments here: they are listed under 'stated' and never banded or
-- summed (an 'owner:' key, or a link resting on his statement), so every payment below is a keyed payment of a source
pdate AS (
  SELECT payment_key,
         coalesce(min(coalesce(transaction_on, occurred_on)) FILTER (WHERE public.evidence_is_payment_source(source_kind)),
                  min(occurred_on)) AS paid_on
    FROM links_all WHERE payment_key IS NOT NULL AND payment_key NOT LIKE 'owner:%' AND source_kind <> 'owner_statement'
   GROUP BY payment_key),
keyed AS (
  SELECT la.*, p.paid_on FROM links_all la JOIN pdate p ON p.payment_key = la.payment_key
   WHERE la.role IN ('payment_out','payment_in','assertion','contradicts')
     -- (v6, RU3) a windowed read bands only payments dated inside the window; an undated payment is listed apart
     AND CASE WHEN (SELECT windowed FROM win) THEN p.paid_on BETWEEN (SELECT f FROM win) AND (SELECT t FROM win) ELSE true END),
undated_pay AS (
  SELECT la.payment_key, count(*) AS links FROM links_all la JOIN pdate p ON p.payment_key = la.payment_key
   WHERE (SELECT windowed FROM win) AND p.paid_on IS NULL AND la.role IN ('payment_out','payment_in','assertion','contradicts')
   GROUP BY la.payment_key),
outside_window AS (
  SELECT DISTINCT l.payment_key, p.paid_on FROM links l JOIN pdate p ON p.payment_key = l.payment_key
   WHERE p.paid_on IS NOT NULL AND p.paid_on NOT BETWEEN (SELECT f FROM win) AND (SELECT t FROM win)),
outside AS (
  SELECT o.payment_key,
         bool_or(od.decision = 'confirmed' AND o.role <> 'contradicts') AS placed_outside,
         bool_or(coalesce(od.decision, 'proposed') <> 'rejected' AND o.role <> 'contradicts') AS shared_outside,
         bool_or(coalesce(od.decision, 'proposed') <> 'rejected' AND o.role <> 'contradicts' AND o.allocated_cents IS NULL) AS shared_unallocated,
         jsonb_agg(DISTINCT coalesce(o.vehicle_id::text, o.subject_key)) AS other_vehicles
    FROM evidence_links o
    LEFT JOIN LATERAL (SELECT x.decision FROM evidence_decisions x
                        WHERE x.target_kind = 'evidence_link' AND x.target_id = o.id AND x.decision IN ('confirmed','rejected')
                        ORDER BY x.created_at DESC, x.id DESC LIMIT 1) od ON true
   WHERE o.user_id = (SELECT uid FROM u) AND o.payment_key IN (SELECT payment_key FROM keyed) AND o.superseded_by IS NULL
     -- (v4, exit-test v3) a source that places the payment on a truck with no row in his scope ('label:<name>') is
     -- "placed elsewhere" too
     AND ((o.vehicle_id IS NOT NULL AND o.vehicle_id NOT IN (SELECT vid FROM ids)) OR (o.vehicle_id IS NULL AND o.subject_key IS NOT NULL))
   GROUP BY o.payment_key),
alloc_all AS (    -- every vehicle's current, not rejected allocation of a payment, against its amount (his links only)
  SELECT o.payment_key, sum(o.allocated_cents) AS allocated_total
    FROM evidence_links o
   WHERE o.user_id = (SELECT uid FROM u) AND o.payment_key IN (SELECT payment_key FROM keyed) AND o.superseded_by IS NULL
     AND o.allocated_cents IS NOT NULL AND public.evidence_status('evidence_link', o.id) <> 'rejected'
   GROUP BY o.payment_key),
pay AS (
  SELECT k.payment_key,
         (array_agg(CASE WHEN k.role = 'contradicts' THEN CASE WHEN k.owner_decision = 'confirmed' THEN 'rejected' END ELSE k.owner_decision END
                    ORDER BY k.decided_at DESC NULLS LAST, k.id)
            FILTER (WHERE (k.role <> 'contradicts' AND k.owner_decision IS NOT NULL) OR (k.role = 'contradicts' AND k.owner_decision = 'confirmed')))[1] AS owner_dec,
         bool_or(k.role = 'contradicts' AND k.status <> 'rejected') AS disputed,
         max(k.confidence) FILTER (WHERE k.role <> 'contradicts') AS best_conf,
         bool_or(k.role = 'payment_in') AS is_in,
         bool_or(k.role IN ('payment_out','assertion')) AS is_out,
         coalesce(max(k.amount_cents) FILTER (WHERE public.evidence_is_payment_source(k.source_kind)),
                  max(k.amount_cents)) AS amount,
         max(k.allocated_cents) AS allocated,
         min(k.paid_on) AS paid_on,
         (array_agg(k.cost_category ORDER BY (k.source_kind IN ('bank_line','ledger_line')) DESC, k.id) FILTER (WHERE k.cost_category IS NOT NULL))[1] AS category,
         -- (v4) known parties only, owner-confirmed links first, then the most confident; (v5) never from a rejected link
         (array_agg(k.payer ORDER BY (k.status = 'confirmed') DESC, k.confidence DESC, k.id) FILTER (WHERE k.payer IS NOT NULL AND k.status <> 'rejected'))[1] AS payer,
         (array_agg(k.payee ORDER BY (k.status = 'confirmed') DESC, k.confidence DESC, k.id) FILTER (WHERE k.payee IS NOT NULL AND k.status <> 'rejected'))[1] AS payee,
         (array_agg(k.from_account_ref ORDER BY k.id) FILTER (WHERE k.from_account_ref IS NOT NULL))[1] AS from_account_ref,
         (array_agg(k.to_account_ref ORDER BY k.id) FILTER (WHERE k.to_account_ref IS NOT NULL))[1] AS to_account_ref,
         jsonb_agg(jsonb_build_object('link_id', k.id, 'ref', k.source_key, 'kind', k.source_kind, 'role', k.role, 'label', k.source_label,
                                      'on', k.occurred_on, 'transaction_on', k.transaction_on, 'status', k.status,
                                      'confidence', k.confidence, 'payment_join_confidence', k.payment_join_confidence)
                   ORDER BY k.occurred_on NULLS LAST, k.source_key, k.id) AS links
    FROM keyed k GROUP BY k.payment_key),
banded AS (
  SELECT p.*, o.other_vehicles, a.allocated_total,
         CASE WHEN p.owner_dec = 'confirmed' THEN 'confirmed'
              WHEN p.owner_dec = 'rejected' THEN 'rejected'
              WHEN coalesce(o.placed_outside, false) THEN 'placed_elsewhere'
              WHEN coalesce(o.shared_unallocated, false) OR (p.allocated IS NULL AND coalesce(o.shared_outside, false)) THEN 'contested'
              WHEN p.disputed THEN 'disputed'
              WHEN p.best_conf >= 0.85 THEN 'high'
              WHEN p.best_conf >= 0.50 THEN 'med'
              ELSE 'low' END AS b,
         coalesce(p.allocated, p.amount) AS cents
    FROM pay p LEFT JOIN outside o ON o.payment_key = p.payment_key LEFT JOIN alloc_all a ON a.payment_key = p.payment_key),
-- (v10, lead decision: in this first ship an owner statement is never summed) Every confirmed owner statement on this
-- truck's identity (his who-paid answer on a claim or on a link), listed under 'stated' with the money it answers and,
-- for information only, covered_cents: the keyed payments on this truck's identity that could be that money (not
-- rejected; the statement's direction; a category equal to its own or none; cited by a current support row of the claim
-- it answers, or paid within that claim's window, or the statement's date, widened by 30 days), each payment counted for
-- at most one statement (the oldest it could be). Sums come only from keyed payments, each once in its own band. v9 moved
-- a statement out of the sum only when one payment carried it exactly; a deposit and a balance, a wire with a fee, a
-- line with no category, a payment on another truck cited as support, or a statement on a link, still double counted
-- or hid money (money F1-F4).
stmt AS (
  SELECT s.id AS link_id, s.payment_key, s.amount_cents AS cents, s.direction, s.cost_category AS category, s.occurred_on,
         s.payer, s.payee, s.created_at,
         (SELECT e->>'kind' FROM jsonb_array_elements(s.evidence) e WHERE e->>'kind' IN ('link','claim') ORDER BY e->>'kind' LIMIT 1) AS tkind,
         (SELECT (e->>'id')::uuid FROM jsonb_array_elements(s.evidence) e WHERE e->>'kind' IN ('link','claim') ORDER BY e->>'kind' LIMIT 1) AS tid
    FROM links_all s WHERE s.source_kind = 'owner_statement' AND s.status = 'confirmed'),
-- (v11, money F1/F2) each statement with the status of what it answers and the date of what it answers (its own date,
-- else the claim's end, else the link's day): a statement counts while what it answers is current and not rejected
stmt_a AS (
  SELECT st.*,
         CASE st.tkind WHEN 'claim' THEN public.evidence_status('change_claim', k.id) ELSE public.evidence_status('evidence_link', lt.id) END AS answers_status,
         CASE st.tkind WHEN 'claim' THEN k.superseded_by IS NULL ELSE lt.superseded_by IS NULL END AS answers_current,
         CASE WHEN st.tkind = 'claim' THEN coalesce(st.occurred_on, k.occurred_to, k.occurred_from)
              ELSE coalesce(st.occurred_on, lt.occurred_on, lt.transaction_on) END AS answers_on,
         CASE WHEN st.tkind = 'claim' THEN coalesce(k.occurred_from, k.occurred_to) - 30
              ELSE coalesce(st.occurred_on, lt.occurred_on, lt.transaction_on) - 30 END AS cover_from,
         CASE WHEN st.tkind = 'claim' THEN coalesce(k.occurred_to, k.occurred_from) + 30
              ELSE coalesce(st.occurred_on, lt.occurred_on, lt.transaction_on) + 30 END AS cover_to
    FROM stmt st
    LEFT JOIN vehicle_change_claims k ON st.tkind = 'claim' AND k.id = st.tid AND k.user_id = (SELECT uid FROM u)
    LEFT JOIN evidence_links lt ON st.tkind = 'link' AND lt.id = st.tid AND lt.user_id = (SELECT uid FROM u)),
-- (v11) the statements this read lists: a windowed read, those dated inside the window (an undated one is listed under
-- stated.undated); every read, whether each counts
stmt_t AS (
  SELECT sa.*, (sa.answers_status IS DISTINCT FROM 'rejected' AND sa.answers_current IS NOT FALSE) AS counts
    FROM stmt_a sa
   WHERE NOT (SELECT windowed FROM win) OR sa.answers_on BETWEEN (SELECT f FROM win) AND (SELECT t FROM win)),
cover_pair AS (    -- each keyed payment to the oldest counting statement it could be; (v11) only counting statements
  SELECT st.link_id, b.payment_key, b.cents,
         row_number() OVER (PARTITION BY b.payment_key ORDER BY st.created_at, st.link_id) AS rn
    FROM stmt_t st
    JOIN banded b ON st.counts AND b.b <> 'rejected'
               AND CASE st.direction WHEN 'out' THEN b.is_out AND NOT b.is_in WHEN 'in' THEN b.is_in AND NOT b.is_out ELSE false END
               AND (b.category IS NULL OR b.category IS NOT DISTINCT FROM st.category)
   WHERE b.paid_on BETWEEN st.cover_from AND st.cover_to
      OR EXISTS (SELECT 1 FROM vehicle_change_claim_support sp
                   JOIN evidence_links l1 ON l1.id = sp.evidence_id AND l1.user_id = sp.user_id
                   JOIN evidence_links l2 ON l2.user_id = l1.user_id AND l2.source_key = l1.source_key AND l2.superseded_by IS NULL
                                         AND coalesce(l2.vehicle_id::text, l2.subject_key, '-') = coalesce(l1.vehicle_id::text, l1.subject_key, '-')
                  WHERE st.tkind = 'claim' AND sp.claim_id = st.tid AND sp.user_id = (SELECT uid FROM u) AND sp.superseded_by IS NULL
                    AND sp.evidence_kind = 'evidence_link' AND sp.stance = 'supports' AND l2.payment_key = b.payment_key)),
cover AS (
  SELECT link_id, sum(cents) AS cents, jsonb_agg(payment_key ORDER BY payment_key) AS keys
    FROM cover_pair WHERE rn = 1 GROUP BY link_id),
-- (v4, exit-test v3) an assertion dated after the money sources' recorded coverage is awaiting a statement, not
-- unpaid (no recorded coverage: unpaid, as before); (v5) its own account's coverage when it names one; (v6, RU4) a
-- closed account is complete, and an unattributed assertion waits only on his open accounts
-- (v7, F7a) an assertion naming an account no run of his covers (while some account is covered) waits on THAT account
-- (no statement of it has been read), unless his confirmed map gives the account to a third party
unpaid AS (SELECT l.*,
                  coalesce(CASE WHEN l.from_account_ref IS NOT NULL AND EXISTS (SELECT 1 FROM cov_acct ca WHERE ca.acct = l.from_account_ref)
                                THEN (SELECT NOT ca.closed AND l.occurred_on > ca.d FROM cov_acct ca WHERE ca.acct = l.from_account_ref)
                                WHEN l.from_account_ref IS NOT NULL AND EXISTS (SELECT 1 FROM cov_acct)
                                THEN NOT EXISTS (SELECT 1 FROM mapped m WHERE m.account_ref = l.from_account_ref AND m.entity_key LIKE 'third_party:%')
                                ELSE l.occurred_on > (SELECT d FROM cov) END, false) AS awaiting_statement,
                  (l.from_account_ref IS NOT NULL AND EXISTS (SELECT 1 FROM cov_acct)
                   AND NOT EXISTS (SELECT 1 FROM cov_acct ca WHERE ca.acct = l.from_account_ref)) AS account_uncovered
             FROM links l WHERE l.payment_key IS NULL AND l.role IN ('payment_out','assertion') AND l.direction = 'out' AND l.status <> 'rejected'),
dayrec AS (SELECT * FROM public.get_vehicle_day_records(p_vehicle_id, (SELECT f FROM win), (SELECT t FROM win), (SELECT uid FROM u))),
work AS (SELECT * FROM dayrec WHERE own_photos > 0 OR document_photos > 0),
undated AS (
  SELECT count(DISTINCT c.image_id) AS n
    FROM public.evidence_candidates_for_images(ARRAY(SELECT DISTINCT x.image_id FROM image_vehicle_candidates x
                                                      WHERE x.vehicle_id IN (SELECT vid FROM ids) AND x.user_id = (SELECT uid FROM u)
                                                        AND x.superseded_by IS NULL), (SELECT uid FROM u)) c
   WHERE c.vehicle_id IN (SELECT vid FROM ids) AND c.captured_on IS NULL AND c.status <> 'rejected' AND c.verdict = 'is_vehicle'
     AND c.image_class = 'own' AND c.frame_role = 'subject'
     AND (c.pass IN ('combined','owner_review') OR c.status IN ('confirmed','confirmed_by_album_map'))),
pay_ok AS (SELECT payment_key, b, payer, payee FROM banded)
SELECT jsonb_build_object(
  'identity', (SELECT jsonb_agg(vid ORDER BY vid) FROM ids),
  'window', jsonb_build_object('from', p_from, 'to', p_to, 'basis', CASE WHEN p_from IS NULL AND p_to IS NULL THEN 'all evidence' ELSE 'caller' END),
  'custody', (SELECT j FROM cust),
  'acquisition', coalesce((SELECT jsonb_agg(to_jsonb(c) - 'user_id' - 'bound_only' ORDER BY (c.status = 'confirmed') DESC, c.confidence DESC, c.id) FROM claims_live c WHERE c.kind = 'acquisition'), '"unknown"'),
  'sale',        coalesce((SELECT jsonb_agg(to_jsonb(c) - 'user_id' - 'bound_only' ORDER BY (c.status = 'confirmed') DESC, c.confidence DESC, c.id) FROM claims_live c WHERE c.kind = 'sale'), '"unknown"'),
  'listings',    coalesce((SELECT jsonb_agg(jsonb_build_object('claim_id', c.id, 'from', c.occurred_from, 'to', c.occurred_to, 'summary', c.summary,
                            'status', c.status, 'support', c.support) ORDER BY c.occurred_from, c.id) FROM claims_live c WHERE c.kind = 'listing'), '[]'),
  'work_performed', coalesce((SELECT jsonb_agg(jsonb_build_object('claim_id', c.id, 'from', c.occurred_from, 'to', c.occurred_to, 'party', c.party_entity,
                            'summary', c.summary, 'status', c.status, 'support', c.support) ORDER BY c.occurred_from, c.id)
                            FROM claims_live c WHERE c.kind = 'work_performed'), '[]'),
  'changes',     coalesce((SELECT jsonb_agg(jsonb_build_object('claim_id', c.id, 'kind', c.kind, 'from', c.occurred_from, 'to', c.occurred_to,
                            'summary', c.summary, 'status', c.status, 'confidence', c.confidence, 'support', c.support) ORDER BY c.occurred_from, c.id)
                            FROM claims_live c WHERE c.kind NOT IN ('acquisition','sale','listing','work_performed')), '[]'),
  'work_days', CASE WHEN (SELECT j->>'status' FROM cust) = 'unknown' THEN '"unknown"'::jsonb ELSE
                 coalesce((SELECT jsonb_agg(jsonb_build_object('day', w.day, 'own_photos', w.own_photos, 'confirmed', w.own_photos_confirmed,
                            'album_confirmed', w.own_photos_album, 'time_unverified', w.time_unverified, 'sessions', w.sessions) ORDER BY w.day)
                            FROM work w WHERE w.in_custody AND w.own_photos > 0), '[]') END,
  'work_days_custody', (SELECT j->>'status' FROM cust),
  'photo_days_outside_custody', coalesce((SELECT jsonb_agg(jsonb_build_object('day', w.day, 'own_photos', w.own_photos,
                            'document_photos', w.document_photos,
                            'side', CASE WHEN (SELECT j->>'from' FROM cust) IS NOT NULL AND w.day < (SELECT (j->>'from')::date FROM cust)
                                         THEN 'before' ELSE 'after' END) ORDER BY w.day)
                            FROM work w WHERE w.in_custody IS FALSE), '[]'),
  'photo_days_custody_unknown', coalesce((SELECT jsonb_agg(w.day ORDER BY w.day) FROM work w WHERE w.in_custody IS NULL), '[]'),
  -- (v5, readers v4 #9) his own photos of the truck that have no day at all (no time claim, no pass day)
  'undated_own_photos', (SELECT n FROM undated),
  -- (v4, exit-test v3) days the truck was only in frame, days with work sessions and no own photo, and Photos items
  -- that never reached Nuke: listed apart, never counted as work days
  'also_in_frame_days', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'photos', d.also_in_frame_photos, 'in_custody', d.in_custody)
                            ORDER BY d.day) FROM dayrec d WHERE d.also_in_frame_photos > 0), '[]'),
  'session_days', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'sessions', d.sessions, 'session_ids', d.session_ids,
                            'in_custody', d.in_custody) ORDER BY d.day) FROM dayrec d WHERE d.sessions > 0 AND d.own_photos = 0), '[]'),
  'photos_items_not_in_nuke', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'items', d.photos_items_not_in_nuke) ORDER BY d.day)
                            FROM dayrec d WHERE d.photos_items_not_in_nuke > 0), '[]'),
  'money_sources_cover_to', (SELECT d FROM cov),
  'money_sources_cover_to_by_account', coalesce((SELECT jsonb_object_agg(acct, d) FROM cov_acct), '{}'::jsonb),
  -- (v6, RU4) the accounts a run recorded as closed (their final statement read)
  'money_sources_closed', coalesce((SELECT jsonb_agg(acct ORDER BY acct) FROM cov_acct WHERE closed), '[]'),
  'payments_outside_window', coalesce((SELECT jsonb_agg(jsonb_build_object('payment_key', payment_key, 'paid_on', paid_on) ORDER BY payment_key)
                            FROM outside_window), '[]'),
  -- (v6, RU3) payments with no date at all, in a windowed read: listed, never banded or summed here
  'payments_undated', coalesce((SELECT jsonb_agg(jsonb_build_object('payment_key', payment_key, 'links', links) ORDER BY payment_key)
                            FROM undated_pay), '[]'),
  'costs', coalesce((SELECT jsonb_object_agg(b, x) FROM (
              SELECT b, jsonb_build_object('cents', CASE WHEN b IN ('confirmed','high','med','low') THEN sum(cents) END,
                                           'payments', jsonb_agg(jsonb_build_object('payment_key', payment_key, 'cents', cents, 'category', category,
                                                                                   'paid_on', paid_on,
                                                                                   'payer', coalesce(payer, 'unknown'), 'other_vehicles', other_vehicles,
                                                                                   'links', links) ORDER BY payment_key)) x
                FROM banded WHERE is_out AND NOT is_in GROUP BY b
              UNION ALL
              SELECT 'asserted_unpaid', jsonb_build_object('cents', NULL, 'links', jsonb_agg(jsonb_build_object('link_id', id, 'ref', source_key,
                       'label', source_label, 'on', occurred_on, 'category', cost_category, 'status', status,
                       'awaiting_statement', awaiting_statement) ORDER BY source_key, id))
                FROM unpaid HAVING count(*) > 0) q), '{}'::jsonb),
  -- (v10, lead decision) his statements, listed apart and never summed; (v11, lead decision) lists only: no total of
  -- statements anywhere in this read
  'stated', jsonb_build_object(
      'statements', coalesce((SELECT jsonb_agg(jsonb_build_object('link_id', st.link_id, 'payment_key', st.payment_key,
                          'direction', st.direction, 'cents', st.cents, 'category', st.category, 'on', st.occurred_on,
                          'payer', coalesce(st.payer, 'unknown'), 'payee', coalesce(st.payee, 'unknown'),
                          'answers', jsonb_build_object('kind', st.tkind, 'id', st.tid, 'status', st.answers_status,
                                                        'current', st.answers_current, 'on', st.answers_on),
                          'counts', st.counts,
                          'covered_cents', least(coalesce(cv.cents, 0), st.cents), 'covered_by', coalesce(cv.keys, '[]'::jsonb))
                        ORDER BY st.answers_on NULLS LAST, st.link_id)
                        FROM stmt_t st LEFT JOIN cover cv ON cv.link_id = st.link_id), '[]'::jsonb),
      -- (v11, money F2) in a windowed read, a statement with no date at all: listed here, as payments_undated
      'undated', coalesce((SELECT jsonb_agg(jsonb_build_object('link_id', sa.link_id, 'payment_key', sa.payment_key,
                          'direction', sa.direction, 'cents', sa.cents, 'payer', coalesce(sa.payer, 'unknown'),
                          'payee', coalesce(sa.payee, 'unknown'),
                          'answers', jsonb_build_object('kind', sa.tkind, 'id', sa.tid, 'status', sa.answers_status,
                                                        'current', sa.answers_current))
                        ORDER BY sa.link_id)
                        FROM stmt_a sa WHERE (SELECT windowed FROM win) AND sa.answers_on IS NULL), '[]'::jsonb)),
  'money_received', jsonb_build_object(
      'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('payment_key', payment_key, 'band', b, 'cents', cents, 'paid_on', paid_on,
                          'payer', coalesce(payer,'unknown'), 'payee', coalesce(payee,'unknown'), 'from_account_ref', from_account_ref,
                          'to_account_ref', to_account_ref, 'other_vehicles', other_vehicles, 'links', links) ORDER BY payment_key)
                          FROM banded WHERE is_in), '[]'),
      'expected_from_sale', coalesce((SELECT jsonb_agg(jsonb_build_object('sale_claim', c.id, 'status', c.status,
                          'cash_expected_cents', c.amount_cents - coalesce(c.trade_in_cents, 0), 'trade_in_cents', c.trade_in_cents,
                          'trade_in_vehicle_id', c.related_vehicle_id,
                          'backed_by', coalesce((SELECT jsonb_agg(l.payment_key ORDER BY l.payment_key) FROM jsonb_array_elements(coalesce(c.support,'[]')) e
                                                   JOIN links_all l ON l.id = (e->>'id')::uuid
                                                  WHERE e->>'kind' = 'evidence_link' AND e->>'stance' = 'supports' AND l.role = 'payment_in'
                                                    AND l.status <> 'rejected'), '[]')) ORDER BY c.id)
                          FROM claims_live c WHERE c.kind = 'sale'), '[]')),
  'shared_sources', coalesce((SELECT jsonb_agg(jsonb_build_object('payment_key', payment_key, 'band', b, 'other_vehicles', other_vehicles) ORDER BY payment_key)
                              FROM banded WHERE other_vehicles IS NOT NULL), '[]'),
  'open_questions', coalesce((
      SELECT jsonb_agg(q ORDER BY q->>'q', q::text) FROM (
        SELECT jsonb_build_object('q', 'contradiction', 'claim_id', c.id, 'kind', c.kind,
                 'about', (SELECT jsonb_agg(DISTINCT e->>'about') FROM jsonb_array_elements(c.support) e WHERE e->>'stance' = 'contradicts')) q
          FROM claims_live c WHERE c.status = 'proposed'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(c.support,'[]')) e WHERE e->>'stance' = 'contradicts')
        UNION ALL
        SELECT jsonb_build_object('q', 'payment_placement', 'payment_key', payment_key, 'other_vehicles', other_vehicles) FROM banded WHERE b = 'contested'
        UNION ALL
        SELECT jsonb_build_object('q', 'disputed_payment', 'payment_key', payment_key) FROM banded WHERE b = 'disputed'
        UNION ALL
        SELECT jsonb_build_object('q', 'over_allocated', 'payment_key', payment_key) FROM banded WHERE allocated_total > amount
        UNION ALL
        -- (v7, F5) his own who-paid statement closes it too: a supporting owner_statement link that names who paid
        -- (received). (v8) Such a link exists only on his own who-paid decision in the app, which also confirms it, so
        -- it closes the question only while that confirmation stands (status confirmed; a later "no" reopens it).
        SELECT jsonb_build_object('q', 'who_paid', 'claim_id', c.id, 'kind', c.kind) FROM claims_live c
         WHERE c.kind = 'acquisition' AND NOT c.bound_only AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(coalesce(c.support,'[]')) e JOIN links_all l ON l.id = (e->>'id')::uuid
                 LEFT JOIN pay_ok p ON p.payment_key = l.payment_key
                WHERE e->>'kind' = 'evidence_link' AND e->>'stance' = 'supports' AND l.role = 'payment_out'
                  AND ((p.b = 'confirmed' AND coalesce(p.payer, 'unknown') <> 'unknown')
                       OR (l.source_kind = 'owner_statement' AND l.status = 'confirmed' AND l.payer IS NOT NULL)))
        UNION ALL
        SELECT jsonb_build_object('q', 'who_received', 'claim_id', c.id, 'kind', c.kind) FROM claims_live c
         WHERE c.kind = 'sale' AND NOT EXISTS (
               SELECT 1 FROM jsonb_array_elements(coalesce(c.support,'[]')) e JOIN links_all l ON l.id = (e->>'id')::uuid
                 LEFT JOIN pay_ok p ON p.payment_key = l.payment_key
                WHERE e->>'kind' = 'evidence_link' AND e->>'stance' = 'supports' AND l.role = 'payment_in'
                  AND ((p.b = 'confirmed' AND coalesce(p.payee, 'unknown') <> 'unknown')
                       OR (l.source_kind = 'owner_statement' AND l.status = 'confirmed' AND l.payee IS NOT NULL)))
        UNION ALL
        SELECT jsonb_build_object('q', CASE WHEN l.awaiting_statement THEN 'awaiting_statement' ELSE 'unpaid_assertion' END,
                                  'link_id', l.id, 'ref', l.source_key, 'label', l.source_label)
               || CASE WHEN l.awaiting_statement THEN jsonb_build_object('waiting_on',
                         CASE WHEN l.account_uncovered THEN jsonb_build_array(l.from_account_ref)        -- (v7, F7a)
                              ELSE (SELECT jsonb_agg(co.acct ORDER BY co.acct) FROM cov_open co
                                     WHERE co.d < l.occurred_on AND (l.from_account_ref IS NULL OR co.acct = l.from_account_ref)) END)
                       ELSE '{}'::jsonb END
          FROM unpaid l WHERE l.status = 'proposed'
        UNION ALL
        -- (v7, F7a) an account his assertions name that no run of his covers: is there an export to add?
        SELECT DISTINCT jsonb_build_object('q', 'money_source_missing', 'account_ref', l.from_account_ref)
          FROM unpaid l WHERE l.account_uncovered AND l.awaiting_statement
        UNION ALL
        SELECT DISTINCT jsonb_build_object('q', 'account_entity_unknown', 'account_ref', r.ref)
          FROM links l CROSS JOIN LATERAL (VALUES (l.from_account_ref), (l.to_account_ref)) r(ref)
         WHERE r.ref IS NOT NULL AND l.status <> 'rejected' AND r.ref NOT IN (SELECT account_ref FROM mapped)
        UNION ALL
        -- (v6, RU4) an open account whose statements stop before his newest: closed (record it), or an export is missing
        SELECT jsonb_build_object('q', 'money_source_behind', 'account_ref', co.acct, 'coverage_to', co.d, 'newest_coverage', (SELECT newest FROM cov))
          FROM cov_open co WHERE co.d < (SELECT newest FROM cov)
        UNION ALL
        SELECT jsonb_build_object('q', 'custody_window', 'status', (SELECT j->>'status' FROM cust))
         WHERE (SELECT j->>'status' FROM cust) <> 'confirmed'
        UNION ALL
        -- (v10, money F4) more than one current acquisition (or sale) claim on this truck that he has not rejected, a
        -- pass's bound aside: which one is the deal? (a refused re-write leaves the corrected reading as a second claim)
        -- (v11, M1) only claims whose windows overlap or fall within 30 days of each other (a claim with no dates
        -- conflicts with every other): a truck bought, sold and bought back has two deals, not a conflict
        -- (v11 patch, re-check N2) one question per group of such claims (two near-duplicate purchases in 2023 and two
        -- in 2025 are two questions, not one about four claims)
        SELECT jsonb_build_object('q', 'acquisition_conflict', 'kind', g.kind, 'claim_ids', jsonb_agg(g.id ORDER BY g.id))
          FROM deal_g g
         GROUP BY g.kind, g.grp HAVING count(*) > 1
      ) z), '[]')
)
$$;

-- One day of one user. (v5, readers v4 #1/#4) His candidates only; 'vehicles' counts his own photos of a truck as the
-- subject, and the other kinds (also in frame, third party, listing, document) are counted apart; no_row_subjects
-- follows the same status and pass rule (a rejected or also-in-frame row never counts); (rules-channels v4 #8) the
-- floor set carries each row's status and leaves out rejected rows. (v6, RU8) lists in a total order.
-- (v7, F8) it checks its user like every reader (evidence_reader_user): a signed-in caller naming another user raises.
CREATE OR REPLACE FUNCTION public.get_user_day_record(p_user_id uuid, p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
WITH u AS (SELECT public.evidence_reader_user(NULL, p_user_id) AS uid),   -- (v7, F8) the reader rule of every read
imgs AS (
  SELECT c.image_id FROM image_vehicle_candidates c WHERE c.user_id = (SELECT uid FROM u) AND c.pass_captured_on = p_day AND c.superseded_by IS NULL
  UNION
  SELECT t.image_id FROM image_capture_time_claims t WHERE t.user_id = (SELECT uid FROM u) AND t.captured_on = p_day AND t.superseded_by IS NULL),
cand AS (SELECT * FROM public.evidence_candidates_for_images(ARRAY(SELECT image_id FROM imgs), (SELECT uid FROM u)) c WHERE c.captured_on = p_day),
live AS (SELECT * FROM cand WHERE status <> 'rejected' AND verdict IN ('is_vehicle','listing_evidence')
           AND (pass IN ('combined','owner_review') OR status IN ('confirmed','confirmed_by_album_map'))),
floor AS (SELECT x.*, public.evidence_status('day_context', x.id) AS st FROM user_day_vehicle_context x
           WHERE x.user_id = (SELECT uid FROM u) AND x.day = p_day AND x.superseded_by IS NULL)
SELECT jsonb_build_object(
  'day', p_day,
  'vehicles', (SELECT jsonb_object_agg(vehicle_id, n) FROM (SELECT vehicle_id, count(DISTINCT image_id) n FROM live
                 WHERE vehicle_id IS NOT NULL AND image_class = 'own' AND frame_role = 'subject' GROUP BY 1) v),
  'also_in_frame', (SELECT jsonb_object_agg(k, n) FROM (SELECT coalesce(vehicle_id::text, subject_key) k, count(DISTINCT image_id) n FROM live
                 WHERE frame_role = 'also_in_frame' GROUP BY 1) v),
  'third_party', (SELECT jsonb_object_agg(vehicle_id, n) FROM (SELECT vehicle_id, count(DISTINCT image_id) n FROM live
                 WHERE vehicle_id IS NOT NULL AND image_class = 'third_party' GROUP BY 1) v),
  'listing', (SELECT jsonb_object_agg(vehicle_id, n) FROM (SELECT vehicle_id, count(DISTINCT image_id) n FROM live
                 WHERE vehicle_id IS NOT NULL AND image_class = 'listing' GROUP BY 1) v),
  'document', (SELECT jsonb_object_agg(vehicle_id, n) FROM (SELECT vehicle_id, count(DISTINCT image_id) n FROM live
                 WHERE vehicle_id IS NOT NULL AND image_class = 'document' GROUP BY 1) v),
  'floor_set', coalesce((SELECT jsonb_agg(jsonb_build_object('cluster', place_cluster, 'vehicle_id', vehicle_id, 'confidence', confidence,
                                                    'basis', basis, 'status', st) ORDER BY place_cluster, vehicle_id)
                  FROM floor WHERE st <> 'rejected'), '[]'::jsonb),
  'unallocated_images', (SELECT count(DISTINCT image_id) FROM cand WHERE pass = 'combined' AND verdict IN ('ambiguous','other_vehicle')),
  'no_row_subjects', (SELECT jsonb_object_agg(subject_key, n) FROM (SELECT subject_key, count(DISTINCT image_id) n FROM live
                        WHERE subject_key IS NOT NULL AND frame_role = 'subject' GROUP BY 1) s),
  'unallocated_links', (SELECT jsonb_agg(jsonb_build_object('link_id', id, 'ref', source_key, 'kind', source_kind, 'subject_key', subject_key)
                          ORDER BY source_key, id)
                          FROM evidence_links WHERE user_id = (SELECT uid FROM u) AND occurred_on = p_day AND vehicle_id IS NULL AND superseded_by IS NULL))
$$;

-- (v8) What waits for his own confirmation. One row per target of every sheet row his stored answers (review_answers
-- runs) answer, with what the app needs to show "you said X in chat" for a confirmation in his step-up session:
--   his words (verbatim, sha256) and the transcriber's reading (NULL when the row was stored unread), the row's
--   question and whether it asks who paid;
--   the target as the sheet named it, the row it is now (evidence_current_of, his rows only), whether that row still
--   asks the same question (evidence_successor_of / evidence_same_question: a row whose meaning changed since the sheet
--   is a new question, never his "yes"), and its status now;
--   the time of his latest decision on it in his own session (any time; NULL when he has none): the app compares it with
--   stored_at. A who-paid row counts as decided by the owner statement his decision wrote for it.
-- Read-only and advisory: nothing here decides anything or changes a reader. SECURITY DEFINER because the same-question
-- test resolves merge lineage (evidence_resolve_vehicle is not granted to owner sessions); every table is filtered to
-- the one user evidence_reader_user names (a signed-in caller: himself; any other caller names the user).
-- (v9, W2) message_at: the time of the chat message the answer came from. A sheet row can now have several stored
--   answers (one per message); the app shows the one with the latest message_at, and decide_evidence accepts only that
--   one as answer_ref.
-- (v10, A1) question_key (new): the question an answer is to, the same for a row and every re-ask of it
--   ('review:<sheet>#<row>' of its first asking); replaced_by (new, last column): the answers ref of his latest answer to
--   that question when it is not this one (NULL on the latest). The app shows one answer per question_key: the row
--   whose replaced_by is NULL; decide_evidence refuses the others.
-- (v9, R-P1) Cost: v8 scanned all his decisions once per answered row (ORed target sets, no index probe): 1,000 answered
--   rows after 1,000 decisions took 22.5 s, past the live limits (15 s for an authenticated session, 60 s for the
--   authenticator). Now u, own and cur are computed once (MATERIALIZED, so the ownership test runs once per target), and
--   each row's decision targets are a list of (target_kind, id) probed on ed_target. Same rows and values as v8.
CREATE OR REPLACE FUNCTION public.evidence_answers_to_confirm(p_user_id uuid DEFAULT NULL)
RETURNS TABLE(answers_run uuid, sheet_run uuid, row_no int, question text, asks text, verbatim text, sha256 text, reading jsonb,
              target_kind text, target_ref text, target_id uuid, current_id uuid, same_question boolean, status_now text,
              last_decided_at timestamptz, stored_at timestamptz, message_at timestamptz, question_key text, replaced_by text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH u AS MATERIALIZED (SELECT public.evidence_reader_user(NULL, p_user_id) AS uid),
  ans0 AS (
    SELECT a.id AS answers_run, sh.id AS sheet_run, r.key::int AS row_no, r.key AS row_key, r.value AS arow, sh.config->'rows'->r.key AS rc,
           a.started_at, (a.config->>'message_at')::timestamptz AS message_at,
           coalesce(sh.config->'rows'->r.key->>'asked_first', 'review:' || sh.id::text || '#' || r.key) AS qkey
      FROM public.evidence_runs a
      JOIN public.evidence_runs sh ON sh.id = (a.config->>'sheet_run')::uuid AND sh.user_id = a.user_id
                                  AND sh.run_kind = 'review' AND sh.pass = 'review_sheet'
     CROSS JOIN LATERAL jsonb_each(a.config->'rows') r
     WHERE a.user_id = (SELECT uid FROM u) AND a.run_kind = 'review_answers' AND a.status = 'done'),
  ans AS (    -- (v10, A1) one question, one latest answer, whichever sheet asked it (a re-ask keeps the first asking's key)
    SELECT x.*, first_value('answers:' || x.answers_run::text || '#' || x.row_key)
                  OVER (PARTITION BY x.qkey ORDER BY coalesce(x.message_at, x.started_at) DESC, x.started_at DESC,
                                                   x.answers_run::text DESC) AS latest_ref
      FROM ans0 x),
  tg AS (
    SELECT x.*, t.value AS t,
           CASE WHEN t.value->>'kind' = 'image' AND x.rc->>'question' = 'image_publication' THEN 'image_publication'
                ELSE t.value->>'kind' END AS tkind,
           CASE WHEN t.value->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (t.value->>'id')::uuid END AS tid
      FROM ans x CROSS JOIN LATERAL jsonb_array_elements(coalesce(x.rc->'targets', '[]'::jsonb)) t),
  own AS MATERIALIZED (    -- a target row of his (an id on his sheet that names another user's row is shown, never followed)
    SELECT tg.*, (tg.tid IS NOT NULL AND tg.tkind IN ('image_candidate','capture_time_claim','evidence_link','album_map',
                                                      'account_entity','change_claim','day_context','image_publication')
                  AND (SELECT p.user_id FROM public.evidence_target_profile(tg.tkind, tg.tid) p LIMIT 1) = (SELECT uid FROM u)) AS mine
      FROM tg),
  cur AS MATERIALIZED (SELECT own.*, CASE WHEN own.mine THEN public.evidence_current_of(own.tkind, own.tid) END AS cid FROM own),
  dec AS (    -- (v9, R-P1) every decision target the row counts, with its kind, probed through ed_target
    SELECT c.*,
           (SELECT max(d.created_at)
              FROM (SELECT c.tkind, c.tid WHERE c.mine
                    UNION ALL SELECT c.tkind, c.cid WHERE c.cid IS NOT NULL
                    UNION ALL SELECT 'image_candidate', k.id FROM public.image_vehicle_candidates k
                               WHERE c.tkind = 'image' AND k.image_id = c.tid AND k.user_id = (SELECT uid FROM u)
                    UNION ALL SELECT 'capture_time_claim', k.id FROM public.image_capture_time_claims k
                               WHERE c.tkind = 'image' AND k.image_id = c.tid AND k.user_id = (SELECT uid FROM u)
                    UNION ALL SELECT kk.kind, l.id FROM public.evidence_links l CROSS JOIN (VALUES ('evidence_link'), ('album_map')) kk(kind)
                               WHERE l.user_id = (SELECT uid FROM u)
                                 AND ((c.tkind = 'payment' AND l.payment_key = c.t->>'key') OR (c.tkind = 'source' AND l.source_key = c.t->>'key'))
                    UNION ALL SELECT 'account_entity', e.id FROM public.evidence_account_entities e
                               WHERE c.tkind = 'account' AND e.user_id = (SELECT uid FROM u) AND e.account_ref = c.t->>'key'
                    UNION ALL SELECT 'evidence_link', s.id FROM public.evidence_links s
                               WHERE coalesce(c.rc->>'asks', 'place') = 'party' AND c.mine AND s.user_id = (SELECT uid FROM u)
                                 AND s.source_kind = 'owner_statement'
                                 AND s.evidence @> jsonb_build_array(jsonb_build_object('kind', 'answers_row_target', 'ref', c.tid))) y(kind, id)
              JOIN public.evidence_decisions d ON d.target_kind = y.kind AND d.target_id = y.id
             WHERE d.user_id = (SELECT uid FROM u) AND d.decided_by LIKE 'human:%' AND d.decision IN ('confirmed','rejected')) AS last_at
      FROM cur c)
  SELECT x.answers_run, x.sheet_run, x.row_no, x.rc->>'question', coalesce(x.rc->>'asks', 'place'),
         x.arow->>'verbatim', x.arow->>'sha256',
         CASE WHEN coalesce((x.arow->'answer'->>'unread')::boolean, false) THEN NULL ELSE x.arow->'answer' END,
         x.tkind, coalesce(x.t->>'id', x.t->>'key'), x.tid, x.cid,
         CASE WHEN x.cid IS NULL THEN NULL WHEN x.cid = x.tid THEN true ELSE public.evidence_successor_of(x.tkind, x.tid, x.cid) END,
         CASE WHEN x.cid IS NOT NULL THEN public.evidence_status(x.tkind, x.cid, (SELECT uid FROM u)) END,
         x.last_at, x.started_at, x.message_at, x.qkey,
         CASE WHEN x.latest_ref <> 'answers:' || x.answers_run::text || '#' || x.row_key THEN x.latest_ref END
    FROM dec x
   ORDER BY x.started_at, x.answers_run, x.row_no, coalesce(x.t->>'id', x.t->>'key')
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2.6 Grants for M1w
-- ---------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  public.evidence_image_user(uuid), public.evidence_status(text,uuid,uuid), public.evidence_resolve_vehicle(uuid),
  public.evidence_fleet_vehicle_ids(uuid),
  public.evidence_scope_vehicle_ids(uuid,boolean), public.evidence_image_eligible(uuid,uuid,uuid[]), public.evidence_identity_set(uuid,uuid),
  public.evidence_identity_set_of(uuid,uuid), public.evidence_truck_key(uuid,text,uuid), public.evidence_candidate_status(uuid),
  public.evidence_assert_job(), public.evidence_is_payment_source(text), public.evidence_answered_elsewhere(uuid[],uuid),
  public.evidence_link_class(text,bigint,text), public.evidence_target_profile(text,uuid), public.evidence_sheet_row(uuid,text,jsonb),
  public.evidence_open_run(uuid,text,text,text,text,jsonb,jsonb,date,date,uuid),
  public.evidence_close_run(uuid,text,jsonb,bigint,jsonb,text),
  public.evidence_answer_place(jsonb), public.evidence_record_answers(uuid,uuid,text,jsonb,text,text,timestamptz),
  public.propose_image_candidates(uuid,jsonb), public.propose_capture_time_claims(uuid,jsonb),
  public.confirm_capture_times_by_rule(uuid,uuid[]), public.evidence_source_row_ok(uuid,text,uuid,uuid[]),
  public.evidence_statement_problem(uuid,jsonb,jsonb,text), public.evidence_statement_for(uuid,text,uuid,text,text,uuid,text),
  public.propose_evidence_links(uuid,jsonb),
  public.propose_account_entities(uuid,jsonb), public.evidence_insert_support(uuid,uuid,text,jsonb,uuid[]),
  public.propose_change_claim(uuid,jsonb,jsonb,uuid), public.propose_claim_support(uuid,uuid,jsonb),
  public.record_day_context(uuid,jsonb),
  public.evidence_same_question(text,uuid,uuid), public.evidence_successor_of(text,uuid,uuid), public.evidence_current_of(text,uuid),
  public.evidence_rewritten_from(text,jsonb,uuid), public.evidence_answer_fits(jsonb,text,uuid,uuid,timestamptz,jsonb,text),
  public.evidence_places_distinct(text,text), public.evidence_step_up(uuid),
  public.decide_evidence(text,uuid[],text,text,text,text,uuid,jsonb,uuid,text,text,jsonb),
  public.evidence_reader_user(uuid,uuid),
  public.evidence_candidates_for_images(uuid[],uuid), public.evidence_custody(uuid[],uuid), public.get_vehicle_day_records(uuid,date,date,uuid),
  public.vehicle_accounting_evidence(uuid,date,date,uuid), public.get_user_day_record(uuid,date),
  public.evidence_answers_to_confirm(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
-- Jobs (service_role through PostgREST): the writers. Their bodies check session_user and the JWT role again. (v8)
-- evidence_record_answers stores his words; it decides nothing. (v9) It takes the message's time (p_message_at).
GRANT EXECUTE ON FUNCTION
  public.evidence_open_run(uuid,text,text,text,text,jsonb,jsonb,date,date,uuid),
  public.evidence_close_run(uuid,text,jsonb,bigint,jsonb,text),
  public.evidence_record_answers(uuid,uuid,text,jsonb,text,text,timestamptz),
  public.propose_image_candidates(uuid,jsonb), public.propose_capture_time_claims(uuid,jsonb),
  public.confirm_capture_times_by_rule(uuid,uuid[]), public.propose_evidence_links(uuid,jsonb),
  public.propose_account_entities(uuid,jsonb), public.propose_change_claim(uuid,jsonb,jsonb,uuid),
  public.propose_claim_support(uuid,uuid,jsonb), public.record_day_context(uuid,jsonb)
  TO service_role;
-- (v8, lead directive) Decisions: the owner's own session only. service_role gets no EXECUTE (v7 granted it for the
-- agent channel); the body also refuses it ('agent_channel_disabled') should a later grant ever return.
GRANT EXECUTE ON FUNCTION public.decide_evidence(text,uuid[],text,text,text,text,uuid,jsonb,uuid,text,text,jsonb) TO authenticated;
-- Readers (INVOKER; RLS decides) and the helpers they call, for the owner and jobs. (v6) evidence_image_user is called
-- by evidence_status; evidence_resolve_vehicle and evidence_identity_set are SECURITY DEFINER and return vehicle ids
-- only (RU7). (v8) evidence_answers_to_confirm is SECURITY DEFINER, reads one user's rows (evidence_reader_user) and
-- decides nothing. (v9, R-T1/R-T2) The day reader compares trucks: evidence_truck_key (INVOKER, over the granted
-- evidence_identity_set); (v10, F3) and asks evidence_answered_elsewhere (SECURITY DEFINER, about the reader's own
-- candidates only) which rows his confirmed subject answers, so evidence_places_distinct is no API role's again;
-- (v10, money F3) evidence_is_payment_source is read by the accounting reader.
GRANT EXECUTE ON FUNCTION
  public.evidence_image_user(uuid), public.evidence_status(text,uuid,uuid),
  public.evidence_identity_set(uuid,uuid), public.evidence_reader_user(uuid,uuid),
  public.evidence_truck_key(uuid,text,uuid), public.evidence_answered_elsewhere(uuid[],uuid), public.evidence_is_payment_source(text),
  public.evidence_candidate_status(uuid), public.evidence_candidates_for_images(uuid[],uuid), public.evidence_custody(uuid[],uuid),
  public.get_vehicle_day_records(uuid,date,date,uuid), public.vehicle_accounting_evidence(uuid,date,date,uuid),
  public.get_user_day_record(uuid,date), public.evidence_answers_to_confirm(uuid)
  TO authenticated, service_role;
-- Job-only helpers that read other users' vehicles: service_role (scoreboard), never authenticated.
-- (v7, F8) evidence_resolve_vehicle (SECURITY DEFINER: any vehicle's survivor) is one of them: a signed-in caller gets
-- lineage only through evidence_identity_set, for vehicles in his scope.
GRANT EXECUTE ON FUNCTION public.evidence_fleet_vehicle_ids(uuid), public.evidence_scope_vehicle_ids(uuid,boolean),
  public.evidence_resolve_vehicle(uuid) TO service_role;
-- evidence_assert_job, evidence_image_eligible, evidence_insert_support, evidence_source_row_ok, (v6) evidence_link_class,
-- evidence_target_profile, evidence_sheet_row, evidence_answer_place, evidence_same_question, evidence_successor_of,
-- (v7) evidence_identity_set_of, evidence_statement_problem, evidence_step_up (which reads auth.sessions,
-- auth.mfa_factors and auth.mfa_amr_claims), (v8) evidence_statement_for, evidence_current_of and
-- evidence_rewritten_from, (v9) evidence_answer_fits, (v10) evidence_places_distinct (granted to the readers in v9,
-- withdrawn: F3): no grant (called inside the definer writers and readers as their owner). (v8) Gone with the agent channel:
-- evidence_row_covers, evidence_answer_allows, evidence_human_decided_since, evidence_first_asked,
-- evidence_owner_time_cited, evidence_time_word_at. The views: no write privilege for any API role (v3: authenticated
-- was missed in v2).
REVOKE ALL ON public.v_evidence_status, public.v_image_capture_time, public.v_image_candidates_current FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.v_evidence_status, public.v_image_capture_time, public.v_image_candidates_current TO authenticated, service_role;
COMMIT;
