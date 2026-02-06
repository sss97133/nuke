# Behavioral Signals & Metrics: What Platforms Actually Track

This document details the specific behavioral signals that major platforms track and how they're weighted in recommendation algorithms.

---

## Part 1: The Signal Hierarchy

### 1.1 Explicit vs. Implicit Signals

```
EXPLICIT SIGNALS (User actively does something)
├── Strong Positive
│   ├── Purchase / Book / Subscribe
│   ├── Share to external platform
│   ├── Comment / Reply
│   └── Save / Bookmark
├── Weak Positive
│   ├── Like / Heart / Upvote
│   └── Follow / Subscribe
├── Weak Negative
│   └── Skip / Scroll past quickly
└── Strong Negative
    ├── Unfollow / Mute
    ├── Report
    ├── "Not interested"
    └── Block

IMPLICIT SIGNALS (Inferred from behavior)
├── Watch / View Time
│   ├── Raw duration
│   ├── Completion percentage
│   └── Re-watches
├── Dwell Time
│   ├── Time item visible on screen
│   └── Scroll speed over item
├── Engagement Velocity
│   ├── Time to first interaction
│   └── Rate of interactions
└── Session Behavior
    ├── Session length after seeing item
    ├── Return frequency
    └── Search queries after viewing
```

### 1.2 Signal Value by Platform

Based on research, leaked documents, and platform statements:

| Signal | TikTok | Instagram | YouTube | Twitter | Pinterest |
|--------|--------|-----------|---------|---------|-----------|
| Watch Time | ★★★★★ | ★★★★☆ | ★★★★★ | ★★☆☆☆ | ★★☆☆☆ |
| Completion Rate | ★★★★★ | ★★★★☆ | ★★★★☆ | ★☆☆☆☆ | ★★☆☆☆ |
| Likes | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★☆☆☆ |
| Comments | ★★★☆☆ | ★★★☆☆ | ★★★☆☆ | ★★★★★ | ★★☆☆☆ |
| Shares | ★★★★★ | ★★★★☆ | ★★★★☆ | ★★★★☆ | ★★☆☆☆ |
| Saves | ★★★☆☆ | ★★★★★ | ★★★★☆ | ★★☆☆☆ | ★★★★★ |
| Follows | ★★☆☆☆ | ★★★☆☆ | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ |
| Click-Through | ★☆☆☆☆ | ★★☆☆☆ | ★★★★★ | ★★★☆☆ | ★★★★☆ |
| Dwell Time | ★★★★★ | ★★★☆☆ | ★★☆☆☆ | ★★☆☆☆ | ★★★☆☆ |
| Skip Speed | ★★★★☆ | ★★★☆☆ | ★★☆☆☆ | ★★★☆☆ | ★★☆☆☆ |

---

## Part 2: Watch Time Deep Dive

### 2.1 Why Watch Time Beats Clicks

From YouTube's 2012 algorithm change documentation:

```
BEFORE 2012: Optimizing for clicks
- Videos with clickbait titles got recommended
- Users clicked, watched 5 seconds, left
- YouTube showed more clickbait
- User experience degraded

AFTER 2012: Optimizing for watch time
- Videos that kept users watching got recommended
- Clickbait penalized (high clicks, low watch time)
- Quality content surfaced
- Session time increased 50%+
```

### 2.2 Watch Time Calculation

Different platforms calculate watch time differently:

```python
# YouTube: Raw watch time in minutes
youtube_watch_value = watch_time_minutes

# TikTok: Weighted by video length
tiktok_watch_value = watch_time / video_duration
# A 60-second watch on a 60-second video = 1.0
# A 60-second watch on a 120-second video = 0.5

# Instagram Reels: Multiple signals combined
instagram_watch_value = (
    (watch_time / video_duration) * 0.6 +    # Completion rate
    (loops * 0.3) +                           # Re-watches
    (audio_on_duration / watch_time) * 0.1   # Audio engagement
)
```

### 2.3 The "Loop" Signal

TikTok tracks loops (re-watches) as a key signal:

