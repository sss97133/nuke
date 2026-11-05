-- The receipt fold over the API, and a sanctioned amount re-check.
--
-- 1. receipt_queue_resolve: one UPDATE on its own temp table had no WHERE clause. The API role (authenticator) preloads
--    pg-safeupdate, so every call that reached the fold through PostgREST (receipt_link_one -> receipt_queue_resolve) failed
--    with "UPDATE requires a WHERE clause". Measured 2026-11-05: land_document_pages (20261109110000) called over REST for
--    65 documents failed all 65 in their savepoints with that message; the same call over the pooler as postgres landed
--    all 65. Body otherwise identical to the live definition (20261027010000_receipt_queue_evidence.sql lineage).
-- 2. receipts_amount_recheck(p_receipt): re-runs receipt_amount_check_compute for one receipt and stores the result the way
--    the BEFORE trigger does (amount_check, amount_check_reasons, amount_checked_at). The check compares a receipt's total to
--    the vendor's range over the receipts that existed when it landed; a batch that lands a vendor's first receipts in
--    one run holds its larger invoices against a range built from two or three small ones (measured 2026-11-05: a $1,903.63
--    Classic Industries invoice held "above vendor range (max 147.20 over 3 receipts)" while 32 more of that vendor landed in
--    the same minute). The re-check runs the same rule again over the fuller population; it changes no amount and does not
--    decide links (the fold re-reads amount_check on its next pass through receipt_link_one). Service role only.
SET lock_timeout = '5s';
SET statement_timeout = '60s';
-- Replaces 20261109120000 (never applied: the first function statement lacked its terminator, so the deploy run of
-- 2026-11-05 17:49Z failed at parse time and applied nothing).

