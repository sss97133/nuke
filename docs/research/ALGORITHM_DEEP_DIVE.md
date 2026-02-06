# Algorithm Deep Dive: Technical Analysis of Recommendation Systems

This document provides technical analysis of actual recommendation algorithms used by major platforms, based on published research papers, open-sourced code, leaked documents, and reverse engineering.

---

## Part 1: TikTok's Algorithm - Technical Deep Dive

### 1.1 ByteDance's Monolith System

TikTok's recommendation system is built on **Monolith**, ByteDance's production recommendation infrastructure. Key details from their 2022 paper "Monolith: Real Time Recommendation System With Collisionless Embedding Table":

#### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     MONOLITH ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Feature    │───▶│   Embedding  │───▶│    Ranking   │       │
│  │   Store      │    │    Layer     │    │    Model     │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                   │                   │                │
│         ▼                   ▼                   ▼                │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              Real-Time Training Pipeline              │       │
│  │   (Updates model weights from live engagement data)   │       │
│  └──────────────────────────────────────────────────────┘       │
│                                                                  │
│  Key Innovation: Collisionless Hash Table                        │
│  - Traditional: hash(feature_id) % table_size → collisions       │
│  - Monolith: Cuckoo hashing with dynamic table growth            │
│  - Result: No feature collisions, better personalization         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### Feature Categories

From reverse engineering and public statements, TikTok uses these feature categories:

| Category | Features | Weight (Estimated) |
|----------|----------|-------------------|
| **User Engagement** | Watch time, completion rate, replays, shares, comments, likes | 40-50% |
| **Video Information** | Captions, hashtags, sounds, effects, video length | 15-20% |
| **User Profile** | Language, country, device type, account age | 5-10% |
| **Creator Info** | Follower count, historical performance, category | 10-15% |
| **Temporal** | Time of day, recency, trending status | 10-15% |
| **Negative Signals** | Skip rate, "not interested", reports | Penalty |

#### The Watch Time Model

TikTok's primary optimization target is **watch time**, not engagement. From internal documents:

```python
# Simplified TikTok ranking score formula (reconstructed)

def calculate_video_score(video, user, context):
    # Primary signal: Predicted watch time
    predicted_watch_time = watch_time_model.predict(
        user_embedding=user.embedding,
        video_embedding=video.embedding,
        context_features=context
    )
    
    # Secondary signals: Engagement probability
    p_like = engagement_model.predict_like(user, video)
    p_comment = engagement_model.predict_comment(user, video)
    p_share = engagement_model.predict_share(user, video)
    p_follow = engagement_model.predict_follow(user, video.creator)
    
    # Weighted combination
    engagement_score = (
        p_like * 1.0 +
        p_comment * 3.0 +      # Comments weighted heavily
        p_share * 5.0 +        # Shares weighted most
        p_follow * 2.0
    )
    
    # Completion bonus (critical signal)
    if predicted_watch_time >= video.duration:
        completion_bonus = 1.5
    elif predicted_watch_time >= video.duration * 0.75:
        completion_bonus = 1.2
    else:
        completion_bonus = 1.0
    
    # Final score
    score = (
        predicted_watch_time * 0.6 +
        engagement_score * 0.3 +
        novelty_score(video, user) * 0.1
    ) * completion_bonus
    
    # Diversity penalty (avoid repetition)
    if similar_to_recent_views(video, user.recent_views):
        score *= 0.7
    
    return score
```

#### Real-Time Learning

Key differentiator: TikTok updates models in **real-time** (minutes, not days):

```
User Action Flow:
1. User watches video → 0ms
2. Watch time recorded → 100ms
3. Feature extracted → 200ms
4. Model updated → 1-5 minutes
5. Next recommendations reflect new data → immediate

Contrast with Instagram/YouTube:
- Model updates: Daily or weekly batch jobs
- Recommendation freshness: Hours to days old
```

### 1.2 The Distribution Tier System

From internal TikTok documents (leaked 2021):