```python
class LoopTracker:
    """
    Track how many times a video loops
    """
    
    def calculate_loop_score(self, view_session):
        video_duration = view_session.video.duration_seconds
        total_watch = view_session.total_watch_seconds
        
        # Full loops completed
        full_loops = total_watch // video_duration
        
        # Partial loop at end
        partial = (total_watch % video_duration) / video_duration
        
        # Score increases with loops but with diminishing returns
        loop_score = (
            1.0 +                    # Base score for watching once
            0.5 * min(full_loops, 3) +  # Up to 1.5 for first 3 loops
            0.2 * max(0, full_loops - 3)  # Diminishing after that
        )
        
        return loop_score

# Example:
# 15-second video watched for 45 seconds
# full_loops = 3, partial = 0
# score = 1.0 + 0.5 * 3 + 0 = 2.5

# 15-second video watched for 10 seconds
# full_loops = 0, partial = 0.67
# score = 1.0 (just base)
```

---

## Part 3: Dwell Time Analysis

### 3.1 What Dwell Time Reveals

```
DWELL TIME PATTERNS:

< 0.5 seconds: "Fast scroll"
- Item barely registered
- Strong negative signal
- Content didn't hook

0.5 - 2 seconds: "Quick look"
- User glanced at it
- Weak signal (could be positive or negative)
- Depends on content type

2 - 10 seconds: "Engaged browse"
- User is reading/looking
- Positive signal
- Interest confirmed

> 10 seconds: "Deep engagement"
- User is very interested
- Strong positive signal
- High purchase/save intent

SCROLL SPEED PATTERNS:

Fast scroll (>1000px/sec):
- Disengaged browsing
- Looking for something specific
- Not interested in current content

Medium scroll (200-1000px/sec):
- Normal browsing
- Evaluating content
- Some interest

Slow scroll (<200px/sec):
- Careful examination
- Reading descriptions
- High intent

Scroll pause:
- Item caught attention
- User examining details
- Convert to dwell time
```

### 3.2 Dwell Time Implementation

```python
class DwellTimeTracker {
    """
    How to actually track dwell time in practice
    """
    
    def __init__(self):
        self.visibility_map = {}  # item_id -> visibility state
        self.scroll_history = []  # [(timestamp, scroll_position), ...]
    
    def on_item_visible(self, item_id, timestamp, visibility_ratio):
        """Called by IntersectionObserver"""
        
        if visibility_ratio >= 0.5:  # Item is 50%+ visible
            if item_id not in self.visibility_map:
                self.visibility_map[item_id] = {
                    'first_visible': timestamp,
                    'last_visible': timestamp,
                    'total_dwell_ms': 0,
                    'is_visible': True,
                    'max_visibility_ratio': visibility_ratio
                }
            else:
                state = self.visibility_map[item_id]
                if not state['is_visible']:
                    # Item became visible again
                    state['is_visible'] = True
                    state['last_visible'] = timestamp
                state['max_visibility_ratio'] = max(
                    state['max_visibility_ratio'],
                    visibility_ratio
                )
    
    def on_item_hidden(self, item_id, timestamp):
        """Called when item scrolls out of view"""
        
        if item_id in self.visibility_map:
            state = self.visibility_map[item_id]
            if state['is_visible']:
                state['is_visible'] = False
                state['total_dwell_ms'] += (timestamp - state['last_visible'])
    
    def on_scroll(self, timestamp, scroll_position):
        """Track scroll behavior"""
        
        self.scroll_history.append((timestamp, scroll_position))
        
        # Calculate velocity from last N samples
        if len(self.scroll_history) >= 5:
            samples = self.scroll_history[-5:]
            time_delta = samples[-1][0] - samples[0][0]
            position_delta = abs(samples[-1][1] - samples[0][1])
            
            if time_delta > 0:
                self.current_scroll_velocity = position_delta / time_delta
    
    def get_engagement_quality(self, item_id):
        """Compute overall engagement quality for an item"""
        
        if item_id not in self.visibility_map:
            return 'none'
        
        state = self.visibility_map[item_id]
        dwell_ms = state['total_dwell_ms']
        visibility = state['max_visibility_ratio']
        
        # Classify engagement
        if dwell_ms < 500:
            return 'bounce'
        elif dwell_ms < 2000:
            return 'glance'
        elif dwell_ms < 10000:
            return 'engaged'
        else:
            return 'deep_engagement'
}
```

