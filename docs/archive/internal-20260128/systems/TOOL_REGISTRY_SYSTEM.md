# Tool Registry System

## Overview

The Tool Registry System is a central database of all tools (Edge Functions, scripts, services) in the codebase. It prevents duplicate tool creation and enables AI agents to discover existing capabilities before building new ones.

## Purpose

**Problem**: With 200+ Edge Functions, it's impossible to know what already exists. AI agents often rebuild tools that already exist.

**Solution**: Central registry that AI agents query before building anything new.

## Database Schema

### `tool_registry` Table

Stores metadata for all tools:

- **Identity**: `tool_name`, `tool_type`, `category`
- **Location**: `file_path`, `entry_point`
- **Capabilities**: `capabilities[]`, `supported_sources[]`
- **Usage**: `usage_example`, `api_endpoint`, `required_secrets[]`
- **Status**: `is_active`, `is_deprecated`, `replaced_by`
- **Relationships**: `depends_on[]`, `used_by[]`

### `tool_capabilities` Table

Index table for fast "what can do X?" queries:

- `capability` - The capability name (e.g., 'extract_vehicle_data')
- `tool_id` - Reference to tool_registry
- `confidence` - How well this tool handles this capability (0-100)

## Discovery Script

**Location**: `scripts/discover-tools.ts`

**Usage**:
```bash
tsx scripts/discover-tools.ts
```

**What it does**:
1. Scans `supabase/functions/` for Edge Functions
2. Extracts metadata from code (purpose, capabilities, sources)
3. Populates `tool_registry` and `tool_capabilities` tables

## Query Functions

### Find tools by capability
```sql
SELECT * FROM find_tools_by_capability('extract_vehicle_data');
```

### Find tools by source
```sql
SELECT * FROM find_tools_by_source('craigslist.org');
```

### Find tools by category
```sql
SELECT * FROM find_tools_by_category('scraping');
```

## AI Agent Workflow: Check Before Build

### Step 1: Query Registry

**Before building ANY tool**, always check:

```typescript
// Query: "What tools exist for scraping vehicle data?"
const existingTools = await supabase
  .from('tool_registry')
  .select('*')
  .contains('capabilities', ['extract_vehicle_data', 'scrape_vehicle'])
  .eq('is_active', true);

// Or use helper function
const tools = await supabase.rpc('find_tools_by_capability', {
  p_capability: 'extract_vehicle_data'
});
```

### Step 2: Evaluate Existing Tools

- **Can existing tool be extended?** Check if it handles 80% of your use case
- **Is there a similar tool?** Look at `depends_on` and `used_by` relationships
- **Should we create new or enhance existing?** Document your decision

### Step 3: Document Decision

If building new tool:
- **Why existing tools don't work**: List what you checked
- **What's different**: Explain the unique use case
- **How it relates**: Link to related tools in `depends_on`

If extending existing:
- **What you're adding**: New capabilities, sources, etc.
- **Update registry**: Add new capabilities to `tool_capabilities`

## Tool Documentation Template

When documenting a tool, use this format:

```markdown
# Tool: tool-name

## Metadata
- **Type**: Edge Function
- **Category**: Scraping
- **Location**: `supabase/functions/tool-name/index.ts`
- **Status**: ✅ Active
- **Replaces**: None

## Purpose
One-line description of what this tool does.

## Capabilities
- ✅ Capability 1
- ✅ Capability 2
- ✅ Capability 3

## Supported Sources
- `source1.com`
- `source2.com`

## Usage
```typescript
const { data } = await supabase.functions.invoke('tool-name', {
  body: { ... }
});
```

## Dependencies
- `FIRECRAWL_API_KEY` (optional)
- `other-tool-name` (consumes output)

## Related Tools
- `related-tool-1` - For similar use case
- `related-tool-2` - Processes output
```

## Maintenance

### Auto-Discovery

Run discovery script after:
- Adding new Edge Functions
- Major refactoring
- Deprecating tools

### Manual Updates

Update registry manually when:
- Tool purpose changes significantly
- New capabilities added
- Tool is deprecated

### Deprecation

When deprecating a tool:
1. Set `is_deprecated = true`
2. Set `replaced_by` to new tool name
3. Add `deprecation_reason`
4. Update `used_by` relationships

## Benefits

✅ **No duplicate tools**: Registry prevents rebuilding  
✅ **Faster development**: Discover existing tools instantly  
✅ **Better documentation**: Standardized format  
✅ **Auto-discovery**: New tools auto-registered  
✅ **Relationship mapping**: See tool dependencies  

## Example: Future AI Request

**User**: "I need to scrape vehicle data from a new marketplace"

**AI Workflow**:
1. Query registry: `find_tools_by_capability('extract_vehicle_data')`
2. Finds: `scrape-vehicle`, `extract-vehicle-data-ai`, `scrape-multi-source`
3. Evaluates: Can `scrape-vehicle` be extended? Yes, it handles generic listings
4. Decision: Extend existing tool vs. build new
5. Result: No duplicate tool created ✅

