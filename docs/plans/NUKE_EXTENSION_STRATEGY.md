# Nuke × Claude Extension Strategy

## The One-Line Pitch

**Nuke turns every conversation about a car into structured intelligence — and every user into a data contributor.**

---

## What We Actually Are

A data transformation pipeline. Image → thousands of data points. Listing → digital twin. Photo → provenance chain. We don't describe vehicles — we resolve them at maximum fidelity, with citations, confidence scores, and decay rates on every claim.

The database IS the vehicle.

**What exists today:**
- 1.29M vehicle profiles from 112+ sources
- 35M images, 11.7M auction comments, 4.18M bids
- Entity-Attribute-Value knowledge graph at component resolution
- Schema-guided extraction (Haiku/Sonnet/Opus hierarchy)
- YONO vision model ($0/image local inference)
- Full provenance: every cell cites its source

**What's missing:** Users. Contributors. The rhizome needs roots.

---

## Why a Claude Extension

Claude is where enthusiasts already talk about cars. Not an app they have to download. Not a website they have to visit. It's already open on their desktop.

**The flywheel:**
1. User asks Claude about a car → Nuke answers with structured data
2. User shares a photo/listing/VIN → Nuke extracts and ingests
3. Every interaction enriches the knowledge graph
4. Better data → better answers → more users → more data

**Distribution without marketing.** The extension IS the product. Claude IS the interface. The user never visits nuke.ag — they just talk to Claude, and Nuke powers the answers.

---

## Extension Architecture

### What the User Sees

A Claude Desktop extension called **"Nuke — Vehicle Intelligence"** that gives Claude automotive superpowers:

- "What's this car worth?" → structured valuation with comps
- "Here's a photo of my engine bay" → component identification, condition assessment
- *paste a BaT/Craigslist/FB link* → full extraction with provenance
- "What's the VIN decode on 1GCEK14L9EJ147915?" → factory specs
- "Show me comparable sales for E30 M3s" → market data with bid curves

### What Nuke Gets

Every interaction is a data event:
- Photo uploads → vision pipeline → observations with provenance
- VIN queries → cross-reference against existing profiles
- Listing extractions → new vehicle profiles or enrichment of existing ones
- User corrections ("that's actually a 350, not a 305") → human-validated data points with highest confidence

### The 12 Tools (Current MCP Server)

| Tool | User Value | Data Value |
|------|-----------|------------|
| `search_vehicles` | Find any vehicle in the graph | Query patterns reveal market interest |
| `extract_listing` | Understand any listing instantly | New vehicle profile or enrichment |
| `get_vehicle_valuation` | Know what something is worth | Valuation model training data |
| `identify_vehicle_image` | "What car is this?" | Vision training data |
| `analyze_image` | Condition/zone/damage assessment | Component-level observations |
| `get_comps` | Market comparables | Price discovery validation |
| `get_vehicle` | Deep vehicle profile | Access pattern analytics |
| `list_vehicles` | Browse inventory | Interest signals |
| `ingest_marketplace_listing` | Submit a find | Direct data contribution |
| `import_facebook_saved` | Bulk import saved cars | Massive data ingestion |
| `search_vehicles_api` | Advanced filtered search | Search intelligence |
| `get_valuation` | Quick cached valuation | Cache hit analytics |

### Tools We Should Add

| Tool | Purpose | Why |
|------|---------|-----|
| `contribute_observation` | User submits a fact about a vehicle | Human-validated data = gold |
| `correct_data` | User fixes wrong data | Error correction with provenance |
| `submit_photos` | User uploads vehicle photos | Vision pipeline fuel |
| `my_garage` | User's personal vehicle collection | Engagement + longitudinal data |
| `decode_vin` | VIN → full factory spec | High-value standalone utility |
| `market_trends` | Segment-level market intelligence | Draws power users |

---

## The Contribution Model

This is the core innovation. Users don't "upload data to Nuke." They **talk to Claude about cars**, and the data flows naturally.

### Passive Contributions (No Extra Effort)
- Every search query → interest signal
- Every listing extraction → vehicle profile enrichment
- Every image analysis → vision training data
- Every VIN decode → cross-reference data

### Active Contributions (User Chooses to Help)
- "I own this car, here are 50 photos" → full visual documentation
- "The listing says matching numbers but the block is stamped wrong" → expert correction
- "I was at Monterey, here's what sold" → real-time market intelligence
- "This is my build thread" → longitudinal project tracking

### The Value Exchange

