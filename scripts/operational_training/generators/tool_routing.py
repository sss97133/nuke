"""Generate tool routing training examples.

Teaches the model which Nuke edge function to use for each intent.
"""

import random
from ..parsers.tools_md_parser import ToolEntry, AntiPattern

OPERATIONAL_SYSTEM_PROMPT = """You are Nuke, a vehicle data intelligence agent and platform operator built by Nuke Ltd (nuke.ag).

DOMAIN 1 — VEHICLE INTELLIGENCE:
You are an expert in collector and vintage vehicles — identification, valuation, condition assessment, provenance verification, and market analysis. You follow: IDENTIFY → COMPARE → ASSESS → VALUE → ADVISE. Trust hierarchy: VIN/NHTSA (100) > Title (90) > Auction Listing (85) > Receipt (80) > AI Analysis (65) > User Input (50) > Enrichment (30).

DOMAIN 2 — PLATFORM OPERATIONS:
You know how to operate the Nuke platform:
- 60+ edge functions mapped by intent (TOOLS.md registry)
- Pipeline field ownership (pipeline_registry — who writes what column)
- Data quality diagnosis (missing fields, broken extractions, stale locks)
- 15 hard rules that prevent platform bloat (no new functions without retiring one, batch all large writes, etc.)
- Incident recovery patterns (lock release, queue triage, PostgREST reload)
- Source-specific completeness expectations (BaT 95% VIN, Barrett-Jackson 33%)
- Agent tier routing: Haiku ($1/MTok) for routine, Sonnet ($3/MTok) for review, Opus ($5/MTok) for strategy

You cite specific functions, SQL queries, and procedures. You never guess tool names — if unsure, say so."""


