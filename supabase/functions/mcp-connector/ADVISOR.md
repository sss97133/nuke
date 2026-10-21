# Nuke Asset Advisor (MCP)

Read-only, citation-first MCP surface for physical assets (vehicles first). Any MCP client can install it in one step and get answers that carry sources, event dates, and confidence.

**Endpoint (after deploy):** `https://nuke.ag/mcp/advisor`  
**Also:** `https://nuke.ag/mcp?surface=advisor` or header `x-nuke-surface: advisor`  
**Full connector (unchanged):** `https://nuke.ag/mcp`

## One-line install

Remote Streamable HTTP (no API key required for reads):

### Claude Code

`.mcp.json` or Claude Code MCP settings:

```json
{
  "mcpServers": {
    "nuke-asset-advisor": {
      "url": "https://nuke.ag/mcp/advisor"
    }
  }
}
```

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "nuke-asset-advisor": {
      "url": "https://nuke.ag/mcp/advisor"
    }
  }
}
```

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (HTTP MCP when supported by your Desktop build):

```json
{
  "mcpServers": {
    "nuke-asset-advisor": {
      "url": "https://nuke.ag/mcp/advisor"
    }
  }
}
```

If your client only supports stdio, use a Streamable HTTP bridge, for example:

```json
{
  "mcpServers": {
    "nuke-asset-advisor": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://nuke.ag/mcp/advisor"]
    }
  }
}
```

ChatGPT / Grok Bot / other agents: add a custom MCP connector pointing at `https://nuke.ag/mcp/advisor`.

## Tools (9)

| Tool | Job |
|---|---|
| `find_asset` | Search assets (VIN, URL, year/make/model, text) |
| `find_listings` | Live for-sale asks (price/location/source/ends_before/paging); stale excluded by default |
| `evaluate_listing` | One URL → fetch+vision+claim tags+comps+supply+value+buyers (markdown + JSON) |
| `get_asset` | Identity + specs + price facts as cited claims |
| `get_history` | Events + observations; `event_time` ≠ `ingested_at`; `price_role` separates ask/hammer/unsold |
| `explain_field` | How Nuke knows one field |
| `value_asset` | `value_low`/`value_high`, comps used, resists max-comp; flags stale/thin estimates |
| `get_comps` | Confirmed sold comps only (`price_kind=sold`); asks excluded |
| `get_coverage` | Which fields are recorded vs `not recorded` |

No write, admin, shop, or SQL tools. Anonymous reads allowed; best-effort per-IP rate limit on the advisor surface.

## Evidence envelope

Every tool returns MCP `content` (JSON text) and `structuredContent` matching `outputSchema`:

- `claims[]` — each has `field`, `value` (or `"not recorded"`), `confidence`, `confidence_basis`, `citations[]`
- `citations[]` — `source_name`, `source_url`, `observation_id`, `event_time`, `ingested_at`, `is_superseded`
- `confidence_basis` — `claim_score` \| `consensus` \| `source_trust` \| `estimate_model` \| `none`  
  When the stored observation score equals source trust, basis is `source_trust` (honest about the current data).

## Sample (Karmann Ghia BaT sale)

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "get_history",
    "arguments": {
      "asset_id": "14123fbf-7eb6-4dd6-b0ca-bbc83db06a28",
      "asset_type": "vehicle"
    }
  }
}
```

Response shape (abridged — full sample in `supabase/functions/mcp-connector/fixtures/advisor-sample-response.json`):

```json
{
  "asset_type": "vehicle",
  "asset_id": "14123fbf-7eb6-4dd6-b0ca-bbc83db06a28",
  "tool": "get_history",
  "claims": [
    {
      "field": "event.… .final_price",
      "value": 21000,
      "confidence": 0.9,
      "confidence_basis": "claim_score",
      "citations": [
        {
          "source_name": "Bring a Trailer",
          "source_url": "https://bringatrailer.com/listing/1974-volkswagen-karmann-ghia-coupe-5",
          "observation_id": null,
          "event_time": "2024-07-07T20:31:26.000Z",
          "ingested_at": null,
          "is_superseded": false
        }
      ]
    }
  ]
}
```

Note: a listing observation for the same car can have `observed_at` / `ingested_at` in 2026 (scrape) while `structured_data.sold_at` / event `sold_at` is `2024-07-07`. The advisor never promotes scrape time to `event_time`.

## Deploy

This surface lives inside `supabase/functions/mcp-connector` (same CAPABILITY_MAP owner as `/mcp`). After merge, the usual `supabase-deploy` workflow publishes the function. Vercel already rewrites `/mcp/:path*` to the connector, so `/mcp/advisor` needs no new rewrite.

Sample request/response (Karmann Ghia BaT sale): `fixtures/advisor-sample-response.json`.
