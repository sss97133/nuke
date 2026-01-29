# Tools Needed for Accurate Extraction from Diverse Sources

## Current Tool Stack ✅

### 1. **Primary Extraction Tools**

#### Firecrawl API 🔥
- **Purpose**: Robust web scraping with bot protection bypass
- **Strengths**: 
  - Handles JavaScript rendering
  - Bypasses Cloudflare, Facebook bot protection
  - Schema-based structured extraction
  - Returns HTML + Markdown + Extracted JSON
- **Current Usage**: `scrape-multi-source`, `index-classic-com-dealer`
- **Limitations**: 
  - Cost per page ($0.002 - $0.0005)
  - ~2-5 second latency
  - May not handle all edge cases

#### LLM Extraction (GPT-4o) 🤖
- **Purpose**: Intelligent structured data extraction
- **Strengths**:
  - Understands context and structure
  - Handles irregular formats
  - Can infer missing data
- **Current Usage**: `extract-vehicle-data-ai`, `scrape-multi-source` (fallback)
- **Limitations**:
  - Higher cost per extraction
  - Token limits
  - Can hallucinate data

#### DOMParser (Deno DOM) 📄
- **Purpose**: HTML parsing and DOM traversal
- **Strengths**:
  - Fast, local parsing
  - Works in Deno edge functions
  - Good for simple sites
- **Current Usage**: `scrape-vehicle`, fallback parsing
- **Limitations**:
  - No JavaScript execution
  - Blocked by bot protection

### 2. **Supporting Tools**

#### Regex Pattern Matching
- **Purpose**: Extract specific data patterns (VINs, phones, emails, URLs)
- **Current Usage**: Throughout extraction functions
- **Limitations**: Fragile, breaks when format changes

#### Image Processing
- **Purpose**: Validate, filter, and store images
- **Current Tools**: `filter-vehicle-images-ai`, `backfill-images`
- **Needs**: Image validation, duplicate detection

---

## Missing Tools & Improvements Needed 🔧

### 1. **Multi-Strategy Extraction Pipeline** (CRITICAL)

**Problem**: Different sources require different extraction strategies. One-size-fits-all fails.

**Solution**: Adaptive extraction chain with fallback strategies:

```typescript
// Proposed architecture
async function extractWithFallback(url: string, sourceType: string) {
  const strategies = [
    // Strategy 1: Firecrawl with schema (best accuracy)
    () => extractWithFirecrawlSchema(url, sourceType),
    
    // Strategy 2: Firecrawl + LLM extraction (handles complex pages)
    () => extractWithFirecrawlAndLLM(url, sourceType),
    
    // Strategy 3: Direct fetch + LLM (cost-effective for simple sites)
    () => extractWithDirectFetchAndLLM(url),
    
    // Strategy 4: Source-specific extractor (domain knowledge)
    () => extractWithSourceSpecificAdapter(url, sourceType),
    
    // Strategy 5: Regex pattern matching (last resort)
    () => extractWithRegex(url)
  ];
  
  // Try each strategy until one succeeds with high confidence
  for (const strategy of strategies) {
    try {
      const result = await strategy();
      if (result.confidence >= 0.8) {
        return result;
      }
    } catch (error) {
      continue; // Try next strategy
    }
  }
  
  throw new Error('All extraction strategies failed');
}
```

**Implementation Needed**:
- ✅ Create `extract-with-fallback` edge function
- ✅ Define confidence scoring system
- ✅ Implement strategy chain with timeout/retry logic

### 2. **Source-Specific Adapters** (HIGH PRIORITY)

**Problem**: Each source (Craigslist, Classic.com, DealerFire, DealerSocket, BaT, etc.) has unique structure.

**Solution**: Source-specific extraction adapters with domain knowledge:

```typescript
interface SourceAdapter {
  name: string;
  patterns: {
    listingUrls: RegExp[];
    dataExtraction: (html: string) => VehicleData;
    pagination?: (html: string) => string | null;
  };
  confidence: number; // How reliable this adapter is
}

const adapters: Record<string, SourceAdapter> = {
  'craigslist': {
    name: 'Craigslist',
    patterns: {
      listingUrls: [/craigslist\.org\/.*\/ctd\/d\//],
      dataExtraction: extractCraigslistData,
      pagination: extractCraigslistPagination
    },
    confidence: 0.95
  },
  'classic.com': {
    name: 'Classic.com',
    patterns: {
      listingUrls: [/classic\.com\/.*\/vehicles\//],
      dataExtraction: extractClassicData,
      pagination: extractClassicPagination
    },
    confidence: 0.90
  },
  'dealerfire': {
    name: 'DealerFire',
    patterns: {
      listingUrls: [/dealerfire\.com\/.*\/inventory\//],
      dataExtraction: extractDealerFireData,
      pagination: extractDealerFirePagination
    },
    confidence: 0.85
  },
  // ... more adapters
};
```

