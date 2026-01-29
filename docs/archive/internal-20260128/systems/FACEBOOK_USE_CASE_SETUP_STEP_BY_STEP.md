# Facebook Graph API Use Case Setup - Step-by-Step

## Current Status

**App ID**: `481722314992281`  
**Business ID**: `572044852298191`  
**App Name**: `nuke`

You're currently on the **Facebook Login** use case page. We need to configure TWO separate use cases:

1. **Facebook Login** (for user profile data)
2. **Instagram Graph API** (for Instagram Business accounts) - THIS IS THE MAIN ONE

---

## Part 1: Instagram Graph API Setup (MOST IMPORTANT)

### Step 1: Navigate to Instagram Use Case

1. Go to: https://developers.facebook.com/apps/481722314992281/use_cases/
2. Look for **"Instagram Graph API"** in the use cases list
3. Click **"Set Up"** or **"Configure"**

**If you don't see "Instagram Graph API":**
1. Go to **Products** → **Add Product**
2. Find **"Instagram Graph API"** → Click **"Set Up"**
3. This will create the Instagram use case

### Step 2: Configure Instagram Graph API Permissions

Once in the Instagram Graph API use case:

Go to: **Permissions and Features**

**Request these permissions:**

1. **`instagram_basic`** ✅ (Usually already approved)
   - **Use Case**: "We need to read basic information about Instagram Business accounts to connect them with vehicle profiles in our platform."
   
2. **`instagram_content_publish`** ✅ (If you want to publish)
   - **Use Case**: "We allow users to publish vehicle-related content from our platform to their Instagram accounts."

3. **`instagram_manage_comments`** 🔄 (Request this)
   - **Use Case**: "We monitor comments on Instagram posts to detect vehicle mentions (make, model, year) and help users link their Instagram activity to vehicle profiles in our system."
   - **Data Usage**: "We analyze comment text to identify vehicle-related keywords and suggest connections between Instagram posts and vehicle profiles."

4. **`instagram_manage_insights`** 🔄 (Request this - IMPORTANT!)
   - **Use Case**: "We analyze engagement metrics (likes, comments, reach) to identify high-quality automotive content creators and influencers in the luxury/exotic vehicle space. This helps us connect quality Instagram accounts with vehicle profiles."
   - **Data Usage**: "We store aggregated engagement metrics (likes, comments, reach) to rank and identify active Instagram users in the automotive community. This data helps match users with vehicles and identify valuable content creators."

5. **`pages_read_engagement`** ✅ (Usually already approved)
   - **Use Case**: "We need to read Facebook Page engagement data because Instagram Business accounts are connected to Facebook Pages."

### Step 3: Fill Out Instagram App Review Forms

For each permission that needs review (`instagram_manage_comments`, `instagram_manage_insights`):

**Use Case Description:**
```
Our platform connects automotive enthusiasts with their vehicles through Instagram integration. When users connect their Instagram Business accounts, we:

1. Sync their Instagram posts containing vehicle images
2. Use AI to detect vehicles in images and automatically link posts to vehicle profiles
3. Extract location data from posts for geo-tagging (e.g., "show all red cars in Las Vegas")
4. Analyze engagement metrics to identify high-quality automotive content creators
5. Monitor comments to detect vehicle mentions and help users connect their social activity with their vehicle collections

Example: A user posts an image of their Ferrari at a car show in Las Vegas. Our system:
- Detects it's a Ferrari from the image
- Extracts location "Las Vegas" from post metadata
- Links the post to their Ferrari vehicle profile
- Analyzes engagement to rank them as a quality creator
```

**Data Usage:**
```
- Instagram post data (images, captions, location): Stored to link posts with vehicle profiles
- Engagement metrics (likes, comments, reach): Used to identify high-quality accounts and rank content creators
- Comment data: Analyzed to detect vehicle mentions and help users connect their social activity
- Location data: Extracted for geo-tagging functionality (e.g., "red cars in Las Vegas")
- Account metadata: Stored to maintain connection between Instagram accounts and vehicle profiles

We do NOT:
- Sell user data
- Use data for advertising targeting
- Share data with third parties
```

**Screenshots/Videos Needed:**
- Screenshot of your app showing Instagram connection flow
- Video showing how vehicle detection works in Instagram posts
- Screenshot of geo-tagging feature

---

## Part 2: Facebook Login Use Case (Secondary)

You're currently on this page. For your goals, you need these permissions:

### Permissions to Request/Configure:

#### Required for Your Use Case:

1. **`public_profile`** ✅ (Auto-approved)
   - Already configured - this is automatic

2. **`email`** 🔄 (Request if needed)
   - **Use Case**: "We need email addresses for user account verification when users log in with Facebook. This ensures each user has a unique account in our platform."
   - **Data Usage**: "Email addresses are stored in our database for account authentication and communication. We do not share emails with third parties."

3. **`user_location`** 🔄 (Request this for geo-tagging)
   - **Use Case**: "We use the user's current city location to pre-fill location data when they're creating vehicle profiles or searching for vehicles. This enhances the geo-tagging and location-based filtering features."
   - **Data Usage**: "Location data (city name only) is stored in user profiles and used for location-based features like 'show all red cars in Las Vegas'. We do not use this for advertising targeting."