---

## Part 4: Engagement Velocity

### 4.1 What Velocity Measures

```
ENGAGEMENT VELOCITY = Rate of engagement over time

Why it matters:
- A post getting 100 likes in 1 hour is "hotter" than
- A post getting 100 likes in 24 hours

Velocity indicates:
- Content is resonating RIGHT NOW
- Algorithm should amplify immediately
- Trending potential
```

### 4.2 Velocity Calculations

```python
class EngagementVelocity:
    """
    Calculate engagement velocity for trending detection
    """
    
    def calculate_velocity(self, content_id, window_hours=1):
        """
        Get engagements per hour in recent window
        """
        now = datetime.now()
        window_start = now - timedelta(hours=window_hours)
        
        recent_engagements = db.query("""
            SELECT COUNT(*) as count
            FROM engagements
            WHERE content_id = %s
            AND created_at > %s
        """, [content_id, window_start])
        
        return recent_engagements['count'] / window_hours
    
    def calculate_acceleration(self, content_id):
        """
        Is velocity increasing or decreasing?
        """
        velocity_now = self.calculate_velocity(content_id, window_hours=1)
        velocity_prev = self.calculate_velocity_at(
            content_id, 
            at=datetime.now() - timedelta(hours=1),
            window_hours=1
        )
        
        if velocity_prev == 0:
            return float('inf') if velocity_now > 0 else 0
        
        return velocity_now / velocity_prev
    
    def is_trending(self, content_id):
        """
        Determine if content is trending
        """
        velocity = self.calculate_velocity(content_id)
        acceleration = self.calculate_acceleration(content_id)
        
        # Trending = high velocity AND increasing
        return velocity > 10 and acceleration > 1.5
    
    def trending_score(self, content_id):
        """
        Score for ranking trending content
        """
        velocity = self.calculate_velocity(content_id)
        acceleration = self.calculate_acceleration(content_id)
        
        # Reddit-style: velocity * log(velocity) * acceleration
        if velocity <= 0:
            return 0
        
        return velocity * math.log10(velocity + 1) * acceleration
```

### 4.3 Time-Weighted Scoring (Reddit-Style)

```python
def reddit_hot_score(ups, downs, created_at):
    """
    Reddit's exact hot ranking algorithm
    
    Key insight: Time is in the formula, not just used for filtering
    """
    # Net score
    score = ups - downs
    
    # Order of magnitude of score
    order = math.log10(max(abs(score), 1))
    
    # Sign of score
    sign = 1 if score > 0 else (-1 if score < 0 else 0)
    
    # Seconds since Reddit epoch
    epoch = datetime(2005, 12, 8, 7, 46, 43)
    seconds = (created_at - epoch).total_seconds()
    
    # The magic number 45000 ≈ 12.5 hours
    # Every 12.5 hours, you need 10x the votes to maintain position
    return sign * order + seconds / 45000


def hacker_news_score(points, age_hours):
    """
    Hacker News ranking algorithm (public)
    
    Even faster decay than Reddit
    """
    gravity = 1.8
    return (points - 1) / pow(age_hours + 2, gravity)

# Example decay:
# Post with 100 points:
# After 1 hour:  (100-1) / (1+2)^1.8 = 14.5
# After 2 hours: (100-1) / (2+2)^1.8 = 7.1
# After 6 hours: (100-1) / (6+2)^1.8 = 2.4
# After 24 hours: (100-1) / (24+2)^1.8 = 0.3
```

---

## Part 5: Negative Signals

### 5.1 The Power of Negative Feedback

```
OBSERVATION: Negative signals are weighted 5-10x more than positive

Why:
- Positive: User might passively consume without interacting
- Negative: User actively chose to express displeasure
- False positives (showing bad content) hurt retention badly
- False negatives (hiding good content) are less damaging

NEGATIVE SIGNAL WEIGHT ESTIMATES:

TikTok:
- "Not Interested" = -10 likes worth
- Report = -50 likes worth
- Fast skip (<1 sec) = -2 likes worth

Twitter (from open source):
- Mute = -10 impressions worth
- Block = -100 impressions worth
- Report = immediate suppression

Instagram:
- "See fewer posts like this" = -20 likes worth
- "Hide" = -50 likes worth
- Mute = reduces relationship score by 90%
```

