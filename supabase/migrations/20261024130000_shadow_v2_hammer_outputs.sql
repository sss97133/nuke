-- Additive: separate hammer/net vs gross outputs on shadow estimates; shadow-v2-hammer model.
alter table nuke_estimates_shadow
  add column if not exists price_basis text default 'hammer',
  add column if not exists shadow_net_to_owner numeric,
  add column if not exists shadow_gross numeric,
  add column if not exists shadow_gross_low numeric,
  add column if not exists shadow_gross_high numeric;
comment on column nuke_estimates_shadow.shadow_value is 'Hammer-basis estimate (comps all hammer-normalised; never mixed bases).';
comment on column nuke_estimates_shadow.shadow_gross is 'Buyer-paid: hammer + BaT buyer premium (5%, min 250, cap 7500; 5000 pre-2024-01-29).';
comment on column nuke_estimates_shadow.shadow_net_to_owner is 'Net to owner; = hammer until seller commission schedule lands.';
