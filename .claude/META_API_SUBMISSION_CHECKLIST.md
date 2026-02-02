# Meta Graph API Permission Submission Checklist

**Goal**: Get Instagram Business API permissions approved for Nuke vehicle platform.

**Time estimate**: 10-15 minutes (assuming functions deployed + screenshots ready)

---

## PRE-FLIGHT CHECK

### 1. Deploy Instagram OAuth Callback Function

**Status**: ⚠️ BLOCKER - Function exists but not deployed

```bash
cd /Users/skylar/nuke
supabase functions deploy instagram-oauth-callback --no-verify-jwt
```

**Expected result**: Function deployed with ID and URL shown

### 2. Verify OAuth Callback URLs

**Facebook OAuth Callback URL**:
```
https://qkgaybvrernstplzjaam.supabase.co/functions/v1/facebook-oauth-callback
```

**Instagram OAuth Callback URL**:
```
https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback
```

**Action**: Confirm these URLs are whitelisted in Meta App Settings:
- Go to: https://developers.facebook.com/apps/481722314992281/fb-login/settings/
- Check "Valid OAuth Redirect URIs" includes both URLs above

### 3. Prepare Screenshots

You'll need screenshots showing:

**Screenshot 1**: Instagram Business account connection flow
- Your app showing "Connect Instagram" button
- OAuth permission dialog
- Success state showing connected account

**Screenshot 2**: Vehicle detection in action
- Instagram post with vehicle image
- Your platform showing the detected vehicle linked to the post
- Location tags visible

**Screenshot 3**: Engagement metrics dashboard (if available)
- View showing Instagram post engagement
- How it ranks content creators

**Screenshot 4**: Comment analysis feature (if built)
- Instagram comments displayed
- Vehicle mention detection highlighted

---

## PART 1: INSTAGRAM GRAPH API PERMISSIONS

### Permission 1: `instagram_manage_insights` ⭐ MOST IMPORTANT

**URL to visit**: https://developers.facebook.com/apps/481722314992281/use_cases/

**Steps**:
1. Click on "Instagram Graph API" use case
2. Click "Permissions and Features" tab
3. Find `instagram_manage_insights` in the list
4. Click "Actions" dropdown → "Request Permissions"
5. Fill out the form:

**App Use Case - How your app uses this permission** (copy this exactly):
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

**Data Use - How your app uses data from this permission** (copy this exactly):
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

6. Upload screenshots (1-3 screenshots showing the feature in action)
7. Click "Submit for Review"

---

### Permission 2: `instagram_manage_comments`

**Same URL**: https://developers.facebook.com/apps/481722314992281/use_cases/

**Steps**:
1. Still in "Instagram Graph API" use case → "Permissions and Features" tab
2. Find `instagram_manage_comments` in the list
3. Click "Actions" dropdown → "Request Permissions"
4. Fill out the form:

**App Use Case** (copy this exactly):
```
We monitor comments on Instagram posts to detect vehicle mentions (make, model, year) and help users link their Instagram activity to vehicle profiles in our system.

When a user comments on a vehicle-related post mentioning a specific car (e.g., "This Ferrari is beautiful!"), our system analyzes the comment text to identify vehicle references and suggests connecting the post to the appropriate vehicle profile.
```

**Data Use** (copy this exactly):
```
- Comment text: Analyzed to detect vehicle mentions (make, model, year) using natural language processing
- Comment metadata: Stored temporarily to identify vehicle-related discussions
- We use this data solely to help users connect their Instagram activity with their vehicle profiles
- Comments are not shared with third parties or used for advertising
```

5. Upload screenshots (showing comment analysis if available)
6. Click "Submit for Review"

---

## PART 2: FACEBOOK LOGIN PERMISSIONS

### Permission 3: `user_location`

**URL to visit**: https://developers.facebook.com/apps/481722314992281/use_cases/customize/?use_case_enum=FB_LOGIN

**Steps**:
1. You should see "Facebook Login" use case
2. Find `user_location` permission
3. Click "Actions" dropdown → "Request Permissions"
4. Fill out the form:

**App Use Case** (copy this exactly):
```
We use the user's current city location to pre-fill location data when they're creating vehicle profiles or searching for vehicles. This enhances the geo-tagging and location-based filtering features.

For example, if a user's Facebook profile shows they're located in Las Vegas, when they search for "red cars" on our platform, we can automatically filter results to show red cars in Las Vegas.
```

**Data Use** (copy this exactly):
```
- Location data (city name only): Stored in user profiles for geo-tagging functionality
- Used for location-based filtering (e.g., "show all red cars in Las Vegas")
- Used to pre-fill location preferences when users create vehicle profiles
- Location data is NOT used for advertising targeting
- Location data is NOT shared with third parties
```

5. Upload screenshots (showing location-based search/filtering)
6. Click "Submit for Review"

---

### Permission 4: `email` (if not already approved)

**Same URL**: https://developers.facebook.com/apps/481722314992281/use_cases/customize/?use_case_enum=FB_LOGIN

**Steps**:
1. Find `email` permission
2. If it shows "Approved" - skip this
3. If not approved, click "Actions" → "Request Permissions"
4. Fill out:

**App Use Case** (copy this exactly):
```
We need email addresses for user account verification when users log in with Facebook. This ensures each user has a unique account in our platform and allows us to send important notifications about their vehicle profiles and Instagram integration.
```

