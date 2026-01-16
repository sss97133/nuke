# Facebook App Review - Complete Answers

Copy these answers directly into the App Review form. Each answer follows Facebook's guidelines and explains your legitimate use case.

---

## General App Information

### App can be loaded and tested externally:
**Answer:**
```
Yes, our app is publicly accessible at: https://qkgaybvrernstplzjaam.supabase.co

You can test the Facebook Login integration by:
1. Visiting our platform
2. Clicking "Connect with Facebook" or "Login with Facebook"
3. Completing the OAuth flow
4. Viewing your connected account in the user dashboard

The Facebook Login button is visible on our authentication page and follows Facebook's brand guidelines.
```

### Facebook Login button visibility and brand guidelines:
**Answer:**
```
Our Facebook Login button is prominently displayed on our authentication/login page. It uses the official Facebook Login button design and follows all Facebook Brand Guidelines:

- Uses official Facebook blue (#1877F2)
- Includes Facebook logo
- Uses approved button text ("Continue with Facebook" or "Log in with Facebook")
- Positioned clearly on the login page
- Links to our OAuth flow at: https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback

Screencast will show the button in action during the login flow.
```

### Clear use case details and step-by-step usage:
**Answer:**
```
USE CASE: Our platform connects automotive enthusiasts with their vehicle collections through social media integration.

STEP-BY-STEP USER FLOW:

1. User visits our platform and clicks "Login with Facebook"
2. User authorizes Facebook Login and grants requested permissions
3. User's Facebook account is connected to their profile in our system
4. User can then:
   - Connect their Instagram Business account (separate OAuth flow)
   - Create vehicle profiles (Ferrari, Lamborghini, etc.)
   - Link Instagram posts containing vehicle images to their vehicle profiles
   - Use geo-tagging to filter vehicles by location (e.g., "red cars in Las Vegas")
   - View their social media activity connected to their vehicle collection

EXAMPLE SCENARIO:
- User logs in with Facebook
- User connects Instagram account
- User posts a photo of their Ferrari at a car show in Las Vegas
- Our AI detects it's a Ferrari from the image
- System automatically links the Instagram post to their Ferrari vehicle profile
- Location "Las Vegas" is extracted and stored for geo-tagging
- User can now search "red cars in Las Vegas" and see their Ferrari

BENEFIT TO USER:
- Organize their vehicle collection with social media content
- Discover other enthusiasts in their area
- Track their automotive social media activity in one place
```

---

## Permission-Specific Answers

### public_profile
**Answer:**
```
We use public_profile to display basic user information when users log in with Facebook:

- User's name: Displayed in their profile and throughout the app
- Profile picture: Used as default avatar (if user_photos not granted, we use the profile picture URL from public_profile)
- Profile link: Stored for reference and displayed in user profiles

This data is essential for user identification and personalization. Users explicitly choose to log in with Facebook, so they understand we're accessing their public profile information.

Usage follows guidelines:
- Only accessed when user explicitly logs in with Facebook
- Data is stored securely in our database
- Users can disconnect their Facebook account at any time
- We do not share this data with third parties
```

### email
**Answer:**
```
We use email addresses for:

1. ACCOUNT VERIFICATION: Ensuring each user has a unique account in our system
2. AUTHENTICATION: Primary identifier for user accounts (along with Facebook ID)
3. NOTIFICATIONS: Sending important updates about:
   - Vehicle profile changes
   - Instagram content synchronization status
   - Account security alerts

Usage follows guidelines:
- Email is only requested when user explicitly logs in with Facebook
- User can see we're requesting email permission during OAuth
- Email is stored securely and encrypted
- Users receive email notifications only for account-related activities
- We do NOT use email for marketing without explicit consent
- Users can disconnect Facebook and remove their email from our system
- We do not share emails with third parties
```

### user_location
**Answer:**
```
We use user_location (current city) for:

1. GEO-TAGGING FEATURES: Pre-filling location preferences when users create vehicle profiles or search for vehicles
2. LOCATION-BASED FILTERING: Enabling features like "show all red cars in Las Vegas" or "exotic cars in Miami"
3. USER EXPERIENCE: Automatically setting location preferences based on user's Facebook profile location

EXAMPLE USE:
- User's Facebook profile shows location: "Las Vegas, NV"
- When user searches for "red cars", we can automatically filter to show red cars in Las Vegas
- When user creates a vehicle profile, location field is pre-filled with "Las Vegas"
- User can manually change location if desired

Usage follows guidelines:
- Only accessed when user explicitly grants permission during Facebook Login
- We only use city-level location (not precise coordinates)
- Location is stored in user profile and can be edited/deleted by user
- Location is NOT used for advertising targeting
- Location is NOT shared with third parties
- Users can revoke this permission at any time
```

