# Chapter 2: Extraction

## What This Subsystem Does

Extraction is the process of turning raw HTML or markdown from a vehicle listing page into structured vehicle data (year, make, model, VIN, mileage, price, images, seller, description). The system uses a three-tier AI agent hierarchy (Haiku for cheap routine work, Sonnet for quality review, Opus for strategy) plus deterministic HTML parsers for well-structured sources like BaT. Every extractor follows shared patterns: normalize fields, check quality, archive evidence, and write through the standard upsert pipeline.

---

## Key Tables and Functions

### Tables

| Table | Purpose |
|-------|---------|
| `vehicles` | Destination for extracted vehicle records. |
| `vehicle_events` | Links a vehicle to a source listing URL. |
| `vehicle_images` | Images found during extraction. |
| `auction_events` | Auction-specific metadata (bids, reserve, end date). |
| `extraction_metadata` | Per-field provenance: which extractor set which value, when, with what confidence. |
| `listing_page_snapshots` | Source HTML/markdown evidence. |
| `import_queue` | Queue items with `raw_data` containing intermediate extraction results. |

### Edge Functions

| Function | Purpose |
|----------|---------|
| `extract-bat-core` | Reference implementation. BaT-specific HTML parser. |
| `complete-bat-import` | Orchestrator: calls extract-bat-core + extract-auction-comments. |
| `haiku-extraction-worker` | Claude Haiku for routine extraction from any source. |
| `sonnet-supervisor` | Claude Sonnet for quality review and edge case resolution. |
| `agent-tier-router` | Routes tasks to the appropriate AI tier. |
| `extract-vehicle-data-ai` | Generic AI extraction for unknown sources. |
| Domain-specific extractors | `extract-cars-and-bids-core`, `extract-mecum`, `extract-bonhams`, etc. |

### Shared Modules

| Module | Purpose |
|--------|---------|
| `_shared/agentTiers.ts` | Tier configs, `callTier()`, `parseJsonResponse()`, quality thresholds. |
| `_shared/normalizeVehicle.ts` | Make/model/VIN/transmission/drivetrain/color normalization. |
| `_shared/extractionQualityGate.ts` | Pre-upsert validation. Rejects garbage, flags for review. |
| `_shared/archiveFetch.ts` | Fetch + archive (see Chapter 1). |
| `_shared/listingUrl.ts` | URL normalization. |

---

## The Agent Tier System

### Architecture

The extraction system uses three AI tiers, each backed by a different Claude model. Tasks are routed to the cheapest tier that can handle them, with escalation to higher tiers when needed.

```
                    +---------+
                    |  Opus   |  Strategy, market intel
                    | $5/$25  |  (rarely used)
                    +----+----+
                         ^
                         | escalation
                    +----+----+
                    | Sonnet  |  Quality review, edge cases
                    | $3/$15  |  (reviews Haiku output)
                    +----+----+
                         ^
                         | escalation
                    +----+----+
                    |  Haiku  |  Routine extraction
                    | $1/$5   |  (workhorse, 80% of volume)
                    +---------+
```

### Tier Configuration

From `_shared/agentTiers.ts`:

```typescript
export const TIER_CONFIGS: Record<AgentTier, TierConfig> = {
  haiku: {
    model: "claude-haiku-4-5-20251001",
    maxTokens: 4096,
    temperature: 0.0,    // Zero temperature for deterministic extraction
    costPerInputMTok: 1.00,
    costPerOutputMTok: 5.00,
    timeoutMs: 30_000,   // 30 second timeout
  },
  sonnet: {
    model: "claude-sonnet-4-6",
    maxTokens: 8192,
    temperature: 0.1,
    costPerInputMTok: 3.00,
    costPerOutputMTok: 15.00,
    timeoutMs: 60_000,
  },
  opus: {
    model: "claude-opus-4-6",
    maxTokens: 16384,
    temperature: 0.2,
    costPerInputMTok: 5.00,
    costPerOutputMTok: 25.00,
    timeoutMs: 120_000,
  },
};
```