**Data Use** (copy this exactly):
```
- Email addresses are stored in our database for account authentication and communication
- Used to send notifications about vehicle profile updates and Instagram content synchronization
- Emails are NOT shared with third parties
- Emails are NOT used for marketing without explicit user consent
```

5. Upload screenshots (showing login flow)
6. Click "Submit for Review"

---

### Permission 5: `user_photos` (OPTIONAL - skip if not needed)

**Same URL**: https://developers.facebook.com/apps/481722314992281/use_cases/customize/?use_case_enum=FB_LOGIN

**Steps**:
1. Find `user_photos` permission
2. Click "Actions" → "Request Permissions"
3. Fill out:

**App Use Case** (copy this exactly):
```
We use Facebook profile photos as default avatar images when users log in with Facebook. This provides a better user experience by using their existing social media profile picture.
```

**Data Use** (copy this exactly):
```
- Profile photos are downloaded and stored locally in our system
- Used only as default avatar images for user accounts
- Photos are NOT shared with third parties
- Photos are NOT used for any other purpose beyond user avatars
```

4. Upload screenshots (showing user profile with avatar)
5. Click "Submit for Review"

---

## PART 3: AUTO-APPROVED PERMISSIONS (verify these are enabled)

These should already be approved, but verify in the console:

**Instagram**:
- ✅ `instagram_basic` (usually auto-approved)
- ✅ `pages_read_engagement` (usually auto-approved)

**Facebook Login**:
- ✅ `public_profile` (auto-approved)

**Where to check**:
- https://developers.facebook.com/apps/481722314992281/use_cases/

Look for green checkmarks or "Approved" status next to these permissions.

---

## PART 4: APP PRIVACY POLICY & TERMS

Meta requires these URLs to be public and accessible:

**Check these are configured**:
1. Go to: https://developers.facebook.com/apps/481722314992281/settings/basic/
2. Verify these fields are filled:
   - **Privacy Policy URL**: [Your privacy policy URL]
   - **Terms of Service URL**: [Your terms URL]
   - **User Data Deletion**: Callback URL or instructions URL

**If missing**: You'll need to add these URLs before Meta will approve permissions.

---

## PART 5: APP SUBMISSION CHECKLIST

Before clicking "Submit All":

- [ ] Instagram OAuth callback function deployed
- [ ] Facebook OAuth callback function deployed (already done ✅)
- [ ] Both callback URLs whitelisted in Meta App Settings
- [ ] Privacy Policy URL added to Meta App Settings
- [ ] Terms of Service URL added to Meta App Settings
- [ ] User Data Deletion callback configured
- [ ] Screenshots prepared (3-4 showing features in action)
- [ ] Test Instagram connection flow works end-to-end
- [ ] All permission justifications copied exactly from above

---

## TESTING BEFORE SUBMISSION

Run this test flow to ensure everything works:

```bash
# 1. Test the OAuth callback URLs are accessible
curl -I https://qkgaybvrernstplzjaam.supabase.co/functions/v1/facebook-oauth-callback
curl -I https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback

# Expected: 400 (missing code/state) but function is alive
```

**Manual test**:
1. Go to your app's Instagram connection page
2. Click "Connect Instagram"
3. Complete OAuth flow
4. Verify you're redirected back to your app
5. Verify Instagram account appears as connected

---

## REVIEW TIMELINE

**Typical Meta review time**: 3-7 days

**What happens next**:
1. Meta reviews your submission
2. They may request additional info or screenshots
3. You'll get email notification when approved/rejected
4. If rejected, address feedback and resubmit

---

## QUICK REFERENCE

**Meta App ID**: `481722314992281`

**Key URLs**:
- App Dashboard: https://developers.facebook.com/apps/481722314992281/
- Instagram Use Case: https://developers.facebook.com/apps/481722314992281/use_cases/
- FB Login Use Case: https://developers.facebook.com/apps/481722314992281/use_cases/customize/?use_case_enum=FB_LOGIN
- App Settings: https://developers.facebook.com/apps/481722314992281/settings/basic/

**Callback URLs**:
- Facebook: `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/facebook-oauth-callback`
- Instagram: `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback`

**Permissions requesting**:
1. `instagram_manage_insights` ⭐ PRIMARY
2. `instagram_manage_comments` ⭐ PRIMARY
3. `user_location` (Facebook Login)
4. `email` (if not approved)
5. `user_photos` (optional)

---

## BLOCKERS TO RESOLVE FIRST

### 🚨 CRITICAL: Deploy instagram-oauth-callback

```bash
cd /Users/skylar/nuke
supabase functions deploy instagram-oauth-callback --no-verify-jwt
```

### ⚠️ VERIFY: Privacy Policy & Terms URLs

Check App Settings → Basic → ensure these are filled out.

### 📸 PREPARE: Screenshots

Take 3-4 screenshots showing:
- Instagram connection flow
- Vehicle detection from Instagram posts
- Engagement metrics dashboard
- Comment analysis (if built)

---

## COMPLETION CHECKLIST

- [ ] Pre-flight checks complete
- [ ] instagram-oauth-callback deployed
- [ ] Submitted `instagram_manage_insights` permission
- [ ] Submitted `instagram_manage_comments` permission
- [ ] Submitted `user_location` permission
- [ ] Submitted `email` permission (if needed)
- [ ] Verified auto-approved permissions enabled
- [ ] Privacy policy URL configured
- [ ] Terms of service URL configured
- [ ] Test OAuth flow end-to-end
- [ ] All submissions complete - waiting for Meta review

**When done**: You'll receive email notifications when Meta reviews each permission request.
