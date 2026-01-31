# Platform Case Studies: Specific Observations & Lessons

This document compiles specific case studies, A/B test results, and documented platform behaviors that inform recommendation system design.

---

## Case Study 1: YouTube's 2012 Algorithm Change

### Background
In 2012, YouTube shifted from optimizing for **clicks** to optimizing for **watch time**.

### Before (Click Optimization)
```
Problem: Clickbait dominated
- Sensationalist thumbnails
- Misleading titles
- Users clicked, watched 5 seconds, left frustrated
- Algorithm rewarded the clickbait

Example ranking:
Video A: 100,000 clicks, 5 seconds avg watch = WINNER
Video B: 10,000 clicks, 10 minutes avg watch = LOSER
```

### After (Watch Time Optimization)
```
Solution: Predict expected watch time
- Algorithm learned to identify quality content
- Clickbait penalized (high clicks, low watch time)
- Educational and long-form content surfaced

Example ranking:
Video A: 100,000 clicks, 5 seconds avg watch = LOSER (low total watch time)
Video B: 10,000 clicks, 10 minutes avg watch = WINNER (high total watch time)
```

### Results
- Session duration increased 50%+
- User satisfaction improved
- Creators adapted content strategy
- Long-form content became viable

### Lesson for Nuke
> Don't optimize for clicks on vehicle listings. Optimize for dwell time + inquiry rate. A listing that gets 100 clicks but 5-second dwells is worse than one that gets 20 clicks with 2-minute dwells.

---

## Case Study 2: Facebook's "Meaningful Social Interactions" (2018)

### Background
In January 2018, Facebook announced a major News Feed algorithm change prioritizing "meaningful social interactions" over passive consumption.

### The Change
```
Before: Optimize for time spent
- News articles, viral videos ranked highly
- Users scrolling passively

After: Optimize for "meaningful" interactions
- Comments from friends weighted heavily
- Shares to friends weighted heavily
- Reactions from close friends weighted heavily
- News/publisher content de-prioritized
```

### Specific Weights (From Internal Documents)
```
Interaction Value Hierarchy:
1. Comments from friends: 5x weight
2. Reactions on friend posts: 3x weight
3. Reshares with commentary: 4x weight
4. Plain reshares: 1x weight
5. Reactions on public posts: 0.5x weight
6. Views on videos: 0.1x weight
```

### Results
- Time spent decreased initially (by design)
- User satisfaction surveys improved
- Publisher traffic collapsed 50%+
- "Facebook is dying" headlines
- Stock price temporarily dropped
- Long-term: Platform remained sticky

### Lesson for Nuke
> Comments and interactions between users are more valuable than passive viewing. A shop that generates discussion is more valuable than one that gets silent views.

---

## Case Study 3: TikTok's Sound-Based Virality

### The Mechanism
```
Observation: Sounds on TikTok have their own viral potential

How it works:
1. User creates video with original sound
2. Sound becomes "trending"
3. Other users create videos with same sound
4. Algorithm clusters all videos using that sound
5. Users who engage with one video see others with same sound
6. Sound spreads exponentially

Result: A single sound can generate millions of videos
```

### Specific Example: "Oh No" Sound
```
Timeline:
- Original upload: Capone's "Oh No" snippet
- Week 1: 1,000 videos using sound
- Week 2: 50,000 videos
- Week 4: 1,000,000+ videos
- Peak: 15+ million videos using this sound

Algorithm behavior:
- Users who watched 2+ "Oh No" videos got more
- Completion rate on "Oh No" videos influenced all recommendations
- Sound created its own content cluster
```

### Why This Matters
```
Sound = Low-barrier participation
- No originality required
- Just apply sound to any content
- Instant community membership
- Algorithmic boost guaranteed
```

### Lesson for Nuke
> Find Nuke's equivalent of "sounds" - shared elements that enable participation. For vehicles: specific builds, common modifications, restoration techniques. A "LS swap" could be like a trending sound.

