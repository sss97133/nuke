# Chapter 7: The External Agent Write API

The platform's bet: NUKE is not the destination — it is the rails. External LLM agents (Claude, ChatGPT, etc.) read the schema and write structured vehicle events on behalf of authenticated users. The schema is the moat.

This chapter documents the v1 surface that ships May 2026.

---

## Why this exists

The originating session (2026-05-02): Skylar worked on a 1966 Mustang VIN `6F07C219593`. He photographed the door tag, pulled the valve covers, found sludge in the valve galley. He asked Claude to log the session to the vehicle profile. Claude couldn't write — the MCP write tools weren't loaded due to a config issue.

The insight crystallized: NUKE shouldn't be doing the writing. The agent should — blind, against a published schema. NUKE supplies envelope contracts, scope tokens, and substrate. Distribution becomes free because every chat agent becomes a field rep.

Comparable mental models: Plaid for banking data, Stripe for payments, SMTP for email. NUKE is rails, not destination.

---

## What ships in v1

### Two surfaces, same substrate

External agents reach the write path two ways. Both land in `vehicle_observations` via `ingest-observation`.

**REST** — `POST nuke.ag/v1/events` with X-API-Key auth. Documented at `nuke.ag/api/docs` (Redoc) with the spec at `nuke.ag/v1/openapi.json`. Read-back via `GET nuke.ag/v1/events?vin={VIN}`.

**MCP** — Tools `submit_vehicle_event`, `get_event_schema`, `verify_vehicle_access` on the `mcp-connector` edge function (reachable via `https://nuke.ag/api/mcp`). Identical envelope to the REST surface; the MCP wraps the REST endpoint internally.

### Envelope shape (strict)

The outer envelope is closed; additional properties rejected. The `payload` is loose-but-validated against a per-`event_type` JSON Schema (Draft 2020-12).

```json
{
  "schema_version": "1.0",
  "event_type": "service" | "note",
  "vehicle_ref": { "vin": "6F07C219593" },
  "occurred_at": "2026-05-02T21:47:00Z",
  "submitted_at": "2026-05-02T21:48:12Z",
  "agent": { "id": "claude-anthropic", "version": "claude-opus-4-7", "session_id": "opaque" },
  "auth": { "user_id": "uuid", "token_id": "uuid", "scopes": ["events:write:vehicle:6F07C219593"] },
  "payload": { /* per-event-type */ },
  "media": [ { "type": "image", "url": "...", "sha256": "..." } ],
  "submission_hash": "sha256-of-canonical-json-minus-this",
  "correction_of": "uuid-of-prior-event-being-superseded"
}
```

VIN is the canonical key. The endpoint resolves VIN → vehicle_id internally; agents never see Nuke's UUIDs unless they ask. If the VIN doesn't resolve to an existing vehicle, the endpoint returns 404 with a helpful message (no auto-create in v1 — vehicle creation is a separate concern with stronger preconditions).

### Substrate routing

| `event_type` | `observation_kind` | `source_slug` |
| --- | --- | --- |
| `service` | `work_record` | `shop` |
| `note` | `comment` | `agent-submission` |

Reserved but not yet routed: `inspection`, `modification`, `ownership_change`, `media`. Submissions for those return 400 until v1.1.

The mapping is intentional. `work_record` already exists in the `observation_kind` enum (see Chapter 2 for the full list); we did not add new enum values for v1. The two new sources (`shop`, `agent-submission`) were registered in `observation_sources` with `category='shop'` and `category='agent'` respectively, both pre-existing categories.

### Append-only with corrections

Per the trust invariant (see `docs/library/intellectual/contemplations/the-trust-invariant.md`), nothing in `vehicle_observations` is ever destructively edited. Corrections submit a new event with `correction_of` pointing at the prior event_id. The endpoint:

1. Writes the new row first.
2. If `correction_of` is set, looks up the prior row.
3. Verifies the caller owns the prior row (`submitted_by_user_id` match) OR holds `events:write:all`/`admin` OR is service-role.
4. If authorized, marks the prior row `is_superseded=true`, `superseded_by={new_id}`, `superseded_at=now`.

If unauthorized, the supersession is silently skipped (logged). The new row still lands; it just doesn't supersede anything. This avoids leaking row existence.

Read-back filters superseded rows by default. Pass `include_superseded=true` to walk the full provenance chain.

---

## Authentication

### X-API-Key

The primary auth path. Agents present `X-API-Key: nk_live_…` headers. The `_shared/apiKeyAuth.ts` helper:

1. Hashes the key with SHA-256.
2. Calls `check_api_key_rate_limit(p_key_hash, p_endpoint)` RPC — atomic check, validates active+expiry, decrements remaining count, returns scopes.
3. The endpoint then calls `requireVehicleScope(auth, 'write', vin)` (or `'read'` for GET) which delegates to `_shared/scopeGrammar.ts`.

### Scope grammar

```
events:{action}:{target}
  action ∈ {read, write}
  target ∈ {all} | vehicle:{VIN}
```

Examples: `events:write:vehicle:6F07C219593`, `events:write:all`, `events:read:vehicle:…`, `events:read:all`.

