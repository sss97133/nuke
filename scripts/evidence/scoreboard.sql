-- Image-evidence scoreboard (PLAN section 6; DESIGN-v5 section 11; v8). Read-only; run by scoreboard.py through q.sh.
-- Parameters: :uid (the owner, from --user; never written into the repo), :vehicle_id (the exit-test vehicle),
-- :chunk_from / :chunk_to (taken_at chunks; idx_vehicle_images_user_taken_at), :ids (a uuid list), :window_from /
-- :window_to (the capture window), :since (the M10b window start). Each statement follows a "-- name: <measure>"
-- line; "chunked" statements run once per chunk and are summed by scoreboard.py, "manifest" rows are matched against
-- the runner's manifest of returned ids (M10b), "answers" runs against the chat transcript, and M10_integrity's bodies
-- against the deployed md5s. (v8) Every decision is his, from his own step-up session in the app: no job decides.

-- name: M1 chunked
-- Unfiled own rows in the window (baseline 408 on 2026-10-20).
select count(*) n from vehicle_images vi
  left join v_image_capture_time t on t.image_id = vi.id
 where vi.user_id = :uid and vi.vehicle_id is null
   and not coalesce(vi.is_superseded, false) and not coalesce(vi.is_duplicate, false) and vi.source <> 'bat_import'
   and vi.taken_at >= :chunk_from and vi.taken_at < :chunk_to
   and coalesce(t.capture_at, vi.taken_at) >= :window_from and coalesce(t.capture_at, vi.taken_at) < :window_to;

-- name: M1_pre chunked
-- M1 before the store exists (no v_image_capture_time yet): taken_at alone, as the 2026-10-20 baseline measured it.
select count(*) n from vehicle_images vi
 where vi.user_id = :uid and vi.vehicle_id is null
   and not coalesce(vi.is_superseded, false) and not coalesce(vi.is_duplicate, false) and vi.source <> 'bat_import'
   and vi.taken_at >= :chunk_from and vi.taken_at < :chunk_to
   and vi.taken_at >= :window_from and vi.taken_at < :window_to;

-- name: M2
-- Sampled wrong-filing rate (scoreboard.py adds the Wilson 95% interval).
select count(*) filter (where st = 'rejected') wrong, count(*) filter (where st in ('confirmed', 'rejected')) decided
  from (select public.evidence_status('image_candidate', c.id, :uid) st from image_vehicle_candidates c
         where c.user_id = :uid and c.pass = 'audit_sample' and c.superseded_by is null) s;

-- name: M3
-- Candidates by pass and reader status.
select pass, status, count(*) n, count(distinct image_id) images, round(avg(confidence), 3) avg_conf
  from v_image_candidates_current where user_id = :uid group by 1, 2 order by 1, 2;

-- name: M4
-- Precision per pass against the owner's confirmed vehicle for each image: human channel only (RV2-2); (v7) the
-- status view holds one row per (user, kind, target): his rows only.
with truth as (
  select c.image_id, c.vehicle_id v from image_vehicle_candidates c
    join v_evidence_status s on s.target_kind = 'image_candidate' and s.target_id = c.id and s.user_id = :uid
   where c.user_id = :uid and s.status = 'confirmed' and s.channel = 'human' and c.frame_role = 'subject'),
top as (
  select distinct on (c.image_id, c.pass) c.image_id, c.pass, c.vehicle_id, c.verdict from image_vehicle_candidates c
   where c.user_id = :uid and c.superseded_by is null and c.frame_role = 'subject'
     and c.pass not in ('owner_review', 'audit_sample', 'claim_import')
   order by c.image_id, c.pass, c.confidence desc)
select t.pass, count(*) decided,
       count(*) filter (where t.vehicle_id = tr.v and t.verdict in ('is_vehicle', 'listing_evidence')) correct,
       round(count(*) filter (where t.vehicle_id = tr.v and t.verdict in ('is_vehicle', 'listing_evidence'))::numeric
             / nullif(count(*) filter (where t.verdict <> 'ambiguous'), 0), 3) "precision"
  from top t join truth tr using (image_id) group by 1 order by 1;

