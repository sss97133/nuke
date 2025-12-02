# AI Data Ingestion System - Complete Guide

## Overview

The AI Data Ingestion System transforms the header search bar into an intelligent data ingestion tool that accepts any user input and accurately routes raw data to the correct database tables.

**Core Goal**: Easiest input → Most accurate database placement → Proper table logging → Context building

## How It Works

### 1. Input Flow

```
User Input (Text/Image/URL/VIN)
    ↓
AI Data Ingestion Service
    ↓
Classify Input Type
    ↓
Extract Structured Data (Multi-Provider AI)
    ↓
Database Router Service
    ↓
Find or Create Vehicle Profile
    ↓
Generate Operation Plan
    ↓
User Confirms Preview
    ↓
Execute Database Operations
    ↓
Navigate to Vehicle Profile
```

### 2. AI Provider System

#### Provider Priority (Free First, Then Paid)

1. **Google Gemini Flash** (FREE TIER)
   - Cost: FREE
   - Limits: 60 requests/minute, 1,500 requests/day
   - Models: `gemini-1.5-flash`, `gemini-1.5-pro`
   - Speed: Fast
   - Accuracy: Good

2. **OpenAI** (PAID)
   - Cost: ~$0.0001-0.03 per request
   - Models (cheapest first):
     - `gpt-4o-mini` (cheapest)
     - `gpt-4o` (balanced)
     - `gpt-4-turbo` (most capable)

3. **Anthropic Claude** (PAID)
   - Cost: ~$0.00008-0.03 per request
   - Models (cheapest first):
     - `claude-3-haiku-20240307` (cheapest)
     - `claude-3-5-sonnet-20241022` (balanced)
     - `claude-3-opus-20240229` (most capable)

#### Fallback Logic

```
Try Google Gemini Flash
  ↓ (if fails)
Try Google Gemini Pro
  ↓ (if fails)
Try OpenAI gpt-4o-mini
  ↓ (if fails)
Try OpenAI gpt-4o
  ↓ (if fails)
Try OpenAI gpt-4-turbo
  ↓ (if fails)
Try Anthropic Claude Haiku
  ↓ (if fails)
Try Anthropic Claude Sonnet
  ↓ (if fails)
Try Anthropic Claude Opus
  ↓ (if all fail)
Return Error
```

### 3. Rate Limit & Throttling Handling

#### Automatic Rate Limit Detection

- **429 Status Codes**: Detected automatically
- **Retry-After Headers**: Respected from API responses
- **Exponential Backoff**: 1s → 2s → 4s → 8s → 10s max
- **Timeout Protection**: 15 seconds per model attempt

#### Rate Limit Strategies

1. **Free Tier Tracking**
   - Tracks requests in `ai_request_log` table
   - Checks per-minute and per-day limits
   - Skips provider if limit exceeded
   - Automatically moves to next provider

2. **Exponential Backoff**
   - Initial delay: 1 second
   - Max delay: 10 seconds
   - Multiplier: 2x per retry
   - Max retries: 3 attempts

3. **Smart Retry Logic**
   - **Don't retry**: 400 (bad request), 401 (auth), 403 (forbidden)
   - **Do retry**: 429 (rate limit), 500+ (server errors)
   - **Respect retry-after**: Uses header value if provided
   - **Skip provider**: If rate limited, skip remaining models

4. **Request Tracking**
   - Logs successful requests for free tier providers
   - Tracks per-user and global usage
   - Auto-cleanup after 7 days

### 4. Input Types Supported

#### VIN (17 characters)
- Validates format
- Decodes using NHTSA VPIC API (free)
- Extracts: year, make, model, trim, engine, etc.

#### URL (Listing Pages)
- Supports: BaT, ClassicCars.com, eBay, Craigslist, Cars.com
- Parses HTML to extract vehicle data
- Extracts: VIN, year, make, model, price, mileage, images, etc.

#### Images
- VIN plates → OCR VIN extraction
- Vehicle photos → Make/model/year identification
- Receipts → Vendor, date, total, items extraction
- Documents → Structured data extraction

#### Natural Language Text
- "1977 Chevrolet Blazer"
- "My 1985 GMC Suburban with 120k miles"
- "Just bought a 1990 Ford Bronco for $15k"
- AI extracts structured data from free-form text

### 5. Database Routing

#### Vehicle Matching Logic

1. **Primary Match**: VIN (exact)
   - If VIN found, match by VIN
   - Update existing vehicle if found
   - Create new if not found

2. **Secondary Match**: Year + Make + Model (fuzzy)
   - Case-insensitive matching
   - Update VIN if we have one and existing doesn't
   - Create new if no match

3. **Create New**: If no matches found
   - Generate new vehicle profile
   - Link to user
   - Create timeline event

#### Table Routing

- **vehicles** → Vehicle profile data
- **timeline_events** → All data additions logged here
- **receipts** → Receipt data (if extracted)
- **vehicle_images** → Image uploads (if provided)
- **ai_request_log** → Rate limit tracking (free tier)

### 6. Cost Optimization

#### Free Tier First Strategy
- Always tries free providers first (Google Gemini)
- Only uses paid providers if free tier:
  - Not configured
  - Rate limited
  - Fails

#### Model Selection (Cheapest First)
- Within each provider, tries cheapest models first
- Falls back to more expensive models only if needed
- User/system API keys supported

#### Caching Opportunities
- VIN decoding: 7-day cache (already implemented)
- URL parsing: Could cache parsed listings
- Image analysis: Could cache results for identical images

## Configuration

### Environment Variables

```bash
# Free Tier (Recommended)
GOOGLE_AI_API_KEY=your_google_api_key

# Paid Tier (Fallback)
OPEN_AI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
```

### User API Keys

Users can add their own API keys in Settings → AI Providers:
- Saves to `user_ai_providers` table
- Used before system keys
- Supports multiple providers
- Can set default provider

## Monitoring & Debugging

### Logs

The system logs:
- Which provider/model was tried
- Success/failure for each attempt
- Rate limit hits
- Final provider/model that succeeded

### Error Handling

- **All providers fail**: Returns error with last error message
- **Rate limited**: Automatically tries next provider
- **Timeout**: Moves to next model after 15 seconds
- **Invalid input**: Returns specific error message

## Performance

### Typical Response Times

- **Google Gemini Flash**: ~1-2 seconds
- **OpenAI gpt-4o-mini**: ~2-3 seconds
- **OpenAI gpt-4o**: ~3-5 seconds
- **Anthropic Claude Haiku**: ~2-4 seconds
- **Anthropic Claude Sonnet**: ~4-7 seconds

### Timeout Protection

- 15 seconds per model attempt
- Total max time: ~2 minutes (if all providers tried)
- Usually succeeds in first 1-2 attempts

## Best Practices

1. **Always configure free tier first** (Google Gemini)
2. **Add user API keys** for better rate limits
3. **Monitor `ai_request_log`** for usage patterns
4. **Use cheapest models first** (automatic)
5. **Cache VIN decoding** (already implemented)

## Troubleshooting

### "All AI providers failed"
- Check API keys are configured
- Check rate limits haven't been exceeded
- Check network connectivity
- Review logs for specific errors

### Rate Limit Issues
- Free tier: Wait for limit reset (per minute/day)
- Paid tier: Check account limits
- Consider adding user API keys
- System automatically handles retries

### Slow Performance
- First request may be slower (cold start)
- Free tier may be slower than paid
- Check which provider succeeded (shown in UI)
- Consider upgrading to paid tier for speed

