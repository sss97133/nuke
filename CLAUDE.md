# Nuke - Vehicle Data Extraction Platform

Autonomous extraction system for collector vehicle data. Pipeline: **Link → Entity Recognition → Vehicle Linking → Timeline Storage → Discovery Agent**

---

## MULTI-AGENT COORDINATION (READ FIRST)

**You are likely one of multiple Claude agents working concurrently.** Before starting any significant work:

### 1. Check Active Sessions
```bash
# See all running Claude Code terminals
ps aux | grep "claude" | grep -v grep | awk '{print "PID:", $2, "TTY:", $7, "Time:", $10}'

# See what each is working on
cat /Users/skylar/nuke/.claude/ACTIVE_AGENTS.md
```

### 2. Register Yourself
Add your session to the file with:
- What you're working on
- Which files/areas you're touching
- Timestamp

### 3. Claim Work Before Starting
If another agent is working on a file/area, **pick something else**. Coordinate via:
- The `ACTIVE_AGENTS.md` file
- Database: check `import_queue` claims and `processing_status`

### 4. Check Recent Session Logs
See what other sessions did recently:
```bash
# Last 3 sessions with summaries
cat ~/.claude/projects/-Users-skylar-nuke/sessions-index.json | jq '.entries[-3:] | .[] | {modified, summary: .firstPrompt[0:100]}'

# Debug log from current/latest session
tail -50 ~/.claude/debug/latest
```

### 5. Deconflict File Edits
- **Database migrations**: Only one agent creates migrations at a time
- **Edge functions**: Check git status before editing shared files
- **Scripts**: Coordinate via ACTIVE_AGENTS.md

---

## IMPORTANT: Auto-Execute Behavior

**If the user's message is just a URL (or starts with a URL):**
1. DO NOT ask clarifying questions
2. Immediately treat it as "extract this"
3. Get coordination brief for context
4. Identify the domain and check for existing extractor
5. Run extraction (existing extractor OR Firecrawl → AI)
6. Report results

This is the default behavior. Just do it.

---

## SCHEMA DISCOVERY PRINCIPLE (CRITICAL)

**Never pre-define a schema before seeing the actual data.**

Before building ANY extractor for a new document type or data source:

1. **DISCOVERY FIRST**: Sample 20-50 documents, enumerate ALL fields that exist
2. **AGGREGATE**: Compile field catalog with frequencies
3. **THEN DESIGN**: Build schema based on what actually exists
4. **THEN EXTRACT**: Extract once with complete schema

```
❌ Wrong: Define schema → Extract → Miss fields → Re-extract
✅ Right: Discover fields → Design schema → Extract once
```

**This applies to:**
- New document types (receipts, invoices, titles)
- New data sources (new auction platform, forum)
- User-uploaded content (format varies)

**Full documentation:** `docs/architecture/SCHEMA_DISCOVERY_PRINCIPLE.md`

> "The data knows what it contains. Ask it before you assume."

---

## Available Tools

### MCP Servers (USE THESE - you have direct access)

**supabase** - Database and edge functions
```
mcp__supabase__execute_sql     # Run SQL directly
mcp__supabase__get_logs        # Check function logs
mcp__supabase__apply_migration # Apply schema changes
```

**firecrawl** - Web scraping (handles JS)
```
mcp__firecrawl__scrape_url     # Scrape single page
mcp__firecrawl__crawl_url      # Crawl multiple pages
mcp__firecrawl__map_url        # Get site structure
```

**playwright** - Browser automation
```
mcp__playwright__navigate      # Go to URL
mcp__playwright__click         # Click elements
mcp__playwright__screenshot    # Capture page
```

You can call these directly - no curl needed for basic operations.

### CLI Tools
- `dotenvx` - Encrypted secrets management (`dotenvx run -- [command]`)
- `supabase` - Deploy functions, manage DB (`supabase functions deploy [name] --no-verify-jwt`)
- `docker` - Container operations

### Global Commands
- `ralph` - Start autonomous development loop
- `ralph-monitor` - Live dashboard

## Quick Start: Get Context

Use Supabase MCP to call the coordination brief, or fallback to curl with dotenvx:

