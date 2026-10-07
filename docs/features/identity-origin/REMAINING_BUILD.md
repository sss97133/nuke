# Identity-Origin / Market-Cartography — what's left to build

**As of 2026-10-07.** Read with `SPEC.md` and `../organization-entity/SPEC.md`.

## Confirmed finding (the one that reshapes everything)

**BaT publishes location only for sellers, never bidders.** Clean test, counts only:
of 457 identities with a location, **457/457 appear as a seller** on a lot (100%); **0** are pure
bidders (89 also won auctions = sellers who also buy). So:

- **Supply (seller) geography** is the real yield of the member-page / listing harvest.
- **Demand (bidder) geography** has **no native location on BaT** — it comes only from comments and from
  where a car actually ships/titles after a sale. The absence is itself the signal.

## The DB framework is DONE — no new data model to build

The projection framework is live and **source-agnostic**:

- `vehicle_observations.subject_type` admits `external_identity` (#736, live).
- `fold_external_identity_location()` (#739, live; service_role-only) projects **any** `external_identity`
  location observation — regardless of source — to `external_identities.metadata` (state/country only,
  masked). This PR makes it carry the observation's `structured_data.source` into
  `metadata.location_source` (was hardcoded `bat_member_page`), so seller-address and comment sources are
  labeled correctly.
- Member-page body capture (#753, live): `listing_page_snapshots`, RLS service-role/admin only.

So both demand and supply locations flow through the **same** fold. What remains is not a data model —
it is **two parsers/classifiers that turn captured evidence into those observations.**

## Remaining work = two parsers + org-stats (all need real data; currently guard-blocked)

### 1. Seller-address parser (supply) — blocked on reading real address structure
The captured member/listing body carries a seller `address`. Parse **state + country only** (masking,
drop city) and emit an `external_identity` observation with
`structured_data = {home_state, home_country, grain:'state_country', source:'bat_listing_address'}`.
The fold then projects it. **Blocked:** writing the parser correctly needs the real address structure,
and the PII guard blocks inspecting it (even masked, even from our own DB). Needs the owner to allow
reading member/listing address data from our DB (sanctioned per CLAUDE.md), or to paste one structure.

### 2. Comment → location classifier (demand) — blocked on comment reads + a model pass
~5–10k first-person tells ("I'm in [place]", "do you ship to [place]") among people who also bid
(comment-geo sizing). Pipeline: SQL prefilter (cheap) → **Jev/TypeSafe classify** `{place, whose:
commenter|car|dealer|other, confidence}` (regex alone can't tell "I'm in Portland" from "the car's in
Portland") → keep `whose=commenter` → `ingest-observation` with
`structured_data = {home_state, home_country, source:'bat_comment'}`. The fold then projects it, now
labeled `bat_comment`. **Blocked:** developing/validating it needs reading real comment text (PII guard)
and the Jev integration.

### 3. Org / seller-stats (pecking order) — needs investigation, not assumed
`compute_org_seller_stats` is **not a DB function** on prod (checked: 0 rows in `pg_proc`); the theory
card names it as an edge fn to "reactivate." Verify its live state before building. Sell-through /
price-vs-comps / geo are business metrics (not PII) → buildable once its current state is known.

## The single blocker for the owner

Everything above is specified; the two parsers can't be *correctly* implemented until the **PII guard is
tuned** to allow reading member-address and comment-location data from our own database (reading the DB
is already an agents-decide action in CLAUDE.md; the guard is false-positive-blocking it). Building the
parsers blind would risk fabricated locations — the one inviolable rule — so they wait for that, not for
more framework.
