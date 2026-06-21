# Frontend Doctrine — Projection Lenses Over Rhizomatic Substrate

**Date**: 2026-05-24
**Amended**: 2026-05-24 — §2a + §3 elevated user binding to primary container per Skylar correction ("user profile is paramount; vehicle profiles are derivative of that; it's the first inflection point for all future users"). See `docs/library/intellectual/discourses/2026-05-24_ui-substrate-rhizomatic-labels.md` for the discourse that produced the amendment.
**Status**: Doctrine — binding on every frontend agent
**Prerequisite reading**: `.claude/rules/frontend.md`, `docs/library/intellectual/discourses/the-knowing-system.md`, `docs/library/intellectual/contemplations/the-three-users-and-the-finder.md`, `docs/library/intellectual/contemplations/rhizomatic-labels-and-crystallization.md` (sibling, concurrent), `docs/library/technical/design-book/vehicle-profile-computation-surface.md`

> The frontend does not display tables. It renders **projections** over a substrate whose vocabulary is open and whose granularity is `(x, y, z, t, source, trust)`. Every page is a parameterized binding of one of four lens primitives. There is no fifth lens. There is no parallel display system.

---

## 1. The Substrate Is Rhizomatic; The Frontend Is Projection Lenses

The substrate — `vehicle_observations`, `vehicle_images`, `receipt_items`, `projection_event`, and the forthcoming pgvector + spatial-anchor extensions — is **rhizomatic**. Skylar's formulation: *infinite stickies and endless pen ink.* Any caller (extractor, vision model, owner, agent) may write any attribute about any subject at any time, with provenance. Vocabulary is open. The schema is the harness, not the contract. Crystallization — the convergence of many stickies onto a citable fact with a measured `(x, y, z)` — happens **inside the substrate**, downstream of ingest, governed by `projection_event` (`PROJECT_STATE.md` confirms the freeze trigger).

The frontend's job is **not** to mirror tables. Mirroring a rhizomatic substrate produces 96 pages. The frontend's job is to render **projections**: time-bounded, entity-bounded, or coordinate-bounded views over the substrate, composed at render time, citing their sources.

`/journal/:date` is the live proof. `JournalPage.tsx` calls `/api/journal/:date`, which composes `project_work_log` — substrate atoms attributed via `projection_event` — into a daily work-log. No table is exposed. No JSONB leaks. The page renders one projection. The projection is honest about its confidence (`CONFIDENCE 87% · 41 ATOMS · EVENT 9a3c…`).

This is the architectural commitment: **render is compute, not cache** (`vehicle-profile-computation-surface.md`). Every binding is a query that the substrate answers, freshly, every time.

---

## 2. The Four Lens Primitives

Every page in nuke.ag is a binding of one of these four lenses. If a feature does not fit, doctrine is wrong (amend it) or the feature should not exist (delete it).

### a. Entity Briefing Card (Reasonator pattern)

**Prior art:** Magnus Manske's *Reasonator* over Wikidata (2013–) — given a `Q-number`, render the entity's currently-preferred statements, qualifiers collapsed, references one click away, observer attribution co-primary with source. Magnus solved the same problem we have: a rhizomatic store with millions of statements, none of which a user wants to see raw.

**Substrate it pulls from:** `vehicle_observations`, `projection_event`, `contacts`, `properties`, `organizations`. Rank-`preferred` statements only by default; deprecated and superseded statements live one click below.

**Components it composes:** hero block (entity identity), preferred-statement table (attribute / value / qualifiers / observer / source / confidence), evidence drawer that opens in place.

**The user binding is primary.** Per Skylar 2026-05-24: *"user profile is paramount... it's the first inflection point for all future users... vehicle profiles are derivative of that."* The user profile is the safe starting container — every person entering nuke.ag lands here first, and their identity is the pivot from which their vehicles, orgs, photos, receipts, and observations are reachable as sub-views. Vehicle and org bindings remain first-class for non-user-pivoted surfaces (public vehicle pages, public org pages), but the canonical entry point for a logged-in human is `/u/:handle`. A vehicle viewed *through* a user pivot (`/u/:handle/v/:id`) shows only that user's slice of the vehicle's substrate (their photos, their work, their money on it); the standalone `/v/:id` shows the full cross-observer history.

