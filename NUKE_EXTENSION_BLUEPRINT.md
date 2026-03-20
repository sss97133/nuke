# Nuke Extension Blueprint — One-Shot Implementation Guide

**Purpose:** This document contains everything needed to build, fix, and ship the Nuke Claude Desktop extension in a single session. Every code change is specified. Every tool maps to an existing ingestion path. Every contribution fills specific empty schema dimensions.

---

## THE SCHEMA GAP — What's Empty, What the Extension Fills

### Current State: 808 tables, 14,706 columns

| Domain | Tables | Populated | Empty | Rows | Extension Fills Via |
|--------|--------|-----------|-------|------|-------------------|
| **Vehicles (core)** | ~15 | 15 | 0 | 648K | search, extract, ingest |
| **Vehicle Images** | ~5 | 5 | 0 | 32.7M | submit_photos, analyze_image |
| **Observations** | ~8 | 4 | 4 | 117K obs, 108K evidence | contribute_observation |
| **Digital Twin (components)** | ~120 | 0 | **120** | **0 rows** | contribute_observation (structured_data) |
| **Organizations** | ~11 | 3 | **8** | 1.2K orgs | register_organization |
| **Actors/People** | ~6 | 1 | **5** | ~500 | link_actor_to_vehicle |
| **Locations** | ~4 | 1 | **3** | ~800 | implicit (from observations) |
| **Market Intelligence** | ~8 | 4 | 4 | 45K prices | get_comps, get_valuation |
| **Users/Profiles** | ~6 | 2 | 4 | ~100 | implicit (API key creation) |
| **Library (reference)** | ~15 | 5 | 10 | 419 RPO, 76 paint | contribute_observation (kind='specification') |

**Key insight:** The digital twin layer (120 tables, ~2,800 columns) is structurally complete but has ZERO rows. Every user observation that includes structured component data (engine specs, drivetrain details, interior materials) can flow into this layer via the extraction pipeline.

### The Five Data Dimensions the Extension Must Feed

```
1. VEHICLE IDENTITY     → ingest/, extract-vehicle-data-ai
   (year, make, model, VIN, discovery)

2. VEHICLE STATE         → ingest-observation (kind='condition', 'specification')
   (current condition, modifications, mileage, component state)
   → Fills: digital twin tables (engine_*, drivetrain_*, body_*, etc.)

3. MARKET INTELLIGENCE   → ingest-observation (kind='sale_result', 'valuation', 'bid')
   (prices, comps, deal quality, trends)
   → Fills: auction_events, price_history, nuke_estimates

4. ACTOR NETWORK         → ingest-observation (kind='ownership', 'work_record', 'provenance')
   (who touched this car: builders, shops, owners, inspectors)
   → Fills: organizations, actors, actor_vehicle_events, work_orders

5. EVIDENCE CHAIN        → field_evidence (every claim with source + confidence)
   (provenance for every data point)
   → Fills: vehicle_field_evidence, observation metadata
```

---

## PART 1: P0 BUG FIXES (Must Fix Before Ship)

### Fix 1: `get_vehicle` / `list_vehicles` Auth (401 Error)

**Root cause:** `api-v1-vehicles` checks auth via `authenticateRequest()` which validates service role key by comparing against `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`. The MCP server sends the service role key as `Authorization: Bearer <key>`. This SHOULD work — the auth function checks `if (token === serviceRoleKey)`.

**Actual issue:** The `api-v1-vehicles` function does path routing (GET /vehicles, GET /vehicles/:id, POST, PATCH). When the MCP calls `callAPI("vehicles", "/${vehicle_id}")`, the URL becomes `/functions/v1/api-v1-vehicles/<uuid>`. Supabase edge functions receive the path AFTER the function name, so the function gets `/<uuid>` as the path.

**Debug approach:**
```bash
# Test directly with service role key
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s \
  "$VITE_SUPABASE_URL/functions/v1/api-v1-vehicles?limit=1" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"'
```

If this returns 401, the issue is in `apiKeyAuth.ts` — the service role comparison. Read the actual auth function and trace the failure.

**Fix location:** `/Users/skylar/nuke/supabase/functions/_shared/apiKeyAuth.ts`

### Fix 2: Extract Hallucination Guard

**Root cause:** `extract-vehicle-data-ai` returns fabricated vehicle data when given non-car URLs. The LLM parrots system prompt example data with 0.95 confidence.