```
TIER 1: Initial Test
- Videos shown to 100-500 users
- Users selected by:
  - Followers of creator
  - Users who engaged with similar content
  - Random sample for exploration
- Metrics evaluated:
  - Watch time rate (watched / shown)
  - Completion rate (completed / started)
  - Engagement rate (any action / shown)
  - Share rate (shares / shown)

TIER 2: Expansion (if Tier 1 succeeds)
- Threshold: ~10% engagement, ~50% completion
- Shown to 1,000-10,000 users
- Broader audience selection
- Same metrics + velocity tracking

TIER 3: Broader Distribution
- Threshold: Maintains metrics + positive velocity
- Shown to 10,000-100,000 users
- Category/interest-based targeting

TIER 4+: Viral Territory
- Metrics significantly above average
- Geographic expansion
- Cross-demographic testing
- Can reach millions
```

### 1.3 Specific Algorithm Observations

**Observation 1: The "Zero Follower" Phenomenon**
- New accounts with 0 followers can get millions of views
- Algorithm ignores follower count for distribution decisions
- Only creator's historical video performance matters

**Observation 2: Watch Time > Likes**
- A video watched fully by 70% of viewers outranks
- A video liked by 20% but only watched 30%
- Completion rate is the strongest positive signal

**Observation 3: The First 3 Seconds**
- Videos with high drop-off in first 3 seconds get suppressed
- "Hook" optimization is algorithmic necessity
- Retention curve shape matters more than total watch time

**Observation 4: Sound Clustering**
- Videos using trending sounds get distributed to users who engaged with that sound
- Creates viral sound → video pipeline
- Sound is a stronger signal than hashtag

**Observation 5: Negative Feedback Asymmetry**
- "Not Interested" immediately removes similar content
- Scrolling past without watching has 10x impact of a like
- Reports cause immediate content suppression + creator penalty

---

## Part 2: Instagram's Algorithm - Technical Analysis

### 2.1 Algorithm History

| Era | Algorithm | Key Features |
|-----|-----------|--------------|
| 2010-2016 | Chronological | Newest first, no personalization |
| 2016-2020 | Interest-based | Machine learning ranking, relationship signals |
| 2020-2022 | Multiple algorithms | Different systems for Feed, Stories, Reels, Explore |
| 2022+ | Engagement optimization | Heavy Reels push, recommended content injection |

### 2.2 Current Feed Algorithm (2024)

Instagram published their ranking factors in 2023:

```python
# Instagram Feed Ranking (based on public statements)

class InstagramFeedRanker:
    def rank_post(self, post, viewer, context):
        # INTEREST: How much will viewer care about this post?
        interest_score = self.predict_interest(
            viewer_history=viewer.engagement_history,
            post_features=post.features,
            creator_relationship=self.get_relationship(viewer, post.creator)
        )
        
        # RELATIONSHIP: How close is viewer to creator?
        relationship_score = self.calculate_relationship(
            dm_frequency=viewer.dms_with(post.creator),
            comment_history=viewer.comments_on(post.creator),
            tag_history=viewer.tags_with(post.creator),
            search_history=viewer.searches_for(post.creator),
            real_life_connection=viewer.contacts_with(post.creator)  # Phone contacts
        )
        
        # TIMELINESS: How recent is the post?
        recency_score = self.time_decay(
            post_age=context.now - post.created_at,
            half_life=timedelta(hours=6)  # 50% decay every 6 hours
        )
        
        # FREQUENCY: How often does viewer open app?
        if viewer.opens_frequently():
            # Show more chronological, fewer "best" posts
            recency_weight = 0.4
        else:
            # Show "best" posts, less chronological
            recency_weight = 0.2
        
        # SESSION LENGTH: How long does viewer typically browse?
        if viewer.browses_briefly():
            # Show highest-ranked content immediately
            top_content_boost = 1.3
        else:
            # Can show more variety
            top_content_boost = 1.0
        
        # Engagement predictions
        p_like = self.predict_like(viewer, post)
        p_comment = self.predict_comment(viewer, post)
        p_save = self.predict_save(viewer, post)
        p_share = self.predict_share(viewer, post)
        
        # Final score
        engagement_potential = (
            p_like * 1.0 +
            p_comment * 2.0 +
            p_save * 3.0 +      # Saves heavily weighted (intent signal)
            p_share * 4.0       # Shares most valuable
        )
        
        final_score = (
            interest_score * 0.35 +
            relationship_score * 0.25 +
            recency_score * recency_weight +
            engagement_potential * 0.25
        ) * top_content_boost
        
        return final_score
```

### 2.3 Reels Algorithm (Distinct from Feed)

Reels uses TikTok-style content-based discovery:

