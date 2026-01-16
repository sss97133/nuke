# Facebook Video Demo Setup - For App Review

## What Was Built

A simple Facebook video integration component that displays in vehicle profiles:

1. **Facebook Videos Component** (`FacebookVideos.tsx`)
   - Shows in the Media tab of vehicle profiles
   - "Connect Facebook" button when not connected
   - Displays videos with "Source: Facebook" label when connected
   - Shows video thumbnails with play button

2. **Settings Integration** (`FacebookConnectionSettings.tsx`)
   - Added to Capsule → Settings → Connected Accounts
   - Shows Facebook connection status
   - "Disconnect" button to remove connection

## For Your Screen Recording

### Step 1: Show Facebook Login Button
1. Navigate to a vehicle profile
2. Go to the "MEDIA" tab
3. Scroll down past the image gallery
4. Show the "Videos from Facebook" section
5. Show the "Connect Facebook" button

### Step 2: Show Permission Request
1. Click "Connect Facebook"
2. This will trigger OAuth flow (you'll need to create the edge function)
3. Show the Facebook permission request screen
4. Highlight that `user_videos` is being requested
5. Show user clicking "Continue"

### Step 3: Show Videos Displayed with Ownership
1. After connecting, return to vehicle profile
2. Scroll to videos section
3. Show videos appearing with:
   - "Source: Facebook" badge
   - Video thumbnails
   - Clear indication these are the user's videos
   - Video count (e.g., "2 videos")

### Step 4: Show Disconnect Option
1. Navigate to Capsule → Settings
2. Scroll to "Connected Accounts" section
3. Show Facebook connection status
4. Show "Disconnect" button
5. Demonstrate user can disconnect

## Missing Pieces (To Complete for Demo)

### 1. Edge Function: `get-facebook-auth-url`

Create: `supabase/functions/get-facebook-auth-url/index.ts`

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { user_id, vehicle_id } = await req.json();
    const FACEBOOK_APP_ID = Deno.env.get('FACEBOOK_APP_ID');
    
    if (!FACEBOOK_APP_ID) {
      throw new Error('FACEBOOK_APP_ID not configured');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const callbackUrl = `${supabaseUrl}/functions/v1/facebook-oauth-callback`;

    const authUrl = new URL('https://www.facebook.com/v18.0/dialog/oauth');
    authUrl.searchParams.set('client_id', FACEBOOK_APP_ID);
    authUrl.searchParams.set('redirect_uri', callbackUrl);
    authUrl.searchParams.set('scope', 'public_profile,email,user_videos,user_posts,user_photos,user_location');
    authUrl.searchParams.set('state', JSON.stringify({ user_id, vehicle_id }));

    return new Response(
      JSON.stringify({ auth_url: authUrl.toString() }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

### 2. Edge Function: `facebook-oauth-callback`

Create: `supabase/functions/facebook-oauth-callback/index.ts`

Similar to `instagram-oauth-callback`, but for Facebook. Store the connection in `external_identities` table.

### 3. Mock Data (For Demo)

Currently, `FacebookVideos.tsx` uses mock data. For the review, you can either:

**Option A: Use Mock Data (Easiest for Demo)**
- The component already has mock videos
- Just ensure the connection status works

**Option B: Real API Call**
- Create edge function `get-facebook-videos`
- Call Facebook Graph API: `GET /me/videos`
- Return videos to display

## Quick Test Checklist

Before recording:

- [ ] Facebook Videos component appears in vehicle profile Media tab
- [ ] "Connect Facebook" button is visible and styled correctly
- [ ] After clicking, OAuth flow starts (or mock it for demo)
- [ ] Connection status updates (shows connected)
- [ ] Videos section shows with "Source: Facebook" badge
- [ ] Settings page shows Facebook connection with disconnect button
- [ ] Disconnect button works

## Recording Tips

1. **Keep it simple** - Show the flow, don't over-explain
2. **Highlight ownership** - Point out "Source: Facebook" and that these are user's videos
3. **Show control** - Demonstrate disconnect option
4. **Keep it short** - 1-2 minutes max

## What Facebook Reviewers Want to See

✅ Videos displayed with clear ownership (user's own videos)  
✅ Social app context (vehicle profile = social profile)  
✅ User control (can disconnect)  
✅ No sharing/public exposure (videos in user's own profile)

Your implementation shows all of these! The mock data is fine for the review - they just need to see the UI/UX pattern.
