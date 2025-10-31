# Data Indexing Plan - Todo #12

## Goal
Index external data sources for AI spec research guardrails:
- Factory service manuals
- Forum discussions (Pirate4x4, ClassicBroncos, K5blazerforum, etc.)
- Facebook groups
- Historical market data (NADA, Hagerty)

## Current State

✅ **Infrastructure Ready**:
- `research-spec` edge function deployed
- `spec_research_cache` table created (after migration)
- AI prompt includes source constraints
- Caching system (30-day expiration)

⏳ **Missing**: Actual indexed data

## Implementation Approach

### Phase 1: Manual Indexing (Quick Start)
**Time: 1-2 days**

1. **Create Reference Database**
```sql
CREATE TABLE spec_reference_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL, -- 'manual', 'forum', 'social', 'market_data'
  make TEXT,
  model TEXT,
  year_start INTEGER,
  year_end INTEGER,
  spec_category TEXT, -- 'engine', 'transmission', etc.
  content TEXT,
  metadata JSONB, -- page numbers, URLs, dates
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON spec_reference_library(make, model, year_start, year_end);
CREATE INDEX ON spec_reference_library(spec_category);
```

2. **Manually Add Key Documents**
- Download factory service manuals (PDF)
- Extract text via OCR
- Store key pages in database with metadata
- Start with top 10 most common vehicles

3. **Update `research-spec` to Query Database First**
```typescript
// Before calling OpenAI, check local database
const { data: references } = await supabase
  .from('spec_reference_library')
  .select('*')
  .eq('make', vehicle.make)
  .eq('model', vehicle.model)
  .gte('year_end', vehicle.year)
  .lte('year_start', vehicle.year)
  .eq('spec_category', spec_name);

// Include references in AI prompt
const prompt = `Using these factory references:\n${references.map(r => r.content).join('\n\n')}\n\n${originalPrompt}`;
```

### Phase 2: Forum Scraping (1 week)
**Target Forums**:
- Pirate4x4.com
- ClassicBroncos.com
- K5blazerforum.com
- The1947.com (Chevy/GMC)
- FSB (Full Size Bronco)

**Approach**:
1. Create scraper script with `cheerio` or `puppeteer`
2. Respect robots.txt and rate limits
3. Extract threads by vehicle model
4. Store in `spec_reference_library`
5. Run weekly to capture new discussions

**Example Scraper**:
```javascript
// scripts/scrape-forums.js
async function scrapePirate4x4() {
  const threads = await fetch('https://www.pirate4x4.com/forums/chevy-k5-blazer/')
    .then(parseThreadList);
  
  for (const thread of threads) {
    const content = await scrapeThread(thread.url);
    await supabase.from('spec_reference_library').insert({
      source_type: 'forum',
      make: 'Chevrolet',
      model: 'K5 Blazer',
      spec_category: detectSpecCategory(content),
      content: content,
      metadata: {
        url: thread.url,
        title: thread.title,
        date: thread.date,
        replies: thread.replies
      }
    });
  }
}
```

### Phase 3: Facebook Group Scraping (Complex)
**Challenge**: Facebook restricts automated scraping

**Options**:
1. **Manual Export**: Group admins can export data
2. **Facebook Graph API**: Requires app approval
3. **Browser Automation**: Selenium/Puppeteer (against ToS)

**Recommended**: Partner with group admins to get data exports

### Phase 4: Market Data Integration (1 week)
**Sources**:
- NADA Guides API (requires subscription)
- Hagerty Valuation Tools API
- Bring a Trailer sale data (public)
- Hemmings auction results

**Approach**:
1. Get API access to NADA/Hagerty
2. Scrape public BaT/Hemmings data
3. Store in separate `market_data` table
4. Update AI prompts with current values

### Phase 5: PDF Manual OCR (2 weeks)
**Process**:
1. Collect factory service manuals (eBay, forums, archives)
2. Use Tesseract OCR or AWS Textract
3. Extract text and maintain page numbers
4. Store with cross-references

**Example**:
```javascript
// scripts/ocr-manual.js
import Tesseract from 'tesseract.js';

async function processManu(pdfPath) {
  const images = await pdfToImages(pdfPath);
  
  for (const [pageNum, image] of images.entries()) {
    const { data: { text } } = await Tesseract.recognize(image);
    
    await supabase.from('spec_reference_library').insert({
      source_type: 'manual',
      make: detectMake(text),
      model: detectModel(text),
      year_start: detectYearRange(text).start,
      year_end: detectYearRange(text).end,
      spec_category: detectSpecFromPage(text),
      content: text,
      metadata: {
        manual_title: getManualTitle(pdfPath),
        page_number: pageNum,
        confidence: Tesseract.confidence
      }
    });
  }
}
```

## Quick Win: Start with Manual Entry

**This Week**:
1. Create `spec_reference_library` table
2. Manually enter top 20 engine specs for common vehicles
3. Manually enter top 20 transmission specs
4. Update `research-spec` to query database

**Vehicles to Prioritize**:
- Chevrolet K5 Blazer (1973-1991)
- Ford Bronco (1966-1996)
- Chevy K10/K20 (1973-1987)
- GMC Jimmy (1973-1991)
- International Scout (1961-1980)

**Specs to Start With**:
- Engine types (350ci V8, 305ci, 400ci, etc.)
- Transmission types (TH350, TH400, SM465, NV4500)
- Axle ratios (10-bolt, 14-bolt, Dana 44, Dana 60)

## Cost Estimates

### Data Acquisition:
- Factory manuals: $50-200 each (10 vehicles = $500-2000)
- NADA API: $1000-5000/year
- Hagerty API: Contact for pricing
- BaT data: Free (public scraping)

### Development Time:
- Phase 1 (Manual): 2 days
- Phase 2 (Forums): 1 week
- Phase 3 (Facebook): 2 weeks (if possible)
- Phase 4 (Market Data): 1 week
- Phase 5 (OCR): 2 weeks

**Total**: 6-8 weeks for full implementation

## Recommendation

**Start Simple**:
1. Apply the database migration (enables caching)
2. Create `spec_reference_library` table
3. Manually index 50-100 key specs
4. Test with real users
5. Iterate based on usage patterns

**Then Scale**:
- Build scrapers for most-requested vehicles
- Add OCR for manuals as needed
- Integrate market data APIs

## Next Steps

1. **Immediate**: Apply `20251019_add_backend_features.sql` migration
2. **This Week**: Create `spec_reference_library` table schema
3. **Next Week**: Manually index top 50 specs
4. **Month 2**: Build forum scrapers
5. **Month 3**: OCR pipeline for manuals

Want me to start with Phase 1 (manual indexing)?