-- name: M4a
-- (v8) Transcription accuracy: for each of his decisions that cites a stored answer, does the stored reading agree
-- with what he decided (the yes/no, and the place when the reading named one)? Never a gate.
select d.detail->'stored_reading'->>'decision' = d.decision agrees_on_yes_no,
       coalesce(d.detail->'stored_reading'->>'vehicle_id', d.detail->'stored_reading'->>'entity_key',
                d.detail->'stored_reading'->>'captured_on') named_place, count(*) n
  from evidence_decisions d where d.user_id = :uid and d.decided_by like 'human:%' and d.detail ? 'answer_ref'
 group by 1, 2 order by 1, 2;

-- name: M5
-- Exit test read (exit_test.py compares ids, never amounts; v5: keyed by the owner, tuples widened).
select jsonb_build_object(
  'identity', v->'identity', 'custody', v->'custody',
  'work_days', (select jsonb_agg(d->>'day') from jsonb_array_elements(case when jsonb_typeof(v->'work_days') = 'array'
                                                                         then v->'work_days' else '[]' end) d),
  'outside', (select jsonb_agg(jsonb_build_array(d->>'day', d->>'side', d->>'own_photos', d->>'document_photos'))
                from jsonb_array_elements(v->'photo_days_outside_custody') d),
  'custody_unknown_days', v->'photo_days_custody_unknown',
  'bands', (select jsonb_object_agg(b, (select jsonb_agg(coalesce(p->>'payment_key', p->>'ref'))
                                       from jsonb_array_elements(coalesce(v->'costs'->b->'payments', v->'costs'->b->'links')) p))
              from jsonb_object_keys(coalesce(v->'costs', '{}')) b),
  'unpaid_labels', (select jsonb_agg(x->>'label') from jsonb_array_elements(v->'costs'->'asserted_unpaid'->'links') x),
  'work_performed', (select jsonb_agg(jsonb_build_array(x->>'party', x->>'from', x->>'to'))
                       from jsonb_array_elements(v->'work_performed') x),
  'listings', (select jsonb_agg(jsonb_build_array(x->>'from', x->>'to')) from jsonb_array_elements(v->'listings') x),
  'sale_trade_in', (select jsonb_agg(x->>'trade_in_vehicle_id')
                      from jsonb_array_elements(v->'money_received'->'expected_from_sale') x),
  'income', (select jsonb_agg(jsonb_build_array(x->>'payment_key', x->>'band', x->>'from_account_ref',
                                                x->>'to_account_ref', x->>'payer', x->>'payee'))
               from jsonb_array_elements(v->'money_received'->'payments') x),
  'undated_own_photos', v->'undated_own_photos', 'cover_to', v->'money_sources_cover_to',
  'open_questions', v->'open_questions') m5
from (select public.vehicle_accounting_evidence(:vehicle_id, NULL, NULL, :uid) v) s;

-- name: M6
-- Cost per pass (7 days) and Jev spend.
select pass, count(*) runs, sum(input_tokens) tokens, sum(cost_usd) usd, sum((counts->>'proposed')::int) proposed
  from evidence_runs where user_id = :uid and parent_run_id is not null and started_at > now() - interval '7 days'
 group by 1 order by usd desc nulls last;

-- name: M7 chunked
-- In-window rows without a confirmed capture time.
select count(*) n from vehicle_images vi left join v_image_capture_time t on t.image_id = vi.id
 where vi.user_id = :uid and t.image_id is null and vi.source <> 'bat_import'
   and vi.taken_at >= :chunk_from and vi.taken_at < :chunk_to
   and vi.taken_at >= :window_from and vi.taken_at < :window_to;

-- name: M7_pre chunked
-- M7 before the store exists: every in-window row lacks a confirmed capture time.
select count(*) n from vehicle_images vi
 where vi.user_id = :uid and vi.source <> 'bat_import'
   and vi.taken_at >= :chunk_from and vi.taken_at < :chunk_to
   and vi.taken_at >= :window_from and vi.taken_at < :window_to;

