# Cars & Bids Extraction Improvement Plan

## Problem Summary
The extraction is creating vehicles but missing critical data:
- ❌ No images extracted (0 images)
- ❌ No comments/bids extracted (0 comments)
- ❌ No bidders extracted (empty array)
- ❌ Structured sections empty

**Root Cause**: Cars & Bids uses Next.js with JavaScript-rendered content. Direct HTML fetch gets minimal HTML without JavaScript execution, so images/comments/bidders aren't in the initial HTML.

## Solution Strategy

### Phase 1: Improve Firecrawl Reliability (Quick Win)
**Priority: HIGH** | **Effort: Medium** | **Impact: High**

1. **Add Retry Logic with Exponential Backoff**
   - Retry Firecrawl up to 3 times with increasing delays (2s, 5s, 10s)
   - Only retry on timeout/network errors, not on 4xx/5xx errors
   - Log retry attempts for debugging

2. **Simplify Firecrawl Actions**
   - Remove complex click actions that fail
   - Focus on scrolling only (more reliable)
   - Reduce wait times to prevent timeouts
   - Make all actions optional where possible

3. **Increase Timeout Strategically**
   - Current: 60s (already increased)
   - Consider: 90s for Cars & Bids specifically
   - Add timeout per-action, not just total

**Implementation Location**: `supabase/functions/extract-premium-auction/index.ts` lines 1698-1738

---

### Phase 2: Enhanced __NEXT_DATA__ Extraction (Quick Win)
**Priority: HIGH** | **Effort: Low** | **Impact: High**

Cars & Bids uses Next.js which embeds all data in `__NEXT_DATA__` script tag. This is available even in static HTML.

