-- Sweep stored-sold events for "Bid to" / Reserve Not Met using stored page snapshots
-- (BaT result banner; Cars & Bids system result lines) and extraction fields
-- (BaT metadata.reserve_status = reserve_not_met; Bonhams metadata.bonhams_status = BI, bought in).
-- Additive: stage table, typed outcome only where none exists, observation + final_price flag on conflicts,
-- nothing stored is overwritten. Revert: select public.revert_sale_outcome_sweep_v1('<run>');

create table if not exists public.sale_outcome_sweep_stage_v1 (
  event_id uuid not null,
  run_id text not null,
  platform text,
  source_url text not null,
  snapshot_id uuid,
  snapshot_fetched_at timestamptz,
  basis text not null,               -- 'page_banner' | 'page_system_line' | 'extraction_field'
  kind public.sale_outcome_t not null,
  amount numeric,
  quote text not null,
  staged_at timestamptz not null default now(),
  primary key (event_id, run_id)
);
alter table public.sale_outcome_sweep_stage_v1 enable row level security;
revoke all on public.sale_outcome_sweep_stage_v1 from anon, authenticated;

-- Stage one slice of stored-sold, untyped events (ordered by id after p_after). Returns the last id seen.
create or replace function public.stage_sale_outcome_from_snapshots_v1(p_run text, p_platform text, p_after uuid, p_limit int)
returns jsonb language plpgsql as $$
declare v_last uuid; n_seen int; n_staged int;
begin
  drop table if exists _ev;
  create temp table _ev as
    select e.id, e.source_url from public.vehicle_events e
     where e.source_platform = p_platform and e.event_status = 'sold' and e.sale_outcome is null
       and e.source_url is not null and e.id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
     order by e.id limit p_limit;
  select max(id::text)::uuid, count(*) into v_last, n_seen from _ev;
  insert into public.sale_outcome_sweep_stage_v1 (event_id, run_id, platform, source_url, snapshot_id, snapshot_fetched_at, basis, kind, amount, quote)
  select ev.id, p_run, p_platform, ev.source_url, s.id, s.fetched_at, r.basis, r.kind, r.amount, r.quote
    from _ev ev
    join lateral (select x.id, x.fetched_at, x.html from public.listing_page_snapshots x
                   where x.listing_url in (ev.source_url, rtrim(ev.source_url, '/'), rtrim(ev.source_url, '/') || '/')
                     and x.success and x.html is not null order by x.fetched_at desc limit 1) s on true
    join lateral (
      select 'page_banner' basis,
             case when lower(m[1]) = 'sold for' then 'sold' else 'bid_to' end::public.sale_outcome_t kind,
             replace(m[2], ',', '')::numeric amount, m[1] || ' USD $' || m[2] quote
        from regexp_match(s.html, '(Sold for|Bid to)\s*<strong>\s*(?:USD\s*)?\$([0-9,]+)\s*</strong>', 'i') m
       where p_platform = 'bat' and m is not null
      union all
      select 'page_system_line',
             case when sl is not null then 'sold' else 'bid_to' end::public.sale_outcome_t,
             replace(coalesce(sl[2], rn[1]), ',', '')::numeric,
             coalesce('Sold' || sl[1] || '$' || sl[2], 'Reserve not met, bid to $' || rn[1])
        from regexp_match(s.html, '"type":5,"text":"Sold( After for | to [^"]{1,60}? for )\$([0-9,]+)') sl,
             regexp_match(s.html, '"type":5,"text":"Reserve not met, bid to \$([0-9,]+)') rn
       where p_platform = 'cars_and_bids' and (sl is not null or rn is not null)
    ) r on true
  on conflict do nothing;
  get diagnostics n_staged = row_count;
  return jsonb_build_object('seen', n_seen, 'staged', n_staged, 'last', v_last);
end $$;

-- Extraction-field outcomes (no page fetch): BaT reserve_not_met, Bonhams BI (bought in).
create or replace function public.stage_sale_outcome_from_fields_v1(p_run text)
returns jsonb language plpgsql as $$
declare n int;
begin
  insert into public.sale_outcome_sweep_stage_v1 (event_id, run_id, platform, source_url, basis, kind, amount, quote)
  select e.id, p_run, e.source_platform, e.source_url, 'extraction_field',
         case when e.source_platform = 'bonhams' then 'no_sale' else 'bid_to' end::public.sale_outcome_t,
         null,
         case when e.source_platform = 'bonhams' then 'metadata.bonhams_status = BI (bought in)'
              else 'metadata.reserve_status = reserve_not_met' end
    from public.vehicle_events e
   where e.event_status = 'sold' and e.sale_outcome is null and e.source_url is not null
     and ((e.source_platform = 'bat' and e.metadata->>'reserve_status' = 'reserve_not_met')
       or (e.source_platform = 'bonhams' and e.metadata->>'bonhams_status' = 'BI'))
  on conflict do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('staged', n);
end $$;

