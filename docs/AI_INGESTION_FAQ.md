# AI Data Ingestion System - FAQ

## Free Options

### Q: What free AI providers are available?

**A: Google Gemini Flash (Recommended)**
- **Cost**: 100% FREE
- **Rate Limits**: 
  - 60 requests per minute
  - 1,500 requests per day
- **Models**: 
  - `gemini-1.5-flash` (fast, good accuracy)
  - `gemini-1.5-pro` (better accuracy, same free tier)
- **Setup**: Get API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
- **When Used**: Tried FIRST before any paid providers

### Q: Why use free options first?

**A: Cost Savings**
- Free tier handles most requests
- Only falls back to paid if:
  - Free tier not configured
  - Rate limit exceeded
  - Free tier fails

### Q: What happens when free tier is exhausted?

**A: Automatic Fallback**
- System automatically tries paid providers
- No user intervention needed
- Seamless experience

## Throttling & Rate Limits

### Q: How does the system handle rate limits?

**A: Multi-Layer Protection**

1. **Pre-Request Checks** (Free Tier)
   - Checks `ai_request_log` table
   - Counts requests in last minute/day
   - Skips provider if limit exceeded
   - Moves to next provider automatically

2. **Automatic Retry with Backoff**
   - Detects 429 (rate limit) errors
   - Respects `retry-after` header from API
   - Exponential backoff: 1s → 2s → 4s → 8s → 10s max
   - Up to 3 retries per model

3. **Smart Provider Skipping**
   - If rate limited, skips remaining models for that provider
   - Immediately tries next provider
   - No wasted time on rate-limited providers

4. **Timeout Protection**
   - 15 seconds max per model attempt
   - Prevents hanging on slow/failed requests
   - Moves to next model quickly

### Q: What if all providers are rate limited?

**A: Error with Guidance**
- Returns clear error message
- Shows which providers were tried
- Suggests waiting or adding API keys
- Logs all attempts for debugging

### Q: How are rate limits tracked?

**A: Database Tracking**
- `ai_request_log` table stores all requests
- Tracks: provider, user_id, timestamp
- Auto-cleanup after 7 days
- Efficient queries for rate limit checks

## How It All Works

### Q: What happens when I paste a VIN?

```
1. Input: "1GCHK29U8XE123456"
   ↓
2. Classify: Detected as VIN
   ↓
3. Validate: Check format (17 chars, no I/O/Q)
   ↓
4. Decode: Call NHTSA VPIC API (free, no AI needed)
   ↓
5. Extract: Get year, make, model, engine, etc.
   ↓
6. Match: Find existing vehicle by VIN
   ↓
7. Route: Create/update vehicle profile
   ↓
8. Log: Create timeline event
   ↓
9. Navigate: Go to vehicle profile
```

### Q: What happens when I paste a URL?

```
1. Input: "https://bringatrailer.com/listing/..."
   ↓
2. Classify: Detected as URL
   ↓
3. Fetch: Download HTML via edge function
   ↓
4. Parse: Extract vehicle data (year, make, model, VIN, price, etc.)
   ↓
5. Match: Find or create vehicle (VIN-first, then year/make/model)
   ↓
6. Route: Update vehicle, create timeline event
   ↓
7. Navigate: Go to vehicle profile
```

### Q: What happens when I upload an image?

```
1. Input: Image file (VIN plate, vehicle photo, receipt)
   ↓
2. Upload: Store in Supabase Storage (temp folder)
   ↓
3. Classify: Detected as image
   ↓
4. AI Extraction: Try providers in order:
   - Google Gemini Flash (FREE) → if fails
   - Google Gemini Pro (FREE) → if fails
   - OpenAI gpt-4o-mini (PAID) → if fails
   - OpenAI gpt-4o (PAID) → if fails
   - ... (continues through all models)
   ↓
5. Extract: VIN, make, model, year, receipt data, etc.
   ↓
6. Preview: Show extracted data to user
   ↓
7. Confirm: User approves
   ↓
8. Route: Find/create vehicle, save to database
   ↓
9. Navigate: Go to vehicle profile
```

### Q: What happens when I type natural language?

```
1. Input: "My 1977 Chevrolet Blazer with 120k miles"
   ↓
2. Classify: Detected as text (natural language)
   ↓
3. AI Extraction: Try providers in order (same as image)
   ↓
4. Extract: year=1977, make=Chevrolet, model=Blazer, mileage=120000
   ↓
5. Preview: Show extracted data
   ↓
6. Confirm: User approves
   ↓
7. Route: Find/create vehicle, save to database
   ↓
8. Navigate: Go to vehicle profile
```

## Cost Breakdown

### Free Tier (Google Gemini)
- **Cost**: $0.00
- **Limits**: 1,500 requests/day
- **Best For**: Most users, development, testing

### Paid Tier (OpenAI/Anthropic)
- **OpenAI gpt-4o-mini**: ~$0.0001 per request (cheapest)
- **Anthropic Claude Haiku**: ~$0.00008 per request (cheapest)
- **OpenAI gpt-4o**: ~$0.01-0.03 per request
- **Anthropic Claude Sonnet**: ~$0.003-0.015 per request

### Cost Optimization
- System tries free tier FIRST
- Only uses paid if free fails
- Tries cheapest paid models first
- Typical cost: $0.00 (if free tier configured)

## Error Handling

### Q: What if AI extraction fails?

**A: Graceful Degradation**
- Shows error message to user
- Logs which providers were tried
- Suggests retry or manual entry
- Doesn't crash the app

### Q: What if database operation fails?

**A: Transaction Safety**
- All operations in transactions
- Rollback on error
- Clear error messages
- User can retry

## Performance

### Typical Response Times
- **Free Tier (Gemini)**: 1-2 seconds
- **Paid Tier (gpt-4o-mini)**: 2-3 seconds
- **Paid Tier (gpt-4o)**: 3-5 seconds

### Optimization
- Free tier tried first (fastest)
- Timeout protection (15s max)
- Parallel provider attempts (future enhancement)
- Caching for VIN decoding (7 days)

## Setup Instructions

### 1. Configure Free Tier (Recommended)

```bash
# In Supabase Dashboard → Edge Function Secrets
GOOGLE_AI_API_KEY=your_google_api_key_here
```

Get key from: https://makersuite.google.com/app/apikey

### 2. Configure Paid Tier (Optional, Fallback)

```bash
# In Supabase Dashboard → Edge Function Secrets
OPEN_AI_API_KEY=your_openai_key_here
ANTHROPIC_API_KEY=your_anthropic_key_here
```

### 3. Deploy Edge Function

```bash
supabase functions deploy extract-and-route-data
```

### 4. Run Migration (Rate Limit Tracking)

```bash
supabase migration up
```

## Monitoring

### Check Rate Limit Usage

```sql
-- Check Google Gemini usage today
SELECT COUNT(*) 
FROM ai_request_log 
WHERE provider = 'google' 
  AND created_at > NOW() - INTERVAL '1 day';
```

### View Recent Requests

```sql
SELECT provider, model, created_at 
FROM ai_request_log 
ORDER BY created_at DESC 
LIMIT 100;
```

## Best Practices

1. **Always configure free tier first** (Google Gemini)
2. **Monitor rate limits** using `ai_request_log`
3. **Add user API keys** for better limits
4. **Use cheapest models first** (automatic)
5. **Cache results** when possible (VIN decoding already cached)

