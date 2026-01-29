# Instagram Setup - Step by Step Guide

## Current Status
You're in Graph API Explorer with a User Token. To access Instagram, you need a **Page Access Token**.

## Step-by-Step Instructions

### Step 1: Get Page Access Token

1. **In Graph API Explorer** (where you are now):
   - Click the "Generate Access Token" button
   - In the dropdown, select **"Get Page Access Token"**
   - Select the Facebook Page that's connected to your Instagram account
   - Copy the Page Access Token (this is different from User Token)

### Step 2: Get Instagram Business Account ID

Once you have the Page Access Token:

1. **In Graph API Explorer:**
   - Set the query to: `GET /{page-id}?fields=instagram_business_account`
   - Replace `{page-id}` with your Facebook Page ID
   - Use the Page Access Token (not User Token)
   - Click "Submit"
   - The response will show: `instagram_business_account.id` - this is your Instagram Account ID

### Step 3: Alternative - Use This Query

Or use this query directly:
```
GET /me/accounts?fields=instagram_business_account
```

This will show all your pages and their connected Instagram accounts.

### Step 4: Update Supabase Secrets

1. Go to Supabase Dashboard → Edge Functions → Secrets
2. Add/Update:
   ```
   META_APP_USER_TOKEN=<your_page_access_token_here>
   ```

### Step 5: Run Sync

Once you have the Instagram Account ID, run:

```bash
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/sync-instagram-organization" \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "organization_id": "39773a0e-106c-4afa-ae50-f95cbd74d074",
    "instagram_handle": "lartdelautomobile",
    "instagram_account_id": "YOUR_INSTAGRAM_ACCOUNT_ID_FROM_STEP_2",
    "limit": 5
  }'
```

## Quick Commands

### Get Instagram Account ID from Page Token

```bash
# Replace PAGE_ID and PAGE_ACCESS_TOKEN
curl "https://graph.facebook.com/v18.0/PAGE_ID?fields=instagram_business_account&access_token=PAGE_ACCESS_TOKEN"
```

### Get All Pages with Instagram Accounts

```bash
# Replace PAGE_ACCESS_TOKEN
curl "https://graph.facebook.com/v18.0/me/accounts?fields=instagram_business_account&access_token=PAGE_ACCESS_TOKEN"
```

## What You Need

1. ✅ User Token (you have this)
2. ⏳ Page Access Token (get from Graph API Explorer)
3. ⏳ Instagram Business Account ID (get from page query)
4. ⏳ Update META_APP_USER_TOKEN in Supabase secrets
5. ⏳ Run sync function