1. **Extract from __NEXT_DATA__ Script Tag**
   - Parse `window.__NEXT_DATA__` or `<script id="__NEXT_DATA__">`
   - Navigate to `props.pageProps.auction` or similar structure
   - Extract:
     - All images (full resolution URLs)
     - All comments with authors/timestamps
     - All bids with amounts/bidders
     - Structured sections (Doug's Take, Highlights, etc.)
     - Bidder profiles

2. **Add Fallback Patterns**
   - Try multiple paths in the JSON structure
   - Handle different Next.js page structures
   - Log structure for debugging if extraction fails

**Implementation Location**: 
- `extractCarsAndBidsImagesFromHtml` - already has some __NEXT_DATA__ extraction
- `extractCarsAndBidsComments` - add __NEXT_DATA__ parsing
- `extractCarsAndBidsBidders` - add __NEXT_DATA__ parsing
- `extractCarsAndBidsStructuredSections` - add __NEXT_DATA__ parsing

**Status**: Partially implemented (images), needs expansion

---

### Phase 3: Headless Browser Fallback (Long-term)
**Priority: MEDIUM** | **Effort: High** | **Impact: Very High**

When Firecrawl fails, use a headless browser to render JavaScript.

1. **Option A: Puppeteer in Edge Function** (Recommended)
   - Use `@sparticuz/chromium` (lightweight Chromium for serverless)
   - Render page, wait for content, extract HTML
   - Pros: Full JavaScript execution, reliable
   - Cons: Larger bundle size, slower, more memory

2. **Option B: Separate Browser Service**
   - Create dedicated Edge Function for browser rendering
   - Call from extract-premium-auction when needed
   - Pros: Isolation, can scale independently
   - Cons: Additional function, network latency

3. **Option C: Browserless.io or Similar Service**
   - Use external headless browser service
   - Pros: No infrastructure, reliable
   - Cons: Cost, external dependency

**Recommendation**: Start with Option A, fallback to Option B if bundle size is an issue.

**Implementation**:
```typescript
async function fetchWithBrowser(url: string): Promise<string> {
  // Use @sparticuz/chromium for Deno Edge Functions
  // Or call separate browser service
}
```

---

### Phase 4: Better HTML Extraction Patterns (Quick Win)
**Priority: MEDIUM** | **Effort: Low** | **Impact: Medium**

Improve regex/parsing patterns to catch more edge cases.

1. **Gallery Extraction**
   - Look for more gallery container patterns
   - Extract from CSS background-image
   - Parse srcset attributes more thoroughly
   - Handle lazy-loaded images better

2. **Comment Extraction**
   - More flexible comment container selectors
   - Better author extraction patterns
   - Handle nested comment structures
   - Extract comment metadata (likes, replies)

3. **Bidder Extraction**
   - Extract from more user link patterns
   - Parse bidder avatars/profile images
   - Link bidders to their bid amounts

**Implementation Location**: Existing extraction functions

---

### Phase 5: Incremental Extraction & Retry Queue
**Priority: LOW** | **Effort: Medium** | **Impact: Medium**

Don't fail completely if some data is missing.

1. **Store Partial Results**
   - If vehicle created but images failed, store vehicle
   - Mark in `origin_metadata` what's missing
   - Create retry queue for incomplete extractions

2. **Background Retry System**
   - Queue vehicles with missing data
   - Retry extraction later (maybe with different method)
   - Update vehicle when data becomes available

3. **Quality Scoring**
   - Score extraction completeness (0-100%)
   - Prioritize retries for high-value vehicles
   - Track extraction success rates

**Implementation**: New table `extraction_retry_queue` or use existing `vehicles_needing_micro_scrape`

---

### Phase 6: Debug & Monitoring
**Priority: MEDIUM** | **Effort: Low** | **Impact: High**

Better visibility into what's happening.

1. **HTML Debug Mode**
   - When `debug=true`, save HTML to storage/logs
   - Save extraction attempts and results
   - Log what patterns matched/failed

2. **Extraction Metrics**
   - Track success rates per site
   - Track which extraction methods work best
   - Monitor Firecrawl vs direct fetch success rates

3. **Error Categorization**
   - Categorize errors (timeout, parse error, missing data, etc.)
   - Route different errors to different solutions
   - Alert on repeated failures

---

## Implementation Order

### Week 1: Quick Wins
1. ✅ **Phase 2**: Enhanced __NEXT_DATA__ extraction (HIGHEST PRIORITY)
2. ✅ **Phase 1**: Firecrawl retry logic
3. ✅ **Phase 4**: Better HTML patterns

### Week 2: Infrastructure
4. ✅ **Phase 3**: Headless browser fallback
5. ✅ **Phase 6**: Debug & monitoring

### Week 3: Polish
6. ✅ **Phase 5**: Incremental extraction

---

## Success Metrics

- **Image Extraction**: 80%+ of listings get 50+ images
- **Comment Extraction**: 90%+ of listings get comments
- **Bidder Extraction**: 80%+ of listings get bidder profiles
- **Structured Sections**: 70%+ of listings get Doug's Take, Highlights, etc.
- **Overall Success Rate**: 90%+ of extractions get usable data

---

## Technical Notes

### __NEXT_DATA__ Structure (Cars & Bids)
```javascript
window.__NEXT_DATA__ = {
  props: {
    pageProps: {
      auction: {
        images: [...], // Full resolution URLs
        comments: [...], // All comments
        bids: [...], // Bid history
        bidders: [...], // Bidder profiles
        // ... other data
      }
    }
  }
}
```

### Firecrawl Retry Pattern
```typescript
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchJsonWithTimeout(url, options, timeout, label);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000; // 2s, 4s, 8s
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

### Browser Fallback Pattern
```typescript
try {
  // Try Firecrawl
  html = await fetchWithFirecrawl(url);
} catch (error) {
  try {
    // Try direct fetch
    html = await fetchTextWithTimeout(url, 30000, "Direct fetch");
  } catch (error2) {
    // Last resort: headless browser
    html = await fetchWithBrowser(url);
  }
}
```

---

## Files to Modify

1. `supabase/functions/extract-premium-auction/index.ts`
   - Add retry logic (lines 1698-1738)
   - Enhance __NEXT_DATA__ extraction (multiple functions)
   - Add browser fallback (new function)
   - Improve HTML patterns (existing functions)

2. `supabase/functions/extract-premium-auction/deno.json` (if needed)
   - Add browser dependencies

3. New: `supabase/functions/browser-render/index.ts` (optional)
   - Separate browser service

---

## Testing Strategy

1. **Test with 10 different Cars & Bids listings**
   - Mix of active and ended auctions
   - Different page structures
   - Various image counts (10-100+)

2. **Compare extraction methods**
   - Firecrawl success rate
   - Direct fetch success rate
   - Browser fallback success rate
   - __NEXT_DATA__ extraction success rate

3. **Measure performance**
   - Extraction time per method
   - Success rate per method
   - Data completeness per method

---

## Risk Mitigation

1. **Browser Fallback Risks**
   - **Risk**: Large bundle size, slow execution
   - **Mitigation**: Make it optional, use lightweight browser, cache results

2. **Firecrawl Costs**
   - **Risk**: Retries increase API costs
   - **Mitigation**: Limit retries, use exponential backoff, track usage

3. **Rate Limiting**
   - **Risk**: Too many requests to Cars & Bids
   - **Mitigation**: Add delays, respect robots.txt, use caching

---

## Next Steps

1. Start with Phase 2 (__NEXT_DATA__ extraction) - highest impact, lowest effort
2. Add Phase 1 (retry logic) - improves reliability
3. Test and measure improvements
4. Decide on Phase 3 (browser) based on results