-- name: M8
-- Per-batch time gate (latest gate run).
select b.key batch, b.value->>'joined' joined, b.value->>'agreement' agreement, b.value->>'worst_day_agreement' worst_day
  from (select counts from evidence_runs where user_id = :uid and pass = 'time_rule_gate' and status = 'done'
         order by finished_at desc limit 1) g, jsonb_each(g.counts->'batches') b order by 1;

-- name: M9
-- Revert watch: halting must be 0; held_by_peer, on_deleted_vehicle, left_on_merged_duplicate are reported.
select kind, halting, count(*) n from public.evidence_revert_watch(:uid) group by 1, 2;

-- name: M10_channels
-- Decisions by channel (24 h).
select split_part(decided_by, ':', 1) channel, decision, count(*) n from evidence_decisions
 where user_id = :uid and created_at > now() - interval '1 day' group by 1, 2;

-- name: M10_guards
-- Guards: pins without a promotion (0), anon read (false), writers enabled ('{}' until M1e), testimony writes today.
select
  (select count(*) from image_observations io
    where io.image_id in (select image_id from image_vehicle_candidates where user_id = :uid)
      and io.agent_version like 'image-evidence-v1:%' and io.is_active
      and not exists (select 1 from evidence_decisions d where d.decision = 'promoted' and d.pin_claim_id = io.id))
    pins_without_promotion,
  has_table_privilege('anon', 'public.image_vehicle_candidates', 'SELECT') anon_can_read,
  public.evidence_enabled_writers() writers_enabled,
  (select count(*) from evidence_decisions where user_id = :uid and decision = 'promoted'
      and created_at >= date_trunc('day', now()) and detail->>'writes_testimony' = 'true') testimony_writes_today,
  (select count(*) from evidence_decisions where user_id = :uid and decision = 'promotion_blocked'
      and created_at > now() - interval '1 day' and reason like 'writer_pending:%') writer_pending_24h;

-- name: M10_stamps
-- (v4; v8) Channel stamps (24 h; expect 0 | 0 | 0 | 0 | false): every human decision from his own session; no agent
-- row; no owner day a job wrote; no owner statement without his decision; no service_role EXECUTE on decide_evidence.
select count(*) filter (where decided_by like 'human:%' and detail->>'api_role' is distinct from 'authenticated')
         human_not_owner_session,
       count(*) filter (where decided_by like 'agent:%') agent_rows,
       count(*) filter (where decided_by like 'check:owner%') job_owner_days,
       (select count(*) from evidence_links l where l.user_id = :uid and l.source_kind = 'owner_statement'
           and not exists (select 1 from evidence_decisions x where x.target_id = l.id and x.decided_by like 'human:%'))
         statements_without_him,
       has_function_privilege('service_role',
                              'public.decide_evidence(text,uuid[],text,text,text,text,uuid,jsonb,uuid,text,text,jsonb)',
                              'EXECUTE') svc_can_decide
  from evidence_decisions where user_id = :uid and created_at > now() - interval '1 day';

-- name: M10_step_up
-- (v5, v6) Every human decision came from a step-up session and carries the server-side step-up record (expect 0 | 0).
select count(*) filter (where decided_by like 'human:%' and detail->>'aal' is distinct from 'aal2') human_not_stepped_up,
       count(*) filter (where decided_by like 'human:%' and detail->'step_up' is null) human_without_step_up_record
  from evidence_decisions
 where user_id = :uid and decision in ('confirmed', 'rejected') and created_at > now() - interval '1 day';