### user_photos
**Answer:**
```
We use user_photos for:

1. PROFILE AVATARS: Using Facebook photos as default profile pictures when users log in
2. VEHICLE IMAGE DETECTION: When users connect their Facebook account, we can access photos they've posted that might contain vehicles
3. CONTENT SYNC: Syncing vehicle-related photos from Facebook to link with vehicle profiles (similar to Instagram integration)

EXAMPLE USE:
- User logs in with Facebook and grants user_photos permission
- We download their profile picture to use as avatar
- If user has posted photos of vehicles on Facebook, we can detect vehicles in those photos and suggest linking them to vehicle profiles
- Photos are stored locally in our system

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- Photos are downloaded and stored securely
- We only access photos the user has posted (not photos they're tagged in, unless they're the owner)
- Photos are used solely for the stated purposes (avatars, vehicle detection)
- Photos are NOT shared with third parties
- Users can revoke access at any time
- We respect user privacy settings on Facebook
```

### user_posts
**Answer:**
```
We use user_posts for:

1. VEHICLE CONTENT DETECTION: Analyzing posts users have made on Facebook to identify vehicle-related content
2. CONTENT SYNC: Syncing vehicle-related Facebook posts and linking them to vehicle profiles in our system
3. AUTOMATIC LINKING: When a user posts about a vehicle (with images), we can automatically detect the vehicle and link the post to their vehicle profile

EXAMPLE USE:
- User posts a photo of their Ferrari on Facebook with caption "My new ride!"
- Our system analyzes the post (image + text)
- AI detects it's a Ferrari from the image
- System automatically links the Facebook post to their Ferrari vehicle profile
- Post appears in their vehicle's "Social Media" section

Usage follows guidelines:
- Only accessed when user explicitly grants permission during Facebook Login
- We only access posts the user has created (not posts they're tagged in)
- Posts are analyzed to detect vehicle content using AI/image recognition
- Vehicle-related posts are linked to vehicle profiles
- Non-vehicle posts are ignored
- We do NOT republish or share posts without user consent
- Users can disconnect Facebook and remove all synced posts
- We respect user privacy settings
```

### user_videos
**Answer:**
```
We use user_videos for:

1. VEHICLE VIDEO DETECTION: Analyzing videos users have uploaded to Facebook to identify vehicle-related content
2. CONTENT SYNC: Syncing vehicle-related videos and linking them to vehicle profiles
3. MEDIA COLLECTION: Building a comprehensive media library for each vehicle profile (photos + videos)

EXAMPLE USE:
- User uploads a video of their Lamborghini on a track day
- Our system analyzes the video
- AI detects it's a Lamborghini
- System links the video to their Lamborghini vehicle profile
- Video appears in vehicle's media gallery

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- We only access videos the user has uploaded (not videos they're tagged in)
- Videos are analyzed to detect vehicle content
- Vehicle-related videos are linked to vehicle profiles
- We do NOT republish or share videos
- Users can disconnect and remove synced videos
- We respect user privacy settings
```

### user_link
**Answer:**
```
We use user_link for:

1. PROFILE REFERENCE: Storing the user's Facebook profile URL for reference
2. VERIFICATION: Displaying a link to user's Facebook profile in their account settings (for verification purposes)
3. USER IDENTITY: Helping users verify their connected Facebook account

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- Profile URL is stored and displayed in user's account settings
- Users can see their Facebook profile link in their account
- Link is used only for account verification and reference
- We do NOT share profile links with third parties
- Users can disconnect Facebook and remove the link
```

### user_likes
**Answer:**
```
We use user_likes for:

1. INTEREST DETECTION: Identifying Facebook Pages the user has liked that are related to automotive/vehicle brands
2. VEHICLE PREFERENCES: Understanding user's vehicle interests (e.g., if they like Ferrari's Facebook Page, they might own or be interested in Ferraris)
3. RECOMMENDATIONS: Suggesting relevant vehicle profiles or content based on their Facebook Page likes

EXAMPLE USE:
- User likes "Ferrari" Facebook Page
- Our system detects this interest
- When user creates a vehicle profile, we can suggest "Ferrari" as a brand
- We can show Ferrari-related content in their feed

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- We analyze likes to identify automotive-related interests
- This helps personalize the user experience
- We do NOT share like data with third parties
- Users can disconnect Facebook and remove this data
```

