# Intake Fix Plan — The Janitor Drain

**Team:** intake (form-shape + ingestion surface)
**Date:** 2026-05-06
**Author:** intake lead, working from canon at `docs/library/intellectual/contemplations/the-form-is-the-thing.md` and `docs/library/intellectual/contemplations/the-three-users-and-the-finder.md`.
**Scope:** the first-principle drain — photos, voice, URLs, one-line notes → substrate atoms.

---

## 1. Mission

Skylar wrote in `docs/library/intellectual/contemplations/the-form-is-the-thing.md` (2026-05-02): *"The form is the thing. Everything else is plumbing to deliver Claude to it."* And in `docs/library/intellectual/contemplations/the-three-users-and-the-finder.md`: *"The Savant Janitor is first principle… The site's goal is first to be the dumping ground. Don't look, just work."* Our job is to make those true. Today the platform has the contracts (per-event-type JSON Schemas, an MCP `get_event_checklist` tool, the External Agent Write API at `POST /v1/events`, and the laser-tag harness at `submit_attribute_value`) but no coherent **front door** for a human Janitor — Skylar in his garage, or a stranger landing on nuke.ag — to dump material against those contracts. The form-shapes exist; the form does not. This team builds the form, wires it to the existing contract, and makes the homepage of nuke.ag behave like a drain.

---

## 2. Current state — what intake exists today

### What's already shipped (substrate side — do not rebuild)

- **Per-event-type JSON Schemas (Draft 2020-12)** at `docs/api/schemas/v1/`: `service.json`, `note.json`, `inspection.json`, `modification.json`, `condition_assessment.json`, `envelope.json`. These are the form-shapes. They are real, strict (`additionalProperties: false`), and wired into the substrate via `ingest-observation`.
- **External Agent Write API** at `supabase/functions/api-v1-events/index.ts`. `POST /v1/events`. Takes the envelope, validates it, routes by `event_type` into `vehicle_observations` with the right `(observation_kind, source_slug)`. VIN is the canonical key.
- **MCP laser-tag harness** at `supabase/functions/mcp-connector/index.ts` (`get_event_checklist` ~line 4306, `submit_vehicle_event` ~line 5588, plus `submit_attribute_value` / `submit_attribute_values` / `find_subjects_needing_atoms` for the per-attribute checklist surface). Both event-shaped and attribute-shaped paths exist.
- **Attribute registry** at `supabase/functions/_shared/cockpit/attribute-registry.ts`. L1–L5 prompt+shape catalog (`image.has_vehicle`, `vehicle.viewpoint`, `vehicle.exterior_color`, etc.). The vision side of the form-shape contract.
- **Photo intake adjacent surfaces** that exist as components but not as a Janitor front door: `nuke_frontend/src/components/UniversalImageUpload.tsx`, `nuke_frontend/src/components/GlobalDropZone.tsx` (full-page drag overlay; dispatches `nuke:global-drop` events), `nuke_frontend/src/components/search/AIDataIngestionSearch.tsx` (the "magic input" header pattern).
- **Captive intake pages**: `pages/Capture.tsx`, `pages/TechCapture.tsx`, `pages/RestorationIntake.tsx`, `pages/add-vehicle/AddVehicle.tsx`. All four are auth-gated (`/capture`, `/tech`, `/restoration`, `/intake`, `/vehicle/add` are all behind `<ProtectedRoute>` — see `nuke_frontend/src/routes/DomainRoutes.tsx:193-236`).

### What's missing per the canon

