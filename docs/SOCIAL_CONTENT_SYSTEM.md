# Social Content Distribution System

## Vision

Capture work → AI curates → Auto-distribute → Engage audience

The human creates by doing. The system observes, transforms, and distributes. No extra effort required from the creator.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                      CONTENT CAPTURE LAYER                          │
├─────────────────────────────────────────────────────────────────────┤
│  Sources:                                                           │
│  • Coding sessions (insights, breakthroughs)                        │
│  • Vehicle builds (progress photos, milestones)                     │
│  • Conversations (notable exchanges)                                │
│  • Manual capture (quick thoughts)                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      AI CURATION LAYER                              │
├─────────────────────────────────────────────────────────────────────┤
│  curate-for-x:                                                      │
│  • Transform raw content → platform-optimized                       │
│  • Hook generation (attention-grabbing first line)                  │
│  • Thread splitting (for longer content)                            │
│  • Hashtag selection (relevant, not spammy)                         │
│  • Image selection (best from set)                                  │
│  • Tone matching (on-brand voice)                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      DISTRIBUTION LAYER                             │
├─────────────────────────────────────────────────────────────────────┤
│  Platforms:                    Scheduling:                          │
│  • X (Twitter)                 • Optimal time detection             │
│  • Instagram                   • Rate limiting                      │
│  • Threads                     • Queue management                   │
│  • LinkedIn                    • Multi-account support              │
│  • YouTube (future)                                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ENGAGEMENT LAYER                               │
├─────────────────────────────────────────────────────────────────────┤
│  x-mention-monitor:            x-engagement-responder:              │
│  • Poll for replies/mentions   • Analyze context                    │
│  • Track engagement metrics    • Generate on-brand responses        │
│  • Queue notable interactions  • Auto-reply or queue for approval   │
│                                                                     │
│  Human-in-loop options:                                             │
│  • Full auto (AI handles all)                                       │
│  • Approval queue (AI drafts, human approves)                       │
│  • Hybrid (auto simple, queue complex)                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Stakeholder Tiers

Different entities get different levels of automation and engagement:

### Tier 1: Principal (You)
- Full access to all features
- Custom voice/tone training
- Priority engagement responses
- Personal build documentation auto-posts

### Tier 2: Partners / High-Value Clients
- Dedicated posting schedules
- Custom content templates
- Co-branded posts
- Engagement monitoring
- Monthly content calendars

### Tier 3: Collaborators / Regular Clients
- Shared posting queue
- Standard templates
- Tagged in relevant posts
- Mentioned in build updates

### Tier 4: Community / Followers
- Engagement responses
- Community highlights
- User-generated content reshares

## Database Schema

```sql
-- Content queue for all platforms
CREATE TABLE content_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who/what this is for
  user_id uuid REFERENCES auth.users(id),
  organization_id uuid REFERENCES organizations(id),
  vehicle_id uuid REFERENCES vehicles(id),

  -- Content
  raw_content text NOT NULL,           -- Original input
  curated_content jsonb,               -- AI-transformed per platform
  media_urls text[],                   -- Images/videos to attach

  -- Targeting
  platforms text[] DEFAULT '{}',       -- ['x', 'instagram', 'threads']
  stakeholder_tier int DEFAULT 1,      -- 1-4 priority tier

  -- Scheduling
  scheduled_for timestamptz,
  timezone text DEFAULT 'America/Los_Angeles',
  optimal_time_requested boolean DEFAULT false,

  -- Status
  status text DEFAULT 'pending' CHECK (status IN (
    'pending', 'curating', 'curated', 'scheduled',
    'posting', 'posted', 'failed', 'cancelled'
  )),

  -- Results
  post_results jsonb,                  -- Platform responses
  posted_at timestamptz,

  -- Metadata
  source text,                         -- 'vehicle_build', 'coding_session', 'manual'
  source_id uuid,                      -- Reference to source entity
  tags text[],

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Engagement tracking
CREATE TABLE engagement_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The interaction
  platform text NOT NULL,
  interaction_type text NOT NULL,      -- 'reply', 'mention', 'quote', 'dm'
  external_post_id text,
  external_user_handle text,
  external_user_id text,
  content text,

  -- Our post it's responding to (if applicable)
  our_post_id uuid REFERENCES social_posts(id),

  -- Response handling
  status text DEFAULT 'pending' CHECK (status IN (
    'pending', 'generating', 'awaiting_approval',
    'approved', 'posted', 'ignored', 'failed'
  )),

  -- AI-generated response
  generated_response text,
  response_confidence float,

  -- Human review
  requires_approval boolean DEFAULT true,
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,

  -- Result
  response_post_id text,
  responded_at timestamptz,

  created_at timestamptz DEFAULT now()
);

-- Partner/client content schedules
CREATE TABLE content_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who this schedule is for
  organization_id uuid REFERENCES organizations(id),
  user_id uuid REFERENCES auth.users(id),

  -- Schedule configuration
  name text NOT NULL,
  platforms text[] NOT NULL,
  frequency text NOT NULL,             -- 'daily', 'weekly', 'monthly', 'custom'
  custom_cron text,                    -- For custom frequency
  timezone text DEFAULT 'America/Los_Angeles',

  -- Content rules
  content_types text[],                -- ['build_progress', 'milestones', 'insights']
  template_id uuid,
  tone text DEFAULT 'professional',    -- 'professional', 'casual', 'technical'

  -- Approval workflow
  auto_post boolean DEFAULT false,
  approval_required_by uuid[],

  is_active boolean DEFAULT true,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

## Edge Functions

### curate-for-x
Transforms raw content into X-optimized posts.

```typescript
// Input
{
  "content": "Just finished the LS3 swap on the K5. 440hp in a '77 Blazer.",
  "vehicle_id": "uuid",           // Optional: pulls vehicle data
  "images": ["url1", "url2"],     // Optional: selects best
  "tone": "enthusiast",           // Optional: voice style
  "include_hashtags": true
}

