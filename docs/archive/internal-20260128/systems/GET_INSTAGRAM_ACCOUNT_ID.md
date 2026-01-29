# How to Get Instagram Business Account ID

## Method 1: Meta Business Suite (Easiest)

1. Go to [Meta Business Suite](https://business.facebook.com/)
2. Select your business/Page
3. Go to **Settings** → **Instagram**
4. Find your Instagram account
5. The **Instagram Business Account ID** is displayed there

## Method 2: Facebook Graph API Explorer

1. Go to [Graph API Explorer](https://developers.facebook.com/tools/explorer/)
2. Select your app
3. Get a User Access Token with permissions:
   - `pages_read_engagement`
   - `pages_show_list`
   - `instagram_basic`
4. Make this API call:
   ```
   GET /me/accounts
   ```
5. For each page, get Instagram account:
   ```
   GET /{page-id}?fields=instagram_business_account
   ```
6. The `instagram_business_account.id` is your account ID

## Method 3: Using the Helper Script

```bash
node scripts/get-instagram-account-id.js <your_access_token>
```

This will automatically find your Instagram Business Account ID.

## Method 4: Manual Lookup

If you know your Instagram username, you can sometimes find the account ID in:
- Instagram profile URL inspection
- Meta Business Suite settings
- Facebook Page settings (if connected)

## Once You Have the Account ID

Store it in the database:

```sql
-- Update external_identity with account ID
UPDATE external_identities
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{instagram_account_id}',
  '"YOUR_ACCOUNT_ID_HERE"'::jsonb
)
WHERE platform = 'instagram' 
  AND handle = 'lartdelautomobile';
```

Or provide it in the sync call:

```typescript
await supabase.functions.invoke('sync-instagram-organization', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_handle: 'lartdelautomobile',
    instagram_account_id: 'YOUR_ACCOUNT_ID_HERE',
    limit: 25
  }
});
```