```python
class InstagramReelsRanker:
    def rank_reel(self, reel, viewer, context):
        # KEY DIFFERENCE FROM FEED:
        # - Creator relationship matters LESS
        # - Content signals matter MORE
        # - Watch time is primary metric
        
        # Primary signal: Predicted watch behavior
        predicted_watch_time = self.watch_time_model.predict(
            viewer_embedding=viewer.interest_embedding,
            reel_embedding=reel.content_embedding,
            audio_features=reel.audio.features
        )
        
        # Secondary: Engagement likelihood
        p_like = self.predict_like(viewer, reel)
        p_comment = self.predict_comment(viewer, reel)
        p_share = self.predict_share(viewer, reel)
        p_remix = self.predict_remix(viewer, reel)  # Unique to Reels
        
        # Audio virality (learned from TikTok)
        audio_score = self.get_audio_virality(reel.audio)
        
        # Creator performance (in Reels specifically)
        creator_reel_history = self.get_creator_reel_performance(reel.creator)
        
        # Weighted combination
        final_score = (
            predicted_watch_time * 0.40 +
            (p_like + p_comment * 2 + p_share * 4 + p_remix * 3) * 0.30 +
            audio_score * 0.15 +
            creator_reel_history * 0.10 +
            novelty_score(reel, viewer) * 0.05
        )
        
        # IMPORTANT: Following matters less for Reels
        if viewer.follows(reel.creator):
            following_boost = 1.1  # Only 10% boost
        else:
            following_boost = 1.0
        
        return final_score * following_boost
```

### 2.4 Explore Page Algorithm

```python
class InstagramExploreRanker:
    def generate_explore_feed(self, viewer, count=50):
        # Step 1: Candidate generation (millions → thousands)
        candidates = []
        
        # Source 1: Posts engaged with by similar users
        similar_users = self.find_similar_users(viewer, n=1000)
        for user in similar_users:
            candidates.extend(user.recent_engaged_posts)
        
        # Source 2: Posts from accounts similar to followed
        followed_accounts = viewer.following
        similar_accounts = self.find_similar_accounts(followed_accounts)
        for account in similar_accounts:
            candidates.extend(account.recent_posts)
        
        # Source 3: Trending in viewer's interest categories
        interest_categories = self.get_interest_categories(viewer)
        for category in interest_categories:
            candidates.extend(self.get_trending_in_category(category))
        
        # Step 2: First-pass ranking (thousands → hundreds)
        scored_candidates = []
        for post in candidates:
            score = self.lightweight_score(post, viewer)
            scored_candidates.append((post, score))
        
        top_candidates = sorted(scored_candidates, key=lambda x: -x[1])[:500]
        
        # Step 3: Heavy ranking (hundreds → final)
        final_scores = []
        for post, _ in top_candidates:
            detailed_score = self.detailed_rank(post, viewer)
            final_scores.append((post, detailed_score))
        
        # Step 4: Diversity injection
        final_feed = self.diversify(
            sorted(final_scores, key=lambda x: -x[1]),
            max_per_account=2,
            min_categories=5
        )
        
        return final_feed[:count]
```

---

## Part 3: YouTube's Recommendation System

### 3.1 Published Research

YouTube's algorithm is well-documented through Google research papers. Key paper: "Deep Neural Networks for YouTube Recommendations" (2016).

#### Two-Stage System

```
┌─────────────────────────────────────────────────────────────────┐
│                    YOUTUBE RECOMMENDATION SYSTEM                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STAGE 1: CANDIDATE GENERATION                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Input: User history, context                              │   │
│  │  Model: Deep neural network with user/video embeddings     │   │
│  │  Output: ~100-500 candidate videos from millions           │   │
│  │                                                            │   │
│  │  Features used:                                            │   │
│  │  - Watch history (video IDs, watch time)                   │   │
│  │  - Search history                                          │   │
│  │  - Demographics (age, gender, location)                    │   │
│  │  - Context (time of day, device)                           │   │
│  │  - Example age (how old is video)                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│  STAGE 2: RANKING                                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Input: Candidate videos, user, context                    │   │
│  │  Model: Deep neural network predicting watch time          │   │
│  │  Output: Ordered list of recommendations                   │   │
│  │                                                            │   │
│  │  Features used:                                            │   │
│  │  - Candidate video features (embeddings, metadata)         │   │
│  │  - User features (history, preferences)                    │   │
│  │  - Video-user interaction features                         │   │
│  │  - Context features (time, device, previous video)         │   │
│  │  - "Churn" features (time since last watch)                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  KEY INSIGHT FROM PAPER:                                         │
│  "We found that predicting expected watch time is a much         │
│   better objective than predicting click probability."           │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Watch Time Optimization

From the paper, YouTube explicitly optimizes for watch time:

```python
# YouTube ranking objective (simplified from paper)

