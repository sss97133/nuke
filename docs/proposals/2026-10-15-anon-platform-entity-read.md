# Access memo: logged-out reads of the platform entity (2026-10-15)

**Status:** proposal, docs only. Nothing here is applied. It asks for an access decision, so it waits on the owner.
Written by the night run from read-only production reads on 2026-10-14 and 2026-10-15 (`scripts/data/q.sh`).
It follows the platform-entity memo (`2026-10-07-platform-entity.md`). That memo's declaration, migration
20261007233000, already says: "anon cannot read the table, so a public platform page (SC) needs a read policy
decision first."

**Recommendation:** let anonymous visitors read five descriptive columns of `observation_sources` (`id`, `slug`,
`display_name`, `category`, `base_url`) through a column grant plus a row policy. Keep the trust, rate-limit,
coverage and note columns signed-in only. This mints no new structure. The alternative is a definer reader; it is
described below.

## The need

A logged-out visitor cannot see where an observation came from.

- Row visibility, read 2026-10-15 00:48Z with `set local role <role>` inside one read-only statement:
  `anon` sees **0** of the `observation_sources` rows, `authenticated` sees **192**.
- Policies: the only read policy is `allow_authenticated_read_observation_sources` (SELECT, `authenticated`).
  `anon` holds the table-level SELECT grant, and RLS filters every row away.
- Readers that embed the table directly: `nuke_frontend/src/pages/vehicle-profile/ObservationPage.tsx` (line 128) and
  `DayPage.tsx` (line 125) select `observation_sources!left(display_name, slug)` and map them to `source_name` and
  `source_slug`; `TablePage.tsx` (line 113) reads `id, slug`. For a logged-out visitor those values are null, so the
  pages show observations without a named source. This is a code reading; a browser probe has not been run.
- Readers that are not affected: `get_field_provenance`, `get_vehicle_specs` and `valuation_by_ymm` are
  security-definer functions that join the table as their owner.

The platform keys repaired in #1251 (`source_registry.observation_source_id`, 21 platforms), #1253 (the resolver
fallback) and #1246 (the `facebook-marketplace` alias proposal) end at this table. Without a read path, none of
that resolution reaches a logged-out page, and acceptance criterion 4 of the platform-resolution work (an anonymous
reader showing a resolved source) cannot pass.

## The two options

### A. Column grant plus row policy (recommended)

```sql
REVOKE SELECT ON public.observation_sources FROM anon;
GRANT SELECT (id, slug, display_name, category, base_url) ON public.observation_sources TO anon;
CREATE POLICY anon_read_observation_sources_identity ON public.observation_sources
  FOR SELECT TO anon USING (true);
```

- Exposes the platform's identity: name, slug, category and home URL. These already appear in public listing URLs
  and on the platforms' own sites.
- Keeps these columns signed-in only: `base_trust_score`, `trust_factors`, `tier`, `veracity`, `consecration`,
  `decay_half_life_days`, `rate_limit_per_hour`, `requires_auth`, `url_patterns`, `notes`, `business_id` and the
  coverage columns.
- Effect on the readers: the two embeds and `TablePage` select only granted columns, so they start returning values.
  An anon `select *` would fail with a permission error instead of returning zero rows. One frontend reader does
  that: `ImagePage.tsx` (line 216, `.select('*').in('id', sourceIds)`). It handles the error by listing
  `observation_sources` in `unavailableRelations`, so the page would say the relation is unavailable instead of
  showing an empty list. Narrowing that select to the five columns in the same change would make it return values
  instead. Edge functions read
  the table with the service role and are not affected. The view-write guard (20261014214500) does not apply,
  because this is a table.

### B. A definer reader

A `security definer` function that returns the same five columns for a list of ids or slugs. It leaves table access
unchanged, but it is a new function: the two embeds would need rewriting to call it, and it should pass the
capability-map check first. Choose it only if the owner wants no anon grant on the table at all.

## What it would move

- `anon` visible rows: 0 → 192, five columns each.
- Logged-out `ObservationPage` and `DayPage` source names go from null to the platform's display name, for
  observations whose `source_id` is set.
- Acceptance check after the change: an anon REST request for one public vehicle's observations with the embed returns
  a non-null `display_name`, and the same request for a signed-in user is unchanged.

## Also seen

`get_market_trends` (20261015235000) reads the platform label from `v_market_trend_source_labels` by slug
`bringatrailer` and writes `'auction_event_source','bat'` as a literal. Once #1251 fills
`source_registry.observation_source_id`, that pairing can be read from the key instead of being hand-coded. This memo
does not change that reader; its lane owns it.

## Limits

- Row counts were read with an emulated role, not a real anon JWT. The policy is role-scoped, so request claims should
  not change the result.
- Whether any column of the five should stay private is the owner's call. This memo found nothing private in them.
- A browser render was not probed.
