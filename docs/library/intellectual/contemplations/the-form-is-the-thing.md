# The Form Is the Thing

> "It's not just mobile but I should be able to access through Claude on my phone and Claude will submit it for me with its interpretation of what it's seeing and then it's gonna fill in the form shape that we require."
> — Skylar, 2026-05-02 (the night the moat became visible)

---

The session started in the wrong place. We were arguing about OAuth. Token endpoints, magic-link redirects, fragment-only callbacks, the two open Anthropic client bugs. Hours of it. We were building plumbing as if plumbing were the product.

Then Skylar pulled the cord.

> "We need it to work perfectly for one user and then we will define… the ingestion process, then we start practicing scale."

The form is the thing. Everything else is plumbing to deliver Claude to it.

---

## What the system does, plainly

A vehicle is an immutable entity. Testimony attaches to it from many sources at many times. The library calls this the provenance engine. The truth is that nobody knows the truth — the system stores claims, weighted by source, decayed by time, and lets convergence approximate it.

For five years that testimony came from auctions, comments, listings — sources that already had structure. We scraped HTML and pulled fields. The shape was given to us by the source.

Now the source is a person standing in a garage with a phone and a vision agent. There is no HTML. There is a photo and a sentence. The shape has to come from somewhere else.

It comes from the form.

---

## What a form-shape is

The form-shape is the contract Claude reads before it writes. It is per-event-type — `service`, `inspection`, `modification`, `note`, `condition_assessment`. For each one, we publish a JSON Schema with required and optional fields, enums where the answer is bounded, length limits where it isn't. And alongside the schema, we publish a checklist: for every field, an annotation telling Claude where the answer comes from.

- **vision-fillable** — Claude can populate this from the photo alone. Engine bay zone? Look at the photo. Severity of a leak? Look at the photo.
- **context-fillable** — Claude can populate this from what the user just said. Labor minutes. Shop name. Why we did the work.
- **tool-fillable** — Claude has to call another tool. VIN lookup. Recent service history. Resolving a vehicle reference.

That triplet is the moat. Without it, a vision agent is just a verbose camera. With it, the agent has a checklist, and the output is structured testimony that lands on the timeline with attribution.

---

## Why a permissive schema isn't enough

I built loose schemas first. `additionalProperties: true`, optional everything, just-give-me-something. The thinking: agents are smart, the system will figure it out, structure can come later.

That was wrong. Vision agents without a form will hallucinate structure. They will invent fields. They will write `paint_condition: "lovely"` in one submission and `exterior_paint: "nice"` in the next. The data lands, but it doesn't compose. Two months later you can't query it. Six months later you've lost the testimony — it's there in the JSONB but it's noise.

A vision agent with a form has a checklist. It fills the fields. The fields are the same on every submission. The data composes. The timeline renders. The vehicle profile gets denser, not noisier.

> "Get the depth and then fix it."

The form is the depth. The depth is the form.

---

## The library's load-bearing axiom, enforced

The library has said for a long time that this is a provenance engine for testimony. Vehicles are the immutable entities. Observations are the testimony. Sources have trust. Time has decay. Convergence is the approach to truth. That is in the encyclopedia, the contemplations, the rules. It has always been there.

But until tonight, the testimony was shaped by the source. A BaT listing has its own structure. A Mecum extraction has its own structure. A receipt has its own structure. The observation table accepted whatever the source produced, and the system did its best to compose it.

When the source becomes Claude reading a photo, there is no native structure. The form-shape becomes the source of structure. It is not metadata about the testimony — it IS the testimony's shape. Without it, Claude's interpretations are narrative. With it, they are atoms.

The form-shape is the enforcer of the testimony axiom in the agent era.

---

## Two surfaces, one form

REST and MCP are two ways to deliver Claude to the form. They consume the same JSON Schemas. They return the same checklist. The auth differs (X-API-Key on REST, OAuth on MCP for claude.ai compatibility), but the contract is identical: read the checklist, fill the form, submit.

The point is that there is one form. Whatever transport, whatever client, whatever auth — the agent fills the same fields and the testimony lands the same way. That's why the form is the moat: it is the single thing every agent has to agree to. Everything else can vary.

---

## What this means for the work

Every new event type that gets added is a new form. The work is not "add an endpoint." The work is "design the form": what does Claude need to fill, and where does each field come from? When the form is right, the endpoint is trivial. When the form is wrong, no amount of API polish makes the testimony composable.

OAuth, scopes, rate limits, telemetry — that is plumbing. Document it, ship it, monitor it, but do not lead with it. Lead with the form.

> "It's gonna fill in the form shape that we require."

The form is the thing. The form is the thing. The form is the thing.