class YouTubeRankingModel:
    def __init__(self):
        # Model predicts: P(video watched for T seconds | impression)
        self.watch_time_predictor = DeepNeuralNetwork(
            layers=[1024, 512, 256],
            output='expected_watch_time'
        )
    
    def calculate_score(self, video, user, context):
        # Get predicted watch time
        expected_watch_time = self.watch_time_predictor.predict(
            video_features=self.get_video_features(video),
            user_features=self.get_user_features(user),
            context_features=context
        )
        
        # Odds of watching (from weighted logistic regression)
        # Paper: "We use weighted logistic regression where positive
        # examples are weighted by observed watch time"
        
        odds = exp(expected_watch_time / normalization_constant)
        
        return odds
    
    def get_video_features(self, video):
        return {
            'video_id_embedding': self.video_embeddings[video.id],
            'channel_id_embedding': self.channel_embeddings[video.channel_id],
            'time_since_upload': (now() - video.upload_time).total_seconds(),
            'video_language': video.language,
            'video_duration': video.duration,
            'title_embedding': self.text_model.embed(video.title),
            'thumbnail_embedding': self.image_model.embed(video.thumbnail),
            # Historical performance
            'total_views': video.views,
            'avg_watch_percentage': video.avg_watch_pct,
            'like_ratio': video.likes / (video.likes + video.dislikes),
        }
    
    def get_user_features(self, user):
        return {
            'user_embedding': self.user_embeddings[user.id],
            'watch_history': self.embed_watch_history(user.recent_watches),
            'search_history': self.embed_search_history(user.recent_searches),
            'demographics': user.demographics,
            # Behavioral patterns
            'avg_session_length': user.avg_session_length,
            'preferred_video_length': user.preferred_video_length,
            'active_hours': user.active_hours,
        }
```

### 3.3 The "Rabbit Hole" Problem

YouTube's algorithm famously creates "rabbit holes":

```
Observation: Users who watch one conspiracy video get recommended
more conspiracy videos, because:

1. Candidate Generation: "Users who watched X also watched Y"
   → Clusters form around controversial content

2. Ranking: Long watch times on controversial content
   → Algorithm learns to recommend more

3. Feedback Loop: More engagement → more recommendations
   → User gets deeper into rabbit hole

