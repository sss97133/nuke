# ACTUAL EXTRACTION TEST - LIVE SYSTEM

**Your existing `scrape-multi-source` function is ACTIVE** - let me test it live on premium auction sites.

## 🔍 **What `scrape-multi-source` Actually Does**

Looking at the code, this function is **already comprehensive**:

✅ **Firecrawl structured extraction** with vehicle schema  
✅ **OpenAI fallback** for complex sites  
✅ **Direct HTML parsing** for simple sites  
✅ **Organization creation** (dealer profiles automatically)  
✅ **Import queue** processing for batch handling  
✅ **Specialized handling** for different site types  
✅ **Rate limiting and timeout** protection  

**This is the extraction engine you need** - it just needs to be triggered properly.

## 🚀 **Live Test Commands**

```bash
cd /Users/skylar/nuke

# Set your service role key
export SUPABASE_SERVICE_ROLE_KEY="your_key_here"

# Test 1: Cars & Bids (should work immediately) 
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-multi-source" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://carsandbids.com/auctions",
    "source_type": "auction_house", 
    "max_listings": 50,
    "extract_dealer_info": true
  }'

# Test 2: Mecum public areas
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-multi-source" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://www.mecum.com/lots/",
    "source_type": "auction_house",
    "max_listings": 50
  }'

# Test 3: Barrett-Jackson
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-multi-source" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source_url": "https://www.barrett-jackson.com/Events/",
    "source_type": "auction_house",
    "max_listings": 50
  }'
```

## 📊 **What You Should See**

**Successful Response**:
```json
{
  "success": true,
  "source_id": "uuid",
  "organization_id": "uuid", 
  "dealer_info": {
    "name": "Cars & Bids",
    "website": "https://carsandbids.com"
  },
  "listings_found": 25,
  "listings_queued": 25,
  "squarebody_count": 0,
  "sample_listings": [...]
}
```

**Then check database**:
```sql
-- See new vehicles created
SELECT COUNT(*) FROM vehicles WHERE created_at > NOW() - INTERVAL '1 hour';

-- See import queue
SELECT COUNT(*) FROM import_queue WHERE created_at > NOW() - INTERVAL '1 hour';

-- See organizations created
SELECT business_name, website FROM businesses WHERE created_at > NOW() - INTERVAL '1 hour';
```

## 🔧 **If It Fails**

**Common issues and fixes**:

1. **401 Unauthorized**: Service role key is wrong
   ```bash
   # Get correct key from Supabase dashboard
   export SUPABASE_SERVICE_ROLE_KEY="eyJ..."
   ```

2. **503 Service Unavailable**: Function deployment issue
   ```bash
   # Redeploy function
   supabase functions deploy scrape-multi-source
   ```

3. **Rate Limited**: Too many requests
   ```bash
   # Wait 5 minutes, then try with smaller batch
   # Use max_listings: 10 instead of 50
   ```

4. **Timeout**: Site is slow
   ```bash
   # Try with cheap_mode: true
   "cheap_mode": true  # Skips LLM, faster
   ```

## ⚡ **Quick Debug Script**

```bash
# Create debug script
cat > debug-extraction.sh << 'EOF'
#!/bin/bash
echo "🔍 DEBUGGING LIVE EXTRACTION"
echo "============================"

# Test if function is accessible
echo "1. Testing function accessibility..."
curl -I "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-multi-source"

echo ""
echo "2. Testing with minimal request..."
curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/scrape-multi-source" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"source_url": "https://carsandbids.com", "max_listings": 1}'

echo ""
echo "3. Check recent function logs..."
supabase functions logs scrape-multi-source --no-timestamps | tail -10
EOF

chmod +x debug-extraction.sh
./debug-extraction.sh
```

## 🎯 **Bottom Line**

**Your extraction system already exists and is sophisticated**. The `scrape-multi-source` function:
- ✅ Handles Firecrawl + OpenAI extraction  
- ✅ Creates organization profiles automatically
- ✅ Queues vehicles for processing
- ✅ Has specialized logic for different site types

**The issue isn't missing functionality - it's configuration/auth/rate limiting.**

**Run the test commands above and show me the actual error messages** - then I can fix the real issues instead of building more systems.
