# Instagram Content Ingestion - Implementation Status

## ✅ What's Complete

### Database Schema
- ✅ `user_content` table created
- ✅ `content_vehicle_links` table created
- ✅ Auto-timeline event trigger (creates events when content linked)
- ✅ Views for analytics (`vehicle_content_summary`, `user_content_stats`)
- ✅ RLS policies configured

### Documentation
- ✅ Strategy documents
- ✅ Instagram-specific ingestion guide
- ✅ Content-to-vehicle flow documentation

## ❌ What Still Needs to Be Built

### 1. Instagram Sync Edge Functions

#### `sync-instagram-organization` (Historical + Ongoing)
**Purpose**: Fetch Instagram posts for an organization

**What it does**:
- Fetches posts from Instagram Graph API
- Creates `user_content` records
- Downloads images to Supabase Storage
- Queues for vehicle detection

**Status**: ❌ Not built yet

**Required**:
- Instagram Graph API credentials
- Organization's Instagram Business Account ID
- Access token management

#### `detect-vehicles-in-content` (Vehicle Detection)
**Purpose**: Analyze content images and link to vehicles

**What it does**:
- Analyzes images with GPT-4 Vision
- Extracts vehicle information
- Matches to vehicles in database
- Creates `content_vehicle_links` with confidence scores

**Status**: ❌ Not built yet

**Can reuse**:
- Existing `analyze-image` function pattern
- Existing VIN detection logic
- Existing license plate OCR

#### `process-instagram-webhook` (Real-time)
**Purpose**: Handle new Instagram posts in real-time

**What it does**:
- Receives webhook notifications from Instagram
- Triggers immediate ingestion for new posts
- Processes vehicle detection

**Status**: ❌ Not built yet

**Required**:
- Webhook subscription setup
- Webhook verification
- Security/authentication

### 2. Historical Sync Function

#### `backfill-instagram-content` (One-time)
**Purpose**: Sync all historical Instagram posts

**What it does**:
- Fetches all posts from organization's Instagram account
- Processes each post through ingestion pipeline
- Handles pagination (Instagram API limits)
- Respects rate limits

**Status**: ❌ Not built yet

**Usage**:
```typescript
// One-time call to sync all historical posts
await supabase.functions.invoke('backfill-instagram-content', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_account_id: 'lartdelautomobile',
    limit: 100 // or null for all
  }
});
```

### 3. Frontend Components

#### `VehicleContentSection.tsx`
**Status**: ❌ Not built yet

#### `OrganizationContentDashboard.tsx`
**Status**: ❌ Not built yet

#### `ContentLinkingInterface.tsx` (Review Queue)
**Status**: ❌ Not built yet

## How It Will Work (Once Built)

### For Historical Posts (Old Posts)

1. **Run backfill function**:
   ```typescript
   // One-time sync
   await supabase.functions.invoke('backfill-instagram-content', {
     body: {
       organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
       instagram_handle: 'lartdelautomobile'
     }
   });
   ```

2. **Function fetches all posts**:
   - Uses Instagram Graph API pagination
   - Fetches posts in batches (respects rate limits)
   - Processes each post

3. **For each post**:
   - Downloads images
   - Creates `user_content` record
   - Analyzes images for vehicles
   - Creates `content_vehicle_links` if vehicles detected
   - Auto-creates timeline events (via trigger)

4. **Result**:
   - All historical posts ingested
   - Vehicles automatically linked
   - Timeline events created
   - Vehicle profiles enriched

### For New Posts (Future Posts)

1. **Webhook subscription**:
   - Organization connects Instagram account
   - Webhook subscribed to Instagram Graph API
   - New posts trigger webhook

2. **Real-time processing**:
   - Webhook receives notification
   - `process-instagram-webhook` function triggered
   - Post ingested immediately
   - Vehicle detection runs
   - Timeline event created

3. **Result**:
   - New posts automatically processed
   - Vehicles linked in real-time
   - No manual work needed

## Implementation Checklist

### Phase 1: Core Ingestion (Week 1)
- [ ] Create `sync-instagram-organization` Edge Function
- [ ] Create `detect-vehicles-in-content` Edge Function
- [ ] Set up Instagram Graph API credentials
- [ ] Test with single organization (L'Art de l'Automobile)

### Phase 2: Historical Sync (Week 1-2)
- [ ] Create `backfill-instagram-content` Edge Function
- [ ] Handle pagination and rate limits
- [ ] Run backfill for pilot organization
- [ ] Verify vehicle detection accuracy

### Phase 3: Real-time (Week 2)
- [ ] Create `process-instagram-webhook` Edge Function
- [ ] Set up webhook subscription
- [ ] Test webhook with new posts
- [ ] Handle webhook security/verification

### Phase 4: Frontend (Week 3)
- [ ] Build `VehicleContentSection` component
- [ ] Build `OrganizationContentDashboard` component
- [ ] Build `ContentLinkingInterface` (review queue)
- [ ] Integrate into vehicle and organization profiles

### Phase 5: Polish (Week 4)
- [ ] Error handling
- [ ] Loading states
- [ ] Mobile optimization
- [ ] Analytics dashboard

## Current Status Summary

**Database**: ✅ Ready
- Schema created
- Triggers configured
- Views available

**Backend Functions**: ❌ Not built yet
- Need to create Edge Functions
- Need Instagram API setup
- Need vehicle detection pipeline

**Frontend**: ❌ Not built yet
- Need UI components
- Need integration into profiles

## Next Steps

1. **Build `sync-instagram-organization` function**
   - Start with basic post fetching
   - Create `user_content` records
   - Download images

2. **Build `detect-vehicles-in-content` function**
   - Reuse existing `analyze-image` logic
   - Implement matching algorithm
   - Create `content_vehicle_links`

3. **Test with L'Art de l'Automobile**
   - Connect their Instagram account
   - Run historical sync
   - Verify vehicle detection

4. **Build frontend components**
   - Display content on vehicle profiles
   - Show analytics on organization profiles
   - Review queue interface

## Answer: Will It Work on Old and New Posts?

**Short answer**: Yes, once the Edge Functions are built.

**Current state**:
- ✅ Database is ready to store content
- ✅ Auto-timeline creation will work
- ❌ But ingestion functions don't exist yet

**Once built**:
- ✅ Historical posts: Run `backfill-instagram-content` once
- ✅ New posts: Webhook automatically processes them
- ✅ Both will create timeline events automatically
- ✅ Both will link to vehicles automatically

**Timeline**:
- Database: ✅ Done
- Backend functions: ~2-3 weeks to build
- Frontend: ~1 week to build
- **Total: ~3-4 weeks to full implementation**