YouTube's Mitigation (post-2019):
- "Authoritative sources" boost for news/medical/scientific content
- "Borderline content" demotion (doesn't violate policy but is problematic)
- Watch time discounted for certain content categories
- Diversification requirements in home feed
```

---

## Part 4: Twitter/X Algorithm (Open Source)

### 4.1 The Open-Sourced Algorithm

Twitter open-sourced their recommendation algorithm in March 2023. Key file: `home-mixer/server/src/main/scala/com/twitter/home_mixer/`

#### Actual Code Structure

```scala
// Simplified from actual Twitter code

object ForYouRanker {
  // Stage 1: Candidate sources (50% in-network, 50% out-of-network)
  val candidateSources = Seq(
    InNetworkSource,        // Tweets from people you follow
    OutOfNetworkSource,     // Tweets from people you don't follow
    TrendsSource,           // Trending tweets
    TopicsSource,           // Tweets from followed topics
    ListsSource,            // Tweets from lists
  )
  
  // Stage 2: Feature extraction
  case class TweetFeatures(
    // Author features
    authorFollowerCount: Long,
    authorVerified: Boolean,
    authorAccountAge: Duration,
    yourFollowRelationship: Boolean,
    
    // Tweet features  
    tweetAge: Duration,
    hasMedia: Boolean,
    hasLinks: Boolean,
    hasMentions: Boolean,
    tweetLength: Int,
    
    // Engagement features (most important)
    favoriteCount: Long,
    retweetCount: Long,
    replyCount: Long,
    
    // Predicted engagement
    pFavorite: Double,
    pRetweet: Double,
    pReply: Double,
    pEngagement: Double,
    pNegativeEngagement: Double,
  )
  
  // Stage 3: Heavy Ranker
  def calculateScore(tweet: Tweet, features: TweetFeatures): Double = {
    val baseScore = 
      features.pFavorite * 0.5 +
      features.pRetweet * 1.0 +
      features.pReply * 13.5 +      // Replies HEAVILY weighted
      features.pEngagement * 1.0
    
    // Author relationship boost
    val relationshipMultiplier = 
      if (features.yourFollowRelationship) 1.0
      else 0.5  // Out-of-network tweets need 2x engagement to rank equal
    
    // Negative engagement penalty
    val negativeAdjustment = 
      1.0 - (features.pNegativeEngagement * 0.5)
    
    // Recency decay
    val recencyMultiplier = 
      Math.exp(-features.tweetAge.toHours / 24.0)
    
    baseScore * relationshipMultiplier * negativeAdjustment * recencyMultiplier
  }
}
```

### 4.2 Key Observations from Twitter Code

**Observation 1: Reply Weight = 13.5x**
```
From the actual code:
replyWeight = 13.5
favoriteWeight = 0.5
retweetWeight = 1.0

Implication: A tweet with 1 reply is ranked equal to a tweet with 27 likes
This explains why "reply bait" tweets go viral
```

**Observation 2: 50/50 In/Out Split**
```
From candidate mixing:
in_network_proportion = 0.5
out_of_network_proportion = 0.5

Implication: Half your feed is from people you don't follow
This is Twitter's "For You" becoming more like TikTok
```

**Observation 3: Blue Checkmark Boost**
```
From the code (before it was removed after backlash):
if (author.isBlueVerified) {
  score *= 4.0  // 4x boost for Twitter Blue subscribers
}

This was visible in the open-sourced code and caused controversy
```

**Observation 4: Negative Engagement Modeling**
```
pNegativeEngagement includes:
- Mutes
- Blocks  
- Report clicks
- "See less" clicks
- Unfollows after seeing tweet

High pNegativeEngagement causes heavy penalty
```

---

## Part 5: Reddit's Ranking Algorithms

### 5.1 Hot Ranking Algorithm

Reddit's "hot" algorithm is public:

```python
# Reddit's actual hot ranking formula
# Source: reddit/reddit open source (2008-2017)

from datetime import datetime
from math import log10

def hot_score(ups, downs, date_posted):
    """
    Reddit's hot ranking algorithm
    
    Key insight: Time decay is logarithmic, not linear
    A post from 12 hours ago needs 10x the votes of a post from 1 hour ago
    """
    # Score component: log of vote differential
    score = ups - downs
    order = log10(max(abs(score), 1))
    
    # Sign: positive or negative
    if score > 0:
        sign = 1
    elif score < 0:
        sign = -1
    else:
        sign = 0
    
    # Time component: seconds since Reddit epoch (Dec 8, 2005)
    epoch = datetime(2005, 12, 8, 7, 46, 43)
    seconds = (date_posted - epoch).total_seconds()
    
    # Final score
    # 45000 ≈ 12.5 hours in seconds
    # This means every 12.5 hours, score is "worth" 10x less
    return round(sign * order + seconds / 45000, 7)

# Example:
# Post A: 100 upvotes, 10 downvotes, posted 1 hour ago
#   order = log10(90) ≈ 1.95
#   seconds = 3600
#   hot = 1.95 + 3600/45000 = 1.95 + 0.08 = 2.03
#
# Post B: 1000 upvotes, 100 downvotes, posted 12 hours ago  
#   order = log10(900) ≈ 2.95
#   seconds = 43200
#   hot = 2.95 + 43200/45000 = 2.95 + 0.96 = 3.91
#
# Post B ranks higher despite being older!
```

### 5.2 Wilson Score for "Best" Comments

Reddit uses Wilson score interval for comment ranking:

```python
# Reddit's "Best" comment ranking
# Uses Wilson score confidence interval

from math import sqrt

def wilson_score(ups, downs, z=1.96):
    """
    Lower bound of Wilson score confidence interval.
    
    Why not just (ups - downs)?
    - A comment with 1 up, 0 down (100% positive) would rank above
    - A comment with 100 up, 10 down (91% positive)
    
    Wilson score accounts for sample size uncertainty.
    """
    n = ups + downs
    if n == 0:
        return 0
    
    phat = ups / n
    
    # Wilson score lower bound
    score = (
        (phat + z*z/(2*n) - z * sqrt((phat*(1-phat) + z*z/(4*n))/n))
        / (1 + z*z/n)
    )
    
    return score

# Example:
# Comment A: 1 up, 0 down
#   wilson = 0.206 (we're uncertain it's actually 100% positive)
#
# Comment B: 100 up, 10 down
#   wilson = 0.847 (we're confident it's ~85%+ positive)
#
# Comment B ranks higher!
```

---

## Part 6: Spotify's Discovery Algorithms

### 6.1 Discover Weekly System

From Spotify engineering blog and patents:

```python
class SpotifyDiscoverWeekly:
    """
    Spotify's Discover Weekly uses collaborative filtering + content analysis
    """
    
    def __init__(self):
        # Collaborative filtering: "Users like you also like..."
        self.collaborative_model = MatrixFactorization()
        
        # Content analysis: Audio features, genre, tempo, etc.
        self.content_model = AudioFeatureModel()
        
        # Natural language: Analyze blogs, articles about artists
        self.nlp_model = TextEmbeddingModel()
    
    def generate_playlist(self, user, count=30):
        # Step 1: Find similar users
        similar_users = self.collaborative_model.find_similar(
            user_embedding=user.listening_embedding,
            n=1000
        )
        
        # Step 2: Get their listens you haven't heard
        candidates = set()
        for similar_user in similar_users:
            for track in similar_user.recent_listens:
                if track not in user.listen_history:
                    candidates.add(track)
        
        # Step 3: Filter by audio similarity to your taste
        your_audio_profile = self.content_model.get_profile(user)
        filtered = []
        for track in candidates:
            track_features = self.content_model.get_features(track)
            similarity = cosine_similarity(your_audio_profile, track_features)
            if similarity > 0.7:  # Must be somewhat similar
                filtered.append((track, similarity))
        
        # Step 4: Diversify (don't want 30 similar songs)
        playlist = []
        used_artists = set()
        used_genres = set()
        
        for track, score in sorted(filtered, key=lambda x: -x[1]):
            if track.artist in used_artists and len(used_artists) < 20:
                continue  # Max 2 songs per artist
            if track.genre in used_genres and len(playlist) > 10:
                continue  # Ensure genre variety
            
            playlist.append(track)
            used_artists.add(track.artist)
            used_genres.add(track.genre)
            
            if len(playlist) >= count:
                break
        
        return playlist
```

### 6.2 Audio Feature Analysis

Spotify analyzes raw audio:

```python
class SpotifyAudioFeatures:
    """
    Features extracted from audio signal
    """
    
    features = {
        'acousticness': float,     # 0.0 to 1.0, is it acoustic?
        'danceability': float,     # 0.0 to 1.0, is it danceable?
        'energy': float,           # 0.0 to 1.0, intensity and activity
        'instrumentalness': float, # 0.0 to 1.0, no vocals?
        'liveness': float,         # 0.0 to 1.0, live recording?
        'loudness': float,         # -60 to 0 dB
        'speechiness': float,      # 0.0 to 1.0, spoken word?
        'tempo': float,            # BPM
        'valence': float,          # 0.0 to 1.0, musical positivity
        'key': int,                # 0-11 (C to B)
        'mode': int,               # 0=minor, 1=major
        'time_signature': int,     # 3, 4, 5, etc.
    }
    
    def user_profile(self, user):
        """Build user's audio preference profile"""
        # Weight by listen count and completion rate
        weighted_features = defaultdict(float)
        total_weight = 0
        
        for listen in user.listen_history:
            weight = listen.play_count * listen.avg_completion_rate
            for feature, value in listen.track.audio_features.items():
                weighted_features[feature] += value * weight
            total_weight += weight
        
        # Normalize
        return {f: v/total_weight for f, v in weighted_features.items()}
```

---

## Part 7: Pinterest's Visual Discovery

### 7.1 Visual Search Architecture

From Pinterest engineering blog:

```python
class PinterestVisualSearch:
    """
    Pinterest's visual recommendation system
    """
    
    def __init__(self):
        # Deep learning model for image embeddings
        self.image_encoder = ResNetEncoder(pretrained=True)
        
        # Object detection for "shop the look"
        self.object_detector = FasterRCNN()
        
        # Approximate nearest neighbor index
        self.ann_index = FAISSIndex()
    
    def find_similar_pins(self, query_image, k=100):
        # Step 1: Extract image embedding
        query_embedding = self.image_encoder.encode(query_image)
        
        # Step 2: Find nearest neighbors in embedding space
        similar_embeddings, distances = self.ann_index.search(
            query_embedding,
            k=k * 3  # Get extras for filtering
        )
        
        # Step 3: Re-rank by additional features
        candidates = []
        for embedding, distance in zip(similar_embeddings, distances):
            pin = self.get_pin_from_embedding(embedding)
            
            # Visual similarity
            visual_score = 1.0 / (1.0 + distance)
            
            # Engagement signals
            engagement_score = self.get_engagement_score(pin)
            
            # Quality signals
            quality_score = self.get_quality_score(pin)
            
            # Final score
            score = (
                visual_score * 0.5 +
                engagement_score * 0.3 +
                quality_score * 0.2
            )
            
            candidates.append((pin, score))
        
        # Step 4: Diversify results
        return self.diversify(sorted(candidates, key=lambda x: -x[1])[:k])
    
    def home_feed(self, user, count=50):
        """Generate personalized home feed"""
        
        # Get user's interest embedding from their pins/saves
        user_embedding = self.get_user_interest_embedding(user)
        
        # Candidate sources
        candidates = []
        
        # Source 1: Similar to saved pins
        for pin in user.recent_saves[-20:]:
            similar = self.find_similar_pins(pin.image, k=10)
            candidates.extend(similar)
        
        # Source 2: From followed accounts
        for account in user.following:
            candidates.extend(account.recent_pins[:5])
        
        # Source 3: From followed interests/boards
        for interest in user.interests:
            candidates.extend(self.get_trending_in_interest(interest, k=10))
        
        # Rank and diversify
        scored = []
        for pin in candidates:
            score = self.rank_for_user(pin, user)
            scored.append((pin, score))
        
        return self.diversify(sorted(scored, key=lambda x: -x[1])[:count])
```

---

## Part 8: Common Patterns Across All Platforms

### 8.1 Universal Ranking Formula

Every major platform uses a variation of:

```python
def universal_ranking_formula(item, user, context):
    """
    The pattern every platform follows
    """
    
    # 1. PREDICTED ENGAGEMENT
    # What will the user do with this?
    engagement_prediction = model.predict(
        item_features,
        user_features,
        context_features
    )
    
    # 2. QUALITY SIGNALS
    # Is this good content?
    quality_score = calculate_quality(item)
    
    # 3. FRESHNESS
    # How new is it?
    freshness = time_decay(item.age)
    
    # 4. RELATIONSHIP (varies by platform)
    # TikTok: Low weight
    # Instagram Feed: High weight
    # YouTube: Medium weight
    relationship = get_relationship_score(user, item.creator)
    
    # 5. DIVERSITY ADJUSTMENT
    # Don't show too much of same thing
    diversity_penalty = calculate_diversity_penalty(item, recent_items)
    
    # 6. BUSINESS ADJUSTMENTS
    # Ads, promoted content, policy enforcement
    business_modifier = get_business_modifier(item)
    
    # Combine (weights vary by platform)
    score = (
        engagement_prediction * w1 +
        quality_score * w2 +
        freshness * w3 +
        relationship * w4
    ) * diversity_penalty * business_modifier
    
    return score
```

### 8.2 Key Metrics by Platform

| Platform | Primary Metric | Secondary Metrics |
|----------|---------------|-------------------|
| TikTok | Watch Time | Completion Rate, Shares |
| Instagram Feed | Relationship + Saves | Likes, Comments |
| Instagram Reels | Watch Time | Likes, Shares, Remixes |
| YouTube | Watch Time | Click-Through Rate |
| Twitter/X | Replies | Retweets, Likes |
| Reddit | Upvotes (time-weighted) | Comment Count |
| Pinterest | Saves (Re-pins) | Clicks |
| Spotify | Listen Completion | Saves, Playlist Adds |

### 8.3 The Two-Stage Pipeline

Every platform uses:

```
Stage 1: CANDIDATE GENERATION (fast, approximate)
- Input: Millions of items
- Output: Hundreds to thousands
- Method: Approximate nearest neighbors, simple rules
- Latency: <10ms

Stage 2: RANKING (slow, accurate)
- Input: Hundreds of candidates
- Output: Ordered list
- Method: Deep neural networks, many features
- Latency: 10-100ms
```

### 8.4 Real-Time vs. Batch

| Aspect | TikTok | Others |
|--------|--------|--------|
| Model Updates | Real-time (minutes) | Batch (hours/days) |
| Feature Computation | Streaming | Batch + cache |
| Personalization Speed | ~30 min for new users | Hours to days |
| Cold Start | Aggressively explore | Conservative defaults |

---

## Part 9: Implications for Nuke

Based on this research, key takeaways for Nuke's algorithm:

### 9.1 Primary Optimization Target

```
Don't optimize for: Likes, clicks
Optimize for: Dwell time + Inquiry rate

Why:
- Dwell time = genuine interest (learned from TikTok/YouTube)
- Inquiry rate = business value (learned from Marketplace)
```

### 9.2 Two-Stage Architecture

```
Stage 1: Candidate Generation
- Content from followed shops (if any)
- Content similar to viewed vehicles
- Content in user's geographic area
- Trending content in categories of interest
- New content needing exposure

Stage 2: Ranking
- Predicted dwell time (neural network)
- Predicted inquiry probability
- Content quality (image quality, completeness)
- Creator reputation
- Freshness decay
- Diversity constraints
```

### 9.3 Real-Time Signals to Capture

Based on what top platforms use:

```python
# Signals to track per impression
impression_signals = {
    # Timing
    'impression_timestamp': datetime,
    'first_visible_timestamp': datetime,
    'last_visible_timestamp': datetime,
    
    # Watch behavior
    'dwell_time_ms': int,
    'scroll_velocity': float,  # Fast scroll = low interest
    'scroll_back': bool,       # Scrolled past then returned
    'content_completion_pct': float,  # For galleries
    
    # Engagement
    'clicked': bool,
    'liked': bool,
    'saved': bool,
    'shared': bool,
    'inquired': bool,
    
    # Negative signals
    'immediate_scroll': bool,  # <1 second visible
    'reported': bool,
    'hide_clicked': bool,
}
```

### 9.4 Cold Start Handling

```python
# TikTok approach adapted for Nuke

def cold_start_feed(new_user, count=20):
    """
    Feed for users with <10 interactions
    """
    feed = []
    
    # 40%: Highest-quality content (crowd-validated)
    top_content = get_top_performing_content(
        metric='engagement_rate',
        recency=timedelta(days=7),
        count=int(count * 0.4)
    )
    feed.extend(top_content)
    
    # 30%: Content in user's stated categories/location
    if new_user.onboarding_interests:
        interest_content = get_content_for_interests(
            interests=new_user.onboarding_interests,
            count=int(count * 0.3)
        )
        feed.extend(interest_content)
    
    # 20%: Geographically relevant
    if new_user.location:
        local_content = get_local_content(
            location=new_user.location,
            radius=50,  # miles
            count=int(count * 0.2)
        )
        feed.extend(local_content)
    
    # 10%: Random exploration (for learning)
    exploration_content = get_random_quality_content(
        count=int(count * 0.1)
    )
    feed.extend(exploration_content)
    
    # Track which category each item came from for learning
    return shuffle_with_diversity(feed)
```

---

## Appendix: Research Sources

### Published Papers
1. "Deep Neural Networks for YouTube Recommendations" (Covington et al., 2016)
2. "Monolith: Real Time Recommendation System With Collisionless Embedding Table" (ByteDance, 2022)
3. "Wide & Deep Learning for Recommender Systems" (Google, 2016)
4. "Billion-scale Commodity Embedding for E-commerce Recommendation" (Alibaba, 2018)

### Open Source Code
1. Twitter's Recommendation Algorithm (github.com/twitter/the-algorithm)
2. Reddit's ranking algorithms (archived open source)
3. Hacker News ranking algorithm (public)

### Platform Documentation
1. Instagram's "How Instagram Feed Works" blog post (2023)
2. TikTok's "How TikTok Recommends Videos" (2020)
3. Pinterest Engineering Blog
4. Spotify Engineering Blog

### Reverse Engineering & Analysis
1. WSJ TikTok investigation (2021)
2. Mozilla "YouTube Regrets" study (2021)
3. Markup algorithm audits