CREATE OR REPLACE FUNCTION public.receipt_queue_resolve(p_run text, p_receipt uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
declare res jsonb;
begin
  drop table if exists _q, _qc, _qe, _qd;
  create temp table _q on commit drop as
  select l.id link_id, l.receipt_id rid, l.hold_reason, l.page_date, l.basis_ref, r.user_id, r.vendor_name,
    lower(concat_ws(' ', r.vendor_name, r.raw_extraction #>> '{data,notes}',
      (select string_agg(coalesce(description,'')||' '||coalesce(category,''),' ') from receipt_items i where i.receipt_id=r.id),
      (select string_agg(coalesce(x->>'description',''),' ') from jsonb_array_elements(case when jsonb_typeof(r.raw_json#>'{data_v2,line_items}')='array' then r.raw_json#>'{data_v2,line_items}' else '[]' end) x),
      (select string_agg(coalesce(x->>'description',''),' ') from jsonb_array_elements(case when jsonb_typeof(r.raw_extraction#>'{data,line_items}')='array' then r.raw_extraction#>'{data,line_items}' else '[]' end) x))) txt,
    (select array_agg(distinct pn) from (
       select nullif(trim(part_number),'') pn from receipt_items i where i.receipt_id=r.id
       union select nullif(trim(x->>'part_number'),'') from jsonb_array_elements(case when jsonb_typeof(r.raw_json#>'{data_v2,line_items}')='array' then r.raw_json#>'{data_v2,line_items}' else '[]' end) x) p where pn is not null and length(pn)>=4) pns
  from receipt_vehicle_links l join receipts r on r.id=l.receipt_id
  where l.retired_at is null and l.status='held' and l.hold_reason in ('no_identifier','ambiguous_multiple_vehicles','legacy_link_uncorroborated')
    and (p_receipt is null or l.receipt_id=p_receipt);

  -- candidate vehicles: prior candidates if the row had any, otherwise every vehicle tied to the payer
  create temp table _qc on commit drop as
  with ties as (
    select distinct u.user_id, x.vid from (select distinct user_id from _q) u, lateral (
      select id vid from vehicles where owner_id=u.user_id union select id from vehicles where user_id=u.user_id
      union select id from vehicles where uploaded_by=u.user_id
      union select vehicle_id from ownership_verifications where user_id=u.user_id and status in ('approved','expired')
      union select vehicle_id from vehicle_user_permissions where user_id=u.user_id and is_active
      union select vehicle_id from user_vehicle_links where user_id=u.user_id and link_type='owner'
      union select vehicle_id from vehicle_user_relationships where user_id=u.user_id) x where x.vid is not null
  ), prior as (
    select q.rid, (c->>'vehicle')::uuid vid from _q q, jsonb_array_elements(case when jsonb_typeof(q.basis_ref->'candidates')='array' then q.basis_ref->'candidates' else '[]' end) c
    where c->>'vehicle' is not null and c->>'tie' is not null and coalesce(c->>'type_gate','') <> 'fail'
  )
  select q.rid, t.vid from _q q join ties t on t.user_id=q.user_id
    join vehicles v on v.id=t.vid and v.deleted_at is null and v.status is distinct from 'merged'
  where not exists (select 1 from prior p where p.rid=q.rid) or exists (select 1 from prior p where p.rid=q.rid and p.vid=t.vid);
  alter table _q add column sig jsonb;
  update _q q set sig = receipt_type_signals(r) from receipts r where r.id=q.rid;
  delete from _qc c using _q q, vehicles v where q.rid=c.rid and v.id=c.vid and receipt_type_gate_sv(q.sig, v)='fail';

  -- evidence rows per (receipt, vehicle)
  create temp table _qe (rid uuid, vid uuid, kind text, ref jsonb) on commit drop;
  -- vendor specialty
  insert into _qe
  select c.rid, c.vid, 'vendor_specialty', jsonb_build_object('vendor_slug',s.vendor_slug,'citation_url',s.citation_url,'quote',s.citation_quote,'fetched_at',s.fetched_at)
  from _qc c join _q q on q.rid=c.rid join vehicles v on v.id=c.vid
  join receipt_vendor_specialties s on q.vendor_name ~* s.vendor_pattern
  where (s.make is null or lower(v.make)=lower(s.make) or (lower(s.make) in ('chevrolet','gmc') and lower(v.make) in ('chevrolet','gmc')))
    and (s.model_pattern is null or lower(coalesce(v.model,'')) ~ s.model_pattern)
    and (s.year_min is null or v.year >= s.year_min) and (s.year_max is null or v.year <= s.year_max)
    and (s.vehicle_class is null or receipt_vehicle_class(v)=s.vehicle_class);
  -- part fitment (catalog part number with fitment)
  insert into _qe
  select c.rid, c.vid, 'part_fitment', jsonb_build_object('part_number',cp.part_number,'catalog_part',cp.id,'fits_models',cp.fits_models,'years',concat(cp.year_start,'-',cp.year_end))
  from _qc c join _q q on q.rid=c.rid join vehicles v on v.id=c.vid
  join catalog_parts cp on cp.part_number = any(q.pns)
  where cp.fits_models is not null and cp.fits_models::text ~* split_part(coalesce(v.model,'~~'),' ',1)
    and (cp.year_start is null or v.year >= cp.year_start) and (cp.year_end is null or v.year <= cp.year_end);
  -- chronology: work session / image work extraction on the vehicle within 3 days of the page date showing the same work category
  alter table _q add column cats text[];
  update _q set cats = receipt_work_cats(txt) where true;   -- pg-safeupdate (authenticator) refuses an UPDATE without WHERE
  insert into _qe
  with ev as materialized (
    select w.vehicle_id vid, w.session_date d, jsonb_build_object('work_session',w.id,'session_date',w.session_date) ref,
      receipt_work_cats(concat_ws(' ',w.title,w.work_description,w.work_type,w.zones_touched::text,w.stages_observed::text)) cats
    from work_sessions w where w.vehicle_id in (select distinct vid from _qc) and w.session_date is not null
    union all
    select e.vehicle_id, coalesce(e.detected_date::date,i.taken_at::date), jsonb_build_object('image_work_extraction',e.id,'image',e.image_id,'image_date',coalesce(e.detected_date::date,i.taken_at::date)),
      receipt_work_cats(concat_ws(' ',e.detected_work_type,e.detected_work_description,e.detected_components::text))
    from image_work_extractions e left join vehicle_images i on i.id=e.image_id where e.vehicle_id in (select distinct vid from _qc)
  )
  select c.rid, c.vid, 'chronology_session', ev.ref || jsonb_build_object('days_from_receipt', ev.d-q.page_date,
      'shared_work',(select to_jsonb(array_agg(x)) from unnest(q.cats) x where x = any(ev.cats)))
  from _qc c join _q q on q.rid=c.rid join ev on ev.vid=c.vid
  where q.page_date is not null and ev.d between q.page_date-3 and q.page_date+3 and q.cats && ev.cats and cardinality(q.cats)>0;

  -- decision: narrow by each evidence kind present for the receipt (intersection); link only if exactly one vehicle remains
  create temp table _qd on commit drop as
  with kinds as (select rid, array_agg(distinct kind) ks from _qe group by rid),
  surv as (
    select c.rid, c.vid from _qc c join kinds k on k.rid=c.rid
    where (select bool_and(exists (select 1 from _qe e where e.rid=c.rid and e.vid=c.vid and e.kind=kk)) from unnest(k.ks) kk)
  ),
  n as (select rid, count(*) n, min(vid::text)::uuid vid from surv group by rid)
  select q.link_id, q.rid, q.hold_reason old_reason, k.ks, coalesce(n.n,0) n, n.vid,
    (select count(distinct vid) from _qc c where c.rid=q.rid) ncand
  from _q q left join kinds k on k.rid=q.rid left join n on n.rid=q.rid;

  update receipt_vehicle_links l set retired_at=now() from _qd d where l.id=d.link_id and (d.ks is not null);
  insert into receipt_vehicle_links(receipt_id, vehicle_id, status, basis, basis_ref, confidence, hold_reason, run_id)
  select d.rid, case when d.n=1 then d.vid end, case when d.n=1 then 'linked' else 'held' end,
    case when d.n=1 then case when 'part_fitment'=any(d.ks) then 'part_fitment' when 'vendor_specialty'=any(d.ks) then 'vendor_specialty' else 'chronology_session' end end,
    jsonb_build_object('pass','queue_evidence','provisional',true,'prior_hold',d.old_reason,'candidates_considered',d.ncand,'survivors',d.n,
      'evidence',(select jsonb_agg(jsonb_build_object('vehicle',e.vid,'kind',e.kind,'ref',e.ref)) from _qe e where e.rid=d.rid and (d.n<>1 or e.vid=d.vid))),
    case when d.n=1 then round(least(0.9,
        (case when 'part_fitment'=any(d.ks) then 0.8 when 'vendor_specialty'=any(d.ks) then 0.7 else 0.6 end + 0.1*(array_length(d.ks,1)-1))
        * receipt_tie_weight(receipt_user_vehicle_tie(r.user_id, d.vid)))::numeric,3) end,
    case when d.n=1 then null when d.n=0 then 'evidence_no_single_vehicle' else 'evidence_multiple_vehicles' end, p_run
  from _qd d join receipts r on r.id=d.rid where d.ks is not null;

  select jsonb_build_object('queue',(select count(*) from _q),'no_evidence',(select count(*) from _qd where ks is null),
    'result',(select jsonb_object_agg(k,c) from (select status||':'||coalesce(basis,hold_reason) k, count(*) c from receipt_vehicle_links where run_id=p_run and retired_at is null group by 1) z)) into res;
  return res;
end $function$;

CREATE OR REPLACE FUNCTION public.receipts_amount_recheck(p_receipt uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE r public.receipts; c record; v_before text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'receipts_amount_recheck: service admission required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM public.receipts WHERE id = p_receipt;
  IF r.id IS NULL THEN RAISE EXCEPTION 'receipts_amount_recheck: receipt % not found', p_receipt; END IF;
  v_before := r.amount_check::text;
  SELECT * INTO c FROM public.receipt_amount_check_compute(r);
  UPDATE public.receipts
     SET amount_check = c.status, amount_check_reasons = c.reasons, amount_checked_at = now(),
         amount_check_run_id = 'recheck_' || to_char(now(), 'YYYYMMDD')
   WHERE id = p_receipt;
  RETURN jsonb_build_object('receipt_id', p_receipt, 'before', v_before, 'after', c.status::text, 'reasons', c.reasons);
END $$;
REVOKE ALL ON FUNCTION public.receipts_amount_recheck(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipts_amount_recheck(uuid) TO service_role;
COMMENT ON FUNCTION public.receipts_amount_recheck(uuid) IS
  'Re-run the plausibility check of one receipt''s total against its vendor''s current range (receipt_amount_check_compute) and store the result as the trigger would. Service role only. Changes no amount; links are re-read by the fold on its next receipt_link_one pass.';