-- name: M10_integrity
-- Guards fire ALWAYS (expect 27 | 27) and the guard and writer bodies match the deployed md5s (scoreboard.py compares
-- md5s against loop/deployed_md5s.json, written from the PR's post-deploy output). An end-state check: M10b is the one
-- that does not trust the database.
select (select count(*) filter (where tgenabled = 'A') from pg_trigger
         where tgname ~ '_(insert_guard|append_only|no_truncate)$' and not tgisinternal) always_on,
       (select count(*) from pg_trigger where tgname ~ '_(insert_guard|append_only|no_truncate)$' and not tgisinternal) total,
       (select jsonb_object_agg(p.proname, md5(p.prosrc)) from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.proname = any (public.evidence_writer_names()
                                || array['evidence_insert_guard', 'evidence_append_only_guard', 'evidence_caller_check'])) md5s;

-- name: M10_frameless
-- Frame-less callers: no public view or non-writer function names a writer (expect 0).
select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
          and not (p.proname = any (public.evidence_writer_names()))
          and p.proname not in ('evidence_writer_names', 'evidence_caller_check', 'promote_image', 'evidence_repin_after_merge')
          and p.prosrc ~ ('\m(' || array_to_string(public.evidence_writer_names(), '|') || ')\s*\('))
     + (select count(*) from pg_views where schemaname = 'public'
          and definition ~ ('\m(' || array_to_string(public.evidence_writer_names(), '|') || ')\s*\(')) frameless_callers;

-- name: M10b manifest
-- Rows created since :since in the nine tables; scoreboard.py matches the rows jobs wrote (x) against
-- loop/manifests/<date>.jsonl (the ids every writer call returned). (v8) His decisions (human:), the rejections his
-- confirm implies (implied:) and the rows his own decisions write (created_by 'human:%', counted in h) are matched by
-- the lead against the API request log.
select 'evidence_runs' t, coalesce(jsonb_agg(r.id), '[]') x, 0 h from evidence_runs r
 where r.user_id = :uid and r.started_at > :since
union all
select 'image_vehicle_candidates', coalesce(jsonb_agg(c.id) filter (where c.created_by not like 'human:%'), '[]'),
       count(*) filter (where c.created_by like 'human:%')
  from image_vehicle_candidates c where c.user_id = :uid and c.created_at > :since
union all
select 'image_capture_time_claims', coalesce(jsonb_agg(c.id) filter (where c.created_by not like 'human:%'), '[]'),
       count(*) filter (where c.created_by like 'human:%')
  from image_capture_time_claims c where c.user_id = :uid and c.created_at > :since
union all
select 'evidence_links', coalesce(jsonb_agg(l.id) filter (where l.created_by not like 'human:%'), '[]'),
       count(*) filter (where l.created_by like 'human:%')
  from evidence_links l where l.user_id = :uid and l.created_at > :since
union all
select 'evidence_account_entities', coalesce(jsonb_agg(a.id) filter (where a.created_by not like 'human:%'), '[]'),
       count(*) filter (where a.created_by like 'human:%')
  from evidence_account_entities a where a.user_id = :uid and a.created_at > :since
union all
select 'vehicle_change_claims', coalesce(jsonb_agg(k.id) filter (where k.created_by not like 'human:%'), '[]'),
       count(*) filter (where k.created_by like 'human:%')
  from vehicle_change_claims k where k.user_id = :uid and k.created_at > :since
union all
select 'user_day_vehicle_context', coalesce(jsonb_agg(u.id) filter (where u.created_by not like 'human:%'), '[]'),
       count(*) filter (where u.created_by like 'human:%')
  from user_day_vehicle_context u where u.user_id = :uid and u.created_at > :since
union all
select 'vehicle_change_claim_support', coalesce(jsonb_object_agg(s.claim_id, s.n) filter (where s.n > 0), '{}'),
       coalesce(sum(s.h), 0)
  from (select claim_id, count(*) filter (where created_by not like 'human:%') n,
               count(*) filter (where created_by like 'human:%') h
          from vehicle_change_claim_support where user_id = :uid and created_at > :since group by 1) s
union all
select 'evidence_decisions', coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'by', d.decided_by, 'decision', d.decision,
                                                                   'run', d.detail->>'run_id', 'image', d.result_image_id)), '[]'),
       0
  from evidence_decisions d where d.user_id = :uid and d.created_at > :since;

-- name: M10b_answers answers
-- (v6, AC10; v8: kept for every stored answer) The answers runs stored since :since, with his words, for
-- scoreboard.py to check against the chat transcript and the sheets index (delivery by sha256, reply after it, verbatim
-- words in the reply). The words stay in the scoreboard's memory; nothing but ids and verdicts is written.
select r.id, r.config->>'sheet_run' sheet_run, r.config->>'message_ref' message_ref, r.config->'rows' rows
  from evidence_runs r where r.user_id = :uid and r.run_kind = 'review_answers' and r.started_at > :since;

