# Engagement Algorithms Research & Strategy

## Executive Summary

This document analyzes engagement algorithms used by TikTok, Instagram, and Facebook Marketplace to inform the development of Nuke's discovery feed and engagement systems. Given the current state (vehicle marketplace + service discovery platform with limited active users), we focus on cold-start strategies and creator-first approaches.

---

## Part 1: How Major Platforms Work

### 1.1 TikTok's Algorithm - The Gold Standard for Engagement

TikTok's algorithm is fundamentally different from legacy social networks. It prioritizes **content over connections**.

#### Core Mechanics

| Signal | Weight | Description |
|--------|--------|-------------|
| **Watch Time** | Very High | % of video watched, re-watches, completions |
| **Engagement** | High | Likes, comments, shares, saves |
| **Video Information** | Medium | Captions, sounds, hashtags |
| **Device/Account Settings** | Low | Language, country, device type |
| **Creator Following** | Low | Unlike Instagram, following matters less |

#### Key Innovation: The "For You" Page

```
Content-First Discovery (TikTok)
--------------------------------
1. Show content to small test group (100-300 users)
2. Measure watch time, engagement rate, completion rate
3. If metrics exceed threshold → expand audience
4. Repeat expansion until engagement drops
5. Stop distribution when performance plateaus

Result: Unknown creators can go viral immediately
```

**Why it works for cold-start:**
- New users get personalized feed in ~15-30 minutes of usage
- New creators get discovered without needing followers
- Algorithm learns preferences from behavior, not declared interests

#### TikTok's Recommendation Funnel

```
Level 1: Initial Distribution (100-300 views)
    ↓ (if >10% engagement, >70% watch time)
Level 2: Expanded Pool (1,000-5,000 views)
    ↓ (if maintains metrics)
Level 3: Broader Audience (10,000-50,000 views)
    ↓ (continues expanding if metrics hold)
Level 4+: Viral territory
```

### 1.2 Instagram's Algorithm (Feed + Reels + Explore)

Instagram uses different algorithms for different surfaces:

#### Feed Algorithm (Following-First)
| Factor | Priority |
|--------|----------|
| Relationship | Who you interact with most |
| Interest | Content types you engage with |
| Timeliness | Recency still matters |
| Frequency | How often you open app |
| Following Count | More follows = less per-creator reach |
| Session Time | How long you typically browse |

#### Reels Algorithm (TikTok-Influenced)
| Factor | Priority |
|--------|----------|
| Activity | What you've liked/saved/commented |
| History with Creator | Previous interactions |
| Reel Information | Audio, effects, topic |
| Creator Popularity | Some weight to established creators |

#### Explore Algorithm (Discovery)
| Factor | Priority |
|--------|----------|
| Engagement Velocity | How fast content gets engagement |
| Content Similarity | To posts you've engaged with |
| Creator Authority | Account reputation in topic |

### 1.3 Facebook Marketplace Algorithm

Most relevant to Nuke's current model:

#### Ranking Signals
```
1. Relevance Score
   - Search query match
   - Category alignment
   - User browsing history
   - Similar item engagement

2. Quality Signals
   - Photo quality (AI-assessed)
   - Description completeness
   - Price reasonableness (vs. market)
   - Seller response rate

3. Trust Signals
   - Seller ratings
   - Profile completeness
   - Transaction history
   - Verification status

4. Freshness
   - Recently listed items get boost
   - Recently updated items resurface
   - Sold items drop from results

5. Location
   - Distance from buyer
   - Shipping availability
```

#### Key Insight: Facebook Marketplace's "Recommended for You"

```
Marketplace uses IMPLICIT signals heavily:
- Items you lingered on (dwell time)
- Items you messaged about
- Items you saved
- Price ranges you browse
- Categories you return to
- Times of day you browse
```

---

## Part 2: TikTok's Launch & Growth Strategy

### 2.1 The Musical.ly Foundation (2014-2017)

TikTok's predecessor, Musical.ly, solved the cold-start problem:

