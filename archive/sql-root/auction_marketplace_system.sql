-- Auction and Marketplace System
-- Vehicle and parts marketplace with auction functionality

-- Create auction status enum
DO $$ BEGIN
    CREATE TYPE auction_status AS ENUM ('draft', 'scheduled', 'active', 'ended', 'cancelled', 'sold');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create listing type enum
DO $$ BEGIN
    CREATE TYPE listing_type AS ENUM ('auction', 'buy_now', 'make_offer');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create bid status enum
DO $$ BEGIN
    CREATE TYPE bid_status AS ENUM ('active', 'outbid', 'winning', 'won', 'lost');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Auction listings table
CREATE TABLE IF NOT EXISTS auction_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,

    -- Listing details
    title TEXT NOT NULL,
    description TEXT,
    listing_type listing_type NOT NULL DEFAULT 'auction',
    status auction_status NOT NULL DEFAULT 'draft',

    -- Pricing
    starting_bid DECIMAL(12,2) DEFAULT 0,
    reserve_price DECIMAL(12,2), -- minimum acceptable price
    buy_now_price DECIMAL(12,2), -- instant purchase price
    current_bid DECIMAL(12,2) DEFAULT 0,
    bid_increment DECIMAL(8,2) DEFAULT 100, -- minimum bid increment

    -- Timing
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    auto_extend_minutes INTEGER DEFAULT 10, -- extend auction if bid in final minutes

    -- Bidding rules
    min_bidder_rating DECIMAL(3,2) DEFAULT 0,
    require_payment_verification BOOLEAN DEFAULT false,
    allow_proxy_bidding BOOLEAN DEFAULT true,
    max_proxy_bid DECIMAL(12,2),

    -- Images and media
    images TEXT[] DEFAULT '{}',
    video_urls TEXT[] DEFAULT '{}',
    document_urls TEXT[] DEFAULT '{}', -- inspection reports, etc.

    -- Shipping and location
    location_lat DECIMAL(10, 8),
    location_lng DECIMAL(11, 8),
    location_city TEXT,
    location_state TEXT,
    location_zip TEXT,
    shipping_available BOOLEAN DEFAULT false,
    pickup_required BOOLEAN DEFAULT true,
    shipping_cost DECIMAL(10,2),

    -- Seller information
    seller_notes TEXT,
    inspection_available BOOLEAN DEFAULT false,
    inspection_location TEXT,

    -- Fees and commissions
    seller_fee_percent DECIMAL(5,4) DEFAULT 0.05, -- 5% default
    buyer_premium_percent DECIMAL(5,4) DEFAULT 0.10, -- 10% default

    -- Engagement stats
    view_count INTEGER DEFAULT 0,
    watcher_count INTEGER DEFAULT 0,
    question_count INTEGER DEFAULT 0,

    -- Tags and categories
    tags TEXT[] DEFAULT '{}',
    featured BOOLEAN DEFAULT false,
    featured_until TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auction bids table
CREATE TABLE IF NOT EXISTS auction_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
    bidder_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Bid details
    bid_amount DECIMAL(12,2) NOT NULL,
    bid_type TEXT DEFAULT 'regular', -- regular, proxy, buy_now
    status bid_status NOT NULL DEFAULT 'active',

    -- Proxy bidding
    max_bid_amount DECIMAL(12,2), -- for proxy bidding
    is_proxy_bid BOOLEAN DEFAULT false,
    proxy_increment DECIMAL(8,2),

    -- Bid timing
    bid_time TIMESTAMPTZ DEFAULT NOW(),
    time_remaining_seconds INTEGER, -- auction time remaining when bid placed

    -- Verification
    bidder_verified BOOLEAN DEFAULT false,
    payment_method_verified BOOLEAN DEFAULT false,

    -- Bid metadata
    bidder_ip INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auction watchers - users watching listings
CREATE TABLE IF NOT EXISTS auction_watchers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
    watcher_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Watch preferences
    notify_on_outbid BOOLEAN DEFAULT true,
    notify_on_ending_soon BOOLEAN DEFAULT true,
    notify_on_price_drop BOOLEAN DEFAULT true,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(listing_id, watcher_id)
);

-- Auction questions and answers
CREATE TABLE IF NOT EXISTS auction_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
    questioner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Question details
    question TEXT NOT NULL,
    is_public BOOLEAN DEFAULT true,
    answered BOOLEAN DEFAULT false,

    -- Answer
    answer TEXT,
    answered_by UUID REFERENCES auth.users(id),
    answered_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction records for completed sales
