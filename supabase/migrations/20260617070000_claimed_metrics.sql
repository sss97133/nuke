-- claimed_metrics — Criterion 7 of the Worth Engine calibration spec (2026-05-23):
-- the user-correction path. The Worth Engine infers a value; the OWNER can dispute it. Both
-- persist side by side, the delta surfaces, the system does not police (it records). This is
-- the human signature the $410 / valuation doctrine requires — agentic confidence is the
-- product, but the owner signs the number that disputes it. Schema is verbatim from the spec.
create table if not exists claimed_metrics (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid,
  vehicle_id      uuid references vehicles(id),
  metric          text not null default 'vehicle_value',  -- vehicle_value | labor_hours | labor_rate
  period_start    date,
  period_end      date,
  claimed_value   numeric not null,
  claimed_currency text default 'USD',
  claim_basis     text,                                    -- the owner's reasoning (free text)
  observed_at     timestamptz default now(),
  created_at      timestamptz default now(),
  superseded_by   uuid references claimed_metrics(id)      -- supersede, never overwrite (testimony invariant)
);
comment on table claimed_metrics is
  'Owner disputes of Worth Engine inferred values (calibration-spec C7). Claimed + inferred persist side by side; the delta is the worth-proof headline. Superseded, never overwritten.';

create index if not exists idx_claimed_metrics_vehicle on claimed_metrics(vehicle_id, observed_at desc) where superseded_by is null;

-- submit_claimed_metric — the write path (the UI form / API calls this). Supersedes a prior
-- active claim for the same (vehicle, metric, period) rather than overwriting it.
create or replace function submit_claimed_metric(
  p_user_id uuid, p_vehicle_id uuid, p_claimed_value numeric,
  p_metric text default 'vehicle_value', p_period_start date default null,
  p_period_end date default null, p_claim_basis text default null, p_currency text default 'USD'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_claimed_value is null or p_claimed_value < 0 then
    raise exception 'claimed_value must be a non-negative number';
  end if;
  insert into claimed_metrics(user_id, vehicle_id, metric, period_start, period_end, claimed_value, claimed_currency, claim_basis)
  values (p_user_id, p_vehicle_id, p_metric, p_period_start, p_period_end, p_claimed_value, p_currency, p_claim_basis)
  returning id into v_id;
  -- supersede any prior active claim for the same (vehicle, metric, period)
  update claimed_metrics c set superseded_by = v_id
  where c.vehicle_id = p_vehicle_id and c.metric = p_metric and c.id <> v_id
    and c.superseded_by is null
    and c.period_start is not distinct from p_period_start
    and c.period_end is not distinct from p_period_end;
  return v_id;
end $$;

-- get_claimed_vs_inferred — the delta the worth-proof surface renders (C7: "surfaces the delta").
create or replace function get_claimed_vs_inferred(p_vehicle_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'vehicle_id', p_vehicle_id,
    'claimed', (select jsonb_build_object('value', cm.claimed_value, 'currency', cm.claimed_currency,
                  'basis', cm.claim_basis, 'observed_at', cm.observed_at)
                from claimed_metrics cm
                where cm.vehicle_id = p_vehicle_id and cm.metric = 'vehicle_value' and cm.superseded_by is null
                order by cm.observed_at desc limit 1),
    'inferred', (vehicle_full_picture(p_vehicle_id)->'inferred_value'),
    'inferred_confidence', jsonb_build_object(
        'existence', vehicle_full_picture(p_vehicle_id)->'existence_confidence',
        'magnitude', vehicle_full_picture(p_vehicle_id)->'magnitude_confidence')
  );
$$;

grant execute on function submit_claimed_metric(uuid,uuid,numeric,text,date,date,text,text) to anon, authenticated, service_role;
grant execute on function get_claimed_vs_inferred(uuid) to anon, authenticated, service_role;
grant select, insert on claimed_metrics to authenticated, service_role;