// Output
{
  "curated_text": "440 horses in a '77 Blazer.\n\nJust dropped an LS3 into the K5. The Squarebody community is about to lose their minds.\n\n#K5Blazer #LS3Swap #Squarebody",
  "thread": null,                 // Or array if needs multiple tweets
  "selected_image": "url1",
  "hook_score": 8.5,              // How attention-grabbing
  "estimated_engagement": "high"
}
```

### x-mention-monitor
Polls for engagement and queues responses.

```typescript
// Runs on schedule (every 5-15 min)
// Fetches mentions, replies to our posts
// Stores in engagement_queue
// Triggers response generation for high-priority items
```

### x-engagement-responder
Generates contextual responses.

```typescript
// Input
{
  "interaction_id": "uuid",       // From engagement_queue
  "auto_post": false              // Or true for full automation
}

// Output
{
  "response": "Thanks! The LS3 was a tight fit but worth every hour. Happy to share the mount specs if you're planning something similar.",
  "confidence": 0.85,
  "tone_match": 0.9,
  "requires_approval": true
}
```

## Content Types

### Vehicle Build Posts
- Progress milestones (engine in, paint done, first start)
- Before/after comparisons
- Technical details for enthusiasts
- Parts sourcing stories
- Problem-solving moments

### Business Updates
- Client project completions
- Shop capacity announcements
- Team highlights
- Industry commentary

### Personal Brand
- Insights from work
- Lessons learned
- Behind-the-scenes
- Community engagement

## Implementation Phases

### Phase 1: Core Posting (DONE)
- [x] X OAuth connection
- [x] Basic post function
- [x] Token refresh handling

### Phase 2: Content Curation
- [ ] curate-for-x edge function
- [ ] Vehicle-aware content generation
- [ ] Image selection logic
- [ ] Hook optimization

### Phase 3: Scheduling
- [ ] content_queue table
- [ ] Optimal time detection
- [ ] Multi-platform support
- [ ] Queue management UI

### Phase 4: Engagement
- [ ] x-mention-monitor
- [ ] engagement_queue table
- [ ] x-engagement-responder
- [ ] Approval workflow UI

### Phase 5: Multi-Stakeholder
- [ ] Partner schedules
- [ ] Custom templates
- [ ] Co-branded posts
- [ ] Analytics per stakeholder

## Voice & Tone Guidelines

### Default Voice
- Direct, no fluff
- Technical when appropriate
- Enthusiast energy
- Real, not corporate

### Platform Adaptations
- **X**: Punchy, hook-driven, conversation-starting
- **Instagram**: Visual-first, story-driven
- **LinkedIn**: Professional but not boring
- **Threads**: Casual, community-focused