def make_pair(user_msg: str, assistant_msg: str, category: str = "tool_routing") -> dict:
    return {
        "messages": [
            {"role": "system", "content": OPERATIONAL_SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": assistant_msg},
        ],
        "category": category,
    }


# Question templates for variety
DIRECT_TEMPLATES = [
    "How do I {intent}?",
    "What tool should I use to {intent}?",
    "I need to {intent}. What function handles this?",
    "Which edge function handles: {intent}?",
    "What's the right way to {intent} in Nuke?",
]

SCENARIO_TEMPLATES = [
    "I have a {context}. How do I process it?",
    "Someone gave me a {context} — what do I do with it?",
    "I'm looking at a {context} and need to get data from it.",
    "We just received a {context}. Walk me through the extraction.",
]

URL_DOMAINS = {
    "Bring a Trailer": ("bringatrailer.com/listing/", "complete-bat-import"),
    "Cars & Bids": ("carsandbids.com/auctions/", "extract-cars-and-bids-core"),
    "Hagerty": ("hagerty.com/marketplace/", "extract-hagerty-listing"),
    "PCarMarket": ("pcarmarket.com/auction/", "import-pcarmarket-listing"),
    "Craigslist": ("craigslist.org/cto/", "extract-craigslist"),
    "eBay Motors": ("ebay.com/itm/", "extract-ebay-motors"),
    "Facebook Marketplace": ("facebook.com/marketplace/item/", "extract-facebook-marketplace"),
    "Bonhams": ("bonhams.com/auction/", "extract-bonhams"),
    "RM Sotheby's": ("rmsothebys.com/en/lots/", "extract-rmsothebys"),
    "Mecum": ("mecum.com/lots/", "extract-mecum"),
    "Barrett-Jackson": ("barrett-jackson.com/Events/", "extract-barrett-jackson"),
}


def generate_tool_routing(tools: list[ToolEntry], antipatterns: list[AntiPattern], limit: int = 3000) -> list[dict]:
    pairs = []

    # 1. Direct intent → function mapping (1 per tool, 5 phrasings each)
    for tool in tools:
        intent_lower = tool.intent.lower().rstrip(".")
        func = tool.function

        for template in random.sample(DIRECT_TEMPLATES, min(3, len(DIRECT_TEMPLATES))):
            question = template.format(intent=intent_lower)
            answer = f"Use `{func}`."
            if tool.notes:
                answer += f" {tool.notes}"
            if tool.writes_to:
                answer += f" Writes to: {tool.writes_to}."
            answer += f"\n\nThis is in the **{tool.section}** section of the tool registry."
            pairs.append(make_pair(question, answer))

    # 2. URL-based routing
    for platform, (domain, func) in URL_DOMAINS.items():
        vehicles = [
            "1972 Porsche 911S Targa", "1967 Ford Mustang Fastback",
            "1985 Toyota Land Cruiser FJ60", "1955 Mercedes-Benz 300SL Gullwing",
            "1969 Chevrolet Camaro Z/28", "1973 BMW 2002 Turbo",
            "1988 Porsche 959", "1957 Chevrolet Bel Air",
        ]
        for vehicle in random.sample(vehicles, min(3, len(vehicles))):
            url = f"https://{domain}{vehicle.lower().replace(' ', '-')}"
            pairs.append(make_pair(
                f"Extract this listing: {url}",
                f"That's a {platform} URL. Use `{func}` to extract it.\n\n"
                f"```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/{func}\" \\\n"
                f"  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
                f"  -H \"Content-Type: application/json\" \\\n"
                f"  -d '{{\"url\": \"{url}\"}}'\n```\n\n"
                f"If the URL doesn't match a known extractor, use `extract-vehicle-data-ai` as the generic fallback."
            ))

        # Unknown URL routing
        pairs.append(make_pair(
            "I have a listing from a site I've never seen before: https://example-auctions.com/lot/12345",
            "For unknown sources, use `extract-vehicle-data-ai` — it handles generic AI extraction.\n\n"
            "Alternatively, use Firecrawl MCP to scrape the page first:\n"
            "1. `mcp__firecrawl__scrape_url` to get the HTML/markdown\n"
            "2. Pass the content to `haiku-extraction-worker` with `action: 'extract_listing'`\n"
            "3. If Haiku confidence < 0.9, it auto-escalates to `sonnet-supervisor`\n\n"
            "The result flows into `import_queue` for processing.\n\n"
            "Important: Always use `archiveFetch()` instead of raw `fetch()` — it saves the page to `listing_page_snapshots` for future re-extraction without re-crawling."
        ))

    # 3. Anti-pattern prevention
    for ap in antipatterns:
        pairs.append(make_pair(
            f"I'm going to build {ap.bad_idea}.",
            f"Stop — that already exists. Use `{ap.use_instead}` instead.\n\n"
            f"Building duplicates is Hard Rule #1: \"Do NOT create new edge functions without first adding them to TOOLS.md and confirming no existing function covers the use case.\"\n\n"
            f"The platform bloated from 50 to 464 edge functions because of duplicate tools. Check TOOLS.md before building anything new."
        ))

        # Variation: asking instead of stating
        pairs.append(make_pair(
            f"Do we have {ap.bad_idea}?",
            f"Yes. Use `{ap.use_instead}`.\n\n"
            f"It's already registered in TOOLS.md. Never build a duplicate — the platform bloated to 464 functions from this exact pattern."
        ))

    # 4. Multi-step pipeline questions
    pipeline_questions = [
        (
            "Walk me through the full extraction pipeline for a new URL.",
            "The extraction pipeline has 3 tiers:\n\n"
            "**Step 1: URL → Import Queue**\n"
            "Insert the URL into `import_queue` with status='pending':\n"
            "```sql\nINSERT INTO import_queue (listing_url, status, priority)\nVALUES ('https://...', 'pending', 100);\n```\n\n"
            "**Step 2: Haiku Extraction (Tier 1, $1/MTok)**\n"
            "`haiku-extraction-worker` claims the job, extracts fields (YMM, VIN, price, description), assigns a quality score.\n"
            "- quality >= 0.9 → auto-approved, writes to `vehicles`\n"
            "- quality 0.6-0.9 → escalates to Sonnet\n"
            "- quality < 0.6 → marked failed\n\n"
            "**Step 3: Sonnet Review (Tier 2, $3/MTok)**\n"
            "`sonnet-supervisor` reviews escalations, resolves edge cases (replicas, restomods), approves or rejects.\n\n"
            "**Step 4: Enrichment**\n"
            "After the vehicle record exists: `decode-vin-and-update`, `enrich-factory-specs`, `compute-vehicle-valuation`, `calculate-profile-completeness`.\n\n"
            "**Step 5: Image Processing**\n"
            "`photo-pipeline-orchestrator` analyzes each image: YONO classification (make), Florence-2 (condition, zone, damage)."
        ),
        (
            "How does a BaT listing go from URL to fully extracted vehicle?",
            "BaT has a dedicated two-step pipeline:\n\n"
            "1. **`complete-bat-import`** — the entry point. It calls:\n"
            "   - `extract-bat-core` → scrapes the listing page (title, description, images, price, seller, location)\n"
            "   - `extract-auction-comments` → scrapes the comment thread, writes to `auction_comments`\n\n"
            "2. **Post-extraction enrichment:**\n"
            "   - `decode-vin-and-update` → decodes VIN via NHTSA API\n"
            "   - `enrich-factory-specs` → adds OEM data\n"
            "   - `compute-vehicle-valuation` → generates Nuke estimate\n"
            "   - `calculate-profile-completeness` → sets data_quality_score\n\n"
            "3. **Image intelligence:**\n"
            "   - `photo-pipeline-orchestrator` → queues all images\n"
            "   - `yono-classify` → make/family classification ($0/image)\n"
            "   - `yono-analyze` → condition, zone, damage, modifications\n\n"
            "4. **Sentiment analysis:**\n"
            "   - `discover-comment-data` → AI analysis of comments → `comment_discoveries`\n\n"
            "A fully extracted BaT vehicle has: Y/M/M, VIN, price, description, 50+ images, 50+ comments, sentiment analysis, condition score, and Nuke estimate."
        ),
        (
            "What's the agent tier hierarchy and when do I use each?",
            "Three tiers, each with specific cost and capability:\n\n"
            "**Haiku (Tier 1) — $1/$5 per MTok**\n"
            "Use for: routine extraction, title parsing, field extraction, simple classification.\n"
            "Functions: `haiku-extraction-worker`\n"
            "Actions: `extract_listing`, `parse_title`, `parse_titles`, `batch_extract`\n\n"
            "**Sonnet (Tier 2) — $3/$15 per MTok**\n"
            "Use for: quality review, edge cases, multi-field validation, escalation decisions.\n"
            "Functions: `sonnet-supervisor`\n"
            "Actions: `review_batch`, `dispatch_haiku`, `resolve_edge_case`, `quality_report`\n\n"
            "**Opus (Tier 3) — $5/$25 per MTok**\n"
            "Use for: source prioritization, market intelligence, pipeline optimization strategy.\n"
            "Functions: `agent-tier-router` with `action: 'strategy'`\n\n"
            "**Routing rule:** Start at Haiku. If confidence < 0.9, escalate to Sonnet. If still unclear, escalate to Opus. Never use Opus for routine extraction — it's 5x the cost of Haiku."
        ),
    ]
    for q, a in pipeline_questions:
        pairs.append(make_pair(q, a))

    # 5. Section-level questions
    sections = set(t.section for t in tools)
    for section in sections:
        section_tools = [t for t in tools if t.section == section]
        tool_list = "\n".join(f"- `{t.function}` — {t.intent}" for t in section_tools[:10])
        pairs.append(make_pair(
            f"What tools are available for {section.lower()}?",
            f"**{section}** has {len(section_tools)} registered tools:\n\n{tool_list}\n\n"
            f"Check TOOLS.md for the full list and notes."
        ))

        # "List all X tools"
        pairs.append(make_pair(
            f"List the {section.lower()} tools.",
            f"{len(section_tools)} tools in **{section}**:\n\n{tool_list}"
        ))

    # 6. Reverse lookups — "What does function X do?"
    for tool in tools:
        pairs.append(make_pair(
            f"What does `{tool.function}` do?",
            f"`{tool.function}` handles: {tool.intent}."
            + (f" {tool.notes}" if tool.notes else "")
            + (f" Writes to: {tool.writes_to}." if tool.writes_to else "")
            + f"\n\nRegistered in TOOLS.md under **{tool.section}**.",
            "tool_routing",
        ))

    # 7. Scenario-based routing — real-world situations
    scenario_routing = [
        ("I found a car on Craigslist I want to add to the database.",
         "Use `extract-craigslist` for Craigslist listings.\n\n"
         "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/extract-craigslist\" \\\n"
         "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
         "  -H \"Content-Type: application/json\" \\\n"
         "  -d '{\"url\": \"<craigslist_url>\"}'\n```\n\n"
         "After extraction, run the enrichment pipeline: VIN decode → factory specs → valuation → completeness."),
        ("I have a VIN and want to know everything about this vehicle.",
         "Use `decode-vin-and-update` to get NHTSA data (year, make, model, engine, transmission).\n\n"
         "Then run the enrichment pipeline:\n"
         "1. `enrich-factory-specs` → OEM data, MSRP, production numbers\n"
         "2. `compute-vehicle-valuation` → market-based estimate\n"
         "3. `calculate-profile-completeness` → quality score"),
        ("I want to analyze the comments on a BaT listing.",
         "Two-step process:\n\n"
         "1. Extract comments (if not already): `extract-auction-comments`\n"
         "2. Run AI sentiment analysis: `discover-comment-data`\n\n"
         "Results go to `comment_discoveries` table with: overall_sentiment, sentiment_score, themes, notable_comments."),
        ("I need to process vehicle photos for condition assessment.",
         "Use the photo pipeline:\n\n"
         "1. `photo-pipeline-orchestrator` → queues images for analysis\n"
         "2. YONO classifier → make/family identification ($0/image, local model)\n"
         "3. Florence-2 → condition, zone mapping, damage detection\n\n"
         "Check processing status:\n"
         "```sql\nSELECT ai_processing_status, count(*) FROM vehicle_images\nWHERE vehicle_id = '<id>' GROUP BY ai_processing_status;\n```"),
        ("I want to search for a vehicle by any identifier.",
         "Use `universal-search` — it handles vehicles, organizations, users, and tags:\n\n"
         "```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/universal-search\" \\\n"
         "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
         "  -H \"Content-Type: application/json\" \\\n"
         "  -d '{\"query\": \"1972 Porsche 911\"}'\n```\n\n"
         "Accepts: VIN, year/make/model, partial text, organization names, user names."),
        ("I want to know what a vehicle is worth.",
         "Use `compute-vehicle-valuation`. It produces:\n\n"
         "- `nuke_estimate` — AI-computed market value\n"
         "- `nuke_estimate_confidence` — confidence score (0-1)\n\n"
         "Prerequisites: year, make, model must be set. Works better with VIN, description, and comparable sales in the database.\n\n"
         "Don't write nuke_estimate directly — it's owned by this function (do_not_write_directly=true)."),
        ("I need to check if we already have this vehicle in the database.",
         "Search by VIN (most reliable) or Y/M/M:\n\n"
         "```sql\n-- By VIN\nSELECT id, year, make, model, status FROM vehicles WHERE vin = '<vin>';\n\n"
         "-- By Y/M/M\nSELECT id, year, make, model, vin, status FROM vehicles\n"
         "WHERE year = 1972 AND make ILIKE '%porsche%' AND model ILIKE '%911%';\n```\n\n"
         "Or use `universal-search` edge function for fuzzy matching."),
        ("I want to get the system status and queue health.",
         "Use the coordination brief:\n\n"
         "```bash\ncurl -s -X POST \"$SUPABASE_URL/functions/v1/ralph-wiggum-rlm-extraction-coordinator\" \\\n"
         "  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
         "  -H \"Content-Type: application/json\" \\\n"
         "  -d '{\"action\": \"brief\"}' | jq\n```\n\n"
         "Returns: queue health, failing domains, error patterns, recommended next actions."),
    ]
    for q, a in scenario_routing:
        pairs.append(make_pair(q, a))

    # 8. "Which extractor for this source?" — parameterized
    source_extractors = {
        "Bring a Trailer": "complete-bat-import",
        "Cars & Bids": "extract-cars-and-bids-core",
        "Hagerty": "extract-hagerty-listing",
        "PCarMarket": "import-pcarmarket-listing",
        "Craigslist": "extract-craigslist",
        "eBay Motors": "extract-ebay-motors",
        "Facebook Marketplace": "extract-facebook-marketplace",
        "Bonhams": "extract-bonhams",
        "RM Sotheby's": "extract-rmsothebys",
        "Mecum": "extract-mecum",
        "Barrett-Jackson": "extract-barrett-jackson",
    }
    for source, extractor in source_extractors.items():
        pairs.append(make_pair(
            f"Which extractor should I use for {source}?",
            f"Use `{extractor}` for {source} listings. It's registered in TOOLS.md.",
            "tool_routing",
        ))
        pairs.append(make_pair(
            f"How do I extract a {source} listing?",
            f"Use `{extractor}`:\n\n"
            f"```bash\ncurl -X POST \"$SUPABASE_URL/functions/v1/{extractor}\" \\\n"
            f"  -H \"Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY\" \\\n"
            f"  -H \"Content-Type: application/json\" \\\n"
            f"  -d '{{\"url\": \"<listing_url>\"}}'\n```",
            "tool_routing",
        ))

    random.shuffle(pairs)
    return pairs[:limit]
