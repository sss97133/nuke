# Backfill Make/Model Using Firecrawl MCP

This guide explains how to use Firecrawl MCP tools to extract make/model from vehicle URLs.

## Setup

1. **Firecrawl MCP Server** is already configured in Cursor
2. **API Key** should be set in MCP server configuration
3. **Tools Available**: `firecrawl_extract`, `firecrawl_scrape`, `firecrawl_batch_scrape`

## Approach

Since Firecrawl API credits are exhausted, we'll use MCP tools which may have different rate limits or access to previously scraped data.

### Option 1: Extract with Schema (Recommended)

Use `firecrawl_extract` with a schema to get structured make/model data:

```typescript
// Schema for extraction
const extractionSchema = {
  type: "object",
  properties: {
    make: { type: "string", description: "Vehicle manufacturer name" },
    model: { type: "string", description: "Vehicle model name" },
    year: { type: "number", description: "Vehicle year if available" }
  },
  required: ["make", "model"]
};

// Extract from URLs
firecrawl_extract({
  urls: [vehicleUrl1, vehicleUrl2, ...],
  prompt: "Extract the vehicle make and model from this listing page",
  schema: extractionSchema
});
```

### Option 2: Scrape and Parse

Use `firecrawl_scrape` to get markdown/HTML, then parse:

```typescript
firecrawl_scrape({
  url: vehicleUrl,
  formats: ["markdown", "html"],
  onlyMainContent: true
});
```

## Batch Processing

1. **Prepare vehicle list**:
   ```bash
   npm run backfill:make-model:mcp-prep -- --limit 100 --out data/json/vehicles-batch-1.json
   ```

2. **Extract in batches** using MCP tools (via AI assistant)

3. **Update database** with extracted make/model

## Current Status

- **Vehicles missing make**: ~4,035
- **Vehicles with URLs**: ~3,970 (98.4%)
- **Ready for extraction**: Yes, once MCP auth is configured

## Next Steps

1. Verify MCP server has valid `FIRECRAWL_API_KEY`
2. Test extraction on a few URLs
3. Process remaining vehicles in batches
4. Update database with extracted make/model
