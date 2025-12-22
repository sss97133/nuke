# Instagram Integration - Quick Setup Checklist

## ✅ Your Configuration

**Facebook App ID**: `9b0118aa9df248469f59c4ce9f1efe91`  
**Callback URL**: `https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback`

## Step 1: Meta App Dashboard Setup

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Select your app (App ID: `9b0118aa9df248469f59c4ce9f1efe91`)
3. Go to **Settings** → **Basic**
4. Add to **"Valid OAuth Redirect URIs"**:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback
   ```
5. Save changes

## Step 2: Add Instagram Graph API Product

1. In your Meta App, go to **Products** → **Add Product**
2. Find **"Instagram Graph API"** → Click **"Set Up"**
3. Under **Settings**, add the same callback URL to **"Valid OAuth Redirect URIs"**

## Step 3: Set Environment Variables in Supabase

Go to Supabase Dashboard → Edge Functions → Secrets:

```bash
FACEBOOK_APP_ID=9b0118aa9df248469f59c4ce9f1efe91
FACEBOOK_APP_SECRET=<your_app_secret_from_meta_dashboard>

# Instagram Access Token (for direct API access)
INSTAGRAM_ACCESS_TOKEN=EAAG2H7d3KpkBQdMZC20WUWHuJqvDZA5Arh2BWUQ73YWQpgv6k9EwM07UFeSARVDJHwPOOkm5odMfnKtHMpJ6DRAODEI76u3ywDOO7fviTDCloXcDAFSKfmnm0KrWZCwZBETbFanTqJYoPzvNLuWG4LS3CZBccmkf0lcoySfApZBv3L7nwkXhRxblQvFXesi7EwvFMaoZAKsivmSYfGcP6S7bw7XAaChG3M066I3
```

**To get your App Secret:**
1. Go to Meta App Dashboard
2. Settings → Basic
3. Copy "App Secret" (click "Show" if hidden)

**Note**: The access token above is a long-lived token. It will expire in ~60 days. For production, use the OAuth flow to automatically refresh tokens.

## Step 4: Deploy Edge Functions

Deploy the Instagram functions:

```bash
supabase functions deploy instagram-oauth-callback
supabase functions deploy get-instagram-auth-url
supabase functions deploy sync-instagram-organization
supabase functions deploy detect-vehicles-in-content
supabase functions deploy backfill-instagram-content
supabase functions deploy process-instagram-webhook
```

## Step 5: Test OAuth Flow

1. Call `get-instagram-auth-url` to get OAuth URL
2. User visits URL and authorizes
3. Should redirect back to your site with token stored

## Step 6: Connect Organization

Once OAuth is working, link an organization:

```sql
-- After OAuth, the external_identity will be created automatically
-- Then link it to your organization:

UPDATE external_identities
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{organization_id}',
  '"39773a0e-106c-4afa-ae50-f95cbd74d074"'::jsonb
)
WHERE platform = 'instagram' 
  AND handle = 'lartdelautomobile';
```

## Step 7: Run Historical Sync

```typescript
// Sync all historical posts
await supabase.functions.invoke('backfill-instagram-content', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_handle: 'lartdelautomobile'
  }
});
```

## Troubleshooting

### "Invalid OAuth Redirect URI"
- Make sure callback URL matches exactly in Meta App settings
- Check for trailing slashes or http vs https

### "App Secret not configured"
- Set `FACEBOOK_APP_SECRET` in Supabase Edge Function secrets
- Get it from Meta App Dashboard → Settings → Basic

### "No Instagram Business Account"
- Instagram account must be Business or Creator account
- Must be connected to a Facebook Page
- Connect in Meta Business Suite if needed

## Next Steps

Once OAuth is working:
1. ✅ Connect organization to Instagram account
2. ✅ Run historical backfill
3. ✅ Set up webhook for real-time sync
4. ✅ Build frontend components to display content