**Implementation Needed**:
- ✅ Create `source-adapters` shared module
- ✅ Build adapters for top 10 sources
- ✅ Auto-detect source from URL
- ✅ Store adapter performance metrics

### 3. **Confidence Scoring System** (HIGH PRIORITY)

**Problem**: No way to measure extraction quality. Bad data gets into system.

**Solution**: Multi-factor confidence scoring:

```typescript
interface ExtractionResult {
  data: VehicleData;
  confidence: number; // 0-1
  confidenceFactors: {
    sourceReliability: number;      // How reliable is this source?
    extractionMethod: number;        // Firecrawl > LLM > Regex
    dataCompleteness: number;        // % of required fields present
    dataValidation: number;          // Passes validation checks?
    crossValidation: number;         // Matches other sources?
  };
  warnings: string[];
  requiresReview: boolean;
}

function calculateConfidence(result: ExtractionResult): number {
  const weights = {
    sourceReliability: 0.2,
    extractionMethod: 0.2,
    dataCompleteness: 0.3,
    dataValidation: 0.2,
    crossValidation: 0.1
  };
  
  return Object.entries(weights).reduce((score, [key, weight]) => {
    return score + (result.confidenceFactors[key] * weight);
  }, 0);
}
```

**Implementation Needed**:
- ✅ Add confidence scoring to all extraction functions
- ✅ Store confidence scores in database
- ✅ Auto-flag low-confidence extractions for review
- ✅ Track confidence vs. actual accuracy

### 4. **Data Validation & Normalization** (HIGH PRIORITY)

**Problem**: Extracted data is inconsistent (price formats, mileage units, etc.)

**Solution**: Validation and normalization layer:

```typescript
interface DataValidator {
  validate: (data: any) => ValidationResult;
  normalize: (data: any) => NormalizedData;
}

const validators: Record<string, DataValidator> = {
  price: {
    validate: (price) => {
      if (typeof price === 'string') {
        // Remove $, commas, etc.
        const num = parseFloat(price.replace(/[$,]/g, ''));
        return { valid: num > 0 && num < 10000000, normalized: num };
      }
      return { valid: price > 0 && price < 10000000, normalized: price };
    },
    normalize: (price) => {
      // Standardize to number, USD
      return typeof price === 'string' 
        ? parseFloat(price.replace(/[$,]/g, '')) 
        : price;
    }
  },
  vin: {
    validate: (vin) => {
      // VIN validation rules
      const pattern = /^[A-HJ-NPR-Z0-9]{17}$/;
      return { valid: pattern.test(vin), normalized: vin.toUpperCase() };
    },
    normalize: (vin) => vin.toUpperCase().trim()
  },
  mileage: {
    validate: (mileage) => {
      // Check if reasonable (0-1M miles)
      return { valid: mileage >= 0 && mileage <= 1000000, normalized: mileage };
    },
    normalize: (mileage) => {
      // Convert km to miles if needed
      if (mileage > 200000) { // Probably in km
        return Math.round(mileage * 0.621371);
      }
      return mileage;
    }
  },
  // ... more validators
};
```

**Implementation Needed**:
- ✅ Create `data-validators` shared module
- ✅ Add validation to all extraction results
- ✅ Store validation results with data
- ✅ Auto-fix common issues (normalize units, formats)

### 5. **Retry & Error Handling** (MEDIUM PRIORITY)

**Problem**: Transient failures (timeouts, rate limits) cause data loss.

**Solution**: Intelligent retry with exponential backoff:

```typescript
interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  retryableErrors: string[]; // Error patterns to retry
  nonRetryableErrors: string[]; // Don't retry these
}

async function extractWithRetry(
  url: string,
  extractFn: (url: string) => Promise<ExtractionResult>,
  config: RetryConfig = defaultRetryConfig
): Promise<ExtractionResult> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await extractFn(url);
    } catch (error: any) {
      lastError = error;
      
      // Don't retry non-retryable errors
      if (config.nonRetryableErrors.some(pattern => 
        error.message?.includes(pattern)
      )) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelay * Math.pow(2, attempt),
        config.maxDelay
      );
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}
```

**Implementation Needed**:
- ✅ Add retry logic to all extraction functions
- ✅ Track retry statistics
- ✅ Alert on high retry rates

### 6. **Rate Limiting & Throttling** (MEDIUM PRIORITY)

**Problem**: Overwhelming sources causes blocks/bans.

**Solution**: Smart rate limiting per source:

