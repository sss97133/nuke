---
title: NUKE is rails, not destination
date: 2026-05-02
status: DRAFT
tags: [api, agents, strategy, mustang]
---

# NUKE is rails, not destination

**DRAFT — do not publish.** Skylar's voice; reviewed before posting.

---

## The Mustang moment

Friday night, garage, 1966 Mustang VIN `6F07C219593`. Engine refresh — peripherals pulled, valve covers off, sludge in the valve galley both banks. Late, eyes tired, plugs read mixed-rich on cylinders 3 and 5. I asked Claude to log the session to NUKE. Claude tried. Claude failed. The MCP write tool wasn't loaded — recurring auth/route bug, the kind that's been on the "fix later" list since February.

Sitting on the garage floor, holding a sludgy valve cover gasket, I realized I'd been building NUKE wrong.

NUKE shouldn't be doing the writing. The agent should. Blind. By reading a public schema.

That's the whole pitch.

## The strategic flip

The default SaaS shape is: build an app, get users to open it, capture their data, charge for retention. You become the destination.

NUKE's bet is the inversion. Users will not open NUKE. They'll open Claude or ChatGPT or whatever LLM they already trust, and they'll talk about their cars. The agent is the input layer. NUKE is the canonical write target — the place the agent posts the structured event when the conversation produces one.

Plaid for vehicle data. Stripe for restoration provenance. SMTP for the build log.

If that frame is right, the product isn't the UI. The product is the schema. And the moat isn't network effects — it's whoever owns the canonical event format for vehicle data.

Compute cost on ingestion drops to near-zero (the agent does the structuring). Distribution cost drops to zero (the agent platforms are the field reps). The ARR-times-multiple math gets replaced by strategic-infrastructure-premium math, which is a different conversation with a different kind of investor.

I'm fine with that.

## The schema as moat

A few constraints I'm not negotiating on:

**Append-only.** Every event is immutable. Corrections are new rows pointing back to the prior row via `correction_of`. Display layer composes the latest view. Git, not Wikipedia. If events can be silently edited, the trust premium evaporates and we become Carfax-with-extra-steps.

**Provenance is a field, not a vibe.** Every observation has a source, a trust score, a timestamp. The token that wrote it is recorded. If a vision model claims "cracked block" and the block isn't cracked, we want to know exactly which agent said so and at what confidence — so we can deflate the trust score, not nuke the row.

**Loose payloads, strict envelope.** The envelope is locked in OpenAPI 3.1. The payload is JSONB. Schemas evolve via additive fields, not table migrations. Real submissions will tell us what v1.1 needs; speculation will not.

**Per-vehicle scopes.** A token can be scoped to one VIN (`events:write:vehicle:6F07C219593`) or to all vehicles the user owns (`events:write:all`). The user controls revocation. Always.

## What's live today

- **`POST /v1/events`** — the canonical write surface. Service and note event types. JSONB payloads, strict outer envelope.
- **OpenAPI 3.1** at [`nuke.ag/api/docs`](https://nuke.ag/api/docs), programmatic at [`nuke.ag/v1/openapi.json`](https://nuke.ag/v1/openapi.json).
- **Quickstart** — four calls from zero to first event written: [`docs/api/QUICKSTART.md`](../../api/QUICKSTART.md).
- **Per-vehicle scope grammar** — `events:write:vehicle:{vin}` in the auth layer. Backward-compatible with existing API keys.
- **Connected Agents** settings page at `nuke.ag/settings/connected-agents` — issue, scope, view, revoke. Stripe-style developer dashboard, but for the LLM your driveway pictures live with.
- **MCP write tools** in the existing NUKE connector — `submit_vehicle_event`, `get_event_schema`, `verify_vehicle_access`. Drop NUKE into Claude desktop, talk to your Mustang, the event lands on the profile.

The Mustang itself is pilot user #1. The session that broke the old MCP path is the session that wrote the first event into the new path. That's the proof case.

## What I'm not shipping yet

- A separate "service log entry" UI on `nuke.ag`. Agents are the input layer. Read-only display is fine for v1.
- Universal vehicle ID resolution. VIN is the key. Ambiguous submissions get rejected.
- Multi-tenant org accounts. Single user only at launch. Shops come later.
- A public read API. Authenticated UI only until the privacy / DPPA story is ironclad.
- An OAuth provider. Scoped API keys are enough for one user. OAuth lands when there's a second.

No "coming soon" copy in the public spec. Vaporware kills agent integrator trust faster than missing features.

## Call to action

If you run an OEM connected-services platform, an agent platform, or a restoration / classics shop with build documentation chaos: the integration is the four calls in the quickstart. There is no SDK to install, no signed contract, no onboarding call. Issue a key, post an envelope, render the result on the public profile.

Two requests:

1. **OEMs / platforms** — let's talk about a pilot. Email me. The first integration partner gets to influence v1.1 of the schema. That's a real lever.
2. **Agent developers** — drop NUKE into your tool list. Send me your `agent.id` so I can give it a registry entry and a higher rate cap than anonymous traffic.

The rails are open.

— Skylar
