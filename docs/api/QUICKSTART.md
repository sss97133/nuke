# NUKE External Agent Write API — Quickstart

**Four calls from zero to first event written.**

This guide walks an LLM agent (or its operator) from no key to a service event rendered on the public vehicle profile. Pilot vehicle: 1966 Mustang VIN `6F07C219593`.

If you're an OEM, agent platform, or restoration shop reading this — the four calls below are the entire integration. There is no SDK, no signed contract, no onboarding call. Issue a key, post an envelope, get an `event_id`, render the result.

---

## Step 1 — Issue a key

Sign in at [https://nuke.ag](https://nuke.ag) and go to **Settings → Connected Agents** (`/settings/connected-agents`).

1. Click **Connect Agent**.
2. Name it (e.g. `Claude — Mustang sessions`).
3. Choose a scope:
   - **Write to one specific vehicle** — paste the VIN. Recommended for first integration.
   - **Write to any vehicle I own** — power-user mode; the agent picks the VIN per submission.
4. Pick an expiry (90 days is the default for agent keys).
5. Click **Issue Key**. Copy the `nk_live_…` value immediately. NUKE never shows it again.

The scope grammar is:

| Scope                                       | Meaning                                                |
| ------------------------------------------- | ------------------------------------------------------ |
| `events:write:vehicle:{VIN}`                | Write events for that one VIN only.                    |
| `events:write:all`                          | Write events for any vehicle the user owns.            |
| `events:read:vehicle:{VIN}`                 | Read events back for that VIN.                         |
| `events:read:all`                           | Read events back for any vehicle the user owns.        |
| `read` / `write` (legacy)                   | Backward-compat: equivalent to `events:*:all`.         |
| `admin`                                     | Full access. Don't issue these to agents.              |

VINs are case-insensitive on the server.

---

## Step 2 — Discover the surface

```bash
curl https://nuke.ag/v1/openapi.json
```

The OpenAPI 3.1 document describes every endpoint, every request shape, every response shape. An LLM agent should fetch this once per session and prepare submissions against it. Human-readable docs are at [https://nuke.ag/api/docs](https://nuke.ag/api/docs).

The endpoint you care about for writes is:

```
POST /v1/events
```

The full envelope schema is at [`docs/api/schemas/v1/envelope.json`](./schemas/v1/envelope.json) and the per-event-type payloads are at [`docs/api/schemas/v1/service.json`](./schemas/v1/service.json) and [`docs/api/schemas/v1/note.json`](./schemas/v1/note.json).

---

## Step 3 — Submit an event

Set your key as an env var so it doesn't end up in shell history:

```bash
export NUKE_KEY="nk_live_…"   # the value you copied in Step 1
```

Then post the Mustang service envelope:

```bash
curl -sS -X POST "https://nuke.ag/v1/events" \
  -H "X-API-Key: $NUKE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "schema_version": "1.0",
    "event_type": "service",
    "vehicle_ref": { "vin": "6F07C219593" },
    "occurred_at":  "2026-05-02T21:47:00Z",
    "submitted_at": "2026-05-02T21:48:12Z",
    "agent": {
      "id": "claude-anthropic",
      "version": "claude-opus-4-7",
      "session_id": "mustang-pilot-001"
    },
    "auth": {
      "user_id":  "00000000-0000-0000-0000-000000000001",
      "token_id": "demo-token",
      "scopes":   ["events:write:vehicle:6F07C219593"]
    },
    "payload": {
      "summary":  "Engine refresh — peripherals pulled, sludge in valve galley, deferred engine pull to morning.",
      "narrative": "Pulled both valve covers and inspected the top end. Heavy sludge in the valve galley. Photographed the door tag, strut tower stamping, and engine bay. Read plugs (mixed, rich on cylinders 3 and 5). Decided against pulling the engine tonight.",
      "work_performed": [
        "pulled valve covers (both banks)",
        "photographed door tag",
        "read plugs"
      ],
      "condition_observations": [
        { "system": "top_end",  "finding": "heavy sludge in valve galley, both banks", "severity": "concern" },
        { "system": "ignition", "finding": "plugs reading rich on cylinders 3 and 5",  "severity": "monitor" }
      ],
      "labor_minutes": 180,
      "shop_ref": "home garage"
    },
    "media": [
      { "type": "image", "url": "https://example.invalid/mustang/door-tag.jpg", "caption": "Door tag" }
    ]
  }'
```

A successful write returns:

```json
{
  "event_id":       "evt_…",
  "observation_id": "obs_…",
  "vehicle_id":     "veh_…",
  "schema_version": "1.0",
  "accepted_at":    "2026-05-02T21:48:13Z"
}
```

The full reference example envelope (with all optional fields populated) is at [`docs/api/examples/v1/mustang-session.json`](./examples/v1/mustang-session.json).

### Envelope rules

- **`schema_version`** is required. Always send `"1.0"` until told otherwise.
- **`event_type`** must be `"service"` or `"note"` in v1.0. More types ship in v1.1.
- **`vehicle_ref.vin`** is the canonical reference. `vehicle_id` is accepted if you already know it; VIN wins on conflict.
- **`occurred_at`** is when the work happened. **`submitted_at`** is when the agent finished writing the envelope. Both are required, both ISO 8601 UTC.
- **`agent`** identifies the writer for provenance. Required, never trusted as auth.
- **`auth`** is informational only — the server validates the `X-API-Key` header, not this block. Sending it lets the user audit which token issued the write.
- **`payload`** is loosely typed JSONB. Validate the strict outer envelope first, then enrich the payload over time without breaking older clients.
- **`media[]`** is optional. Storage and rights are negotiated separately for client vehicles.
- **`submission_hash`** (optional) is the SHA-256 of canonical JSON minus the hash field itself. NUKE uses it for idempotency / dedupe.

### Error responses

| Status | When                                                                  | Body                                                                     |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 400    | Envelope is malformed (missing field, bad enum, wrong shape)         | `{"error":"<reason>","field":"<dotted.path>"}`                            |
| 401    | Missing / invalid / inactive / expired `X-API-Key`                   | `{"error":"Invalid API key"}` etc.                                        |
| 403    | Key is valid but scope doesn't match `events:write:vehicle:{VIN}`    | `{"error":"Scope insufficient for events:write:vehicle:6F07C219593..."}`  |
| 404    | VIN is unknown to NUKE (no vehicle row found)                        | `{"error":"Vehicle not found","vin":"..."}`                               |
| 422    | Envelope parsed but business rules failed (e.g. `correction_of` ID)  | `{"error":"<reason>"}`                                                   |
| 429    | Per-key rate limit exhausted                                         | `{"error":"Rate limit exceeded. Retry after 60 seconds."}` + `Retry-After`|

When you see 403 with a scope error, the fix is in **Settings → Connected Agents** — issue a new key with the right scope, or upgrade the existing key to `events:write:all`.

---

## Step 4 — Verify

Open the public vehicle profile:

```
https://nuke.ag/vehicles/6F07C219593
```

The service event should appear in the timeline within ~30 seconds of the write, with the summary, narrative, condition observations, and any media you submitted.

If you don't see it: check the response body from Step 3. A 201 with an `event_id` means the write landed in `vehicle_observations` — if the timeline doesn't show it, that's a render bug, not a write bug. File at [GitHub issues](https://github.com/skylarwilliams/nuke/issues).

---

## What the API will not do (yet)

This section deliberately exists. NUKE's policy is **ship-or-shut-up** — no "coming soon" labels in the public spec. So here's what's truthfully out of scope today:

- **OAuth provider flow.** API keys with the per-vehicle scope grammar above are the only auth path right now. OAuth lands when there's a second user.
- **Public read API.** Read access goes through the authenticated UI. The `events:read:*` scopes are reserved in the grammar; the read endpoint isn't exposed publicly yet.
- **`event_type` beyond `service` and `note`.** Inspection, modification, ownership_change, media-only, etc. are reserved enum values but not yet validated server-side. They'll go live as real use cases hit.
- **Multi-tenant org accounts.** One NUKE account per integration. Shop / fleet support is a Q3 conversation.

---

## See also

- OpenAPI 3.1: [`docs/api/openapi.yaml`](./openapi.yaml)
- Strict envelope: [`docs/api/schemas/v1/envelope.json`](./schemas/v1/envelope.json)
- Reference envelope: [`docs/api/examples/v1/mustang-session.json`](./examples/v1/mustang-session.json)
- Strategy / brief: [`docs/external-agent-write-api.md`](../external-agent-write-api.md)
- Scope grammar parser (TypeScript, pure): [`supabase/functions/_shared/scopeGrammar.ts`](../../supabase/functions/_shared/scopeGrammar.ts)