1. **No public Janitor surface.** A logged-out stranger on nuke.ag/ today sees the treemap homepage (`pages/HomePage.tsx`). There is no "drop here" affordance. The treemap is a presentation surface, the opposite of an intake surface — and per UI_AUDIT_2026-05-05 T0.4 it breaks at 375px.
2. **No event-type registry the frontend reads.** The schemas live in `docs/api/schemas/v1/*.json` and are also inlined inside `mcp-connector/index.ts` as `EVENT_CHECKLISTS_INLINE` (~line 4306). The frontend has no canonical import — every form would re-invent the field list. We need a single source the frontend, the MCP tool, and the OpenAPI spec all pull from.
3. **No form generator.** Even if we had the registry on the client, nothing renders a form from a JSON Schema + checklist. The five form-shapes need a single `<EventForm event_type=...>` that introspects the schema and renders fields with `vision_fillable`/`context_fillable`/`tool_fillable` annotations driving the affordances (camera button next to vision-fillable fields, voice button on text fields, "ask the system" button on tool-fillable fields).
4. **No mobile photo-capture path that ends in a typed event.** Today's `Capture.tsx` is a `getUserMedia` camera that drops files into `UniversalImageUpload`, which classifies into zones via heuristics — but never produces a typed `service` / `inspection` / `note` envelope. Photos go to storage; nothing is submitted to `POST /v1/events`.
5. **No voice-to-form path at all.** The canon names voice as a primary input (*"Drop an image. Done. Say something. Done."*). There is no transcription surface in the frontend, no microphone affordance on intake routes, no caller path that turns a 30-second voice memo into a `note` envelope.
6. **The journal/money projections exist but their intake side does not.** Skylar can submit a service event via Claude → MCP, but there's no in-product UI for him (or anyone) to do the same on the web. PROJECT_STATE.md asserts journal is live; UI_AUDIT_2026-05-05 T0.1/T0.2/T0.3 catches that the routes aren't even mounted. Intake is doubly absent: the projections aren't reachable, and the typed-form ingestion that would feed them isn't built.

---

## 3. The fix list

Each fix is sized S (≤1 day), M (1–3 days), L (3–7 days), XL (>1 week).

### F1 — Extract the event-type registry into a shared package

- **Lands at**: new file `nuke_frontend/src/lib/intake/eventRegistry.ts` (consumes JSON imports of `docs/api/schemas/v1/*.json`); plus a re-export module at `supabase/functions/_shared/intake/eventRegistry.ts` shared between MCP and `api-v1-events`.
- **Problem (one sentence)**: the same five event-type definitions live in three places (the JSON Schemas on disk, the inline `EVENT_CHECKLISTS_INLINE` map in `mcp-connector/index.ts:~4306`, and the routing table `EVENT_TYPE_MAP` in `api-v1-events/index.ts:68`); the frontend has no canonical handle so a form generator can't be built.
- **Recipe**:
  1. Pick one canonical home: the existing `docs/api/schemas/v1/*.json` (Draft 2020-12 + an extension keyword `x-checklist` per field carrying `{ vision_fillable, context_fillable, tool_fillable, why_it_matters }`).
  2. Move the prose annotations out of `EVENT_CHECKLISTS_INLINE` into the schema files under that extension keyword. The mcp-connector handler reads them from there instead of an inline map.
  3. Generate a tiny TypeScript registry (`{ event_type, title, schema, checklist, routing: { observation_kind, source_slug } }`) at build time from the JSON files (script under `scripts/build-event-registry.ts`); the frontend imports from `nuke_frontend/src/lib/intake/eventRegistry.ts` and the edge functions import from `supabase/functions/_shared/intake/eventRegistry.ts`.
  4. Add a contract test that `EVENT_TYPE_MAP` keys = registry keys = JSON file names.
- **Canon citation**: `the-form-is-the-thing.md` §"What this means for the work" — *"Every new event type that gets added is a new form."* If the form lives in three places, every new event type is a three-way edit; this fix makes it mechanical.
- **Effort**: M.

### F2 — Build `<EventForm>` — one component renders all five form-shapes