**Existing nuke.ag bindings that ARE this lens (user binding is primary):**
- `/u/:handle` — **primary entry surface.** Entity-briefing pivoted on a user. Their identity, their fingerprint across assets, their daily activity, their connectable data sources, their actionable surface. New-user onboarding lands here. Today: `UserProfile.tsx` + `pages/user-profile/` (10 components, ~2,048 lines, mirroring the VehicleProfile convergence pattern — Header / SubHeader / BarcodeTimeline / WorkspaceContent / Briefing / DossierPanel / ActivityFeed / ReputationWidget / SettingsDrawer / Context). Mounted at `/profile`, `/profile/:userId`, `/profile/external/:externalIdentityId`. Structure is in place; load-bearing assessment in `docs/library/working/working-papers/2026-05-24_user-profile-ia-assessment.md`.
- `/v/:id` — entity-briefing pivoted on a vehicle. `VehicleProfile` is the convergence point per `frontend.md` and `vehicle-profile-computation-surface.md`. Reachable standalone (public) or as a user-pivoted sub-view (`/u/:handle/v/:id`).
- `/o/:slug` — entity-briefing pivoted on an organization (NUKE LTD, Viva, an auction house, a shop). Reachable standalone or as a user-pivoted sub-view (`/u/:handle/o/:slug` — that user's role + contributions to that org).
- `/p/:id` — entity-briefing pivoted on a property (future, when properties get public surfaces).

**Pages that should collapse into a binding of it:** any `*Detail.tsx`, `*Profile.tsx`, `*View.tsx` page that is fundamentally "show one of {vehicle, user, org, property}." If it isn't one of those, it shouldn't be a detail page.

**Non-negotiable rules** (from `frontend.md` and `the-knowing-system.md`):
- Default to rank-`preferred`. Never dump every observation.
- Never expose raw JSONB. Every value renders through an attribute formatter.
- Observer attribution is co-primary with source. "claude-opus-4-7 says X, citing BaT listing #43671" is the unit.
- Confidence is rendered, not hidden. Sparse profiles *look* sparse (`the-knowing-system.md` §IV).

### b. Faceted Browse (Flamenco pattern)

**Prior art:** Marti Hearst's *Flamenco* (UC Berkeley, SIGIR 2002, CACM 2006). Every high-cardinality attribute auto-becomes a left-rail facet with counts. No query language exposed. Drill-down preserves history. The system **never returns an empty result set** — facet counts are computed against the current narrowing, so any selectable facet always has results.

**Live production-grade demonstration: McMaster-Carr** (mcmaster.com). 750K SKU catalog, sub-second page loads, hover-prefetch, server-rendered HTML, faceted spec filters with live counts. The canonical UX north-star for engineering audiences. See `docs/library/intellectual/studies/2026-05-24_mcmaster-carr-speed-benchmark-study.md` for the full study and what to steal. *"Ui the data to infer and then call to action confirm, coordinate and deliver"* (Skylar 2026-05-24) is structurally identical to McMaster's "you find what you need and leave."

**Substrate it pulls from:** the open-vocabulary set of attribute keys present in `vehicle_observations` (and eventual `image_observations`, `part_observations`). The set is computed, not declared.

**Components it composes:** left rail of facet groups with counts, result grid (cards), breadcrumb of active narrowings, sort toolbar.

**Existing nuke.ag bindings that ARE this lens:**
- `/journal` — `JournalIndex.tsx` is faceted browse over days. The 90-day density table is the result grid; the implicit facet is time. Add make / receipt-scope / payment-source as columns when warranted; they become facets.
- `/browse` and `/vehicles` (when canonicalized) — faceted browse over vehicles.
- `/parts` (future) — faceted browse over `parts_catalog`, narrowed by demand-side vehicle segments (per `.claude/rules/supply-side.md`).

**Pages that should collapse into a binding of it:** any `*Browser.tsx`, `*Index.tsx`, `*List.tsx`, `*Marketplace.tsx`, `*Search.tsx` page. There is one faceted-browse component. It is parameterized by entity type and starting narrowing. Search results, filtered lists, and "marketplace" surfaces are all the same lens with different bindings.

### c. Observation Feed (Information-Foraging pattern)

**Prior art:** Pirolli & Card, *Information Foraging* (Psychological Review, 1999). Users follow **information scent** — visible cues (source icon, recency, observer trust, confidence) — to decide whether to dig into a patch or move on. The feed is the foraging surface.

**Substrate it pulls from:** `projection_event` and the underlying atoms in time-recency order, optionally narrowed by subject, source, or attribute.

**Components it composes:** stream of observation cards, each with: source glyph, observer slug + trust, timestamp, attribute label, value preview, confidence chip. Click → entity briefing for the subject. Click a facet → faceted browse narrowed by that facet.

**Existing nuke.ag bindings that ARE this lens:**
- `/journal/:date` — `JournalPage.tsx` is a time-bounded slice of the observation feed, projected via `project_work_log`. Photos with their atoms are observation cards; work orders and receipts are observation cards.
- `/feed` and `/activity` (when canonicalized) — the unbounded live stream. This is Skylar's stated endgame ("data is just continuously flowing") and the Phase-2 surface in `the-three-users-and-the-finder.md` §IV.
- `/notifications` (future) — the personalized observation feed, narrowed to subjects the user is watching. Phase-3 agentic on top of Phase-2 stream.

**Pages that should collapse into a binding of it:** any `*Dashboard.tsx`, `*Activity.tsx`, `*Notifications.tsx` page whose purpose is "show me new things in time order." There is one feed component. It is parameterized.

### d. Spatial-Temporal Viewer (Volumetric Lens)

**Prior art:** Mildenhall et al., *NeRF* (ECCV 2020) and Kerbl et al., *3D Gaussian Splatting for Real-Time Radiance Field Rendering* (SIGGRAPH 2023) — both establish that a static scene can be represented as a continuous radiance field queryable at any viewpoint. Hamilton et al., *Diachronic Word Embeddings* (ACL 2016) is the temporal-drift analogue: how meaning at a coordinate evolves over time. The spatial-temporal viewer is the union: a Gaussian Splat (or, near-term, a rough Blender mesh) of a vehicle, with observations pinned at `(x, y, z)` and a time scrubber that crossfades them.

**Substrate it pulls from:** `vehicle_3d_models` (mesh or splat blob, per-vehicle), `image_observations` joined to `image_spatial_anchors` (forthcoming — owned by the substrate agent, not this doctrine), `vehicle_observations` with a `coordinate` qualifier.

**Components it composes:** WebGL canvas (three.js for meshes, gsplat.js or equivalent for splats), pin layer, time scrubber, observation drawer that opens when a pin is clicked, fleet-cross-correlation drawer ("this scratch appears on 3 other K10s with similar mileage").

**Existing nuke.ag bindings that ARE this lens:**
- `/v/:id/3d` (future) — entity-binding for a single vehicle, volumetric. Today the wiring formboard at `components/wiring/` is the seed: a Blender-sourced K5 with traited objects (per `objectTraits.ts`). Generalize the renderer, keep the data path.
- `/fleet/:make/:model/3d` (future) — cross-entity correlation viewer. Click a coordinate; see every observation at that coordinate across the fleet. This is what "data perfected" looks like (Phase 3 of `the-three-users-and-the-finder.md`).

**Pages that should collapse into a binding of it:** the existing wiring component tree (`components/wiring/`) is already a binding-in-disguise. When it leaves admin and becomes user-facing, it ships under this lens. Any future "3D garage", "build viewer", "damage map" feature is this lens.

This is the deepest lens. It presupposes spatial-anchor substrate that does not yet fully exist. Do not build pages against it speculatively. Build the substrate first; the lens follows.

---

## 3. The Convergence Point Rule

From `.claude/rules/frontend.md`:

> The vehicle profile is the CONVERGENCE POINT. Do not create parallel display systems. Feed data into the existing structures.

**Generalized:** the four lens primitives are the only display systems. Every page is a parameterized binding. **`/u/:handle` is the primary entry point** (per §2a amendment); other bindings are reachable standalone OR as user-pivoted sub-views:

- `/u/:handle` = entity-briefing(`user`) — **primary surface, all logged-in users land here**
- `/u/:handle/v/:id` = entity-briefing(`vehicle`) pivoted through user (their slice only)
- `/u/:handle/o/:slug` = entity-briefing(`organization`) pivoted through user (their role + contributions)
- `/u/:handle/day/:date` = observation-feed(`time=:date`, `user=:handle`) — their day across all assets, multi-vehicle. Replaces vehicle-pivoted `/journal/:date` for the user-as-primary path.
- `/v/:id` = entity-briefing(`vehicle`) — standalone public, cross-observer history
- `/o/:slug` = entity-briefing(`organization`) — standalone public
- `/journal/:date` = observation-feed(`time=:date`) — public time-bounded slice (vehicle-pivoted or unbounded)
- `/journal` = faceted-browse(`entity=day, window=90d`)
- `/browse` = faceted-browse(`entity=vehicle`)
- `/fleet/:make/:model/3d` = spatial-temporal(`fleet=:make/:model`)

**You do not build a fifth lens type without amending this doctrine.** A new lens requires a new entry to §2, justified by a prior-art citation and a substrate it pulls from. PR description must name the lens. If a feature feels like a new lens but is actually a binding of an existing one, the binding is the answer.

---

## 4. The Crystallization Model (Data → Label → Fact)

The sibling contemplation at `docs/library/intellectual/contemplations/rhizomatic-labels-and-crystallization.md` (concurrent, by another agent) names the substrate's lifecycle: a value enters as a free-text or embedded sticky; it accumulates corroboration; it crystallizes into a citable fact with `(x, y, z)` coordinates and 0–100 confidence. Hamilton-style diachronic embeddings let us track when a label's meaning drifts.

**The frontend consequence is non-negotiable:**

1. The lens **always** renders the crystallized-fact layer when available. Default view = preferred crystallized value, with confidence, observer, source, and (when applicable) coordinate.
2. The lens **expands to the sticky layer on demand**. Click a value → see every underlying sticky, with its caller, its trust, and its date. This is the evidence drawer.
3. The lens **never hides sticky-only state**. If a value is sticky-only (not yet crystallized), it renders with explicit provenance and a low confidence chip. *Never* present a sticky as a fact. (`the-knowing-system.md` §VIII: "honesty about uncertainty.")
4. The lens **never shows the embedding layer** to users. Embeddings power similarity, narrowing, and "see related." They are infrastructure, not UI.

This is what makes the briefing model (`the-knowing-system.md` §II) honest. The system that summarizes *and lets you audit the summary* is an intelligence platform. The system that summarizes without showing its work is a black box.

---

## 5. UI as Call-to-Action, Not Browser

Skylar's directive, verbatim:

> *"the data answers those questions the ui enables truthful response to the query"*
> *"ui the data to infer and then call to action confirm, coordinate and deliver"*

Every projection terminates in a possible action. The briefing is not a wall the user reads; it is a step in a workflow.

- Entity briefing for a vehicle → **confirm** an inference ("Is this VIN match correct?"), **coordinate** a transaction ("Make an offer / Start a consignment"), **deliver** a service ("Generate the listing description").
- Observation feed → **confirm** a new observation ("Is this photo of the right vehicle?"), **coordinate** ("Tag for follow-up"), **deliver** ("Push to the public timeline").
- Faceted browse → **coordinate** ("Save this query / Watch this segment"), **deliver** ("Export as CSV / Email me when matches arrive").
- Spatial-temporal → **confirm** ("Is this scratch the same one across photos?"), **deliver** ("Order this part keyed to this coordinate").

**Lenses that do not terminate in a possible action are incomplete.** A page that only shows is not shipped. A page that only shows is also probably not a binding of one of the four lenses — recheck.

---

## 6. The 96-Pages Problem and the Deletion Gate

On 2026-05-24 the audit found 96 files in `nuke_frontend/src/pages/`. Roughly 50 are reachable from `DomainRoutes.tsx`. Roughly 46 are orphaned or redundant. Cause: agents have been adding pages without deleting, and Vercel build failures have produced bulk-commits of untracked work-in-progress.

**Doctrinal consequences, binding on every frontend agent:**

1. Any new page **must** be a binding of one of the four lens primitives. If it isn't, this doctrine is wrong (open a PR to amend it) **or** the page shouldn't exist (don't build it).
2. Any new page **must delete or merge** an existing page. Net page count trends down toward roughly five to ten canonical bindings. "I'm adding `BuyerDashboard.tsx`" is not allowed; "I'm collapsing `BuyerDashboard.tsx`, `SellerDashboard.tsx`, and `DealerAIAssistant.tsx` into a single role-parameterized binding of observation-feed" is.
3. A page is **not shipped** until it is mounted in `DomainRoutes.tsx`. CI should fail builds with orphan page files (this is an `.claude/ISSUES.md` item; file it if not present).
4. Deletion of unused pages is **not destructive** in the trust-invariant sense. Pages are frontend artifacts, not testimony. The `.claude/rules/agent-trust-invariants.md` rule applies to substrate tables, not React components.
5. Pages of deleted features (betting, trading/exchange, vault, concierge, shipping, investor portal — per `.claude/rules/platform-hygiene.md`) are tombstones. Delete them in the next session that touches the frontend.

---

## 7. The Agent Contract for Frontend Work

Before building any frontend feature, every agent runs this checklist:

1. **Read this doctrine.** (`docs/library/technical/design-book/frontend-doctrine.md`.)
2. **Identify which lens primitive the feature belongs to.** Entity briefing, faceted browse, observation feed, or spatial-temporal. Name it in the receipt / commit message. If you cannot name it, stop and either (a) propose a fifth lens with prior-art citation, or (b) accept that the feature is wrong.
3. **Check if an existing binding can be parameterized.** A new query parameter, a new prop, a new narrowing on an existing route is *always* preferable to a new page. Read `pages/` and `DomainRoutes.tsx` before adding a file.
4. **Read `.claude/rules/frontend.md` and the relevant existing components.** Honor the sticky stack (`--vp-stick-*` tokens), the no-empty-shells rule, the Arial-only typography, the 2px-borders-no-shadows visual rule, and the surgical-edits-not-rewrites rule. A bug fix is three to ten lines, not a four-hundred-line `Write` call.
5. **Read the convergence-point doc** (`vehicle-profile-computation-surface.md`) before touching any vehicle profile code. The profile is the convergence point. Feed into it. Do not fork it.
6. **End with a binding that mounts in `DomainRoutes.tsx`** and a **deletion** of whatever it replaces. The PR title names both: "added `/o/:slug` binding, deleted `OrganizationDashboard.tsx`."

If the work is research or exploration, it does not ship as a page. It ships as a doc in `docs/library/working/` or as a sidequest receipt — not as orphan React code.

---

## Appendix: Lens-to-Page Mapping (Current and Aspirational)

| Lens | Canonical bindings (today) | Aspirational bindings |
|---|---|---|
| Entity briefing | `/v/:id`, `/u/:handle`, `/o/:slug` | `/p/:id` (property), `/r/:id` (receipt-as-entity) |
| Faceted browse | `/journal`, `/browse` | `/parts`, `/people`, `/orgs` |
| Observation feed | `/journal/:date` | `/feed`, `/notifications`, `/u/:handle/activity` |
| Spatial-temporal | (wiring formboard, admin-only) | `/v/:id/3d`, `/fleet/:make/:model/3d` |

Page count target: roughly five to ten canonical bindings plus admin surfaces, not ninety-six.

---

*"The substrate writes. The lens reads. The user decides. Everything else is parallel display."*
