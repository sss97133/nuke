# Engagement & Feed Algorithm Research

This folder contains research and implementation documentation for Nuke's engagement algorithms and discovery feed system.

## Documents

### [ENGAGEMENT_ALGORITHMS_RESEARCH.md](./ENGAGEMENT_ALGORITHMS_RESEARCH.md)
Comprehensive analysis of how TikTok, Instagram, and Facebook Marketplace handle engagement and recommendations.

**Key sections:**
- Part 1: How Major Platforms Work (TikTok, Instagram, FB Marketplace mechanics)
- Part 2: TikTok's Launch & Growth Strategy (how they solved cold start)
- Part 3: Defining Engagement for Nuke (what metrics matter for us)
- Part 4: Algorithm Design for Nuke (proposed ranking system)
- Part 5: Implementation Roadmap

### [ALGORITHM_DEEP_DIVE.md](./ALGORITHM_DEEP_DIVE.md)
Technical analysis of actual recommendation algorithms from published research, open-sourced code, and reverse engineering.

**Key sections:**
- Part 1: TikTok's Monolith System (from ByteDance research paper)
- Part 2: Instagram's Multiple Algorithms (Feed vs. Reels vs. Explore)
- Part 3: YouTube's Two-Stage System (from Google research paper)
- Part 4: Twitter/X Open Source Algorithm (actual code analysis)
- Part 5: Reddit's Hot and Wilson Score formulas
- Part 6: Spotify's Discover Weekly
- Part 7: Pinterest's Visual Search
- Part 8: Common Patterns Across All Platforms

### [BEHAVIORAL_SIGNALS_ANALYSIS.md](./BEHAVIORAL_SIGNALS_ANALYSIS.md)
Deep dive into specific behavioral signals that platforms track and their weights.

**Key sections:**
- Part 1: The Signal Hierarchy (explicit vs. implicit)
- Part 2: Watch Time Deep Dive (loops, completion, calculations)
- Part 3: Dwell Time Analysis (patterns, implementation)
- Part 4: Engagement Velocity (trending detection)
- Part 5: Negative Signals (the 5-10x weight factor)
- Part 6: Session-Level Signals
- Part 7: Creator-Side Signals
- Part 8: A/B Testing Observations
- Part 9: Nuke Implementation Recommendations

### [ENGAGEMENT_SYSTEM_IMPLEMENTATION.md](./ENGAGEMENT_SYSTEM_IMPLEMENTATION.md)
Concrete technical implementation specification.

**Key sections:**
- Database Schema (SQL for tracking tables)
- Frontend Implementation (React hooks, components)
- Algorithm Tuning (A/B testing, weight configuration)
- Monitoring & Analytics (dashboard queries)
- Migration Path (from existing system)

### [COLD_START_AND_CREATOR_STRATEGY.md](./COLD_START_AND_CREATOR_STRATEGY.md)
Strategy for launching with limited users and acquiring creators.

**Key sections:**
- How TikTok Solved Cold Start
- Creator Acquisition Strategy (outreach templates, incentives)
- Viewer Acquisition Strategy
- Geographic Focus Strategy
- 90-Day Execution Plan

---

## Key Research Findings

### 1. Watch Time > Likes
All major platforms (TikTok, YouTube, Instagram Reels) discovered that **watch time/dwell time** is a far better predictor of engagement than explicit actions like likes.

```
YouTube (2012): "We found that predicting expected watch time is a 
much better objective than predicting click probability."
```

### 2. Negative Signals are 5-10x Stronger
A single "Not Interested" click is worth -10 to -50 likes in ranking impact:
- Fast skip (<1 sec) = -2 likes equivalent
- "Not Interested" = -10 to -20 likes equivalent
- Report = -50 to -100 likes equivalent

### 3. Real-Time Updates are Critical
TikTok's key differentiator: model updates in **minutes**, not days.
- TikTok: Model updated within 1-5 minutes of user action
- Instagram/YouTube: Model updated in daily/weekly batch jobs
- Result: TikTok personalizes for new users in ~30 minutes

### 4. Two-Stage Architecture is Universal
Every major platform uses:
```
Stage 1: Candidate Generation (fast, approximate)
- Millions of items → Hundreds of candidates
- Latency: <10ms
- Method: Approximate nearest neighbors

Stage 2: Ranking (slow, accurate)
- Hundreds → Ordered list
- Latency: 10-100ms
- Method: Deep neural networks
```

### 5. Twitter's Reply Weight = 13.5x
From Twitter's open-sourced algorithm:
- Reply weight: 13.5
- Retweet weight: 1.0
- Like weight: 0.5
- This explains why "reply bait" tweets go viral