#### Early User Acquisition
1. **Target Audience**: Teenage girls in US (underserved by existing platforms)
2. **Initial Content**: Lip-sync videos (low barrier, high expression)
3. **School Network Effect**: One kid makes video → friends want to be in it
4. **Featured Page**: Curated content surface for discoverability

#### Key Metrics from Musical.ly's Growth
| Date | Users | Strategy |
|------|-------|----------|
| 2014 | Launch | App Store feature in 30+ countries |
| 2015 | 10M | #1 in App Store, organic viral growth |
| 2016 | 100M | Celebrity endorsements, school campaigns |
| 2017 | 200M+ | Acquired by ByteDance |

### 2.2 TikTok's Launch Strategy (2018-2019)

ByteDance combined Musical.ly + Douyin (Chinese TikTok) experience:

#### Phase 1: Creator Acquisition
```
1. PAID top creators to join
   - $1M+ to influencers to post daily
   - Revenue sharing deals
   - Exclusive tools access

2. Made content creation FRICTIONLESS
   - In-app editing better than competitors
   - Trending sounds = instant participation
   - Duets = collaboration without coordination

3. CROSS-POSTED to other platforms
   - TikTok watermark on all exports
   - Creators shared to Instagram/YouTube
   - Free marketing on competitor platforms
```

#### Phase 2: Viewer Acquisition
```
1. Aggressive advertising ($1B+ in 2018-2019)
   - Snapchat ads
   - YouTube pre-roll
   - Instagram stories
   - TV commercials

2. App Store optimization
   - Multiple apps (TikTok, TikTok Lite, CapCut)
   - Category manipulation to appear in multiple lists

3. "Just watch" experience
   - No sign-up required to browse
   - Personalization happens pre-registration
   - Login prompt only after addiction kicks in
```

#### Phase 3: Network Effects
```
1. Sound/Song Virality
   - One song used by thousands of creators
   - Music industry partnerships
   - Trend participation = community belonging

2. Challenge Culture
   - Hashtag challenges with sponsor backing
   - Low barrier participation
   - Community content creates itself

3. Local-to-Global Pipeline
   - Content popular in one region tested globally
   - Cross-cultural trend identification
```

### 2.3 What Made TikTok Win: Key Insights

| Factor | Traditional Social | TikTok |
|--------|-------------------|--------|
| Discovery | Friend-based | Interest-based |
| Content Barrier | High (polished) | Low (authentic) |
| Creator Path | Build audience first | Content can go viral immediately |
| Algorithm Focus | Who you follow | What you watch |
| Session Design | Infinite scroll | Full-screen immersion |
| Creation Tools | Basic/external | Best-in-class native |

---

## Part 3: Defining Engagement for Nuke

### 3.1 What Are We Actually Building?

Current identity (confused):
- Marketplace (buying/selling vehicles)
- Service discovery (finding paint shops, mechanics)
- Data platform (vehicle histories, valuations)
- Community (ownership, events, builds)

**Proposed Focus Order:**

```
Phase 1: Service Showcase Platform
"TikTok for car builds and services"
- Creators: Shops, mechanics, restorers
- Content: Build progress, transformations, techniques
- Viewers: Vehicle owners seeking services

Phase 2: Marketplace Layer
- Vehicles for sale surface naturally
- Service marketplace (book appointments)
- Parts discovery

Phase 3: Ownership Community
- Vehicle timelines as content
- Ownership stories
- Event coordination
```

### 3.2 Engagement Metrics for Nuke

#### Creator Engagement (Service Providers/Shops)

| Metric | Description | Target |
|--------|-------------|--------|
| Posts/Week | Content frequency | 3+ |
| Post Completion Rate | Views that reach end | >60% |
| Inquiry Rate | Viewers who contact | >2% |
| Booking Rate | Inquiries that book | >10% |
| Response Time | Time to reply to inquiry | <4 hours |
| Return Rate | Viewers who come back | >30% |

#### Viewer Engagement (Vehicle Owners)

| Metric | Description | Target |
|--------|-------------|--------|
| Session Duration | Time per visit | >5 min |
| Posts Viewed | Items seen per session | >15 |
| Dwell Time | Time on individual content | >10 sec |
| Save Rate | Content bookmarked | >5% |
| Share Rate | Content shared externally | >1% |
| Return Frequency | Days between visits | <7 |
| Action Rate | Inquiries, bookings, follows | >3% |