---

## Case Study 4: Instagram's Explore Page Evolution

### 2015 Explore
```
Initial design: Editorial curation
- Human editors selected content
- Categories: Food, Fashion, Art, etc.
- Popular accounts featured
- Very slow updates (daily)
```

### 2018 Explore
```
Algorithm-driven:
- Collaborative filtering: "Users like you liked..."
- Topic clustering: Content grouped by visual similarity
- Engagement signals: Recent high-engagement content
- Updates: Hourly
```

### 2022+ Explore
```
TikTok-influenced:
- Full-screen video (Reels) prioritized
- Watch time primary signal
- Creator following less important
- Real-time personalization
```

### Key Observation: Engagement Rate by Content Type
From published Instagram data (2021):
```
Content Type         Avg Engagement Rate
Reels                1.95%
Carousels            1.92%
Single Images        1.74%
Videos (non-Reels)   1.45%

Engagement = (likes + comments + saves) / reach
```

### Lesson for Nuke
> Multi-image galleries (carousels) outperform single images. Vehicle listings with 10+ photos likely get better engagement. Consider implementing swipeable galleries with completion tracking.

---

## Case Study 5: Hacker News's Gravity Factor

### The Formula
Hacker News uses a simple but effective ranking formula:

```python
score = (points - 1) / (hours + 2) ^ gravity

where:
- points = upvotes
- hours = age in hours
- gravity = 1.8 (the key tuning parameter)
```

### Why gravity = 1.8?
```
Testing revealed:
- gravity = 1.0: Content stays too long, front page stale
- gravity = 1.5: Better turnover, but viral content dominates
- gravity = 1.8: Good balance of freshness and quality
- gravity = 2.0: Too aggressive, quality content doesn't surface

The 1.8 value emerged from years of A/B testing and 
community feedback.
```

### Impact of Time
```
Post with 100 points:
After 1 hour:  (100-1)/(1+2)^1.8 = 14.5
After 2 hours: (100-1)/(2+2)^1.8 = 7.1
After 6 hours: (100-1)/(6+2)^1.8 = 2.4
After 24 hours: (100-1)/(24+2)^1.8 = 0.3

Half-life ≈ 2 hours
After 6 hours, needs 5x points to maintain position
```

### Lesson for Nuke
> For trending/hot content, use exponential time decay. A new listing should get fresh exposure, but older listings need sustained engagement to stay visible. Consider gravity between 1.5-2.0 for vehicle marketplace.

---

## Case Study 6: Netflix's Artwork Personalization

### The Experiment
Netflix discovered that the thumbnail/artwork shown for a movie significantly affects click-through rate—and different users respond to different images.

### Results
```
Finding: Same content, different artwork = different CTR

Example: "Stranger Things"
- User A (action fan): Shown action scene thumbnail
- User B (romance fan): Shown character relationship thumbnail
- User C (horror fan): Shown scary monster thumbnail

Result: 20-30% CTR improvement from personalized artwork
```

### Implementation
```
For each title:
1. Generate 10-20 different thumbnail options
2. A/B test all options on random users
3. Train model: User features → Best thumbnail
4. Serve personalized thumbnails per user
```

### Lesson for Nuke
> Consider which vehicle image to show in feed. User interested in engines might respond better to engine bay shot. User interested in interiors might respond to cockpit shot. Test multiple primary images.

---

## Case Study 7: Twitter's Blue Checkmark Algorithm Boost

### From Open Source (March 2023)
When Twitter open-sourced their algorithm, this was revealed:

```scala
// From actual Twitter code
if (author.isBlueVerified) {
  score *= 4.0  // 4x boost for Twitter Blue subscribers
}
```

### Public Reaction
- Immediate backlash about "pay for reach"
- Twitter removed/modified this code within days
- But principle revealed: Platforms can and do boost paying users

### Subsequent Changes
```
After backlash, boost reduced to ~1.5x (estimated)
Additionally:
- Blue users' replies prioritized in threads
- Blue users can post longer videos
- Blue users get "creator revenue sharing"
```