### 6. Reddit's Time Decay Formula
Every 12.5 hours, a post needs 10x the votes to maintain position:
```python
hot = sign * log10(|score|) + seconds_since_epoch / 45000
```

### 7. The Loop Signal (TikTok)
Videos that get re-watched (looped) are the strongest signal:
- 1 loop = baseline
- 2-3 loops = 1.5-2.5x boost
- Algorithm detects intentional vs. accidental loops

---

## Quick Reference

### What is Engagement for Nuke?

| Metric | Description | Target |
|--------|-------------|--------|
| Dwell Time | Time spent on content | >10 seconds |
| Click Rate | Clicks / Impressions | >5% |
| Inquiry Rate | Inquiries / Views | >2% |
| Save Rate | Saves / Impressions | >5% |
| Return Rate | Users who come back | >30% |

### Core Algorithm Formula

```
finalScore = (
  engagementScore * 0.25 +    // Historical engagement on this content
  relevanceScore * 0.25 +      // Match to user interests
  qualityScore * 0.15 +        // Content completeness/visual quality
  freshnessScore * 0.15 +      // Recency decay
  creatorReputation * 0.10 +   // Historical creator performance
  locationScore * 0.10         // Geographic proximity
) * trendingMultiplier          // 1.5x if trending
```

### Tracking Flow

```
User views content → content_impressions (track dwell time)
                   → update content_performance (aggregate metrics)
                   → update user_interest_vectors (learn preferences)
                   → inform get_ranked_feed() (personalized ranking)
```

### Signal Weights by Platform

| Signal | TikTok | Instagram | YouTube | Twitter |
|--------|--------|-----------|---------|---------|
| Watch Time | ★★★★★ | ★★★★☆ | ★★★★★ | ★★☆☆☆ |
| Completion | ★★★★★ | ★★★★☆ | ★★★★☆ | ★☆☆☆☆ |
| Likes | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ | ★★☆☆☆ |
| Comments | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★★★ |
| Shares | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ |
| Saves | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★☆☆☆ |

### Recommended Nuke Signal Weights

```python
WEIGHTS = {
    'dwell_time': 0.20,      # Time looking at content
    'inquiry_sent': 0.20,    # Business conversion
    'save': 0.10,            # Intent signal
    'completion': 0.10,      # Gallery/video completion
    'click': 0.08,           # Interest
    'profile_visit': 0.07,   # Trust/discovery
    'session_continue': 0.05,# Kept them engaged
    'like': 0.05,            # Weak positive
    'image_quality': 0.05,   # Visual appeal
    'description': 0.04,     # Information quality
    'creator_rep': 0.04,     # Historical performance
    'freshness': 0.02,       # Recency
}
```

### Cold Start Priority Order

1. **Creators first:** Without content, viewers have nothing to see
2. **One market first:** LA recommended as starting point
3. **Shops over individuals:** Recurring content, business motivation
4. **Live over recorded:** Differentiation, urgency, relationship building

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `content_impressions` | Every view/engagement tracked |
| `user_interest_vectors` | Learned user preferences |
| `content_performance` | Aggregated content metrics |
| `creator_performance` | Shop/creator level metrics |
| `feed_sessions` | Browsing patterns |

---

## Implementation Status

### Existing (Already Built)
- [x] `user_interactions` table (basic tracking)
- [x] `useActivityTracking` hook
- [x] `DiscoveryFeed` component
- [x] Live streaming infrastructure
- [x] Vehicle data foundation

### Phase 1: Tracking (Next Sprint)
- [ ] Add `content_impressions` table
- [ ] Add `user_interest_vectors` table
- [ ] Implement dwell time tracking
- [ ] Deploy visibility observer

### Phase 2: Ranking (Following Sprint)
- [ ] Add `content_performance` table
- [ ] Implement `get_ranked_feed()` function
- [ ] A/B test against chronological
- [ ] Add diversity rules

### Phase 3: Personalization (After)
- [ ] Learn user interests from behavior
- [ ] Implement "because you viewed" explanations
- [ ] Add following-based content injection
- [ ] Build creator analytics dashboard

---

## Related Files

- `/nuke_frontend/src/components/feed/DiscoveryFeed.tsx` - Current feed component
- `/nuke_frontend/src/hooks/useActivityTracking.ts` - Current tracking hook
- `/nuke_frontend/src/services/feedService.ts` - Current feed service
- `/nuke_frontend/src/components/stream/LiveStreamFeed.tsx` - Live streaming UI
