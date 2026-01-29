/**
 * EXTRACT WAYBACK INDEX
 *
 * Bulk extracts vehicles from Wayback category/search pages.
 * One index page can yield 20-50 vehicles!
 *
 * Supports:
 * - eBay Motors category pages
 * - Craigslist search results
 * - AutoTrader listings pages
 *
 * Much faster than extracting individual listings.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface IndexVehicle {
  title: string;
  year?: number;
  make?: string;
  model?: string;
  price?: number;
  item_id?: string;
  item_url?: string;
}

interface ExtractRequest {
  snapshot_url: string;
  ingest?: boolean;  // Whether to create vehicle profiles
}

// Extract vehicles from eBay Motors category page
function extractEbayIndex(html: string, snapshotUrl: string): IndexVehicle[] {
  const vehicles: IndexVehicle[] = [];

  // Extract item IDs
  const itemMatches = html.match(/itemZ(\d{9,15})/g) || [];
  const itemIds = [...new Set(itemMatches.map(m => m.replace('itemZ', '')))];

  // Extract year/make/model patterns from titles
  // Common patterns: "1969 Datsun 240Z", "1978 Ford Mustang"
  const titlePattern = /(19[4-9][0-9]|20[0-2][0-9])\s+([A-Za-z-]+)\s+([A-Za-z0-9-]+(?:\s+[A-Za-z0-9-]+)?)/g;
  const titles: string[] = [];
  let match;
  while ((match = titlePattern.exec(html)) !== null) {
    const year = parseInt(match[1]);
    const make = match[2].trim();
    const model = match[3].trim();

    // Skip obvious non-vehicles
    if (['AND', 'FOR', 'THE', 'NEW', 'OLD', 'buildid', 'RETRIEVED'].includes(make.toUpperCase())) continue;
    if (year < 1940 || year > new Date().getFullYear() + 1) continue;

    titles.push(`${year} ${make} ${model}`);
  }

  // Extract prices
  const priceMatches = html.match(/\$([0-9,]+(?:\.[0-9]{2})?)/g) || [];
  const prices = priceMatches
    .map(p => parseFloat(p.replace(/[$,]/g, '')))
    .filter(p => p > 100 && p < 10000000);

  // Match titles with item IDs and prices (best effort)
  const uniqueTitles = [...new Set(titles)];
  for (let i = 0; i < uniqueTitles.length; i++) {
    const title = uniqueTitles[i];
    const parts = title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);

    if (parts) {
      const vehicle: IndexVehicle = {
        title,
        year: parseInt(parts[1]),
        make: parts[2],
        model: parts[3],
        price: prices[i] || undefined,
        item_id: itemIds[i] || undefined
      };

      if (vehicle.item_id) {
        // Reconstruct eBay item URL
        const timestamp = snapshotUrl.match(/\/web\/(\d+)\//)?.[1];
        if (timestamp) {
          vehicle.item_url = `https://web.archive.org/web/${timestamp}/http://cgi.ebay.com/ebaymotors/ViewItem?item=${vehicle.item_id}`;
        }
      }

      vehicles.push(vehicle);
    }
  }

  return vehicles;
}

// Extract vehicles from Craigslist search/category page
function extractCraigslistIndex(html: string, snapshotUrl: string): IndexVehicle[] {
  const vehicles: IndexVehicle[] = [];

  // Craigslist patterns - look for listing rows with price and title
  // Format: "$4,500 - 1985 Toyota Land Cruiser"
  const listingPattern = /\$([0-9,]+)\s*[-–]\s*((?:19|20)\d{2})\s+([A-Za-z]+)\s+([A-Za-z0-9\s-]+)/g;

  let match;
  while ((match = listingPattern.exec(html)) !== null) {
    const price = parseFloat(match[1].replace(/,/g, ''));
    const year = parseInt(match[2]);
    const make = match[3].trim();
    const model = match[4].trim();

    if (price > 100 && year >= 1940) {
      vehicles.push({
        title: `${year} ${make} ${model}`,
        year,
        make,
        model,
        price
      });
    }
  }

  // Also try to extract from title patterns
  const titlePattern = /(19[4-9][0-9]|20[0-2][0-9])\s+([A-Za-z]+)\s+([A-Za-z0-9]+)/g;
  while ((match = titlePattern.exec(html)) !== null) {
    const year = parseInt(match[1]);
    const make = match[2].trim();
    const model = match[3].trim();

    // Skip if already found
    const existing = vehicles.find(v => v.year === year && v.make === make);
    if (!existing && year >= 1940) {
      vehicles.push({
        title: `${year} ${make} ${model}`,
        year,
        make,
        model
      });
    }
  }

  return vehicles;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: ExtractRequest = await req.json();
    const { snapshot_url, ingest = false } = body;

    if (!snapshot_url) {
      return new Response(
        JSON.stringify({ error: 'snapshot_url required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the page
    const response = await fetch(snapshot_url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VehicleArchiveBot/1.0)' }
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch: ${response.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();

    // Determine source type and extract
    let vehicles: IndexVehicle[] = [];
    let source = 'unknown';

    if (snapshot_url.includes('ebay.com') || snapshot_url.includes('motors.ebay')) {
      vehicles = extractEbayIndex(html, snapshot_url);
      source = 'ebay';
    } else if (snapshot_url.includes('craigslist')) {
      vehicles = extractCraigslistIndex(html, snapshot_url);
      source = 'craigslist';
    } else {
      // Generic extraction
      vehicles = extractEbayIndex(html, snapshot_url);  // Try eBay patterns as default
      source = 'generic';
    }

    // Parse snapshot date from URL
    const timestampMatch = snapshot_url.match(/\/web\/(\d{4})(\d{2})(\d{2})/);
    const snapshotDate = timestampMatch
      ? `${timestampMatch[1]}-${timestampMatch[2]}-${timestampMatch[3]}`
      : new Date().toISOString().slice(0, 10);

    // Parse domain from URL
    const domainMatch = snapshot_url.match(/\/web\/\d+\/https?:\/\/([^\/]+)/);
    const domain = domainMatch ? domainMatch[1] : 'unknown';

    // Ingest vehicles if requested
    let ingested = 0;
    let created: string[] = [];

    if (ingest && vehicles.length > 0) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

      for (const v of vehicles.slice(0, 25)) {  // Limit to 25 per page to avoid timeout
        if (!v.year || !v.make) continue;

        try {
          const ingestResponse = await fetch(
            `${supabaseUrl}/functions/v1/ingest-wayback-vehicle`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${serviceRoleKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                listing: {
                  snapshot_url: v.item_url || snapshot_url,
                  original_url: v.item_url || snapshot_url,
                  snapshot_date: snapshotDate,
                  domain,
                  title: v.title,
                  year: v.year,
                  make: v.make,
                  model: v.model || 'Unknown',
                  price: v.price,
                  image_urls: []
                }
              })
            }
          );

          if (ingestResponse.ok) {
            const result = await ingestResponse.json();
            if (result.vehicle_id) {
              ingested++;
              created.push(result.vehicle_id);
            }
          }
        } catch (e) {
          console.log(`[index-extract] Failed to ingest ${v.title}:`, e);
        }
      }
    }

    return new Response(
      JSON.stringify({
        source,
        snapshot_date: snapshotDate,
        domain,
        vehicles_found: vehicles.length,
        vehicles: vehicles.slice(0, 50),  // Return first 50
        ingested,
        created_vehicle_ids: created
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[extract-wayback-index] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
