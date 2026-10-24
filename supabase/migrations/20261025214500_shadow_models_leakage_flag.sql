-- Additive: first-class leakage marker on shadow model rows so leaky models are never promoted.
-- Revert: alter table public.shadow_valuation_models drop column leakage_note, drop column leakage_flag;
alter table public.shadow_valuation_models
  add column if not exists leakage_flag boolean not null default false,
  add column if not exists leakage_note text;
comment on column public.shadow_valuation_models.leakage_flag is
  'true = model uses inputs not available at the target sale time (e.g. live estimates computed after the sale); scores are not trustworthy, never promote';
update public.shadow_valuation_models
   set leakage_flag = true,
       leakage_note = 'Blends live nuke_estimates whose computed_at is after the sale date for 50,156/50,156 targets (not point-in-time). Held-out gains (0.2993 vs 0.3135 comp-only) are leaked. Do not promote. Leak-free sibling: shadow-v8-hier-recal.'
 where model_version = 'shadow-v8-route-blend';