### Calling a Tier

The `callTier()` function wraps the Anthropic API with cost tracking:

```typescript
export async function callTier(
  tier: AgentTier,
  systemPrompt: string,
  userMessage: string,
  options?: { maxTokens?: number; temperature?: number }
): Promise<AgentCallResult> {
  const config = TIER_CONFIGS[tier];
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: options?.maxTokens ?? config.maxTokens,
      temperature: options?.temperature ?? config.temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  // Returns: { content, tier, model, inputTokens, outputTokens, costCents, durationMs }
}
```

### Task Classification

`classifyTaskTier()` determines which tier to use based on task type and context:

```typescript
export function classifyTaskTier(taskType: string, context?: {
  previousFailures?: number;
  isEdgeCase?: boolean;
}): AgentTier {
  // Opus: strategy, market intelligence, pipeline optimization
  const opusTasks = ["source_prioritization", "market_intelligence"];
  if (opusTasks.includes(taskType)) return "opus";

  // Escalate to Sonnet after 2+ failures or for edge cases
  if (context?.previousFailures >= 2) return "sonnet";
  if (context?.isEdgeCase) return "sonnet";

  // Sonnet: quality review, aggregation, complex analysis
  const sonnetTasks = ["quality_review", "edge_case_resolution"];
  if (sonnetTasks.includes(taskType)) return "sonnet";

  // Everything else: Haiku
  return "haiku";
}
```

### Quality Thresholds

```typescript
export const QUALITY_THRESHOLDS = {
  MIN_FIELDS: 3,                    // Minimum fields for valid extraction
  MIN_YMM_CONFIDENCE: 0.8,          // Minimum confidence for year/make/model
  ESCALATION_THRESHOLD: 0.6,        // Below this, Haiku escalates to Sonnet
  AUTO_APPROVE_THRESHOLD: 0.9,      // Above this, auto-approve without review
  MAX_NULL_RATIO: 0.5,              // Maximum acceptable null ratio
};
```

### Parsing LLM JSON Responses

LLMs sometimes wrap JSON in markdown code blocks. `parseJsonResponse()` handles this:

```typescript
export function parseJsonResponse<T = any>(raw: string): T {
  // Try raw JSON first
  try { return JSON.parse(raw); } catch {}

  // Try extracting from ```json ... ``` block
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1].trim()); } catch {}
  }

  // Try finding first { ... } or [ ... ]
  const jsonMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch {}
  }

  throw new Error(`Failed to parse JSON from LLM response`);
}
```

---

## The Haiku Extraction Worker

The Haiku worker is the workhorse. It handles 80% of extraction volume at 3x lower cost than Sonnet.

### Actions

| Action | Input | Output |
|--------|-------|--------|
| `extract_listing` | HTML/markdown + URL | Full vehicle data JSON |
| `parse_title` | Listing title string | Year/make/model JSON |
| `parse_titles` | Array of title strings | Array of year/make/model JSONs |
| `extract_fields` | Text + field list | Extracted fields JSON |
| `batch_extract` | batch_size (pulls from queue) | Processing results |

### Extraction Prompt

The system prompt defines the exact output schema. This is critical -- the LLM must return ONLY JSON with NO other text:

```typescript
const LISTING_EXTRACTION_SYSTEM = `You are a vehicle data extraction specialist.
Extract structured data from vehicle listing pages with high precision.

RULES:
1. Extract ONLY what is explicitly stated -- never infer or guess.
2. For prices, parse numbers (e.g., "$45,000" -> 45000). Use the FINAL sale price.
3. For mileage, parse the number (e.g., "23,000 miles" -> 23000).
4. For VINs, validate they are exactly 17 characters.
5. Normalize make names (e.g., "Chevy" -> "Chevrolet").
6. Extract ALL image URLs that show the vehicle. Skip logos, avatars, and ads.
7. Return null for any field you cannot confidently extract.
8. Include your confidence (0.0 to 1.0) for the overall extraction.