**Fix in MCP server** (`mcp-server/src/index.ts`, tool 3):
```typescript
// After receiving extraction result, validate:
async ({ url, source }) => {
  const data = await callFunction("extract-vehicle-data-ai", { url, source }) as any;

  // Guard: reject if no year AND no make AND no VIN
  const extracted = data?.data || data;
  if (!extracted?.year && !extracted?.make && !extracted?.vin) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: "No vehicle data found on this page",
          url,
          hint: "This URL may not contain vehicle listing information"
        }, null, 2)
      }],
    };
  }

  // Guard: reject suspiciously generic data (hallucination detection)
  const suspicious = (
    extracted?.year === 1974 &&
    extracted?.make === "Chevrolet" &&
    extracted?.model === "C10" &&
    extracted?.mileage === 123456
  );
  if (suspicious) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: false,
          error: "Extraction returned placeholder data (possible hallucination)",
          url,
          hint: "The AI could not extract real vehicle data from this page"
        }, null, 2)
      }],
    };
  }

  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
```

### Fix 3: Version Sync

**Files to update:**
- `mcp-server/server.json`: change `"version": "0.3.0"` → `"1.0.0"`
- `mcp-server/package.json`: change `"version": "0.5.0"` → `"1.0.0"`
- `mcp-server/src/index.ts` line 145: change `version: "0.5.0"` → `version: "1.0.0"`
- `mcp-server/src/index.ts` line 843: change `"v0.5.0"` → `"v1.0.0"`

---

## PART 2: NEW TOOLS (6 Tools → Maps to Existing Ingestion Paths)

### Tool 13: `decode_vin` — VIN → Factory Specification

**High standalone value. Draws users. Zero infrastructure needed.**

```typescript
server.registerTool(
  "decode_vin",
  {
    title: "Decode VIN",
    description:
      "Decode a Vehicle Identification Number (VIN) to factory specifications. " +
      "Returns year, make, model, trim, engine, transmission, drivetrain, body style, " +
      "plant of manufacture, and more. Uses NHTSA VPIC database. " +
      "Works for all US-market vehicles 1981+. Pre-1981 VINs have limited data.",
    inputSchema: {
      vin: z.string().min(5).max(17)
        .describe("Vehicle Identification Number (full 17-char or partial 5+)"),
    },
  },
  async ({ vin }) => {
    const data = await callFunction("api-v1-vin-lookup", { vin });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  }
);
```

**Calls:** `api-v1-vin-lookup` edge function (already exists, wraps NHTSA VPIC)
**Writes to:** Nothing directly (read-only). But the VIN data enriches any subsequent vehicle creation.
**Fills:** Vehicle identity dimension (year, make, model, trim, plant, engine from factory)

### Tool 14: `contribute_observation` — User Submits a Fact

**This is the core contribution tool. Maps directly to `ingest-observation`.**

