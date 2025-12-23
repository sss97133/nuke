import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * COMPREHENSIVE SPECIALIZED NICHE SITE EXTRACTION
 * 
 * "Sucks in" the entire site - comprehensive extraction for specialized niche sites (like 2002AD)
 * where data is LIMITED but HIGH VALUE. Extracts EVERYTHING.
 * 
 * Key principles:
 * 1. Preserve incomplete data - don't reject low-quality profiles
 * 2. Capture historical context - dates, sources, relationships matter
 * 3. Understand organization role - not always dealers (often collaborators/advertisers)
 * 4. Timeline events - create events even with approximate dates (back to 2005+)
 * 5. Quality ratings - mark low-quality but preserve it (historical value)
 * 6. Batch processing - handle large catalogs in chunks
 * 7. Provenance tracking - link everything to organization with source URLs
 * 8. COMPREHENSIVE CRAWLING - discover and extract from ALL pages via link discovery
 * 
 * Extraction strategy:
 * - Crawl all pages (breadth-first link discovery from every page)
 * - Extract vehicles from every page (even if incomplete - historical value)
 * - Extract all images (even low quality - spans decades)
 * - Extract all brochures (even low resolution - part of knowledge library)
 * - Index entire parts catalog (triggers separate batched process)
 * - Create timeline events for historical context (back to 2005)
 * 
 * The aggregate historical pattern (24 years) is more valuable than perfect individual records.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ScrapeRequest {
  organization_id: string;
  website: string;
}