RESPOND WITH ONLY THIS JSON (no other text):
{
  "year": <number|null>,
  "make": <string|null>,
  "model": <string|null>,
  "trim": <string|null>,
  "vin": <string|null>,
  "mileage": <number|null>,
  "exterior_color": <string|null>,
  "interior_color": <string|null>,
  "engine": <string|null>,
  "transmission": <string|null>,
  "drivetrain": <string|null>,
  "sale_price": <number|null>,
  "asking_price": <number|null>,
  "sale_status": <string|null>,
  "seller_name": <string|null>,
  "seller_location": <string|null>,
  "description": <string|null>,
  "image_urls": <string[]>,
  "source_platform": <string|null>,
  "confidence": <number 0.0-1.0>
}`;
```

### Content Truncation

Haiku receives at most 12,000 characters. This keeps calls fast and cheap:

```typescript
const truncated = content.slice(0, 12_000);
const userMessage = `URL: ${url}\n\nPage content (${contentType}):\n${truncated}`;
```

### Quality Assessment

After extraction, the worker scores the result:

```typescript
const KEY_FIELDS = [
  "year", "make", "model", "vin", "mileage", "exterior_color",
  "engine", "transmission", "sale_price", "asking_price",
  "seller_location", "description", "image_urls",
  "sale_status", "title_text",
];

function assessQuality(extracted: any) {
  let score = 1.0 - (nullFields.length / KEY_FIELDS.length);

  // Penalize validation issues (invalid VIN length, out-of-range year)
  score -= issues.length * 0.1;

  // Bonus for core YMM
  if (extracted.year && extracted.make && extracted.model) {
    score = Math.min(1.0, score + 0.15);
  }

  // Bonus for price
  if (extracted.sale_price || extracted.asking_price) {
    score = Math.min(1.0, score + 0.05);
  }

  return { score, fieldsExtracted, totalFields, nullFields, issues };
}
```

### Escalation Logic

Haiku escalates to Sonnet when:

```typescript
// Quality score below threshold
if (quality.score < QUALITY_THRESHOLDS.ESCALATION_THRESHOLD) {  // 0.6
  needsEscalation = true;
  escalationReason = `low_quality_score:${quality.score}`;
}

// No year/make/model extracted at all
if (!parsed.year && !parsed.make && !parsed.model) {
  needsEscalation = true;
  escalationReason = "no_ymm_extracted";
}

// LLM self-reported low confidence
if (parsed.confidence < QUALITY_THRESHOLDS.MIN_YMM_CONFIDENCE) {  // 0.8
  needsEscalation = true;
  escalationReason = `low_confidence:${parsed.confidence}`;
}
```

### Queue Integration

When processing from the queue, the worker first checks for archived content:

```typescript
// Try archived content first (free, instant)
const { data: snapshot } = await sb
  .from("listing_page_snapshots")
  .select("html, markdown")
  .eq("listing_url", item.listing_url)
  .order("fetched_at", { ascending: false })
  .limit(1)
  .maybeSingle();

if (content.length > 200) {
  // Extract from archived content
  extraction = await extractListing(content, url, "markdown");
} else if (item.listing_title) {
  // No content, but have title -- parse that
  const titleResult = await parseTitle(item.listing_title);
  extraction = { data: titleResult.data, needsEscalation: true };
} else {
  // Nothing to work with
  extraction = { data: null, needsEscalation: true };
}
```

---

## The Reference Implementation: extract-bat-core

`extract-bat-core` is the most mature extractor. It demonstrates every pattern that other extractors should follow.

### Version

```typescript
const EXTRACTOR_VERSION = 'extract-bat-core:3.0.0';
```

All extractors should version themselves. This enables tracking which version produced which data.

### Flow

