# Vehicle Observation Model

## Problem

The current schema is auction-centric:
- `auction_comments` - only from auctions
- `comment_discoveries` - only analyzes auction sentiment
- `bat_listings` - BaT-specific

But vehicles exist outside auctions 99% of their lives:
- Garage time / storage
- Shop visits / restoration work
- Shows / meets / drives
- Forum discussions / social media
- Registry appearances
- Private sales / dealer lots

## Solution: Source-Agnostic Observations

### Core Principle
**Every data point is an "observation" from a "source"**

Instead of `auction_comments`, we have `vehicle_observations` with:
- `source_type`: auction, forum, social_media, shop, registry, owner_input
- `observation_type`: comment, listing, sighting, work_record, ownership_transfer
- `source_id`: FK to the source registry
- `confidence`: how reliable is this source?

### Proposed Schema

```sql
-- Central observation table (replaces auction_comments, etc.)
CREATE TABLE vehicle_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),

    -- Source tracking
    source_id UUID REFERENCES data_source_registry(id),
    source_type TEXT NOT NULL, -- auction, forum, social_media, shop, registry, owner
    source_url TEXT,
    source_identifier TEXT, -- platform-specific ID

    -- Observation metadata
    observation_type TEXT NOT NULL, -- comment, listing, sighting, work_record, transfer
    observed_at TIMESTAMPTZ NOT NULL,
    observer_identity_id UUID REFERENCES external_identities(id),

    -- Content
    content_text TEXT,
    content_hash TEXT, -- for dedup
    structured_data JSONB, -- type-specific fields

    -- Quality signals
    confidence_score DECIMAL(3,2), -- 0.00-1.00
    is_verified BOOLEAN DEFAULT false,
    verification_method TEXT,

    -- Discovery tracking
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    discovery_metadata JSONB,

    UNIQUE(vehicle_id, source_type, content_hash)
);

-- Source-specific extractors (config, not code)
CREATE TABLE source_extractors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID REFERENCES data_source_registry(id),

    -- Extractor config
    extractor_type TEXT NOT NULL, -- edge_function, firecrawl, api, manual
    extractor_config JSONB, -- function name, selectors, API endpoints
    observation_types TEXT[], -- what types this extractor produces

    -- Scheduling
    is_active BOOLEAN DEFAULT true,
    schedule_cron TEXT, -- null = on-demand only
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,

    -- Rate limiting
    rate_limit_per_hour INTEGER,
    cooldown_on_error_minutes INTEGER DEFAULT 60
);

-- Unified discovery results (replaces comment_discoveries, description_discoveries)
CREATE TABLE observation_discoveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES vehicles(id),

    -- What was analyzed
    source_types TEXT[], -- which sources contributed
    observation_count INTEGER,
    date_range_start TIMESTAMPTZ,
    date_range_end TIMESTAMPTZ,

    -- Discovery results
    discovery_type TEXT NOT NULL, -- sentiment, fields, themes, market_signal
    raw_extraction JSONB,
    confidence_score DECIMAL(3,2),

    -- Tracking
    discovered_at TIMESTAMPTZ DEFAULT NOW(),
    model_used TEXT,
    prompt_version TEXT
);
```

### Adding a New Auction House

With this model, adding "XYZ Auctions" is config, not code:

```sql
-- 1. Register the source
INSERT INTO data_source_registry (source_name, source_type, source_url)
VALUES ('XYZ Auctions', 'auction', 'https://xyzauctions.com');

-- 2. Configure the extractor
INSERT INTO source_extractors (source_id, extractor_type, extractor_config, observation_types)
VALUES (
    (SELECT id FROM data_source_registry WHERE source_name = 'XYZ Auctions'),
    'edge_function',
    '{"function": "extract-xyz-listing", "comment_selector": ".comment-text"}',
    ARRAY['listing', 'comment', 'bid']
);
```

The extraction pipeline reads from `source_extractors` and routes to the appropriate function.

### Adding Non-Auction Sources

Same pattern works for forums, social media, shops:

```sql
-- Forum example
INSERT INTO data_source_registry (source_name, source_type, source_url)
VALUES ('Rennlist Forums', 'community_forum', 'https://rennlist.com');

INSERT INTO source_extractors (source_id, extractor_type, extractor_config)
VALUES (
    (SELECT id FROM data_source_registry WHERE source_name = 'Rennlist Forums'),
    'firecrawl',
    '{"url_pattern": "https://rennlist.com/forums/*/vin/*", "content_selector": ".post-body"}',
    ARRAY['comment', 'sighting']
);
```

### Migration Path

1. **Keep existing tables** - `auction_comments` etc. work fine
2. **Add `vehicle_observations`** as the new unified table
3. **Create views** that make old tables look like observations
4. **New extractors** write to observations
5. **Discovery agents** read from observations (source-agnostic)

### Discovery Agent Changes

Instead of `discover-comment-data` (BaT-specific), we have:

```typescript
// Generic observation analyzer
async function discoverFromObservations(vehicleId: string) {
    // Get ALL observations for this vehicle, regardless of source
    const observations = await supabase
        .from('vehicle_observations')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('observed_at', { ascending: false });

    // Group by type for analysis
    const comments = observations.filter(o => o.observation_type === 'comment');
    const listings = observations.filter(o => o.observation_type === 'listing');
    const sightings = observations.filter(o => o.observation_type === 'sighting');

    // Run unified discovery (sentiment works on any text)
    const sentiment = await analyzeSentiment(comments);
    const timeline = await buildTimeline(listings, sightings);

    // Store results
    await supabase.from('observation_discoveries').insert({
        vehicle_id: vehicleId,
        source_types: [...new Set(observations.map(o => o.source_type))],
        observation_count: observations.length,
        discovery_type: 'unified_analysis',
        raw_extraction: { sentiment, timeline }
    });
}
```

## Benefits

1. **New sources = config, not code** - Add auction houses via database rows
2. **Unified discovery** - Same AI analyzes forum posts and auction comments
3. **Provenance tracking** - Know where every data point came from
4. **Confidence scoring** - Weight observations by source reliability
5. **Deduplication** - content_hash prevents duplicate observations
6. **Timeline reconstruction** - observations from all sources build complete history

## Open Questions

- How to handle conflicting observations? (two sources say different things)
- Confidence scoring formula? (source trust × recency × verification)
- Rate limiting across sources? (don't hammer any single source)
- Backfill strategy? (migrate existing auction_comments to observations)
