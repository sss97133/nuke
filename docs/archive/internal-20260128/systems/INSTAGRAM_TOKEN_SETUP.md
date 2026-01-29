# Instagram Access Token Setup

## Your Access Token

You have a long-lived Instagram access token configured. This token will work for API calls but will expire in approximately 60 days.

**Token**: `EAAG2H7d3KpkBQdMZC20WUWHuJqvDZA5Arh2BWUQ73YWQpgv6k9EwM07UFeSARVDJHwPOOkm5odMfnKtHMpJ6DRAODEI76u3ywDOO7fviTDCloXcDAFSKfmnm0KrWZCwZBETbFanTqJYoPzvNLuWG4LS3CZBccmkf0lcoySfApZBv3L7nwkXhRxblQvFXesi7EwvFMaoZAKsivmSYfGcP6S7bw7XAaChG3M066I3`

## How to Use

### Option 1: Environment Variable (Quick Setup)

Add to Supabase Edge Function secrets:

```bash
INSTAGRAM_ACCESS_TOKEN=EAAG2H7d3KpkBQdMZC20WUWHuJqvDZA5Arh2BWUQ73YWQpgv6k9EwM07UFeSARVDJHwPOOkm5odMfnKtHMpJ6DRAODEI76u3ywDOO7fviTDCloXcDAFSKfmnm0KrWZCwZBETbFanTqJYoPzvNLuWG4LS3CZBccmkf0lcoySfApZBv3L7nwkXhRxblQvFXesi7EwvFMaoZAKsivmSYfGcP6S7bw7XAaChG3M066I3
```

This will be used as a fallback if no token is found in `external_identities.metadata`.

### Option 2: Store in Database (Recommended for Production)

When users connect via OAuth, tokens are automatically stored in `external_identities.metadata.access_token`. You can also manually store it:

```sql
-- Store token for an Instagram account
UPDATE external_identities
SET metadata = jsonb_set(
  COALESCE(metadata, '{}'::jsonb),
  '{access_token}',
  '"EAAG2H7d3KpkBQdMZC20WUWHuJqvDZA5Arh2BWUQ73YWQpgv6k9EwM07UFeSARVDJHwPOOkm5odMfnKtHMpJ6DRAODEI76u3ywDOO7fviTDCloXcDAFSKfmnm0KrWZCwZBETbFanTqJYoPzvNLuWG4LS3CZBccmkf0lcoySfApZBv3L7nwkXhRxblQvFXesi7EwvFMaoZAKsivmSYfGcP6S7bw7XAaChG3M066I3"'::jsonb
)
WHERE platform = 'instagram' 
  AND handle = 'lartdelautomobile';
```

## Token Priority

The sync functions check for tokens in this order:

1. **external_identities.metadata.access_token** (from OAuth or manual storage)
2. **INSTAGRAM_ACCESS_TOKEN** environment variable (fallback)

## Token Expiration

- **Long-lived tokens**: Expire in ~60 days
- **Short-lived tokens**: Expire in ~1 hour

The functions check `token_expires_at` in metadata and will fall back to the environment variable if expired.

## Security Notes

⚠️ **Important**: 
- Never commit access tokens to git
- Store in Supabase Edge Function secrets (encrypted)
- For production, use OAuth flow to automatically refresh tokens
- Consider encrypting tokens stored in database metadata

## Testing with Your Token

Once the token is set in environment variables, you can test:

```typescript
// Test sync
await supabase.functions.invoke('sync-instagram-organization', {
  body: {
    organization_id: '39773a0e-106c-4afa-ae50-f95cbd74d074',
    instagram_handle: 'lartdelautomobile',
    limit: 5
  }
});
```

## Next Steps

1. ✅ Add token to Supabase Edge Function secrets
2. ✅ Test sync function
3. ✅ Run historical backfill
4. ⏳ Set up OAuth for automatic token refresh (recommended for production)