#### Platform Health Metrics

| Metric | Description | Target |
|--------|-------------|--------|
| DAU/MAU | Daily/Monthly ratio | >30% |
| New Creator Retention (D7) | Creators active after 7 days | >40% |
| New Viewer Retention (D7) | Viewers returning after 7 days | >50% |
| Content Growth | New posts per day | Growing 10%+ weekly |
| Geographic Coverage | Markets with active creators | Expanding |

### 3.3 Types of Content to Prioritize

```
High Engagement Potential:
1. Transformation Content
   - Before/after reveals
   - Time-lapse builds
   - Paint reveals
   - Engine startup after rebuild

2. Process Content
   - "How we fixed this problem"
   - Tool tips and techniques
   - Common mistake corrections

3. Discovery Content
   - Barn finds
   - Rare vehicle features
   - Unexpected finds during restoration

4. Live Content
   - Build sessions in progress
   - Dyno runs
   - First drives after restoration
   - Q&A with technicians

5. Marketplace Content
   - Vehicle walk-arounds
   - Price justification deep-dives
   - Vehicle history explanations
```

---

## Part 4: Algorithm Design for Nuke

### 4.1 Proposed Feed Algorithm

```typescript
interface FeedRankingScore {
  // Core engagement signals
  predictedWatchTime: number;     // ML model prediction
  predictedInteraction: number;   // Like/comment/save probability
  predictedConversion: number;    // Inquiry/booking probability
  
  // Content quality signals
  visualQuality: number;          // Image/video quality score
  completeness: number;           // Description, tags, details
  creatorReputation: number;      // Historical performance
  
  // Relevance signals
  categoryMatch: number;          // User interest alignment
  locationRelevance: number;      // Geographic proximity
  priceRangeMatch: number;        // Budget alignment
  makeModelAffinity: number;      // Vehicle preference match
  
  // Freshness/diversity
  recencyBoost: number;           // Decay function on age
  diversityNeed: number;          // Avoid category fatigue
  creatorBalancing: number;       // Don't show too much from one source
}

// Weighted combination (weights learned from user behavior)
finalScore = (
  predictedWatchTime * 0.25 +
  predictedInteraction * 0.20 +
  predictedConversion * 0.15 +
  categoryMatch * 0.15 +
  visualQuality * 0.10 +
  creatorReputation * 0.05 +
  recencyBoost * 0.05 +
  diversityNeed * 0.05
);
```

### 4.2 Cold Start Strategies

#### For New Users (No Behavior Data)

```
1. Onboarding Signals
   - Ask about vehicle interests (make, era, style)
   - Ask about services needed (restoration, maintenance, buying)
   - Ask about location (local vs. willing to travel)
   
2. Default Feed Composition
   - 30% highest-rated content (crowd-validated quality)
   - 30% trending content (recent high engagement)
   - 20% local content (geographic relevance)
   - 20% diverse exploration (category breadth)

3. Rapid Personalization
   - Track dwell time immediately
   - Track scroll speed (fast = disinterest)
   - Weight first session actions heavily
   - Update model in real-time
```

#### For New Creators (No Audience)

```
1. Guaranteed Minimum Distribution
   - Every new post shown to X users (start with 50-100)
   - Quality threshold must pass (no spam)
   
2. Topic-Based Seeding
   - Match to users interested in that service type
   - Match to users in geographic area
   - Match to users with similar vehicle
   
3. Engagement Threshold Expansion
   If (engagement_rate > threshold):
     expand_audience(multiplier=5)
     track_new_engagement()
     repeat()
   Else:
     stop_expansion()
     provide_feedback_to_creator()
```

### 4.3 Feed Composition Rules

