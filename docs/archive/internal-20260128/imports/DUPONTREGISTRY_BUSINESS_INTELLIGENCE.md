# duPont Registry Business Intelligence Extraction

## Overview

Automatically extract business model, specializations, and business type from dealer websites during ingestion. This should be **automatic** - no manual input required.

---

## Business Intelligence Extraction

### What to Extract

From dealer website content, automatically determine:

1. **Business Type**
   - `'dealership'` - Standard car dealer
   - `'custom_conversion'` - Custom builds/conversions (e.g., Lexani)
   - `'specialty_shop'` - Specialty services (tuning, restoration, etc.)
   - `'auction_house'` - Auction platform
   - `'broker'` - Vehicle broker
   - `'collector'` - Private collector

2. **Specializations** (array)
   - `'custom_interiors'` - Custom interior work
   - `'executive_conversions'` - Executive vehicle conversions
   - `'armored_vehicles'` - Armored vehicle conversions
   - `'luxury_suv_upgrades'` - Luxury SUV modifications
   - `'restoration'` - Vehicle restoration
   - `'tuning'` - Performance tuning
   - `'classic_cars'` - Classic car specialty
   - `'exotic_cars'` - Exotic car specialty
   - `'supercars'` - Supercar specialty

3. **Business Model**
   - `'interior_conversion'` - Custom interior conversions
   - `'custom_build'` - Full custom builds
   - `'restoration'` - Vehicle restoration
   - `'tuning'` - Performance modifications
   - `'brokerage'` - Vehicle brokerage
   - `'retail'` - Standard retail sales

4. **Description**
   - Full business description from website
   - Key services offered
   - Target market

---

## Extraction Logic

### Example: Lexani Motorcars

**Website Content Analysis:**

From `https://lexanimotorcars.com/`:
- "boutique custom luxury vehicle conversion company"
- "custom luxury interiors"
- "Executive Escalade conversions"
- "armored luxury vehicle interiors"
- "executive mobile office"

**Extracted Intelligence:**

```typescript
{
  businessType: 'custom_conversion',
  specializations: [
    'custom_interiors',
    'executive_conversions',
    'armored_vehicles',
    'luxury_suv_upgrades'
  ],
  businessModel: 'interior_conversion',
  description: 'Lexani Motorcars is a boutique custom luxury vehicle conversion company specializing in custom luxury interiors, executive vehicle conversions, and armored luxury vehicle interiors.',
  keywords: ['custom', 'luxury', 'interior', 'conversion', 'executive', 'armored']
}
```

### Implementation

```typescript
interface BusinessIntelligence {
  businessType: string;
  specializations: string[];
  businessModel: string | null;
  description: string | null;
  keywords: string[];
}

function analyzeBusinessModel(websiteContent: string): BusinessIntelligence {
  const content = websiteContent.toLowerCase();
  
  // Business type detection
  let businessType = 'dealership';
  if (content.includes('custom') && content.includes('conversion')) {
    businessType = 'custom_conversion';
  } else if (content.includes('restoration')) {
    businessType = 'specialty_shop';
  } else if (content.includes('auction')) {
    businessType = 'auction_house';
  } else if (content.includes('broker')) {
    businessType = 'broker';
  }
  
  // Specializations detection
  const specializations: string[] = [];
  if (content.includes('interior') || content.includes('custom interior')) {
    specializations.push('custom_interiors');
  }
  if (content.includes('executive') || content.includes('mobile office')) {
    specializations.push('executive_conversions');
  }
  if (content.includes('armored') || content.includes('armor')) {
    specializations.push('armored_vehicles');
  }
  if (content.includes('luxury suv') || content.includes('suv upgrade')) {
    specializations.push('luxury_suv_upgrades');
  }
  if (content.includes('restoration') || content.includes('restore')) {
    specializations.push('restoration');
  }
  if (content.includes('tuning') || content.includes('performance')) {
    specializations.push('tuning');
  }
  if (content.includes('classic')) {
    specializations.push('classic_cars');
  }
  if (content.includes('exotic')) {
    specializations.push('exotic_cars');
  }
  if (content.includes('supercar')) {
    specializations.push('supercars');
  }
  
  // Business model detection
  let businessModel: string | null = null;
  if (content.includes('interior') && content.includes('conversion')) {
    businessModel = 'interior_conversion';
  } else if (content.includes('custom build') || content.includes('custom build')) {
    businessModel = 'custom_build';
  } else if (content.includes('restoration')) {
    businessModel = 'restoration';
  } else if (content.includes('tuning')) {
    businessModel = 'tuning';
  } else if (content.includes('broker')) {
    businessModel = 'brokerage';
  }
  
  // Extract description (first paragraph or meta description)
  const description = extractDescription(websiteContent);
  
  // Extract keywords
  const keywords = extractKeywords(websiteContent);
  
  return {
    businessType,
    specializations,
    businessModel,
    description,
    keywords
  };
}

async function scrapeWebsiteContent(url: string): Promise<string> {
  // Use Firecrawl or similar to get clean text content
  const response = await fetch(`https://api.firecrawl.dev/v0/scrape`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url: url,
      formats: ['markdown'],
      onlyMainContent: true
    })
  });
  
  const data = await response.json();
  return data.markdown || data.html || '';
}