1. **Fetch HTML** directly (BaT pages are server-rendered, no Firecrawl needed)
2. **Archive HTML** to `listing_page_snapshots`
3. **Extract title/identity** from `<h1>`, `og:title`, URL slug
4. **Extract essentials** (seller, location, lot, VIN, mileage, colors, transmission, engine, bids, price)
5. **Extract description** from post-excerpt or post-content div
6. **Extract images** from the gallery data attribute
7. **Normalize all fields** via `normalizeVehicleFields()`
8. **Quality gate** via `qualityGate()`
9. **Upsert** vehicle, vehicle_events, vehicle_images, auction_events
10. **Record extraction metadata** per-field provenance

### Identity Extraction

BaT titles follow a consistent format. The extractor prioritizes HTML `<h1>` with `post-title` class, falls back to `og:title` meta tag, then `<title>` tag. It strips BaT-specific SEO suffixes:

```typescript
function cleanBatTitle(raw: string): string {
  let t = stripTags(raw);
  t = t
    .replace(/\s+for sale on BaT Auctions.*$/i, "")
    .replace(/\s+on BaT Auctions.*$/i, "")
    .replace(/\s*\|.*Bring a Trailer.*$/i, "")
    .replace(/\s*\(Lot #[\d,]+\).*$/i, "")
    .trim();
  return t;
}
```

The URL slug is also parsed as a fallback identity source:

```typescript
// URL: /listing/1967-porsche-911s-43/
// Parsed: { year: 1967, make: "Porsche", model: "911s" }
function parseBatIdentityFromUrl(listingUrl: string) {
  const m = u.pathname.match(/\/listing\/(\d{4})-([^/]+)\/?$/i);
  // Handle multi-word makes: alfa -> "Alfa Romeo", mercedes -> "Mercedes-Benz"
}
```

### Essentials Extraction

BaT has a structured "essentials" block in the HTML. The extractor scopes its search to this block (first 50KB of the essentials div) to prevent comment pollution:

```typescript
const essentialsIdx = h.indexOf('<div class="essentials"');
// CRITICAL: Limit to 50KB to prevent comment pollution
const win = essentialsIdx >= 0 ? h.slice(essentialsIdx, essentialsIdx + 50000) : h;
```

### Price Extraction Hierarchy

Price extraction is the most complex part due to multiple signals and potential pollution from user comments mentioning other vehicles' prices:

1. **Highest signal: Auction Result table** (`listing-bid` table in HTML)
2. **Title text** (low-noise extraction: "Sold for $76,500")
3. **Essentials text** (scoped to essentials block only, NOT full page)
4. **Never search full page text for prices** (comments reference other vehicles)

```typescript
// CRITICAL: If stats show "Reserve Not Met", there is NO sale price
if (soldPriceFromStats && !statsHasReserveNotMet) {
  sale_price = soldPriceFromStats;
} else if (statsHasReserveNotMet) {
  sale_price = null;  // Force clear any polluted sale price
  reserve_status = "reserve_not_met";
}
```

### Image Extraction

BaT images are in a JSON data attribute on the gallery div:

```typescript
function extractImages(html: string): string[] {
  const idx = h.indexOf('id="bat_listing_page_photo_gallery"');
  const win = h.slice(idx, idx + 5000000);
  const m = win.match(/data-gallery-items=(?:"([^"]+)"|'([^']+)')/i);
  // Decode HTML entities, parse JSON array, extract full-res URLs
  // Normalize: strip -scaled, -WxH suffixes, query params
}
```

---

## Field Normalization

Every extractor must normalize fields before writing to the database. This prevents data quality drift where "Chevy", "CHEVROLET", and "Chevrolet" coexist.

### normalizeVehicleFields()

From `_shared/normalizeVehicle.ts`:

```typescript
export function normalizeVehicleFields(data: Record<string, any>) {
  if (data.make) data.make = normalizeMake(data.make);
  if (data.model) data.model = normalizeModel(data.model);
  if (data.vin) data.vin = normalizeVin(data.vin);
  if (data.year) data.year = normalizeYear(data.year);
  if (data.transmission) data.transmission = normalizeTransmission(data.transmission);
  if (data.drivetrain) data.drivetrain = normalizeDrivetrain(data.drivetrain);
  if (data.trim) data.trim = normalizeTrim(data.trim);
  if (data.body_style) {
    const { body_style, rpo_code } = normalizeBodyStyle(data.body_style);
    data.body_style = body_style;
    if (rpo_code && !data.trim) data.trim = rpo_code;
  }
  if (data.exterior_color) data.exterior_color = normalizeColor(data.exterior_color);
  if (data.interior_color) data.interior_color = normalizeColor(data.interior_color);
  // Source normalization: resolve to canonical platform slug
  for (const field of ['source', 'listing_source', 'auction_source']) {
    if (data[field]) data[field] = normalizeSource(data[field]);
  }
  return data;
}
```

### Make Normalization

107 aliases map to canonical make names:

```typescript
const MAKE_ALIASES = {
  'chevy': 'Chevrolet',
  'vw': 'Volkswagen',
  'merc': 'Mercedes-Benz',
  'mercedes': 'Mercedes-Benz',
  'alfa': 'Alfa Romeo',
  'rolls royce': 'Rolls-Royce',
  'land rover': 'Land Rover',
  'ih': 'International Harvester',
  // ... 100+ more
};
```

### VIN Normalization

```typescript
export function normalizeVin(vin: string | null): string | null {
  const cleaned = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (cleaned.length < 6 || cleaned.length > 17) return null;
  // Reject placeholders
  if (/^[0]+$/.test(cleaned) || cleaned === 'UNKNOWN') return null;
  return cleaned;
}
```

### Transmission Normalization

Handles verbose patterns like "Four-Speed Automatic Transmission" to "4-Speed Automatic":

```typescript
// "Four-Speed" -> "4-Speed"
result = result.replace(
  /^(two|three|four|five|six|seven|eight|nine|ten)[-\s]*/i,
  (_, word) => (WORD_TO_NUM[word.toLowerCase()] || word) + '-'
);
// Strip trailing "transmission"
result = result.replace(/\s*(transmission|gearbox|transaxle)\s*$/i, '');
```

### Source Normalization

60+ aliases map to canonical platform slugs:

```typescript
const SOURCE_ALIASES = {
  'bat': 'bat',
  'bat_simple_extract': 'bat',
  'bring a trailer': 'bat',
  'cars_and_bids': 'cars-and-bids',
  'facebook_marketplace': 'facebook-marketplace',
  // ... 60+ more
};
```

---

## Quality Gate

Every extractor must call `qualityGate()` before writing to the vehicles table. This prevents garbage data (HTML fragments in fields, full listing titles stuffed into the model field, $5 sale prices) from entering the database.

From `_shared/extractionQualityGate.ts`:

```typescript
const result = qualityGate(vehicleData, {
  source: 'mecum',
  sourceType: 'auction'
});

if (result.action === 'reject') {
  console.log('Rejected:', result.issues);
  return;
}
if (result.action === 'flag_for_review') {
  vehicleData.needs_review = true;
}
// Proceed with upsert using result.cleaned (sanitized data)
```

The quality gate checks:
- Year in valid range (1885 to current+2)
- Make is not polluted (no HTML, no auction metadata)
- Model is not a full listing title
- VIN passes checksum validation
- Price is reasonable (not $0, not $100M+)
- No HTML tags in text fields
- Fields are not truncated auction site chrome

---

## How to Add a New Source (Step by Step)

### Step 1: Discover the Schema

Follow the Schema Discovery Principle. Do NOT define your extraction schema before seeing real data.

```
1. Fetch 20-50 sample pages from the new source
2. Store them via archiveFetch() -- now they're preserved
3. Manually inspect the HTML structure
4. Enumerate ALL fields that exist
5. Map them to the ExtractedVehicle schema
6. Identify which fields need custom parsing vs. AI extraction
```

### Step 2: Register the Source