```
For each session:

MANDATORY SLOTS:
- 1x Following content (if follows exist)
- 1x Local content (within radius)
- 1x New creator content (cold-start support)

RANKED SLOTS (rest of feed):
- Ranked by algorithm score
- Subject to diversity constraints:
  - Max 3 from same creator per 20 items
  - Max 5 from same category per 20 items
  - Min 2 different service types per 20 items

INJECTION POINTS:
- Every 10 items: trending content
- Every 15 items: followed creator if available
- Every 20 items: "Because you viewed X" explanation
```

### 4.4 Engagement Optimization Tactics

#### From TikTok
```
1. Full-Screen Immersion
   - Mobile feed is one item at a time
   - Swipe to advance (intentional action)
   - Auto-play video/slideshow

2. Sound/Audio Integration
   - Engine sounds, shop ambiance
   - Trending audio for service reveals
   
3. Completion Incentives
   - "Stay for the reveal" content structure
   - Transformation payoff at end
```

#### From Instagram
```
1. Save Feature
   - "Save for later" for vehicles/services
   - Saved items inform recommendations
   
2. Stories/Ephemeral Content
   - Shop daily updates
   - 24-hour specials
   - Build progress that expires
   
3. Close Friends / VIP Access
   - Early access to listings
   - Behind-scenes content
```

#### From Facebook Marketplace
```
1. Messaging Integration
   - Quick inquiry buttons
   - Pre-filled questions
   - Response time badges
   
2. Price Intelligence
   - "Good deal" badges
   - Price history
   - Similar listings comparison
   
3. Seller Quality Signals
   - Response rate
   - Review score
   - Verification badges
```

---

## Part 5: Implementation Roadmap

### 5.1 Phase 1: Data Collection Infrastructure (Current Sprint)

What already exists:
- `user_interactions` table with view/like/comment tracking
- `useActivityTracking` hook for frontend events
- `viewer_activity` and `viewer_reputation` tables
- Basic feed service with chronological sorting

**Immediate additions needed:**

```sql
-- Enhanced tracking for algorithm
CREATE TABLE content_impressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  content_type TEXT NOT NULL, -- 'vehicle', 'service_post', 'stream'
  content_id UUID NOT NULL,
  impression_source TEXT, -- 'feed', 'search', 'profile', 'share'
  position_in_feed INTEGER,
  
  -- Timing signals
  impression_at TIMESTAMPTZ DEFAULT NOW(),
  first_visible_at TIMESTAMPTZ,
  last_visible_at TIMESTAMPTZ,
  dwell_time_ms INTEGER,
  
  -- Engagement outcome
  clicked BOOLEAN DEFAULT FALSE,
  liked BOOLEAN DEFAULT FALSE,
  saved BOOLEAN DEFAULT FALSE,
  shared BOOLEAN DEFAULT FALSE,
  inquired BOOLEAN DEFAULT FALSE,
  
  -- Context
  device_type TEXT,
  session_id UUID
);

-- User interest model
CREATE TABLE user_interest_vectors (
  user_id UUID PRIMARY KEY REFERENCES profiles(id),
  
  -- Categorical interests (0-1 scores)
  restoration_interest FLOAT DEFAULT 0.5,
  maintenance_interest FLOAT DEFAULT 0.5,
  buying_interest FLOAT DEFAULT 0.5,
  selling_interest FLOAT DEFAULT 0.5,
  
  -- Vehicle preferences
  preferred_makes TEXT[],
  preferred_eras TEXT[], -- 'classic', 'modern', 'vintage'
  price_range_low INTEGER,
  price_range_high INTEGER,
  
  -- Geographic
  home_location GEOGRAPHY(POINT),
  travel_radius_miles INTEGER DEFAULT 50,
  
  -- Behavioral
  avg_session_duration_seconds INTEGER,
  avg_items_viewed_per_session INTEGER,
  preferred_content_types TEXT[],
  
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Content performance tracking
CREATE TABLE content_performance (
  content_id UUID PRIMARY KEY,
  content_type TEXT NOT NULL,
  
  -- Impression metrics
  total_impressions INTEGER DEFAULT 0,
  unique_viewers INTEGER DEFAULT 0,
  
  -- Engagement metrics
  total_dwell_time_ms BIGINT DEFAULT 0,
  avg_dwell_time_ms INTEGER DEFAULT 0,
  click_rate FLOAT DEFAULT 0,
  like_rate FLOAT DEFAULT 0,
  save_rate FLOAT DEFAULT 0,
  share_rate FLOAT DEFAULT 0,
  inquiry_rate FLOAT DEFAULT 0,
  
  -- Quality signals
  completion_rate FLOAT DEFAULT 0, -- For video/slideshow
  bounce_rate FLOAT DEFAULT 0, -- Left immediately
  
  -- Distribution tracking
  distribution_tier INTEGER DEFAULT 1,
  expanded_at TIMESTAMPTZ[],
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.2 Phase 2: Basic Ranking Algorithm

```typescript
// services/feedRankingService.ts