-- Apply a staged run. Same rules as apply_sale_outcome_from_pages_v1.
create or replace function public.apply_sale_outcome_sweep_v1(p_run text, p_dry boolean default true)
returns jsonb language plpgsql as $$
declare n_typed int; n_obs int; n_conf int;
begin
  drop table if exists _so;
  create temp table _so as
  select e.id, e.event_status, e.final_price, s.platform, s.kind, s.amount, s.source_url url, s.quote, s.basis, s.snapshot_fetched_at
    from public.sale_outcome_sweep_stage_v1 s
    join public.vehicle_events e on e.id = s.event_id and e.source_url = s.source_url
    join public.vehicles v on v.id = e.vehicle_id
   where s.run_id = p_run and e.sale_outcome is null;
  if p_dry then
    return jsonb_build_object('dry', true, 'rows', (select count(*) from _so),
      'by', (select jsonb_object_agg(k, n) from (select platform || ':' || basis || ':' || kind k, count(*) n from _so group by 1) x),
      'conflict_with_sold', (select count(*) from _so where event_status = 'sold' and kind <> 'sold'),
      'sold_price_differs', (select count(*) from _so where kind = 'sold' and amount is distinct from final_price));
  end if;
  insert into public.bak_sale_outcome_v1 (event_id, run_id, prior_source_suspect, prior_source_suspect_at, prior_sale_outcome, prior_sale_outcome_source_url,
         prior_sale_outcome_evidence, prior_sale_outcome_run_id, prior_sale_outcome_observed_at, prior_high_bid)
  select e.id, p_run, e.source_suspect, e.source_suspect_at, e.sale_outcome, e.sale_outcome_source_url, e.sale_outcome_evidence,
         e.sale_outcome_run_id, e.sale_outcome_observed_at, e.high_bid
    from public.vehicle_events e join _so s on s.id = e.id
  on conflict do nothing;
  update public.vehicle_events e set
      sale_outcome = s.kind,
      sale_outcome_source_url = s.url,
      sale_outcome_evidence = case s.basis when 'extraction_field' then 'Extraction field: ' else 'Stored page snapshot: ' end
                              || s.quote || coalesce(' (snapshot ' || s.snapshot_fetched_at::date || ')', ''),
      sale_outcome_run_id = p_run,
      sale_outcome_observed_at = now(),
      high_bid = case when s.kind <> 'sold' and e.high_bid is null then s.amount else e.high_bid end,
      source_suspect = case when s.kind <> 'sold' and e.event_status = 'sold' and not coalesce('final_price' = any(e.source_suspect), false)
                            then array_append(coalesce(e.source_suspect, '{}'), 'final_price') else e.source_suspect end,
      source_suspect_at = case when s.kind <> 'sold' and e.event_status = 'sold' then coalesce(e.source_suspect_at, now()) else e.source_suspect_at end
    from _so s where s.id = e.id and e.sale_outcome is null;
  get diagnostics n_typed = row_count;
  insert into public.price_basis_observation (tbl, event_id, kind, stored_price, observed_status, observed_price, observed_on, source_url, evidence, rule, run_id)
  select 'vehicle_events', s.id, 'observed_page_status', coalesce(s.final_price, 0), 'unsold', s.amount, s.snapshot_fetched_at::date, s.url,
         s.platform || ' ' || s.basis || ' says ' || s.quote || ' (no sale); stored event_status ' || coalesce(s.event_status, 'null')
           || ', final_price ' || coalesce(s.final_price::text, 'null') || ' kept; final_price flagged suspect',
         'sale_outcome_sweep_v1', p_run
    from _so s where s.kind <> 'sold' and s.event_status = 'sold'
  on conflict (tbl, event_id, rule) do nothing;
  get diagnostics n_obs = row_count;
  select count(*) into n_conf from _so where event_status = 'sold' and kind <> 'sold';
  return jsonb_build_object('dry', false, 'typed', n_typed, 'conflicts', n_conf, 'observations', n_obs);
end $$;

create or replace function public.revert_sale_outcome_sweep_v1(p_run text)
returns jsonb language plpgsql as $$
declare n int; m int;
begin
  update public.vehicle_events e set
      source_suspect = b.prior_source_suspect, source_suspect_at = b.prior_source_suspect_at, sale_outcome = b.prior_sale_outcome,
      sale_outcome_source_url = b.prior_sale_outcome_source_url, sale_outcome_evidence = b.prior_sale_outcome_evidence,
      sale_outcome_run_id = b.prior_sale_outcome_run_id, sale_outcome_observed_at = b.prior_sale_outcome_observed_at,
      high_bid = b.prior_high_bid
    from public.bak_sale_outcome_v1 b where b.event_id = e.id and b.run_id = p_run;
  get diagnostics n = row_count;
  update public.price_basis_observation set superseded_at = now()
   where run_id = p_run and rule = 'sale_outcome_sweep_v1' and superseded_at is null;
  get diagnostics m = row_count;
  return jsonb_build_object('restored', n, 'observations_superseded', m);
end $$;

revoke execute on function public.stage_sale_outcome_from_snapshots_v1(text, text, uuid, int), public.stage_sale_outcome_from_fields_v1(text),
  public.apply_sale_outcome_sweep_v1(text, boolean), public.revert_sale_outcome_sweep_v1(text) from public, anon, authenticated;