### 5.2 Negative Signal Implementation

```python
class NegativeFeedbackHandler:
    """
    How platforms handle negative feedback
    """
    
    def process_not_interested(self, user_id, content_id, content):
        """
        User clicked "Not interested" on content
        """
        # 1. Never show this specific content again
        self.add_to_blocklist(user_id, content_id)
        
        # 2. Reduce similar content
        content_embedding = self.get_embedding(content)
        self.add_negative_preference(user_id, content_embedding, weight=0.3)
        
        # 3. Reduce content from this creator
        self.reduce_creator_affinity(user_id, content.creator_id, factor=0.5)
        
        # 4. Update content's global score
        self.update_content_negative_score(content_id)
        
        # 5. Track for model training
        self.log_negative_feedback(user_id, content_id, 'not_interested')
    
    def process_skip(self, user_id, content_id, dwell_time_ms):
        """
        User scrolled past content quickly
        """
        if dwell_time_ms < 500:  # Less than 0.5 seconds
            # Immediate skip - strong negative signal
            skip_weight = 0.8
        elif dwell_time_ms < 1000:  # Less than 1 second
            # Quick skip - moderate negative signal
            skip_weight = 0.4
        else:
            # Not really a skip
            return
        
        # Slight reduction in similar content preference
        content_embedding = self.get_embedding(content_id)
        self.add_negative_preference(
            user_id, 
            content_embedding, 
            weight=skip_weight * 0.1  # Much weaker than explicit negative
        )
    
    def process_report(self, user_id, content_id, reason):
        """
        User reported content
        """
        # 1. Immediate suppression for this user
        self.add_to_blocklist(user_id, content_id)
        
        # 2. Queue for human review
        self.queue_for_review(content_id, reason)
        
        # 3. If multiple reports, start suppressing globally
        report_count = self.get_report_count(content_id, hours=24)
        if report_count >= 5:
            self.reduce_global_distribution(content_id, factor=0.5)
        if report_count >= 20:
            self.suppress_pending_review(content_id)
```

---

## Part 6: Session-Level Signals

### 6.1 Session Behavior Tracking

```
WHAT HAPPENS AFTER SEEING CONTENT:

Positive Session Signals:
- User stays longer after seeing content
- User searches for related content
- User visits creator's profile
- User views more content in same category
- User returns within 24 hours

Negative Session Signals:
- User closes app immediately after
- User searches for something completely different
- User doesn't return for days
- User session length below average

ATTRIBUTION:
If user views Item A, then Item B, and takes action:
- Primary attribution: Item B (immediate cause)
- Secondary attribution: Item A (context/lead-up)
- Session attribution: Both contributed to session engagement
```

### 6.2 Session Context in Ranking

```python
class SessionContextRanker:
    """
    Use session context to improve ranking
    """
    
    def rank_next_item(self, user, candidates, session_context):
        """
        Rank candidates given current session state
        """
        scored_candidates = []
        
        for candidate in candidates:
            base_score = self.get_base_score(candidate, user)
            
            # CONTEXT ADJUSTMENTS
            
            # 1. Similarity to recently engaged items (positive)
            if session_context.recent_engagements:
                similarity = self.calculate_similarity(
                    candidate,
                    session_context.recent_engagements[-1]
                )
                # Similar but not identical gets boost
                if 0.5 < similarity < 0.9:
                    base_score *= 1 + (similarity * 0.3)
            
            # 2. Diversity from recently shown (avoid fatigue)
            recently_shown_categories = [
                item.category for item in session_context.recent_impressions[-10:]
            ]
            if candidate.category in recently_shown_categories:
                category_count = recently_shown_categories.count(candidate.category)
                base_score *= max(0.5, 1 - (category_count * 0.1))
            
            # 3. Session length adjustment
            session_length = session_context.duration_minutes
            if session_length > 30:
                # Long session - user might be fatigued
                # Show more varied/exciting content
                if candidate.is_novel:
                    base_score *= 1.2
            
            # 4. Time of day patterns
            hour = datetime.now().hour
            if hour in user.peak_activity_hours:
                # User is in "browsing mode" - show more content
                pass
            else:
                # User might be checking briefly - show best content
                base_score *= candidate.quality_score
            
            scored_candidates.append((candidate, base_score))
        
        return sorted(scored_candidates, key=lambda x: -x[1])
```