interface RankingFactors {
  // From content_performance table
  engagementScore: number;
  qualityScore: number;
  freshnessScore: number;
  
  // From user_interest_vectors
  relevanceScore: number;
  
  // Diversity factors
  creatorDiversity: number;
  categoryDiversity: number;
}

export class FeedRankingService {
  
  static async getRankedFeed(userId: string, limit: number = 20): Promise<FeedItem[]> {
    // 1. Get user interest vector
    const userInterests = await this.getUserInterests(userId);
    
    // 2. Get candidate content pool
    const candidates = await this.getCandidatePool(userInterests);
    
    // 3. Score each candidate
    const scoredCandidates = candidates.map(item => ({
      ...item,
      score: this.calculateScore(item, userInterests)
    }));
    
    // 4. Apply diversity reranking
    const diversifiedFeed = this.applyDiversity(scoredCandidates);
    
    // 5. Inject required slots
    const finalFeed = this.injectRequiredContent(diversifiedFeed, userId);
    
    return finalFeed.slice(0, limit);
  }
  
  private static calculateScore(item: FeedItem, interests: UserInterests): number {
    const weights = {
      engagement: 0.25,
      relevance: 0.25,
      quality: 0.15,
      freshness: 0.15,
      creatorRep: 0.10,
      location: 0.10
    };
    
    return (
      item.performance.engagementScore * weights.engagement +
      this.calculateRelevance(item, interests) * weights.relevance +
      item.performance.qualityScore * weights.quality +
      this.calculateFreshness(item.createdAt) * weights.freshness +
      item.creator.reputationScore * weights.creatorRep +
      this.calculateLocationScore(item, interests) * weights.location
    );
  }
  
  private static applyDiversity(items: ScoredFeedItem[]): ScoredFeedItem[] {
    const result: ScoredFeedItem[] = [];
    const creatorCounts = new Map<string, number>();
    const categoryCounts = new Map<string, number>();
    
    for (const item of items.sort((a, b) => b.score - a.score)) {
      const creatorCount = creatorCounts.get(item.creatorId) || 0;
      const categoryCount = categoryCounts.get(item.category) || 0;
      
      // Diversity penalties
      if (creatorCount >= 2 && result.length < 20) continue;
      if (categoryCount >= 4 && result.length < 20) continue;
      
      result.push(item);
      creatorCounts.set(item.creatorId, creatorCount + 1);
      categoryCounts.set(item.category, categoryCount + 1);
      
      if (result.length >= 50) break; // Get extras for shuffling
    }
    
    return result;
  }
}
```

### 5.3 Phase 3: Creator Acquisition Strategy

Based on TikTok's playbook, adapted for Nuke:

#### Target Creators (Priority Order)

```
1. Restoration Shops (Highest Value)
   - Regular content opportunities (ongoing projects)
   - Professional quality output
   - Clear monetization (service bookings)
   - Already documenting work (for clients)

2. Independent Mechanics/Specialists
   - Technical expertise content
   - Problem-solving narratives
   - Local service discovery
   
3. Parts Vendors
   - Product showcases
   - Installation tutorials
   - Cross-sell opportunities

4. Vehicle Sellers (Power Sellers)
   - Regular inventory turnover
   - Marketplace content
   - Already motivated to create listings

5. Enthusiast Builders
   - Personal project documentation
   - Authentic storytelling
   - Community engagement
