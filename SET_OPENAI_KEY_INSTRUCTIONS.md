# How to Set OpenAI API Key in Supabase Edge Functions

## The Problem

Edge function error: `"OPENAI_API_KEY not configured"`

Even though you said you set it, the edge functions can't access it.

## Solution: Set Environment Variable in Supabase Dashboard

### Step 1: Go to Supabase Dashboard
https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions

### Step 2: Add Secret
1. Click **"Edge Function Configuration"** or **"Secrets"**
2. Click **"Add new secret"**
3. Enter:
   - **Name**: `OPENAI_API_KEY`
   - **Value**: `sk-proj-94f77a70d74b62ac2e7f...` (your full key)
4. Click **"Add Secret"** or **"Save"**

### Step 3: Verify It's Set

Run this command to test:

\`\`\`bash
curl -X POST https://qkgaybvrernstplzjaam.supabase.co/functions/v1/extract-title-data \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgzNjkwMjEsImV4cCI6MjA1Mzk0NTAyMX0.lw3dTV1mE1vf7OXDpBLCulj82SoqqXR2eAVLc4wfDlk" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://example.com/test.jpg"}'
\`\`\`

**Should return**: Actual extraction data or OpenAI error (NOT "OPENAI_API_KEY not configured")

## Alternative: Use Supabase CLI

\`\`\`bash
# This might work with newer CLI versions
supabase secrets set OPENAI_API_KEY=sk-proj-94f77a70d74b62ac2e7f...
\`\`\`

## Functions That Need This Key

1. **extract-title-data** - Title document OCR
2. **openai-proxy** - General OpenAI proxy
3. **parse-receipt** - Receipt parsing
4. **ai-agent-supervisor** - AI analysis coordinator
5. **analyze-image** - Image analysis

All are currently failing without this key!

## Direct Dashboard Link

https://supabase.com/dashboard/project/qkgaybvrernstplzjaam/settings/functions

Look for "Edge Function Configuration", "Environment Variables", or "Secrets" section.

## Why This Matters

- ❌ Without key: Title scan fails, AI features don't work
- ✅ With key: Full OCR, title extraction, receipt parsing, AI analysis

## Current Status

- Edge functions: ✅ Deployed
- Code changes: ✅ Deployed to Vercel
- Timeline fixes: ✅ Working
- **OpenAI key**: ❌ NOT SET (blocking AI features)

## Next Step

**Set the key in Supabase Dashboard**, then all AI features will instantly start working!