---

## Part 7: Creator-Side Signals

### 7.1 Creator Quality Signals

```
WHAT PLATFORMS TRACK ABOUT CREATORS:

Content Quality Metrics:
- Average engagement rate across posts
- Consistency of posting
- Content completion rates
- Follower growth rate
- Reply/response rate

Trust Signals:
- Account age
- Verification status
- Policy violation history
- Report frequency on content
- Community guideline strikes

Performance Trajectory:
- Improving, stable, or declining engagement
- Recent viral vs. historical viral
- Category leadership (top N in category)
```

### 7.2 Creator Score Implementation

```python
class CreatorScoring:
    """
    Score creators for content distribution decisions
    """
    
    def calculate_creator_score(self, creator_id):
        creator = self.get_creator(creator_id)
        recent_posts = self.get_recent_posts(creator_id, days=30)
        
        # 1. Engagement consistency
        engagement_rates = [post.engagement_rate for post in recent_posts]
        avg_engagement = sum(engagement_rates) / len(engagement_rates) if engagement_rates else 0
        engagement_variance = statistics.variance(engagement_rates) if len(engagement_rates) > 1 else 0
        consistency_score = avg_engagement / (1 + engagement_variance)
        
        # 2. Posting frequency
        posts_per_week = len(recent_posts) / 4.33  # 30 days ≈ 4.33 weeks
        # Optimal is 3-7 posts per week for most platforms
        if 3 <= posts_per_week <= 7:
            frequency_score = 1.0
        elif posts_per_week < 3:
            frequency_score = posts_per_week / 3
        else:
            frequency_score = 1.0 - ((posts_per_week - 7) * 0.05)  # Slight penalty for over-posting
        
        # 3. Quality trajectory
        first_half = recent_posts[:len(recent_posts)//2]
        second_half = recent_posts[len(recent_posts)//2:]
        
        first_avg = sum(p.engagement_rate for p in first_half) / len(first_half) if first_half else 0
        second_avg = sum(p.engagement_rate for p in second_half) / len(second_half) if second_half else 0
        
        if first_avg > 0:
            trajectory_score = second_avg / first_avg
        else:
            trajectory_score = 1.0
        
        # 4. Trust factors
        trust_score = 1.0
        if creator.violations > 0:
            trust_score -= 0.1 * creator.violations
        if creator.is_verified:
            trust_score += 0.1
        if creator.account_age_days > 365:
            trust_score += 0.05
        
        # 5. Response rate (for marketplace-style platforms)
        if hasattr(creator, 'avg_response_time_hours'):
            if creator.avg_response_time_hours < 1:
                response_score = 1.0
            elif creator.avg_response_time_hours < 4:
                response_score = 0.9
            elif creator.avg_response_time_hours < 24:
                response_score = 0.7
            else:
                response_score = 0.5
        else:
            response_score = 0.8  # Neutral
        
        # Combine scores
        final_score = (
            consistency_score * 0.3 +
            frequency_score * 0.2 +
            min(trajectory_score, 1.5) * 0.2 +  # Cap trajectory boost
            trust_score * 0.2 +
            response_score * 0.1
        )
        
        return max(0.1, min(2.0, final_score))  # Clamp to [0.1, 2.0]
```

---

## Part 8: A/B Testing Observations

### 8.1 How Platforms Test Algorithm Changes

