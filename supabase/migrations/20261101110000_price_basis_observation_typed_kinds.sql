-- Typed price_basis_observation kinds (additive). Session runs on 2026-10-25 recorded
-- cross-vehicle duplicates, wrong attachments, index duplicates and price copies under the
-- generic 'pattern_resolution'; this adds explicit kinds so the defect type is in the schema.
-- The new check is a strict superset of the old one, so every existing row still passes.
-- prior_kind keeps the kind a row had before any relabel, so relabels are reversible.
-- Revert: update price_basis_observation set kind = prior_kind, prior_kind = null where prior_kind is not null;
--         then restore the old check and drop column prior_kind.
alter table public.price_basis_observation add column if not exists prior_kind text;
comment on column public.price_basis_observation.prior_kind is 'Kind before a relabel to a typed kind; null if never relabeled. Restore with kind = prior_kind.';
alter table public.price_basis_observation drop constraint if exists price_basis_observation_kind_check;
alter table public.price_basis_observation add constraint price_basis_observation_kind_check
  check (kind = any (array['observed_page','convention_conflict','observed_page_status','pattern_resolution',
                           'wrong_attachment','cross_vehicle_duplicate','index_duplicate','price_copy']::text[])) not valid;
alter table public.price_basis_observation validate constraint price_basis_observation_kind_check;
comment on column public.price_basis_observation.kind is 'observed_page: both figures read from the lot page | convention_conflict: stored price fits no convention (flag) | observed_page_status: the lot page shows the result status and one price | pattern_resolution: a cited rule that explains a convention_conflict (supersedes it) | wrong_attachment: event attached to the wrong vehicle (cited VIN evidence) | cross_vehicle_duplicate: same listing on another vehicle record | index_duplicate: duplicate of an index/backfill event on the same vehicle | price_copy: stored price copied from another event';
