-- Additive shadow table for image-derived condition/originality scores (pilot img-cond-rubric-v1). Not read by any live path.
create table if not exists public.shadow_image_condition_scores(
  id bigserial primary key,
  run_id uuid not null,
  vehicle_id uuid not null,
  auction_event_id uuid,
  rubric_version text not null,
  model text not null,
  condition_score numeric,            -- expected Hagerty-style rating, 1 (concours) .. 4 (fair)
  condition_dist jsonb,               -- mean class probabilities for #1..#4
  originality_score numeric,          -- P(unmodified factory original)
  confidence numeric,                 -- 0..1, see rubric aggregation
  n_images int,
  sec_per_car numeric,
  created_at timestamptz not null default now(),
  unique(run_id,vehicle_id)
);
comment on table public.shadow_image_condition_scores is 'Shadow-only image condition/originality scores; rubric in scripts/shadow/img_pilot/rubric_v1.json (cites Hagerty condition definitions). Additive; never feeds live estimates.';
