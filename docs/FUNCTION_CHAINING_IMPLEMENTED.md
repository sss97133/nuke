# Function Chaining Implementation

## Overview

Both `scrape-all-craigslist-squarebodies` and `discover-cl-squarebodies` now support **function chaining** (self-invocation) to continue processing beyond the 400s timeout limit.

## How It Works

When a function has more work to do and `chain_depth > 0`, it will automatically call itself to continue processing. Each invocation stays under the timeout limit, but together they can process unlimited items.

### Example Flow

1. **First invocation**: Processes 20 listings, finds 100 total
2. **Self-invokes**: Calls itself with `chain_depth: 4` (decremented from 5)
3. **Second invocation**: Processes next 20 listings
4. **Continues**: Until `chain_depth` reaches 0 or all work is complete

## Usage

### Basic Usage (No Chaining)

```javascript
// Single run, processes what it can within timeout
await supabase.functions.invoke('scrape-all-craigslist-squarebodies', {
  body: {
    max_regions: 30,
    max_listings_per_search: 50
  }
})
```

### With Function Chaining

```javascript
// Process all regions/listings across multiple invocations
await supabase.functions.invoke('scrape-all-craigslist-squarebodies', {
  body: {
    max_regions: 30,
    max_listings_per_search: 50,
    chain_depth: 10  // Will self-invoke up to 10 times
  }
})
```

### Parameters

**`scrape-all-craigslist-squarebodies`:**
- `chain_depth` (default: 0): Number of remaining self-invocations
- `regions_processed` (default: []): Track processed regions
- `skip_regions` (default: []): Regions to skip

**`discover-cl-squarebodies`:**
- `chain_depth` (default: 0): Number of remaining self-invocations
- `regions_processed` (default: []): Track processed regions
- `skip_regions` (default: []): Regions to skip

## Benefits

✅ **No timeout issues**: Each invocation stays under 400s  
✅ **Unlimited processing**: Can process all regions/listings  
✅ **Automatic continuation**: No manual intervention needed  
✅ **Cost effective**: Fewer function calls than manual batching  

## Recommended Chain Depth

- **Small batches** (10-20 regions): `chain_depth: 3-5`
- **Medium batches** (30-50 regions): `chain_depth: 5-10`
- **Large batches** (all regions): `chain_depth: 10-20`

## Monitoring

Check function logs to see:
- `🔄 Self-invoking to continue processing...` - Chaining is working
- `chain_depth: X` - Remaining invocations
- `remaining: Y listings/regions` - Work remaining

## Next Steps

1. **Request custom timeout limits** from Supabase support (see `CUSTOM_TIMEOUT_REQUEST.md`)
2. **Test with chain_depth** to find optimal batch sizes
3. **Monitor costs** - function chaining uses more invocations but processes more data