**User gets:**
- Free, instant vehicle identification and valuation
- Market intelligence no one else has (BaT has no public API — we're the only structured access)
- Photo analysis at $0/image
- Their own vehicle data organized and tracked

**Nuke gets:**
- Human-validated data points (highest confidence tier)
- Geographic coverage (users ARE the sensor network)
- Temporal depth (users track their cars over time)
- Domain expertise (enthusiasts know things LLMs don't)

---

## Technical Implementation

### Phase 1: Fix & Ship MCP Server (Week 1)

**P0 blockers from audit:**
- [ ] Fix `get_vehicle` and `list_vehicles` auth (401 errors)
- [ ] Fix extraction hallucination (google.com → fake 1974 C10)
- [ ] Fix search relevance ("BMW M3 E30" → returns 540i wagons)
- [ ] Fix search duplicates (same vehicle, multiple UUIDs)
- [ ] Fix empty query data leak (returns user profiles)
- [ ] Sync versions (package.json 0.5.0 vs server.json 0.3.0)
- [ ] Publish to npm: `npm publish --access public`

### Phase 2: Package as Claude Desktop Extension (Week 2)

```bash
# Install mcpb CLI
npm install -g @anthropic-ai/mcpb

# Initialize manifest
cd mcp-server
mcpb init

# Pack into .mcpb
mcpb pack
```

**manifest.json:**
```json
{
  "manifest_version": "0.3",
  "name": "nuke-vehicle-intelligence",
  "version": "1.0.0",
  "display_name": "Nuke — Vehicle Intelligence",
  "description": "Search 1.29M collector vehicles. Identify any car from a photo. Get instant valuations with comps. Extract structured data from any listing. Powered by the world's largest collector vehicle knowledge graph.",
  "author": {
    "name": "Nuke",
    "email": "skylar@nuke.ag",
    "url": "https://nuke.ag"
  },
  "server": {
    "type": "node",
    "entry_point": "build/index.js"
  },
  "icon": "icon.png",
  "keywords": [
    "vehicles", "cars", "automotive", "valuation",
    "auction", "collector", "classic-cars", "identification"
  ],
  "tools": [
    { "name": "search_vehicles", "description": "Search 1.29M+ vehicle profiles by VIN, make/model, or text" },
    { "name": "extract_listing", "description": "Extract structured data from any car listing URL" },
    { "name": "identify_vehicle_image", "description": "Identify year/make/model/trim from a photo" },
    { "name": "analyze_image", "description": "AI vision analysis — condition, zones, damage, modifications" },
    { "name": "get_vehicle_valuation", "description": "Multi-signal market valuation with comparables" },
    { "name": "get_comps", "description": "Find comparable auction sales with price statistics" },
    { "name": "decode_vin", "description": "VIN decode to full factory specification" }
  ],
  "user_config": {
    "api_key": {
      "type": "string",
      "description": "Your Nuke API key (get one free at nuke.ag/api)",
      "sensitive": true,
      "required": true
    }
  },
  "privacy_policies": {
    "data_handling": "Vehicle queries are processed via Nuke's API. Photos are analyzed and may be stored to improve the vehicle knowledge graph. No personal data is collected beyond your API key. See nuke.ag/privacy for full policy."
  },
  "compatibility": {
    "platforms": ["darwin", "win32", "linux"],
    "runtime": { "node": ">=18.0.0" }
  }
}
```

### Phase 3: API Key Self-Service (Week 2-3)

Users need API keys without visiting nuke.ag. Options:

**Option A: Free tier, no signup**
- Generate anonymous API keys on first use
- Rate limited (100 queries/day, 10 extractions/day, 50 images/day)
- Upgrade to registered for higher limits

**Option B: Claude OAuth flow**
- Extension triggers OAuth via Claude Desktop
- User creates account, gets key, never leaves Claude
- Preferred for tracking + attribution

**Option C: Instant key via email**
- User provides email in extension settings
- Key emailed immediately
- Lowest friction after anonymous

**Recommendation: Start with Option A.** Zero friction. Let people use it. Convert later.

### Phase 4: Contribution Tools (Week 3-4)

Add tools that let users give back:

```typescript
// User submits a correction
server.registerTool("correct_vehicle_data", {
  title: "Correct Vehicle Data",
  description: "Fix incorrect data about a vehicle. Your corrections are the highest-confidence data source.",
  inputSchema: {
    vehicle_id: z.string().describe("Vehicle ID or VIN"),
    field: z.string().describe("Field to correct (e.g., 'engine', 'transmission', 'color')"),
    current_value: z.string().describe("What the data currently says"),
    correct_value: z.string().describe("What it should be"),
    evidence: z.string().optional().describe("How you know (e.g., 'I own this car', 'visible in photo #3')"),
  },
});

// User submits their vehicle
server.registerTool("register_my_vehicle", {
  title: "Add My Vehicle",
  description: "Register a vehicle you own or are tracking. Creates a profile in the Nuke knowledge graph.",
  inputSchema: {
    vin: z.string().optional(),
    year: z.number(),
    make: z.string(),
    model: z.string(),
    description: z.string().optional(),
    photos: z.array(z.string()).optional().describe("URLs of photos"),
  },
});
```

### Phase 5: Claude Desktop Directory Submission (Week 4)

**Requirements:**
- Working .mcpb file ✓
- 3 example prompts demonstrating tools
- Privacy policy
- Icon (256x256 PNG)
- Reviewed by Anthropic team

**Example prompts for submission:**

1. "I found this listing on Craigslist for a 1973 Plymouth Barracuda. Can you tell me if it's a good deal? [paste URL]"

2. "I have a photo of a car I saw at a show. Can you identify it and tell me what it's worth?" [attach photo]

3. "What are comparable sales for a 1967 Ford Mustang Fastback with a 289? I'm trying to price mine."

---

## Positioning & Messaging

### For the Claude Extension Directory

**Title:** Nuke — Vehicle Intelligence

**Short description (under 200 chars):**
Search 1.29M collector vehicles. Identify cars from photos. Get valuations with real auction data. The world's largest structured vehicle knowledge graph.

**Long description:**
Nuke gives Claude deep automotive intelligence — not generic web search, but a structured knowledge graph built from 112+ sources including auction houses, forums, classifieds, and enthusiast communities.

What you can do:
- **Identify any vehicle** from a photo (free, instant, $0/image)
- **Value any vehicle** with multi-signal analysis and real comparable sales
- **Extract any listing** — paste a URL from BaT, Craigslist, eBay, Facebook, anywhere
- **Search the graph** — 1.29M vehicles with full specifications, provenance, and market data
- **Decode any VIN** — factory specifications, RPO codes, production details
- **Find comparables** — real auction results with bid curves and price statistics

Built by collectors, for collectors. Every data point cites its source.

### For Enthusiast Communities

**The pitch that resonates:**
"You know how you're always sending BaT links to your friends asking 'what do you think?' Now Claude can actually answer that — with real comps, real data, and real market intelligence. And every time you use it, you're helping build the most complete vehicle database ever assembled."

### For the Anthropic Team (Extension Review)

**Why this extension matters:**
1. **Unique data** — No one else has structured access to BaT, auction comment analysis, or this scale of normalized vehicle data
2. **Zero-cost vision** — YONO runs locally, no API costs per image
3. **Natural contribution model** — Every user interaction enriches the knowledge graph
4. **Domain expertise** — 950-table schema built by domain experts, not generic scraping

---

## Growth Strategy

### Phase 1: Seed (Month 1)
- Ship extension to Claude Desktop directory
- Post to BaT forums, Rennlist, TheSamba, Hemmings
- Target: 100 installs, 1,000 queries

### Phase 2: Network Effects (Month 2-3)
- Enable contribution tools
- "My Garage" feature (track your vehicles via Claude)
- Target: 1,000 installs, 50 active contributors

### Phase 3: Expertise Layer (Month 3-6)
- Expert verification badges (user corrections validated by multiple sources)
- Build-thread tracking (longitudinal project documentation)
- Geographic market analysis ("what's available near me")
- Target: 5,000 installs, 500 contributors, 10,000 new vehicle profiles from users

### Phase 4: Marketplace Intelligence (Month 6+)
- Real-time auction monitoring alerts via Claude
- "Watch this car" notifications
- Portfolio tracking (your collection's total value over time)
- Premium tier for dealers/professionals

---

## What Makes This Work

1. **Claude is the interface.** No app to build. No website to maintain. No user acquisition cost. The extension is the product.

2. **Every query is data.** Search patterns reveal market interest. Extractions create profiles. Corrections improve quality. Photos train vision. The usage IS the contribution.

3. **Enthusiasts want to help.** Car people love talking about cars. They WANT to share knowledge. The extension just makes it frictionless — they talk to Claude, and their expertise flows into the graph.

4. **The moat is the data.** Once you have 10M vehicles with component-level provenance from human experts, no one can replicate it. The knowledge graph IS the competitive advantage.

5. **Cost structure is inverted.** YONO = $0/image. Haiku = $1/MTok. The more users, the cheaper per-query (amortized model costs, better caching, fewer extraction retries on known vehicles).

---

## Immediate Next Steps

1. **Fix the 4 P0 bugs** in the MCP server (auth, hallucination, search, duplicates)
2. **Add `decode_vin` tool** (standalone high-value utility, draws users)
3. **Implement free anonymous API keys** (zero friction onboarding)
4. **Create icon** (256x256 PNG, Nuke brand)
5. **Install `mcpb` CLI and pack the extension**
6. **Test locally** by double-clicking .mcpb in Claude Desktop
7. **Submit to Claude Desktop directory** with 3 example prompts
8. **Post announcement** to 3 enthusiast forums

---

## The Prompt That Builds This

When starting a session to implement this, use:

```
I'm building the Nuke Claude Desktop extension. Nuke is a vehicle data
transformation pipeline — it resolves vehicles at maximum fidelity from
unstructured sources (photos, listings, forums, auctions) into a structured
knowledge graph with full provenance.

The extension gives Claude automotive intelligence (search, valuation,
identification, extraction) and turns every user interaction into a data
contribution that enriches the graph.

Read NUKE_EXTENSION_STRATEGY.md for the full plan. Current session goal: [specific task]

Key files:
- MCP server: /Users/skylar/nuke/mcp-server/src/index.ts
- Strategy: /Users/skylar/nuke/NUKE_EXTENSION_STRATEGY.md
- Architecture: /Users/skylar/nuke/digital-twin-architecture.md
- Tools registry: /Users/skylar/nuke/TOOLS.md
```