4. **`user_photos`** 🔄 (Optional - for profile pictures)
   - **Use Case**: "We use Facebook profile photos as default avatar images when users log in with Facebook."
   - **Data Usage**: "Profile photos are downloaded and stored locally. We do not share these images."

5. **`user_posts`** 🔄 (Optional - only if you want to sync Facebook posts)
   - **Use Case**: "We allow users to sync their Facebook posts that contain vehicle images, similar to our Instagram integration."
   - **Data Usage**: "Facebook post data is stored to link posts with vehicle profiles, same as Instagram functionality."

#### Not Needed (Skip These):

- ❌ `user_birthday` - Not needed for your use case
- ❌ `user_age_range` - Not needed
- ❌ `user_gender` - Not needed
- ❌ `user_hometown` - Not needed (use `user_location` instead)
- ❌ `user_friends` - Deprecated, not useful
- ❌ `user_likes` - Not needed
- ❌ `user_videos` - Not needed (Instagram handles video)

### Fill Out Facebook Login App Review Forms:

For permissions requiring review:

**Overall Use Case Description:**
```
Our automotive platform allows users to connect their social media accounts to their vehicle profiles. When users log in with Facebook, we:

1. Use email for account verification and authentication
2. Use location (city) to pre-fill location preferences for geo-tagging features
3. Optionally sync Facebook posts containing vehicle images (similar to Instagram integration)
4. Use profile photos as default avatars

The primary goal is to help automotive enthusiasts link their social media activity (photos, posts, location) with their vehicle collections for better organization and discovery.
```

---

## Part 3: Complete Configuration Checklist

### Instagram Graph API:
- [ ] Product added: "Instagram Graph API"
- [ ] Use case created and configured
- [ ] `instagram_basic` - Approved
- [ ] `instagram_content_publish` - Requested/Approved (if needed)
- [ ] `instagram_manage_comments` - **REQUEST THIS** (fill out review form)
- [ ] `instagram_manage_insights` - **REQUEST THIS** (fill out review form) ⭐ MOST IMPORTANT
- [ ] `pages_read_engagement` - Approved

### Facebook Login:
- [ ] Use case configured
- [ ] `public_profile` - Auto-approved ✅
- [ ] `email` - Requested (if needed)
- [ ] `user_location` - **REQUEST THIS** (for geo-tagging)
- [ ] `user_photos` - Optional
- [ ] `user_posts` - Optional (only if syncing Facebook posts)

### Advanced Settings:
- [ ] OAuth Redirect URI configured: `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback`
- [ ] App Domains configured
- [ ] Client Token saved: `960118a09df2484695904c9f1ef91`

---

## Part 4: Quick Navigation Links

### Direct Links to Configure:

1. **Instagram Graph API Use Case:**
   https://developers.facebook.com/apps/481722314992281/use_cases/
   (Look for "Instagram Graph API" in the list)

2. **Facebook Login Use Case (Current Page):**
   https://developers.facebook.com/apps/481722314992281/use_cases/customize/?use_case_enum=FB_LOGIN

3. **Add Products:**
   https://developers.facebook.com/apps/481722314992281/settings/basic/

4. **App Review (Submit for Approval):**
   https://developers.facebook.com/apps/481722314992281/app-review/

---

## Part 5: What to Click (Simplified)

### For Instagram API (Priority #1):

1. **Go to Products** → Add **"Instagram Graph API"** if not added
2. **Go to Use Cases** → Click **"Instagram Graph API"**
3. **Click "Permissions and Features"** tab
4. For each permission that says "Request" or "Ready for testing":
   - Click the **Actions** dropdown
   - Click **"Request Permissions"** or **"Edit"**
   - Fill in the use case description (copy from above)
   - Upload screenshots if requested
   - Click **"Submit for Review"**

### For Facebook Login (Priority #2):

1. You're already on this page
2. For each permission you need:
   - Click **Actions** dropdown
   - Click **"Request Permissions"**
   - Fill in use case (copy from above)
   - Submit

---

## Important Notes

⚠️ **Key Distinction:**
- **Instagram Graph API** = Access Instagram Business account posts, insights, comments
- **Facebook Login** = Access Facebook user profile data when they log in

For your goals (finding Instagram users, geo-tagging, connecting with vehicles), you primarily need **Instagram Graph API** permissions, not Facebook Login.

⚠️ **App Review Timeline:**
- Some permissions may be approved instantly ("Ready for testing")
- Others require review (1-7 business days typically)
- Be thorough in your use case descriptions

⚠️ **Testing:**
- Even if permissions show "Ready for testing", you may need to request them formally
- Some permissions work in development mode but need review for production

---

## Next Steps After Configuration

1. **Test OAuth Flow:**
   ```bash
   curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/get-instagram-auth-url \
     -H "Content-Type: application/json" \
     -d '{"user_id": "test-user-id"}'
   ```

2. **Verify Permissions:**
   - Complete OAuth flow
   - Check if token includes requested permissions
   - Test API calls with the token

3. **Implement Location Extraction:**
   - Update sync functions to extract location from Instagram posts
   - Store location data for geo-tagging queries

---

**Remember**: The Instagram API permissions are more important for your goals than Facebook Login permissions. Focus on getting `instagram_manage_insights` approved - that's the key one for finding quality accounts!
