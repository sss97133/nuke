# Claude Desktop — NUKE MCP Setup

So you can re-run tonight's Mustang session and have it land via `submit_vehicle_event` instead of failing the way it did at 9 PM.

## What this gives you

Claude Desktop (the macOS app, not Claude.ai) gets a NUKE tool palette: 48 tools including the three new write tools shipped tonight — `submit_vehicle_event`, `get_event_schema`, `verify_vehicle_access` — plus the prior 45 (search, ingestion, observations, projections, etc.).

## The config snippet

Open `~/Library/Application Support/Claude/claude_desktop_config.json`. If it doesn't exist yet, create it. Add the `mcpServers.nuke` block:

```json
{
  "mcpServers": {
    "nuke": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://nuke.ag/mcp",
        "--header",
        "X-API-Key:nk_live_..."
      ]
    }
  }
}
```

`mcp-remote` is the de facto bridge for HTTP MCPs. It speaks stdio to Claude Desktop and HTTP to the remote endpoint. The `--header` arg attaches your API key to every request, so authenticated tools like `submit_vehicle_event` work.

If you already have other MCP servers configured (Linear, Postgres, etc.), keep them — just add the `nuke` key alongside them.

**Restart Claude Desktop** after editing the config. The tools won't load otherwise.

## Issuing the API key

Tools that write (`submit_vehicle_event`, `submit_observation`, `submit_attribute_value`) need an API key with the right scope.

1. Open `https://nuke.ag/settings/connected-agents` (the new page shipped tonight).
2. Create a key. Either:
   - **"Write to one specific vehicle"** — paste the Mustang VIN `6F07C219593`. Produces scope `events:write:vehicle:6F07C219593`. Recommended for the dogfood — narrowly scoped.
   - **"Write to any vehicle I own"** — produces scope `events:write:all`. Convenient but broader.
3. Copy the `nk_live_…` key. It's shown once, never again.

## Where the key goes

`mcp-remote` accepts headers via `--header` args. Pass your key:

```
"args": ["-y", "mcp-remote", "https://nuke.ag/mcp", "--header", "X-API-Key:nk_live_..."]
```

(No space after the colon — `mcp-remote` parses `Name:Value`.)

### Service role (you only)

For your own dogfooding only — never share — you can swap `X-API-Key:...` for `Authorization:Bearer $SUPABASE_SERVICE_ROLE_KEY`. Service-role auth bypasses scope checks. **Don't use this for any external integration**, only for local debugging on your own machine.

## Tonight's session — replay it

In Claude Desktop, after the restart:

> "Log my 1966 Mustang VIN 6F07C219593 session — pulled valve covers and intake, sludge in valve galley confirmed, plugs 3 and 7 wet looking at fuel mixture, decided to pull engine in morning rather than work in-car, photographed door tag and strut tower."

Claude should reach for `submit_vehicle_event` (likely after using `verify_vehicle_access` first to check scope). The expected flow:

1. `verify_vehicle_access(vin="6F07C219593")` → returns scope OK, can_write=true
2. `submit_vehicle_event(vin, event_type="service", occurred_at, payload={summary, narrative, work_performed, decisions, condition_observations})` → returns `event_id`

Then visit `https://nuke.ag/vehicles/6F07C219593`. The new event should render in the timeline with the **WORK RECORD** label (warning border).

## If it fails

Three things to check, in order:

1. **`https://nuke.ag/api/mcp` returns 200 + tools list?**
   ```bash
   curl -X POST https://nuke.ag/api/mcp -H 'content-type: application/json' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
   ```
   Expected: `48`. If 0 or HTML, the proxy or Vercel rewrite is broken.

2. **Your key works?**
   ```bash
   curl -X GET "https://nuke.ag/v1/events?vin=6F07C219593" -H "X-API-Key: nk_live_..." | jq '.count'
   ```
   Expected: integer ≥ 0. If 401, key is wrong/expired. If 403, scope mismatch — re-issue.

3. **Claude Desktop loaded the MCP?**
   In a fresh chat, ask "What tools do you have available from nuke?" — should list 48 tools. If it says "no tools," the config didn't pick up. Check the file path and restart again.

## What's still manual

- **Issuing the key.** No CLI for that yet (would mean a separate auth flow). The settings UI is the path.
- **Adding photos to events.** Tonight's payload supports `media: [{type, url, sha256}]` but Claude Desktop has no image attachment for tool calls. Photos still come in via the photo pipeline (Apple Photos / iPhoto extraction). Cross-link via `submission_hash` if you want to correlate later.

That's it. Restart, ask Claude to log the Mustang, screenshot the timeline. That screenshot is the seed-pitch artifact.