```typescript
server.registerTool(
  "contribute_observation",
  {
    title: "Contribute Vehicle Data",
    description:
      "Submit an observation about a vehicle to the Nuke knowledge graph. " +
      "Every observation has full provenance — who observed it, when, where, " +
      "and confidence level. Observations feed into the digital twin, building " +
      "a complete picture of each vehicle over time.\n\n" +
      "Observation kinds:\n" +
      "- 'condition' — current state, wear, damage, modifications\n" +
      "- 'specification' — factory specs, RPO codes, options, build sheet data\n" +
      "- 'sighting' — saw this car at a show, on the road, in a shop\n" +
      "- 'work_record' — maintenance, restoration, modification work performed\n" +
      "- 'ownership' — ownership history, provenance chain\n" +
      "- 'sale_result' — actual sale price and terms\n" +
      "- 'expert_opinion' — domain expert assessment\n" +
      "- 'media' — photo, video, or document reference",
    inputSchema: {
      vehicle_id: z.string().uuid().optional()
        .describe("Nuke vehicle ID (provide this OR vin OR vehicle hints)"),
      vin: z.string().optional()
        .describe("VIN to match against existing vehicles"),
      year: z.number().optional()
        .describe("Vehicle year (for matching if no vehicle_id/VIN)"),
      make: z.string().optional()
        .describe("Vehicle make (for matching if no vehicle_id/VIN)"),
      model: z.string().optional()
        .describe("Vehicle model (for matching if no vehicle_id/VIN)"),
      kind: z.enum([
        "condition", "specification", "sighting", "work_record",
        "ownership", "sale_result", "expert_opinion", "media",
      ]).describe("Type of observation"),
      data: z.record(z.unknown())
        .describe(
          "Structured observation data. Examples:\n" +
          "condition: {overall: 'excellent', paint: 'original', rust: 'none', mileage: 45000}\n" +
          "specification: {engine: '350ci V8', transmission: '4-speed manual', rpo_codes: ['L48', 'M21']}\n" +
          "work_record: {shop: 'Smith Restoration', work: 'full frame-off', cost: 45000, completed: '2024-06'}\n" +
          "ownership: {owner: 'John Smith', location: 'Austin, TX', acquired: '2020', how: 'private sale'}\n" +
          "sighting: {location: 'Pebble Beach', event: 'Concours 2024', notes: 'class winner'}\n" +
          "sale_result: {price: 148000, platform: 'Bring a Trailer', sold_date: '2024-06-15'}"
        ),
      evidence: z.string().optional()
        .describe("How you know this (e.g., 'I own this car', 'visible in engine bay photo', 'auction result')"),
      source_url: z.string().optional()
        .describe("URL where this information was found"),
      confidence: z.number().min(0).max(1).optional().default(0.8)
        .describe("Your confidence in this data (0.0-1.0, default 0.8)"),
    },
  },
  async ({ vehicle_id, vin, year, make, model, kind, data, evidence, source_url, confidence }) => {
    // Build observation for ingest-observation
    const observation: Record<string, unknown> = {
      source_slug: "claude-extension",  // Will need to register this source
      kind,
      observed_at: new Date().toISOString(),
      structured_data: {
        ...data,
        ...(evidence ? { _evidence: evidence } : {}),
      },
      confidence_score: confidence,
    };

    // Vehicle resolution
    if (vehicle_id) {
      observation.vehicle_id = vehicle_id;
    } else {
      observation.vehicle_hints = {};
      if (vin) (observation.vehicle_hints as any).vin = vin;
      if (year) (observation.vehicle_hints as any).year = year;
      if (make) (observation.vehicle_hints as any).make = make;
      if (model) (observation.vehicle_hints as any).model = model;
    }

    if (source_url) observation.source_url = source_url;

    const result = await callFunction("ingest-observation", observation);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);
```

**Calls:** `ingest-observation` (unified observation funnel, already exists)
**Writes to:** `vehicle_observations` (with content_hash dedup)
**Downstream triggers:** `analysis-engine-coordinator` (signal recomputation)
**Fills:**
- `kind='condition'` → vehicle state dimension → feeds digital twin extraction
- `kind='specification'` → library/reference dimension → RPO codes, paint codes, factory specs
- `kind='work_record'` → actor network dimension → organizations, actors, work_orders
- `kind='ownership'` → actor network + provenance dimension
- `kind='sale_result'` → market intelligence dimension
- `kind='sighting'` → location dimension

**Prerequisite:** Register `claude-extension` as an observation source:
```sql
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES (
  'claude-extension',
  'Claude Extension (User Contributed)',
  'owner',
  0.80,
  ARRAY['condition', 'specification', 'sighting', 'work_record', 'ownership', 'sale_result', 'expert_opinion', 'media']
);
```

### Tool 15: `submit_vehicle` — Register a Vehicle

**For users who own a car or found one worth tracking.**

