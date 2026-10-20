-- Image-evidence scoreboard (PLAN section 6; DESIGN-v5 section 11). Read-only; run by scoreboard.py through q.sh.
-- Parameters: :uid (the owner, from --user; never written into the repo), :vehicle_id (the exit-test vehicle),
-- :chunk_from / :chunk_to (taken_at chunks; idx_vehicle_images_user_taken_at), :ids (a uuid list), :window_from /
-- :window_to (the capture window), :since (the M10b window start). Each statement follows a "-- name: <measure>"
-- line; "chunked" statements run once per chunk and are summed by scoreboard.py, "manifest" rows are matched against
-- the runner's manifest of returned ids (M10b), and M10_integrity's bodies against the deployed md5s.

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
  from (select public.evidence_status('image_candidate', c.id) st from image_vehicle_candidates c
         where c.user_id = :uid and c.pass = 'audit_sample' and c.superseded_by is null) s;

-- name: M3
-- Candidates by pass and reader status.
select pass, status, count(*) n, count(distinct image_id) images, round(avg(confidence), 3) avg_conf
  from v_image_candidates_current where user_id = :uid group by 1, 2 order by 1, 2;

-- name: M4
-- Precision per pass against the owner's confirmed vehicle for each image: human channel only (RV2-2).
with truth as (
  select c.image_id, c.vehicle_id v from image_vehicle_candidates c
    join v_evidence_status s on s.target_kind = 'image_candidate' and s.target_id = c.id
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
-- The same on the agent channel, reported apart; never a gate until 20 agent decisions are re-confirmed in the app.
with truth as (
  select c.image_id, c.vehicle_id v from image_vehicle_candidates c
    join v_evidence_status s on s.target_kind = 'image_candidate' and s.target_id = c.id
   where c.user_id = :uid and s.status = 'confirmed' and s.channel = 'agent' and c.frame_role = 'subject'),
top as (
  select distinct on (c.image_id, c.pass) c.image_id, c.pass, c.vehicle_id, c.verdict from image_vehicle_candidates c
   where c.user_id = :uid and c.superseded_by is null and c.frame_role = 'subject'
     and c.pass not in ('owner_review', 'audit_sample', 'claim_import')
   order by c.image_id, c.pass, c.confidence desc)
select t.pass, count(*) decided,
       count(*) filter (where t.vehicle_id = tr.v and t.verdict in ('is_vehicle', 'listing_evidence')) correct
  from top t join truth tr using (image_id) group by 1 order by 1;

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
-- Channel stamps and answer binding (24 h; expect 0 each): every human decision from his own aal2 session, every agent
-- decision from a job session, bound to its sheet row and to his stored answer (v4, v5).
select count(*) filter (where decided_by like 'human:%' and detail->>'api_role' is distinct from 'authenticated')
         human_not_owner_session,
       count(*) filter (where decided_by like 'agent:%' and detail->>'api_role' is distinct from 'service_role')
         agent_not_job_session,
       count(*) filter (where decided_by like 'agent:%' and detail->>'row_targets_checked' is distinct from 'true')
         agent_unbound,
       count(*) filter (where decided_by like 'human:%' and detail->>'aal' is distinct from 'aal2') human_not_stepped_up,
       count(*) filter (where decided_by like 'agent:%' and detail->>'answer_bound' is distinct from 'true') agent_not_bound
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
-- Rows created since :since in the nine tables; scoreboard.py matches them against loop/manifests/<date>.jsonl (the ids
-- every writer call returned). Owner decisions (human:) are matched by the lead against the API request log.
select 'evidence_runs' t, coalesce(jsonb_agg(r.id), '[]') x from evidence_runs r
 where r.user_id = :uid and r.started_at > :since
union all
select 'image_vehicle_candidates', coalesce(jsonb_agg(c.id), '[]') from image_vehicle_candidates c
 where c.user_id = :uid and c.created_at > :since
union all
select 'image_capture_time_claims', coalesce(jsonb_agg(c.id), '[]') from image_capture_time_claims c
 where c.user_id = :uid and c.created_at > :since
union all
select 'evidence_links', coalesce(jsonb_agg(l.id), '[]') from evidence_links l
 where l.user_id = :uid and l.created_at > :since
union all
select 'evidence_account_entities', coalesce(jsonb_agg(a.id), '[]') from evidence_account_entities a
 where a.user_id = :uid and a.created_at > :since
union all
select 'vehicle_change_claims', coalesce(jsonb_agg(k.id), '[]') from vehicle_change_claims k
 where k.user_id = :uid and k.created_at > :since
union all
select 'user_day_vehicle_context', coalesce(jsonb_agg(u.id), '[]') from user_day_vehicle_context u
 where u.user_id = :uid and u.created_at > :since
union all
select 'vehicle_change_claim_support', coalesce(jsonb_object_agg(s.claim_id, s.n), '{}')
  from (select claim_id, count(*) n from vehicle_change_claim_support
         where user_id = :uid and created_at > :since group by 1) s
union all
select 'evidence_decisions', coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'by', d.decided_by, 'decision', d.decision,
                                                                   'run', d.detail->>'run_id', 'image', d.result_image_id)), '[]')
  from evidence_decisions d where d.user_id = :uid and d.created_at > :since;

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

-- name: M14
-- Money freshness: the newest coverage per payment source and its age in days (OWNER-DECISIONS 8).
select r.pass, max((r.config->>'coverage_to')::date) cover_to, current_date - max((r.config->>'coverage_to')::date) days_old
  from evidence_runs r where r.user_id = :uid and r.config ? 'coverage_to' group by 1;
