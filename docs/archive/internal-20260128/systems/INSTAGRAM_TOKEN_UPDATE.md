# Update Instagram Access Token

## New Token Setup

1. **Add to Supabase Edge Function Secrets:**
   - Go to Supabase Dashboard → Edge Functions → Secrets
   - Update `META_APP_USER_TOKEN` with your new token

2. **Test the Token:**
   ```bash
   # Test Facebook access
   curl "https://graph.facebook.com/v18.0/me?access_token=YOUR_NEW_TOKEN"
   
   # Test Facebook Pages
   curl "https://graph.facebook.com/v18.0/me/accounts?access_token=YOUR_NEW_TOKEN"
   
   # Test Instagram (if it's an Instagram token)
   curl "https://graph.instagram.com/me?fields=id,username&access_token=YOUR_NEW_TOKEN"
   ```

3. **Run Sync:**
   Once the token is updated in Supabase secrets, the sync function will automatically use it.

## Token Types

- **Facebook User Token**: Can access Facebook Pages, then Instagram accounts
- **Instagram Token**: Can directly access Instagram Graph API
- **Page Token**: Can access specific page's Instagram account

The function will try to auto-detect which type and use it appropriately.

