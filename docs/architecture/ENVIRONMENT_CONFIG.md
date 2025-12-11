# Nuke Platform Environment Configuration

## CRITICAL: ALWAYS USE REMOTE SUPABASE

Per established protocol, **ALL development must use the remote Supabase instance**. Local Supabase should NOT be used.

## Current Configuration

### Remote Supabase (PRODUCTION - ALWAYS USE THIS)
```
URL: https://qkgaybvrernstplzjaam.supabase.co
ANON_KEY: <your-supabase-anon-key>
```

### GitHub OAuth Configuration
- App Name: "nuke" (owned by sss97133)
- Client ID: Ov23lie2ivkxA9C6hiNA
- Callback URL: https://qkgaybvrernstplzjaam.supabase.co/auth/v1/callback
- Required in Supabase Dashboard: Add `http://localhost:5174/*` to redirect URLs

### Dropbox Integration
- Client ID: howu7w7zml4m6mq
- Note: Requires production URL for full functionality

## Environment File (.env)

The `.env` file in `/nuke_frontend/` should ALWAYS contain:
```env
# PRODUCTION REMOTE SUPABASE - ALWAYS USE THIS
VITE_SUPABASE_URL=https://qkgaybvrernstplzjaam.supabase.co
VITE_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

## Features That Depend on Correct Environment

1. **Authentication**
   - GitHub OAuth login
   - Email/password authentication
   - Session management

2. **Database Operations**
   - Vehicle CRUD operations
   - Timeline events
   - Image uploads to storage buckets

3. **Storage**
   - Vehicle images bucket: `vehicle-data`
   - User documents bucket: `user-documents`

## Testing Environment Setup

After any environment change, verify:

1. **Database Connection**
   ```bash
   node -e "const {createClient} = require('@supabase/supabase-js'); const s = createClient('https://qkgaybvrernstplzjaam.supabase.co', process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY); s.from('vehicles').select('id').limit(1).then(r => console.log(r.error ? 'FAILED' : 'WORKING'));"
   ```

2. **Authentication**
   - Test login at http://localhost:5174/login
   - Verify GitHub OAuth works

3. **Vehicle Operations**
   - Create a test vehicle
   - Upload an image
   - Verify it saves to remote database

## Common Issues and Solutions

### Issue: GitHub OAuth not working
**Solution**: Ensure redirect URLs are configured in Supabase Dashboard under Authentication → URL Configuration

### Issue: Database operations failing
**Solution**: Check that .env file is using remote Supabase URL and key, not local

### Issue: Local Supabase containers interfering
**Solution**: Run `supabase stop` to shut down local containers if they're running

## DO NOT:
- Switch to local Supabase for any reason
- Modify environment variables without updating this document
- Create multiple .env files (.env.local, .env.development, etc.)
- Use different configurations for different features

## Environment Switching Checklist

If you absolutely must work with different environments (NOT RECOMMENDED):

- [ ] Document the current working configuration
- [ ] Test all critical features before switching
- [ ] Update .env file with new configuration
- [ ] Restart development server
- [ ] Test authentication flow
- [ ] Test database operations
- [ ] Test storage operations
- [ ] Update this document with any changes

## Contact for Issues

If environment issues persist, the current known-working configuration is documented above. Always refer to this document before making environment changes.