- **Lands at**: new directory `nuke_frontend/src/components/intake/EventForm/` (`EventForm.tsx`, `fieldRenderers.tsx`, `useChecklist.ts`).
- **Problem**: nothing on the client renders a JSON-Schema-driven form, so each new event type requires a new hand-coded form (and the canon's "every event type is a form" doesn't actually compose).
- **Recipe**:
  1. Take an `event_type: EventType` prop; resolve `(schema, checklist)` from the registry (F1).
  2. Walk the schema tree; render a field per leaf. Field renderer chosen by `(type, enum?, items?)`. For `array of string` → multi-line + "add" affordance; for `array of object` (`parts`, `decisions`, `condition_observations`) → repeating sub-form; for `enum` → segmented control; otherwise text/number.
  3. Each field shows three icons in its label row reflecting its checklist row: camera (vision-fillable), microphone (context-fillable via dictation), wrench (tool-fillable — fires `query_field_evidence` for that field).
  4. Submit serializes to the v1 envelope, calls `POST /v1/events` (or `submit_vehicle_event` over MCP if the user has connected via OAuth), surfaces validation errors back into per-field state.
  5. The component is event-type-agnostic; adding a sixth event type means adding one schema file (F1), zero UI work.
- **Canon citation**: `the-form-is-the-thing.md` §"What a form-shape is" — the triplet (vision/context/tool fillable) is the moat; this component is what makes the triplet visible to the human user, not just the agent.
- **Effort**: L.

### F3 — Public `/intake` route as the Janitor drain