```typescript
server.registerTool(
  "submit_vehicle",
  {
    title: "Submit a Vehicle",
    description:
      "Add a vehicle to the Nuke knowledge graph. Use this when you find a vehicle " +
      "that isn't in the database, or to register your own car. The vehicle gets a " +
      "permanent profile that accumulates observations, images, and market data over time.\n\n" +
      "Provide as much data as you have — even just year/make/model is enough to start. " +
      "VIN is the strongest identifier and enables factory spec decode.",
    inputSchema: {
      url: z.string().optional()
        .describe("Listing URL (Craigslist, BaT, FB Marketplace, any car listing)"),
      vin: z.string().optional()
        .describe("Vehicle Identification Number"),
      year: z.number().optional()
        .describe("Vehicle year"),
      make: z.string().optional()
        .describe("Vehicle make (e.g., 'Chevrolet')"),
      model: z.string().optional()
        .describe("Vehicle model (e.g., 'K10')"),
      price: z.number().optional()
        .describe("Asking price or purchase price in USD"),
      mileage: z.number().optional()
        .describe("Current mileage"),
      color: z.string().optional()
        .describe("Exterior color"),
      engine: z.string().optional()
        .describe("Engine description (e.g., '350ci V8')"),
      transmission: z.string().optional()
        .describe("Transmission (e.g., '4-speed manual', 'TH400')"),
      location: z.string().optional()
        .describe("Location as 'City, State'"),
      description: z.string().optional()
        .describe("Free-text description or notes"),
      image_urls: z.array(z.string()).optional()
        .describe("Photo URLs for the vehicle"),
    },
  },
  async (params) => {
    // Build ingest payload
    const payload: Record<string, unknown> = {
      _source: "claude_extension_user",
    };

    // Map fields
    if (params.url) payload.url = params.url;
    if (params.vin) payload.vin = params.vin;
    if (params.year) payload.year = params.year;
    if (params.make) payload.make = params.make;
    if (params.model) payload.model = params.model;
    if (params.price) payload.price = params.price;
    if (params.mileage) payload.mileage = params.mileage;
    if (params.color) payload.color = params.color;
    if (params.engine) payload.engine = params.engine;
    if (params.transmission) payload.transmission = params.transmission;
    if (params.location) payload.location = params.location;
    if (params.description) payload.description = params.description;
    if (params.image_urls?.length) {
      payload.image_url = params.image_urls[0];
      payload.image_urls = params.image_urls;
    }

    const result = await callFunction("ingest", payload);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);
```

**Calls:** `ingest/` (universal ingestion, already exists)
**Writes to:** `vehicles`, `vehicle_images`, `user_vehicle_discoveries`
**Validation:** qualityGate() runs automatically (VIN checksum, make normalization, HTML sanitization)
**Fills:** Vehicle identity dimension (core profile creation)

### Tool 16: `register_organization` — Shops, Builders, Dealers

**Fills the actor/organization dimension — currently ~1.2K orgs, 8 empty tables.**

```typescript
server.registerTool(
  "register_organization",
  {
    title: "Register an Organization",
    description:
      "Register a shop, builder, dealer, or automotive organization in the Nuke " +
      "knowledge graph. Organizations are linked to vehicles they've worked on, " +
      "sold, or restored. This builds the actor network — the connective tissue " +
      "between everyone who touches a vehicle.\n\n" +
      "Types: restoration_shop, dealer, builder, auction_house, parts_supplier, " +
      "inspector, club, museum, media",
    inputSchema: {
      name: z.string().describe("Organization name"),
      type: z.enum([
        "restoration_shop", "dealer", "builder", "auction_house",
        "parts_supplier", "inspector", "club", "museum", "media", "other"
      ]).describe("Type of organization"),
      location: z.string().optional()
        .describe("City, State (e.g., 'Austin, TX')"),
      website: z.string().optional()
        .describe("Website URL"),
      specialties: z.array(z.string()).optional()
        .describe("What they specialize in (e.g., ['Porsche 911', 'air-cooled', 'engine rebuild'])"),
      description: z.string().optional()
        .describe("Brief description of the organization"),
      contact: z.record(z.string()).optional()
        .describe("Contact info: {phone, email, instagram, etc.}"),
    },
  },
  async (params) => {
    // Use the api-v1-organizations endpoint
    const result = await callAPI("organizations", "", "POST", {
      name: params.name,
      organization_type: params.type,
      location: params.location,
      website: params.website,
      specialties: params.specialties,
      description: params.description,
      contact_info: params.contact,
      source: "claude_extension",
    });
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  }
);
```

**Calls:** `api-v1-organizations` (already exists)
**Writes to:** `organizations` table
**Fills:** Actor network dimension — shops, builders, dealers that connect to vehicles via work records

### Tool 17: `market_snapshot` — Segment-Level Intelligence

**Draws power users. Surfaces the market intelligence dimension.**

