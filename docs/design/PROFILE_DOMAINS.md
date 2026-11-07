# Profile domains: inferred, never asked

Status: **proposal for Skylar's review**. Nothing here is built yet. It replaces the
"What brings you here?" persona screen (#2993), which was removed because it asked people to
declare a role (`docs/design/CONSTRAINTS.md` C2: *"We never ask for what we can read."*).

## What a "domain of development" is

A domain is an area where a person has **shown** work: engine, paint and body, fabrication,
wiring, upholstery, buying and selling, collecting, documenting, and so on. A profile is the set of
domains the evidence supports, each with a strength, a confidence and its citations. It is a
reading of observations, not a form.

## Grounding

- `CONSTRAINTS.md` C2: the door is the first datum, use what arrives with them, never ask for what
  we can read. C3: time to comprehension runs both ways.
- `MECH_SUIT.md`: the observer is a black box, and their data is the constraint. Build on what
  exists, not a parallel greenfield.
- `STRUCTURAL_FOUNDATION.md`, "The Annoyance Threshold" and the resolution hierarchy: observations,
  then cross-reference, then pattern inference, then public data, then community, and only then the
  person. If the evidence runs out, accept uncertainty. Learn and never ask the same thing again.
- `docs/library/technical/design-book/vehicle-profile-computation-surface.md`, Level 4
  (Technician): specialization match, a track record across all vehicles they have touched, and
  hours per operation over time. Specialization is computed.

## Principles

1. **Many observations drive a profile, and one image can anchor it.** A single close-up of a
   freshly TIG-welded bracket is enough to open a "fabrication" domain at low confidence. Later
   evidence moves it up or down.
2. **Groupings come from patterns across images from a common origin.** Same device (EXIF
   serial/model), same place (GPS cluster), same session (time adjacency), same vehicle (VIN or
   attributed vehicle_id). Images from one origin that show the same kind of work form a group, and
   the group is the unit of evidence.
3. **Never group on string coincidences.** A shared name, a similar shop name, or a keyword in a
   caption is not a link. Links need a structural key: an id, a device serial, a VIN, a signed
   work order, or a referral token.
4. **A gap means not yet ingested.** No paint evidence does not mean "not a painter". It means no
   paint evidence has arrived. Domains never decay to "no", and the UI never says "you don't do X".
5. **Roles are inferred from action patterns.** Before/after close-ups on the same component over
   time suggest a mechanic. Paint work across vehicles tied to several organizations suggests a
   freelance painter. Listing, transfer and sale events suggest a buyer or seller. Every inference
   has a confidence and cites its evidence.
6. **The entry link is the first datum.** The door someone came through is a prior, weak and
   replaceable, used before any photo is read.

## Signals (tables that exist today)

| Signal | Source | What it says |
|---|---|---|
| Entry door | `vehicle_contributor_invite_visits` (invite_id, action, ref_id), `vehicle_contributor_invites`, `business_invite_codes`, plus the app's link slug or referral param (C2.1: instrument the doors) | Prior: a shop invite suggests a tech, a shared vehicle suggests an owner or contributor, an agent or MCP referral suggests agent-land |
| Image evidence | `vehicle_images` (user_id, documented_by_user_id), `image_observations`, `user_image_deep_reads` | What is in the frame: component, stage (before, in progress, after), tools, technique |
| Common origin | `device_attributions` (camera_serial/model, GPS, datetime_original, contributor_id) | Groups images by device, place and time without any string matching |
| Sessions | `work_sessions` (start/end image, zones_touched, stages_observed, stage_transitions, work_type, intent, intent_confidence, technician_id, place_id) | Before and after on one component within one session is the mechanic pattern |
| Work orders | `work_orders`, `work_order_assignments`, `work_order_labor`, `work_order_evidence_images`, `work_order_completion_attestations` | Signed, paid work: the strongest role evidence |
| Organization span | `organization_vehicles`, `organization_contributors`, `vehicle_contributor_roles` (shop_id) | The same kind of work across several organizations suggests a freelancer, not staff |
| Person observations | `user_observations` (kind, source, trust, confidence_score, confidence_factors, related_observation_ids) | Off-platform facts (external profiles, posts), each with trust |
| Tools | `user_tools` | Supports, never decides (owning a spray gun is not painting) |
| Market acts | listing and sale events tied to the user | Buyer or seller pattern |

## Inference: confidence and citations

Build on the fold that already exists rather than a new table:

- `actor_capabilities` (actor_id, capability_type, strength, evidence_count, direct_count,
  corroborating_count, against_count, first/last_demonstrated, derivation, folded_at) is the domain
  row.
- `actor_capability_basis` (basis_kind, basis_id, direction, strength, work_order_id,
  demonstrated_on, reason) is the citation row. Every domain on a profile must resolve to basis
  rows a person can open (the image, the session, the work order).
- `specialization_taxonomy` (slug, parent_slug, often_paired_with) provides the domain vocabulary.
  **Caveat:** its `detection_keywords` column is exactly the string matching that principle 3
  forbids. Keep the slugs and the hierarchy, and drop keyword detection from the inference path.

Confidence per domain (sketch, to be tuned):

```
confidence = 1 - Π over evidence groups (1 - w_kind · trust_source)
  w_kind:  signed/paid work order 0.8 · same-session before/after 0.6 · single image anchor 0.3
           · cross-org repetition +0.2 bonus · entry-door prior 0.15 · tool ownership 0.05
  groups:  images from one origin (device × place × session) count once, so 400 photos from
           one afternoon do not outweigh 5 separate jobs
  against: user correction or contradicting evidence lowers confidence; absence never does
```

Roles are derived from domains plus pattern: mechanic (repair or before/after domains, repeated),
painter (paint domain; freelance if it spans 2 or more organizations with no staff role), shop
(an organization with assignments to others), buyer/seller (market acts), collector (many vehicles
held, little work). Each role shows its confidence and its "because" line, for example:
*"Paint: 3 jobs, 2 shops: Viva (Jun), K10 build (Aug). [see photos]"*

## Correcting without filling anything in

- **Act on the evidence, not a form.** Each inferred domain chip opens its citations. Long-press
  gives two actions only: *"Not mine"* (the basis gets `direction = against`, for example a photo
  someone else took) and *"Hide"* (the domain stays, but not publicly). There is no free text and no
  add-a-skill picker.
- **Misattribution goes to the existing path.** "Not mine" on an image goes to
  `image_attribution_review` / `reattribution_audit`, so the fix improves attribution for everyone,
  not only this profile.
- **Show your work to grow a domain.** The only way to add a domain is to add evidence: shoot the
  job, attach the work order. That matches C2 and the resolution hierarchy.
- **If it must ask, ask once.** Under the Annoyance Threshold, a single targeted question is allowed
  only when one critical fact blocks everything and every automated step is exhausted. It is asked
  in context ("Were these 40 photos at Viva yours?"), and the answer becomes a basis row.

## Choosing the starting tab with no question

In order, first match wins:

1. **Entry door.** A work or job invite opens Work (Today). A shared vehicle opens that vehicle.
   A shop invite opens Garage.
2. **Ignition scan result.** After the first-run library scan, the top domain by confidence (at or
   above 0.5) picks the tab: work domains open Today, vehicles held open Garage, market acts open
   Explore.
3. **Otherwise Explore** (today's `MainTabView.defaultTab`).

No tip banners. The first screen shows the person their own evidence, organized (C2.2: "the first
conviction moment is the system showing the user their own life").

## Open questions for Skylar

1. Is this the "domains of development" you meant: trade areas (paint, fab, wiring), or also
   vehicle domains (makes, eras) and business domains (selling, running a shop)?
2. Should domains be per person only, or also per organization (rolling up members' basis)?
3. Thresholds: what confidence makes a domain public on a profile, and should low-confidence
   domains be visible only to the owner?
4. `specialization_taxonomy`: keep its 33 slugs as the vocabulary, or derive the vocabulary from
   `image_observations` clusters?
5. Do work orders outweigh photos, or are they equal evidence once attributed?
6. Which doors exist today with distinct slugs, and which need instrumenting first?
7. Are `contributor_intake_questions` (per-vehicle intake prompts) a similar self-declaration
   surface that should get the same review?