```sql
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES ('xyz-auctions', 'XYZ Auctions', 'auction', 0.75, ARRAY['listing', 'comment', 'bid']);
```

### Step 3: Create the Extractor

Create `supabase/functions/extract-xyz/index.ts` following the BaT pattern:

```typescript
import { archiveFetch } from "../_shared/archiveFetch.ts";
import { normalizeVehicleFields } from "../_shared/normalizeVehicle.ts";
import { qualityGate } from "../_shared/extractionQualityGate.ts";
import { corsHeaders } from "../_shared/cors.ts";

const EXTRACTOR_VERSION = 'extract-xyz:1.0.0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { url, save_to_db = true } = await req.json();

  // 1. Fetch + archive
  const { html, markdown } = await archiveFetch(url, { platform: "xyz" });

  // 2. Extract (deterministic parse or AI)
  const extracted = parseXyzListing(html);

  // 3. Normalize
  normalizeVehicleFields(extracted);

  // 4. Quality gate
  const qg = qualityGate(extracted, { source: 'xyz', sourceType: 'auction' });
  if (qg.action === 'reject') {
    return new Response(JSON.stringify({ success: false, error: qg.issues }));
  }

  // 5. Upsert
  if (save_to_db) {
    // upsert to vehicles, vehicle_events, vehicle_images
  }

  return new Response(JSON.stringify({ success: true, extracted }));
});
```

### Step 4: Add URL Routing

Edit `process-import-queue/index.ts` to add the new domain:

```typescript
} else if (normalizedUrl.includes('xyz-auctions.com')) {
  extractorUrl = supabaseUrl + '/functions/v1/extract-xyz';
}
```

### Step 5: Add to TOOLS.md

Add an entry to `TOOLS.md` so other agents know the extractor exists:

```markdown
| Extract XYZ Auctions listing | `extract-xyz` | |
```

### Step 6: Deploy

```bash
cd /Users/skylar/nuke
supabase functions deploy extract-xyz --no-verify-jwt
```

### Step 7: Test

```bash
dotenvx run -- bash -c 'curl -s -X POST \
  "$VITE_SUPABASE_URL/functions/v1/extract-xyz" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"https://xyz-auctions.com/lot/12345\"}"' | jq
```

---

## Extraction Metadata (Provenance Tracking)

The `extraction_metadata` table records per-field provenance. For every field extracted, it stores which extractor set the value, when, from which source URL, and with what confidence:

```typescript
await trySaveExtractionMetadata({
  supabase,
  vehicleId: vehicle.id,
  fieldName: "sale_price",
  fieldValue: "76500",
  sourceUrl: listingUrl,
  extractionMethod: "html_regex",
  scraperVersion: EXTRACTOR_VERSION,
  confidenceScore: 0.95,
  validationStatus: "unvalidated",
});
```

This enables auditing any field value back to its source evidence. "Where did this sale price come from?" is always answerable.

---

## Known Problems

1. **Haiku content truncation at 12K chars.** Some listing pages have critical data (like the VIN in listing details) beyond the 12K character mark. The truncation point should be smarter (extract the essentials/details section specifically, not just the first 12K chars).

2. **No structured prompt for source-specific fields.** The Haiku extraction prompt is generic. Source-specific prompts (e.g., "BaT listings always have the VIN in the Listing Details section") would improve extraction quality.

3. **Quality scoring is field-count based.** A listing with year, make, model, and nothing else scores 0.35 (3/15 + 0.15 YMM bonus). But for many use cases, YMM alone is sufficient. The quality threshold should be configurable per use case.

4. **No re-extraction on extractor upgrade.** When `extract-bat-core` is updated from v2 to v3, there is no mechanism to re-extract previously processed listings with the new version. The archived HTML in `listing_page_snapshots` makes this possible, but the triggering logic does not exist.

5. **Cost tracking is approximate.** The `costCents` calculation in `agentTiers.ts` uses the per-MTok pricing but does not account for cached tokens or batched requests.
