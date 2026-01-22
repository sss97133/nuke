# Database Schema Reference

## Core Tables

### vehicles (Main Profile Table)
```sql
id UUID PRIMARY KEY
user_id UUID REFERENCES auth.users
make TEXT NOT NULL
model TEXT NOT NULL
year INTEGER
vin TEXT UNIQUE

-- Provenance tracking (IMPORTANT - track WHERE data came from)
year_source TEXT
year_confidence INTEGER (0-100)
make_source TEXT
make_confidence INTEGER
model_source TEXT
model_confidence INTEGER
vin_source TEXT
vin_confidence INTEGER

-- Core fields
color TEXT
mileage INTEGER
mileage_source TEXT
mileage_confidence INTEGER
fuel_type TEXT
transmission TEXT
engine TEXT
engine_size TEXT
horsepower INTEGER
drivetrain TEXT
body_style TEXT

-- Pricing
msrp DECIMAL(10,2)
asking_price DECIMAL(10,2)
current_value DECIMAL(10,2)
price_confidence INTEGER
purchase_price DECIMAL(10,2)

-- Discovery/Source tracking
discovery_source TEXT      -- 'bat', 'carsandbids', 'craigslist', etc.
discovery_url TEXT         -- Original listing URL
platform_source TEXT
platform_url TEXT
bat_auction_url TEXT

-- Auction data (when applicable)
sale_price DECIMAL
high_bid DECIMAL
reserve_price DECIMAL
auction_start TIMESTAMP
auction_end TIMESTAMP

-- Completeness tracking (CRITICAL - added for extraction)
extraction_completeness FLOAT DEFAULT 0
extraction_missing_fields TEXT[] DEFAULT '{}'
extraction_method TEXT     -- 'nextjs', 'embedded_json', 'dom', etc.
raw_extraction_json JSONB  -- Store FULL extraction for debugging
```

### vehicle_images
```sql
id UUID PRIMARY KEY
vehicle_id UUID REFERENCES vehicles(id)
url TEXT NOT NULL           -- External URL (original source)
storage_path TEXT           -- Supabase storage path (after upload)
is_primary BOOLEAN DEFAULT FALSE
position INTEGER            -- Order in gallery
source TEXT                 -- Where image came from
created_at TIMESTAMP
```

### import_queue
```sql
id UUID PRIMARY KEY
listing_url TEXT NOT NULL
source_id UUID
status TEXT DEFAULT 'pending'  -- pending, processing, complete, failed, skipped
listing_make TEXT
listing_model TEXT
listing_year INTEGER
priority INTEGER DEFAULT 0
attempts INTEGER DEFAULT 0
error_message TEXT
locked_at TIMESTAMP
locked_by TEXT
processed_at TIMESTAMP
created_at TIMESTAMP
```

### bat_extraction_queue
```sql
id UUID PRIMARY KEY
vehicle_id UUID REFERENCES vehicles(id)
listing_url TEXT NOT NULL
status TEXT DEFAULT 'pending'
extraction_type TEXT        -- 'core', 'comments', 'full'
priority INTEGER DEFAULT 0
attempts INTEGER DEFAULT 0
error_message TEXT
```

### auction_comments (BaT/C&B community data)
```sql
id UUID PRIMARY KEY
vehicle_id UUID REFERENCES vehicles(id)
author TEXT
content TEXT
posted_at TIMESTAMP
is_seller_reply BOOLEAN
parent_comment_id UUID      -- For threaded replies
likes_count INTEGER
```

### auction_bids (Bid history)
```sql
id UUID PRIMARY KEY
vehicle_id UUID REFERENCES vehicles(id)
bidder_username TEXT
amount DECIMAL
bid_at TIMESTAMP
is_winning_bid BOOLEAN
```

## Key Indexes
- `idx_vehicles_vin` - VIN lookups
- `idx_vehicles_discovery_url` - Deduplication
- `idx_import_queue_status` - Queue processing
- `idx_vehicles_extraction_completeness` - Find incomplete profiles

## Important Notes

1. **Provenance is critical** - Every field should have `_source` and `_confidence`
2. **raw_extraction_json** - Always save the full extraction for debugging
3. **extraction_completeness** - Track how complete each profile is (0.0 to 1.0)
4. **extraction_missing_fields** - Array of fields we couldn't extract