```bash
cd /Users/skylar/nuke && dotenvx run -- bash -c 'curl -s -X POST \
  "$VITE_SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"action\": \"brief\"}"' | jq
```

Returns: queue health, failing domains, error patterns, recommended next actions.

**Note**: Use `dotenvx run --` to inject secrets without exposing them. Never source .env directly.

## Extraction Workflow

When user says "extract [URL]":

1. **Check for existing extractor** in `/Users/skylar/nuke/supabase/functions/`
2. **If exists**: Call via Supabase MCP or curl
3. **If not**: Use **Firecrawl MCP** to scrape, then process with AI

⚠️ **Building a NEW extractor?** Read SCHEMA DISCOVERY PRINCIPLE above first. Run field discovery before defining your extraction schema.

### Key Edge Functions

| Function | Purpose |
|----------|---------|
| `universal-search` | **Magic input handler** - searches vehicles, orgs, users, tags with thumbnails |
| `ralph-wiggum-rlm-extraction-coordinator` | Coordination brief for system status |
| `bat-simple-extract` | Bring a Trailer extraction |
| `extract-cars-and-bids-core` | Cars & Bids extraction |
| `extract-hagerty-listing` | Hagerty Marketplace extraction |
| `import-pcarmarket-listing` | PCarMarket extraction |
| `extract-vehicle-data-ai` | AI-powered generic extraction |
| `discovery-snowball` | Recursive lead discovery |
| **Unknown source** | Use Firecrawl MCP → AI |

### No Extractor? Use This Flow:
1. Use **Firecrawl MCP** to scrape the URL
2. Parse scraped content for vehicle data (year, make, model, price, images, etc.)
3. Either insert directly to `import_queue` or call `extract-vehicle-data-ai`
4. Report what was extracted

### New Source Extraction (Firecrawl)

For sources without a dedicated extractor, use Firecrawl MCP to scrape, then:
1. Parse the scraped content for vehicle data
2. Match to `ExtractedVehicle` schema
3. Insert to `import_queue` or call `extract-vehicle-data-ai`

### Standard Schema
```typescript
interface ExtractedVehicle {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  sale_price: number | null;
  seller_username: string | null;
  image_urls: string[];
  description: string | null;
}
```

## Database (Supabase)

Project: `qkgaybvrernstplzjaam`

### FIRST: Check Quick Stats
Before querying individual tables, get the big picture:
```bash
curl -sS "${VITE_SUPABASE_URL}/functions/v1/db-stats" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | jq .
```
Returns:
- `total_vehicles`, `total_comments`, `vehicles_with_comments`
- `bat_top500_extracted/pending` - extraction progress for high-comment listings
- `comment_discoveries`, `description_discoveries` - AI analysis counts

**This shows the REAL data distribution** - don't trust naive COUNT queries.

### Core Tables (300+ exist, these matter most)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `vehicles` | Core entities (~18k) | id, year, make, model, vin, sale_price |
| `auction_comments` | Extracted comments (~364k) | vehicle_id, comment_text, posted_at |
| `bat_listings` | BaT source data (~4.4k) | vehicle_id, comment_count, comments_extracted_at |
| `vehicle_images` | All images (1M+) | vehicle_id, url |
| `auction_events` | Auction instances | vehicle_id, platform |
| `comment_discoveries` | AI sentiment analysis | vehicle_id, overall_sentiment, sentiment_score |
| `description_discoveries` | AI field extraction | vehicle_id, total_fields, raw_extraction |

### Data Flow: BaT Comments
```
bat_listings (has comment_count)
    → extract-auction-comments (scrapes BaT page)
    → auction_comments (normalized rows)
    → discover-comment-data (AI analysis)
    → comment_discoveries (sentiment/themes)
```

### Tracking Extraction Progress
```bash
# Quick stats (includes extraction progress)
curl -sS "${VITE_SUPABASE_URL}/functions/v1/db-stats" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" | jq '{extracted: .bat_top500_extracted, pending: .bat_top500_pending, pct: .bat_top500_progress_pct}'

# Or check backfill status
curl -sS -X POST "${VITE_SUPABASE_URL}/functions/v1/backfill-comments" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Content-Type: application/json" -d '{"batch_size": 0}'
```