```typescript
server.registerTool(
  "market_snapshot",
  {
    title: "Market Snapshot",
    description:
      "Get a market intelligence snapshot for a vehicle segment. Shows recent " +
      "sales, price trends, volume, and notable results. Combines comparable " +
      "sales data with auction analytics.\n\n" +
      "Example queries: 'Porsche 911 1987-1989', 'Ford Bronco', 'E30 M3'",
    inputSchema: {
      make: z.string().describe("Vehicle make (e.g., 'Porsche')"),
      model: z.string().optional().describe("Vehicle model (e.g., '911')"),
      year_from: z.number().optional().describe("Start year"),
      year_to: z.number().optional().describe("End year"),
      limit: z.number().min(1).max(50).optional().default(20)
        .describe("Max comparable sales to return"),
    },
  },
  async ({ make, model, year_from, year_to, limit }) => {
    // Get comps for the segment
    const comps = await callAPI("comps", "", "POST", {
      make,
      model,
      year: year_from && year_to ? Math.round((year_from + year_to) / 2) : year_from,
      year_range: year_from && year_to ? Math.ceil((year_to - year_from) / 2) : 3,
      limit,
    });

    return {
      content: [{ type: "text" as const, text: JSON.stringify(comps, null, 2) }],
    };
  }
);
```

**Calls:** `api-v1-comps` (already exists)
**Writes to:** Nothing (read-only)
**Fills:** Surfaces market intelligence dimension for user discovery

### Tool 18: `get_vehicle_images` — See a Vehicle's Photos

**Users need to SEE cars, not just read data.**

```typescript
server.registerTool(
  "get_vehicle_images",
  {
    title: "Get Vehicle Images",
    description:
      "Get photos for a vehicle from the Nuke database. Returns image URLs " +
      "with metadata: angle, zone, AI processing status, and source. " +
      "Useful for visual verification after search or identification.",
    inputSchema: {
      vehicle_id: z.string().uuid().describe("Nuke vehicle ID"),
      limit: z.number().min(1).max(50).optional().default(10)
        .describe("Max images to return (default 10)"),
    },
  },
  async ({ vehicle_id, limit }) => {
    // Direct Supabase query via the vehicles endpoint
    const data = await callAPI("vehicles", `/${vehicle_id}/images?limit=${limit}`);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  }
);
```

**Calls:** `api-v1-vehicles` with `/images` subpath (may need to add this route if not exists)
**Fallback approach:** Query `vehicle_images` directly via a new lightweight function, or embed the query in the `get_vehicle` response.

---

## PART 3: OBSERVATION SOURCE REGISTRATION

Before the extension can submit observations, register it as a source:

```sql
INSERT INTO observation_sources (
  slug, display_name, category,
  base_trust_score, supported_observations,
  description
) VALUES (
  'claude-extension',
  'Claude Extension (User Contributed)',
  'owner',
  0.80,
  ARRAY['condition', 'specification', 'sighting', 'work_record',
        'ownership', 'sale_result', 'expert_opinion', 'media'],
  'Observations contributed by users via the Nuke Claude Desktop extension. Human-validated data with contextual evidence.'
);
```

**Trust score 0.80:** Higher than marketplace scraping (0.6-0.75), lower than official registries (0.9+). User corrections that are subsequently verified by other sources get promoted to higher confidence.

---

## PART 4: API KEY SELF-SERVICE

### Edge Function: `api-v1-keys` (New — MUST add to TOOLS.md)

```typescript
// POST /functions/v1/api-v1-keys
// Creates a free anonymous API key for extension users
// Rate limited: 1 key per IP per day

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Generate key
  const keyBytes = new Uint8Array(24);
  crypto.getRandomValues(keyBytes);
  const rawKey = "nk_free_" + Array.from(keyBytes, b => b.toString(16).padStart(2, "0")).join("");

  // Hash for storage
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  const keyHash = Array.from(new Uint8Array(hashBuffer), b => b.toString(16).padStart(2, "0")).join("");

  // Store
  const { error } = await supabase.from("api_keys").insert({
    key_hash: keyHash,
    key_prefix: rawKey.slice(0, 12),
    tier: "free",
    rate_limit: 100,           // 100 requests/day
    daily_extract_limit: 10,   // 10 extractions/day
    daily_image_limit: 50,     // 50 image analyses/day
    created_via: "claude_extension",
    expires_at: null,          // Free keys don't expire
  });

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to create key" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({
    api_key: rawKey,
    tier: "free",
    limits: {
      requests_per_day: 100,
      extractions_per_day: 10,
      image_analyses_per_day: 50,
    },
    setup: {
      claude_desktop: {
        mcpServers: {
          nuke: {
            command: "npx",
            args: ["-y", "@sss97133/nuke-mcp-server"],
            env: { NUKE_API_KEY: rawKey }
          }
        }
      }
    }
  }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
});
```

