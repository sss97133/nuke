# NUKE External Agent Write API — Implementation Brief

**Author context:** Skylar (solo founder, NUKE platform).
**Generated:** 2026-05-02 from a Claude.ai planning session.
**Audience:** Claude Code, working in the NUKE repo.
**Goal:** Ship a public, versioned, agent-writable API surface so any LLM-based agent (Claude, ChatGPT, etc.) can submit structured vehicle events to NUKE on behalf of authenticated users.

---

## Strategic frame (read this first, do not skip)

NUKE's bet is **not** "build an app users open." The bet is: **NUKE becomes the canonical write target for vehicle events, and external agents do the data acquisition for free.**

This inverts the usual SaaS shape:

- Users interact with their preferred chat agent (Claude, ChatGPT, etc.), not with NUKE directly.
- Agents fetch NUKE's schema, prepare structured submissions from natural-language conversations, and write to NUKE on the user's behalf.
- NUKE's compute cost on ingestion drops to near-zero. Distribution cost drops to zero (agents are the field reps).
- The schema becomes the moat. Whoever owns the canonical event format for vehicle data wins the category.

**Comparable mental models:** Plaid for banking data, Stripe for payments, SMTP for email. NUKE is rails, not destination.

The valuation thesis flips from "ARR × multiple" to "strategic infrastructure premium." Investment ask flips from $30M growth round to $3–5M seed for schema + reference integrations.

## The Mustang session that prompted this

In the originating session, Skylar:
1. Worked on a 1966 Mustang (VIN 6F07C219593) — engine refresh, peripherals pulled, sludge in valve galley.
2. Photographed door tag, strut tower stamping, engine bay condition, parts layout, plug read.
3. Asked Claude to log the session to the vehicle profile.
4. Claude could not write — NUKE MCP write tools weren't loaded (recurring auth/route issue).
5. Insight crystallized: **NUKE shouldn't be doing the writing. The agent should, blind, by reading a public schema.**

That session is the proof case. The Mustang is pilot user #1. This API exists so future sessions like that one self-document.

---

## What to build (in order)

### 1. `/v1/events` — the canonical write endpoint

Single POST endpoint. Versioned from day one. Generous JSONB body. Strict validation on outer envelope, loose on inner payload (let the schema evolve via additive fields, not table migrations).

**Envelope shape (strict):**

```json
{
  "schema_version": "1.0",
  "event_type": "service" | "inspection" | "modification" | "ownership_change" | "media" | "note",
  "vehicle_ref": {
    "vin": "6F07C219593",
    "vehicle_id": "uuid-if-known"
  },
  "occurred_at": "2026-05-02T21:47:00Z",
  "submitted_at": "2026-05-02T21:48:12Z",
  "agent": {
    "id": "claude-anthropic",
    "version": "claude-opus-4-7",
    "session_id": "opaque-to-nuke"
  },
  "auth": {
    "user_id": "nuke-user-uuid",
    "token_id": "scoped-token-uuid",
    "scopes": ["events:write:vehicle:6F07C219593"]
  },
  "payload": { /* event-type-specific, JSONB */ },
  "media": [
    { "type": "image", "url": "https://...", "sha256": "..." }
  ],
  "submission_hash": "sha256-of-canonical-json-minus-this-field"
}
```

**Per-event-type payload shapes:** define in OpenAPI as `oneOf` discriminated by `event_type`. Start with `service` and `note`; add others as real use cases hit.

