# L'Officiel Concierge × nuke — session handoff

_Last updated: 2026-07-03. Branch: `claude/lofficiel-concierge-nuke-db-pmztl3`.
Open draft: PR #327. Supabase project: `qkgaybvrernstplzjaam`._

Read this first to resume. It captures the thesis, what's verified, what shipped,
the open decisions, the blockers, and the ordered build queue. Epistemics matter
here (see `.claude/rules/production-engineering.md`): claims below are tagged
**[verified]** (checked against live prod/repo) or **[hypothesis]** (reasoned, not
yet confirmed).

---

## 1. The thesis

**nuke is the backend every facade runs on.** Brands (L'Officiel Concierge first)
get their "own app" — a branded front end — but the app *is* the backend, and nuke
owns 100% of it. This is deliberate and it's the moat: a tenant can wear the bones,
never take them. ("Performer, not owner." L'Officiel proudly wears our bones; we're
happy it does.)

Three products, one engine:
1. **White-label facades.** Everyone wants their own app. Each is another skin on the
   same engine; none can leave. Front-end autonomy + backend fully owned.
2. **Content supply chain.** The provenance engine organizes all data to its sources
   into structured, *cited* libraries. Producers (and agents they deploy) pipeline
   through nuke to harvest citable content without the manual work of
   sourcing/verifying/attributing — and they contribute back in the same motion
   (bidirectional flywheel). Their formula beats "steal viral & repost" because it's
   sourced, authentic, and — with a rights layer — safe to run autonomously at scale.
3. **Concierge content agent.** Principals (Philippe) brief an agent, not an intern;
   the agent holds every client's catalog, drafts in their voice, coordinates the
   schedule, publishes via Meta, and learns from engagement. His creative direction is
   captured so it compounds instead of evaporating.

Everything is the same organs pointed at new nouns: the vehicle stack (7.5M
observations) is the reference implementation, not the center of gravity.

---

## 2. What shipped (PR #327, draft, all CI green)

On branch `claude/lofficiel-concierge-nuke-db-pmztl3`:
- `supabase/migrations/20260703120000_capture_concierge_partner_pipe_drift.sql` —
  drift capture of `concierge_partner_connections/_invitations/_sync_runs` +
  `asset_observations` (existed in prod, uncommitted). `IF NOT EXISTS`-guarded,
  RLS-enabled/no-policies preserved. **No prod change.**
- `supabase/migrations/20260703140000_creative_briefs.sql` — brief-capture table
  (verbatim + structured, principal-authored = high confidence, org/asset keyed).
- `docs/partner-onboarding.md` — partner pipe + gate + asset-backbone plan.
- `docs/concierge-content-agent.md` — the agent product + Track A/B split.
- `docs/concierge-handoff.md` — this file.

Nothing has been applied to prod. All schema deploys via `supabase-deploy.yml`.

---

## 3. Key findings

**[verified] Drift — repo ≠ prod.** The partner pipe + `asset_observations` existed
in prod in no migration (now captured in #327). Still-drifted, NOT yet captured:
- Deployed edge functions `concierge-ground/house/partner/partner-invite` exist in
  prod, absent from repo. **Pull their source before building the gate on them.**
- Partial-drift to diff prod-vs-repo: `assets` (prod has `garment_id`,
  `publication_id`), `ingestion_ledger`, `vfc_changesets`, `org_assets`,
  `contract_assets`, `existence_tier_staging` (vehicle-keyed; needs generalizing).
- `supabase/migrations/20260128_social_automation.sql` claims
  `insights`/`social_posts`/`insight_queue`; only `social_posts` exists in prod
  (0 rows), the other two never applied.

**[verified] Depth is the gap, not design.** LE SELECT (`bcc0bd75-...`) is a stub:
`description` 0 chars, `total_images` 0, `enrichment_sources` 0, no Instagram,
`enrichment_status='stub'`, single source `directory-saintbarth.com`. Every
`lofficiel-concierge` place is the same. The enrichment/provenance engine has never
been pointed at these place-assets. This is the "lame as shit," quantified.

**[verified] `businesses` is an automotive-shaped silo** (`has_lift`, `has_dyno`,
`total_vehicles_worked`, hourly rates). LE SELECT is shoved into it via
`metadata->>'project'='lofficiel-concierge'`. Places should become
`assets` (asset_type='venue'/'place'), not silo rows — see the backbone work.

**[verified] Meta/Instagram is greenfield in code.** Only handle-*discovery* exists
(`scripts/concierge/enrich-instagram.ts` scrapes a business's site via Firecrawl for
an IG URL → `businesses.metadata.instagram`). Zero Graph API calls; the only
`instagram_content_publish` references live in an unimplemented Nov-2025 design doc
`docs/architecture/SOCIAL_MEDIA_PUBLISHING_ARCHITECTURE.md`.

**[verified] Partner-connection model** (`concierge_partner_connections`, 5 rows, all
`channel='shopify'`, `has_cred=false`): `mandate ∈ {display,quote,sell}`,
`access_tier_default ∈ {public,member,gated}`, `channel ∈
{shopify,square,lightspeed,woocommerce,csv,manual,api}` (no `instagram` yet),
`credential_secret_id` (Vault ref — note `[db.vault]` is commented out in
`config.toml`), `consent jsonb`. This is the idiomatic home for any tenant's
connected account, including a Meta/IG token. Reusable OAuth-refresh precedents:
`quickbooks-connect`, `gmail-alert-poller`.

**[verified] The content-pipeline organs already exist** (built for vehicles):
`asset_observations`/`vehicle_observations` (cited, confidence-scored, supersedable),
`observation_sources` (trust tier + decay), `observation_witnesses` (image_timestamp,
capture_method), image anchoring/`image_identities`, queue/orchestrator workers
(`photo-pipeline-orchestrator`, `continuous-queue-processor`). The gulf-guy /
EXIF-GPS-proximity clustering is this engine repointed, not a new build.

---

## 4. Open decisions (need the principal)

1. **Data isolation** — shared nuke DB (RLS + tenant key) vs. separate schema/project
   per brand. **Lean: shared now** (tiny data; FBM/cross-brand entities exist "in
   full" in both; isolating fragments them). Revisit at real scale/compliance.
2. **Content library shape** — shared commons vs. tenant-scoped. **Lean: tenant-scoped
   over a public commons layer** (sells access tiers, keeps rights clean). Drives RLS +
   the rights layer + business model; decide before it's baked in.
3. **What is Philippe** — paying client / brand-distribution partner / reference logo.
   He wants payoff without backend investment (that's *fine* — it's the model). He is
   not an owner. Naming the target sets how much rope his "let me shape it" gets.
4. **Instagram/Meta account status** — is @lofficielstbarth a **Professional** account,
   is there a **Facebook Business Manager**, and **does a verified nuke Meta app already
   exist**? This is the Track-A critical path; code can't start the review clock.

---

## 5. Blockers (external, not code)

- **Meta Business Verification + App Review** for `instagram_content_publish` Advanced
  Access — platform-level, weeks, gates all tenants. Correct model: ONE nuke Meta app
  (Tech Provider), per-tenant OAuth connect, per-tenant token in Vault. Evaluate the
  newer "Instagram API with Instagram Login" path (no FB Page link required per
  account) to cut onboarding friction. **[hypothesis]** on exact current permission
  names — verify against live Meta docs before submitting.
- **Supabase Vault** appears disabled (`[db.vault]` commented in `config.toml`) — enable
  before relying on `credential_secret_id`.
- @lofficielstbarth may need Personal→Professional conversion (step zero).

---

## 6. Build queue (ordered)

**Track B — content pipeline (UNBLOCKED, highest leverage):**
1. Register Issuu + open-web sources as trust-tiered `observation_sources`; run the
   **LE SELECT enrichment pilot** (stub → deep) with before/after numbers in the
   commit. Template for all 500 places.
2. Promote places to `assets` (asset_type='venue') + `asset_observations`; stop using
   the automotive `businesses` silo for venues.
3. Provider flow (gulf guy): provider-as-asset, EXIF-GPS+time clustering to associate
   provider+client photos to an outing, two-stage curation (nuke base gate + concierge
   "edge" taste filter), consented auto-distribution, reject-but-still-log.
4. **Rights layer** on curation: public / press-release / UGC-consent / licensed /
   editorial — citable ≠ licensed. The gate that makes autonomous posting safe.
5. `capture-brief` edge function → `creative_briefs` (paste a transcript → structured
   direction). Voice→text is a front-end concern.

**Track A — Meta publishing (GATED on §5):**
6. Meta-platform integration spec; wire `instagram` into the connection `channel`;
   per-tenant OAuth connect + token refresh (mirror quickbooks/gmail); two-step publish
   (`/media` → `/media_publish`) + engagement pull-back → observations.

**Drift repair (do before building on the drifted objects):**
7. Pull deployed `concierge-*` edge-function source into repo.
8. Diff + reconcile partial-drift objects (`assets`, `ingestion_ledger`,
   `vfc_changesets`); reconcile the `social_automation` schema drift.

---

## 7. House rules (from `.claude/rules/production-engineering.md`)

- **Measure, don't guess.** Verify the load-bearing claim against live prod. Put
  before→after numbers in commits.
- **The repo is not prod.** Assume drift until checked.
- **Deploys go through `supabase-deploy.yml`** — never hand-applied.
- **Success = rows landed, not exit 0.** Every automation checks its own throughput.
- **Silent failure is the house disease.** Every fire-and-forget path gets a watcher.

---

## 8. Pointers

- PR: https://github.com/sss97133/nuke/pull/327 (draft, green, subscribed for CI/review)
- Branch: `claude/lofficiel-concierge-nuke-db-pmztl3` (both nuke + lofficiel-concierge)
- Project: `qkgaybvrernstplzjaam` (https://qkgaybvrernstplzjaam.supabase.co)
- Docs: `docs/partner-onboarding.md`, `docs/concierge-content-agent.md`, this file.
- lofficiel-concierge repo: Next.js facade, shares this Supabase backend.
