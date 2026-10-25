-- Chunked apply for the sale-outcome sweep (the single-statement apply exceeded the 55s limit).
-- Apply a staged run (optionally one outcome kind, in chunks of p_limit). Same rules as apply_sale_outcome_from_pages_v1.
drop function if exists public.apply_sale_outcome_sweep_v1(text, boolean);
create or replace function public.apply_sale_outcome_sweep_v1(p_run text, p_dry boolean default true,
  p_kind public.sale_outcome_t default null, p_limit int default null)
returns jsonb language plpgsql as $$
declare n_typed int; n_obs int; n_conf int;
begin
  drop table if exists _so;
  create temp table _so as
  select e.id, e.event_status, e.final_price, s.platform, s.kind, s.amount, s.source_url url, s.quote, s.basis, s.snapshot_fetched_at
    from public.sale_outcome_sweep_stage_v1 s
    join public.vehicle_events e on e.id = s.event_id and e.source_url = s.source_url
    join public.vehicles v on v.id = e.vehicle_id
   where s.run_id = p_run and e.sale_outcome is null and (p_kind is null or s.kind = p_kind)
   order by s.event_id limit p_limit;
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

revoke execute on function public.apply_sale_outcome_sweep_v1(text, boolean, public.sale_outcome_t, int) from public, anon, authenticated;
