# Backend Features Implementation

## Status: DATABASE MIGRATION CREATED ✅

All backend features have been designed and the database migration is ready to apply.

## What Was Created

### 1. Database Migration
**File**: `database/migrations/20251019_add_backend_features.sql`

This migration adds 5 new tables and enhances existing ones:

#### Image Metrics Tracking
- **Enhanced `vehicle_images`**: Added columns for view_count, engagement_score, technical_value, tag_count
- **New `image_views` table**: Tracks individual view events with duration and device type
- **New `image_interactions` table**: Stores likes, comments, shares on images

#### Betting/Speculation System  
- **New `vehicle_bets` table**: Stores user predictions and market speculation
  - Bet types: value_milestone, completion_date, next_mod_value, auction_price
  - Tracks confidence percent, stake amount, resolution status
- **View `vehicle_market_sentiment`**: Aggregates betting data per vehicle

#### Auction Voting Mechanism
- **New `auction_votes` table**: Community voting to send vehicles to auction
  - One vote per user per vehicle
  - Tracks yes/no vote, reason, estimated value
- **View `auction_vote_summary`**: Aggregates vote counts and percentages

#### Spec Research Cache
- **New `spec_research_cache` table**: Caches AI-generated spec research
  - 30-day expiration
  - Stores research data, sources, confidence scores
  - Reduces redundant AI API calls

### 2. Database Functions
- `increment_image_view_count(uuid)`: Increments view count on image
- `calculate_engagement_score(uuid)`: Calculates and updates engagement score

### 3. RLS Policies
All tables have Row Level Security enabled with appropriate policies:
- Image views: Anyone can log, users see their own
- Image interactions: Users can create, anyone can view
- Vehicle bets: Users can create, anyone can view
- Auction votes: Users can vote, anyone can view results
- Spec research: Read-only for all, service role can manage

## How to Apply

### Option 1: Supabase Dashboard (RECOMMENDED)
1. Go to https://supabase.com/dashboard/project/qkgaybvrernstplzjaam
2. Click "SQL Editor" in left sidebar
3. Click "New Query"
4. Copy contents of `database/migrations/20251019_add_backend_features.sql`
5. Paste and click "Run"

### Option 2: Command Line (if connection works)
```bash
cd /Users/skylar/nuke
supabase db push --include-all
```

## Next Steps After Migration

### 1. Image Metrics Integration
Update frontend to track views:
```typescript
// When image is viewed
await supabase.rpc('increment_image_view_count', { image_uuid: imageId });
await supabase.from('image_views').insert({
  image_id: imageId,
  user_id: session?.user?.id,
  view_duration_seconds: viewDuration,
  device_type: isMobile ? 'mobile' : 'desktop'
});
```

### 2. Betting System Integration  
Update PriceCarousel.tsx Bets screen:
```typescript
// Create a bet
await supabase.from('vehicle_bets').insert({
  vehicle_id: vehicleId,
  user_id: session.user.id,
  bet_type: 'value_milestone',
  prediction: { target_value: 50000, by_date: '2025-12-31' },
  confidence_percent: 75
});

// Load market sentiment
const { data } = await supabase
  .from('vehicle_market_sentiment')
  .select('*')
  .eq('vehicle_id', vehicleId);
```

### 3. Auction Voting Integration
Update PriceCarousel.tsx Auction screen:
```typescript
// Cast vote
await supabase.from('auction_votes').upsert({
  vehicle_id: vehicleId,
  user_id: session.user.id,
  vote: 'yes',
  reason: 'Ready for auction',
  estimated_value: 45000
});

// Load vote summary
const { data } = await supabase
  .from('auction_vote_summary')
  .select('*')
  .eq('vehicle_id', vehicleId)
  .single();
```

### 4. Spec Research Integration
Update SpecResearchModal.tsx:
```typescript
// Check cache first
const { data: cached } = await supabase
  .from('spec_research_cache')
  .select('*')
  .eq('vehicle_id', vehicleId)
  .eq('spec_name', 'engine')
  .single();

if (cached && cached.expires_at > new Date().toISOString()) {
  // Use cached data
  setResearch(cached.research_data);
} else {
  // Call AI and cache result
  const research = await performAIResearch(vehicle, spec);
  await supabase.from('spec_research_cache').upsert({
    vehicle_id: vehicleId,
    spec_name: spec.name,
    spec_value: spec.value,
    research_data: research,
    sources: research.sources,
    confidence_score: research.confidence
  });
}
```

## Database Schema Added

### Tables
1. **image_views** - Individual view tracking
2. **image_interactions** - Likes, comments, shares
3. **vehicle_bets** - Market predictions
4. **auction_votes** - Community auction voting
5. **spec_research_cache** - AI research cache

### Views
1. **vehicle_market_sentiment** - Aggregated betting data
2. **auction_vote_summary** - Aggregated voting results

### Functions
1. **increment_image_view_count()** - Update view count
2. **calculate_engagement_score()** - Calculate engagement metric

## Testing After Migration

```sql
-- Verify tables exist
SELECT tablename FROM pg_tables WHERE schemaname = 'public' 
  AND tablename IN ('image_views', 'image_interactions', 'vehicle_bets', 'auction_votes', 'spec_research_cache');

-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' 
  AND tablename IN ('image_views', 'image_interactions', 'vehicle_bets', 'auction_votes', 'spec_research_cache');

-- Test view count function
SELECT increment_image_view_count('<some_image_id>');
SELECT view_count FROM vehicle_images WHERE id = '<some_image_id>';
```

## Status

✅ Database schema designed
✅ Migration file created
✅ RLS policies defined
✅ Functions created
⏳ Migration needs to be applied via Supabase Dashboard
❌ Frontend integration pending (after migration applied)
❌ AI guardrails implementation pending
❌ External source indexing pending

Once migration is applied, frontend components can be updated to use these new tables and functions.