```typescript
interface RateLimiter {
  source: string;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
}

const rateLimiters: Record<string, RateLimiter> = {
  'craigslist': {
    source: 'craigslist',
    requestsPerMinute: 2,
    requestsPerHour: 60,
    requestsPerDay: 500
  },
  'classic.com': {
    source: 'classic.com',
    requestsPerMinute: 5,
    requestsPerHour: 200,
    requestsPerDay: 2000
  },
  // ... more sources
};

async function rateLimitRequest(source: string): Promise<void> {
  const limiter = rateLimiters[source] || defaultLimiter;
  
  // Check limits using Redis or database
  const stats = await getRequestStats(source);
  
  if (stats.minute >= limiter.requestsPerMinute) {
    const waitTime = 60000 - (Date.now() - stats.minuteStart);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  // Record request
  await recordRequest(source);
}
```

**Implementation Needed**:
- ✅ Create rate limiter service
- ✅ Store request stats in database
- ✅ Auto-throttle based on source limits

### 7. **Data Quality Monitoring** (MEDIUM PRIORITY)

**Problem**: No visibility into extraction quality over time.

**Solution**: Quality metrics dashboard:

```typescript
interface QualityMetrics {
  source: string;
  period: 'day' | 'week' | 'month';
  metrics: {
    totalExtractions: number;
    averageConfidence: number;
    validationFailureRate: number;
    duplicateRate: number;
    manualCorrectionRate: number; // How often users fix data
  };
  trends: {
    confidence: 'improving' | 'stable' | 'degrading';
    errors: 'decreasing' | 'stable' | 'increasing';
  };
}
```

**Implementation Needed**:
- ✅ Track extraction quality metrics
- ✅ Create quality dashboard
- ✅ Alert on quality degradation

### 8. **Image Extraction & Validation** (LOW PRIORITY - Already Partially Implemented)

**Current State**: ✅ `filter-vehicle-images-ai`, `backfill-images` exist

**Improvements Needed**:
- ✅ Better duplicate image detection
- ✅ Image quality scoring
- ✅ Extract images from galleries, carousels, lazy-loaded content
- ✅ Handle different image formats (WebP, AVIF, etc.)

### 9. **Schema Evolution & Versioning** (LOW PRIORITY)

**Problem**: Extraction schemas break when sources change.

**Solution**: Versioned schemas with migration:

```typescript
interface ExtractionSchema {
  version: string;
  source: string;
  fields: Record<string, FieldDefinition>;
  lastUpdated: Date;
  deprecated: boolean;
}

// Store multiple schema versions
// Auto-detect which schema version works best
// Gradual migration to new schemas
```

---

## Recommended Implementation Priority

### Phase 1: Critical (Do First) 🚨
1. ✅ **Multi-Strategy Extraction Pipeline** - Handles diverse sources
2. ✅ **Source-Specific Adapters** - Top 5 sources (Craigslist, Classic.com, BaT, DealerFire, DealerSocket)
3. ✅ **Confidence Scoring** - Know what you can trust

### Phase 2: High Value (Do Next) 📈
4. ✅ **Data Validation & Normalization** - Clean, consistent data
5. ✅ **Retry & Error Handling** - Resilience
6. ✅ **Rate Limiting** - Avoid bans

### Phase 3: Optimization (Do Later) ⚡
7. ✅ **Data Quality Monitoring** - Continuous improvement
8. ✅ **Image Extraction Improvements** - Better images
9. ✅ **Schema Versioning** - Future-proof

---

## Tools Comparison Matrix

| Tool | Accuracy | Cost | Speed | Bot Protection | Best For |
|------|----------|------|-------|----------------|----------|
| **Firecrawl + Schema** | ⭐⭐⭐⭐⭐ | $$$ | ⭐⭐⭐ | ✅✅✅ | Complex sites, bot protection |
| **Firecrawl + LLM** | ⭐⭐⭐⭐ | $$$$ | ⭐⭐ | ✅✅✅ | Irregular formats |
| **Direct Fetch + LLM** | ⭐⭐⭐⭐ | $$$ | ⭐⭐⭐⭐ | ❌ | Simple sites, no bot protection |
| **Source Adapter** | ⭐⭐⭐⭐⭐ | $ | ⭐⭐⭐⭐⭐ | ⚠️ | Known sources |
| **Regex Patterns** | ⭐⭐ | $ | ⭐⭐⭐⭐⭐ | ❌ | Simple, consistent formats |

**Key Insight**: Use the right tool for each source. No single tool works for everything.

---

## Next Steps

1. **Create `extract-with-fallback` edge function** with multi-strategy pipeline
2. **Build source adapters** for top 5 sources
3. **Add confidence scoring** to all extraction results
4. **Implement data validators** for common fields
5. **Set up quality monitoring** dashboard

Want me to start implementing these tools?