CREATE TABLE IF NOT EXISTS auction_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES auth.users(id),
    buyer_id UUID NOT NULL REFERENCES auth.users(id),
    winning_bid_id UUID REFERENCES auction_bids(id),

    -- Transaction details
    sale_price DECIMAL(12,2) NOT NULL,
    seller_fee DECIMAL(12,2) DEFAULT 0,
    buyer_premium DECIMAL(12,2) DEFAULT 0,
    total_buyer_cost DECIMAL(12,2) NOT NULL,
    net_seller_proceeds DECIMAL(12,2) NOT NULL,

    -- Payment tracking
    payment_due_date TIMESTAMPTZ,
    payment_received_date TIMESTAMPTZ,
    payment_method TEXT,
    payment_reference TEXT,

    -- Delivery tracking
    pickup_scheduled_date TIMESTAMPTZ,
    pickup_completed_date TIMESTAMPTZ,
    shipping_tracking_number TEXT,
    delivery_completed_date TIMESTAMPTZ,

    -- Transaction status
    transaction_status TEXT DEFAULT 'pending', -- pending, paid, shipped, completed, disputed
    dispute_reason TEXT,
    dispute_resolved_date TIMESTAMPTZ,

    -- Feedback
    seller_rating INTEGER, -- 1-5 stars
    buyer_rating INTEGER, -- 1-5 stars
    seller_feedback TEXT,
    buyer_feedback TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Make offers table for make_offer listings
CREATE TABLE IF NOT EXISTS listing_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES auction_listings(id) ON DELETE CASCADE,
    buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Offer details
    offer_amount DECIMAL(12,2) NOT NULL,
    offer_message TEXT,
    expires_at TIMESTAMPTZ,

    -- Offer status
    status TEXT DEFAULT 'pending', -- pending, accepted, rejected, withdrawn, expired
    seller_response TEXT,
    responded_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Functions for auction management

