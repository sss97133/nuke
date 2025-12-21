# Market Data Tools

Tools to populate profiles with data and extract market information from external sources.

## Overview

The Market Data Tools system provides a comprehensive set of utilities to:
1. Extract data from BaT member profiles
2. Map services from organization websites
3. Claim external identities (BaT usernames, etc.)
4. Backfill profile statistics from existing data

## Tools

### 1. BaT Profile Extractor

**Location:** `/admin/market-data-tools` (BaT Profile Extractor tab)

**Purpose:** Extract data from Bring a Trailer member profiles for market analysis and profile population.

**Features:**
- Extract profile data from BaT URLs
- Save extracted data to `external_identities` table
- Automatically update profile stats when identity is claimed

**Usage:**
1. Enter a BaT profile URL (e.g., `https://bringatrailer.com/member/wob/`)
2. Click "Extract Profile Data"
3. Review extracted data (listings, bids, comments, etc.)
4. Click "Save to Database" to store the data

### 2. Organization Service Mapper

**Location:** `/admin/market-data-tools` (Service Mapper tab)

**Purpose:** Map and extract services from organization websites.

**Features:**
- Extract services from organization websites
- Manual service entry
- Service categorization
- Pricing information capture

**Usage:**
1. Enter organization website URL
2. Click "Extract Services from Website" (requires Edge Function)
3. Or manually add services
4. Review and edit services
5. Save to database

### 3. External Identity Claimer

**Location:** `/admin/market-data-tools` (Claim Identity tab)

**Purpose:** Help users claim their BaT usernames and other external identities.

**Features:**
- Search for external identities by username
- Claim identities to link activity across platforms
- Automatic profile stats update on claim

**Usage:**
1. Search for a username or display name
2. Review found identities
3. Click "Claim" to link identity to your account
4. Profile stats automatically update

### 4. Backfill Profile Stats

**Location:** `/admin/market-data-tools` (Backfill Stats tab)

**Purpose:** Populate profile statistics from existing BaT data.

**Features:**
- Backfill all user profiles
- Backfill all organization profiles
- Batch processing with progress tracking

**Usage:**
1. Click "Backfill All Users" or "Backfill All Organizations"
2. Wait for processing to complete
3. Review results

## Database Functions

### `backfill_user_profile_stats(p_user_id UUID)`

Backfills profile stats for a single user from existing BaT data.

**Calculates:**
- Total listings (from `bat_listings` where user is seller)
- Total bids (from `auction_bids` and `bat_listings` where user is buyer)
- Total comments (from `bat_comments` and `auction_comments`)
- Total auction wins (from `bat_listings` where user is buyer and status is 'sold')
- Total success stories
- Member since date (earliest activity)

### `backfill_organization_profile_stats(p_org_id UUID)`

Backfills profile stats for a single organization from existing BaT data.

**Calculates:**
- Total listings (from `bat_listings` and `auction_events`)
- Total bids (from organization members' bids)
- Total comments (from organization members' comments)
- Total auction wins
- Total success stories
- Member since date (earliest activity)

## Edge Functions

### `backfill-profile-stats`

**Endpoint:** `/functions/v1/backfill-profile-stats`

**Request Body:**
```json
{
  "type": "user" | "organization" | "all_users" | "all_organizations",
  "id": "uuid" (required if type is "user" or "organization"),
  "batch_size": 100 (optional, for "all_*" types)
}
```

**Response:**
```json
{
  "success": true,
  "processed": 100,
  "results": [...]
}
```

### `extract-bat-profile` (TODO: Create this function)

**Endpoint:** `/functions/v1/extract-bat-profile`

**Request Body:**
```json
{
  "profile_url": "https://bringatrailer.com/member/wob/",
  "username": "wob"
}
```

**Response:**
```json
{
  "username": "wob",
  "profile_url": "https://bringatrailer.com/member/wob/",
  "listings": 1959,
  "bids": 779,
  "comments": 25147,
  "success_stories": 7,
  "auction_wins": 31,
  "member_since": "July 2015",
  "location": "CA, United States",
  "website": "https://wobcars.com/"
}
```

### `extract-org-services` (TODO: Create this function)

**Endpoint:** `/functions/v1/extract-org-services`

**Request Body:**
```json
{
  "website_url": "https://example.com",
  "organization_id": "uuid"
}
```

**Response:**
```json
{
  "services": [
    {
      "service_name": "Consignment Management",
      "service_category": "consignment_management",
      "description": "...",
      "pricing_model": "percentage",
      "percentage_rate": 10
    }
  ]
}
```

## Next Steps

1. **Create Edge Functions:**
   - Implement `extract-bat-profile` to scrape BaT profile pages
   - Implement `extract-org-services` to extract services from organization websites

2. **Run Initial Backfill:**
   ```sql
   SELECT * FROM backfill_all_user_profile_stats();
   SELECT * FROM backfill_all_organization_profile_stats();
   ```

3. **Set Up Scheduled Backfills:**
   - Consider adding a cron job or scheduled Edge Function to periodically update stats

4. **Enhance Extraction:**
   - Add more platforms (Cars & Bids, eBay Motors, etc.)
   - Add more data points (pricing trends, market analysis, etc.)