- **Lands at**: `nuke_frontend/src/pages/intake/IntakePage.tsx` (new); route mounted at `nuke_frontend/src/routes/DomainRoutes.tsx` after line 184 in the **public** pages block (NOT inside the `<ProtectedRoute>` block at 193).
- **Problem**: every existing intake page (`/capture`, `/tech`, `/restoration`, `/vehicle/add`) is auth-gated; the canon says the front door is *"first to be the dumping ground"* — that requires a public surface where a stranger or Skylar-not-logged-in can drop material and see immediate feedback. The current `/intake` redirects to `RestorationIntake` (Telegram-bot dashboard), which is the wrong concept entirely.
- **Recipe**:
  1. Rename the existing `/intake → RestorationIntake` mapping to `/intake/restoration` (it's the shop-owner dashboard, not the Janitor surface).
  2. New `IntakePage` is a single column: top is the magic input (URL, VIN, free text → routed to existing `extract-*` extractors, `decode-vin`, or a `note` event), middle is a drop zone (delegates to existing `GlobalDropZone` + `UniversalImageUpload`), below that is a "what kind of thing?" picker that opens `<EventForm event_type=...>` (F2) for service/inspection/modification/condition_assessment/note, and a microphone button that opens the voice path (F4).
  3. **Auth state**: anonymous users see the same surface but submissions land in a guest queue (`vehicle_observations` rows with `source_slug='guest-intake'`, surfaced for triage; rate-limited per IP). After they submit, they get a magic-link prompt that turns the queue rows into their own substrate. This is the Spotlight-grade drain — point and shoot, sign up later.
  4. Vehicle scope: when a VIN is detectable in the input, the form prefills `vehicle_ref.vin`; when it isn't (a stranger dropping a photo of a truck they saw at a show), the submission lands as a `cluster` subject in the laser-tag harness (no vehicle binding) and shows up on a "needs-resolution" worklist instead of failing.
- **Canon citation**: `the-three-users-and-the-finder.md` §VII *"The Savant Janitor Is First Principle"* — *"When a design decision creates tension between 'easy to dump data in' and 'pretty to look at,' dump wins."* This is the page where dump wins.
- **Effort**: L.

### F4 — Voice → text → `note` event path

- **Lands at**: `nuke_frontend/src/components/intake/VoiceCapture.tsx`; new edge function `supabase/functions/transcribe-voice-to-event/index.ts` (only if no existing tool covers it — check `TOOLS.md` first; if `transcribe-audio` exists, extend it).
- **Problem**: voice is named in the canon as a primary input but has zero UI. A Janitor cannot say *"I changed the oil today, used Mobil 1, K5 Blazer"* and have it land as a `service` event.
- **Recipe**:
  1. Browser-side: `MediaRecorder` API; record up to 60 seconds; show waveform.
  2. Upload audio blob to a new transcription edge function (use Whisper API or GPT-4o-audio); response is `{ transcript, suggested_event_type, prefilled_payload }` where the LLM has read the transcript and proposed a checklist fill against the registry (F1).
  3. Open `<EventForm>` (F2) prefilled; user reviews, taps submit.
  4. Voice never bypasses the form — the form is the contract. The transcription is a draft for the form, not a write path of its own.
- **Canon citation**: `the-form-is-the-thing.md` §"Why a permissive schema isn't enough" — *"Vision agents without a form will hallucinate structure."* Voice agents will hallucinate structure too. The form is the discipline.
- **Effort**: M.

### F5 — Mobile photo-capture path that ends in a typed event

- **Lands at**: `nuke_frontend/src/pages/intake/IntakePage.tsx` (the same page from F3) + `nuke_frontend/src/components/intake/PhotoToEvent.tsx`.
- **Problem**: today, taking a photo on `/capture` (mobile) ends in a `vehicle_images` row; the photo never becomes a typed `service` / `inspection` / `condition_assessment`. The agent-side path (BYOK Claude reading photos via `submit_attribute_value`) exists; the human-side path doesn't.
- **Recipe**:
  1. After photo capture (existing camera flow in `Capture.tsx:57-110`), upload the photo, then call `submit_attribute_value` for `image.has_vehicle` and `image.classification` (registry-backed; no human in the loop yet). The image classification result drives the next step.
  2. If `vehicle_exterior` / `engine_bay` / `undercarriage` / `in_progress` → suggest opening `<EventForm event_type='service' or 'inspection'>` with `photos_referenced` prefilled.
  3. If `documentation` → route to receipt classifier (`classify-receipt-scope`) and pre-open `<EventForm event_type='note'>` with `attached_documents`.
  4. If `vehicle_interior` / `detail_part` → `<EventForm event_type='condition_assessment'>` with `photos_referenced` prefilled and `image.condition_cues` from the L3 attribute as a starting list.
  5. The user always gets a form. The form is always submitted via `POST /v1/events`.
- **Canon citation**: `the-form-is-the-thing.md` §"Two surfaces, one form" — *"The point is that there is one form."* Mobile photo capture is just another surface delivering the user to the form.
- **Effort**: M.

### F6 — Replace the logged-out homepage treemap with the Janitor drain

- **Lands at**: `nuke_frontend/src/pages/HomePage.tsx:1-50` (auth check fork). For logged-out users, render `<IntakePage variant='homepage'>` (a slimmer layout of F3); for logged-in users, keep the treemap.
- **Problem**: per UI_AUDIT_2026-05-05 T0.4, the treemap homepage is mobile-broken and has no responsive breakpoints. More importantly, per the canon, it is the wrong page for the front door — *"Most platforms design for the Browser first… Nuke's first principle is the janitor."*
- **Recipe**:
  1. In `HomePage.tsx`, if `!session && !isOnboarding` → return `<IntakePage variant='homepage'>` instead of the treemap.
  2. The "homepage variant" of IntakePage shows: drop zone (full-bleed, mobile-friendly), magic input above it, a one-line description (*"Drop a photo, paste a URL, or sign in to track your vehicle."*), and three example chips (*"Photo of a truck you saw"*, *"BaT listing URL"*, *"Tonight's wrench session"*).
  3. The treemap moves to `/explore` (or the existing `/?tab=garage` path) and stays the killer browse experience for signed-in users.
  4. This single move closes T0.4 (mobile-broken homepage) and the canon's "first principle is intake, not browse."
- **Canon citation**: `the-three-users-and-the-finder.md` §VII — *"The intake surface is more important than the presentation surface. Getting data in is harder than showing data out."*
- **Effort**: M (the new page exists from F3; this is the routing fork + a layout variant).

### F7 — Inline event-type registry into OpenAPI spec

- **Lands at**: `public/v1/openapi.json` (regenerated by the build script from F1).
- **Problem**: the OpenAPI spec at `public/v1/openapi.json` and `api/v1/openapi.json` references the schemas at `nuke.ag/api/schemas/v1/<event_type>.json` but those references aren't auto-built from the source. If F1 ships, the OpenAPI must be a derived artifact, not a hand-edited file.
- **Recipe**: extend the F1 build script to emit the OpenAPI components.schemas block from the same JSON files; CI fails if the OpenAPI drifts from the registry.
- **Canon citation**: `the-form-is-the-thing.md` §"Two surfaces, one form" — REST and MCP must consume the same JSON Schemas.
- **Effort**: S.

### F8 — Anonymous guest-intake queue + claim flow

- **Lands at**: `vehicle_observations` (no schema change — uses existing `source_slug='guest-intake'`); claim helper at new edge function `supabase/functions/claim-guest-intake/index.ts` only if no existing tool covers it (check `TOOLS.md`); otherwise extend.
- **Problem**: the canon's drain only works if a stranger can dump without signing in first. RLS on `vehicle_observations` and the auth check on `api-v1-events` reject anonymous writes. We need a narrow, rate-limited path that lands guest submissions in a holding tank, and a one-call claim that re-keys them to a real user_id once they sign up.
- **Recipe**:
  1. New scope: `events:write:guest` issued to anonymous browsers via a short-lived, IP-bound, rate-limited token (~10 submissions/hour/IP).
  2. Submissions land in `vehicle_observations` with `submitter_id=NULL`, `source_slug='guest-intake'`, `metadata.guest_token=<token>`.
  3. After magic-link signup, the new user calls `claim-guest-intake` with the token; the function updates `submitter_id` (this is a permitted update — testimony invariant prohibits *content* overwrites, not attribution backfill — but **verify against `agent-trust-invariants.md` rule 2 before shipping; if disallowed, use the supersession pattern instead**).
  4. Hard cap: guest submissions never auto-resolve to a vehicle (`vehicle_id` stays NULL until a signed-in human or trusted agent confirms). They sit in the same "needs-resolution" queue as F3.
- **Canon citation**: `the-three-users-and-the-finder.md` §VII — *"the person who points a phone camera at a receipt and trusts the system to file it."*
- **Effort**: L. **Open question** flagged for review with substrate team: whether the supersession constraint applies to attribution-only updates. If yes, downgrade to "submitter_id is set on first write to a synthetic guest user_id; claim creates a new row that supersedes." That changes the implementation but not the user-visible flow.

### F9 — `<IntakeBanner>` on every public page that isn't intake

- **Lands at**: `nuke_frontend/src/components/layout/IntakeBanner.tsx`; mounted in `AppLayout.tsx` for non-intake routes when no recent submission exists in localStorage.
- **Problem**: a stranger lands on `/vehicle/<id>` from a search result. They have a photo of a similar truck on their phone. There's no affordance saying *"add yours."* The drain only exists at `/`.
- **Recipe**: thin sticky banner at viewport bottom (mobile) / top (desktop): *"Drop a photo, paste a URL, or speak — we'll file it."* Clicking opens IntakePage as a modal overlay (or routes to `/intake?source=banner`).
- **Canon citation**: `the-three-users-and-the-finder.md` §I.1 — *"They don't want to organize anything. They don't want to fill out forms. They want to dump everything into the system and have the system figure it out."* The banner is the dump prompt that follows the user around the site.
- **Effort**: S.

### F10 — Cannot-be-defined-cleanly: cross-vehicle clusters

- **Problem**: a Janitor uploads 30 photos from a car show. Five different vehicles. The canon says *"drop everything into the system and have the system figure it out"* — but `vehicle_ref` in the v1 envelope requires a VIN or vehicle_id. There is no envelope shape for *"these N images, system you tell me how many vehicles."*
- **Why we are not defining a fix here**: this is real and important but it is **not the first-ship problem**. The attribute-registry path already supports it (`subject_kind: 'cluster'` exists in `_shared/cockpit/attribute-registry.ts:30`), and `submit_attribute_value` over a cluster is the right substrate. What's missing is a UI flow that batches photos, runs L1–L2 attributes (`image.has_vehicle`, `image.vehicle_bboxes`, `vehicle.year_range`, `vehicle.make`, `vehicle.model`) per image, and proposes vehicle clusters back to the user. That's a separate working paper. Naming it here so it doesn't get smuggled into the first ship.
- **Effort**: XL, not in this scope.

---

## 4. First ship — the smallest unblocking move

**Ship F1 + F2 + F3 — one event type, the `note` form-shape, on a public `/intake` route — by Monday next.**

Why this and not the rest: `note` is the simplest form-shape (`note.json` has a single required field, `text`). It tests the entire chain end-to-end — registry build, form generator, public route, anonymous submission, substrate landing — without dragging in the full vision/voice/photo paths. If a stranger can land on nuke.ag/intake, type *"I saw a 1978 K5 in Tucson today, body looked clean, asking $24K"*, hit submit, and have that land in `vehicle_observations` as `kind=comment, source_slug=guest-intake` (clusterable later by an agent against the laser-tag harness), the moat is real. F4 (voice), F5 (photo-to-event), F6 (homepage replacement), and F8 (guest claim) all reuse the same plumbing — so the second ship is small. If we try to ship F1–F9 simultaneously, the form-generator's edge cases (array-of-object renderers, tool-fillable wrench buttons, OAuth flow) will eat the timeline and Monday becomes August. **One form, one event type, one route. Then expand.**

---

## 5. Compounding moves — what makes future intake additions mechanical

The point of F1 (event-type registry) is that it's the **only** place an event type is defined. After F1+F2 ship:

- **Adding a sixth event type** (e.g., `ownership_change`) is one new file in `docs/api/schemas/v1/`. The registry build script picks it up; the form generator renders it; the OpenAPI updates; the MCP tool exposes it; `api-v1-events` routes it. Zero UI work. **This is the moat at the scaffold level**: every new form is a JSON file, not a React component.
- **Adding a new field to an existing event type** is one entry in the schema. The form re-renders; the checklist gains a row; agents pick it up automatically next time they call `get_event_checklist`.
- **Adding a new attribute to the laser-tag harness** is one entry in `_shared/cockpit/attribute-registry.ts`. F5's photo-to-event flow inherits it for free.
- **Switching transports** (today REST + MCP; tomorrow maybe a `wrangler`-style CLI or an iOS Share Sheet extension) is a thin client over the same registry. The form is the same; the surface is plumbing.

The work is to make the form-shape the only thing that matters. Everything else falls out.

---

## 6. Constraints — what this team does NOT do

- **No projection / rendering work.** The journal page (`pages/journal/JournalPage.tsx`), money flow page (`ShopFinancials.tsx`), vehicle profile, dossier view — those are projection team territory. We feed substrate; they render it. T0.1, T0.2, T0.3 from UI_AUDIT_2026-05-05 are projection-team tickets, not ours.
- **No shared UI primitives.** Button, Modal, Card, TextInput, Select, Textarea — foundation team. We *consume* their primitives in `<EventForm>`. If the foundation primitives don't exist when we need them, we use raw HTML matching `unified-design-system.css` tokens (Arial, 8-9px caps, 0px radius, 2px borders) and hand off to foundation later for primitive extraction. We do not ship a private button.
- **No bundle / runtime perf work.** Performance team owns T1.8 (1.2 MB maps preload), T1.10 (org route bloat). Our routes (`/intake`, the homepage variant) must be lazy-loaded — that's a hard constraint we honor — but the broader perf work is not ours.
- **No vehicle-profile UI.** Even the F9 banner is layout-team adjacent; we ship the banner *component* and they decide where it mounts. If the foundation team objects, we drop F9.
- **No agent-side BYOK orchestration.** The laser-tag harness exists; we call into it from the human-side UI (F5 photo flow). We do not redesign the harness or write a new caller.

---

## 7. Verification — how Skylar would know each fix landed

| Fix | Test |
|---|---|
| F1 | `curl https://nuke.ag/v1/events/event-types` returns the same array as `Object.keys(EVENT_TYPE_MAP)` from `api-v1-events`, same as the file count under `docs/api/schemas/v1/`. CI test fails if any one drifts. |
| F2 | Storybook story `EventForm/note.tsx` renders all schema fields; submitting fires a `POST /v1/events` mock with the exact envelope the schema requires. Repeat for the four other event types. Snapshot tests assert field count = schema property count. |
| F3 | Open `https://nuke.ag/intake` in incognito on iPhone 15 Pro at 375px. Drop a photo; type a sentence; tap submit. Photo appears in `vehicle_images` (or storage, scoped); a `vehicle_observations` row exists with `source_slug='guest-intake'`. No console errors. |
| F4 | On `/intake`, tap microphone, say *"changed the oil today, K5 Blazer, used Mobil 1"*. Within 5 seconds, `<EventForm event_type='service'>` opens with `summary='Oil change'`, `parts=[{name: "Mobil 1", status: "installed"}]`, `zones_touched=['engine_bay']`. Tap submit → row in `vehicle_observations`. |
| F5 | On mobile `/intake`, take a photo of a vehicle exterior. Within 3 seconds, the photo appears with a suggested form (`<EventForm event_type='condition_assessment'>` opens). Tap submit → both a `vehicle_images` row and a `vehicle_observations` row exist for the same `vehicle_id` (or as a cluster if no match). |
| F6 | Visit `https://nuke.ag/` logged out on a 375px viewport. Treemap is gone. Drop zone is the dominant element. Lighthouse mobile score for `/` is ≥ 90. The page-with-treemap still exists at `/explore` for signed-in users. |
| F7 | `curl https://nuke.ag/v1/openapi.json | jq '.components.schemas \| keys'` returns the same set as `ls docs/api/schemas/v1/`. CI fails on drift. |
| F8 | An incognito browser submits a `note` to `/intake`; the same browser then signs up via magic link; the user's profile shows the previously-submitted note attributed to them. SQL: `select count(*) from vehicle_observations where submitter_id = '<new-user-id>' and source_slug = 'guest-intake'` returns ≥ 1. |
| F9 | On any non-intake public route on mobile, the banner is visible and persistent until dismissed (localStorage). Tapping opens IntakePage as a modal overlay; submitting from the modal lands a row identical to a `/intake` page submission (verified by sql). |

If any of these tests can't be run (because the test infra doesn't exist yet), the fix isn't done. *"Don't look, just work"* applies to verification too — we ship instrumentation alongside the surface.

---

## 8. Open issues for the substrate / projection / foundation teams

Filed here so the boundary is explicit. Move to `.claude/ISSUES.md` once this paper is accepted.

- **Substrate**: F8 needs a ruling on `submitter_id` backfill vs. supersession-on-claim. Reference `agent-trust-invariants.md` rule 2.
- **Substrate**: F10 needs a `cluster` write path through `api-v1-events` (today the envelope requires `vehicle_ref`).
- **Projection**: T0.1, T0.2, T0.3 from UI_AUDIT_2026-05-05 need to land before the journal/money projections are usable as feedback for the intake flow ("submit a service event, see it on `/journal/2026-05-07`").
- **Foundation**: `<Modal>`, `<TextInput>`, `<Textarea>`, `<Select>` primitives (UI audit T2.6) are blockers for `<EventForm>` looking right. We can ship with raw HTML; the foundation team's primitives replace ours surgically post-F2.
- **Performance**: `/intake` must be lazy-loaded (it's not in the initial bundle). Performance team owns the chunk strategy; intake team owns making sure `IntakePage` doesn't import the full schema file set at module top — schemas are dynamic-imported on event-type selection.

---

*"Get the depth and then fix it. The form is the depth."* — `the-form-is-the-thing.md`