**Alternative (simpler):** Add a `generate_api_key` MCP tool that calls this endpoint. User says "give me an API key" → tool generates one → user pastes into extension settings.

---

## PART 5: MANIFEST & PACKAGING

### manifest.json (for .mcpb packaging)

```json
{
  "manifest_version": "0.3",
  "name": "nuke-vehicle-intelligence",
  "version": "1.0.0",
  "display_name": "Nuke — Vehicle Intelligence",
  "description": "Search 1.29M collector vehicles. Identify cars from photos. Get valuations with real auction data. Contribute to the world's largest structured vehicle knowledge graph.",
  "long_description": "Nuke gives Claude deep automotive intelligence backed by a structured knowledge graph of 1.29M+ vehicles from 112+ sources.\n\nSearch vehicles by VIN, make/model, or text. Identify any car from a photo ($0/image). Get multi-signal valuations with real comparable sales. Extract structured data from any listing URL. Decode VINs to factory specs. Track market trends by segment.\n\nEvery interaction enriches the knowledge graph. Submit observations, corrections, and photos to build the most complete vehicle database ever assembled. Built by collectors, for collectors.",
  "author": {
    "name": "Nuke",
    "email": "skylar@nuke.ag",
    "url": "https://nuke.ag"
  },
  "server": {
    "type": "node",
    "entry_point": "build/index.js",
    "command": "node"
  },
  "icon": "icon.png",
  "keywords": [
    "vehicles", "cars", "automotive", "valuation", "auction",
    "collector", "classic-cars", "identification", "VIN", "market-data"
  ],
  "repository": "https://github.com/sss97133/nuke-mcp-server",
  "homepage": "https://nuke.ag",
  "tools": [
    { "name": "search_vehicles", "description": "Search 1.29M+ vehicle profiles by VIN, make/model, or text" },
    { "name": "search_vehicles_api", "description": "Advanced filtered search with pagination and valuations" },
    { "name": "extract_listing", "description": "Extract structured data from any car listing URL" },
    { "name": "decode_vin", "description": "Decode VIN to full factory specification" },
    { "name": "identify_vehicle_image", "description": "AI vision: identify year/make/model/trim from a photo" },
    { "name": "analyze_image", "description": "YONO vision: condition, zones, damage, modifications ($0/image)" },
    { "name": "get_vehicle_valuation", "description": "Multi-signal market valuation with 8 weighted signals" },
    { "name": "get_valuation", "description": "Cached valuation lookup by vehicle_id or VIN" },
    { "name": "get_comps", "description": "Comparable auction sales with price statistics" },
    { "name": "market_snapshot", "description": "Market intelligence for a vehicle segment" },
    { "name": "get_vehicle", "description": "Get full vehicle profile by ID" },
    { "name": "get_vehicle_images", "description": "Get photos for a vehicle" },
    { "name": "list_vehicles", "description": "Browse vehicles with filters" },
    { "name": "submit_vehicle", "description": "Add a vehicle to the knowledge graph" },
    { "name": "contribute_observation", "description": "Submit an observation about a vehicle" },
    { "name": "register_organization", "description": "Register a shop, builder, or dealer" },
    { "name": "ingest_marketplace_listing", "description": "Submit Facebook Marketplace listing data" },
    { "name": "import_facebook_saved", "description": "Bulk import from Facebook Saved Items" }
  ],
  "user_config": {
    "api_key": {
      "type": "string",
      "description": "Your Nuke API key. Get a free key by asking Claude: 'give me a Nuke API key'",
      "sensitive": true,
      "required": true
    }
  },
  "privacy_policies": {
    "data_handling": "Vehicle queries are processed via Nuke's API. Contributed observations and photos are stored in the Nuke knowledge graph to improve vehicle data for all users. No personal information is collected beyond your API key. All data contributions are attributed to your key but not publicly linked to your identity."
  },
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"],
    "runtime": { "node": ">=18.0.0" }
  }
}
```

### Build & Pack Steps

```bash
cd /Users/skylar/nuke/mcp-server

# 1. Install mcpb CLI
npm install -g @anthropic-ai/mcpb

# 2. Build TypeScript
npm run build

# 3. Create manifest.json (from above)
# 4. Create icon.png (256x256)

# 5. Pack into .mcpb
mcpb pack

# 6. Test locally: double-click the .mcpb file in Finder
# 7. Publish to npm for npx install path
npm publish --access public
```

---

