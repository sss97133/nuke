# Facebook Graph API Setup - Quick Checklist

## ✅ What You Already Have

- ✅ Facebook App ID: `9b0118aa9df248469f59c4ce9f1efe91`
- ✅ OAuth callback URL configured
- ✅ Instagram Graph API product added
- ✅ OAuth scope includes: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`, `instagram_manage_comments`, `instagram_manage_insights`

## 🎯 What You Need to Do RIGHT NOW

### Step 1: Go to Meta App Dashboard
1. Visit: https://developers.facebook.com/apps/
2. Select your app: **9b0118aa9df248469f59c4ce9f1efe91**

### Step 2: Request Permissions (App Review)

Go to **App Review** → **Permissions and Features**

**Request these permissions:**

1. **`instagram_manage_insights`** (if not already approved)
   - **Use Case**: "We need to identify high-engagement Instagram accounts to connect with vehicle profiles. We analyze engagement metrics (likes, comments, reach) to find quality automotive content creators."
   - **What we do with data**: "We store aggregated engagement metrics to help identify active Instagram users in the automotive community. This helps us match users with their vehicles."

2. **`instagram_manage_comments`** (if not already approved)
   - **Use Case**: "We monitor comments on vehicle-related posts to identify potential vehicle owners and enthusiasts."
   - **What we do with data**: "We analyze comments to detect mentions of vehicle makes/models and help users connect their Instagram activity with vehicle profiles."

### Step 3: Verify Basic Settings

Go to **Settings** → **Basic**

✅ **App Domains**: Should include your Supabase domain  
✅ **Valid OAuth Redirect URIs**: Should include:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback
   ```

### Step 4: Set App Review Use Cases

For each permission you request, Meta will ask:

1. **What data do you need?**
   - Instagram Business Account insights (engagement, reach)
   - Post location data (for geo-tagging)
   - Comment data (to identify vehicle mentions)

2. **How do you use it?**
   - Match Instagram accounts with vehicle profiles
   - Filter vehicle posts by location (e.g., "red cars in Las Vegas")
   - Identify high-quality automotive content creators

3. **Privacy Policy**
   - Make sure your privacy policy mentions Instagram data collection
   - Explain you store Instagram account IDs and public post data

### Step 5: Test Your Setup

```bash
# Test OAuth flow
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/get-instagram-auth-url \
  -H "Content-Type: application/json" \
  -d '{"user_id": "test-user-id"}'

# Visit the returned auth_url in browser
# Complete OAuth flow
# Check if token is stored
```

## ⚠️ Important Reality Check

### What You CAN Do:
✅ Access Instagram Business Account posts (when connected)  
✅ Extract location data from posts (for geo-tagging)  
✅ Analyze engagement metrics (for finding quality accounts)  
✅ Detect vehicles in Instagram images (your existing functionality)  
✅ Link Instagram accounts to vehicle profiles (via OAuth)

### What You CANNOT Do:
❌ Search Instagram users by demographics without their login  
❌ Access Facebook user profiles without explicit user login  
❌ Browse Instagram user directory  
❌ Get demographic data for targeting (requires Marketing API, different product)

## 🚀 Recommended Next Steps

1. **Complete App Review** for `instagram_manage_insights`
2. **Test OAuth flow** with a real Instagram Business Account
3. **Implement location extraction** from Instagram posts
4. **Build geo-filtering queries** in your database
5. **Create hashtag monitoring** system for automotive content

## Need Help?

See the detailed guide: `FACEBOOK_GRAPH_API_PERMISSIONS_SETUP.md`

---

**Remember**: Facebook/Instagram API is designed for accounts YOU manage or users who EXPLICITLY connect via OAuth. You can't browse random user profiles - that's intentional privacy protection.
