import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface LMCPart {
  name: string;
  partNumber: string;
  price: number;
  url: string;
  category: string;
  subcategory: string;
  fitsYears: string;
  imageUrl?: string;
  description?: string;
}

Deno.serve(async (req: Request) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { category, maxPages = 5 } = await req.json().catch(() => ({}));

    // LMC Truck dashboard categories based on provided URLs
    const categories = category ? [category] : [
      'dash-bezels-and-instrument-lenses',
      'dashboard-components',
      'air-vent-outlets',
      'glove-box',
      'steering-columns',
      'instrument-clusters',
      'heater-controls'
    ];

    const scrapedParts: LMCPart[] = [];
    let totalProcessed = 0;

    for (const cat of categories) {
      console.log(`Scraping category: ${cat}`);
      
      // LMC Truck URL structure
      const baseUrl = `https://www.lmctruck.com/interior/dash-components/${cat}`;
      
      try {
        const response = await fetch(baseUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml'
          }
        });

        if (!response.ok) {
          console.error(`Failed to fetch ${cat}: ${response.status}`);
          continue;
        }

        const html = await response.text();
        
        // Parse LMC Truck HTML structure
        // Look for product containers (actual structure may vary - adjust as needed)
        const productPattern = /<div[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        const matches = Array.from(html.matchAll(productPattern));
        
        console.log(`Found ${matches.length} potential products in ${cat}`);

        for (const match of matches.slice(0, 50)) { // Limit per category
          const productHTML = match[0];
          
          // Extract part number (multiple possible formats)
          const partNumPatterns = [
            /part[_-]?number["']?\s*[:=]\s*["']?([A-Z0-9-]+)/i,
            /sku["']?\s*[:=]\s*["']?([A-Z0-9-]+)/i,
            /data-part["']?\s*[:=]\s*["']?([A-Z0-9-]+)/i
          ];
          
          let partNumber = null;
          for (const pattern of partNumPatterns) {
            const partMatch = productHTML.match(pattern);
            if (partMatch) {
              partNumber = partMatch[1];
              break;
            }
          }
          
          // Extract product name
          const namePatterns = [
            /<h[2-4][^>]*>(.*?)<\/h[2-4]>/i,
            /<div[^>]*class="[^"]*name[^"]*"[^>]*>(.*?)<\/div>/i,
            /<span[^>]*class="[^"]*title[^"]*"[^>]*>(.*?)<\/span>/i
          ];
          
          let name = null;
          for (const pattern of namePatterns) {
            const nameMatch = productHTML.match(pattern);
            if (nameMatch) {
              name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
              break;
            }
          }
          
          // Extract price
          const pricePattern = /\$([0-9]+(?:\.[0-9]{2})?)/;
          const priceMatch = productHTML.match(pricePattern);
          const price = priceMatch ? parseFloat(priceMatch[1]) : null;
          
          // Extract fitment (e.g. "1973-1987 Chevy/GMC")
          const fitsPattern = /(?:fits?|for)\s*:?\s*([0-9]{4})\s*-\s*([0-9]{4})/i;
          const fitsMatch = productHTML.match(fitsPattern);
          const fitsYears = fitsMatch ? `${fitsMatch[1]}-${fitsMatch[2]}` : '1973-1987';
          
          // Extract image
          const imgPattern = /<img[^>]+src=["']([^"']+)["']/i;
          const imgMatch = productHTML.match(imgPattern);
          const imageUrl = imgMatch ? imgMatch[1] : null;

          if (partNumber && name) {
            scrapedParts.push({
              name: name.substring(0, 255),
              partNumber,
              price: price || 0,
              url: `${baseUrl}#${partNumber}`,
              category: 'interior',
              subcategory: cat,
              fitsYears,
              imageUrl: imageUrl || undefined,
              description: `Dashboard component for 1973-1987 Chevy/GMC trucks`
            });
            totalProcessed++;
          }
        }
      } catch (error) {
        console.error(`Error scraping ${cat}:`, error);
      }
    }

    console.log(`Total parts scraped: ${scrapedParts.length}`);

    // Insert into part_catalog
    const insertPromises = scrapedParts.map(async (part) => {
      // Get LMC Truck supplier ID
      const { data: supplier } = await supabase
        .from('part_suppliers')
        .select('id')
        .eq('supplier_name', 'LMC Truck')
        .single();

      if (!supplier) {
        console.error('LMC Truck supplier not found');
        return null;
      }

      // Check if part already exists
      const { data: existing } = await supabase
        .from('part_catalog')
        .select('id')
        .eq('oem_part_number', part.partNumber)
        .single();

      const catalogData = {
        part_name: part.name,
        oem_part_number: part.partNumber,
        category: part.category,
        subcategory: part.subcategory,
        fits_makes: ['Chevrolet', 'GMC'],
        fits_models: ['C10', 'C1500', 'K10', 'K1500', 'Blazer', 'Suburban', 'Jimmy'],
        fits_years: part.fitsYears ? `[${part.fitsYears.replace('-', ',')}]` : null,
        description: part.description,
        part_image_urls: part.imageUrl ? [part.imageUrl] : [],
        supplier_listings: JSON.stringify([{
          supplier_id: supplier.id,
          supplier_name: 'LMC Truck',
          price_cents: Math.round((part.price || 0) * 100),
          url: part.url,
          in_stock: true,
          last_checked: new Date().toISOString()
        }])
      };

      if (existing) {
        // Update existing part
        return await supabase
          .from('part_catalog')
          .update(catalogData)
          .eq('id', existing.id);
      } else {
        // Insert new part
        return await supabase
          .from('part_catalog')
          .insert(catalogData);
      }
    });

    await Promise.all(insertPromises);

    return new Response(JSON.stringify({
      success: true,
      parts_scraped: scrapedParts.length,
      categories_processed: categories.length,
      message: `Scraped ${scrapedParts.length} parts from LMC Truck`,
      sample_parts: scrapedParts.slice(0, 5)
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }
    });

  } catch (error: any) {
    console.error('Scraper error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      stack: error.stack
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

