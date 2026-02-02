// Simple Craigslist vehicle extractor - no AI, no Firecrawl needed
// Craigslist uses clean JSON-LD structured data + HTML attributes

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CraigslistExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  price: number | null;
  mileage: number | null;
  location: string | null;
  exterior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  fuel_type: string | null;
  cylinders: string | null;
  body_style: string | null;
  condition: string | null;
  title_status: string | null;
  description: string | null;
  image_urls: string[];
  posted_at: string | null;
}

function extractJsonLd(html: string): any | null {
  // Craigslist has JSON-LD with vehicle data in <script type="application/ld+json" id="ld_posting_data">
  const match = html.match(/<script type="application\/ld\+json" id="ld_posting_data"\s*>([\s\S]*?)<\/script>/);
  if (!match) return null;

  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractAttrValue(html: string, attrClass: string): string | null {
  // Extract value from <div class="attr {attrClass}"><span class="valu">...</span></div>
  // Pattern needs to match either: plain text OR <a>text</a>
  const pattern = new RegExp(`<div class="attr ${attrClass}"[^>]*>[\\s\\S]*?<span class="valu"[^>]*>(?:[\\s]*<a[^>]*>([^<]+)<\\/a>|([^<]+))`, 'i');
  const match = html.match(pattern);
  // match[1] is if content was in <a> tag, match[2] is if it was plain text
  const result = (match?.[1] || match?.[2])?.replace(/\s+/g, ' ').trim();
  return result || null;
}

function extractSpanValue(html: string, spanClass: string): string | null {
  // Extract value from <span class="valu {spanClass}">...</span>
  // Pattern needs to match either: plain text OR <a>text</a>
  const pattern = new RegExp(`<span class="valu ${spanClass}"[^>]*>(?:[\\s]*<a[^>]*>([^<]+)<\\/a>|([^<]+))`, 'i');
  const match = html.match(pattern);
  // match[1] is if content was in <a> tag, match[2] is if it was plain text
  const result = (match?.[1] || match?.[2])?.replace(/\s+/g, ' ').trim();
  return result || null;
}

function parseYearMakeModel(makeModelStr: string): { make: string | null; model: string | null } {
  // Input format: "gmc yukon slt 4x4" or similar
  if (!makeModelStr || !makeModelStr.trim()) {
    return { make: null, model: null };
  }

  const parts = makeModelStr.trim().split(/\s+/);
  if (parts.length === 0) return { make: null, model: null };

  const make = parts[0];
  const model = parts.slice(1).join(' ');

  return {
    make: make ? (make.charAt(0).toUpperCase() + make.slice(1).toLowerCase()) : null,
    model: model || null
  };
}

function extractPostedDate(html: string): string | null {
  // <time class="date timeago" datetime="2026-01-29T17:50:40-0800">
  const match = html.match(/<time[^>]*datetime="([^"]+)"/);
  if (!match) return null;

  try {
    return new Date(match[1]).toISOString();
  } catch {
    return null;
  }
}