function extractDescription(content: string): string | null {
  // Try meta description first
  const metaMatch = content.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
  if (metaMatch) return metaMatch[1];
  
  // Try first paragraph
  const paraMatch = content.match(/<p[^>]*>([^<]+)<\/p>/i);
  if (paraMatch) return paraMatch[1].trim();
  
  // Try first 200 characters of main content
  const textContent = content.replace(/<[^>]+>/g, ' ').trim();
  if (textContent.length > 50) {
    return textContent.substring(0, 200).trim() + '...';
  }
  
  return null;
}

function extractKeywords(content: string): string[] {
  const keywords = new Set<string>();
  const commonTerms = [
    'custom', 'luxury', 'interior', 'conversion', 'executive',
    'armored', 'restoration', 'tuning', 'classic', 'exotic',
    'supercar', 'dealer', 'broker', 'auction'
  ];
  
  const lowerContent = content.toLowerCase();
  commonTerms.forEach(term => {
    if (lowerContent.includes(term)) {
      keywords.add(term);
    }
  });
  
  return Array.from(keywords);
}
```

---

## Integration with Dealer Creation

```typescript
async function createDealerOrganization(
  dealerData: DealerData,
  sourceUrl: string,
  supabase: any
): Promise<string | null> {
  // ... existing code ...
  
  // Extract business intelligence from website
  let businessType = 'dealership';
  let specializations: string[] = [];
  let businessModel: string | null = null;
  let enhancedDescription = dealerData.description;
  
  if (dealerData.website) {
    try {
      console.log(`🔍 Extracting business intelligence from ${dealerData.website}`);
      const websiteContent = await scrapeWebsiteContent(dealerData.website);
      const intelligence = analyzeBusinessModel(websiteContent);
      
      businessType = intelligence.businessType;
      specializations = intelligence.specializations;
      businessModel = intelligence.businessModel;
      
      if (intelligence.description && !enhancedDescription) {
        enhancedDescription = intelligence.description;
      }
      
      console.log(`✅ Detected: ${businessType}, specializations: ${specializations.join(', ')}`);
    } catch (err) {
      console.warn('⚠️ Failed to extract business intelligence:', err);
    }
  }
  
  // Create organization with extracted intelligence
  const { data: newOrg } = await supabase
    .from('businesses')
    .insert({
      business_name: dealerData.name,
      business_type: businessType, // Auto-detected
      specializations: specializations.length > 0 ? specializations : null,
      description: enhancedDescription,
      // ... other fields ...
      metadata: {
        // ... existing metadata ...
        business_model: businessModel,
        intelligence_extracted_at: new Date().toISOString()
      }
    })
    .select('id')
    .single();
  
  return newOrg?.id;
}
```

---

## Key Phrases to Detect

### Custom Conversion Shops
- "custom luxury vehicle conversion"
- "custom interior"
- "interior conversion"
- "bespoke interior"
- "custom build"

### Executive Conversions
- "executive vehicle"
- "executive mobile office"
- "executive conversion"
- "corporate vehicle"

### Armored Vehicles
- "armored vehicle"
- "armored luxury"
- "security vehicle"
- "protection vehicle"

### Restoration
- "restoration"
- "restore"
- "vintage restoration"
- "classic restoration"

### Tuning
- "performance tuning"
- "tuning"
- "performance modification"
- "engine tuning"

---

## Summary

**Automatic Extraction:**
- ✅ Business type (dealership, custom_conversion, specialty_shop, etc.)
- ✅ Specializations (array of specialties)
- ✅ Business model (interior_conversion, custom_build, etc.)
- ✅ Enhanced description from website
- ✅ Keywords for search/discovery

**No Manual Input Required:**
- All intelligence extracted from website content
- Falls back to defaults if extraction fails
- Can be enhanced/verified later by users

**Example Output (Lexani):**
```json
{
  "businessType": "custom_conversion",
  "specializations": [
    "custom_interiors",
    "executive_conversions",
    "armored_vehicles",
    "luxury_suv_upgrades"
  ],
  "businessModel": "interior_conversion",
  "description": "Lexani Motorcars is a boutique custom luxury vehicle conversion company..."
}
```