### Common Pitfalls
- **Don't count distinct vehicle_id with LIMIT** - you'll get wrong numbers
- **bat_listings.comment_count** = expected comments, not extracted
- **auction_comments** may have comments for only some vehicles
- **Check `comments_extracted_at`** to know if extraction ran

Use Supabase MCP for queries instead of raw SQL.

## Observation System (New Architecture)

The system is moving from auction-centric to source-agnostic. **All data points are "observations" with provenance.**

### Core Tables

| Table | Purpose |
|-------|---------|
| `observation_sources` | Registry of data sources (auctions, forums, social, etc.) |
| `vehicle_observations` | Unified event store - ALL observations, ANY source |
| `observation_extractors` | Config for how to extract from each source |
| `observation_discoveries` | AI insights derived from observations |

### Adding a New Source (Config, Not Code)

```sql
-- 1. Register source
INSERT INTO observation_sources (slug, display_name, category, base_trust_score, supported_observations)
VALUES ('xyz-auctions', 'XYZ Auctions', 'auction', 0.75, ARRAY['listing', 'comment', 'bid']);

-- 2. Configure extractor (or write edge function)
INSERT INTO observation_extractors (source_id, extractor_type, edge_function_name, produces_kinds)
VALUES ((SELECT id FROM observation_sources WHERE slug = 'xyz-auctions'),
        'edge_function', 'extract-xyz-listing', ARRAY['listing', 'comment']);
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `ingest-observation` | Unified intake - all extractors write through here |
| `discover-from-observations` | Source-agnostic AI analysis |
| `migrate-to-observations` | Port existing data to new system |
| `db-stats` | Quick database overview |

### Observation Flow
```
[Any Source] → ingest-observation → vehicle_observations → discover-from-observations → observation_discoveries
```

### Source Categories
- `auction` - BaT, C&B, RM Sotheby's, Mecum, etc.
- `forum` - Rennlist, Pelican Parts, model-specific
- `social_media` - Instagram, YouTube
- `marketplace` - eBay, Craigslist, Hagerty
- `registry` - Marque registries, Hagerty valuation
- `shop` - Service records, restoration shops
- `owner` - Direct owner input
- `documentation` - Titles, build sheets

## Project Structure

```
/Users/skylar/nuke/
├── supabase/functions/     # 181 edge functions
├── nuke_api/               # Elixir/Phoenix backend
├── nuke_frontend/          # React frontend
├── database/               # Migrations and fixes
├── scripts/                # Ralph shell scripts
└── .env                    # Credentials (don't commit)
```

## Creating New Extractors

Follow pattern in `bat-simple-extract`:

1. Create `/Users/skylar/nuke/supabase/functions/[name]/index.ts`
2. Use shared utilities from `_shared/` (cors, fetcher, etc.)
3. Return structured data matching vehicle schema
4. Deploy: `supabase functions deploy [name] --no-verify-jwt`

## Autonomy Level: HIGH

- Just do extractions without asking
- Create new extractor functions as needed
- Deploy to Supabase directly
- Use Firecrawl for unknown sources
- **Ask first** only for: schema changes, deleting data, changing auth

### Pre-Approved Bash Commands (200+)
You have blanket approval for these - just run them:
- `dotenvx run -- [anything]` - secrets injection
- `supabase *` - all supabase CLI commands
- `psql` with project credentials
- `curl`, `jq`, `node`, `npx tsx`, `python3`
- `git add`, `git commit`, `git push`
- `npm *`, `vercel *`, `gh *`
- `docker run`, `deno check`
- Full list in `~/.claude/settings.local.json`

### Database Direct Access
```bash
# Direct psql connection (pre-approved)
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres
```

Or use the MCP: `mcp__supabase__execute_sql`

## Common Tasks

### "Extract this [URL]"
1. Get coordination brief (context)
2. Identify source domain
3. Use existing extractor OR Firecrawl + AI
4. Report results

### "What's the queue status?"
Query `import_queue` via Supabase MCP or run coordination brief.

### "Add support for [new source]"
1. Use Firecrawl to inspect HTML structure
2. Create extractor following `bat-simple-extract` pattern
3. Test with single URL
4. Deploy with `supabase functions deploy`