## PART 6: HOW DATA FLOWS THROUGH EVERY DIMENSION

### User says: "I just bought a 1973 Porsche 911T"

```
User → submit_vehicle(year=1973, make="Porsche", model="911T")
  → ingest/ → qualityGate() → PASS
  → INSERT vehicles (identity dimension ✓)
  → Returns vehicle_id

User → contribute_observation(vehicle_id, kind="ownership", data={acquired: "2025-03", how: "private sale", price: 78000})
  → ingest-observation → vehicle_observations
  → Actor network dimension ✓
  → Market intelligence dimension ✓ (sale price)

User → contribute_observation(vehicle_id, kind="condition", data={overall: "driver", paint: "respray", engine: "matching numbers", mileage: 87000})
  → ingest-observation → vehicle_observations
  → Vehicle state dimension ✓
  → Evidence chain ✓ (source: claude-extension, confidence: 0.8)

User → contribute_observation(vehicle_id, kind="work_record", data={shop: "Rennsport Werks", work: "engine rebuild", cost: 12000, completed: "2024-09"})
  → ingest-observation → vehicle_observations
  → Actor network dimension ✓ (shop reference)
  → If shop not in organizations → prompt to register_organization
```

**Result:** One conversation creates data in 5 dimensions. The vehicle now has:
- Identity (year/make/model)
- Ownership provenance (who bought it, when, for how much)
- Current condition (with confidence scores)
- Work history (linked to a shop)
- Market data point (sale price as comp for future valuations)

### User says: "What's this car worth?" [pastes BaT link]

```
User → extract_listing(url="https://bringatrailer.com/listing/1973-porsche-911t-2/")
  → extract-vehicle-data-ai → routes to bat-simple-extract
  → archiveFetch() → HTML archived ✓
  → Extract: year, make, model, VIN, mileage, color, description, images
  → qualityGate() → PASS
  → INSERT vehicles (if new) or UPDATE (if exists)
  → Vehicle identity ✓, Vehicle images ✓

User → get_vehicle_valuation(vehicle_id)
  → compute-vehicle-valuation → 8-signal engine
  → Returns estimate, comps, confidence
  → Market intelligence ✓

User → get_comps(make="Porsche", model="911T", year=1973)
  → api-v1-comps → auction_events join
  → Returns comparable sales with prices
  → Market intelligence surfaced ✓
```

### User says: "I saw a Shelby Cobra replica at Rennsport Reunion"

```
User → contribute_observation(kind="sighting", data={location: "Laguna Seca", event: "Rennsport Reunion 2025", notes: "Gulf livery Cobra replica, beautiful build"}, year=1965, make="Shelby", model="Cobra")
  → ingest-observation
  → Vehicle resolution: fuzzy match on year+make+model
  → If matched → observation linked to existing vehicle
  → If not → observation stored unresolved (flagged for future matching)
  → Location dimension ✓ (Laguna Seca, CA)
  → Vehicle state dimension ✓ (sighting confirms existence)
```

---

## PART 7: COMPLETE FILE CHANGE LIST

### Files to MODIFY:

1. **`mcp-server/src/index.ts`**
   - Fix extract hallucination guard (tool 3 handler)
   - Update version to 1.0.0 (lines 145, 843)
   - Add 6 new tools (decode_vin, contribute_observation, submit_vehicle, register_organization, market_snapshot, get_vehicle_images)
   - Update TOOL_NAMES array

2. **`mcp-server/package.json`**
   - Version → 1.0.0

3. **`mcp-server/server.json`**
   - Version → 1.0.0

4. **`mcp-server/README.md`**
   - Add new tools documentation
   - Update tool count (12 → 18)
   - Add "Getting an API Key" section
   - Add "Contributing Data" section

### Files to CREATE:

5. **`mcp-server/manifest.json`** — Claude Desktop extension manifest (from Part 5)
6. **`mcp-server/icon.png`** — Extension icon (256x256, Nuke brand)

### Database Changes:

7. **Register observation source** — `INSERT INTO observation_sources` (from Part 3)
8. **Verify api-v1-vin-lookup exists** — check edge function deployment
9. **Verify api-v1-organizations POST works** — test auth path

### Edge Functions (possibly):

10. **`api-v1-keys/index.ts`** — API key self-service (Part 4) — OR handle via existing auth
11. **Fix `apiKeyAuth.ts`** — if service role auth is truly broken for api-v1-vehicles

