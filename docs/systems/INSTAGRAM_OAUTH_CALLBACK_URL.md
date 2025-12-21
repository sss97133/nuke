# Instagram OAuth Callback URL

## Your Callback URL

Based on your Supabase project, your Instagram OAuth callback URL is:

```
https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback
```

## Where to Use This

### In Meta App Dashboard (Facebook/Instagram)

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Select your app
3. Go to **Settings** → **Basic**
4. Find **"Valid OAuth Redirect URIs"**
5. Add this URL:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback
   ```

### In Instagram Graph API Settings

1. In your Meta App, go to **Products** → **Instagram Graph API**
2. Under **Settings**, find **"Valid OAuth Redirect URIs"**
3. Add the same URL:
   ```
   https://qkgaybvrernstplzjaam.supabase.co/functions/v1/instagram-oauth-callback
   ```

## OAuth Flow

1. **User clicks "Connect Instagram"**
   - Frontend calls `get-instagram-auth-url` function
   - Function generates OAuth URL with state token
   - User redirected to Facebook login

2. **User authorizes**
   - Facebook redirects to callback URL
   - `instagram-oauth-callback` function receives code
   - Exchanges code for access token
   - Stores token in `external_identities.metadata`
   - Redirects user back to site

3. **Token stored**
   - Access token stored in `external_identities.metadata.access_token`
   - Instagram account ID stored in `metadata.instagram_account_id`
   - Token expires in 60 days (long-lived token)

## Required Environment Variables

Set these in Supabase Edge Function secrets:

```bash
FACEBOOK_APP_ID=9b0118aa9df248469f59c4ce9f1efe91
FACEBOOK_APP_SECRET=your_facebook_app_secret_here
```

**Your Facebook App ID**: `9b0118aa9df248469f59c4ce9f1efe91`

## Testing

After setting up the callback URL:

1. Call `get-instagram-auth-url` to get OAuth URL
2. User visits OAuth URL
3. Authorizes Instagram access
4. Redirected back to callback URL
5. Token stored automatically

## Security Notes

- State token prevents CSRF attacks
- Tokens stored in `external_identities.metadata` (consider encrypting in production)
- Callback URL must match exactly in Meta App settings
- HTTPS required for production