### user_hometown
**Answer:**
```
We use user_hometown for:

1. LOCATION CONTEXT: Understanding user's origin location for better geo-tagging
2. VEHICLE HISTORY: Some users have vehicles in their hometown (stored vehicles, family vehicles)
3. LOCATION PREFERENCES: Pre-filling location data when creating vehicle profiles

EXAMPLE USE:
- User's hometown is "Los Angeles, CA"
- When creating a vehicle profile, we can suggest Los Angeles as a location
- Useful for users who have vehicles in multiple locations

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- Used to enhance location-based features
- Stored in user profile and can be edited
- Not used for advertising targeting
- Not shared with third parties
```

### user_gender
**Answer:**
```
We use user_gender for:

1. DEMOGRAPHIC ANALYTICS: Understanding our user base (aggregated, anonymized statistics)
2. PERSONALIZATION: Some vehicle preferences may correlate with demographics (for recommendation purposes)
3. USER PROFILE: Displaying in user profile if they choose to share it

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- Used for aggregated analytics (not individual targeting)
- Stored in user profile (user can choose to hide it)
- NOT used for advertising targeting
- NOT shared with third parties
- Respects user privacy preferences
```

### user_friends
**Answer:**
```
We use user_friends for:

1. SOCIAL CONNECTIONS: Identifying if other users of our platform are Facebook friends
2. NETWORK FEATURES: Enabling users to see which of their Facebook friends also use our platform
3. COMMUNITY BUILDING: Helping automotive enthusiasts connect with friends who share their interests

EXAMPLE USE:
- User A and User B are Facebook friends
- Both use our platform
- They can see each other's public vehicle profiles
- They can connect and share vehicle-related content

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- We only access friends who also use our app (app-scoped friends)
- Used to enhance social features within our platform
- We do NOT access full friend lists
- We do NOT share friend data with third parties
- Users can disconnect and remove this data
- This permission is limited by Facebook's API (only shows friends who use the app)
```

### user_birthday
**Answer:**
```
We use user_birthday for:

1. AGE VERIFICATION: Ensuring users meet minimum age requirements (13+ for Facebook, may vary by jurisdiction)
2. USER PROFILE: Displaying birthday in user profile if they choose to share it
3. PERSONALIZATION: Sending birthday-related notifications or features (e.g., "Happy Birthday! Here's your vehicle collection summary")

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- Used primarily for age verification
- Stored in user profile (user can choose to hide it)
- NOT used for advertising targeting
- NOT shared with third parties
- We respect user privacy settings
```

### user_age_range
**Answer:**
```
We use user_age_range for:

1. AGE VERIFICATION: Ensuring users meet minimum age requirements without needing exact birthday
2. DEMOGRAPHIC ANALYTICS: Understanding our user base (aggregated, anonymized statistics)
3. CONTENT FILTERING: Ensuring age-appropriate content (if applicable)

Usage follows guidelines:
- Only accessed when user explicitly grants permission
- Used for age verification and aggregated analytics
- NOT used for individual targeting
- NOT shared with third parties
- We respect user privacy preferences
```

---

## Important Notes for Submission

1. **Screencast Requirements:**
   - Show Facebook Login button in your app
   - Demonstrate user logging in with Facebook
   - Show how permissions are used (e.g., displaying user location, syncing posts)
   - Show user can disconnect Facebook account

2. **Privacy Policy:**
   Make sure your privacy policy mentions:
   - What Facebook data you collect
   - How you use it
   - How users can delete it
   - That you don't share with third parties

3. **Test User:**
   - Provide a test Facebook account for reviewers
   - Make sure reviewers can access your app externally
   - Ensure all features work in testing mode

---

## Quick Copy Checklist

When filling out the form, you'll need to answer questions about:
- ✅ App accessibility (yes, publicly accessible)
- ✅ Facebook Login button (visible, follows guidelines)
- ✅ Use case (automotive platform connecting social media with vehicles)
- ✅ Each permission (use answers above)

Copy each answer from the sections above when prompted.
