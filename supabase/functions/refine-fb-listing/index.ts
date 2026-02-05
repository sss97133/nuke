import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { chromium } from "https://esm.sh/playwright@1.40.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RefinedData {
  title: string;
  parsed_year: number | null;
  parsed_make: string | null;
  parsed_model: string | null;
  price: number | null;
  description: string | null;
  seller_name: string | null;
  seller_profile_url: string | null;
  all_images: string[];
  contact_info: {
    phones?: string[];
    emails?: string[];
    facebook_messenger?: boolean;
  } | null;
  mileage: number | null;
  transmission: string | null;
  exterior_color: string | null;
  interior_color: string | null;
  location: string | null;
}

/**
 * Enhanced title parser - handles corrupted FB Marketplace titles
 * Examples:
 * - "$4,5001972 Chevrolet C10" -> year: 1972, make: Chevrolet, model: C10
 * - "1978 Ford F-150 pickup" -> year: 1978, make: Ford, model: F-150
 */
function parseTitle(title: string): { year: number | null; make: string | null; model: string | null; cleanPrice: number | null } {
  // Extract and remove price
  let cleanPrice: number | null = null;
  const priceMatch = title.match(/^\$?([\d,]+)/);
  if (priceMatch) {
    const priceStr = priceMatch[1].replace(/,/g, '');
    const yearInPrice = priceStr.match(/(19[2-9]\d|20[0-2]\d)/);
    if (yearInPrice) {
      const yearStart = priceStr.indexOf(yearInPrice[1]);
      cleanPrice = yearStart > 0 ? parseInt(priceStr.slice(0, yearStart), 10) : null;
    } else if (priceStr.length <= 7) {
      cleanPrice = parseInt(priceStr, 10);
    }
  }

  // Remove price and location suffixes
  let cleaned = title
    .replace(/^\$[\d,]+(?=\d{4})/g, '')  // Price before year
    .replace(/^\$[\d,]+\s*/g, '')         // Price with space
    .replace(/[A-Z][a-z]+,\s*[A-Z]{2}.*$/g, '') // Location suffix
    .replace(/\d+K miles.*$/gi, '')       // Mileage suffix
    .trim();

  // Extract year (1940-2030)
  const yearMatch = cleaned.match(/\b(19[2-9]\d|20[0-3]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

  if (!year) return { year: null, make: null, model: null, cleanPrice };

  // Get text after year
  const afterYear = cleaned.split(String(year))[1]?.trim() || '';
  const words = afterYear.split(/\s+/).filter(w => w.length > 0);

  if (words.length === 0) return { year, make: null, model: null, cleanPrice };

  // Make normalization
  const makeMap: Record<string, string> = {
    'chevy': 'Chevrolet', 'chevrolet': 'Chevrolet',
    'ford': 'Ford', 'dodge': 'Dodge', 'gmc': 'GMC',
    'toyota': 'Toyota', 'honda': 'Honda', 'nissan': 'Nissan',
    'mazda': 'Mazda', 'subaru': 'Subaru', 'mitsubishi': 'Mitsubishi',
    'jeep': 'Jeep', 'ram': 'Ram', 'chrysler': 'Chrysler',
    'plymouth': 'Plymouth', 'pontiac': 'Pontiac', 'buick': 'Buick',
    'oldsmobile': 'Oldsmobile', 'cadillac': 'Cadillac',
    'mercedes': 'Mercedes-Benz', 'mercedes-benz': 'Mercedes-Benz',
    'bmw': 'BMW', 'volkswagen': 'Volkswagen', 'vw': 'Volkswagen',
    'porsche': 'Porsche', 'audi': 'Audi', 'volvo': 'Volvo',
  };

  const rawMake = words[0].toLowerCase();
  const make = makeMap[rawMake] || words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();

  // Model: next 1-3 words, excluding common suffixes
  const stopWords = ['pickup', 'truck', 'sedan', 'coupe', 'wagon', 'van',
                     'suv', 'convertible', 'hatchback', 'cab', 'door', 'bed'];
  const modelParts: string[] = [];

  for (let i = 1; i < Math.min(words.length, 5); i++) {
    const word = words[i];
    const lower = word.toLowerCase();

    // Stop at common suffixes or location markers
    if (stopWords.includes(lower) || /^[A-Z][a-z]+$/.test(word)) break;

    modelParts.push(word);

    // Stop after 2-3 model words
    if (modelParts.length >= 2) break;
  }

  const model = modelParts.length > 0 ? modelParts.join(' ') : null;

  return { year, make, model, cleanPrice };
}

/**
 * Extract contact info from description
 */
function extractContactInfo(text: string): { phones: string[]; emails: string[] } {
  const phones: string[] = [];
  const emails: string[] = [];

  // Phone patterns
  const patterns = [
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,           // 123-456-7890
    /\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b/g,           // (123) 456-7890
    /\b\d{3}\s?\d{3}\s?\d{4}\b/g,                   // 123 456 7890
    /\b\d{10}\b/g,                                   // 1234567890
    /\b\d{3}[-.]\d{3}[-.]\d{4}\b/g,                 // 123.456.7890
  ];

  // Disguised phones: "text me at 3 o 2 4 5 6 7 8 9 o"
  const disguised = text.match(/\b\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d[\s\-\.]*\d\b/g);
  if (disguised) {
    disguised.forEach(d => {
      const cleaned = d.replace(/[\s\-\.oO]/g, match => match === 'o' || match === 'O' ? '0' : '');
      if (cleaned.length === 10 && /^\d+$/.test(cleaned)) {
        phones.push(`${cleaned.slice(0,3)}-${cleaned.slice(3,6)}-${cleaned.slice(6)}`);
      }
    });
  }

  patterns.forEach(pattern => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach(m => {
        const cleaned = m.replace(/[^\d]/g, '');
        if (cleaned.length === 10) {
          const formatted = `${cleaned.slice(0,3)}-${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
          if (!phones.includes(formatted)) phones.push(formatted);
        }
      });
    }
  });

  // Email pattern
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emailMatches = text.match(emailPattern);
  if (emailMatches) {
    emailMatches.forEach(e => {
      if (!emails.includes(e.toLowerCase())) emails.push(e.toLowerCase());
    });
  }

  return { phones, emails };
}

/**
 * Filter out non-vehicle images (profile pics, UI elements, logos)
 */
function filterVehicleImages(images: string[]): string[] {
  return images.filter(url => {
    // Keep only scontent (actual photos)
    if (!url.includes('scontent')) return false;

    // Exclude profile pictures
    if (url.includes('/p') && url.includes('x')) return false;

    // Exclude tiny images (likely icons/logos)
    if (url.includes('_s.') || url.includes('_t.')) return false;

    // Exclude emoji
    if (url.includes('emoji')) return false;

    // Prefer large images
    return true;
  });
}

/**
 * Use Playwright to extract full listing details
 */
async function extractFullListing(url: string): Promise<RefinedData> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Click "See more" buttons to expand full description
    const seeMoreButtons = page.locator('text=/See more|Show more/i');
    const count = await seeMoreButtons.count();
    for (let i = 0; i < count; i++) {
      try {
        await seeMoreButtons.nth(i).click({ timeout: 1000 });
        await page.waitForTimeout(500);
      } catch (e) {
        // Button might not be clickable, continue
      }
    }

    // Extract title
    const title = await page.locator('h1, [role="heading"]').first().textContent() ||
                  await page.locator('meta[property="og:title"]').getAttribute('content') || '';

    // Extract price - try multiple selectors
    let price: number | null = null;
    const priceText = await page.locator('text=/\\$[\\d,]+/').first().textContent().catch(() => null);
    if (priceText) {
      const match = priceText.match(/\$([\d,]+)/);
      if (match) price = parseInt(match[1].replace(/,/g, ''), 10);
    }

    // Extract FULL description (after clicking See more)
    let description = await page.locator('[style*="text-align:start"]').first().textContent().catch(() => null) ||
                      await page.locator('meta[property="og:description"]').getAttribute('content') ||
                      null;

    // Extract seller info
    const sellerName = await page.locator('a[href*="/marketplace/profile/"] span').first().textContent().catch(() => null) ||
                      await page.locator('[data-testid="marketplace_pdp_seller_name"]').textContent().catch(() => null);

    const sellerLink = await page.locator('a[href*="/marketplace/profile/"]').first().getAttribute('href').catch(() => null);
    const sellerProfileUrl = sellerLink ? `https://www.facebook.com${sellerLink}` : null;

    // Extract ALL images (high quality)
    const allImages = await page.locator('img[src*="scontent"]').evaluateAll(imgs =>
      imgs.map(img => img.src)
    );

    // Get high-res main image
    const mainImage = await page.locator('meta[property="og:image"]').getAttribute('content').catch(() => null);
    if (mainImage && !allImages.includes(mainImage)) {
      allImages.unshift(mainImage);
    }

    // Get full page text for details
    const pageText = await page.locator('body').textContent() || '';

    // Parse location
    const locationMatch = pageText.match(/Listed.*?in ([A-Z][a-z]+(?:\s[A-Z][a-z]+)?,\s*[A-Z]{2})/);
    const location = locationMatch ? locationMatch[1] : null;

    // Parse vehicle details
    const mileageMatch = pageText.match(/(?:Driven|Mileage)[\s:]*([\\d,]+)\s*miles/i);
    const mileage = mileageMatch ? parseInt(mileageMatch[1].replace(/,/g, ''), 10) : null;

    const transMatch = pageText.match(/(Manual|Automatic)\s*transmission/i);
    const transmission = transMatch ? transMatch[1] : null;

    const extColorMatch = pageText.match(/Exterior color:\s*([A-Za-z]+)/);
    const exteriorColor = extColorMatch ? extColorMatch[1] : null;

    const intColorMatch = pageText.match(/Interior color:\s*([A-Za-z]+)/);
    const interiorColor = intColorMatch ? intColorMatch[1] : null;

    // Extract contact info
    const contactInfo = description ? extractContactInfo(description + ' ' + pageText) : { phones: [], emails: [] };
    const hasMessenger = pageText.includes('Message seller') || pageText.includes('Send message');

    // Parse title
    const parsed = parseTitle(title);

    // Filter images
    const filteredImages = filterVehicleImages([...new Set(allImages)]);

    await browser.close();

    return {
      title,
      parsed_year: parsed.year,
      parsed_make: parsed.make,
      parsed_model: parsed.model,
      price: price || parsed.cleanPrice,
      description,
      seller_name: sellerName,
      seller_profile_url: sellerProfileUrl,
      all_images: filteredImages,
      contact_info: (contactInfo.phones.length > 0 || contactInfo.emails.length > 0 || hasMessenger) ? {
        phones: contactInfo.phones.length > 0 ? contactInfo.phones : undefined,
        emails: contactInfo.emails.length > 0 ? contactInfo.emails : undefined,
        facebook_messenger: hasMessenger,
      } : null,
      mileage,
      transmission,
      exterior_color: exteriorColor,
      interior_color: interiorColor,
      location,
    };

  } catch (error: any) {
    await browser.close();
    throw new Error(`Extraction failed: ${error.message}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const { facebook_id, url, batch_size } = body;

    // Single listing refinement
    if (facebook_id || url) {
      const listingUrl = url || `https://www.facebook.com/marketplace/item/${facebook_id}`;

      const refined = await extractFullListing(listingUrl);

      // Update marketplace_listings
      if (facebook_id) {
        await supabase
          .from('marketplace_listings')
          .update({
            title: refined.title,
            parsed_year: refined.parsed_year,
            parsed_make: refined.parsed_make,
            parsed_model: refined.parsed_model,
            price: refined.price,
            description: refined.description,
            seller_name: refined.seller_name,
            all_images: refined.all_images,
            mileage: refined.mileage,
            transmission: refined.transmission,
            exterior_color: refined.exterior_color,
            interior_color: refined.interior_color,
            location: refined.location,
          })
          .eq('facebook_id', facebook_id);
      }

      return new Response(JSON.stringify({ success: true, refined }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // Batch refinement
    const limit = batch_size || 10;

    // Get listings with incomplete data
    const { data: listings, error: fetchError } = await supabase
      .from('marketplace_listings')
      .select('facebook_id, url, title, description')
      .or('parsed_model.is.null,description.is.null')
      .limit(limit);

    if (fetchError) throw fetchError;
    if (!listings || listings.length === 0) {
      return new Response(JSON.stringify({ message: "No listings need refinement", count: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const results = [];
    for (const listing of listings) {
      try {
        const refined = await extractFullListing(listing.url);

        await supabase
          .from('marketplace_listings')
          .update({
            parsed_year: refined.parsed_year,
            parsed_make: refined.parsed_make,
            parsed_model: refined.parsed_model,
            price: refined.price,
            description: refined.description,
            seller_name: refined.seller_name,
            all_images: refined.all_images,
            mileage: refined.mileage,
            transmission: refined.transmission,
            exterior_color: refined.exterior_color,
            interior_color: refined.interior_color,
            location: refined.location,
          })
          .eq('facebook_id', listing.facebook_id);

        results.push({ facebook_id: listing.facebook_id, success: true });
      } catch (e: any) {
        results.push({ facebook_id: listing.facebook_id, success: false, error: e.message });
      }

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return new Response(JSON.stringify({
      message: "Batch refinement complete",
      processed: results.length,
      successful: results.filter(r => r.success).length,
      results
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