async function extractCraigslistListing(url: string): Promise<CraigslistExtracted> {
  // Fetch HTML directly - Craigslist doesn't require JS rendering
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Nuke/1.0; +https://nuke.com/bot)',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  // Parse JSON-LD structured data
  const jsonLd = extractJsonLd(html);

  // Extract title and basic info
  const title = jsonLd?.name || null;
  const price = jsonLd?.offers?.price ? Math.round(parseFloat(jsonLd.offers.price)) : null;
  const location = jsonLd?.offers?.availableAtOrFrom?.address?.addressLocality || null;

  // Extract year from HTML attributes (it's a span class, not attr class)
  const yearStr = extractSpanValue(html, 'year');
  const year = yearStr ? parseInt(yearStr) : null;

  // Extract make/model from makemodel attribute (it's a span class, not attr class)
  const makeModelStr = extractSpanValue(html, 'makemodel') || '';
  const { make, model } = parseYearMakeModel(makeModelStr);

  // Extract other attributes from HTML
  const mileageStr = extractAttrValue(html, 'auto_miles');
  const mileage = mileageStr ? parseInt(mileageStr.replace(/,/g, '')) : null;

  const exterior_color = extractAttrValue(html, 'auto_paint');
  const transmission = extractAttrValue(html, 'auto_transmission');
  const drivetrain = extractAttrValue(html, 'auto_drivetrain');
  const fuel_type = extractAttrValue(html, 'auto_fuel_type');
  const cylinders = extractAttrValue(html, 'auto_cylinders');
  const body_style = extractAttrValue(html, 'auto_bodytype');
  const condition = extractAttrValue(html, 'condition');
  const title_status = extractAttrValue(html, 'auto_title_status');

  // Extract description from postingbody
  let description: string | null = null;
  const descMatch = html.match(/<section id="postingbody"[^>]*>([\s\S]*?)<\/section>/);
  if (descMatch) {
    // Remove QR code div and clean up HTML
    description = descMatch[1]
      .replace(/<div class="print-information[^>]*>[\s\S]*?<\/div>/g, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000) || null;
  }

  // Extract images from JSON-LD
  const image_urls: string[] = [];
  if (jsonLd?.image && Array.isArray(jsonLd.image)) {
    image_urls.push(...jsonLd.image.filter((url: string) => url && url.startsWith('https://')));
  }

  // Extract posted date
  const posted_at = extractPostedDate(html);

  return {
    url,
    title,
    year,
    make,
    model,
    price,
    mileage,
    location,
    exterior_color,
    transmission,
    drivetrain,
    fuel_type,
    cylinders,
    body_style,
    condition,
    title_status,
    description,
    image_urls,
    posted_at,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db } = await req.json();

    if (!url || !url.includes('craigslist.org')) {
      return new Response(
        JSON.stringify({ error: 'Invalid Craigslist URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Extracting Craigslist listing: ${url}`);
    const extracted = await extractCraigslistListing(url);

    console.log(`=== EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`Price: $${extracted.price?.toLocaleString() || 'N/A'}`);
    console.log(`Mileage: ${extracted.mileage?.toLocaleString() || 'N/A'} miles`);
    console.log(`Location: ${extracted.location || 'N/A'}`);
    console.log(`Color: ${extracted.exterior_color || 'N/A'}`);
    console.log(`Transmission: ${extracted.transmission || 'N/A'}`);
    console.log(`Drivetrain: ${extracted.drivetrain || 'N/A'}`);
    console.log(`Body Style: ${extracted.body_style || 'N/A'}`);
    console.log(`Condition: ${extracted.condition || 'N/A'}`);
    console.log(`Title Status: ${extracted.title_status || 'N/A'}`);
    console.log(`Images: ${extracted.image_urls.length}`);
    console.log(`Posted: ${extracted.posted_at || 'N/A'}`);

    // Optionally save to database
    if (save_to_db) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );

      // Insert into import_queue
      const { data, error } = await supabase
        .from('import_queue')
        .upsert({
          listing_url: extracted.url,
          listing_title: extracted.title,
          listing_price: extracted.price,
          listing_year: extracted.year,
          listing_make: extracted.make,
          listing_model: extracted.model,
          thumbnail_url: extracted.image_urls[0] || null,
          raw_data: {
            mileage: extracted.mileage,
            location: extracted.location,
            exterior_color: extracted.exterior_color,
            transmission: extracted.transmission,
            drivetrain: extracted.drivetrain,
            fuel_type: extracted.fuel_type,
            cylinders: extracted.cylinders,
            body_style: extracted.body_style,
            condition: extracted.condition,
            title_status: extracted.title_status,
            description: extracted.description,
            image_urls: extracted.image_urls,
            posted_at: extracted.posted_at,
          },
          status: 'pending',
          extractor_version: 'extract-craigslist-v1',
        }, {
          onConflict: 'listing_url',
        })
        .select()
        .single();

      if (error) {
        console.error('Database save error:', error);
        throw new Error(`Failed to save to import_queue: ${error.message}`);
      }

      console.log(`Saved to import_queue: ${data.id}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
