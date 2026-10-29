-- additive: cited body_subtype on identity evidence (category stays coarse)
alter table public.vehicle_identity_evidence
  add column if not exists body_subtype text,
  add column if not exists body_subtype_cite text,
  add column if not exists body_subtype_rule text,
  add column if not exists body_subtype_run_id text;
alter table public.vehicle_identity_evidence
  add constraint vie_body_subtype_chk check (body_subtype is null or body_subtype in
  ('suv','crossover','pickup','van','cargo_van','minivan','panel_delivery','chassis_cab','medium_heavy_truck','semi_tractor','step_van','camper_van','motorhome','trailer')),
  add constraint vie_body_subtype_cited_chk check (body_subtype is null or (body_subtype_cite is not null and body_subtype_rule is not null));
comment on column public.vehicle_identity_evidence.body_subtype is 'Fine body type within coarse category; cited in body_subtype_cite (vPIC BodyClass or title words), rule in body_subtype_rule.';
