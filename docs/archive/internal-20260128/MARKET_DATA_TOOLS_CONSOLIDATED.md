# Market Data Tools - Consolidated

## Overview

The Market Data Tools integrate with existing functionality to populate profiles and extract market data. Most extraction and claiming functionality already exists - these tools provide a unified interface.

## Existing Functionality Used

### 1. BaT Profile Extraction
- **Existing Function**: `comprehensive-bat-extraction` Edge Function
- **What it does**: Extracts comprehensive BaT listing data including seller/buyer info
- **How we use it**: The BaT Profile Extractor checks `external_identities` table first, which is populated by the comprehensive extraction function

### 2. External Identity Claiming
- **Existing Page**: `/claim-identity` (`ClaimExternalIdentity.tsx`)
- **What it does**: Full workflow for claiming BaT usernames and other identities with proof
- **How we use it**: Market Data Tools links to this existing page instead of duplicating

### 3. Organization Service Extraction
- **Existing Functions**: 
  - `extract-using-catalog` - Uses cataloged schemas for extraction
  - `catalog-dealer-site-structure` - Catalogs site structure for extraction
- **What they do**: Extract services and other data from organization websites
- **How we use it**: Service Mapper uses `extract-using-catalog` with AI fallback

### 4. Profile Stats Backfilling
- **New Functions**: `backfill_user_profile_stats()` and `backfill_organization_profile_stats()`
- **What they do**: Calculate and populate profile stats from existing BaT data
- **Edge Function**: `backfill-profile-stats` for batch processing

## Tools

### 1. BaT Profile Extractor
**Location**: `/admin/market-data-tools` (BaT Profile Extractor tab)

**Purpose**: View and save BaT profile data that's already been extracted.

**How it works**:
1. Checks `external_identities` table for existing data
2. If found, displays it for review
3. Allows saving/updating metadata
4. If not found, suggests using `comprehensive-bat-extraction` function

### 2. Organization Service Mapper
**Location**: `/admin/market-data-tools` (Service Mapper tab)

**Purpose**: Extract and map services from organization websites.

**How it works**:
1. Uses existing `extract-using-catalog` function
2. Extracts `services_offered` field from website
3. Maps service names to categories
4. Allows manual editing before saving

### 3. External Identity Claiming
**Location**: `/admin/market-data-tools` (Claim Identity tab)

**Purpose**: Link to existing claim workflow.

**How it works**:
- Redirects to `/claim-identity` page which has full claim workflow

### 4. Backfill Profile Stats
**Location**: `/admin/market-data-tools` (Backfill Stats tab)

**Purpose**: Populate profile statistics from existing BaT data.

**How it works**:
1. Calls `backfill-profile-stats` Edge Function
2. Processes users/organizations in batches
3. Updates `total_listings`, `total_bids`, `total_comments`, etc.

## Usage

### To Extract BaT Profile Data:
1. Use `comprehensive-bat-extraction` function on BaT listings (this auto-creates `external_identities`)
2. Or use BaT Profile Extractor tool to view existing data

### To Claim an Identity:
1. Go to `/claim-identity` or use the link in Market Data Tools
2. Submit claim with proof
3. Wait for approval
4. Profile stats auto-update when claimed

### To Extract Organization Services:
1. Use Service Mapper tool
2. Enter organization website URL
3. Click "Extract Services from Website"
4. Review and edit services
5. Save to database

### To Backfill Stats:
1. Go to Backfill Stats tab
2. Click "Backfill All Users" or "Backfill All Organizations"
3. Wait for processing
4. Review results

## Integration Points

- **BaT Extraction**: `comprehensive-bat-extraction` → `bat_users` → `external_identities`
- **Identity Claiming**: `/claim-identity` → `external_identity_claims` → approval → `external_identities.claimed_by_user_id`
- **Service Extraction**: `extract-using-catalog` → `organization_services`
- **Stats Backfilling**: `backfill-profile-stats` → `profiles.total_*` / `businesses.total_*`

