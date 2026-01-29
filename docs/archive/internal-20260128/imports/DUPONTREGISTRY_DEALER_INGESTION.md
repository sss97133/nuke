# duPont Registry Dealer Ingestion Strategy

## Overview

Many dealers on duPont Registry have:
1. **Dealer profiles** on duPont Registry (e.g., `/autos/speedart--motorsports/848`)
2. **Their own websites** (e.g., `https://speedartmotorsports.com/`)
3. **Filtered inventory pages** on duPont Registry (e.g., `/autos/results/filter:dealers=speedart--motorsports`)

We need to ingest from **all three sources** and link them to the same organization.

---

## Three-Source Strategy

### Source 1: Dealer Profile Page
**URL Pattern**: `https://www.dupontregistry.com/autos/{dealer-slug}/{dealer-id}`
**Example**: `https://www.dupontregistry.com/autos/speedart--motorsports/848`

**Extract:**
- Dealer name
- Dealer website URL
- Contact info (phone, email, location)
- Description
- Social media links

**Action:**
- Create/update organization
- Store dealer website URL

### Source 2: duPont Registry Filtered Inventory
**URL Pattern**: `https://www.dupontregistry.com/autos/results/filter:dealers={dealer-slug}`
**Example**: `https://www.dupontregistry.com/autos/results/filter:dealers=speedart--motorsports`

**Extract:**
- All vehicle listings from this dealer on duPont Registry
- Link to dealer organization

**Action:**
- Queue all listings to `import_queue`
- Link to dealer organization via `organization_vehicles`

### Source 3: Dealer's Own Website
**URL**: From dealer profile (e.g., `https://speedartmotorsports.com/`)

**Extract:**
- Inventory from dealer's website
- May have more complete/up-to-date inventory
- Different listing format

**Action:**
- Use existing `index-lartdelautomobile` or `scrape-multi-source` pattern
- Extract inventory from dealer website
- Link to same dealer organization
- Deduplicate with duPont Registry listings

---

## Implementation

### Phase 1: Discover All Dealer Profiles