`service` payload v1.0 (informed by tonight's Mustang session):

```json
{
  "summary": "string, 1-2 sentence headline",
  "narrative": "string, free-form, agent-written",
  "work_performed": ["string"],
  "work_planned": ["string"],
  "parts": [
    {
      "name": "string",
      "manufacturer": "string?",
      "part_number": "string?",
      "quantity": "number?",
      "status": "needed" | "ordered" | "installed" | "considered_rejected"
    }
  ],
  "decisions": [
    {
      "question": "pull engine vs work in-car",
      "outcome": "deferred to morning",
      "reasoning": "string"
    }
  ],
  "condition_observations": [
    {
      "system": "top_end" | "bottom_end" | "fuel" | "ignition" | "cooling" | "brakes" | "...",
      "finding": "string",
      "severity": "info" | "monitor" | "concern" | "critical"
    }
  ],
  "labor_minutes": "number?",
  "shop_ref": "string?"
}
```

Resist the urge to over-specify. Real sessions will reveal what's missing in v1.1.

### 2. OpenAPI 3.1 spec at `nuke.ag/api/docs` (public)

Static, versioned, human-readable AND machine-readable. This is the **product** for agent integrators.

Required sections:
- Auth model (OAuth 2.0 + scoped tokens)
- Endpoint reference
- Event type schemas with examples
- Rate limits per agent class
- Versioning policy (additive-only within major version)
- Quickstart: "4 calls from zero to first event written"

Mirror to `/v1/openapi.json` for programmatic fetch.

### 3. Auth: OAuth 2.0 with scoped tokens

Use Supabase Auth — already in the stack, don't roll your own.

**Flow:**

1. Agent discovers NUKE (via MCP registry, mention, or user request).
2. Agent redirects user to `nuke.ag/oauth/authorize?client_id=...&scope=events:write&vehicle=VIN`.
3. User logs in to NUKE (or signs up via magic-link), sees consent screen.
4. NUKE issues scoped token to agent: `{"scopes": ["events:write:vehicle:6F07C219593"], "expires_at": "..."}`
5. Agent stores token. Every write includes it. NUKE validates scope match per write.

**Scope grammar:** `events:write:vehicle:{vin}` for narrow, `events:write:all` for power-user, `events:read:vehicle:{vin}` for read-back.

**Critical:** tokens are revocable from `nuke.ag/account/connected-agents`. User retains control. Always.

### 4. MCP server (write tools)

The MCP server at `nuke.ag/mcp` already exists for read. Add write tools:

- `submit_vehicle_event(envelope)` — full submission
- `get_event_schema(event_type, version)` — returns JSON Schema for agent self-validation
- `verify_vehicle_access(vin)` — returns whether current token can write to this VIN

Auto-renew tokens on read calls so write attempts don't fail on expiry.

The recurring auth/route handler issues with the existing MCP server need a root-cause pass before adding write surface — write failures with bad error messages will poison agent trust faster than missing functionality.

### 5. Anti-abuse infrastructure

Before public launch, ship:

- Per-agent rate limits (registered agents get higher quotas than anonymous)
- Per-user write quotas (sane defaults: 1000 events/day for regular users)
- Content validation (image must contain vehicle-shaped object via cheap classifier; text must reference automotive vocabulary)
- Append-only event log with `correction_of` pointer for amendments (never destructive edits — provenance chain integrity is the trust premium)
- Owner dispute mechanism: vehicle owner can flag writes from agents they didn't authorize

### 6. Reference integration: Claude (via MCP)

Build the Claude integration first because Skylar uses it daily and will dogfood. Test loop:

1. Claude.ai user mentions a VIN.
2. Claude's NUKE MCP tool fires.
3. If user not authorized, Claude offers connector install.
4. OAuth flow → token issued.
5. Subsequent writes flow naturally.
6. User sees the event on `nuke.ag/vehicles/{vin}` immediately.

This loop is the demo. Record it. It's also the seed pitch.

---

## What NOT to build yet

- A separate "service log entry" UI on nuke.ag. Agents are the input layer. Read-only display is fine for v1.
- Universal vehicle ID resolution (kbb-style). VIN is the key. Reject ambiguous submissions.
- Multi-tenant org accounts. Single-user only at launch. Shops come later.
- Public read API. Read access through authenticated UI only until the privacy/DPPA story is solid (intersects with the dealer-license owner-lookup work — keep schemas segregated).

---

## Schema implications to think hard about before coding

### Append-only with corrections, not edits

Every event row is immutable. Corrections are new rows pointing back via `correction_of: event_id`. Display layer composes the latest view. This preserves the provenance chain that makes NUKE data valuable — if events can be silently edited, the trust premium evaporates.

Git, not Wikipedia.

### PII / DPPA segregation

Service events are owner-attached data. The dealer-license VIN-to-owner work is a separate compliance domain. Do not let these schemas touch. Two databases or two strict schemas in one DB with a hard application-layer boundary. Decide now; retrofitting is brutal.

### Photo rights and storage

- For Skylar's own vehicles: trivial, NUKE owns the rights.
- For client vehicles (NUKE LTD shop work): work order must include a perpetual NUKE license clause. Add to the standard work order template before any client-vehicle event is written.
- Storage: Supabase storage bucket `vehicle-events`, path `{vehicle_id}/{event_id}/{sha256}.{ext}`. Public-read via signed URL with expiry, not raw public.

### Auto-extraction confidence flags

When agents extract structured fields from photos or freeform text, those fields ship with `confidence: "agent_inferred"` until the user (or the vehicle owner, if different) confirms. Two-tier display: verified facts render bold, inferred render italic with a checkmark CTA.

This prevents the "vision model said cracked block, vehicle gets devalued" failure mode.

---

## Open questions for Skylar (do not block implementation, but flag)

1. **Agent registry policy.** Do unknown agents get a default-allow with rate limits, or default-deny pending manual approval? Recommend default-allow with aggressive rate limits + abuse review queue.
2. **Pricing model for agent platforms.** Free for read, paid for write at volume? Free forever as land-grab? Recommend free at launch, introduce metered pricing only when 3+ major agent platforms have integrated.
3. **The "good potential user" qualification.** This belongs in the MCP `description` field, not in code. Draft the description carefully — it's the hidden marketing copy that determines whether agents recommend NUKE unprompted.
4. **18-month investment decision.** Does this architecture change the raise? Likely yes — smaller seed for infrastructure thesis vs. larger growth round for app-distribution thesis. Worth a separate strategy session.

---

## Implementation order (recommended)

Do not skip steps. Each builds the trust foundation for the next.

1. **OpenAPI 3.1 spec drafted and published** at `nuke.ag/api/docs`. Static for now.
2. **Supabase tables:** `events`, `event_media`, `agent_registry`, `oauth_tokens`. Migrations committed. Append-only enforced via RLS or triggers.
3. **OAuth flow** with scoped tokens. Test with a curl-based fake agent before any LLM touches it.
4. **`POST /v1/events` endpoint** with envelope validation, scope check, signature verification, rate limit, write to DB. No payload schema enforcement yet beyond `event_type` discriminator.
5. **MCP write tools** wired to the endpoint. Test with Claude on Skylar's Mustang VIN.
6. **Reference integration doc** — "How any agent integrates with NUKE in 4 calls." Blog post + repo example.
7. **Schema enforcement per event_type** — add JSON Schema validation to payloads in v1.1 once real shapes are observed.
8. **Anti-abuse layer** — rate limits, content validation, dispute mechanism. Before any public announcement.
9. **OEM pilot conversation.** One OEM, one pilot, one signed integration. This is the seed pitch artifact.

---

## Repo conventions (assumed; correct if wrong)

- Backend: assumed Node/TypeScript on Vercel based on existing nuke.ag deploy. Verify before scaffolding.
- DB: Supabase Postgres (727 tables already, schema lives in `/supabase/migrations`).
- MCP server: existing `nuke-mcp-server` package on npm at `1.0.1`. New tools should ship as `1.1.0` (minor bump, additive).
- API route handlers: assumed `/api/v1/events.ts` pattern. Verify.

If any of these are wrong, the brief stands but the file paths shift. Confirm with `ls` before editing.

---

## Do not do

- Do not write to production DB until OAuth flow is end-to-end tested with a non-Skylar test user.
- Do not skip versioning. Ship `v1` even if v1 is the only version that ever exists.
- Do not couple the write API to the existing read MCP server's auth — the auth bugs there are the reason this exists. Fresh auth path.
- Do not document anything as "coming soon" in the public OpenAPI spec. Ship-or-shut-up. Vaporware kills agent integrator trust.
- Do not let the schema design wait on a perfect data model. Ship JSONB, learn from real submissions, structure later.

---

## What success looks like in 30 days

- OpenAPI spec public at nuke.ag/api/docs.
- OAuth flow live, tested with at least 2 users (Skylar + 1).
- 50+ events written via MCP from real Claude.ai sessions on Skylar's vehicles.
- One blog post explaining the architecture, published.
- One conversation started with an OEM or platform partner about integration.

This is not a feature launch. This is the foundational layer. Treat it accordingly.