### Lesson for Nuke
> Premium shop accounts could get distribution boost. But be transparent about it—hidden boosts cause backlash. Consider: "Featured Shop" badges that are clearly paid placements.

---

## Case Study 8: Pinterest's Visual Search Accuracy

### The Technology
Pinterest's visual search uses deep learning to find "visually similar" images:

```
Architecture:
1. Image → CNN (ResNet-like) → 4096-dim embedding
2. Embedding indexed in FAISS (approximate nearest neighbors)
3. Query: Image → Embedding → Find nearest neighbors

Performance:
- 10+ billion images indexed
- Query time: <100ms
- Accuracy: 80%+ same-category results
```

### Discovery vs. Search
```
Key insight: Pinterest distinguishes:

Search: User knows what they want
- Text query: "mid-century modern sofa"
- Return exact matches

Discovery: User doesn't know what they want
- Visual similarity: "Things that look like this"
- Return related but diverse results
- Enable serendipity
```

### Lesson for Nuke
> Visual similarity for vehicles could work well. User looking at a blue Porsche 911 → Show other 911s, other blue sports cars, other German cars. Enable "find similar vehicles" feature.

---

## Case Study 9: Spotify's Monday Playlist Problem

### The Observation
Discover Weekly playlists are generated on Mondays. Spotify noticed:

```
Problem: Playlist generated with last week's listening data
- User's taste may have shifted
- Weekend listening different from weekday
- Major events (breakups, new interests) not reflected

Result: 30% of users skip first 2-3 songs
The algorithm was "stale" by the time it delivered
```

### The Solution
```
Changes implemented:
1. Real-time taste updates (not just weekly)
2. "Daily Mix" playlists that update constantly
3. Weight recent listening more heavily
4. Detect "mood shifts" from sudden genre changes
```

### Lesson for Nuke
> User interests change. Someone looking at Ferrari today doesn't mean they're always a Ferrari person. Weight recent behavior heavily. Consider daily/weekly interest decay.

---

## Case Study 10: Reddit's Comment Quality Problem

### The Upvote Timing Issue
```
Observation: Early comments get disproportionate upvotes

Why:
- First comment seen by most viewers
- Early upvotes lead to more visibility
- More visibility leads to more upvotes
- Positive feedback loop regardless of quality

Result: First comment, not best comment, gets top spot
```

### The Solution (Wilson Score)
```python
def wilson_lower_bound(ups, downs, z=1.96):
    """
    Instead of: score = ups - downs
    Use: lower bound of Wilson score confidence interval
    
    This accounts for sample size uncertainty.
    """
    n = ups + downs
    if n == 0:
        return 0
    phat = ups / n
    return (
        phat + z*z/(2*n) - z * sqrt((phat*(1-phat)+z*z/(4*n))/n)
    ) / (1 + z*z/n)

# Example:
# Comment A: 1 up, 0 down → wilson = 0.21
# Comment B: 100 up, 10 down → wilson = 0.85
# Comment B wins despite Comment A having "100% positive"
```

### Lesson for Nuke
> When ranking content with limited data (new listings), use confidence intervals. A listing with 1 inquiry out of 10 views isn't necessarily better than one with 10 inquiries out of 200 views.

---

## Case Study 11: Facebook Marketplace Location Radius

### The Experiment
Facebook tested different default search radii:

```
Test variants:
A: 10 miles (very local)
B: 25 miles (local)
C: 50 miles (regional)
D: 100 miles (willing to travel)

Results:
- 10 miles: Highest response rate, lowest inventory
- 25 miles: Best balance of inventory and response
- 50 miles: Good for specialty items
- 100 miles: Only for rare/expensive items
```

### Dynamic Radius
```
Facebook's solution:
- Common items (furniture): Smaller radius default
- Rare items (collectibles): Larger radius default
- Adjust based on inventory: Low inventory → expand radius
- Adjust based on user history: If user travels for purchases → larger default
```

