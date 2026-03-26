# Contextual Agent Harness — BYOK AI in Every Popup

## The Model

The user subscribes to Nuke for DATA ACCESS. They bring their own LLM API key
for INTELLIGENCE. We provide the context harness that makes their LLM useful.

```
USER'S LLM KEY (OpenAI/Anthropic/Gemini)
         ↓
┌─ CONTEXT HARNESS ─────────────────────────────┐
│                                                │
│  Popup state:  Porsche MakePopup open          │
│  Vehicle:      1989 911 Carrera 4 Coupe        │
│  Feed filters: year > 1985, price < $200K      │
│  View history: 12 Porsches viewed today        │
│  Interests:    911, C10, K5 Blazer             │
│  Open tabs:    Porsche, 911 Turbo, FB source   │
│                                                │
│  + DATA ACCESS (our API):                      │
│    - Vehicle ontology (339 columns)            │
│    - 11.6M auction comments                    │
│    - 3.3M field evidence rows                  │
│    - 515K buyer profiles                       │
│    - Comparable sales engine                   │
│    - Description discoveries (AI extractions)  │
│                                                │
└────────────────────┬───────────────────────────┘
                     ↓
         CONTEXTUAL AI RESPONSE
   "Based on the 898 911 Turbos in the database,
    this 1996 at $247K is 110% above median.
    However, 3 of the last 5 air-cooled Turbos
    sold above $300K when known collectors were
    bidding. The comment sentiment on this listing
    is 92% positive with zero red flags."
```

## Cost Model

| Who Pays | For What |
|----------|----------|
| **Nuke** | Data ingestion, storage, enrichment crons, feed serving |
| **User** | LLM inference for contextual queries (BYOK) |
| **User** | Nuke API subscription for data access |

We never pay for user-initiated AI queries. We pay for background enrichment
(description discoveries, valuation, etc.) using our own keys at bulk rates.

## The Mini Agent

Each popup gets a mini agent instance. It's not a full autonomous agent —
it's a single-turn contextual responder.

### Agent Inputs
```typescript
interface PopupAgentContext {
  // What popup is this?
  dimension: 'make' | 'model' | 'source' | 'vehicle' | 'comments' | 'bids' | 'price';
  dimensionValue: string;  // "PORSCHE", "911 TURBO", "BAT", vehicle_id

  // What data is loaded in this popup?
  loadedData: any;  // the popup's current dataset

  // What else is the user looking at?
  openPopups: { dimension: string; value: string }[];
  activeVehicle?: { id: string; year: number; make: string; model: string };
  feedFilters?: FeedQueryParams;

  // Who is this user?
  viewHistory: ViewHistoryEntry[];
  interests: { makes: Record<string, number>; models: Record<string, number> };

  // What can the agent access?
  availableRPCs: string[];  // RPCs it can call for deeper data
}
```

### Agent Capabilities
The mini agent can:
1. **Filter** the popup's loaded data (client-side, instant)
2. **Query** deeper data via RPCs (api-v1-comps, schema_stats, make_stats, etc.)
3. **Summarize** what it finds in natural language
4. **Navigate** — suggest clicking into a specific vehicle or dimension
5. **Compare** — pull up side-by-side data from different popups

### Agent CANNOT:
1. Write to the database (read-only)
2. Call external APIs (only Nuke RPCs)
3. Make purchases or bids
4. Access other users' data

## User API Key Setup

Settings page → AI Configuration:
- Enter your OpenAI/Anthropic/Gemini API key
- Key stored in localStorage (never sent to our servers)
- LLM calls go directly from browser → provider API
- Nuke provides the context, user's key pays for inference

```typescript
// In the popup search handler
async function handlePopupSearch(query: string, context: PopupAgentContext) {
  const userKey = localStorage.getItem('nuke:ai:apiKey');
  const provider = localStorage.getItem('nuke:ai:provider'); // openai|anthropic|google

  if (!userKey) {
    // Show "Connect your AI key for smart search" prompt
    return;
  }

  const systemPrompt = buildContextPrompt(context);
  const response = await callUserLLM(provider, userKey, systemPrompt, query);
  return response;
}
```

## Subscription Tiers

| Tier | Data Access | AI Queries | Price |
|------|------------|------------|-------|
| **Free** | Feed browsing, basic search | None (no BYOK) | $0 |
| **Explorer** | Full feed + popups + view history | BYOK — unlimited | $9/mo |
| **Dealer** | + API access + bulk export + alerts | BYOK + our AI for alerts | $49/mo |
| **Enterprise** | + white-label + custom RPCs | Full AI suite | Custom |

## Implementation Path

### Phase 1: Search Input in Popups (agent building now)
- Text search that filters loaded data client-side
- No AI needed, just string matching

### Phase 2: AI Key Setup
- Settings page for BYOK
- localStorage storage
- Provider selection (OpenAI/Anthropic/Google)

### Phase 3: Context Harness
- `useAIContext()` hook collects popup state + user state
- `buildContextPrompt()` creates system prompt from context
- Direct browser → LLM API calls using user's key

### Phase 4: Smart Search
- Search input detects when query needs AI (vs simple filter)
- AI queries include full popup context
- Responses rendered inline in the popup

### Phase 5: Multi-Popup Agent
- Agent can reference data across open popups
- "Compare this 911 to the one I was looking at earlier"
- Cross-popup reasoning with full exploration context