Legacy keys (`read`, `write`, `admin`) are kept for back-compat:
- `admin` matches everything
- `write` matches any `events:write:*` request
- `read` matches any `events:read:*` request

Write scopes do NOT implicitly grant read; be explicit (cheap to add the read scope alongside write at issuance time).

### Service role

`Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}` bypasses scope checks. Only used internally (cockpit, MCP connector internal calls, smoke tests). Never share externally.

---

## Architecture decisions worth knowing

### Why no new `events` table

The brief originally proposed `events` and `event_media` tables. Phase-1 recon found `vehicle_observations` already implements every constraint the brief required:

- Append-only via `is_superseded`/`superseded_by` (Git-not-Wikipedia)
- Source-agnostic via `source_id` → `observation_sources`
- VIN-keyed via entity resolution in `ingest-observation`
- Lineage via `merged_from_vehicle_id`
- Confidence scoring built in

Adding parallel tables would have created two provenance chains and two write paths. The decision: route through the existing one-true-path (`ingest-observation`) and let `observation_kind`/`source_slug` discriminate the new event types. Hard Rule #2 (don't create new tables without justification) was the tiebreaker — there are 1,013 tables already, 483 empty.

### Why no OAuth provider in v1

The brief proposed a full OAuth 2.0 provider flow. Phase-1 recon found `_shared/apiKeyAuth.ts` already implements rate-limited X-API-Key auth with scope arrays. Adding OAuth means new endpoints (`/oauth/authorize`, `/oauth/token`), new tables (`oauth_tokens`), new UI (consent screen), token refresh, and ~12 hours of work for a platform with zero external integrators today.

The decision: extend the existing API-key surface with per-vehicle scope grammar. Path A from the plan. 0 net-new edge functions, 0 net-new tables, 0 new auth concepts. Revisit OAuth if Phase-5 dogfood demand justifies it.

The Connected Agents settings page (`/settings/connected-agents`) is the issuance UI. Users create a key, scope it to a VIN, paste into their agent's config. Revoke from the same page. Backed by the same `api_keys` table as developer keys — different mental model, same substrate.

### Why VIN, not vehicle_id

Agents don't know NUKE's internal UUIDs. They know what the user said, and the user says VINs. Forcing agents to call `search_vehicles` first to translate VIN → UUID adds a round-trip and a failure mode (what if the search returns ambiguous matches?). The endpoint resolves internally.

Pre-1981 VINs (5–17 characters, like the Mustang's 11-char `6F07C219593`) are accepted. The regex is `^[A-HJ-NPR-Z0-9]{5,32}$`.

### Why the envelope's `auth` block is advisory

The envelope includes `auth: { user_id, token_id, scopes }`. This is documentary — the agent declares what scopes it thinks it has. NUKE ignores it for authorization decisions; only the `X-API-Key` header is authoritative. The advisory block exists so submissions are self-describing in audit logs and so agents can pre-flight check (call `verify_vehicle_access` to learn what their key really carries).

---

## What's not yet shipped

- **Event types beyond `service` and `note`**: `inspection`, `modification`, `ownership_change`, `media` are reserved in the envelope but return 400. Add per-event-type JSON Schemas + routing entries when first real demand hits.
- **Webhook fan-out on event write**: the platform has webhook infra (`webhooks-manage`), but events written through `/v1/events` don't currently fire any webhooks. Add when an integrator asks.
- **Anti-abuse content classifier**: brief proposed a "must contain vehicle-shaped object" classifier. Deferred to v1.1; dogfood is single-user (Skylar).
- **OAuth provider flow**: deferred per architecture decision above.
- **Dispute mechanism**: vehicle owner flags writes from agents they didn't authorize. Deferred to v1.1.
- **Owner-rights story for client vehicles**: NUKE LTD shop work on customer vehicles needs a perpetual-license clause in the work order template before any client-vehicle event can be written through this API. This is a pre-publication legal item, not a code change.

---

## Cross-references

- **The Mustang** is pilot user #1. VIN `6F07C219593`. Vehicle ID `83f6f033-a3c3-4cf4-a85e-a60d2c588838`. Year 1966, make Ford, model Mustang.
- **OpenAPI spec**: `docs/api/openapi.yaml` (canonical), `nuke_frontend/api/v1/openapi.json` (programmatic mirror).
- **JSON Schemas**: `docs/api/schemas/v1/{envelope,service,note}.json`.
- **Quickstart for integrators**: `docs/api/QUICKSTART.md` ("4 calls from zero").
- **Skylar's Claude Desktop setup**: `docs/api/CLAUDE_DESKTOP_SETUP.md`.
- **Scope grammar reference**: `supabase/functions/_shared/scopeGrammar.ts` + `scopeGrammar.test.ts` (23 tests).
- **Trust invariant**: `docs/library/intellectual/contemplations/the-trust-invariant.md` and `.claude/rules/agent-trust-invariants.md`.
- **Brief**: `docs/external-agent-write-api.md`.
- **Build plan**: `~/.claude/plans/humble-drifting-backus.md`.
- **The night the API shipped**: 2026-05-02 → 2026-05-03, multi-team overnight build (4 parallel workstreams). DONE.md captures the timeline.
