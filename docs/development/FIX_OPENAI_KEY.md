# Fix OpenAI Key - Diagnosis Complete

## What's Happening

✅ OpenAI key IS configured in Supabase (`OPENAI_API_KEY` exists)  
✅ Edge Function CAN read the key  
❌ But OpenAI API rejects it with 401 Unauthorized

## Diagnosis

The key in Supabase is either:
1. **Expired** - OpenAI keys can have expiration dates
2. **Revoked** - Key was deleted from OpenAI dashboard
3. **Billing issue** - OpenAI account has payment problem
4. **Wrong project** - Key is from different OpenAI organization

## Fix (2 Steps)

### Step 1: Get Current Key from OpenAI

Go to: https://platform.openai.com/api-keys

Either:
- **Find the existing key** and verify it's active
- **Create a new key** (recommended - takes 10 seconds)

Copy the key (starts with `sk-proj-...`)

### Step 2: Update Supabase Secret

```bash
cd /Users/skylar/nuke

# Replace with your actual key
supabase secrets set OPENAI_API_KEY=sk-proj-your-actual-key-here
```

### Step 3: Test It Works

```bash
# Should return 200 with analysis results
./scripts/test-openai-key.sh
```

Expected output:
```
✅ Function responded successfully!
{
  "success": true,
  "tier": 1,
  "angle": "front_3quarter",
  "category": "exterior_body"
}
```

### Step 4: Start Processing

```bash
node scripts/tiered-batch-processor.js
```

## Alternative: Check Your OpenAI Account

Visit: https://platform.openai.com/usage

Check:
- ✓ API key is active (not revoked)
- ✓ Billing is set up
- ✓ You have credits/quota available
- ✓ Key permissions include vision models (gpt-4o-mini)

## Quick Fix Command

```bash
# All in one:
cd /Users/skylar/nuke

# 1. Update key (paste your key)
supabase secrets set OPENAI_API_KEY=sk-proj-YOUR-KEY-HERE

# 2. Test
./scripts/test-openai-key.sh

# 3. If test passes, start processing
node scripts/tiered-batch-processor.js
```

That's it! The rest of the system is perfect - just need a valid OpenAI key.