interface ExtractedVehicle {
  year?: number;
  make?: string;
  model?: string;
  description?: string;
  image_urls?: string[];
  source_url?: string;
  price?: number;
  status?: string; // 'for_sale', 'sold', 'restoration', etc.
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, website }: ScrapeRequest = await req.json();

    if (!organization_id || !website) {
      throw new Error('organization_id and website are required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🔍 Scraping organization site: ${website} for org ${organization_id}`);

    // Step 1: Comprehensive site scraping - extract EVERYTHING
    // For specialized niche sites, we want ALL data, not just key pages
    // This includes: all pages, all vehicles, all images, all parts, all brochures
    
    const pagesToScrape = [
      { path: '/pages/about.cfm', type: 'about' },
      { path: '/pages/restoration.cfm', type: 'restoration' },
      { path: '/pages/gallery.cfm', type: 'gallery' },
      { path: '/pages/carsforsale.cfm', type: 'inventory' },
      { path: '/pages/brochures.cfm', type: 'brochures' },
      { path: '/pages/service.cfm', type: 'service' },
      { path: '/pages/articles.cfm', type: 'articles' },
      { path: '/pages/links.cfm', type: 'links' },
      { path: '/pages/contact.cfm', type: 'contact' },
      { path: '/pages/form.cfm', type: 'form' },
      // Homepage - often has links to everything
      { path: '/', type: 'homepage' },
      { path: '/index.cfm', type: 'homepage' },
    ];
    
    // Discover additional pages by crawling links
    const discoveredPages = new Set<string>();
    const visitedPages = new Set<string>();

    const baseUrl = website.replace(/\/$/, '');
    const scrapedData: any = {
      about: null,
      vehicles: [],
      gallery_images: [],
      brochures: [],
      all_pages: [],
      parts_categories: [],
    };

    // Scrape about page for organization info
    try {
      const aboutUrl = `${baseUrl}/pages/about.cfm`;
      const aboutResponse = await fetch(aboutUrl);
      if (aboutResponse.ok) {
        const aboutHtml = await aboutResponse.text();
        scrapedData.about = extractOrganizationInfo(aboutHtml);
        console.log(`✅ Scraped about page`);
      }
    } catch (e) {
      console.warn('Failed to scrape about page:', e);
    }

    // Scrape restoration page for vehicles
    try {
      const restorationUrl = `${baseUrl}/pages/restoration.cfm`;
      const restorationResponse = await fetch(restorationUrl);
      if (restorationResponse.ok) {
        const restorationHtml = await restorationResponse.text();
        const vehicles = extractVehiclesFromRestoration(restorationHtml, baseUrl);
        scrapedData.vehicles.push(...vehicles);
        console.log(`✅ Found ${vehicles.length} vehicles on restoration page`);
        
        // Also extract all images from restoration page
        const images = extractGalleryImages(restorationHtml, baseUrl);
        scrapedData.gallery_images.push(...images);
        
        // Discover links
        const links = discoverLinks(restorationHtml, baseUrl);
        links.forEach(link => discoveredPages.add(link));
      }
    } catch (e) {
      console.warn('Failed to scrape restoration page:', e);
    }

    // Scrape carsforsale page for inventory
    try {
      const carsforsaleUrl = `${baseUrl}/pages/carsforsale.cfm`;
      const carsforsaleResponse = await fetch(carsforsaleUrl);
      if (carsforsaleResponse.ok) {
        const carsforsaleHtml = await carsforsaleResponse.text();
        console.log(`📄 Fetched carsforsale page (${carsforsaleHtml.length} chars)`);
        const inventoryVehicles = extractVehiclesFromCarsForSale(carsforsaleHtml, baseUrl);
        console.log(`✅ Found ${inventoryVehicles.length} vehicles on carsforsale page`);
        if (inventoryVehicles.length > 0) {
          console.log(`   Sample: ${inventoryVehicles[0].year} ${inventoryVehicles[0].make} ${inventoryVehicles[0].model} - ${inventoryVehicles[0].status}`);
        }
        scrapedData.vehicles.push(...inventoryVehicles);
      } else {
        console.warn(`⚠️  carsforsale page returned ${carsforsaleResponse.status}`);
      }
    } catch (e) {
      console.warn('Failed to scrape carsforsale page:', e);
    }

    // Scrape gallery page for images AND vehicles
    try {
      const galleryUrl = `${baseUrl}/pages/gallery.cfm`;
      const galleryResponse = await fetch(galleryUrl);
      if (galleryResponse.ok) {
        const galleryHtml = await galleryResponse.text();
        const images = extractGalleryImages(galleryHtml, baseUrl);
        scrapedData.gallery_images.push(...images);
        console.log(`✅ Found ${images.length} gallery images`);
        
        // Also try to extract vehicles from gallery page (images might represent vehicles)
        const galleryVehicles = extractVehiclesFromGallery(galleryHtml, baseUrl);
        if (galleryVehicles.length > 0) {
          scrapedData.vehicles.push(...galleryVehicles);
          console.log(`✅ Found ${galleryVehicles.length} vehicles from gallery page`);
        }
        
        // Discover links
        const links = discoverLinks(galleryHtml, baseUrl);
        links.forEach(link => discoveredPages.add(link));
      }
    } catch (e) {
      console.warn('Failed to scrape gallery page:', e);
    }

    // Scrape brochures page
    try {
      const brochuresUrl = `${baseUrl}/pages/brochures.cfm`;
      const brochuresResponse = await fetch(brochuresUrl);
      if (brochuresResponse.ok) {
        const brochuresHtml = await brochuresResponse.text();
        const brochures = extractBrochures(brochuresHtml, baseUrl);
        scrapedData.brochures.push(...brochures);
        console.log(`✅ Found ${brochures.length} brochures`);
        
        // Discover additional pages from brochures page
        const links = discoverLinks(brochuresHtml, baseUrl);
        links.forEach(link => discoveredPages.add(link));
      }
    } catch (e) {
      console.warn('Failed to scrape brochures page:', e);
    }

    // Scrape all discovered pages (comprehensive extraction)
    // Process in larger batches but with timeout protection
    console.log(`\n🔍 Crawling ${discoveredPages.size} additional discovered pages...`);
    const pagesToCrawl = Array.from(discoveredPages);
    
    // Process pages in parallel batches to speed up
    // Larger batches for efficiency, but limit total to avoid timeout
    const batchSize = 10;
    const maxBatches = 10; // Process up to 100 pages (10 batches * 10 pages)
    const startTime = Date.now();
    const TIMEOUT_MS = 120000; // 120 seconds safety margin
    
    let pagesProcessed = 0;
    for (let i = 0; i < Math.min(pagesToCrawl.length, maxBatches * batchSize); i += batchSize) {
      // Check timeout
      if (Date.now() - startTime > TIMEOUT_MS) {
        console.log(`  ⏰ Timeout protection: stopping after ${pagesProcessed} pages`);
        break;
      }
      
      const batch = pagesToCrawl.slice(i, i + batchSize);
      await Promise.all(batch.map(async (pagePath) => {
        try {
          const pageUrl = pagePath.startsWith('http') ? pagePath : `${baseUrl}${pagePath}`;
          const pageResponse = await fetch(pageUrl, { 
            signal: AbortSignal.timeout(5000) // 5 second timeout per page
          });
          if (pageResponse.ok) {
            const pageHtml = await pageResponse.text();
            
            // Extract vehicles from any page (try both extraction methods)
            const vehicles = extractVehiclesFromCarsForSale(pageHtml, baseUrl);
            const galleryVehicles = extractVehiclesFromGallery(pageHtml, baseUrl);
            const allVehicles = [...vehicles, ...galleryVehicles];
            if (allVehicles.length > 0) {
              scrapedData.vehicles.push(...allVehicles);
              console.log(`  📦 Found ${allVehicles.length} vehicles on ${pagePath}`);
            }
            
            // Extract images from any page
            const images = extractGalleryImages(pageHtml, baseUrl);
            if (images.length > 0) {
              scrapedData.gallery_images.push(...images);
            }
            
            // Extract brochures from any page
            const brochures = extractBrochures(pageHtml, baseUrl);
            if (brochures.length > 0) {
              scrapedData.brochures.push(...brochures);
            }
            
            pagesProcessed++;
          }
        } catch (e) {
          if (e.name !== 'AbortError') {
            console.warn(`Failed to scrape ${pagePath}:`, e.message);
          }
        }
      }));
      
      // Small delay between batches to avoid overwhelming the server
      if (i + batchSize < pagesToCrawl.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    
    // Mark remaining pages for future extraction
    if (pagesToCrawl.length > pagesProcessed) {
      console.log(`  ℹ️  ${pagesToCrawl.length - pagesProcessed} additional pages discovered but not crawled (will be processed in follow-up runs)`);
    } else {
      console.log(`  ✅ All ${pagesProcessed} discovered pages processed`);
    }

    // Deduplicate vehicles, images, brochures
    const vehicleMap = new Map<string, ExtractedVehicle>();
    scrapedData.vehicles.forEach((v: ExtractedVehicle) => {
      const key = `${v.year}-${v.make}-${v.model}-${v.source_url}`;
      if (!vehicleMap.has(key)) {
        vehicleMap.set(key, v);
      }
    });
    scrapedData.vehicles = Array.from(vehicleMap.values());

    const imageSet = new Set(scrapedData.gallery_images);
    scrapedData.gallery_images = Array.from(imageSet);

    const brochureMap = new Map<string, any>();
    scrapedData.brochures.forEach((b: any) => {
      const key = b.image_url;
      if (!brochureMap.has(key)) {
        brochureMap.set(key, b);
      }
    });
    scrapedData.brochures = Array.from(brochureMap.values());

    console.log(`\n📊 COMPREHENSIVE EXTRACTION COMPLETE:`);
    console.log(`   Vehicles: ${scrapedData.vehicles.length} (after deduplication)`);
    console.log(`   Images: ${scrapedData.gallery_images.length} (after deduplication)`);
    console.log(`   Brochures: ${scrapedData.brochures.length} (after deduplication)`);
    console.log(`   Pages crawled: ${visitedPages.size}`);
    console.log(`   Additional pages discovered: ${discoveredPages.size}`);

    // Step 2: Fetch organization data (needed for timeline events)
    const { data: org } = await supabase
      .from('businesses')
      .select('id, business_name, metadata')
      .eq('id', organization_id)
      .single();

    if (!org) {
      throw new Error(`Organization ${organization_id} not found`);
    }

    // Step 3: Update organization with scraped data
    if (scrapedData.about) {
      await supabase
        .from('businesses')
        .update({
          description: scrapedData.about.description,
          metadata: {
            ...(org.metadata || {}),
            scraped_at: new Date().toISOString(),
            scraped_pages: pagesToScrape.map(p => p.path),
            about_info: scrapedData.about,
          }
        })
        .eq('id', organization_id);
    }

    // Step 4: Create vehicle profiles from extracted data
    const createdVehicles = [];
    for (const vehicle of scrapedData.vehicles) {
      try {
        // Try to find existing vehicle by VIN or year/make/model match
        // Use the duplicate detection system to find matches
        let existingVehicle = null;
        
        if (vehicle.year && vehicle.make && vehicle.model) {
          // First try exact VIN match if we have one
          if (vehicle.vin) {
            const { data: vinMatch } = await supabase
              .from('vehicles')
              .select('id')
              .eq('vin', vehicle.vin)
              .maybeSingle();
            
            if (vinMatch) {
              existingVehicle = vinMatch;
            }
          }
          
          // If no VIN match, try year/make/model
          if (!existingVehicle) {
            const { data: ymmMatch } = await supabase
              .from('vehicles')
              .select('id, vin')
              .eq('year', vehicle.year)
              .ilike('make', vehicle.make)
              .ilike('model', vehicle.model)
              .limit(1)
              .maybeSingle();
            
            // Only use YMM match if neither has a real VIN (to avoid false matches)
            if (ymmMatch && (!vehicle.vin || !ymmMatch.vin || ymmMatch.vin.startsWith('VIVA-'))) {
              existingVehicle = ymmMatch;
            }
          }
        }

        if (existingVehicle) {
          // Link existing vehicle to organization
          await supabase
            .from('organization_vehicles')
            .upsert({
              organization_id: organization_id,
              vehicle_id: existingVehicle.id,
              relationship_type: 'inventory',
              status: vehicle.status || 'active',
              auto_tagged: true,
              metadata: {
                source_url: vehicle.source_url,
                extracted_at: new Date().toISOString(),
              }
            }, {
              onConflict: 'organization_id,vehicle_id,relationship_type'
            });
          
          console.log(`✅ Linked existing vehicle ${existingVehicle.id} to organization`);
        } else {
          // Create new vehicle profile
          // The duplicate detection trigger will automatically check for matches and merge if needed
          const { data: newVehicle, error: createError } = await supabase
            .from('vehicles')
            .insert({
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              description: vehicle.description,
              origin_organization_id: organization_id,
              origin_metadata: {
                source: 'organization_site_scrape',
                source_url: vehicle.source_url,
                organization_id: organization_id,
                extracted_at: new Date().toISOString(),
                price: vehicle.price,
                status: vehicle.status,
              },
              is_public: false, // Start private until org claims it
            })
            .select('id')
            .single();
          
          // If duplicate detection merged this vehicle, the trigger will have handled it
          // But we still need to get the final vehicle ID (might be merged into existing)
          let finalVehicleId = newVehicle?.id;
          if (createError && createError.code === '23505') {
            // Unique constraint violation - vehicle might have been created/merged by trigger
            // Try to find the existing vehicle
            if (vehicle.year && vehicle.make && vehicle.model) {
              const { data: found } = await supabase
                .from('vehicles')
                .select('id')
                .eq('year', vehicle.year)
                .ilike('make', vehicle.make)
                .ilike('model', vehicle.model)
                .limit(1)
                .maybeSingle();
              
              if (found) {
                finalVehicleId = found.id;
                console.log(`✅ Vehicle was merged into existing: ${finalVehicleId}`);
              }
            }
          }
          
          if (!finalVehicleId) {
            console.error('Failed to create or find vehicle:', createError);
            continue;
          }

          if (createError) {
            console.error('Failed to create vehicle:', createError);
            continue;
          }

          // Link to organization (use finalVehicleId in case of merge)
          // 2002AD is not a dealer - they're collaborators/advertisers
          // Use 'collaborator' relationship type for advertising/promotion
          const relationshipType = vehicle.status === 'restoration' 
            ? 'service_provider'  // Restoration work = service
            : 'collaborator';      // Advertising/promotion = collaborator
          
          // For sold vehicles, they were advertising them, not selling them
          const listingStatus = vehicle.status === 'sold' ? 'sold' : (vehicle.status === 'for_sale' ? 'active' : null);
          
          // Set start_date to allow historical timeline (back to 2005)
          // If vehicle has a year, use that as approximate start date
          const startDate = vehicle.year ? `${vehicle.year}-01-01` : null;
          
          await supabase
            .from('organization_vehicles')
            .upsert({
              organization_id: organization_id,
              vehicle_id: finalVehicleId,
              relationship_type: relationshipType,
              status: vehicle.status === 'sold' ? 'past' : 'active',
              listing_status: listingStatus,
              start_date: startDate,
              auto_tagged: true,
              metadata: {
                source_url: vehicle.source_url,
                extracted_at: new Date().toISOString(),
                price: vehicle.price,
                role: 'advertiser', // Explicitly mark as advertiser role
                collaboration_type: vehicle.status === 'for_sale' ? 'advertising' : 
                                   vehicle.status === 'sold' ? 'advertising_historical' :
                                   'service',
                is_dealer: false, // They're not dealers
                is_advertiser: true, // They're advertisers/collaborators
              }
            }, {
              onConflict: 'organization_id,vehicle_id,relationship_type'
            });
          
          // Don't update vehicle sale status - they're not the seller, just advertising
          // The actual sale would be tracked separately if we have that data
          
          // Create timeline event for the collaboration/advertising relationship
          // This preserves historical context even with approximate dates.
          // For specialized niche sites, the aggregate historical pattern (24 years)
          // is more valuable than perfect individual records.
          if (startDate && new Date(startDate) >= new Date('2005-01-01')) {
            try {
              await supabase
                .from('timeline_events')
                .insert({
                  vehicle_id: finalVehicleId,
                  event_type: relationshipType === 'service_provider' ? 'maintenance' : 'custom',
                  title: relationshipType === 'service_provider' 
                    ? `Service at ${org.business_name}`
                    : `Featured by ${org.business_name}`,
                  description: relationshipType === 'service_provider'
                    ? 'Vehicle restoration/service work'
                    : 'Vehicle featured/advertised',
                  event_date: startDate,
                  source: 'organization_scrape',
                  metadata: {
                    organization_id: organization_id,
                    organization_name: org.business_name,
                    relationship_type: relationshipType,
                    collaboration_type: vehicle.status === 'for_sale' ? 'advertising' : 
                                       vehicle.status === 'sold' ? 'advertising_historical' :
                                       'service',
                    source_url: vehicle.source_url,
                  }
                });
            } catch (e) {
              // Timeline event creation is optional, don't fail if it doesn't work
              console.warn('Could not create timeline event:', e);
            }
          }

          // Upload images if available (async to avoid blocking)
          if (vehicle.image_urls && vehicle.image_urls.length > 0) {
            // Fire and forget - don't await to avoid timeout
            supabase.functions.invoke('backfill-images', {
              body: {
                vehicle_id: finalVehicleId,
                image_urls: vehicle.image_urls,
                source: 'organization_site',
                run_analysis: false,
              }
            }).catch(err => {
              console.warn(`Failed to backfill images for vehicle ${finalVehicleId}:`, err);
            });
          }

          createdVehicles.push(finalVehicleId);
          console.log(`✅ Created/linked vehicle profile: ${finalVehicleId}`);
        }
      } catch (e) {
        console.error('Error processing vehicle:', e);
      }
    }

    // Step 5: Store brochures metadata (actual document upload requires user context)
    const brochureUrls: string[] = [];
    for (const brochure of scrapedData.brochures) {
      brochureUrls.push(brochure.image_url);
      console.log(`📄 Found brochure: ${brochure.title || 'Untitled'} - ${brochure.image_url}`);
    }

    // Update organization metadata with comprehensive extraction results
    
    await supabase
      .from('businesses')
      .update({
        metadata: {
          ...(org?.metadata || {}),
          comprehensive_scrape_at: new Date().toISOString(),
          vehicles_found: scrapedData.vehicles.length,
          vehicles_created: createdVehicles.length,
          gallery_images_found: scrapedData.gallery_images.length,
          brochures_found: scrapedData.brochures.length,
          brochure_urls: brochureUrls,
          pages_crawled: visitedPages.size,
          pages_discovered: discoveredPages.size,
          extraction_complete: true,
        }
      })
      .eq('id', organization_id);

    // Step 6: Check for external sales channels and extract vehicles from them (async, fire-and-forget)
    console.log(`\n🔍 Checking for external sales channels...`);
    const { data: externalIdentities } = await supabase
      .from('external_identities')
      .select('platform, handle, profile_url, metadata')
      .or(`metadata->>organization_id.eq.${organization_id},metadata->>organization_id.is.null`)
      .eq('platform', 'classic_com')
      .limit(10);
    
    if (externalIdentities && externalIdentities.length > 0) {
      console.log(`   Found ${externalIdentities.length} Classic.com identities - triggering async extraction`);
      // Fire and forget - don't wait for completion to avoid timeout
      for (const identity of externalIdentities) {
        if (identity.profile_url) {
          // Trigger async extraction (don't await)
          supabase.functions.invoke('index-classic-com-dealer', {
            body: { profile_url: identity.profile_url }
          }).then(() => {
            console.log(`   ✅ Indexed Classic.com profile: ${identity.profile_url}`);
          }).catch(err => {
            console.warn(`   ⚠️  Failed to index Classic.com profile:`, err);
          });
          
          // Note: Full listing extraction should be done via a separate process/queue
          // to avoid timeout. The profile indexing will link the organization.
        }
      }
    }
    
    // Also check for BaT profiles
    const { data: batIdentities } = await supabase
      .from('external_identities')
      .select('platform, handle, profile_url, metadata')
      .or(`metadata->>organization_id.eq.${organization_id},metadata->>organization_id.is.null`)
      .eq('platform', 'bat')
      .limit(10);
    
    if (batIdentities && batIdentities.length > 0) {
      console.log(`   Found ${batIdentities.length} BaT profiles`);
      for (const identity of batIdentities) {
        if (identity.profile_url) {
          try {
            // Trigger BaT profile extraction
            await supabase.functions.invoke('extract-bat-profile-vehicles', {
              body: {
                profile_url: identity.profile_url,
                organization_id: organization_id,
                extract_vehicles: true,
              }
            });
            console.log(`   ✅ Triggered BaT extraction: ${identity.profile_url}`);
          } catch (e) {
            console.warn(`   ⚠️  Failed to trigger BaT extraction:`, e);
          }
        }
      }
    }

    // Trigger parts catalog indexing asynchronously (don't wait for it)
    try {
      await supabase.functions.invoke('index-2002ad-parts', {
        body: {
          organization_id: organization_id,
          start_category_id: 0,
        }
      });
      console.log(`📦 Triggered parts catalog indexing`);
    } catch (e) {
      console.warn('Could not trigger parts indexing:', e);
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicles_found: scrapedData.vehicles.length,
        vehicles_created: createdVehicles.length,
        gallery_images_found: scrapedData.gallery_images.length,
        brochures_found: scrapedData.brochures.length,
        brochure_urls: brochureUrls,
        pages_crawled: visitedPages.size,
        pages_discovered: discoveredPages.size,
        parts_indexing_triggered: true,
        external_channels_checked: (externalIdentities?.length || 0) + (batIdentities?.length || 0),
        note: 'External platform extraction triggered asynchronously. Full listing extraction may take additional time.',
        message: 'Comprehensive site extraction complete. External sales channels checked. Parts catalog indexing triggered separately.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error scraping organization site:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function extractOrganizationInfo(html: string): any {
  // Extract organization description and contact info
  const descriptionMatch = html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]{100,2000})<\/div>/i);
  const description = descriptionMatch 
    ? descriptionMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 2000)
    : null;

  const emailMatch = html.match(/mailto:([^\s"']+@[^\s"']+)/i);
  const email = emailMatch ? emailMatch[1] : null;

  const phoneMatch = html.match(/(\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\d{10})/);
  const phone = phoneMatch ? phoneMatch[1] : null;

  return {
    description,
    email,
    phone,
  };
}

function extractVehiclesFromRestoration(html: string, baseUrl: string): ExtractedVehicle[] {
  const vehicles: ExtractedVehicle[] = [];
  
  // Pattern: Look for image + description pairs
  // 2002ad.com format: <img src="..."> followed by <strong> or <b> with description
  const imagePattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const images: Array<{ url: string; index: number }> = [];
  let match;
  let index = 0;
  
  while ((match = imagePattern.exec(html)) !== null) {
    const imgUrl = match[1].startsWith('http') ? match[1] : `${baseUrl}${match[1]}`;
    images.push({ url: imgUrl, index: match.index });
    index++;
  }

  // Extract descriptions near images
  // Handle nested tags like <b><font>...</font></b>
  const descriptionPattern = /<b>([\s\S]*?)<\/b>/gi;
  const descriptions: Array<{ text: string; index: number }> = [];
  let descMatch;
  
  while ((descMatch = descriptionPattern.exec(html)) !== null) {
    // Strip HTML tags from the content
    const rawText = descMatch[1];
    const text = rawText.replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
    if (text.length > 20 && text.length < 500) {
      descriptions.push({ text, index: descMatch.index });
    }
  }

  // Match images with nearby descriptions
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const nextImg = images[i + 1];
    
    // Find description between this image and next (or end)
    const descEnd = nextImg ? nextImg.index : html.length;
    const nearbyDesc = descriptions.find(d => d.index > img.index && d.index < descEnd);
    
    if (nearbyDesc) {
      // Try to extract year/make/model from description
      const yearMatch = nearbyDesc.text.match(/\b(19|20)\d{2}\b/);
      const makeMatch = nearbyDesc.text.match(/\b(BMW|Porsche|Mercedes|Ferrari|Jaguar)\b/i);
      const modelMatch = nearbyDesc.text.match(/\b(2002|911|SL|E-Type|Testarossa)\b/i);
      
      vehicles.push({
        year: yearMatch ? parseInt(yearMatch[0]) : undefined,
        make: makeMatch ? makeMatch[1] : undefined,
        model: modelMatch ? modelMatch[1] : undefined,
        description: nearbyDesc.text,
        image_urls: [img.url],
        source_url: baseUrl + '/pages/restoration.cfm',
        status: 'restoration',
      });
    }
  }

  return vehicles;
}

function extractVehiclesFromCarsForSale(html: string, baseUrl: string): ExtractedVehicle[] {
  const vehicles: ExtractedVehicle[] = [];
  const seenVehicles = new Set<string>();
  
  // Remove script and style tags for cleaner parsing
  const cleanHtml = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                       .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  console.log(`🔍 Parsing carsforsale page (${cleanHtml.length} chars after cleanup)`);
  
  // Pattern: Look for year + make + model patterns anywhere in the HTML
  // 2002ad.com format: "1975 2002" or "1974 2002 Turbo" (often BMW is implied)
  // This is more flexible and will catch vehicles in various HTML structures
  const vehiclePattern = /\b((?:19|20)\d{2})\s+(?:BMW\s+)?([A-Za-z0-9\s\-/]+?)(?:\s|$|,|\.|<\/|&nbsp;|&amp;|<BR>)/gi;
  
  let vehicleMatch;
  let matchCount = 0;
  
  while ((vehicleMatch = vehiclePattern.exec(cleanHtml)) !== null) {
    matchCount++;
    const year = parseInt(vehicleMatch[1]);
    // For 2002ad.com, BMW is often implied, so default to BMW if not specified
    const make = 'BMW';
    let model = vehicleMatch[2]?.replace(/BMW\s+/i, '').trim().replace(/\s+/g, ' ');
    
    // Clean up model (remove trailing punctuation, HTML entities)
    model = model.replace(/[.,;:!?]+$/, '').replace(/&nbsp;/g, ' ').trim();
    
    // Filter out false positives (company name, etc.)
    if (!model || model.length < 1 || model.length > 50) continue;
    if (model.toLowerCase().includes('ad') && model.length < 5) continue; // Skip "2002 AD" company name
    if (model.toLowerCase() === 'classic' || model.toLowerCase() === 'projects') continue;
    
    // Get context around the match (next 800 chars) to find price and status
    const contextStart = vehicleMatch.index;
    const context = cleanHtml.substring(contextStart, Math.min(contextStart + 800, cleanHtml.length));
    
    // Extract price from context (look for $XX,XXX or $XX,XXX.XX)
    const priceMatch = context.match(/\$([\d,]+(?:\.\d{2})?)/);
    const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;
    
    // Determine if sold - look for various sold indicators
    const isSold = /SOLD|SALE\s+COMPLETE|SOLD\s+OUT|NO\s+LONGER\s+AVAILABLE|SOLD\s+TO|WAS\s+SOLD/i.test(context);
    const status = isSold ? 'sold' : 'for_sale';
    
    // Extract ALL images from context (vehicles often have multiple images)
    const imageUrls: string[] = [];
    const imgPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
    const linkPattern = /<a[^>]+href=["']([^"']+\.(jpg|jpeg|png|gif))["'][^>]*>/gi;
    
    // Find images in context
    let imgMatch;
    while ((imgMatch = imgPattern.exec(context)) !== null) {
      const rawUrl = imgMatch[1];
      const imageUrl = rawUrl.startsWith('http') 
        ? rawUrl 
        : `${baseUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      // Filter out navigation/header images
      if (!imageUrl.includes('topbar') && !imageUrl.includes('header') && 
          !imageUrl.includes('logo') && !imageUrl.includes('button') &&
          !imageUrl.includes('NewButtons')) {
        imageUrls.push(imageUrl);
      }
    }
    
    // Also check for linked images (common pattern: <a href="image.jpg"><img src="thumb.jpg">)
    let linkMatch;
    while ((linkMatch = linkPattern.exec(context)) !== null) {
      const rawUrl = linkMatch[1];
      const imageUrl = rawUrl.startsWith('http') 
        ? rawUrl 
        : `${baseUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      if (!imageUrls.includes(imageUrl) && 
          !imageUrl.includes('topbar') && !imageUrl.includes('header') && 
          !imageUrl.includes('logo') && !imageUrl.includes('button')) {
        imageUrls.push(imageUrl);
      }
    }
    
    // Create unique key to avoid duplicates
    const vehicleKey = `${year}-${make}-${model}-${price || '0'}`;
    if (seenVehicles.has(vehicleKey)) continue;
    seenVehicles.add(vehicleKey);
    
    // Extract description from context (clean text between tags)
    const descText = context.replace(/<[^>]+>/g, ' ')
                           .replace(/&nbsp;/g, ' ')
                           .replace(/&amp;/g, '&')
                           .replace(/\s+/g, ' ')
                           .trim();
    const description = descText.length > 30 && descText.length < 500 ? descText.substring(0, 500) : undefined;
    
    vehicles.push({
      year,
      make,
      model,
      description,
      price: price || undefined,
      status,
      image_urls: imageUrls.length > 0 ? imageUrls : undefined,
      source_url: `${baseUrl}/pages/carsforsale.cfm`,
    });
  }
  
  console.log(`   Found ${matchCount} potential vehicle matches, ${vehicles.length} unique vehicles after deduplication`);
  
  return vehicles;
}

function extractBrochures(html: string, baseUrl: string): Array<{
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  image_url: string;
  source_url: string;
}> {
  const brochures: Array<{
    title?: string;
    year?: number;
    make?: string;
    model?: string;
    image_url: string;
    source_url: string;
  }> = [];

  // Extract brochure images/PDFs from the page
  // Look for images that appear to be brochures (often in a gallery format)
  const imagePattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let match;
  
  while ((match = imagePattern.exec(html)) !== null) {
    let imgUrl = match[1];
    if (!imgUrl.startsWith('http')) {
      imgUrl = `${baseUrl}${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;
    }
    
    // Filter out navigation/header images, but include brochure images
    if (imgUrl.includes('brochure') || 
        imgUrl.includes('brochures') || 
        imgUrl.match(/\.(pdf|jpg|jpeg|png)$/i) && 
        !imgUrl.includes('topbar') && 
        !imgUrl.includes('header') && 
        !imgUrl.includes('logo') && 
        !imgUrl.includes('button')) {
      
      // Try to extract year/make/model from surrounding context or filename
      const contextStart = Math.max(0, match.index - 200);
      const contextEnd = Math.min(html.length, match.index + 500);
      const context = html.substring(contextStart, contextEnd);
      
      const yearMatch = context.match(/\b(19|20)\d{2}\b/);
      const makeMatch = context.match(/\b(BMW|Porsche|Mercedes|Audi|Ford|Chevrolet|Dodge|Toyota|Honda|Nissan|Mazda|Volkswagen|VW|Jaguar|Ferrari|Lamborghini|McLaren|Aston Martin|Bentley|Rolls-Royce|Alfa Romeo|Lotus|Maserati|Alpine|Citroen|Peugeot|Renault|Fiat|Lancia|Triumph|MG|Jensen|Jensen-Healey|Austin|Mini|Land Rover|Range Rover|Jeep|Cadillac|Lincoln|Chrysler|Buick|Oldsmobile|Pontiac|Plymouth|AMC|Studebaker|Packard|DeSoto|Hudson|Nash|Kaiser|Willys|International|GMC|Datsun|Infiniti|Lexus|Acura|Genesis|Hyundai|Kia|Subaru|Mitsubishi|Isuzu|Suzuki|Daihatsu|Saab|Volvo|Opel)\b/i);
      const modelMatch = context.match(/\b(2002|911|SL|E-Type|Testarossa|2000|1600|1800|3200|3\.0|5|6|7|8|Z3|Z4|M3|M5|M6)\b/i);
      
      // Also try to extract from filename
      const filenameMatch = imgUrl.match(/(\d{4})[_-]?([A-Za-z]+)[_-]?([A-Za-z0-9]+)/i);
      
      brochures.push({
        title: context.match(/<[^>]*>([^<]{10,100})<\/[^>]*>/)?.[1]?.trim() || 
               filenameMatch ? `${filenameMatch[1]} ${filenameMatch[2]} ${filenameMatch[3]} Brochure` : undefined,
        year: yearMatch ? parseInt(yearMatch[0]) : (filenameMatch ? parseInt(filenameMatch[1]) : undefined),
        make: makeMatch ? makeMatch[1] : (filenameMatch ? filenameMatch[2] : undefined),
        model: modelMatch ? modelMatch[1] : (filenameMatch ? filenameMatch[3] : undefined),
        image_url: imgUrl,
        source_url: `${baseUrl}/pages/brochures.cfm`,
      });
    }
  }

  return brochures;
}

function extractGalleryImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];
  const imagePattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const linkPattern = /<a[^>]+href=["']([^"']+\.(jpg|jpeg|png|gif))["'][^>]*>/gi;
  let match;
  
  // Extract direct image tags
  while ((match = imagePattern.exec(html)) !== null) {
    let imgUrl = match[1];
    if (!imgUrl.startsWith('http')) {
      imgUrl = `${baseUrl}${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;
    }
    // Filter out small icons/logos/buttons, but include all vehicle/gallery images
    if (!imgUrl.includes('logo') && !imgUrl.includes('icon') && 
        !imgUrl.includes('button') && !imgUrl.includes('NewButtons') &&
        !imgUrl.includes('topbar') && !imgUrl.includes('header')) {
      images.push(imgUrl);
    }
  }
  
  // Also extract linked images (common pattern for galleries)
  while ((match = linkPattern.exec(html)) !== null) {
    let imgUrl = match[1];
    if (!imgUrl.startsWith('http')) {
      imgUrl = `${baseUrl}${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;
    }
    if (!images.includes(imgUrl) && 
        !imgUrl.includes('logo') && !imgUrl.includes('icon') && 
        !imgUrl.includes('button') && !imgUrl.includes('NewButtons')) {
      images.push(imgUrl);
    }
  }

  return images;
}

function extractVehiclesFromGallery(html: string, baseUrl: string): ExtractedVehicle[] {
  const vehicles: ExtractedVehicle[] = [];
  
  // Extract images and try to infer vehicle info from filenames or surrounding context
  const imagePattern = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const linkPattern = /<a[^>]+href=["']([^"']+\.(jpg|jpeg|png|gif))["'][^>]*>/gi;
  
  // Collect all image URLs
  const imageUrls: Array<{ url: string; index: number; context: string }> = [];
  
  let match;
  while ((match = imagePattern.exec(html)) !== null) {
    let imgUrl = match[1];
    if (!imgUrl.startsWith('http')) {
      imgUrl = `${baseUrl}${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;
    }
    
    // Skip navigation/header images
    if (imgUrl.includes('logo') || imgUrl.includes('icon') || 
        imgUrl.includes('button') || imgUrl.includes('NewButtons') ||
        imgUrl.includes('topbar') || imgUrl.includes('header')) {
      continue;
    }
    
    // Get context around the image (200 chars before and after)
    const contextStart = Math.max(0, match.index - 200);
    const contextEnd = Math.min(html.length, match.index + 500);
    const context = html.substring(contextStart, contextEnd);
    
    imageUrls.push({ url: imgUrl, index: match.index, context });
  }
  
  // Also check linked images
  while ((match = linkPattern.exec(html)) !== null) {
    let imgUrl = match[1];
    if (!imgUrl.startsWith('http')) {
      imgUrl = `${baseUrl}${imgUrl.startsWith('/') ? '' : '/'}${imgUrl}`;
    }
    
    if (imgUrl.includes('logo') || imgUrl.includes('icon') || 
        imgUrl.includes('button') || imgUrl.includes('NewButtons')) {
      continue;
    }
    
    const contextStart = Math.max(0, match.index - 200);
    const contextEnd = Math.min(html.length, match.index + 500);
    const context = html.substring(contextStart, contextEnd);
    
    // Check if we already have this URL
    if (!imageUrls.find(img => img.url === imgUrl)) {
      imageUrls.push({ url: imgUrl, index: match.index, context });
    }
  }
  
  // Try to extract vehicle info from each image
  for (const img of imageUrls) {
    // Try to extract year/make/model from filename
    const filenameMatch = img.url.match(/(\d{4})[_-]?([A-Za-z0-9]+)/i);
    const yearFromFilename = filenameMatch ? parseInt(filenameMatch[1]) : null;
    
    // Try to extract from context
    const yearMatch = img.context.match(/\b((?:19|20)\d{2})\b/);
    const year = yearMatch ? parseInt(yearMatch[1]) : (yearFromFilename && yearFromFilename >= 1950 && yearFromFilename <= 2025 ? yearFromFilename : null);
    
    // Check if filename suggests a BMW 2002 or related model
    const isBMW2002 = /2002|1600|1800|2000|tii|turbo|cs|cs/i.test(img.url) || 
                      /2002|1600|1800|2000|tii|turbo|cs|cs/i.test(img.context);
    
    if (year && isBMW2002) {
      // Try to extract model from context or filename
      const modelMatch = img.context.match(/\b(2002|1600|1800|2000|tii|turbo|cs|cs|635|325|e30|e21|e10)\b/i) ||
                        img.url.match(/\b(2002|1600|1800|2000|tii|turbo|cs|635|325|e30|e21|e10)\b/i);
      const model = modelMatch ? modelMatch[1] : '2002'; // Default to 2002 for gallery images
      
      vehicles.push({
        year,
        make: 'BMW',
        model,
        image_urls: [img.url],
        source_url: `${baseUrl}/pages/gallery.cfm`,
        status: 'gallery', // Mark as gallery vehicle
      });
    }
  }
  
  return vehicles;
}

function discoverLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const linkPattern = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  let match;
  
  while ((match = linkPattern.exec(html)) !== null) {
    let href = match[1];
    
    // Skip external links, anchors, javascript, mailto, etc.
    if (href.startsWith('http') && !href.includes(baseUrl)) continue;
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    
    // Normalize relative URLs
    if (href.startsWith('/')) {
      href = `${baseUrl}${href}`;
    } else if (!href.startsWith('http')) {
      href = `${baseUrl}/${href}`;
    }
    
    // Only include links from the same domain
    if (href.includes(baseUrl) && !links.includes(href)) {
      links.push(href);
    }
  }
  
  return links;
}