```

#### Acquisition Tactics

```
1. DIRECT OUTREACH TO TOP 100 SHOPS
   - Identify via Instagram/YouTube presence
   - Offer:
     - Free premium account ($X value)
     - Featured placement guarantee
     - Revenue share on bookings
     - Content creation support

2. MAKE POSTING FRICTIONLESS
   - Import from Instagram/YouTube
   - One-click post from gallery
   - Auto-generated descriptions from images
   - Template posts for common content

3. PROVIDE IMMEDIATE VALUE
   - Lead generation (even before posting)
   - Analytics on inquiries
   - Customer reviews aggregation
   - Business profile features

4. CREATE CONTENT INCENTIVE PROGRAM
   - "Post 10 build updates, get $X"
   - "First shop to 1000 followers gets..."
   - Monthly creator rewards
   - Referral bonuses for bringing other shops
```

### 5.4 Phase 4: Viewer Acquisition Strategy

```
1. CONTENT CROSS-POSTING
   - All exports watermarked with Nuke branding
   - Easy sharing to Instagram/Facebook/YouTube
   - Embeddable player for forums
   
2. SEO PLAY
   - Create landing pages for:
     - "[Make] restoration shop near [City]"
     - "[Model] for sale [Year]"
     - "How to [common repair] on [Vehicle]"
   - User-generated content as SEO fodder

3. AGGREGATION VALUE
   - "See all your vehicle's auction history"
   - "Track your vehicle's value over time"
   - "Find every owner of your vehicle"
   - Unique data = unique traffic source

4. MARKETPLACE LISTINGS
   - Syndicate to Facebook Marketplace
   - Syndicate to Craigslist
   - But require engagement on Nuke to message