-- Function to place a bid
CREATE OR REPLACE FUNCTION place_bid(
    listing_id_param UUID,
    bidder_id_param UUID,
    bid_amount_param DECIMAL(12,2),
    max_bid_amount_param DECIMAL(12,2) DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    bid_id UUID;
    current_high_bid DECIMAL(12,2);
    min_next_bid DECIMAL(12,2);
    listing_status auction_status;
    auction_end_time TIMESTAMPTZ;
BEGIN
    -- Get current listing status and high bid
    SELECT status, current_bid, end_time INTO listing_status, current_high_bid, auction_end_time
    FROM auction_listings WHERE id = listing_id_param;

    IF listing_status != 'active' THEN
        RAISE EXCEPTION 'Auction is not active';
    END IF;

    IF auction_end_time <= NOW() THEN
        RAISE EXCEPTION 'Auction has ended';
    END IF;

    -- Calculate minimum next bid
    SELECT current_bid + bid_increment INTO min_next_bid
    FROM auction_listings WHERE id = listing_id_param;

    IF bid_amount_param < min_next_bid THEN
        RAISE EXCEPTION 'Bid amount too low. Minimum bid: %', min_next_bid;
    END IF;

    -- Mark previous bids as outbid
    UPDATE auction_bids
    SET status = 'outbid'
    WHERE listing_id = listing_id_param AND status = 'active';

    -- Insert new bid
    INSERT INTO auction_bids (
        listing_id,
        bidder_id,
        bid_amount,
        max_bid_amount,
        is_proxy_bid,
        status,
        time_remaining_seconds
    )
    VALUES (
        listing_id_param,
        bidder_id_param,
        bid_amount_param,
        max_bid_amount_param,
        max_bid_amount_param IS NOT NULL,
        'active',
        EXTRACT(EPOCH FROM (auction_end_time - NOW()))::INTEGER
    )
    RETURNING id INTO bid_id;

    -- Update listing current bid
    UPDATE auction_listings
    SET
        current_bid = bid_amount_param,
        updated_at = NOW()
    WHERE id = listing_id_param;

    -- Auto-extend auction if bid placed in final minutes
    UPDATE auction_listings
    SET end_time = end_time + INTERVAL '10 minutes'
    WHERE id = listing_id_param
    AND end_time - NOW() < INTERVAL '10 minutes'
    AND auto_extend_minutes > 0;

    RETURN bid_id;
END;
$$ LANGUAGE plpgsql;

-- Function to end auction
CREATE OR REPLACE FUNCTION end_auction(
    listing_id_param UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    winning_bid_id UUID;
    winning_bidder UUID;
    final_price DECIMAL(12,2);
    reserve_met BOOLEAN;
BEGIN
    -- Get winning bid
    SELECT id, bidder_id, bid_amount
    INTO winning_bid_id, winning_bidder, final_price
    FROM auction_bids
    WHERE listing_id = listing_id_param
    AND status = 'active'
    ORDER BY bid_amount DESC, created_at ASC
    LIMIT 1;

    -- Check if reserve price was met
    SELECT (final_price >= COALESCE(reserve_price, 0)) INTO reserve_met
    FROM auction_listings
    WHERE id = listing_id_param;

    IF winning_bid_id IS NOT NULL AND reserve_met THEN
        -- Mark winning bid
        UPDATE auction_bids
        SET status = 'won'
        WHERE id = winning_bid_id;

        -- Mark other bids as lost
        UPDATE auction_bids
        SET status = 'lost'
        WHERE listing_id = listing_id_param AND id != winning_bid_id;

        -- Update listing status
        UPDATE auction_listings
        SET
            status = 'sold',
            updated_at = NOW()
        WHERE id = listing_id_param;

        -- Create transaction record
        INSERT INTO auction_transactions (
            listing_id,
            seller_id,
            buyer_id,
            winning_bid_id,
            sale_price,
            seller_fee,
            buyer_premium,
            total_buyer_cost,
            net_seller_proceeds,
            payment_due_date
        )
        SELECT
            al.id,
            al.seller_id,
            winning_bidder,
            winning_bid_id,
            final_price,
            final_price * al.seller_fee_percent,
            final_price * al.buyer_premium_percent,
            final_price + (final_price * al.buyer_premium_percent),
            final_price - (final_price * al.seller_fee_percent),
            NOW() + INTERVAL '7 days'
        FROM auction_listings al
        WHERE al.id = listing_id_param;

    ELSE
        -- No sale - reserve not met or no bids
        UPDATE auction_listings
        SET
            status = 'ended',
            updated_at = NOW()
        WHERE id = listing_id_param;

        UPDATE auction_bids
        SET status = 'lost'
        WHERE listing_id = listing_id_param;
    END IF;

    RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Function to get active auctions feed
CREATE OR REPLACE FUNCTION get_active_auctions(
    limit_count INTEGER DEFAULT 50,
    offset_count INTEGER DEFAULT 0,
    category_filter TEXT DEFAULT NULL,
    price_min DECIMAL(12,2) DEFAULT NULL,
    price_max DECIMAL(12,2) DEFAULT NULL,
    location_lat DECIMAL(10,8) DEFAULT NULL,
    location_lng DECIMAL(11,8) DEFAULT NULL,
    radius_miles INTEGER DEFAULT NULL
)
RETURNS TABLE(
    listing_id UUID,
    title TEXT,
    description TEXT,
    listing_type listing_type,
    current_bid DECIMAL(12,2),
    buy_now_price DECIMAL(12,2),
    time_remaining_seconds INTEGER,
    bid_count BIGINT,
    watcher_count BIGINT,
    images TEXT[],
    seller_name TEXT,
    location_city TEXT,
    location_state TEXT,
    featured BOOLEAN,
    distance_miles DOUBLE PRECISION
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        al.id as listing_id,
        al.title,
        al.description,
        al.listing_type,
        al.current_bid,
        al.buy_now_price,
        GREATEST(0, EXTRACT(EPOCH FROM (al.end_time - NOW()))::INTEGER) as time_remaining_seconds,
        COALESCE(bid_counts.bid_count, 0) as bid_count,
        COALESCE(watch_counts.watcher_count, 0) as watcher_count,
        al.images,
        up.display_name as seller_name,
        al.location_city,
        al.location_state,
        al.featured,
        CASE
            WHEN location_lat IS NOT NULL AND location_lng IS NOT NULL AND al.location_lat IS NOT NULL AND al.location_lng IS NOT NULL
            THEN (3959 * acos(cos(radians(location_lat)) * cos(radians(al.location_lat)) * cos(radians(al.location_lng) - radians(location_lng)) + sin(radians(location_lat)) * sin(radians(al.location_lat))))
            ELSE NULL
        END as distance_miles
    FROM auction_listings al
    JOIN user_profiles up ON al.seller_id = up.user_id
    LEFT JOIN (
        SELECT listing_id, COUNT(*) as bid_count
        FROM auction_bids
        GROUP BY listing_id
    ) bid_counts ON al.id = bid_counts.listing_id
    LEFT JOIN (
        SELECT listing_id, COUNT(*) as watcher_count
        FROM auction_watchers
        GROUP BY listing_id
    ) watch_counts ON al.id = watch_counts.listing_id
    WHERE al.status = 'active'
    AND (category_filter IS NULL OR category_filter = ANY(al.tags))
    AND (price_min IS NULL OR al.current_bid >= price_min)
    AND (price_max IS NULL OR al.current_bid <= price_max)
    AND (radius_miles IS NULL OR location_lat IS NULL OR (
        3959 * acos(cos(radians(location_lat)) * cos(radians(al.location_lat)) * cos(radians(al.location_lng) - radians(location_lng)) + sin(radians(location_lat)) * sin(radians(al.location_lat)))
    ) <= radius_miles)
    ORDER BY
        al.featured DESC,
        al.end_time ASC,
        al.created_at DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$ LANGUAGE plpgsql;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_auction_listings_status ON auction_listings(status);
CREATE INDEX IF NOT EXISTS idx_auction_listings_seller ON auction_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_auction_listings_end_time ON auction_listings(end_time) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_auction_listings_location ON auction_listings(location_lat, location_lng) WHERE location_lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auction_listings_tags ON auction_listings USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_auction_listings_price ON auction_listings(current_bid);

CREATE INDEX IF NOT EXISTS idx_auction_bids_listing ON auction_bids(listing_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_bidder ON auction_bids(bidder_id);
CREATE INDEX IF NOT EXISTS idx_auction_bids_amount ON auction_bids(listing_id, bid_amount DESC);
CREATE INDEX IF NOT EXISTS idx_auction_bids_status ON auction_bids(listing_id, status);

CREATE INDEX IF NOT EXISTS idx_auction_watchers_listing ON auction_watchers(listing_id);
CREATE INDEX IF NOT EXISTS idx_auction_watchers_watcher ON auction_watchers(watcher_id);

CREATE INDEX IF NOT EXISTS idx_auction_questions_listing ON auction_questions(listing_id);

-- RLS Policies
ALTER TABLE auction_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_watchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auction_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_offers ENABLE ROW LEVEL SECURITY;

-- Auction listings policies
CREATE POLICY "Anyone can view active public listings" ON auction_listings FOR SELECT USING (status IN ('active', 'ended', 'sold'));
CREATE POLICY "Users can create their own listings" ON auction_listings FOR INSERT WITH CHECK (seller_id = auth.uid());
CREATE POLICY "Users can update their own listings" ON auction_listings FOR UPDATE USING (seller_id = auth.uid());
CREATE POLICY "Users can delete their own draft listings" ON auction_listings FOR DELETE USING (seller_id = auth.uid() AND status = 'draft');

-- Auction bids policies
CREATE POLICY "Anyone can view bids for public listings" ON auction_bids FOR SELECT USING (true);
CREATE POLICY "Authenticated users can place bids" ON auction_bids FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can view their own bids" ON auction_bids FOR SELECT USING (bidder_id = auth.uid());

-- Auction watchers policies
CREATE POLICY "Users can manage their watch list" ON auction_watchers FOR ALL USING (watcher_id = auth.uid());

-- Auction questions policies
CREATE POLICY "Anyone can view public questions" ON auction_questions FOR SELECT USING (is_public = true);
CREATE POLICY "Users can ask questions" ON auction_questions FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Sellers can answer questions on their listings" ON auction_questions FOR UPDATE USING (
    listing_id IN (SELECT id FROM auction_listings WHERE seller_id = auth.uid())
);

-- Auction transactions policies
CREATE POLICY "Users can view their transactions" ON auction_transactions FOR SELECT USING (
    seller_id = auth.uid() OR buyer_id = auth.uid()
);

-- Listing offers policies
CREATE POLICY "Users can view offers on their listings" ON listing_offers FOR SELECT USING (
    listing_id IN (SELECT id FROM auction_listings WHERE seller_id = auth.uid()) OR buyer_id = auth.uid()
);
CREATE POLICY "Users can make offers" ON listing_offers FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Users can update their own offers" ON listing_offers FOR UPDATE USING (buyer_id = auth.uid());

COMMIT;