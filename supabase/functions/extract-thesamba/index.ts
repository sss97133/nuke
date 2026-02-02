/**
 * TheSamba.com Classifieds Extractor
 *
 * The largest VW classifieds site with 400+ active listings.
 * No RSS feeds for classifieds, so we scrape category pages and listing details directly.
 *
 * Categories (vehicles):
 * - 65: Type 1/Bug through 1957 (Split/Oval)
 * - 1: Type 1/Bug 1958-67
 * - 3: Type 1/Bug 1968-up
 * - 5: Type 2/Bus Split 1949-67
 * - 77: Type 2/Bus Brazilian
 * - 7: Type 2/Bus Bay Window 1968-79
 * - 55: Type 2/Bus Vanagon 1980-91
 * - 75: Type 2/Bus EuroVan-up 1992+
 * - 9: Type 3 (Notchback, Squareback, Fastback, Type 34)
 * - 11: Type 4 - 411/412
 * - 13: Ghia (Karmann Ghia)
 * - 15: Thing/Type 181
 *
 * Usage:
 * - POST { "action": "discover" } - Find new listings from all categories
 * - POST { "action": "extract", "listing_id": "2782499" } - Extract single listing
 * - POST { "action": "extract", "url": "https://www.thesamba.com/vw/classifieds/detail.php?id=2782499" }
 * - POST { "action": "batch", "limit": 50 } - Discover and extract batch
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Vehicle categories only (not parts)
const VEHICLE_CATEGORIES = [
  { id: 65, name: 'Type 1/Bug - through 1957', model_hint: 'Beetle' },
  { id: 1, name: 'Type 1/Bug - 1958-67', model_hint: 'Beetle' },
  { id: 3, name: 'Type 1/Bug - 1968-up', model_hint: 'Super Beetle' },
  { id: 5, name: 'Type 2/Bus - 1949-67', model_hint: 'Bus' },
  { id: 77, name: 'Type 2/Bus - Brazilian', model_hint: 'Bus' },
  { id: 7, name: 'Type 2/Bus - Bay Window - 1968-79', model_hint: 'Bus' },
  { id: 55, name: 'Type 2/Bus - Vanagon', model_hint: 'Vanagon' },
  { id: 75, name: 'Type 2/Bus - EuroVan-up', model_hint: 'EuroVan' },
  { id: 9, name: 'Type 3', model_hint: 'Type 3' },
  { id: 11, name: 'Type 4 - 411/412', model_hint: 'Type 4' },
  { id: 13, name: 'Ghia', model_hint: 'Karmann Ghia' },
  { id: 15, name: 'Thing/Type 181', model_hint: 'Thing' },
];

const BASE_URL = 'https://www.thesamba.com';

interface TheSambaListing {
  listing_id: string;
  url: string;
  title: string | null;
  year: number | null;
  make: string;
  model: string | null;
  price: number | null;
  location: string | null;
  description: string | null;
  seller_username: string | null;
  seller_member_since: string | null;
  condition: string | null;
  ad_placed: string | null;
  views: number | null;
  category: string | null;
  image_urls: string[];
}

// Discover listing IDs from a category page
async function discoverFromCategory(categoryId: number): Promise<string[]> {
  const url = `${BASE_URL}/vw/classifieds/cat.php?id=${categoryId}`;
  console.log(`Discovering from category ${categoryId}: ${url}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch category ${categoryId}: ${response.status}`);
      return [];
    }

    const html = await response.text();

    // Extract listing IDs: detail.php?id=2782499
    const matches = html.matchAll(/detail\.php\?id=(\d+)/g);
    const ids = [...new Set([...matches].map(m => m[1]))];

    console.log(`Found ${ids.length} listings in category ${categoryId}`);
    return ids;
  } catch (error) {
    console.error(`Error discovering category ${categoryId}:`, error);
    return [];
  }
}

// Extract a single listing
async function extractListing(listingId: string): Promise<TheSambaListing | null> {
  const url = `${BASE_URL}/vw/classifieds/detail.php?id=${listingId}`;
  console.log(`Extracting listing ${listingId}`);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch listing ${listingId}: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Check if listing was deleted/sold
    if (html.includes('This classified ad has been deleted')) {
      console.log(`Listing ${listingId} was deleted`);
      return null;
    }

    // Extract title from <title> tag: "TheSamba.com :: VW Classifieds - 1959 Texas Patina bug"
    const titleMatch = html.match(/<title>TheSamba\.com :: VW Classifieds - ([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim() || null;

    // Extract year from title - look for 4-digit year
    let year: number | null = null;
    if (title) {
      const yearMatch = title.match(/\b(19[3-9]\d|20[0-2]\d)\b/);
      if (yearMatch) {
        year = parseInt(yearMatch[1]);
      }
    }

    // Extract price from: <span class="maintitle">1959 Texas Patina bug&nbsp;&nbsp;&nbsp;Price: 12500</span>
    let price: number | null = null;
    const priceMatch = html.match(/Price:\s*\$?([\d,]+)/i);
    if (priceMatch) {
      price = parseInt(priceMatch[1].replace(/,/g, ''));
    }

    // Extract images from preload array
    const imageMatches = html.matchAll(/preload\(\[([^\]]+)\]\)/g);
    const imageUrls: string[] = [];
    for (const match of imageMatches) {
      const urls = match[1].matchAll(/'([^']+\.jpg)'/gi);
      for (const urlMatch of urls) {
        if (!imageUrls.includes(urlMatch[1])) {
          imageUrls.push(urlMatch[1]);
        }
      }
    }

    // Also try to extract from individual image references
    const pixMatches = html.matchAll(/\/vw\/classifieds\/pix\/(\d+\.jpg)/g);
    for (const m of pixMatches) {
      const fullUrl = `${BASE_URL}/vw/classifieds/pix/${m[1]}`;
      if (!imageUrls.includes(fullUrl)) {
        imageUrls.push(fullUrl);
      }
    }

    // Extract description from <span class="gen"> within the listing content
    let description: string | null = null;
    const descMatch = html.match(/<td colspan="3" align="left" valign="top" class="row1">\s*<span class="gen">([\s\S]*?)<\/span>/i);
    if (descMatch) {
      description = descMatch[1]
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

    // Extract seller info
    let sellerUsername: string | null = null;
    let sellerMemberSince: string | null = null;
    const sellerMatch = html.match(/Advertiser:.*?<a[^>]*>([^<]+)<\/a>/is);
    if (sellerMatch) {
      sellerUsername = sellerMatch[1].trim();
    }
    const memberSinceMatch = html.match(/Member since:.*?<br\s*\/?>\s*([^<\n]+)/is);
    if (memberSinceMatch) {
      sellerMemberSince = memberSinceMatch[1].trim();
    }

    // Extract location and metadata
    let location: string | null = null;
    let condition: string | null = null;
    let adPlaced: string | null = null;
    let views: number | null = null;
    let category: string | null = null;

    // The metadata is in a table with labels and values in separate cells
    // Location, Condition, Ad placed, Views, Category are in sequence
    const metadataMatch = html.match(/<td align="left" valign="top" nowrap class="row1">\s*([\s\S]*?)<\/td>/i);
    if (metadataMatch) {
      const metaContent = metadataMatch[1];

      // Split by <br /> and extract values
      const parts = metaContent.split(/<br\s*\/?>/i);
      if (parts.length >= 7) {
        location = parts[0]?.replace(/<[^>]+>/g, '').trim() || null;
        condition = parts[1]?.replace(/<[^>]+>/g, '').trim() || null;
        adPlaced = parts[2]?.replace(/<[^>]+>/g, '').trim() || null;
        // parts[3] is "Ad renewed"
        // parts[4] is "Ad last edited"
        const viewsStr = parts[5]?.replace(/<[^>]+>/g, '').trim();
        if (viewsStr) {
          views = parseInt(viewsStr.replace(/,/g, '')) || null;
        }
        category = parts[6]?.replace(/<[^>]+>/g, '').trim() || null;
      }
    }

    // Determine model from category or title
    let model: string | null = null;
    if (category) {
      if (category.includes('Type 1') || category.includes('Bug')) {
        model = category.includes('1968') ? 'Super Beetle' : 'Beetle';
      } else if (category.includes('Type 2') || category.includes('Bus')) {
        if (category.includes('Vanagon')) model = 'Vanagon';
        else if (category.includes('EuroVan')) model = 'EuroVan';
        else model = 'Bus';
      } else if (category.includes('Type 3')) {
        model = 'Type 3';
      } else if (category.includes('Type 4')) {
        model = 'Type 4';
      } else if (category.includes('Ghia')) {
        model = 'Karmann Ghia';
      } else if (category.includes('Thing')) {
        model = 'Thing';
      }
    }

    // Try to extract more specific model from title
    if (title) {
      const titleLower = title.toLowerCase();
      if (titleLower.includes('westfalia') || titleLower.includes('westy')) {
        model = 'Westfalia';
      } else if (titleLower.includes('karmann')) {
        model = 'Karmann Ghia';
      } else if (titleLower.includes('convertible') || titleLower.includes('cabriolet') || titleLower.includes('rag top') || titleLower.includes('ragtop')) {
        model = model ? `${model} Convertible` : 'Beetle Convertible';
      } else if (titleLower.includes('single cab') || titleLower.includes('singlecab')) {
        model = 'Single Cab';
      } else if (titleLower.includes('double cab') || titleLower.includes('doublecab') || titleLower.includes('doka')) {
        model = 'Double Cab';
      } else if (titleLower.includes('21 window') || titleLower.includes('21-window') || titleLower.includes('samba')) {
        model = '21 Window Deluxe';
      } else if (titleLower.includes('23 window') || titleLower.includes('23-window')) {
        model = '23 Window Deluxe';
      } else if (titleLower.includes('15 window') || titleLower.includes('15-window')) {
        model = '15 Window Deluxe';
      } else if (titleLower.includes('splitscreen') || titleLower.includes('split screen') || titleLower.includes('split-screen')) {
        model = 'Split Bus';
      } else if (titleLower.includes('bay window') || titleLower.includes('baywindow')) {
        model = 'Bay Window Bus';
      } else if (titleLower.includes('notchback')) {
        model = 'Notchback';
      } else if (titleLower.includes('squareback')) {
        model = 'Squareback';
      } else if (titleLower.includes('fastback')) {
        model = 'Fastback';
      }
    }

    return {
      listing_id: listingId,
      url,
      title,
      year,
      make: 'Volkswagen',
      model,
      price,
      location,
      description: description?.slice(0, 10000) || null,
      seller_username: sellerUsername,
      seller_member_since: sellerMemberSince,
      condition,
      ad_placed: adPlaced,
      views,
      category,
      image_urls: imageUrls,
    };
  } catch (error) {
    console.error(`Error extracting listing ${listingId}:`, error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    const action = body.action || 'discover';

    if (action === 'discover') {
      // Discover new listings from all categories
      const allListingIds: string[] = [];

      for (const category of VEHICLE_CATEGORIES) {
        const ids = await discoverFromCategory(category.id);
        allListingIds.push(...ids);
        // Small delay between categories to be polite
        await new Promise(r => setTimeout(r, 500));
      }

      // Dedupe
      const uniqueIds = [...new Set(allListingIds)];
      console.log(`Total unique listings discovered: ${uniqueIds.length}`);

      // Check which ones we already have in import_queue
      const { data: existing } = await supabase
        .from('import_queue')
        .select('source_id')
        .eq('source', 'thesamba')
        .in('source_id', uniqueIds);

      const existingIds = new Set((existing || []).map(e => e.source_id));
      const newIds = uniqueIds.filter(id => !existingIds.has(id));

      console.log(`New listings to queue: ${newIds.length}`);

      // Queue new listings
      if (newIds.length > 0) {
        const queueRecords = newIds.map(id => ({
          source: 'thesamba',
          source_id: id,
          url: `${BASE_URL}/vw/classifieds/detail.php?id=${id}`,
          status: 'pending',
          priority: 5, // Medium priority
        }));

        const { error: queueError } = await supabase
          .from('import_queue')
          .insert(queueRecords);

        if (queueError) {
          console.error('Queue insert error:', queueError);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        total_discovered: uniqueIds.length,
        new_queued: newIds.length,
        already_known: existingIds.size,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'extract') {
      // Extract a single listing
      let listingId = body.listing_id;

      if (!listingId && body.url) {
        // Extract ID from URL
        const match = body.url.match(/id=(\d+)/);
        if (match) {
          listingId = match[1];
        }
      }

      if (!listingId) {
        return new Response(JSON.stringify({ error: 'listing_id or url required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const extracted = await extractListing(listingId);

      if (!extracted) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Listing not found or deleted',
          listing_id: listingId,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Save to database if requested
      if (body.save_to_db !== false) {
        // Check for existing vehicle
        const { data: existingVehicle } = await supabase
          .from('vehicles')
          .select('id')
          .eq('discovery_url', extracted.url)
          .single();

        if (existingVehicle) {
          // Update existing
          const { error: updateError } = await supabase
            .from('vehicles')
            .update({
              listing_title: extracted.title,
              year: extracted.year,
              make: extracted.make,
              model: extracted.model,
              sale_price: extracted.price,
              bat_location: extracted.location, // Reusing this field
              description: extracted.description,
              bat_seller: extracted.seller_username,
              bat_views: extracted.views,
              updated_at: new Date().toISOString(),
            })
            .eq('id', existingVehicle.id);

          if (updateError) {
            console.error('Update error:', updateError);
          } else {
            extracted.vehicle_id = existingVehicle.id;
            console.log(`Updated vehicle ${existingVehicle.id}`);
          }
        } else {
          // Create new vehicle
          const { data: newVehicle, error: insertError } = await supabase
            .from('vehicles')
            .insert({
              year: extracted.year,
              make: extracted.make,
              model: extracted.model,
              listing_title: extracted.title,
              sale_price: extracted.price,
              bat_location: extracted.location,
              description: extracted.description,
              bat_seller: extracted.seller_username,
              bat_views: extracted.views,
              discovery_url: extracted.url,
              discovery_source: 'thesamba',
              listing_source: 'thesamba',
              profile_origin: 'thesamba_import',
              is_public: true,
              status: 'active',
              sale_status: 'available',
            })
            .select()
            .single();

          if (insertError) {
            console.error('Insert error:', insertError);
          } else if (newVehicle) {
            extracted.vehicle_id = newVehicle.id;
            console.log(`Created vehicle ${newVehicle.id}`);

            // Save images
            if (extracted.image_urls.length > 0) {
              const imageRecords = extracted.image_urls.map((img_url, i) => ({
                vehicle_id: newVehicle.id,
                image_url: img_url,
                position: i,
                source: 'thesamba',
                is_external: true,
              }));

              const { error: imgError } = await supabase
                .from('vehicle_images')
                .insert(imageRecords);

              if (imgError) {
                console.error('Image insert error:', imgError);
              } else {
                console.log(`Saved ${imageRecords.length} images`);
              }
            }
          }
        }

        // Update import_queue status
        await supabase
          .from('import_queue')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
            result: { vehicle_id: extracted.vehicle_id },
          })
          .eq('source', 'thesamba')
          .eq('source_id', listingId);
      }

      return new Response(JSON.stringify({
        success: true,
        extracted,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'batch') {
      // Discover and extract a batch
      const limit = Math.min(body.limit || 20, 100);

      // First discover
      const allListingIds: string[] = [];
      for (const category of VEHICLE_CATEGORIES) {
        const ids = await discoverFromCategory(category.id);
        allListingIds.push(...ids);
        await new Promise(r => setTimeout(r, 300));
      }

      const uniqueIds = [...new Set(allListingIds)];

      // Check which ones we already have
      const { data: existingVehicles } = await supabase
        .from('vehicles')
        .select('discovery_url')
        .eq('discovery_source', 'thesamba');

      const existingUrls = new Set((existingVehicles || []).map(v => v.discovery_url));
      const newIds = uniqueIds.filter(id =>
        !existingUrls.has(`${BASE_URL}/vw/classifieds/detail.php?id=${id}`)
      );

      // Extract up to limit
      const toExtract = newIds.slice(0, limit);
      const results: TheSambaListing[] = [];
      const errors: string[] = [];

      for (const id of toExtract) {
        try {
          const extracted = await extractListing(id);
          if (extracted) {
            results.push(extracted);

            // Save to database
            const { data: newVehicle, error: insertError } = await supabase
              .from('vehicles')
              .insert({
                year: extracted.year,
                make: extracted.make,
                model: extracted.model,
                listing_title: extracted.title,
                sale_price: extracted.price,
                bat_location: extracted.location,
                description: extracted.description,
                bat_seller: extracted.seller_username,
                bat_views: extracted.views,
                discovery_url: extracted.url,
                discovery_source: 'thesamba',
                listing_source: 'thesamba',
                profile_origin: 'thesamba_import',
                is_public: true,
                status: 'active',
                sale_status: 'available',
              })
              .select()
              .single();

            if (insertError) {
              errors.push(`${id}: ${insertError.message}`);
            } else if (newVehicle && extracted.image_urls.length > 0) {
              // Save images
              const imageRecords = extracted.image_urls.map((img_url, i) => ({
                vehicle_id: newVehicle.id,
                image_url: img_url,
                position: i,
                source: 'thesamba',
                is_external: true,
              }));

              await supabase.from('vehicle_images').insert(imageRecords);
            }
          }

          // Rate limit
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          errors.push(`${id}: ${e.message}`);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        total_discovered: uniqueIds.length,
        already_imported: existingUrls.size,
        extracted: results.length,
        errors: errors.length > 0 ? errors : undefined,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      error: 'Unknown action. Use: discover, extract, or batch'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