```

---

## Part 6: Live Streaming Integration

### 6.1 Why Live Matters for Nuke

```
TikTok Live Success Factors:
- Real-time engagement (comments, reactions)
- Scarcity (can't replay, must watch now)
- Creator-viewer relationship building
- Monetization (tips, gifts)

For Nuke:
- Build sessions = ongoing engagement
- Test drives = real-time discovery
- Auctions = competitive engagement
- Q&A = service trust building
```

### 6.2 Live Content Types

| Stream Type | Value Proposition | Engagement Driver |
|-------------|-------------------|-------------------|
| Build Session | Watch progress unfold | Curiosity, investment |
| Dyno Run | See power numbers live | Anticipation, excitement |
| First Drive | Experience the payoff | Emotional satisfaction |
| Auction | Compete for vehicle | Competition, urgency |
| Shop Tour | Discover capabilities | Trust building |
| Q&A | Get questions answered | Personal value |

### 6.3 Live Recommendation Algorithm

```typescript
// Live streams get special treatment in feed

interface LiveStreamRanking {
  // Time-sensitive factors
  viewerCount: number;           // Social proof
  viewerVelocity: number;        // Growing vs. declining
  streamDuration: number;        // New streams get boost
  expectedEndTime: Date | null;  // "Ending soon" urgency
  
  // Content factors
  streamType: string;
  vehicleMatch: number;          // Viewer's vehicle interest
  creatorFollowed: boolean;
  creatorReputation: number;
  
  // Historical (for recurring streamers)
  avgViewerCount: number;
  avgWatchDuration: number;
  tipRevenue: number;
}

// Live streams appear in dedicated slot AND can preempt feed
function shouldPreemptFeed(stream: LiveStream, user: User): boolean {
  // Always show if user follows creator
  if (user.follows.includes(stream.creatorId)) return true;
  
  // Show if matches strong interest AND high engagement
  if (stream.vehicleMatch > 0.8 && stream.viewerCount > 100) return true;
  
  // Show if trending (rapid growth)
  if (stream.viewerVelocity > 50) return true; // 50+ new viewers/min
  
  return false;
}
```

---

## Part 7: Metrics Dashboard Requirements

### 7.1 Creator Dashboard

```
MY CONTENT PERFORMANCE
----------------------
Total Views:        12,456
Avg. Watch Time:    45 seconds
Engagement Rate:    8.2%
Inquiry Rate:       2.1%
Booking Rate:       15%

TOP PERFORMING CONTENT
- "911 Suspension Rebuild" - 3,400 views, 12% engagement
- "Brake System Overhaul" - 2,100 views, 9% engagement
- "First Start After Rebuild" - 1,800 views, 15% engagement

AUDIENCE INSIGHTS
- 78% interested in German cars
- 62% within 50 miles
- 45% browsing maintenance services
- Avg. budget: $2,000-10,000

RECOMMENDATIONS
- Post more "first start" content (highest engagement)
- Try posting between 7-9 PM (your audience is most active)
- Add pricing info (your inquiry-to-booking is below avg)
```

### 7.2 Platform Health Dashboard

```
DAILY METRICS
-------------
DAU:                    1,234 (+5%)
Sessions:               3,456
Avg. Session Length:    4:32
Content Views:          45,678
Engagement Rate:        6.2%
New Sign-ups:           89

CREATOR HEALTH
--------------
Active Creators (7d):   156
New Content Today:      234
Avg. Posts/Creator:     2.3/week
Creator Retention:      67% (7d)

ENGAGEMENT FUNNEL
-----------------
Impressions → Views:    45%
Views → Engagement:     6.2%
Engagement → Inquiry:   3.1%
Inquiry → Booking:      12%

COLD START PERFORMANCE
----------------------
New User → Engagement:  34% (within first session)
New Creator → Views:    89 avg. first-post views
First Post → Second:    56% of creators post again
```

---

## Part 8: Immediate Action Items

### This Week

1. **Schema Updates**
   - Add `content_impressions` table
   - Add `user_interest_vectors` table  
   - Add `content_performance` table

2. **Tracking Enhancements**
   - Add dwell time tracking to `ContentCard`
   - Track scroll position and visibility
   - Track feed position of engaged content

3. **Basic Interest Collection**
   - Add onboarding flow asking about interests
   - Infer from first-session behavior
   - Store in user_interest_vectors

### This Month

4. **Simple Ranking v1**
   - Score by: engagement_rate * freshness * relevance
   - Relevance = category match + location proximity
   - Test against chronological baseline

5. **Creator Tools**
   - Post performance analytics
   - Audience insights summary
   - Recommended posting times

6. **Feed Diversity**
   - Implement creator/category caps
   - Add "because you viewed X" explanations
   - Inject discovery content

### This Quarter

7. **ML Model v1**
   - Train watch time predictor
   - Train engagement predictor
   - A/B test against rule-based ranking

8. **Live Integration**
   - Live content in feed
   - Push notifications for followed creators live
   - Live-specific engagement tracking

9. **Creator Acquisition**
   - Outreach to 50 shops
   - Creator incentive program launch
   - Content import tools

---

## Appendix A: TikTok Algorithm Papers & Sources

1. "Monolith: Real Time Recommendation System With Collisionless Embedding Table" (ByteDance, 2022)
2. TikTok's official "How TikTok recommends videos #ForYou" blog post
3. "The TikTok Algorithm" - Eugene Wei analysis
4. WSJ investigation into TikTok recommendation system

## Appendix B: Competitive Analysis

| Platform | MAU | Engagement | Creator Model |
|----------|-----|------------|---------------|
| TikTok | 1.5B | 52 min/day | Anyone can go viral |
| Instagram | 2B | 30 min/day | Follower-based growth |
| FB Marketplace | 1B+ | Transaction-focused | Seller ratings |
| BaT | Unknown | Auction events | Curated listings |
| Cars & Bids | Unknown | Auction events | Curated listings |
| Hagerty | Unknown | Content + Insurance | Editorial-driven |

## Appendix C: Glossary

- **DAU/MAU**: Daily/Monthly Active Users
- **Dwell Time**: Time spent viewing single piece of content
- **Cold Start**: Serving relevant content without behavioral data
- **Engagement Rate**: (Likes + Comments + Saves + Shares) / Views
- **Inquiry Rate**: Messages sent / Views
- **Distribution Tier**: Level of audience expansion for content
- **Interest Vector**: Numerical representation of user preferences
