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
