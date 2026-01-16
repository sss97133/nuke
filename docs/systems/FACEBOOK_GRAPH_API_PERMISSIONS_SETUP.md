# Facebook Graph API Permissions Setup Guide

## Your Current Setup

**Facebook App ID**: `9b0118aa9df248469f59c4ce9f1efe91`  
**Callback URL**: `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback`

## Important Limitations to Understand

⚠️ **Critical Reality Check**: Facebook has heavily restricted access to user profile data and demographics due to privacy concerns. What you can access depends on:

1. **User Login** - Users must explicitly log in and grant permissions
2. **App Review** - Most demographic data requires Meta App Review
3. **Business Verification** - Some advanced features require business verification
4. **Instagram vs Facebook** - Instagram Graph API ≠ Facebook user profile API

## What You CAN Access (Without App Review)

### Basic Instagram Business Account Data
- Instagram Business Account information (when connected to your Facebook Page)
- Instagram posts, media, and insights (for accounts you manage)
- Public Instagram profile data (for accounts you have access to)

### Basic Facebook Data (Requires User Login)
- Basic profile info (when user logs in via Facebook Login)
  - Name, profile picture, email (if granted)
  - Public profile fields

## What You CANNOT Easily Access

❌ **Searching Facebook profiles by demographics** - Not available via API  
❌ **Browsing Instagram users by location/demographics** - Not available via API  
❌ **Accessing user profiles without their explicit login** - Privacy restriction  
❌ **Aggregated demographic data for targeting** - Requires Marketing API, not Graph API

## Recommended Approach for Your Goals

### Goal 1: Find High-Quality Instagram Users

**Strategy**: Use Instagram Hashtag/Location API + User-Generated Content

```
1. Use Instagram Graph API to:
   - Monitor hashtags related to luxury/exotic vehicles
   - Track location-based posts (e.g., car shows, dealerships)
   - Analyze engagement metrics to identify quality accounts

2. When users interact with your content:
   - Ask them to connect their Instagram via OAuth
   - Store their Instagram account info when they grant access
   - Build a database of engaged users over time
```

**Required Permissions**:
- `instagram_basic` - View Instagram Business Account
- `instagram_manage_insights` - View engagement metrics
- `pages_read_engagement` - Read Page engagement data

### Goal 2: Connect People with Vehicles

**Strategy**: Link Instagram profiles to vehicle profiles when:
- Users post about vehicles (via image detection)
- Users claim a vehicle as theirs
- Users interact with vehicle-related content

**Implementation**:
```sql
-- Link Instagram profile to vehicle
INSERT INTO vehicle_owners (
  vehicle_id,
  external_identity_id, -- Instagram account ID
  verified_at
) VALUES (...);
```

### Goal 3: Geo-Tagging & Location-Based Filtering

**Strategy**: Extract location data from Instagram posts

**Instagram Post Data Available**:
```json
{
  "location": {
    "id": "123456",
    "name": "Las Vegas, NV",
    "latitude": 36.1699,
    "longitude": -115.1398
  },
  "timestamp": "2024-01-15T10:30:00+0000"
}
```

**Required Permissions**:
- `instagram_basic` - Access post location data
- `instagram_manage_comments` - Access comments with location

## Step-by-Step Permission Setup in Meta App Dashboard

### Step 1: Navigate to App Review

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Select your app: **App ID**: `9b0118aa9df248469f59c4ce9f1efe91`
3. Go to **App Review** → **Permissions and Features**
4. Click **Request** next to permissions you need

### Step 2: Required Permissions for Your Use Case

#### For Instagram Content Access (Already Set Up ✅)
- ✅ `instagram_basic` - Basic Instagram account info
- ✅ `instagram_content_publish` - Post to Instagram (if needed)
- ✅ `pages_read_engagement` - Read Page engagement

#### For Advanced Instagram Features (Need Request)
- 🔄 `instagram_manage_comments` - Manage comments (for user interaction)
- 🔄 `instagram_manage_insights` - Access analytics (for finding quality accounts)

#### For Facebook User Profile Data (Requires App Review)
- ⚠️ `public_profile` - Basic profile (usually granted automatically)
- ⚠️ `user_location` - Current city (requires App Review + user login)
- ⚠️ `user_hometown` - Hometown (requires App Review + user login)
- ⚠️ `email` - Email address (requires App Review + user login)

### Step 3: App Review Requirements

For each permission requiring review, Meta will ask:

1. **Use Case**: Describe how you use the data
   - ✅ Example: "Connect Instagram users with their vehicles when they post car-related content"
   - ❌ Bad: "Search for users by demographics"

2. **Data Usage**: Explain what you do with the data
   - ✅ Example: "Store Instagram account ID to link posts to vehicle profiles"
   - ❌ Bad: "Build marketing lists"

3. **Privacy Policy**: Must include how you handle user data

4. **Screencast/Video**: Demonstrate your app using the permission

## Practical Setup for Your Goals

### Option A: Focus on Instagram Business Accounts (Recommended)

This works **without App Review** for most use cases:

1. **Your current setup already handles this!**
   - Instagram OAuth flow ✅
   - Access to Instagram Business Account posts ✅
   - Location data from posts ✅

