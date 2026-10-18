# Social Media Publishing System - Complete Architecture

**Document Version:** 1.0  
**Date:** November 23, 2025  
**Status:** 📐 Architecture Design Phase

---

## 📋 TABLE OF CONTENTS

1. [System Overview](#system-overview)
2. [Database Schema (ERD)](#database-schema-erd)
3. [Platform Integration Architecture](#platform-integration-architecture)
4. [OAuth Flow Diagrams](#oauth-flow-diagrams)
5. [Publishing Data Flow](#publishing-data-flow)
6. [UI Wireframes](#ui-wireframes)
7. [API Integration Patterns](#api-integration-patterns)
8. [Security & Credentials Management](#security--credentials-management)
9. [Rate Limiting & Queue System](#rate-limiting--queue-system)
10. [Implementation Roadmap](#implementation-roadmap)

---

## 1. SYSTEM OVERVIEW

### 🎯 Purpose
Enable users to publish vehicle image sets directly to social media platforms with one click, automating the entire process from image selection to multi-platform distribution.

### 🏗️ Architecture Approach
**Hybrid Integration Model:**
- **Direct API:** Instagram/Facebook (Meta Graph API) - full control, free, high limits
- **Direct API:** LinkedIn - free, business-focused, good limits
- **Third-Party:** Twitter/X (via Buffer/Hootsuite) - avoids $100/month API cost
- **Future:** TikTok, Pinterest (optional)

### 🔄 Core Workflow
```
Image Set Created → Review & Customize → Click "Publish" → 
OAuth Verification → Format for Each Platform → 
Parallel Publishing → Track Results → Display Analytics
```

---

## 2. DATABASE SCHEMA (ERD)

### 🗄️ Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SOCIAL MEDIA PUBLISHING SCHEMA                           │
└─────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────┐
                    │      profiles        │
                    │──────────────────────│
                    │ id (PK)             │
                    │ email               │
                    │ username            │
                    └──────────────────────┘
                             │
                             │ (1:N)
                             ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                   social_media_accounts                                   │
├───────────────────────────────────────────────────────────────────────────┤
│ id                    UUID PRIMARY KEY                                    │
│ user_id               UUID REFERENCES profiles(id) CASCADE                │
│ platform              TEXT ('instagram', 'facebook', 'twitter', etc.)     │
│ platform_user_id      TEXT (Instagram Business Account ID, etc.)          │
│ platform_username     TEXT (e.g., @username)                              │
│ account_type          TEXT ('personal', 'business', 'creator')            │
│                                                                            │
│ -- OAuth Credentials (ENCRYPTED)                                          │
│ access_token          TEXT (stored via Supabase Vault)                    │
│ refresh_token         TEXT (stored via Supabase Vault)                    │
│ token_expires_at      TIMESTAMPTZ                                          │
│ scope_permissions     TEXT[] (granted permissions)                         │
│                                                                            │
│ -- Connection Status                                                       │
│ status                TEXT ('pending', 'connected', 'expired', 'revoked') │
│ last_verified_at      TIMESTAMPTZ                                          │
│ verification_error    TEXT                                                 │
│                                                                            │
│ -- Account Metadata                                                        │
│ profile_picture_url   TEXT                                                 │
│ follower_count        INTEGER                                              │
│ is_default            BOOLEAN (default account for platform)               │
│ metadata              JSONB (platform-specific data)                       │
│                                                                            │
│ created_at            TIMESTAMPTZ DEFAULT NOW()                            │
│ updated_at            TIMESTAMPTZ DEFAULT NOW()                            │
│                                                                            │
│ UNIQUE(user_id, platform, platform_user_id)                               │
└───────────────────────────────────────────────────────────────────────────┘
                             │
                             │ (1:N)
                             ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                      social_media_posts                                   │
├───────────────────────────────────────────────────────────────────────────┤
│ id                    UUID PRIMARY KEY                                    │
│ account_id            UUID REFERENCES social_media_accounts(id) CASCADE   │
│ vehicle_id            UUID REFERENCES vehicles(id) CASCADE                │
│ image_set_id          UUID REFERENCES image_sets(id) SET NULL             │
│ user_id               UUID REFERENCES profiles(id) CASCADE                │
│                                                                            │
│ -- Post Content                                                            │
│ caption               TEXT (generated or custom)                           │
│ hashtags              TEXT[] (['#classic', '#restoration'])                │
│ image_urls            TEXT[] (ordered array of image URLs)                 │
│ platform              TEXT ('instagram', 'facebook', etc.)                 │
│ post_type             TEXT ('single', 'carousel', 'story')                 │
│                                                                            │
│ -- Publishing Status                                                       │
│ status                TEXT ('draft', 'scheduled', 'publishing',            │
│                            'published', 'failed')                          │
│ scheduled_for         TIMESTAMPTZ (null = immediate)                       │
│ published_at          TIMESTAMPTZ                                          │
│                                                                            │
│ -- Platform Response                                                       │
│ platform_post_id      TEXT (Instagram Media ID, etc.)                      │
│ platform_url          TEXT (direct link to post)                           │
│ platform_response     JSONB (full API response)                            │
│                                                                            │
│ -- Error Handling                                                          │
│ error_message         TEXT                                                 │
│ retry_count           INTEGER DEFAULT 0                                    │
│ last_retry_at         TIMESTAMPTZ                                          │
│                                                                            │
│ created_at            TIMESTAMPTZ DEFAULT NOW()                            │
│ updated_at            TIMESTAMPTZ DEFAULT NOW()                            │
└───────────────────────────────────────────────────────────────────────────┘
                             │
                             │ (1:N)
                             ↓
┌───────────────────────────────────────────────────────────────────────────┐
│                    social_media_analytics                                 │
├───────────────────────────────────────────────────────────────────────────┤
│ id                    UUID PRIMARY KEY                                    │
│ post_id               UUID REFERENCES social_media_posts(id) CASCADE      │
│                                                                            │
│ -- Engagement Metrics (synced periodically)                                │
│ likes_count           INTEGER DEFAULT 0                                    │
│ comments_count        INTEGER DEFAULT 0                                    │
│ shares_count          INTEGER DEFAULT 0                                    │
│ views_count           INTEGER DEFAULT 0                                    │
│ reach                 INTEGER DEFAULT 0                                    │
│ impressions           INTEGER DEFAULT 0                                    │
│                                                                            │
│ -- Demographics (if available)                                             │
│ audience_breakdown    JSONB (age, gender, location)                        │
│                                                                            │
│ synced_at             TIMESTAMPTZ                                          │
│ created_at            TIMESTAMPTZ DEFAULT NOW()                            │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                     oauth_state_tracker                                   │
├───────────────────────────────────────────────────────────────────────────┤
│ id                    UUID PRIMARY KEY                                    │
│ user_id               UUID REFERENCES profiles(id) CASCADE                │
│ state                 TEXT UNIQUE (random string for CSRF protection)     │
│ platform              TEXT ('instagram', 'facebook', etc.)                 │
│ redirect_url          TEXT (where to return after OAuth)                   │
│ expires_at            TIMESTAMPTZ (valid for 10 minutes)                   │
│ created_at            TIMESTAMPTZ DEFAULT NOW()                            │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                     publishing_queue                                      │
├───────────────────────────────────────────────────────────────────────────┤
│ id                    UUID PRIMARY KEY                                    │
│ post_id               UUID REFERENCES social_media_posts(id) CASCADE      │
│ priority              INTEGER DEFAULT 0 (higher = sooner)                  │
│ scheduled_for         TIMESTAMPTZ                                          │
│ status                TEXT ('queued', 'processing', 'completed', 'failed') │
│ attempts              INTEGER DEFAULT 0                                    │
│ last_attempt_at       TIMESTAMPTZ                                          │
│ error_log             JSONB                                                │
│ created_at            TIMESTAMPTZ DEFAULT NOW()                            │
│ updated_at            TIMESTAMPTZ DEFAULT NOW()                            │
│                                                                            │
│ INDEX idx_queue_scheduled ON publishing_queue(scheduled_for, status)     │
│ INDEX idx_queue_priority ON publishing_queue(priority DESC, created_at)  │
└───────────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────────┐
│                    rate_limit_tracker                                     │
├───────────────────────────────────────────────────────────────────────────┤
│ id                    UUID PRIMARY KEY                                    │
│ account_id            UUID REFERENCES social_media_accounts(id) CASCADE   │
│ endpoint              TEXT ('instagram_media_publish', etc.)               │
│ window_start          TIMESTAMPTZ (start of rate limit window)             │
│ calls_made            INTEGER (calls in this window)                       │
│ calls_limit           INTEGER (max calls per window)                       │
│ reset_at              TIMESTAMPTZ (when window resets)                     │
│ created_at            TIMESTAMPTZ DEFAULT NOW()                            │
│ updated_at            TIMESTAMPTZ DEFAULT NOW()                            │
│                                                                            │
│ UNIQUE(account_id, endpoint, window_start)                                │
└───────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        KEY RELATIONSHIPS                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. One USER can connect multiple SOCIAL_MEDIA_ACCOUNTS (multi-platform)    │
│ 2. One ACCOUNT can have many POSTS (publishing history)                     │
│ 3. One POST has one ANALYTICS record (engagement tracking)                  │
│ 4. One IMAGE_SET can be published to many POSTS (different platforms)      │
│ 5. PUBLISHING_QUEUE manages async posting with retries                      │
│ 6. RATE_LIMIT_TRACKER prevents API throttling                               │
│ 7. OAUTH_STATE_TRACKER secures OAuth flows (CSRF protection)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. PLATFORM INTEGRATION ARCHITECTURE

### 🏛️ Multi-Platform Integration Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NUKE PLATFORM (Frontend + Backend)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS API Calls
                                    ↓
        ┌───────────────────────────────────────────────────────┐
        │                 API GATEWAY LAYER                      │
        │         (Supabase Edge Functions + Services)          │
        └───────────────────────────────────────────────────────┘
                    │                       │                    │
         ┌──────────┴──────────┐   ┌───────┴────────┐  ┌───────┴───────┐
         │  META GRAPH API     │   │  LINKEDIN API  │  │  BUFFER API   │
         │   (Direct)          │   │   (Direct)     │  │ (Third-Party) │
         └─────────────────────┘   └────────────────┘  └───────────────┘
                    │                       │                    │
         ┌──────────┴──────────┐           │           ┌────────┴────────┐
         │                     │           │           │                 │
    ┌────▼─────┐        ┌─────▼─────┐     │     ┌─────▼─────┐   ┌──────▼──────┐
    │Instagram │        │ Facebook  │     │     │  Twitter  │   │  Pinterest  │
    │ Business │        │   Pages   │     │     │    /X     │   │    Boards   │
    └──────────┘        └───────────┘     │     └───────────┘   └─────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │  LinkedIn   │
                                    │   Profile   │
                                    └─────────────┘
```

### Platform-Specific Details

#### 📸 **INSTAGRAM (Meta Graph API)**

**Requirements:**
- Instagram Business or Creator Account
- Connected to Facebook Page
- Meta App with Instagram Content Publishing permission

**API Capabilities:**
- Single image posts
- Carousel posts (up to 10 images)
- Stories (24hr ephemeral)
- Reels (short video)

**Rate Limits:**
- 25 API calls per user per hour (rolling window)
- 200 posts per day per Instagram account

**Authentication Flow:**
```
User → Facebook Login → Request Instagram Permissions → 
Verify Business Account → Store Long-Lived Token (60 days)
```

**Posting Process:**
```
1. Create Container: POST /ig_user_id/media
2. Upload Images: multipart/form-data to image_url
3. Publish Container: POST /ig_user_id/media_publish
4. Get Media ID: Response contains Instagram Media ID
```

---

#### 👔 **FACEBOOK (Meta Graph API)**

**Requirements:**
- Facebook Page (not personal profile for API posting)
- Page access token with pages_manage_posts permission

**API Capabilities:**
- Single/multiple photos
- Photo albums
- Videos
- Link previews

**Rate Limits:**
- 200 API calls per hour per user
- 100 posts per hour per page

**Posting Process:**
```
1. Upload Photo: POST /page_id/photos with image
2. Create Post: POST /page_id/feed with message
3. Get Post ID: Response contains Facebook Post ID
```

---

#### 💼 **LINKEDIN (LinkedIn API v2)**

**Requirements:**
- LinkedIn Profile or Company Page
- OAuth 2.0 with w_member_social permission

**API Capabilities:**
- Single image posts
- Multiple image posts
- Article shares
- Rich media

**Rate Limits:**
- 100 API calls per user per day
- No specific post count limit

**Posting Process:**
```
1. Register Upload: POST /assets?action=registerUpload
2. Upload Image: PUT to uploadUrl
3. Create Share: POST /ugcPosts with asset URN
4. Get Post URN: Response contains LinkedIn URN
```

---

#### 🐦 **TWITTER/X (via Buffer/Hootsuite)**

**Why Third-Party?**
- Twitter API Basic: $100/month just for posting ability
- Free tier: Read-only (can't post)
- Buffer/Hootsuite: $10-30/month covers ALL platforms

**Integration:**
```
Nuke → Buffer API → Twitter API
(One integration handles Twitter + future platforms)
```

---

## 4. OAUTH FLOW DIAGRAMS

### 🔐 OAuth 2.0 Authentication Flow (Instagram Example)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        INSTAGRAM OAUTH FLOW                               │
└──────────────────────────────────────────────────────────────────────────┘

USER (Browser)          NUKE FRONTEND      SUPABASE EDGE       META SERVERS
      │                       │              FUNCTION               │
      │  1. Click "Connect    │                  │                  │
      │     Instagram"        │                  │                  │
      ├──────────────────────>│                  │                  │
      │                       │                  │                  │
      │                       │ 2. Generate      │                  │
      │                       │    state token   │                  │
      │                       ├─────────────────>│                  │
      │                       │                  │                  │
      │                       │ 3. Store state   │                  │
      │                       │    in DB         │                  │
      │                       │<─────────────────┤                  │
      │                       │                  │                  │
      │  4. Redirect to       │                  │                  │
      │     Facebook Login    │                  │                  │
      │<──────────────────────┤                  │                  │
      │                       │                  │                  │
      │  5. Facebook OAuth    │                  │                  │
      │     consent screen    │                  │                  │
      ├──────────────────────────────────────────────────────────>│
      │                       │                  │                  │
      │  6. User approves     │                  │                  │
      │     permissions       │                  │                  │
      │<──────────────────────────────────────────────────────────┤│
      │  (redirect with code) │                  │                  │
      │                       │                  │                  │
      │  7. Callback URL:     │                  │                  │
      │     /oauth/instagram  │                  │                  │
      ├──────────────────────────────────────────>│                  │
      │     ?code=XXX&state=YYY                  │                  │
      │                       │                  │                  │
      │                       │                  │ 8. Verify state  │
      │                       │                  │    (CSRF check)  │
      │                       │                  │                  │
      │                       │                  │ 9. Exchange code │
      │                       │                  │    for token     │
      │                       │                  ├─────────────────>│
      │                       │                  │                  │
      │                       │                  │ 10. Access token │
      │                       │                  │<─────────────────┤
      │                       │                  │                  │
      │                       │                  │ 11. Encrypt &    │
      │                       │                  │     store token  │
      │                       │                  │     in Vault     │
      │                       │                  │                  │
      │                       │                  │ 12. Fetch IG     │
      │                       │                  │     Business ID  │
      │                       │                  ├─────────────────>│
      │                       │                  │                  │
      │                       │                  │ 13. Account info │
      │                       │                  │<─────────────────┤
      │                       │                  │                  │
      │  14. Success redirect │                  │                  │
      │<──────────────────────────────────────────┤                  │
      │     /settings/social  │                  │                  │
      │     ?connected=true   │                  │                  │
      │                       │                  │                  │

┌──────────────────────────────────────────────────────────────────────────┐
│ STORED IN DATABASE:                                                       │
│ - social_media_accounts table                                            │
│   • user_id                                                               │
│   • platform: 'instagram'                                                 │
│   • platform_user_id: Instagram Business Account ID                      │
│   • access_token: [ENCRYPTED in Supabase Vault]                          │
│   • refresh_token: [ENCRYPTED]                                            │
│   • token_expires_at: NOW() + 60 days                                    │
│   • status: 'connected'                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

### 🔄 Token Refresh Flow

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   AUTOMATIC TOKEN REFRESH (Background Job)                │
└──────────────────────────────────────────────────────────────────────────┘

CRON JOB (Daily)       SUPABASE FUNCTION      META API         DATABASE
      │                       │                    │                │
      │  1. Trigger at        │                    │                │
      │     2:00 AM UTC       │                    │                │
      ├──────────────────────>│                    │                │
      │                       │                    │                │
      │                       │ 2. Query expiring  │                │
      │                       │    tokens          │                │
      │                       ├───────────────────────────────────>│
      │                       │                    │                │
      │                       │ 3. Accounts < 7    │                │
      │                       │    days to expiry  │                │
      │                       │<───────────────────────────────────┤
      │                       │                    │                │
      │                       │ FOR EACH ACCOUNT:  │                │
      │                       │                    │                │
      │                       │ 4. Exchange refresh│                │
      │                       │    token for new   │                │
      │                       │    access token    │                │
      │                       ├───────────────────>│                │
      │                       │                    │                │
      │                       │ 5. New token       │                │
      │                       │    (60 day expiry) │                │
      │                       │<───────────────────┤                │
      │                       │                    │                │
      │                       │ 6. Update tokens   │                │
      │                       │    in Vault        │                │
      │                       ├───────────────────────────────────>│
      │                       │                    │                │
      │                       │ 7. Update expiry   │                │
      │                       │    timestamp       │                │
      │                       ├───────────────────────────────────>│
      │                       │                    │                │
      │  8. Log success       │                    │                │
      │<──────────────────────┤                    │                │
```

---

## 5. PUBLISHING DATA FLOW

### 📤 End-to-End Publishing Process

```
┌─────────────────────────────────────────────────────────────────────────────┐
│               USER PUBLISHES IMAGE SET TO INSTAGRAM                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌────────────┐
│   STEP 1   │  USER ACTION: Create/Select Image Set
└────────────┘
      │
      │  User creates image set "1969 Camaro Restoration"
      │  - 8 images selected
      │  - Caption auto-generated from vehicle data
      │  - Hashtags: #Camaro #Restoration #ClassicCar
      │
      ↓
┌────────────┐
│   STEP 2   │  USER ACTION: Click "Publish to Instagram"
└────────────┘
      │
      │  UI shows publish modal:
      │  ┌────────────────────────────────────────┐
      │  │ 📸 Publish to Instagram                │
      │  │                                        │
      │  │ Account: @classic_garage              │
      │  │ Post Type: [Carousel (8 images)]      │
      │  │                                        │
      │  │ Preview:                               │
      │  │ [Image 1] [Image 2] [Image 3]...       │
      │  │                                        │
      │  │ Caption:                               │
      │  │ ┌────────────────────────────────────┐ │
      │  │ │ Check out this 1969 Camaro         │ │
      │  │ │ restoration! 8 years in the making │ │
      │  │ │ #Camaro #Restoration               │ │
      │  │ └────────────────────────────────────┘ │
      │  │                                        │
      │  │ [Cancel]  [Schedule]  [Publish Now]   │
      │  └────────────────────────────────────────┘
      │
      ↓
┌────────────┐
│   STEP 3   │  VALIDATION: Check Account & Rate Limits
└────────────┘
      │
      │  Frontend calls: POST /api/social/validate
      │  {
      │    account_id: "uuid",
      │    image_count: 8,
      │    post_type: "carousel"
      │  }
      │
      │  Backend checks:
      │  ✓ Account still connected?
      │  ✓ Token not expired?
      │  ✓ Rate limit available?
      │  ✓ Image URLs publicly accessible?
      │  ✓ Caption within limits (2,200 chars)?
      │
      ↓
┌────────────┐
│   STEP 4   │  DATABASE: Create social_media_posts Record
└────────────┘
      │
      │  INSERT INTO social_media_posts (
      │    account_id,
      │    vehicle_id,
      │    image_set_id,
      │    user_id,
      │    caption,
      │    hashtags,
      │    image_urls,
      │    platform,
      │    post_type,
      │    status
      │  ) VALUES (
      │    'account-uuid',
      │    'vehicle-uuid',
      │    'image-set-uuid',
      │    'user-uuid',
      │    'Check out this 1969 Camaro...',
      │    ['#Camaro', '#Restoration'],
      │    ['https://...img1', 'https://...img2', ...],
      │    'instagram',
      │    'carousel',
      │    'publishing'  ← Status set to publishing
      │  )
      │
      ↓
┌────────────┐
│   STEP 5   │  QUEUE: Add to publishing_queue
└────────────┘
      │
      │  INSERT INTO publishing_queue (
      │    post_id,
      │    priority,
      │    scheduled_for,
      │    status
      │  ) VALUES (
      │    'post-uuid',
      │    10,  ← Immediate publish = high priority
      │    NOW(),  ← Immediate
      │    'queued'
      │  )
      │
      ↓
┌────────────┐
│   STEP 6   │  WORKER: Publishing Worker Picks Up Job
└────────────┘
      │
      │  Background worker (Edge Function triggered every 30s):
      │  - Queries publishing_queue WHERE status='queued'
      │  - Orders by priority DESC, scheduled_for ASC
      │  - Locks job: UPDATE status='processing'
      │
      ↓
┌────────────┐
│   STEP 7   │  META API: Create Instagram Media Container
└────────────┘
      │
      │  POST https://graph.facebook.com/v18.0/{ig_user_id}/media
      │  
      │  Body (first image):
      │  {
      │    "image_url": "https://supabase.co/storage/...image1.jpg",
      │    "is_carousel_item": true
      │  }
      │  
      │  Response:
      │  {
      │    "id": "17841401234567890"  ← Container ID
      │  }
      │  
      │  Repeat for all 8 images → collect 8 container IDs
      │
      ↓
┌────────────┐
│   STEP 8   │  META API: Create Carousel Container
└────────────┘
      │
      │  POST https://graph.facebook.com/v18.0/{ig_user_id}/media
      │  
      │  Body:
      │  {
      │    "caption": "Check out this 1969 Camaro restoration...",
      │    "media_type": "CAROUSEL",
      │    "children": [
      │      "17841401234567890",  ← Image 1 container
      │      "17841401234567891",  ← Image 2 container
      │      ... (all 8)
      │    ]
      │  }
      │  
      │  Response:
      │  {
      │    "id": "17841400000000000"  ← Carousel container ID
      │  }
      │
      ↓
┌────────────┐
│   STEP 9   │  META API: Publish Container
└────────────┘
      │
      │  POST https://graph.facebook.com/v18.0/{ig_user_id}/media_publish
      │  
      │  Body:
      │  {
      │    "creation_id": "17841400000000000"  ← Carousel container
      │  }
      │  
      │  Response:
      │  {
      │    "id": "17999999999999999"  ← Published Media ID
      │  }
      │
      ↓
┌────────────┐
│   STEP 10  │  DATABASE: Update Post Record
└────────────┘
      │
      │  UPDATE social_media_posts
      │  SET 
      │    status = 'published',
      │    published_at = NOW(),
      │    platform_post_id = '17999999999999999',
      │    platform_url = 'https://www.instagram.com/p/ABC123/',
      │    platform_response = {full API response}
      │  WHERE id = 'post-uuid';
      │
      │  UPDATE publishing_queue
      │  SET status = 'completed'
      │  WHERE post_id = 'post-uuid';
      │
      ↓
┌────────────┐
│   STEP 11  │  DATABASE: Update Rate Limit Tracker
└────────────┘
      │
      │  UPDATE rate_limit_tracker
      │  SET 
      │    calls_made = calls_made + 10,  ← 8 images + 1 carousel + 1 publish
      │    updated_at = NOW()
      │  WHERE account_id = 'account-uuid'
      │    AND endpoint = 'instagram_media_publish'
      │    AND window_start = date_trunc('hour', NOW());
      │
      ↓
┌────────────┐
│   STEP 12  │  UI: Real-Time Update
└────────────┘
      │
      │  Supabase Realtime subscription fires:
      │  - Frontend receives status='published' update
      │  - UI shows success message
      │  - Post card shows Instagram link
      │  
      │  ┌────────────────────────────────────────┐
      │  │ ✅ Published to Instagram!            │
      │  │                                        │
      │  │ Posted 2 seconds ago                   │
      │  │ View on Instagram →                    │
      │  └────────────────────────────────────────┘
      │
      ↓
┌────────────┐
│   STEP 13  │  ANALYTICS: Schedule Sync (24hr later)
└────────────┘
      │
      │  Cron job runs daily:
      │  - Fetches analytics for posts published >24hr ago
      │  
      │  GET https://graph.facebook.com/v18.0/{media_id}/insights
      │    ?metric=impressions,reach,engagement,likes,comments,shares
      │  
      │  INSERT INTO social_media_analytics (
      │    post_id,
      │    likes_count,
      │    comments_count,
      │    shares_count,
      │    reach,
      │    impressions,
      │    synced_at
      │  )
      │
      ↓
┌────────────┐
│    DONE    │  User sees engagement metrics in dashboard
└────────────┘
```

---

## 6. UI WIREFRAMES

### 📱 Mobile-First Design

#### A. Account Connection Screen

```
┌─────────────────────────────────────────────────────────────┐
│  ⚙️  Settings > Social Media Accounts                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Connected Accounts (2)                                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 📸 Instagram                              [Connected ✓] │ │
│  │                                                          │ │
│  │ @classic_garage                                         │ │
│  │ Business Account                                        │ │
│  │ 12.5K followers                                         │ │
│  │                                                          │ │
│  │ Token expires: Dec 25, 2025                             │ │
│  │ Last verified: 2 hours ago                              │ │
│  │                                                          │ │
│  │ [Disconnect]  [Refresh Token]                           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 👔 LinkedIn                               [Connected ✓] │ │
│  │                                                          │ │
│  │ John Smith                                              │ │
│  │ Professional Account                                    │ │
│  │ 2.1K connections                                        │ │
│  │                                                          │ │
│  │ Token expires: Jan 15, 2026                             │ │
│  │ Last verified: 1 day ago                                │ │
│  │                                                          │ │
│  │ [Disconnect]  [Refresh Token]                           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Available Platforms                                         │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 📘 Facebook                                              │ │
│  │ Publish to your Facebook Page                           │ │
│  │ [Connect Account]                                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🐦 Twitter/X (via Buffer)                               │ │
│  │ Automated cross-posting via Buffer                      │ │
│  │ [Connect via Buffer]                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### B. Publish Modal (from Image Set)

```
┌─────────────────────────────────────────────────────────────┐
│  📤 Publish to Social Media                          [✕]    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Image Set: "1969 Camaro Restoration"                       │
│  8 images                                                    │
│                                                              │
│  ┌─────────────────────────────────────────────┐            │
│  │ [Thumbnail 1] [Thumbnail 2] [Thumbnail 3]  │            │
│  │ [Thumbnail 4] [Thumbnail 5] [Thumbnail 6]  │            │
│  │ [Thumbnail 7] [Thumbnail 8]                │            │
│  │                                             │            │
│  │ Drag to reorder                             │            │
│  └─────────────────────────────────────────────┘            │
│                                                              │
│  Platform Selection                                          │
│                                                              │
│  [ ✓ ] 📸 Instagram (@classic_garage)                       │
│       Post Type: [Carousel ▼]                               │
│                                                              │
│  [ ✓ ] 👔 LinkedIn (John Smith)                             │
│       Post Type: [Multiple Images ▼]                        │
│                                                              │
│  [   ] 📘 Facebook                                           │
│       [Connect Account First]                               │
│                                                              │
│  Caption                                                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Check out this stunning 1969 Camaro restoration!       │ │
│  │ 8 years of dedication and craftsmanship.               │ │
│  │                                                          │ │
│  │ Vehicle: 1969 Chevrolet Camaro                         │ │
│  │ Current Value: $68,500                                  │ │
│  │                                                          │ │
│  │ #Camaro #ClassicCar #Restoration #Chevrolet            │ │
│  │                                                          │ │
│  │ 185/2200 characters                                     │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Edit for Instagram] [Edit for LinkedIn]                  │
│                                                              │
│  Publishing Options                                          │
│                                                              │
│  ( • ) Post Now                                              │
│  (   ) Schedule for: [Date] [Time]                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ⚠️  Rate Limit Check:                                   │ │
│  │ Instagram: 15/25 calls remaining this hour             │ │
│  │ LinkedIn: 87/100 calls remaining today                 │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Cancel]                    [Preview] [Publish to 2 ▼]    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### C. Publishing Progress Modal

```
┌─────────────────────────────────────────────────────────────┐
│  📤 Publishing...                                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 📸 Instagram                                             │ │
│  │                                                          │ │
│  │ ✓ Uploading images (8/8)                                │ │
│  │ ✓ Creating carousel                                     │ │
│  │ ⏳ Publishing...                                         │ │
│  │                                                          │ │
│  │ [████████████░░░░] 85%                                  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 👔 LinkedIn                                              │ │
│  │                                                          │ │
│  │ ⏳ Waiting for Instagram to complete...                  │ │
│  │                                                          │ │
│  │ [░░░░░░░░░░░░░░░░] 0%                                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Estimated time: ~15 seconds                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### D. Success Screen

```
┌─────────────────────────────────────────────────────────────┐
│  ✅ Published Successfully!                           [✕]    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Your post is now live on 2 platforms!                      │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 📸 Instagram                                             │ │
│  │                                                          │ │
│  │ Published: 3 seconds ago                                │ │
│  │ Post Type: Carousel (8 images)                          │ │
│  │                                                          │ │
│  │ [View on Instagram →]                                   │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 👔 LinkedIn                                              │ │
│  │                                                          │ │
│  │ Published: 5 seconds ago                                │ │
│  │ Post Type: Multiple Images                              │ │
│  │                                                          │ │
│  │ [View on LinkedIn →]                                    │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Next Steps:                                                 │
│  • Analytics will sync in 24 hours                          │
│  • View publishing history in Dashboard                     │
│                                                              │
│  [Done]                        [Share Another Set]          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

#### E. Publishing Dashboard

```
┌─────────────────────────────────────────────────────────────┐
│  📊 Social Media Dashboard                                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Overview (Last 30 Days)                                     │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │ 24 POSTS    │  │ 5.2K REACH  │  │ 847 LIKES   │         │
│  │ Published   │  │ Total       │  │ Total       │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│                                                              │
│  Recent Posts                                                │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [Thumbnail]  1969 Camaro Restoration                    │ │
│  │              8 images • Carousel                        │ │
│  │                                                          │ │
│  │              📸 Instagram • 2 hours ago                 │ │
│  │              ❤️  127 likes  💬 18 comments              │ │
│  │                                                          │ │
│  │              👔 LinkedIn • 2 hours ago                  │ │
│  │              👍 43 reactions  💬 7 comments             │ │
│  │                                                          │ │
│  │              [View Analytics]                           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ [Thumbnail]  Engine Bay Detailing                       │ │
│  │              5 images • Carousel                        │ │
│  │                                                          │ │
│  │              📸 Instagram • 3 days ago                  │ │
│  │              ❤️  214 likes  💬 32 comments              │ │
│  │                                                          │ │
│  │              [View Analytics]                           │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  [Load More]                                                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. API INTEGRATION PATTERNS

### 🔌 Supabase Edge Function Structure

#### File: `supabase/functions/social-instagram-publish/index.ts`

```typescript
/**
 * Instagram Publishing Edge Function
 * Handles OAuth callback and post publishing via Meta Graph API
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

const INSTAGRAM_API_BASE = 'https://graph.facebook.com/v18.0'
const FACEBOOK_APP_ID = Deno.env.get('FACEBOOK_APP_ID')
const FACEBOOK_APP_SECRET = Deno.env.get('FACEBOOK_APP_SECRET')

serve(async (req) => {
  const url = new URL(req.url)
  const action = url.searchParams.get('action')

  // Initialize Supabase client
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    // ROUTE 1: Initiate OAuth flow
    if (action === 'connect') {
      const { userId } = await req.json()
      
      // Generate state token for CSRF protection
      const state = crypto.randomUUID()
      
      // Store state in database
      await supabase
        .from('oauth_state_tracker')
        .insert({
          user_id: userId,
          state,
          platform: 'instagram',
          expires_at: new Date(Date.now() + 10 * 60 * 1000) // 10 min
        })
      
      // Build Facebook OAuth URL
      const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth')
      authUrl.searchParams.set('client_id', FACEBOOK_APP_ID!)
      authUrl.searchParams.set('redirect_uri', `${url.origin}/functions/v1/social-instagram-publish?action=callback`)
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('scope', 'instagram_basic,instagram_content_publish,pages_read_engagement')
      
      return new Response(
        JSON.stringify({ authUrl: authUrl.toString() }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    // ROUTE 2: OAuth callback
    if (action === 'callback') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      
      // Verify state
      const { data: stateData } = await supabase
        .from('oauth_state_tracker')
        .select('user_id')
        .eq('state', state)
        .gt('expires_at', new Date().toISOString())
        .single()
      
      if (!stateData) {
        throw new Error('Invalid or expired state')
      }
      
      // Exchange code for access token
      const tokenResponse = await fetch(`${INSTAGRAM_API_BASE}/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: FACEBOOK_APP_ID!,
          client_secret: FACEBOOK_APP_SECRET!,
          grant_type: 'authorization_code',
          redirect_uri: `${url.origin}/functions/v1/social-instagram-publish?action=callback`,
          code: code!
        })
      })
      
      const tokens = await tokenResponse.json()
      
      // Exchange short-lived token for long-lived token (60 days)
      const longLivedResponse = await fetch(
        `${INSTAGRAM_API_BASE}/oauth/access_token?` +
        `grant_type=fb_exchange_token&` +
        `client_id=${FACEBOOK_APP_ID}&` +
        `client_secret=${FACEBOOK_APP_SECRET}&` +
        `fb_exchange_token=${tokens.access_token}`
      )
      
      const longLivedTokens = await longLivedResponse.json()
      
      // Get Instagram Business Account ID
      const accountsResponse = await fetch(
        `${INSTAGRAM_API_BASE}/me/accounts?access_token=${longLivedTokens.access_token}`
      )
      const accountsData = await accountsResponse.json()
      
      const pageId = accountsData.data[0].id
      const pageAccessToken = accountsData.data[0].access_token
      
      const igResponse = await fetch(
        `${INSTAGRAM_API_BASE}/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
      )
      const igData = await igResponse.json()
      const igUserId = igData.instagram_business_account.id
      
      // Store encrypted tokens in database
      await supabase
        .from('social_media_accounts')
        .upsert({
          user_id: stateData.user_id,
          platform: 'instagram',
          platform_user_id: igUserId,
          access_token: longLivedTokens.access_token, // TODO: Encrypt with Supabase Vault
          token_expires_at: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
          status: 'connected'
        })
      
      // Clean up state
      await supabase
        .from('oauth_state_tracker')
        .delete()
        .eq('state', state)
      
      // Redirect to success page
      return new Response(null, {
        status: 302,
        headers: { 'Location': `${url.origin}/settings/social?connected=instagram` }
      })
    }
    
    // ROUTE 3: Publish post
    if (action === 'publish') {
      const { postId } = await req.json()
      
      // Fetch post data
      const { data: post } = await supabase
        .from('social_media_posts')
        .select(`
          *,
          social_media_accounts (
            platform_user_id,
            access_token
          )
        `)
        .eq('id', postId)
        .single()
      
      if (!post) throw new Error('Post not found')
      
      const igUserId = post.social_media_accounts.platform_user_id
      const accessToken = post.social_media_accounts.access_token
      
      // STEP 1: Create media containers for each image
      const containerIds = []
      
      for (const imageUrl of post.image_urls) {
        const containerResponse = await fetch(
          `${INSTAGRAM_API_BASE}/${igUserId}/media`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: imageUrl,
              is_carousel_item: true,
              access_token: accessToken
            })
          }
        )
        
        const containerData = await containerResponse.json()
        containerIds.push(containerData.id)
      }
      
      // STEP 2: Create carousel container
      const carouselResponse = await fetch(
        `${INSTAGRAM_API_BASE}/${igUserId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            media_type: 'CAROUSEL',
            children: containerIds,
            caption: post.caption + '\n\n' + post.hashtags.join(' '),
            access_token: accessToken
          })
        }
      )
      
      const carouselData = await carouselResponse.json()
      
      // STEP 3: Publish carousel
      const publishResponse = await fetch(
        `${INSTAGRAM_API_BASE}/${igUserId}/media_publish`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_id: carouselData.id,
            access_token: accessToken
          })
        }
      )
      
      const publishData = await publishResponse.json()
      
      // Update post record
      await supabase
        .from('social_media_posts')
        .update({
          status: 'published',
          published_at: new Date().toISOString(),
          platform_post_id: publishData.id,
          platform_url: `https://www.instagram.com/p/${publishData.id}/`,
          platform_response: publishData
        })
        .eq('id', postId)
      
      // Update rate limit tracker
      await supabase.rpc('increment_rate_limit', {
        account_id: post.account_id,
        endpoint: 'instagram_media_publish',
        calls: containerIds.length + 2 // images + carousel + publish
      })
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          mediaId: publishData.id,
          url: `https://www.instagram.com/p/${publishData.id}/`
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    throw new Error('Invalid action')
    
  } catch (error) {
    console.error('Instagram publish error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
})
```

---

## 8. SECURITY & CREDENTIALS MANAGEMENT

### 🔐 Multi-Layer Security Model

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CREDENTIAL STORAGE ARCHITECTURE                         │
└─────────────────────────────────────────────────────────────────────────────┘

LAYER 1: Application Secrets (Supabase Secrets)
├── FACEBOOK_APP_ID
├── FACEBOOK_APP_SECRET
├── LINKEDIN_CLIENT_ID
├── LINKEDIN_CLIENT_SECRET
├── BUFFER_API_KEY (if using third-party)
└── ENCRYPTION_KEY (for Vault)

LAYER 2: User OAuth Tokens (Supabase Vault - Encrypted at Rest)
├── social_media_accounts.access_token → vault.secrets
├── social_media_accounts.refresh_token → vault.secrets
└── Encryption: AES-256-GCM
    - Keys stored in hardware security module (HSM)
    - Automatic rotation every 90 days

LAYER 3: Database Row Level Security (RLS)
├── Users can ONLY access their own social_media_accounts
├── Token columns hidden from SELECT queries (use RPC functions)
└── Service role required to decrypt tokens

LAYER 4: Network Security
├── All API calls use HTTPS (TLS 1.3)
├── Edge Functions run in isolated containers
└── Rate limiting prevents brute force
```

### Example: Token Encryption with Supabase Vault

```sql
-- Create Vault secret for storing encryption key
SELECT vault.create_secret(
  'SOCIAL_MEDIA_ENCRYPTION_KEY',
  'your-256-bit-encryption-key-here'
);

-- Function to encrypt token before storing
CREATE OR REPLACE FUNCTION encrypt_token(token TEXT)
RETURNS TEXT AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  SELECT decrypted_secret INTO encryption_key
  FROM vault.decrypted_secrets
  WHERE name = 'SOCIAL_MEDIA_ENCRYPTION_KEY';
  
  RETURN pgp_sym_encrypt(token, encryption_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to decrypt token when needed
CREATE OR REPLACE FUNCTION decrypt_token(encrypted_token TEXT)
RETURNS TEXT AS $$
DECLARE
  encryption_key TEXT;
BEGIN
  -- Only allow service role to call this
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  
  SELECT decrypted_secret INTO encryption_key
  FROM vault.decrypted_secrets
  WHERE name = 'SOCIAL_MEDIA_ENCRYPTION_KEY';
  
  RETURN pgp_sym_decrypt(encrypted_token::bytea, encryption_key);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS: Users can see accounts but NOT tokens
CREATE POLICY "Users view own accounts without tokens" ON social_media_accounts
  FOR SELECT
  USING (auth.uid() = user_id);

-- Token columns excluded from SELECT
ALTER TABLE social_media_accounts 
  ALTER COLUMN access_token SET NOT NULL,
  ALTER COLUMN access_token SET DEFAULT NULL;
```

---

## 9. RATE LIMITING & QUEUE SYSTEM

### ⏱️ Rate Limit Management

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       RATE LIMIT TRACKING SYSTEM                             │
└─────────────────────────────────────────────────────────────────────────────┘

PLATFORM LIMITS:
├── Instagram: 25 calls/hour/user (rolling window)
├── Facebook: 200 calls/hour/user
├── LinkedIn: 100 calls/day/user
└── Buffer API: 50 calls/minute

ENFORCEMENT STRATEGY:
1. Pre-Publish Check
   - Query rate_limit_tracker for current window
   - If calls_made >= calls_limit → return error "Rate limit exceeded"
   - Estimate: "Available again in X minutes"

2. Post-Publish Update
   - Increment calls_made
   - If window expired, create new window record

3. Automatic Reset
   - Cron job runs every 5 minutes
   - Deletes expired window records
   - Creates new windows for active accounts
```

### SQL Functions for Rate Limiting

```sql
-- Check if rate limit allows publishing
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_account_id UUID,
  p_endpoint TEXT,
  p_calls_needed INTEGER DEFAULT 1
)
RETURNS BOOLEAN AS $$
DECLARE
  current_window RECORD;
  calls_limit INTEGER;
  window_duration INTERVAL;
BEGIN
  -- Get platform-specific limits
  SELECT CASE 
    WHEN p_endpoint LIKE 'instagram%' THEN 25
    WHEN p_endpoint LIKE 'facebook%' THEN 200
    WHEN p_endpoint LIKE 'linkedin%' THEN 100
    ELSE 50
  END INTO calls_limit;
  
  SELECT CASE 
    WHEN p_endpoint LIKE 'instagram%' THEN '1 hour'::INTERVAL
    WHEN p_endpoint LIKE 'facebook%' THEN '1 hour'::INTERVAL
    WHEN p_endpoint LIKE 'linkedin%' THEN '1 day'::INTERVAL
    ELSE '1 minute'::INTERVAL
  END INTO window_duration;
  
  -- Get current window
  SELECT * INTO current_window
  FROM rate_limit_tracker
  WHERE account_id = p_account_id
    AND endpoint = p_endpoint
    AND reset_at > NOW()
  ORDER BY window_start DESC
  LIMIT 1;
  
  -- No window exists or expired → allow
  IF current_window IS NULL THEN
    RETURN TRUE;
  END IF;
  
  -- Check if we have room for more calls
  RETURN (current_window.calls_made + p_calls_needed) <= calls_limit;
END;
$$ LANGUAGE plpgsql;

-- Increment rate limit counter
CREATE OR REPLACE FUNCTION increment_rate_limit(
  p_account_id UUID,
  p_endpoint TEXT,
  p_calls INTEGER DEFAULT 1
)
RETURNS VOID AS $$
DECLARE
  calls_limit INTEGER;
  window_duration INTERVAL;
BEGIN
  -- Get platform-specific limits (same logic as above)
  SELECT CASE 
    WHEN p_endpoint LIKE 'instagram%' THEN 25
    WHEN p_endpoint LIKE 'facebook%' THEN 200
    WHEN p_endpoint LIKE 'linkedin%' THEN 100
    ELSE 50
  END INTO calls_limit;
  
  SELECT CASE 
    WHEN p_endpoint LIKE 'instagram%' THEN '1 hour'::INTERVAL
    WHEN p_endpoint LIKE 'facebook%' THEN '1 hour'::INTERVAL
    WHEN p_endpoint LIKE 'linkedin%' THEN '1 day'::INTERVAL
    ELSE '1 minute'::INTERVAL
  END INTO window_duration;
  
  -- Upsert rate limit record
  INSERT INTO rate_limit_tracker (
    account_id,
    endpoint,
    window_start,
    calls_made,
    calls_limit,
    reset_at
  )
  VALUES (
    p_account_id,
    p_endpoint,
    date_trunc('hour', NOW()),
    p_calls,
    calls_limit,
    NOW() + window_duration
  )
  ON CONFLICT (account_id, endpoint, window_start)
  DO UPDATE SET
    calls_made = rate_limit_tracker.calls_made + p_calls,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
```

### 🗓️ Publishing Queue System

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        QUEUE PROCESSING FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

CRON TRIGGER (Every 30 seconds)
      │
      ↓
┌──────────────────────────────────┐
│ SELECT * FROM publishing_queue   │
│ WHERE status = 'queued'          │
│   AND scheduled_for <= NOW()     │
│ ORDER BY priority DESC,          │
│          scheduled_for ASC       │
│ LIMIT 10;                        │
└──────────────────────────────────┘
      │
      ↓
┌──────────────────────────────────┐
│ FOR EACH queued_post:            │
│                                  │
│ 1. Lock job (status='processing')│
│ 2. Check rate limits             │
│ 3. Call publish function         │
│ 4. Handle result:                │
│    ✓ Success → status='completed'│
│    ✗ Fail → increment attempts   │
│      If attempts < 3:            │
│        - status='queued'         │
│        - scheduled_for += delay  │
│      Else:                       │
│        - status='failed'         │
│        - notify user             │
└──────────────────────────────────┘
```

---

## 10. IMPLEMENTATION ROADMAP

### 🚀 Phase-by-Phase Rollout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          IMPLEMENTATION PHASES                               │
└─────────────────────────────────────────────────────────────────────────────┘

PHASE 1: DATABASE & AUTH FOUNDATION (Week 1)
├── Create schema migration (7 tables)
│   ├── social_media_accounts
│   ├── social_media_posts
│   ├── social_media_analytics
│   ├── oauth_state_tracker
│   ├── publishing_queue
│   ├── rate_limit_tracker
│   └── RLS policies
├── Set up Supabase Vault for token encryption
├── Create rate limiting SQL functions
├── Test schema with dummy data
└── Status: 🔒 SECURE FOUNDATION

PHASE 2: INSTAGRAM INTEGRATION (Week 2)
├── Create Meta App (Facebook Developers)
│   ├── Get App ID & App Secret
│   ├── Configure Instagram Content Publishing
│   └── Set up OAuth redirect URLs
├── Build Edge Function: social-instagram-publish
│   ├── OAuth flow (connect, callback)
│   ├── Token refresh mechanism
│   └── Publishing logic (single, carousel, story)
├── Test OAuth flow in sandbox
├── Test publishing with test account
└── Status: ✅ INSTAGRAM LIVE

PHASE 3: UI COMPONENTS (Week 3)
├── Account Connection Page
│   ├── /settings/social-media route
│   ├── List connected accounts
│   ├── Connect/disconnect buttons
│   └── Token status display
├── Publish Modal Component
│   ├── Platform selection
│   ├── Caption editor
│   ├── Image reordering
│   ├── Rate limit warning
│   └── Publish/schedule buttons
├── Publishing Progress Modal
│   ├── Real-time status updates
│   ├── Progress bars
│   └── Error handling display
├── Publishing Dashboard
│   ├── Recent posts list
│   ├── Analytics cards
│   └── Engagement metrics
└── Status: 🎨 UI COMPLETE

PHASE 4: LINKEDIN INTEGRATION (Week 4)
├── Create LinkedIn App
├── Build Edge Function: social-linkedin-publish
├── Integrate into UI (checkbox in publish modal)
├── Test cross-platform publishing
└── Status: 💼 LINKEDIN LIVE

PHASE 5: FACEBOOK INTEGRATION (Week 4)
├── Extend Meta App for Facebook Pages
├── Update Edge Function for Facebook API
├── UI updates (Facebook option)
└── Status: 📘 FACEBOOK LIVE

PHASE 6: QUEUE & SCHEDULING (Week 5)
├── Build publishing worker (Edge Function + Cron)
├── Implement retry logic
├── Add scheduled posting UI
├── Test queue under load
└── Status: 🗓️ SCHEDULING LIVE

PHASE 7: ANALYTICS SYNC (Week 6)
├── Build analytics sync worker (daily cron)
├── Fetch engagement metrics from platforms
├── Store in social_media_analytics table
├── Display in UI dashboard
└── Status: 📊 ANALYTICS LIVE

PHASE 8: BUFFER INTEGRATION (Optional - Week 7)
├── Create Buffer API account
├── Build proxy function for Twitter/X
├── Add Pinterest, TikTok options
└── Status: 🐦 EXTENDED PLATFORMS

PHASE 9: POLISH & OPTIMIZATION (Week 8)
├── Error handling improvements
├── Loading states & animations
├── Mobile responsive refinements
├── Performance optimization
├── Documentation
└── Status: 💎 PRODUCTION READY

PHASE 10: LAUNCH (Week 9)
├── Deploy to production
├── Monitor error logs
├── Collect user feedback
├── Iterate based on analytics
└── Status: 🚀 LIVE
```

### Estimated Timeline: 8-10 weeks for full implementation

### Team Requirements:
- 1x Backend Developer (Edge Functions, SQL, API integrations)
- 1x Frontend Developer (React, TypeScript, UI components)
- 0.5x DevOps (Supabase config, secrets management, cron jobs)
- 0.5x QA (Testing OAuth flows, rate limiting, error cases)

---

## 📝 SUMMARY

### What We're Building:
A **one-click social media publishing system** that allows users to:
1. Connect Instagram, Facebook, LinkedIn, Twitter/X accounts via OAuth
2. Publish image sets to multiple platforms simultaneously
3. Schedule posts for future dates/times
4. Track engagement metrics and analytics
5. Manage rate limits automatically
6. Retry failed posts intelligently

### Core Architecture:
- **Database:** 7 new tables (accounts, posts, analytics, queue, rate limits)
- **Backend:** Supabase Edge Functions (OAuth, publishing, workers)
- **Security:** Vault encryption, RLS policies, token rotation
- **APIs:** Direct integration (Instagram/Facebook/LinkedIn) + Buffer proxy (Twitter/X)
- **Queue:** Priority-based async publishing with retries
- **UI:** 5 major components (settings, modal, progress, success, dashboard)

### Key Innovation:
**Hybrid Integration Model** balances:
- Cost (free APIs where possible, cheap third-party for expensive ones)
- Control (direct APIs for core platforms)
- Coverage (third-party proxy for extended reach)

### Next Steps:
1. Review this architecture document
2. Confirm platform priorities (Instagram first? All at once?)
3. Approve database schema design
4. Begin Phase 1 implementation

---

**Questions? Concerns? Adjustments needed?**  
Reply with your feedback and we'll refine the plan before implementation begins.