```
NETFLIX TESTING APPROACH:
- 250+ A/B tests running at any time
- Every recommendation change tested
- Primary metric: Retention (hours watched / subscriber churn)
- Test duration: 2-4 weeks typically

FACEBOOK NEWS FEED TESTING:
- "Meaningful Social Interactions" (MSI) as primary metric
- Tests run on 0.1% - 1% of users first
- Scaled to 10%, then 50%, then 100%
- Multiple holdback groups for long-term effects

TIKTOK TESTING:
- Extremely fast iteration (tests can run in hours)
- Primary metric: Session time
- Secondary: Return rate (same day, next day)
- Geographic segmentation for A/B tests

TWITTER TESTING (from open source):
- Experimentation framework called "DDG"
- Tests segmented by user characteristics
- Multiple metrics tracked simultaneously
- "Guardrail" metrics to catch negative effects
```

### 8.2 Metric Hierarchies

```
PRIMARY METRICS (if these go down, kill the test):
- Retention / Return rate
- Session duration
- Core action rate (for the platform's business model)

SECONDARY METRICS (optimize for these):
- Engagement rate (likes, comments, shares)
- Content diversity consumed
- Creator content performance
- Time to first engagement

GUARDRAIL METRICS (don't let these get worse):
- User complaints / reports
- Policy violation rates
- App crashes / errors
- Load times

LONG-TERM METRICS (check after weeks/months):
- User lifetime value
- Creator retention
- Content creation rate
- Revenue per user
```

---

## Part 9: Implications for Nuke Implementation

### 9.1 Priority Signal Tracking

Based on this research, Nuke should track (in order of importance):

```
MUST TRACK (Day 1):
1. Dwell time per content item
2. Scroll speed / skip patterns
3. Clicks (to detail page)
4. Saves
5. Inquiries sent

SHOULD TRACK (Week 1):
6. Content completion (for galleries)
7. Session duration after viewing
8. Return frequency
9. Search queries after viewing
10. Creator profile visits

NICE TO HAVE (Month 1):
11. Time to first interaction
12. Scroll-back behavior
13. Audio engagement (for video)
14. External share destinations
15. Price comparison behavior
```

### 9.2 Recommended Weight Distribution

For Nuke's vehicle marketplace + service discovery:

```python
# Nuke Ranking Weights v1

SIGNAL_WEIGHTS = {
    # Primary signals (60% total)
    'dwell_time': 0.20,         # Time spent looking at content
    'inquiry_sent': 0.20,        # Business conversion signal
    'save': 0.10,                # Intent signal
    'content_completion': 0.10,  # For galleries/videos
    
    # Secondary signals (25% total)
    'click_through': 0.08,       # Interest signal
    'creator_profile_visit': 0.07,  # Trust/discovery signal
    'session_continuation': 0.05,   # Content kept them engaged
    'like': 0.05,                # Weak positive signal
    
    # Quality signals (15% total)
    'image_quality': 0.05,       # Visual appeal
    'description_completeness': 0.04,  # Information quality
    'creator_reputation': 0.04,  # Historical performance
    'freshness': 0.02,           # Recency
}

# Negative signal penalties
PENALTY_WEIGHTS = {
    'fast_skip': -0.05,          # Scrolled past in <1 second
    'not_interested': -0.50,     # Explicit negative feedback
    'report': -1.00,             # Report = heavy suppression
    'no_engagement_after_click': -0.10,  # Clicked but bounced
}
```

### 9.3 Cold Start Signal Handling

```python
# When user has limited history

def cold_start_signal_weighting(user_signals_count):
    """
    Adjust signal weights based on data availability
    """
    if user_signals_count < 10:
        # Very new user - use crowd signals heavily
        return {
            'crowd_popularity': 0.50,
            'geographic_relevance': 0.20,
            'stated_interests': 0.20,
            'random_exploration': 0.10,
        }
    elif user_signals_count < 50:
        # Some data - blend personal and crowd
        return {
            'personal_signals': 0.40,
            'crowd_popularity': 0.30,
            'geographic_relevance': 0.20,
            'random_exploration': 0.10,
        }
    else:
        # Sufficient data - trust personal signals
        return {
            'personal_signals': 0.70,
            'crowd_popularity': 0.15,
            'geographic_relevance': 0.10,
            'random_exploration': 0.05,
        }
```

---

## Appendix: Tracking Implementation Code

### Browser-Side Tracking