### Lesson for Nuke
> For common vehicles (Toyota Camry): Smaller search radius. For rare vehicles (Ferrari 250 GTO): Expand radius dramatically. Let user behavior inform radius preferences.

---

## Case Study 12: Instagram's "Recency" Reintroduction

### The 2016 Removal
```
2016: Instagram removed chronological feed
- Switched to algorithmic ranking
- Users complained loudly
- #BringBackChronological trended
```

### The 2022 Restoration (Sort Of)
```
2022: Instagram added "Following" and "Favorites" feeds
- Following: Chronological, only accounts you follow
- Favorites: Chronological, accounts you've marked
- For You: Algorithmic (default)

Key insight: Give users CHOICE but default to algorithmic
```

### User Behavior After Change
```
Observation (from external studies):
- Only 15-20% of users switched to chronological
- Users who switched had slightly lower session times
- But higher satisfaction scores
- Algorithmic users had longer sessions but more "regrets"
```

### Lesson for Nuke
> Offer both algorithmic and chronological options. Default to algorithmic but let power users switch. "Following" tab = chronological from followed shops.

---

## Aggregated Insights

### What Works Across All Platforms

| Principle | Evidence | Application to Nuke |
|-----------|----------|---------------------|
| Watch time > clicks | YouTube 2012, TikTok, Reels | Track dwell time on listings |
| Comments > likes | Facebook MSI, Twitter weights | Prioritize vehicles with discussions |
| Negative signals are 5-10x | All platforms | Fast scroll past = strong negative |
| Fresh content bonus | HN gravity, Reddit hot | New listings get initial boost |
| Personalized visuals | Netflix artwork | Show relevant photos first |
| Confidence intervals | Reddit Wilson score | Don't trust small sample sizes |
| Time decay is exponential | HN, Reddit, Twitter | Old content must earn its place |
| Real-time learning wins | TikTok vs. others | Update recommendations immediately |

### What Fails

| Anti-Pattern | Why It Fails | Avoid in Nuke |
|--------------|--------------|---------------|
| Click optimization | Rewards clickbait | Don't rank by views alone |
| Following-only feeds | Filter bubble, stale | Mix followed + discovered |
| No negative feedback | Can't correct mistakes | Implement "not interested" |
| Slow model updates | Stale recommendations | Real-time tracking |
| Single thumbnail | Misses personalization | Consider multiple primary images |
| Fixed search radius | Wrong for rare items | Dynamic radius by item type |
| Pure chronological | Favors prolific posters | Blend with engagement signals |

---

## Recommended A/B Tests for Nuke

Based on these case studies, priority tests:

### Test 1: Ranking Algorithm
```
Control: Chronological (newest first)
Treatment: Engagement-weighted (dwell time + inquiry rate)
Metric: Inquiry rate, session duration, return rate
Duration: 2 weeks
Traffic: 20% treatment
```

### Test 2: Gallery Completion Tracking
```
Control: Show all photos equally
Treatment: Weight vehicles where users view all photos higher
Metric: Inquiry rate per impression
Duration: 2 weeks
Traffic: 50% treatment
```

### Test 3: Search Radius by Vehicle Rarity
```
Control: Fixed 50-mile radius
Treatment: Dynamic radius (10mi for common, 200mi for rare)
Metric: Search result clicks, inquiry rate
Duration: 3 weeks
Traffic: 50% treatment
```

### Test 4: Negative Feedback Implementation
```
Control: No "not interested" option
Treatment: "Not interested" button with content suppression
Metric: User satisfaction survey, session frequency
Duration: 4 weeks
Traffic: 30% treatment
```

### Test 5: Creator Reputation Display
```
Control: No reputation signals
Treatment: Show response rate, inquiry conversion, reviews
Metric: Inquiry rate, trust survey
Duration: 3 weeks
Traffic: 50% treatment
```
