# Publishing / Financial Layer — Dev Handoff (for Skylar)

2026-07-17. State of the publishing + financial stack and the frontend build queue.
Privacy rule for this doc and all shared surfaces: **no client names, no amounts** —
schema and mechanics only. Deep specs (extraction spec, analyst brief, rulings)
live operator-side; ask Jenny.

## What is LIVE

**Prod pages** (all merged to main): `/publishing` dashboard → `PublicationProfile`
(series) → `IssueProfile` (per issue; resolves via `publication_issues`, with
publisher_slug + sibling fallbacks), `PersonProfile`, `PeopleDirectory`, and
`/publishing/finance` (`FinanceDashboard.tsx`).

**Data spine** (Supabase): `publication_issues` (27 issues, `issue_canon` bridge
key, per-issue email aggregates in `attributes.email_stats`), `editorial_stories`
(382), `flatplan_pages` (87), `ad_placements` (60), `nuke_production_credits`
(4.7k, issue-attributed) — all public-read. `person_identity_links` (34k, owner-
RLS, anon 401).

**Financial layer** (all owner-RLS'd, tier-private; anon and non-owner sessions
get zero rows — this is correct, not a bug):
- `financial_documents` / `financial_document_lines` / `financial_document_extractions`
  (append-only observation layer, immutability trigger) / `financial_payments` /
  `financial_payment_allocations` / `financial_document_links` / `financial_deals`
- `financial_review_queue` — typed accounting concerns (the révision worklist)
- `financial_deal_estimates` — inference layer (estimates NEVER mix with vouched
  amounts; supersession chains)
- Views: `v_financial_deal_flow` (canonical deal economics), `v_financial_deal_signals`,
  `v_financial_counterparty_baselines`, `v_documentary_coverage` (vouched vs
  inferred-no-piece — the blank-space monitor)
- Config: `financial_field_registry` (field→column state machine),
  `financial_operator_entities` (per-owner operator orgs)
- Full DDL history: operator-side `financial_layer.sql` (v1.0→v1.3, additive only)

## Doctrine you must not break

1. **Additive only.** No renames/drops. New shapes start in `attributes.staging`
   (JSONB) and get promoted by criteria — see `financial_field_registry`.
2. **Append-only evidence.** `financial_document_extractions` rejects in-place
   updates (trigger). Corrections = new row + supersession.
3. **Sensitive values never reach the cloud**: full OCR text and full IBANs are
   local-only on the operator machine; cloud has masked/hashed forms. Do not add
   code paths that upload them.
4. **Estimates ≠ facts.** `financial_deal_estimates` renders separately from
   vouched `v_financial_deal_flow` numbers, always labeled as estimates with
   confidence. Never sum them together.
5. **No empty shells** (frontend rules): widgets return null or one clear state
   line. `FinanceDashboard` shows "OPERATOR ACCESS REQUIRED" when RLS returns
   empty — keep that pattern.
6. Frontend style: `.claude/rules/frontend.md` (Arial/Courier, 8-9px caps labels,
   2px borders, zero radius/shadow).

## Build queue (priority order)

1. **Auth activation**: Supabase invite flow → real operator accounts →
   owner_id remap (placeholders `00000000-0000-4000-a000-00000000000{1,2}` →
   real `auth.uid()`) across publishing_* + financial_*. Role tiers in
   app_metadata: admin / curator / contributor. NOTE: anonymous sign-in is
   enabled on the project — never gate anything on bare `TO authenticated`.
2. **Révision queue screen** (`/publishing/finance/queue`): worklist over
   `financial_review_queue` — concern_type + priority sort, resolve/dismiss
   actions writing `resolved_by/resolution` (séparation des tâches: the resolver
   identity is part of the record). This same screen later receives contributor
   content submissions.
3. **Provenance popovers on FinanceDashboard**: click any value → its extraction
   rows (verbatim `value_raw`, confidence factors, extractor, supersession
   chain). Reuse `FieldEvidencePopup` / `FieldProvenanceDrawer` from
   vehicle-profile.
4. **Coverage view**: render `v_documentary_coverage` — vouched vs inferred —
   with estimates clearly badged (`~` prefix + confidence), and the blank-space
   list as an evidence-hunt queue.
5. **Issue-page finance strip** (admin-only): per-issue deal context from
   `financial_deals.issue_canon` joined to `publication_issues`.

## Gotchas

- `publications.slug` values can contain literal `#` — always URL-encode; prefer
  navigating by `publisher_slug` (IssueProfile has the fallbacks).
- `v_financial_deal_flow` NULLs money totals on mixed-currency deals
  (`mixed_currency=true`) — render the flag, don't coalesce to 0.
- Duplicates: rows with `duplicate_of` set are excluded from all aggregates —
  respect that in any new query.
- DB access for tooling: pooler password is stale; use PostgREST + the
  `exec_batch`/`execute_sql` RPCs (service role, server-side only — never ship
  service keys client-side; the frontend uses the anon key + RLS).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