-- name: M11
-- Machine first filings per day by signal (orchestrator GPS re-arm; baseline 0 since 2026-10-20 08:50Z).
select created_at::date d, coalesce(substring(reason from 'signal=([a-z_:\-]+)'), '') sig, count(*) n
  from reattribution_audit where reason like 'first_attribution:%' and created_at > now() - interval '7 days'
   and reason not like '%evidence decision%' group by 1, 2 order by 1 desc;

-- name: M12_merged_ids
select id from vehicles where merged_into_vehicle_id is not null;

-- name: M12_claimed_vehicle_ids
select distinct io.vehicle_id from image_observations io
 where io.is_active and io.role = 'subject' and io.confidence >= 0.85 and io.vehicle_id is not null;

-- name: M12 ids
-- Images on merged vehicles with an active >= 0.85 claim pointing there (derive bug; baseline 183), per 50 ids.
select count(*) n from vehicle_images vi
 where vi.vehicle_id = any(:ids)
   and exists (select 1 from image_observations io where io.image_id = vi.id and io.is_active and io.role = 'subject'
                 and io.confidence >= 0.85 and io.vehicle_id = vi.vehicle_id);

-- name: M13
-- Promotion blocks by reason (24 h).
select reason, count(*) n from evidence_decisions
 where user_id = :uid and decision = 'promotion_blocked' and created_at > now() - interval '1 day'
 group by 1 order by 2 desc;

-- name: M13_open_proposals
-- Open merge proposals on his vehicles that do not block (no requires_approval_from).
select m.id, m.status, m.detected_by from vehicle_merge_proposals m
 where m.status in ('detected', 'proposed') and m.requires_approval_from is null
   and (m.primary_vehicle_id in (select public.evidence_fleet_vehicle_ids(:uid))
        or m.duplicate_vehicle_id in (select public.evidence_fleet_vehicle_ids(:uid)));

-- name: M14_accounts
-- (v6, RU4; v7, F7b) Per account: its newest coverage and whether it is closed, the word of the newest run covering it
-- (an open account behind the newest is asked about on the sheet: money_source_behind; an account his records name
-- that no run covers is money_source_missing, listed in the vehicle reads' open questions).
select a.acct, a.cover_to, n.closed
  from (select acct, max((r.config->>'coverage_to')::date) cover_to
          from evidence_runs r cross join lateral jsonb_array_elements_text(r.config->'covers_accounts') acct
         where r.user_id = :uid and r.config ? 'coverage_to' group by 1) a
  join (select distinct on (acct) acct, coalesce(r.config->'closed_accounts', '[]'::jsonb) @> to_jsonb(acct) closed
          from evidence_runs r cross join lateral jsonb_array_elements_text(r.config->'covers_accounts') acct
         where r.user_id = :uid and r.config ? 'coverage_to' order by acct, r.started_at desc, r.id desc) n using (acct)
 order by a.cover_to;

-- name: M14
-- Money freshness: the newest coverage per payment source and its age in days (OWNER-DECISIONS 8).
select r.pass, max((r.config->>'coverage_to')::date) cover_to, current_date - max((r.config->>'coverage_to')::date) days_old
  from evidence_runs r where r.user_id = :uid and r.config ? 'coverage_to' group by 1;

-- name: M15
-- (v8) His stored answers waiting for him in the app (evidence_answers_to_confirm: his words, the reading, the row as it
-- is now): targets he has not decided since he answered, and rows re-written with another meaning since (asked again);
-- and his own decisions so far. Until he has decided, the confirmed level reads "waiting on his app".
select count(*) filter (where last_decided_at is null or last_decided_at < stored_at) waiting,
       count(*) filter (where same_question is false) rewritten_ask_again,
       (select count(*) from evidence_decisions where user_id = :uid and decided_by like 'human:%'
           and decision in ('confirmed', 'rejected')) his_decisions
  from public.evidence_answers_to_confirm(:uid);