### Deployment:

12. **`npm publish --access public`** — publish to npm registry
13. **`mcpb pack`** — create .mcpb file
14. **Submit to Claude Desktop directory** — Google form with 3 examples

---

## PART 8: THREE EXAMPLE PROMPTS (For Directory Submission)

### Example 1: Listing Analysis
> "I found this car on Craigslist and I'm thinking about buying it. Can you tell me if it's a good deal?"
> [paste URL: https://craigslist.org/cto/1973-porsche-911t-42000.html]
>
> Claude uses `extract_listing` → gets structured data
> Claude uses `decode_vin` → gets factory specs
> Claude uses `get_comps` → finds 20 comparable sales
> Claude uses `get_vehicle_valuation` → computes Nuke Estimate
> Claude responds: "This 1973 911T is listed at $42,000. Based on 20 comparable sales averaging $78,500, this appears significantly underpriced. The VIN decodes to a Sportomatic which is less desirable than a manual, which could explain the discount..."

### Example 2: Photo Identification
> "I saw this car at a show, what is it and what's it worth?"
> [attach photo of car]
>
> Claude uses `identify_vehicle_image` → "1967 Shelby GT500, confidence 0.91"
> Claude uses `get_comps` → comparable sales
> Claude uses `market_snapshot` → segment trends
> Claude responds: "This is a 1967 Shelby GT500. Recent sales range from $150,000 to $350,000 depending on matching numbers status and documentation..."

### Example 3: Contributing Data
> "I just finished a frame-off restoration on my 1970 Chevelle SS 396. It took 3 years at Rod's Restoration in Houston. Total cost was $85,000. Here's the VIN: 136370K123456"
>
> Claude uses `decode_vin` → confirms 1970 Chevelle SS 396 build
> Claude uses `submit_vehicle` → creates/finds profile
> Claude uses `register_organization` → registers Rod's Restoration
> Claude uses `contribute_observation(kind='work_record')` → documents restoration
> Claude uses `contribute_observation(kind='condition')` → records current state
> Claude responds: "Your 1970 Chevelle SS is now in the Nuke knowledge graph. VIN decodes to a true SS 396 with L78 engine option. I've recorded Rod's Restoration as the shop and documented the 3-year frame-off at $85,000. Based on comparable sales, your restored SS should be worth approximately $95,000-$125,000..."

---

## IMPLEMENTATION ORDER

```
Session 1: Fix + Build (one-shot)
├── 1. Register observation source in DB
├── 2. Fix auth issue (debug api-v1-vehicles 401)
├── 3. Fix extract hallucination guard
├── 4. Add 6 new tools to index.ts
├── 5. Sync versions to 1.0.0
├── 6. Update README
├── 7. Create manifest.json
├── 8. Build + test locally
├── 9. npm publish
└── 10. mcpb pack

Session 2: Ship
├── 1. Create icon
├── 2. Test .mcpb install in Claude Desktop
├── 3. Submit to directory
└── 4. Post to 3 forums
```

---

## THE PROMPT FOR SESSION 1

```
Read /Users/skylar/nuke/NUKE_EXTENSION_BLUEPRINT.md — it's the complete implementation
plan. Execute it top-to-bottom in one session.

Summary of changes:
1. Register 'claude-extension' observation source in Supabase
2. Debug and fix api-v1-vehicles 401 auth issue
3. Add hallucination guard to extract_listing tool handler
4. Add 6 new tools: decode_vin, contribute_observation, submit_vehicle,
   register_organization, market_snapshot, get_vehicle_images
5. Sync all versions to 1.0.0
6. Update README with new tools
7. Create manifest.json for Claude Desktop extension
8. npm run build && npm publish --access public
9. mcpb pack

Key files:
- MCP server: /Users/skylar/nuke/mcp-server/src/index.ts (853 lines → ~1200)
- Package: /Users/skylar/nuke/mcp-server/package.json
- Server manifest: /Users/skylar/nuke/mcp-server/server.json
- Auth: /Users/skylar/nuke/supabase/functions/_shared/apiKeyAuth.ts
- Ingest: /Users/skylar/nuke/supabase/functions/ingest/index.ts
- Observation intake: /Users/skylar/nuke/supabase/functions/ingest-observation/index.ts

Do NOT create new edge functions unless absolutely necessary.
The 6 new MCP tools all route through EXISTING edge functions.
```