2. **What you need to add**:
   ```typescript
   // In your sync-instagram-organization function
   // Add location extraction:
   const location = post.location ? {
     name: post.location.name,
     lat: post.location.latitude,
     lng: post.location.longitude
   } : null;
   
   // Store location with post
   await supabase.from('instagram_posts').insert({
     ...postData,
     location: location
   });
   ```

3. **For geo-filtering**:
   ```sql
   -- Find all red cars in Las Vegas
   SELECT v.*, ip.location
   FROM vehicles v
   JOIN vehicle_instagram_posts vip ON v.id = vip.vehicle_id
   JOIN instagram_posts ip ON vip.post_id = ip.id
   WHERE v.exterior_color ILIKE '%red%'
     AND ip.location->>'name' ILIKE '%Las Vegas%';
   ```

### Option B: Facebook Login for User Profiles (Requires App Review)

If you want users to log in with Facebook and share their profile:

1. **Add Facebook Login Product**:
   - Go to **Products** → **Add Product**
   - Select **Facebook Login** → **Set Up**

2. **Update OAuth Scope**:
   ```typescript
   // In get-instagram-auth-url/index.ts
   // Add Facebook permissions to scope:
   authUrl.searchParams.set('scope', 
     'instagram_basic,instagram_content_publish,pages_read_engagement,' +
     'instagram_manage_comments,instagram_manage_insights,' +
     'public_profile,user_location,email' // Facebook permissions
   );
   ```

3. **Request Permissions via App Review**:
   - For `user_location`: Explain you need location to match users with vehicles in their area
   - For `email`: Explain you need it for account verification

## Current Status & Next Steps

### ✅ What's Already Working
- Instagram OAuth flow
- Instagram Business Account access
- Post syncing functionality
- Basic Instagram data retrieval

### 🔄 What Needs Configuration
1. **Add Instagram Insights Permission**:
   - Go to App Review → Request `instagram_manage_insights`
   - Use case: "Identify high-engagement Instagram accounts for vehicle matching"

2. **Update OAuth Scope**:
   - Add `instagram_manage_insights` to your OAuth request
   - This enables finding quality accounts via engagement metrics

3. **Implement Location Extraction**:
   - Modify sync functions to extract location from posts
   - Store location data for geo-filtering queries

### ⚠️ What's NOT Possible (Current API Limitations)
- ❌ Searching users by demographics without them logging in
- ❌ Browsing Instagram user directory
- ❌ Accessing Facebook user profiles without explicit login
- ❌ Demographic targeting like Facebook Ads Manager

## Recommended Implementation Plan

### Phase 1: Instagram Content Strategy (Do This First)
1. ✅ Monitor hashtags: `#exoticcars`, `#supercars`, `#classiccars`
2. ✅ Track location-based posts from luxury car shows/events
3. ✅ Identify high-engagement accounts (likes, comments)
4. ✅ When users interact, ask them to connect Instagram

### Phase 2: User Connection Flow
1. User discovers your platform
2. User connects Instagram via OAuth (already built!)
3. System detects vehicle-related posts automatically
4. System suggests linking posts to vehicle profiles

### Phase 3: Geo-Tagging Implementation
1. Extract location from Instagram posts
2. Store in database with post data
3. Build queries to filter by location + vehicle attributes
4. Create frontend UI for geo-filtering

## Testing Your Setup

### Test Instagram OAuth Flow
```bash
# 1. Get OAuth URL
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/get-instagram-auth-url \
  -H "Content-Type: application/json" \
  -d '{"user_id": "your-user-id"}'

# 2. Visit the auth_url in browser
# 3. Authorize permissions
# 4. Check if token is stored in external_identities
```

### Test Instagram API Access
```bash
# Check if you can access Instagram Business Account
curl "https://graph.instagram.com/YOUR_IG_ACCOUNT_ID?fields=username,profile_picture_url&access_token=YOUR_TOKEN"
```

## Common Issues & Solutions

### Issue: "Permissions Not Granted"
**Solution**: User must explicitly authorize during OAuth. Make sure your scope includes all needed permissions.

### Issue: "Instagram Business Account Not Found"
**Solution**: 
- Account must be Instagram Business or Creator account
- Must be connected to a Facebook Page
- Verify in Meta Business Suite

### Issue: "Cannot Access User Demographics"
**Solution**: This is intentional by Meta. You can only access:
- Data from users who log in and grant permissions
- Public data from posts/hashtags/locations
- Analytics from accounts you manage

## Resources

- [Meta App Dashboard](https://developers.facebook.com/apps/)
- [Instagram Graph API Docs](https://developers.facebook.com/docs/instagram-api)
- [Facebook Graph API Permissions](https://developers.facebook.com/docs/permissions/reference)
- [App Review Guidelines](https://developers.facebook.com/docs/app-review)

## Summary

**Bottom Line**: Your Instagram setup is solid! For your goals:

1. ✅ **Finding quality Instagram users**: Use hashtag/location monitoring + engagement metrics
2. ✅ **Connecting with vehicles**: Your OAuth flow + image detection will handle this
3. ✅ **Geo-tagging**: Extract location from Instagram posts (already available in API)
4. ❌ **Facebook demographics**: Not directly accessible - focus on Instagram instead

Focus on the Instagram content strategy first, as it aligns better with Meta's API capabilities and doesn't require extensive App Review.
