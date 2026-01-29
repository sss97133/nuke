# AI Agent Workflow: Check Before Build

## The Golden Rule

**ALWAYS query the tool registry BEFORE building any new tool.**

This prevents duplicate tool creation and ensures we leverage existing capabilities.

## Standard Workflow

### Step 1: Query Tool Registry

Before building ANY tool, always check:

```typescript
// Option 1: Query by capability
const existingTools = await supabase
  .from('tool_registry')
  .select('*')
  .contains('capabilities', ['extract_vehicle_data', 'scrape_vehicle'])
  .eq('is_active', true)
  .eq('is_deprecated', false);

// Option 2: Use helper function
import { findToolsFor } from '@/services/toolDiscovery';

const tools = await findToolsFor('extract_vehicle_data');

// Option 3: Query by source/domain
const sourceTools = await findToolsForSource('craigslist.org');

// Option 4: Query by category
const scrapingTools = await findToolsByCategory('scraping');
```

### Step 2: Evaluate Existing Tools

For each existing tool found:

1. **Read the tool's code** - Check `file_path` in registry
2. **Check capabilities** - Does it handle your use case?
3. **Check dependencies** - What does it depend on? What uses it?
4. **Check supported sources** - Does it already support your source?

**Decision Matrix**:

| Existing Tool Covers | Action |
|---------------------|--------|
| 100% of use case | ✅ Use existing tool |
| 80%+ of use case | ✅ Extend existing tool |
| 50-80% of use case | ⚠️ Consider extending vs. new tool |
| <50% of use case | ✅ Build new tool (document why) |

### Step 3: Document Decision

**If using existing tool:**
```markdown
## Tool Selection

Found existing tool: `scrape-vehicle`
- Handles: Vehicle data extraction from listings
- Supports: Craigslist, BaT, generic HTML
- Decision: Using existing tool, no new tool needed
```

**If extending existing tool:**
```markdown
## Tool Extension

Extending: `scrape-vehicle`
- Adding: Support for new marketplace (dupontregistry.com)
- Changes: New source detection, updated selectors
- Registry update: Add 'dupontregistry.com' to supported_sources
```

**If building new tool:**
```markdown
## New Tool Justification

Why existing tools don't work:
- `scrape-vehicle`: Doesn't handle authenticated sessions
- `scrape-multi-source`: Too generic, needs site-specific logic

What's different:
- Requires OAuth flow before scraping
- Needs session management
- Different data structure

Related tools:
- `scrape-vehicle` - Similar purpose, different auth
- `process-import-queue` - Will consume output
```

### Step 4: Register New Tool (if building)

If you build a new tool, immediately register it:

```typescript
await supabase.from('tool_registry').insert({
  tool_name: 'new-tool-name',
  tool_type: 'edge_function',
  category: 'scraping',
  file_path: 'supabase/functions/new-tool-name/index.ts',
  purpose: 'One-line description',
  capabilities: ['capability1', 'capability2'],
  supported_sources: ['source1.com'],
  required_secrets: ['API_KEY'],
  depends_on: ['other-tool-name'],
});

// Register capabilities
await supabase.from('tool_capabilities').insert(
  ['capability1', 'capability2'].map(cap => ({
    capability: cap,
    tool_id: toolId,
    confidence: 100,
  }))
);
```

## Common Queries

### "I need to scrape vehicle data"
```typescript
const tools = await findToolsFor('extract_vehicle_data');
// Returns: scrape-vehicle, extract-vehicle-data-ai, scrape-multi-source
```

### "I need to handle duplicates"
```typescript
const tools = await findToolsFor('handle_duplicates');
// Returns: process-import-queue, vehicle-deduplication-service
```

### "I need to process a queue"
```typescript
const tools = await findToolsByCategory('processing');
// Returns: process-import-queue, process-cl-queue, etc.
```

### "I need to scrape Craigslist"
```typescript
const tools = await findToolsForSource('craigslist.org');
// Returns: scrape-vehicle, scrape-all-craigslist-squarebodies, etc.
```

## Anti-Patterns (Don't Do This)

❌ **Building without checking**: "I'll just create a new scraper"
✅ **Check first**: Query registry, evaluate existing tools

❌ **Ignoring existing tools**: "This tool is close but I'll build my own"
✅ **Extend existing**: Add capabilities to existing tool

❌ **Not documenting**: Building tool without explaining why
✅ **Document decision**: Explain why existing tools don't work

❌ **Not registering**: Building tool but not adding to registry
✅ **Register immediately**: Add to registry as you build

## Quick Reference

**Tool Discovery Service**: `nuke_frontend/src/services/toolDiscovery.ts`

**Registry Tables**:
- `tool_registry` - All tools
- `tool_capabilities` - Capability index

**Helper Functions**:
- `findToolsFor(capability)` - Find by capability
- `findToolsForSource(source)` - Find by source
- `findToolsByCategory(category)` - Find by category
- `searchTools(query)` - Search by name/purpose

**Discovery Script**: `scripts/discover-tools.ts` (runs automatically, can be run manually)