```typescript
// Complete tracking implementation

interface TrackingEvent {
  timestamp: number;
  event_type: string;
  content_id: string;
  content_type: string;
  data: Record<string, any>;
}

class EngagementTracker {
  private events: TrackingEvent[] = [];
  private visibilityState: Map<string, VisibilityData> = new Map();
  private scrollSamples: ScrollSample[] = [];
  
  // Track visibility with IntersectionObserver
  observeContent(element: HTMLElement, contentId: string, contentType: string) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const now = Date.now();
        const state = this.visibilityState.get(contentId);
        
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          if (!state) {
            this.visibilityState.set(contentId, {
              firstVisible: now,
              lastVisible: now,
              totalDwell: 0,
              isVisible: true,
              maxRatio: entry.intersectionRatio
            });
            this.trackEvent('impression', contentId, contentType, {
              ratio: entry.intersectionRatio
            });
          } else if (!state.isVisible) {
            state.isVisible = true;
            state.lastVisible = now;
          }
          state.maxRatio = Math.max(state.maxRatio, entry.intersectionRatio);
        } else if (state?.isVisible) {
          state.totalDwell += now - state.lastVisible;
          state.isVisible = false;
          
          if (state.totalDwell < 500) {
            this.trackEvent('fast_skip', contentId, contentType, {
              dwell_ms: state.totalDwell
            });
          }
        }
      });
    }, { threshold: [0, 0.25, 0.5, 0.75, 1.0] });
    
    observer.observe(element);
    return () => observer.disconnect();
  }
  
  // Track scroll velocity
  trackScroll() {
    let lastY = window.scrollY;
    let lastTime = Date.now();
    
    window.addEventListener('scroll', () => {
      const now = Date.now();
      const currentY = window.scrollY;
      const deltaTime = now - lastTime;
      const deltaY = Math.abs(currentY - lastY);
      
      if (deltaTime > 0) {
        const velocity = deltaY / deltaTime * 1000; // px/second
        this.scrollSamples.push({ time: now, velocity });
        
        // Keep last 50 samples
        if (this.scrollSamples.length > 50) {
          this.scrollSamples.shift();
        }
      }
      
      lastY = currentY;
      lastTime = now;
    }, { passive: true });
  }
  
  getScrollVelocityForContent(contentId: string): number {
    const state = this.visibilityState.get(contentId);
    if (!state) return 0;
    
    const samples = this.scrollSamples.filter(
      s => s.time >= state.firstVisible && s.time <= (state.lastVisible || Date.now())
    );
    
    if (samples.length === 0) return 0;
    return samples.reduce((sum, s) => sum + s.velocity, 0) / samples.length;
  }
  
  // Track engagement actions
  trackClick(contentId: string, contentType: string) {
    const state = this.visibilityState.get(contentId);
    this.trackEvent('click', contentId, contentType, {
      dwell_before_click: state?.totalDwell || 0,
      time_to_click: state ? Date.now() - state.firstVisible : 0
    });
  }
  
  trackSave(contentId: string, contentType: string) {
    this.trackEvent('save', contentId, contentType, {});
  }
  
  trackInquiry(contentId: string, contentType: string, inquiryType: string) {
    this.trackEvent('inquiry', contentId, contentType, {
      inquiry_type: inquiryType
    });
  }
  
  // Flush events to server
  async flush() {
    if (this.events.length === 0) return;
    
    // Add final dwell times for visible content
    for (const [contentId, state] of this.visibilityState) {
      if (state.isVisible) {
        state.totalDwell += Date.now() - state.lastVisible;
        state.isVisible = false;
      }
      
      this.trackEvent('dwell_final', contentId, 'content', {
        total_dwell_ms: state.totalDwell,
        scroll_velocity: this.getScrollVelocityForContent(contentId)
      });
    }
    
    const events = [...this.events];
    this.events = [];
    
    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events })
    });
  }
  
  private trackEvent(type: string, contentId: string, contentType: string, data: any) {
    this.events.push({
      timestamp: Date.now(),
      event_type: type,
      content_id: contentId,
      content_type: contentType,
      data
    });
  }
}

interface VisibilityData {
  firstVisible: number;
  lastVisible: number;
  totalDwell: number;
  isVisible: boolean;
  maxRatio: number;
}

interface ScrollSample {
  time: number;
  velocity: number;
}
```
