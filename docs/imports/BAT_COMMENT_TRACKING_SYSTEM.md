# BaT Comment Tracking System

## Overview
Complete system for extracting, storing, and tracking comments from Bring a Trailer listings. This enables building vehicle personal history from auction comments and tracking BaT users for future matching.

## Database Schema

### `bat_users`
Tracks BaT usernames for future matching with N-Zero users.
- `bat_username` (unique) - BaT username
- `bat_profile_url` - Link to BaT profile
- `n_zero_user_id` - Link when BaT user creates N-Zero account
- `total_comments` - Activity tracking
- `first_seen_at` / `last_seen_at` - Activity timestamps

### `bat_listings`
Stores complete BaT listing data with auction details.
- `bat_listing_url` (unique) - Listing URL
- `bat_lot_number` - BaT lot number
- `auction_start_date` / `auction_end_date` - Auction date range
- `sale_price` / `reserve_price` / `starting_bid` - Pricing data
- `seller_bat_user_id` / `buyer_bat_user_id` - Links to bat_users
- `comment_count` / `bid_count` / `view_count` - Activity metrics
- `raw_data` (JSONB) - Full scraped data

### `bat_comments`
Individual comments from BaT listings.
- `bat_listing_id` - Link to listing
- `vehicle_id` - Link to vehicle (if matched)
- `bat_user_id` - Link to commenter
- `comment_text` - Comment content
- `comment_timestamp` - When comment was posted
- `is_seller_comment` - Flag for seller comments
- `sentiment_score` - Analysis field (future)
- `contains_technical_info` - Analysis flag (future)

### `vehicle_bat_comment_timeline` (View)
View that presents BaT comments as timeline events for vehicles, enabling integration with vehicle timeline system.

## Functions

### `get_or_create_bat_user(username, profile_url, display_name)`
Helper function to get or create a BaT user record. Returns UUID.

### Triggers
- `update_bat_user_stats` - Updates user activity stats when comments are added
- `update_bat_listing_comment_count` - Updates listing comment count

## Usage

### 1. Scrape BaT Listings
```bash
node scripts/scrape-viva-bat-listings.js
```
This scrapes all listings from Viva Las Vegas Autos BaT profile and saves to `viva-bat-listings.json`.

### 2. Import to Database
```bash
node scripts/import-bat-comments-to-db.js
```
This imports the scraped data into the database, creating:
- `bat_users` records for all commenters
- `bat_listings` records for each listing
- `bat_comments` records for each comment

### 3. Query Vehicle History
```sql
-- Get all BaT comments for a vehicle
SELECT * FROM vehicle_bat_comment_timeline 
WHERE vehicle_id = '...'
ORDER BY event_date DESC;

-- Find BaT users who commented on multiple vehicles
SELECT bu.bat_username, COUNT(DISTINCT bc.vehicle_id) as vehicle_count
FROM bat_users bu
JOIN bat_comments bc ON bu.id = bc.bat_user_id
WHERE bc.vehicle_id IS NOT NULL
GROUP BY bu.id, bu.bat_username
HAVING COUNT(DISTINCT bc.vehicle_id) > 1
ORDER BY vehicle_count DESC;
```

## Data Flow

1. **Scraping** → `scrape-viva-bat-listings.js`
   - Loads BaT profile page
   - Clicks "Show more" to load all listings
   - Scrapes each listing for:
     - Auction dates (start/end)
     - Sale price and participants
     - All comments with usernames and timestamps

2. **Import** → `import-bat-comments-to-db.js`
   - Reads scraped JSON
   - Creates/updates `bat_users`
   - Creates/updates `bat_listings`
   - Creates `bat_comments` records
   - Links to vehicles if matched

3. **Timeline Integration** → `vehicle_bat_comment_timeline` view
   - BaT comments appear as timeline events
   - Can be merged with other timeline sources
   - Enables building complete vehicle history

## Future Enhancements

1. **User Matching** - When BaT users create N-Zero accounts, match them automatically
2. **Sentiment Analysis** - Analyze comment sentiment for market insights
3. **Technical Info Extraction** - Identify comments with technical details
4. **Bid Detection** - Detect when comments contain bid information
5. **Question Detection** - Identify questions for Q&A features
6. **Comment Threading** - Track reply relationships
7. **Real-time Updates** - Monitor active listings for new comments

## Integration Points

- **Vehicle Timeline** - Comments appear in vehicle history
- **User Profiles** - BaT users can be matched to N-Zero users
- **Market Intelligence** - Comments provide insights into vehicle condition, history, market sentiment
- **Provenance** - Comments serve as additional data sources for vehicle information

