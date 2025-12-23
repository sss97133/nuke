import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IndexRequest {
  organization_id: string;
  start_category_id?: number; // Optional: start from specific category
}

interface Part {
  name: string;
  price: number;
  image_url?: string;
  product_url: string;
  category_id: number;
  category_name: string;
  part_id: string; // From view_item.cfm?id=XXXX
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, start_category_id = 0 }: IndexRequest = await req.json();

    if (!organization_id) {
      throw new Error('organization_id is required');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log(`🔍 Indexing 2002AD parts for organization ${organization_id}`);

    // Get organization info
    const { data: org, error: orgError } = await supabase
      .from('businesses')
      .select('id, business_name, website')
      .eq('id', organization_id)
      .single();

    if (orgError || !org) {
      throw new Error(`Organization not found: ${organization_id}`);
    }

    const baseUrl = org.website?.replace(/\/$/, '') || 'https://2002ad.com';
    const partsStoreUrl = `${baseUrl}/storeworks`;

    // Category IDs to scrape (from the website structure)
    const categoryIds = [
      0,  // All products
      41, // Used parts for 2002s
      43, // Rebuilt parts
      52, // Replated parts
      42, // Gift certificates
      25, // Literature: books, manuals, CDs
      46, // Discounted kits
      23, // Lifestyle items & accessories
      19, // Hardware: nuts, bolts, fasteners
      12, // Engine components
      13, // Engine electrical parts
      16, // Fuel systems & parts
      17, // Fuel tank & lines
      29, // Radiator and cooling system
      14, // Exhaust system
      9,  // Clutch parts
      26, // Manual transmission parts
      5,  // Automatic transmission parts
      18, // Gear shift mechanism
      10, // Driveshaft
      15, // Front axle parts
      34, // Steering parts
      31, // Rear axle parts
      8,  // Brake systems
      27, // Pedal assy
      36, // Wheels and related parts
      6,  // Body, sheet metal
      7,  // Body equipment (trim, seals, interior parts)
      33, // Seats
      35, // Sunroof
      11, // Electrical parts
      22, // Instruments
      24, // Lights
      20, // Heating & A/C
      30, // Radio & accessories
      32, // Seat belts
    ];

    const allParts: Part[] = [];
    let startIndex = categoryIds.indexOf(start_category_id);
    if (startIndex === -1) startIndex = 0;

    // Limit to first 5 categories to avoid timeout (can be run multiple times with different start_category_id)
    const maxCategories = 5;
    const endIndex = Math.min(startIndex + maxCategories, categoryIds.length);

    // Scrape each category (limited batch to avoid timeout)
    for (let i = startIndex; i < endIndex; i++) {
      const categoryId = categoryIds[i];
      console.log(`📦 Scraping category ${categoryId} (${i + 1}/${categoryIds.length})`);

      try {
        const categoryUrl = `${partsStoreUrl}/category.cfm?id=${categoryId}`;
        const response = await fetch(categoryUrl, {
          signal: AbortSignal.timeout(10000), // 10 second timeout per category
        });
        
        if (!response.ok) {
          console.warn(`⚠️  Failed to fetch category ${categoryId}: ${response.status}`);
          continue;
        }

        const html = await response.text();
        const parts = extractPartsFromCategory(html, categoryId, baseUrl, partsStoreUrl);
        
        console.log(`  ✅ Found ${parts.length} parts in category ${categoryId}`);
        allParts.push(...parts);

        // Small delay to be respectful
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (e) {
        console.error(`❌ Error scraping category ${categoryId}:`, e);
        continue;
      }
    }

    // If we didn't finish all categories, return info about next batch
    const hasMore = endIndex < categoryIds.length;
    const nextCategoryId = hasMore ? categoryIds[endIndex] : null;

    console.log(`\n📊 Total parts found: ${allParts.length}`);

    // Store parts in catalog_parts table
    let storedCount = 0;
    let skippedCount = 0;

    // First, ensure catalog source exists for this organization
    let catalogSourceId: string;
    const { data: existingCatalog } = await supabase
      .from('catalog_sources')
      .select('id')
      .eq('provider', org.business_name)
      .maybeSingle();

    if (existingCatalog) {
      catalogSourceId = existingCatalog.id;
    } else {
      const { data: newCatalog, error: catalogError } = await supabase
        .from('catalog_sources')
        .insert({
          name: `${org.business_name} Parts Catalog`,
          provider: org.business_name,
          base_url: partsStoreUrl,
        })
        .select('id')
        .single();

      if (catalogError || !newCatalog) {
        throw new Error(`Failed to create catalog source: ${catalogError?.message}`);
      }
      catalogSourceId = newCatalog.id;
    }

    // Store each part
    for (const part of allParts) {
      try {
        // Check if part already exists
        const { data: existing } = await supabase
          .from('catalog_parts')
          .select('id')
          .eq('catalog_id', catalogSourceId)
          .eq('part_number', part.part_id)
          .maybeSingle();

        if (existing) {
          // Update existing part
          await supabase
            .from('catalog_parts')
            .update({
              name: part.name,
              price_current: part.price,
              description: part.name, // Use name as description if no separate description
              updated_at: new Date().toISOString(),
            })
            .eq('id', existing.id);
          skippedCount++;
        } else {
          // Insert new part
          const { error: insertError } = await supabase
            .from('catalog_parts')
            .insert({
              catalog_id: catalogSourceId,
              part_number: part.part_id,
              name: part.name,
              price_current: part.price,
              currency: 'USD',
              description: part.name,
              application_data: {
                category_id: part.category_id,
                category_name: part.category_name,
                product_url: part.product_url,
                image_url: part.image_url,
                organization_id: organization_id,
              },
            });

          if (insertError) {
            console.error(`Failed to insert part ${part.part_id}:`, insertError);
            continue;
          }
          storedCount++;
        }
      } catch (e) {
        console.error(`Error storing part ${part.part_id}:`, e);
        continue;
      }
    }

    // Update organization metadata
    await supabase
      .from('businesses')
      .update({
        metadata: {
          ...(org.metadata || {}),
          parts_catalog_indexed_at: new Date().toISOString(),
          parts_count: allParts.length,
          parts_stored: storedCount,
        }
      })
      .eq('id', organization_id);

    return new Response(
      JSON.stringify({
        success: true,
        parts_found: allParts.length,
        parts_stored: storedCount,
        parts_updated: skippedCount,
        catalog_source_id: catalogSourceId,
        categories_processed: endIndex - startIndex,
        has_more: hasMore,
        next_category_id: nextCategoryId,
        message: hasMore 
          ? `Processed ${endIndex - startIndex} categories. Run again with start_category_id=${nextCategoryId} to continue.`
          : 'All categories processed.',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error indexing parts:', error);
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Extract parts from a category page HTML
 */
function extractPartsFromCategory(
  html: string,
  categoryId: number,
  baseUrl: string,
  partsStoreUrl: string
): Part[] {
  const parts: Part[] = [];

  // Extract category name from page
  const categoryNameMatch = html.match(/<h[1-6][^>]*>([^<]+)<\/h[1-6]>/i);
  const categoryName = categoryNameMatch?.[1]?.trim() || `Category ${categoryId}`;

  // Pattern to match product entries
  // Structure: <img src="..."> Product Name $Price [View/Order Item](view_item.cfm?id=XXXX)
  // More robust pattern that handles various HTML structures
  const productPattern = /<img[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?([^<>\n]+?)\s+\$([\d,]+\.?\d*)[\s\S]*?view_item\.cfm\?id=(\d+)/gi;

  let match;
  while ((match = productPattern.exec(html)) !== null) {
    const imageUrl = match[1].startsWith('http') 
      ? match[1] 
      : `${baseUrl}/${match[1].replace(/^\.\.\//, '')}`;
    let name = match[2].trim();
    
    // Clean up HTML entities and tags that might have leaked through
    name = name.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    
    // Skip if name looks like HTML tag remnants
    if (name.length < 3 || name.startsWith('<') || name === 'br>' || name.match(/^[<>\/]+$/)) {
      continue;
    }
    
    const price = parseFloat(match[3].replace(/,/g, ''));
    const partId = match[4];

    if (name && name.length > 2 && price && partId && !isNaN(price)) {
      parts.push({
        name,
        price,
        image_url: imageUrl,
        product_url: `${partsStoreUrl}/view_item.cfm?id=${partId}`,
        category_id: categoryId,
        category_name: categoryName,
        part_id: partId,
      });
    }
  }

  // Alternative pattern for products without images or with different structure
  // Look for: Product Name $Price [View/Order Item](view_item.cfm?id=XXXX)
  const simplePattern = /([^<>\n]+?)\s+\$([\d,]+\.?\d*)[\s\S]*?view_item\.cfm\?id=(\d+)/gi;
  let simpleMatch;
  const seenPartIds = new Set(parts.map(p => p.part_id));
  
  while ((simpleMatch = simplePattern.exec(html)) !== null) {
    let name = simpleMatch[1].trim();
    const price = parseFloat(simpleMatch[2].replace(/,/g, ''));
    const partId = simpleMatch[3];
    
    // Skip if we already have this part
    if (seenPartIds.has(partId)) continue;
    
    // Clean up HTML entities and tags
    name = name.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    
    // Skip if it looks like navigation, HTML tags, or non-product text
    if (name.length > 3 && name.length < 200 && 
        !name.includes('Click here') && 
        !name.includes('CONTACT') &&
        !name.startsWith('<') &&
        !name.match(/^[<>\/]+$/) &&
        !isNaN(price) &&
        price > 0) {
      parts.push({
        name,
        price,
        product_url: `${partsStoreUrl}/view_item.cfm?id=${partId}`,
        category_id: categoryId,
        category_name: categoryName,
        part_id: partId,
      });
      seenPartIds.add(partId);
    }
  }

  return parts;
}

