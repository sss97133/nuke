# Sales Channels Are Service-Providing Businesses

*Design synthesis, 2026-06-13. Grounds the "channels are entities" reframe in the structures that already exist, so the listing work stops being a hardcoded registry and becomes what it is: organizations we hold profiles on.*

## The principle is already in the schema

A sales channel (BaT, eBay, Bonhams) is not an integration. It is a `businesses` row whose `service_type` (the `org_service_type` enum) is `auction_house | marketplace | dealer | broker | listing_aggregator`. **That same enum also contains `restoration_shop, service_shop, parts_supplier, detailing, storage, transport, inspection, appraisal`** — so a listing venue and a mechanic and a painter are the *same node type*: a business that provides a service. "List a car on BaT" and "get the car painted" are both *consuming a service-provider business's service*. The provenance engine = understanding what service each business provides.

Source of truth: `businesses.service_type` (`database/migrations/20260124_data_lineage_and_org_services.sql`). The belief system isn't aspirational — it's the enum.

## What already exists (do not rebuild)

- **The entity**: `businesses` (~4,975 rows). Venues already live here as `service_type = auction_house`.
- **The source role**: `observation_sources.business_id` ties a data source to its business.
- **The vehicle↔channel interaction**: `organization_vehicles.relationship_type ∈ {consigner, sold_by, auction_platform, buyer, …}` — listing a car at a venue *is* this relationship.
- **The submission tracker**: `listing_exports` (status `prepared → submitted → active → sold`).
- **Universal observations/provenance**: every fact is `(amount, source, method, observed_at, trust)` with supersession + decay; observations attach to businesses (`entity_enrichment_log`, `discovered_persons`, `person_organization_roles`) exactly as they do to vehicles.
- **Readiness**: `auction_readiness` (`TIER_1_EXCEPTIONAL … TIER_4_INCOMPLETE / DISCOVERY_ONLY`).

## The duplication problem (consolidate, don't extend)

The same venue lives in ≥6 places with inconsistent slugs (`bat` vs `bringatrailer`, `cars_and_bids` vs `cars-and-bids`): `live_auction_sources`, `businesses`, `vehicle_events.source_platform`, `external_listings.platform`, `listing_exports.platform`, `observation_sources`. **`nuke_frontend/src/services/channelRegistry.ts` (the new switchboard) is a 7th duplicate, and a hardcoded one — it must be migrated INTO `businesses`, not maintained.** Canonical pair: `businesses` (the entity) + `observation_sources.business_id` (the source role).

## The real gap: the service profile is not modeled as data

There is **no structured "what it takes to provide this service" per business.** For a venue that means: required inputs (fields / photo-zones / docs), submission mechanism, fees & commission, acceptance bar (required readiness tier), and the human-key map. Today that knowledge is scattered across hardcoded edge logic (`generate-listing-package`), migration comments, inline fee constants, and `channelRegistry.ts`.

It should be **observed attributes on the business entity** — testimony with `source / observed_at / trust / decay`, observed from the venue's own docs, from our actual submissions, and from their rejections. A `$99 fee` is `(amount=9900, source=bat-faq, observed_at=2026-06, trust=0.8)`, not a hardcoded constant. This generalizes cleanly: a mechanic's `hourly_rate` and a venue's `listing_fee` are the same kind of observed service-attribute on a business.

## The human-key taxonomy (the actual product)

Consuming any business's service is one process: **eligibility → assemble inputs → authenticate → invoke → confirm → monitor.** Every step is system work *except* the irreducible human touches, which reduce to a small taxonomy stored as a facet of the service profile:

- `identity_grant` — establish the identity the business requires, once (sign-in, account link, dealer identity).
- `ownership_attestation` — "I attest this is mine."
- `contract_signature` — signed consignment/entry agreement (auction houses).
- `final_approval` — a human approves the listing copy / clicks submit (curated venues).

Per business, which keys are required is observed/derived. The optimization ("hacking for the optimal outcome") is **interrogating every human step — is this key required by law/contract, or only by current convention? — and converting every convention-step into a system-step until only the legal/testimony keys remain.** Goal: a human touches the machine only to sign a key or give testimony, then goes back to building in the world.

## Human keys are brokerable service needs (find me a gas station)

A human-in-the-loop step is not a dead-end "the owner must click." It is a **demand node** — a service need — and like any demand in the graph it gets matched to the **supply node optimally positioned to fulfill it**, and the contract is sold. This is the existing demand↔supply join (`.claude/rules/supply-side.md`: "The product is in the join"), not a new concept. "This listing needs a human to photograph the car" routes exactly like "this vehicle needs fuel → find the gas station." It should be that obvious.

- Each human-key is either **brokerable** (photography, transport, inspection, form-driving, local handoff, even consignment representation) or **owner-only** (attest ownership; sign the title transfer — or grant power-of-attorney to an agent who then can). Almost everything is brokerable.
- The provider set is the supply side: `businesses` with the matching `service_type` (`transport, inspection, appraisal, detailing, broker, …` — already in the enum). BaT's own Plus/White-Glove tiers are *BaT selling the photographer/specialist human-step* — the market already exists; Nuke's job is to be the broker that picks the optimal provider (maybe BaT's own service, maybe a cheaper local one).
- **"Optimally positioned" is a computable ranking, not a vibe** — proximity (to car / buyer / venue), capability (licensed, equipped, holds the account), relationship (existing dealer status at the venue), cost, trust, and the owner's own preference weight. Per the supply-side rule, this is a SQL join, not an AI model.
- The owner is just one candidate in that ranking — sometimes optimal (local, free, it's their car), often beaten by a positioned entity. The UI stops assuming the owner does the step; it shows "this step needs a human → optimal provider: you, or X for $Y."
- Brokering the match is itself a Nuke service (`service_type = broker`). Every human-step is a transaction to position into — this is where "we collect the money to list" actually lives, not in the API calls. The API channels are free; the human-steps are the revenue.
- A brokered step is a **delegation of authority and a provenance event**: "entity X performed the photo step, authorized by the owner, on date D" — testimony like everything else, with trust. The delegation doesn't escape the audit trail; it joins it.

The endgame of "minimize human-in-the-loop" resolves precisely: route every brokerable key to its optimal provider; the owner's only irreducible touch is the legal signature / ownership testimony. The exact line between brokerable and owner-only IS the schema we are drawing.

## Corrected plan (every line maps to a structure that already exists)

1. **Stop extending the registry.** Treat channels as `businesses` (`service_type`); consolidate the 6 scattered venue representations toward `businesses` + `observation_sources.business_id`.
2. **Model the service profile** as observed business-attributes (inputs, mechanism, fees, required-tier, human-keys) with provenance — this is the one genuine gap. Seed it from the submission-flow research already gathered.
3. **Rewire the switchboard** to read service profiles from `businesses`, not `channelRegistry.ts`. The readiness gate compares the vehicle's ARS tier to the business's *observed* required-tier.
4. **Record a listing** as an `organization_vehicles` relationship + a `listing_exports`/observation row referencing `business_id` — retire the freetext `platform` enum.

This is a strategy, not a build. The schema decisions in step 2 (how a service profile is shaped on a business) are belief-system calls and want Skylar's eyes before any canonical-entity mutation.

Related: [[the-supply-side]] · [[entity-resolution]] · the-form-is-the-thing · `.claude/rules/supply-side.md`.