```typescript
async function discoverAllDealerProfiles(
  supabase: any
): Promise<string[]> {
  const dealerUrls = new Set<string>();
  
  // Method 1: Extract from browse pages
  const browseUrl = 'https://www.dupontregistry.com/autos/results/all';
  let page = 1;
  let hasMore = true;
  
  while (hasMore && page < 1000) {
    const pageUrl = page === 1 ? browseUrl : `${browseUrl}?page=${page}`;
    const html = await fetchPage(pageUrl);
    const doc = parseHTML(html);
    
    // Extract dealer profile links
    const dealerLinks = doc.querySelectorAll('a[href*="/autos/"][href*="--"]');
    dealerLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.includes('/listing/') && !href.includes('/results/')) {
        const fullUrl = href.startsWith('http') 
          ? href 
          : `https://www.dupontregistry.com${href}`;
        dealerUrls.add(fullUrl);
      }
    });
    
    // Check for next page
    const nextPage = doc.querySelector('[class*="next"]');
    hasMore = !!nextPage;
    page++;
    
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  // Method 2: Extract from sitemap (if available)
  const sitemapUrls = await extractDealerUrlsFromSitemap();
  sitemapUrls.forEach(url => dealerUrls.add(url));
  
  return Array.from(dealerUrls);
}
```

### Phase 2: Scrape Dealer Profiles

```typescript
async function scrapeDealerProfile(
  profileUrl: string,
  supabase: any
): Promise<{
  organizationId: string | null;
  website: string | null;
  inventoryUrl: string | null;
}> {
  console.log(`📋 Scraping dealer profile: ${profileUrl}`);
  
  // Extract dealer slug and ID from URL
  const match = profileUrl.match(/\/autos\/([^\/]+)\/(\d+)/);
  if (!match) {
    throw new Error(`Invalid dealer profile URL: ${profileUrl}`);
  }
  
  const [, dealerSlug, dealerId] = match;
  
  // Scrape profile page
  const html = await fetchPage(profileUrl);
  const doc = parseHTML(html);
  
  // Extract dealer information
  const dealerName = extractDealerName(doc);
  const website = extractDealerWebsite(doc);
  const phone = extractDealerPhone(doc);
  const email = extractDealerEmail(doc);
  const location = extractDealerLocation(doc);
  const description = extractDealerDescription(doc);
  const instagramHandle = extractInstagramHandle(doc);
  
  // Create/update organization
  const organizationId = await createOrUpdateDealerOrganization({
    name: dealerName,
    slug: dealerSlug,
    id: dealerId,
    website: website,
    phone: phone,
    email: email,
    location: location,
    description: description,
    instagramHandle: instagramHandle,
    profileUrl: profileUrl
  }, supabase);
  
  // Build filtered inventory URL
  const inventoryUrl = `https://www.dupontregistry.com/autos/results/filter:dealers=${dealerSlug}`;
  
  return {
    organizationId,
    website,
    inventoryUrl
  };
}
```

### Phase 3: Extract Inventory from duPont Registry

```typescript
async function extractDupontRegistryInventory(
  inventoryUrl: string,
  organizationId: string,
  sourceId: string,
  supabase: any
): Promise<{ queued: number; duplicates: number }> {
  console.log(`🚗 Extracting inventory from: ${inventoryUrl}`);
  
  const listingUrls = new Set<string>();
  let currentUrl: string | null = inventoryUrl;
  let page = 1;
  
  // Paginate through inventory pages
  while (currentUrl && page < 100) {
    const html = await fetchPage(currentUrl);
    const doc = parseHTML(html);
    
    // Extract listing URLs
    const links = doc.querySelectorAll('a[href*="/autos/listing/"]');
    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href) {
        const fullUrl = href.startsWith('http') 
          ? href 
          : `https://www.dupontregistry.com${href}`;
        listingUrls.add(fullUrl);
      }
    });
    
    // Check for next page
    const nextPageLink = doc.querySelector('[class*="next"] a');
    if (nextPageLink) {
      const nextHref = nextPageLink.getAttribute('href');
      currentUrl = nextHref 
        ? (nextHref.startsWith('http') ? nextHref : `https://www.dupontregistry.com${nextHref}`)
        : null;
    } else {
      currentUrl = null;
    }
    
    page++;
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  
  console.log(`   Found ${listingUrls.size} listings`);
  
  // Queue all listings
  let queued = 0;
  let duplicates = 0;
  
  for (const listingUrl of listingUrls) {
    const result = await addListingToQueue(listingUrl, sourceId, organizationId, supabase);
    if (result.success) {
      queued++;
    } else if (result.skipped) {
      duplicates++;
    }
  }
  
  return { queued, duplicates };
}
```

### Phase 4: Extract Inventory from Dealer Website

```typescript
async function extractDealerWebsiteInventory(
  website: string,
  organizationId: string,
  supabase: any
): Promise<{ queued: number; duplicates: number }> {
  console.log(`🌐 Extracting inventory from dealer website: ${website}`);
  
  // Use existing dealer website scraping infrastructure
  // Similar to index-lartdelautomobile pattern
  
  // Try to find inventory URL
  const inventoryUrl = await findInventoryUrl(website);
  if (!inventoryUrl) {
    console.warn(`   ⚠️  No inventory URL found for ${website}`);
    return { queued: 0, duplicates: 0 };
  }
  
  // Use scrape-multi-source or index-lartdelautomobile pattern
  const { data, error } = await supabase.functions.invoke('scrape-multi-source', {
    body: {
      source_url: inventoryUrl,
      source_type: 'dealer_website',
      organization_id: organizationId,
      max_results: 1000,
      use_llm_extraction: true,
      extract_dealer_info: false, // Already have dealer info
      include_sold: false,
      force_listing_status: 'in_stock'
    }
  });
  
  if (error) {
    console.error(`   ❌ Error scraping dealer website: ${error.message}`);
    return { queued: 0, duplicates: 0 };
  }
  
  return {
    queued: data?.queued || 0,
    duplicates: data?.duplicates || 0
  };
}
```

### Phase 5: Deduplication Strategy

**Same vehicle might be listed on:**
1. duPont Registry (as dealer listing)
2. Dealer's own website

**Deduplication Logic:**

```typescript
async function addListingToQueue(
  listingUrl: string,
  sourceId: string,
  organizationId: string | null,
  supabase: any
): Promise<{ success: boolean; skipped?: boolean }> {
  // Check if already in queue
  const { data: existing } = await supabase
    .from('import_queue')
    .select('id, organization_id')
    .eq('listing_url', listingUrl)
    .maybeSingle();
  
  if (existing) {
    // Update organization link if not set
    if (organizationId && !existing.organization_id) {
      await supabase
        .from('import_queue')
        .update({ organization_id: organizationId })
        .eq('id', existing.id);
    }
    return { success: false, skipped: true };
  }
  
  // Check if vehicle already exists (by VIN or URL)
  // This handles cross-source deduplication
  
  // Add to queue
  await supabase.from('import_queue').insert({
    source_id: sourceId,
    listing_url: listingUrl,
    status: 'pending',
    priority: 5,
    organization_id: organizationId, // Link to dealer organization
    raw_data: {
      source: 'dupontregistry',
      url: listingUrl,
      organization_id: organizationId
    }
  });
  
  return { success: true };
}
```

---

## Complete Dealer Ingestion Flow

```typescript
async function ingestDealerComplete(
  profileUrl: string,
  supabase: any
): Promise<{
  organizationId: string | null;
  dupontListings: { queued: number; duplicates: number };
  websiteListings: { queued: number; duplicates: number };
}> {
  console.log(`\n🏢 Complete dealer ingestion: ${profileUrl}\n`);
  
  // Step 1: Scrape dealer profile
  const profile = await scrapeDealerProfile(profileUrl, supabase);
  
  if (!profile.organizationId) {
    throw new Error('Failed to create/update dealer organization');
  }
  
  // Step 2: Get duPont Registry source ID
  const dupontSourceId = await getOrCreateSource('dupontregistry.com', supabase);
  
  // Step 3: Extract inventory from duPont Registry
  const dupontListings = await extractDupontRegistryInventory(
    profile.inventoryUrl!,
    profile.organizationId,
    dupontSourceId,
    supabase
  );
  
  // Step 4: Extract inventory from dealer website (if available)
  let websiteListings = { queued: 0, duplicates: 0 };
  if (profile.website) {
    websiteListings = await extractDealerWebsiteInventory(
      profile.website,
      profile.organizationId,
      supabase
    );
  }
  
  console.log(`\n✅ Dealer ingestion complete:`);
  console.log(`   Organization: ${profile.organizationId}`);
  console.log(`   duPont Registry: ${dupontListings.queued} queued, ${dupontListings.duplicates} duplicates`);
  console.log(`   Dealer Website: ${websiteListings.queued} queued, ${websiteListings.duplicates} duplicates`);
  
  return {
    organizationId: profile.organizationId,
    dupontListings,
    websiteListings
  };
}
```

---

## Batch Processing All Dealers

```typescript
async function ingestAllDealers(supabase: any) {
  console.log('🚀 Starting complete dealer ingestion\n');
  
  // Step 1: Discover all dealer profiles
  console.log('Phase 1: Discovering dealer profiles...');
  const dealerProfiles = await discoverAllDealerProfiles(supabase);
  console.log(`✅ Found ${dealerProfiles.length} dealer profiles\n`);
  
  // Step 2: Process each dealer
  const results = {
    total: dealerProfiles.length,
    succeeded: 0,
    failed: 0,
    totalDupontListings: 0,
    totalWebsiteListings: 0
  };
  
  for (let i = 0; i < dealerProfiles.length; i++) {
    const profileUrl = dealerProfiles[i];
    console.log(`\n[${i + 1}/${dealerProfiles.length}] ${profileUrl}`);
    
    try {
      const result = await ingestDealerComplete(profileUrl, supabase);
      results.succeeded++;
      results.totalDupontListings += result.dupontListings.queued;
      results.totalWebsiteListings += result.websiteListings.queued;
    } catch (error: any) {
      console.error(`❌ Error: ${error.message}`);
      results.failed++;
    }
    
    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log(`\n✅ Complete dealer ingestion finished:`);
  console.log(`   Total dealers: ${results.total}`);
  console.log(`   Succeeded: ${results.succeeded}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   duPont Registry listings: ${results.totalDupontListings}`);
  console.log(`   Dealer website listings: ${results.totalWebsiteListings}`);
  
  return results;
}
```

---

## Integration with Main Ingestion

### Updated Large-Scale Strategy

1. **Discover all listings** (14,821 total)
   - Includes dealer listings
   - Includes private listings

2. **Discover all dealer profiles**
   - Extract dealer websites
   - Create organizations

3. **Extract dealer inventories** (from both sources)
   - duPont Registry filtered pages
   - Dealer websites

4. **Deduplicate**
   - Same vehicle might be on both sources
   - Link to same organization

5. **Process queue**
   - All listings go through `process-import-queue`
   - Link to organizations via `organization_vehicles`

---

## Key Benefits

1. ✅ **Complete Coverage**: Get inventory from both duPont Registry AND dealer websites
2. ✅ **Better Data**: Dealer websites may have more complete/up-to-date info
3. ✅ **Organization Linking**: All vehicles linked to same dealer organization
4. ✅ **Deduplication**: Same vehicle from multiple sources handled correctly
5. ✅ **Scalable**: Uses existing infrastructure (`scrape-multi-source`, `process-import-queue`)

---

## Summary

**For each dealer:**
1. Scrape dealer profile → Create organization
2. Extract inventory from duPont Registry filtered page
3. Extract inventory from dealer's own website
4. Queue all listings (with deduplication)
5. Link all vehicles to same organization

**Result:**
- Complete dealer inventory (from both sources)
- Proper organization linking
- No duplicate vehicles
- Ready for processing via `process-import-queue`

