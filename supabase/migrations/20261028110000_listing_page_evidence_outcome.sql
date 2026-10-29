-- Cited page observations for BaT events with no stored inline page: end time, result banner
-- (Sold for / Bid to), gallery. Additive; existing values are never overwritten (fill-empty only).
-- Revert: supabase/rollbacks/20261028110000_listing_page_evidence_outcome_rollback.sql (retire-only).

alter table public.listing_page_photo_evidence
  add column if not exists outcome public.sale_outcome_t,
  add column if not exists outcome_amount numeric,
  add column if not exists outcome_quote text,
  add column if not exists fill_run_id text,
  add column if not exists filled_fields text[],
  add column if not exists filled_at timestamptz;

-- p_rows: [{eid, vid, url, code, end_ts, keys[], outcome, amount, quote}]
create or replace function public.ingest_listing_page_evidence_v1(p_rows jsonb, p_run text)
returns jsonb language plpgsql as $$
declare n_new int; n_fill int;
begin
  drop table if exists _r;
  create temp table _r on commit drop as
  select r.eid, r.vid, r.url, r.code, case when r.end_ts is not null then to_timestamp(r.end_ts) end end_at,
         coalesce(r.keys, '{}') keys, r.outcome::public.sale_outcome_t outcome, r.amount, r.quote
    from jsonb_to_recordset(p_rows) r(eid uuid, vid uuid, url text, code int, end_ts bigint, keys text[], outcome text, amount numeric, quote text);

  insert into public.listing_page_photo_evidence (auction_event_id, vehicle_id, listing_url, platform, http_status, page_fetched_at,
         page_end_at, photo_groups, gallery_keys, run_id, outcome, outcome_amount, outcome_quote)
  select eid, vid, url, 'bat', code, now(), end_at, '{}', keys, p_run, outcome, amount, quote from _r
  on conflict (auction_event_id) do nothing;
  get diagnostics n_new = row_count;

  update public.listing_page_photo_evidence e set
      page_end_at    = coalesce(e.page_end_at, r.end_at),
      gallery_keys   = case when coalesce(cardinality(e.gallery_keys), 0) = 0 then r.keys else e.gallery_keys end,
      outcome        = coalesce(e.outcome, r.outcome),
      outcome_amount = case when e.outcome is null then r.amount else e.outcome_amount end,
      outcome_quote  = case when e.outcome is null then r.quote else e.outcome_quote end,
      fill_run_id = p_run, filled_at = now(),
      filled_fields = array_remove(array[
        case when e.page_end_at is null and r.end_at is not null then 'page_end_at' end,
        case when coalesce(cardinality(e.gallery_keys), 0) = 0 and cardinality(r.keys) > 0 then 'gallery_keys' end,
        case when e.outcome is null and r.outcome is not null then 'outcome' end], null)
    from _r r
   where e.auction_event_id = r.eid and e.retired_at is null and e.run_id <> p_run and e.fill_run_id is null
     and ((e.page_end_at is null and r.end_at is not null)
       or (coalesce(cardinality(e.gallery_keys), 0) = 0 and cardinality(r.keys) > 0)
       or (e.outcome is null and r.outcome is not null));
  get diagnostics n_fill = row_count;
  return jsonb_build_object('inserted', n_new, 'filled', n_fill);
end $$;

-- Stage typed outcomes from page evidence for untyped BaT vehicle_events (applied with apply_sale_outcome_sweep_v1).
create or replace function public.stage_sale_outcome_from_page_evidence_v1(p_run text, p_evidence_run text)
returns jsonb language plpgsql as $$
declare n int;
begin
  insert into public.sale_outcome_sweep_stage_v1 (event_id, run_id, platform, source_url, snapshot_fetched_at, basis, kind, amount, quote)
  select ve.id, p_run, 'bat', ve.source_url, coalesce(p.filled_at, p.page_fetched_at), 'page_fetch', p.outcome, p.outcome_amount, p.outcome_quote
    from public.listing_page_photo_evidence p
    join public.auction_events a on a.id = p.auction_event_id
    join public.vehicle_events ve on ve.vehicle_id = a.vehicle_id and ve.source_platform = 'bat'
         and ve.source_url in (a.source_url, rtrim(a.source_url, '/'), rtrim(a.source_url, '/') || '/')
   where p.retired_at is null and p.outcome is not null and p.outcome_quote is not null and ve.sale_outcome is null
     and (p.run_id = p_evidence_run or p.fill_run_id = p_evidence_run)
  on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('staged', n);
end $$;

revoke all on function public.ingest_listing_page_evidence_v1(jsonb, text) from public, anon, authenticated;
revoke all on function public.stage_sale_outcome_from_page_evidence_v1(text, text) from public, anon, authenticated;
