/**
 * Extract Wayback Listing
 *
 * Extracts historical vehicle listings from Internet Archive's Wayback Machine.
 * Use cases:
 * - Find old Craigslist/eBay/AutoTrader listings to compare with current prices
 * - Discover provenance data for vehicles
 * - Track price appreciation over time
 *
 * Follows observation_sources pattern - Wayback is already registered as a source.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const WAYBACK_CDX_API = 'https://web.archive.org/cdx/search/cdx';
const WAYBACK_WEB_BASE = 'https://web.archive.org/web';

interface WaybackSnapshot {
  timestamp: string;
  original_url: string;
  snapshot_url: string;
  status_code: string;
  digest: string;
}

interface ExtractedListing {
  snapshot_url: string;
  original_url: string;
  snapshot_date: string;
  domain: string;
  title?: string;
  year?: number;
  make?: string;
  model?: string;
  vin?: string;
  price?: number;
  mileage?: number;
  location?: string;
  description?: string;
  seller_type?: string;
  image_urls: string[];
  raw_text?: string;
}

interface WaybackRequest {
  // Search modes
  mode: 'search_vin' | 'search_url' | 'extract_snapshot' | 'find_vehicle_history' | 'gold_rush';

  // For search_vin
  vin?: string;

  // For search_url - find snapshots of a specific URL pattern
  url_pattern?: string;

  // For extract_snapshot - extract from specific snapshot
  snapshot_url?: string;

  // For find_vehicle_history - find all mentions of a vehicle
  vehicle_id?: string;
  year?: number;
  make?: string;
  model?: string;

  // For gold_rush mode - search for specific desirable vehicles
  search_query?: string;  // e.g., "1967 Camaro SS", "E30 M3", "964 Turbo"

  // Filters
  from_year?: number;  // e.g., 2005
  to_year?: number;    // e.g., 2015
  domains?: string[];  // e.g., ['craigslist.org', 'ebay.com']

  // Options
  limit?: number;
  ingest?: boolean;  // Whether to call ingest-observation
  priority_domains_only?: boolean;  // Only search priority 1 domains (dead sites)
}

// Priority domains for OLD inaccessible content (2003-2015 era)
// These are sources where the original listings are GONE from the live web
// NOT including BaT, C&B, etc which still have their data accessible
const HISTORICAL_DOMAINS: Record<string, {
  name: string;
  priority: number;  // 1 = highest (dead/changed sites), 3 = lowest
  goldRushYears: [number, number];  // Peak years for finding cheap classics
  patterns: RegExp[];
  pricePatterns: RegExp[];
  titlePatterns: RegExp[];
}> = {
  'craigslist.org': {
    name: 'Craigslist',
    priority: 1,  // Listings deleted after ~45 days, pure gold
    goldRushYears: [2005, 2012],
    patterns: [/\/cto\/|\/ctd\/|cars.*trucks/],
    pricePatterns: [
      /<span class="price">\$([0-9,]+)/i,
      /\$([0-9,]+)/,
      /asking\s*\$?([0-9,]+)/i,
      /price:\s*\$?([0-9,]+)/i
    ],
    titlePatterns: [
      /<span id="titletextonly">([^<]+)/i,
      /<title>([^<]+)/i
    ]
  },
  'ebay.com': {
    name: 'eBay Motors',
    priority: 1,  // Old listings gone, especially pre-2015
    goldRushYears: [2003, 2012],
    patterns: [/\/itm\/|motors\.ebay|ebaymotors|cgi\.ebay\.com/],
    pricePatterns: [
      // Modern eBay (2010+)
      /itemprop="price"[^>]*content="([0-9.]+)"/i,
      // Old eBay format (2003-2010)
      /id="prcIsum"[^>]*>\s*US\s*\$([0-9,]+\.?\d*)/i,
      /class="vi-price"[^>]*>\$([0-9,]+\.?\d*)/i,
      /BIN\s*price:?\s*\$([0-9,]+)/i,
      /Starting\s*bid:?\s*\$([0-9,]+)/i,
      // Generic patterns
      /\$([0-9,]+\.\d{2})/,
      /US\s*\$([0-9,]+)/i,
      /Buy It Now.*?\$([0-9,]+)/i,
      /Current bid:?\s*\$([0-9,]+)/i,
      /Winning bid:?\s*\$([0-9,]+)/i,
      /Reserve\s*(?:not\s*)?met.*?\$([0-9,]+)/i
    ],
    titlePatterns: [
      // Modern
      /<h1[^>]*id="itemTitle"[^>]*>([^<]+)/i,
      // Old eBay (2003-2008) - title in page title after item number
      /<title>[^:]+:\s*([^|<]+)/i,
      // Very old format
      /class="it-ttl"[^>]*>([^<]+)/i,
      /<title>([^<]+)/i
    ]
  },
  // Old eBay CGI domain (separate entry for priority matching)
  'cgi.ebay.com': {
    name: 'eBay Motors (Classic)',
    priority: 1,  // 2003-2008 era listings
    goldRushYears: [2003, 2008],
    patterns: [/ebaymotors/],
    pricePatterns: [
      /id="prcIsum"[^>]*>\s*US\s*\$([0-9,]+\.?\d*)/i,
      /class="vi-price"[^>]*>\$([0-9,]+\.?\d*)/i,
      /BIN\s*price:?\s*\$([0-9,]+)/i,
      /Starting\s*bid:?\s*\$([0-9,]+)/i,
      /Current\s*bid:?\s*\$([0-9,]+)/i,
      /\$([0-9,]+\.\d{2})/,
      /US\s*\$([0-9,]+)/i
    ],
    titlePatterns: [
      /<title>[^:]+:\s*([^|<]+)/i,
      /class="it-ttl"[^>]*>([^<]+)/i,
      /<b[^>]*class="[^"]*vi-title[^"]*"[^>]*>([^<]+)/i,
      /<title>([^<]+)/i
    ]
  },
  'autotraderclassics.com': {
    name: 'AutoTrader Classics',
    priority: 1,  // Merged into Hemmings, old listings gone
    goldRushYears: [2006, 2015],
    patterns: [/\/listing\/|\/car\//],
    pricePatterns: [
      /\$([0-9,]+)/,
      /"price":\s*"?\$?([0-9,]+)/i
    ],
    titlePatterns: [
      /<h1[^>]*>([^<]+)/i,
      /<title>([^<]+)/i
    ]
  },
  'autotrader.com': {
    name: 'AutoTrader',
    priority: 2,
    goldRushYears: [2005, 2012],
    patterns: [/\/cars-for-sale\/|\/listings\//],
    pricePatterns: [
      /"price":\s*"?\$?([0-9,]+)/i,
      /data-price="([0-9]+)"/i,
      /\$([0-9,]+)/
    ],
    titlePatterns: [
      /<h1[^>]*>([^<]+)/i,
      /<title>([^<]+)/i
    ]
  },
  'classiccars.com': {
    name: 'ClassicCars.com',
    priority: 2,
    goldRushYears: [2005, 2014],
    patterns: [/\/listing\/|\/cc-\d+/],
    pricePatterns: [
      /class="price"[^>]*>\$([0-9,]+)/i,
      /\$([0-9,]+)/
    ],
    titlePatterns: [
      /<h1[^>]*>([^<]+)/i,
      /<title>([^<]+)/i
    ]
  },
  'cars.com': {
    name: 'Cars.com',
    priority: 2,
    goldRushYears: [2005, 2012],
    patterns: [/\/vehicledetail\/|\/for-sale\//],
    pricePatterns: [
      /"price":\s*([0-9]+)/i,
      /\$([0-9,]+)/
    ],
    titlePatterns: [
      /<h1[^>]*>([^<]+)/i
    ]
  },
  'hemmings.com': {
    name: 'Hemmings',
    priority: 2,
    goldRushYears: [2005, 2015],
    patterns: [/\/classifieds\/|\/cars-for-sale\//],
    pricePatterns: [
      /class="price"[^>]*>\$([0-9,]+)/i,
      /\$([0-9,]+)/
    ],
    titlePatterns: [
      /<h1[^>]*>([^<]+)/i
    ]
  },
  'dupontregistry.com': {
    name: 'DuPont Registry',
    priority: 2,
    goldRushYears: [2005, 2012],
    patterns: [/\/autos\/|\/listing\//],
    pricePatterns: [
      /\$([0-9,]+)/,
      /Price:?\s*\$([0-9,]+)/i
    ],
    titlePatterns: [
      /<h1[^>]*>([^<]+)/i,
      /<title>([^<]+)/i
    ]
  },
  'oldcarsonline.com': {
    name: 'Old Cars Online',
    priority: 1,  // Site has changed significantly
    goldRushYears: [2003, 2010],
    patterns: [/\/classifieds\/|\/car\//],
    pricePatterns: [
      /\$([0-9,]+)/
    ],
    titlePatterns: [
      /<h1[^>]*>([^<]+)/i,
      /<title>([^<]+)/i
    ]
  }
};

// Backward compat alias
const KNOWN_DOMAINS = HISTORICAL_DOMAINS;

// Search Wayback CDX API for snapshots
async function searchWaybackSnapshots(
  urlPattern: string,
  options: {
    from?: string;  // YYYYMMDD
    to?: string;
    limit?: number;
    filter?: string;
  } = {}
): Promise<WaybackSnapshot[]> {
  const params = new URLSearchParams({
    url: urlPattern,
    output: 'json',
    fl: 'timestamp,original,statuscode,digest',
    filter: options.filter || 'statuscode:200',
    collapse: 'digest',  // Dedupe by content
    limit: String(options.limit || 100)
  });

  if (options.from) params.set('from', options.from);
  if (options.to) params.set('to', options.to);

  const response = await fetch(`${WAYBACK_CDX_API}?${params}`);
  if (!response.ok) {
    throw new Error(`Wayback CDX API error: ${response.status}`);
  }

  const data = await response.json();

  // First row is headers, rest is data
  if (!Array.isArray(data) || data.length < 2) {
    return [];
  }

  return data.slice(1).map((row: string[]) => ({
    timestamp: row[0],
    original_url: row[1],
    snapshot_url: `${WAYBACK_WEB_BASE}/${row[0]}/${row[1]}`,
    status_code: row[2],
    digest: row[3]
  }));
}

// Search for VIN across multiple domains
async function searchVinInWayback(
  vin: string,
  options: {
    domains?: string[];
    fromYear?: number;
    toYear?: number;
    limit?: number;
  } = {}
): Promise<WaybackSnapshot[]> {
  const domains = options.domains || Object.keys(KNOWN_DOMAINS);
  const allSnapshots: WaybackSnapshot[] = [];

  // Search each domain for the VIN
  for (const domain of domains) {
    try {
      // Search for pages containing the VIN
      const snapshots = await searchWaybackSnapshots(
        `*.${domain}/*${vin}*`,
        {
          from: options.fromYear ? `${options.fromYear}0101` : undefined,
          to: options.toYear ? `${options.toYear}1231` : undefined,
          limit: options.limit || 20
        }
      );
      allSnapshots.push(...snapshots);
    } catch (e) {
      console.log(`[wayback] Failed to search ${domain}:`, e);
    }
  }

  // Sort by timestamp (oldest first for provenance)
  return allSnapshots.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// Extract listing data from a Wayback snapshot
async function extractFromSnapshot(snapshotUrl: string): Promise<ExtractedListing | null> {
  try {
    const response = await fetch(snapshotUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VehicleArchiveBot/1.0)'
      }
    });

    if (!response.ok) {
      console.log(`[wayback] Failed to fetch snapshot: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Parse the Wayback URL to get original URL and timestamp
    const urlMatch = snapshotUrl.match(/\/web\/(\d{14})\/(.+)$/);
    if (!urlMatch) return null;

    const [, timestamp, originalUrl] = urlMatch;
    const snapshotDate = `${timestamp.slice(0,4)}-${timestamp.slice(4,6)}-${timestamp.slice(6,8)}`;

    // Determine domain
    const domainMatch = originalUrl.match(/(?:https?:\/\/)?(?:www\.)?([^\/]+)/);
    const domain = domainMatch ? domainMatch[1] : 'unknown';

    // Find matching domain config
    let domainConfig = null;
    for (const [key, config] of Object.entries(KNOWN_DOMAINS)) {
      if (domain.includes(key)) {
        domainConfig = config;
        break;
      }
    }

    const listing: ExtractedListing = {
      snapshot_url: snapshotUrl,
      original_url: originalUrl,
      snapshot_date: snapshotDate,
      domain,
      image_urls: []
    };

    // Extract title
    if (domainConfig) {
      for (const pattern of domainConfig.titlePatterns) {
        const match = html.match(pattern);
        if (match) {
          listing.title = match[1].trim().replace(/\s+/g, ' ');
          break;
        }
      }
    }

    // Fallback title extraction
    if (!listing.title) {
      const titleMatch = html.match(/<title>([^<]+)/i);
      if (titleMatch) {
        listing.title = titleMatch[1].trim().replace(/\s+/g, ' ');
      }
    }

    // Extract price
    if (domainConfig) {
      for (const pattern of domainConfig.pricePatterns) {
        const match = html.match(pattern);
        if (match) {
          const priceStr = match[1].replace(/,/g, '');
          listing.price = parseInt(priceStr, 10);
          if (!isNaN(listing.price) && listing.price > 0 && listing.price < 10000000) {
            break;
          }
          listing.price = undefined;
        }
      }
    }

    // Extract year/make/model from title
    if (listing.title) {
      // Pattern: "2005 Ford Mustang" or "1967 Chevrolet Camaro SS"
      const ymmMatch = listing.title.match(/\b(19[0-9]{2}|20[0-2][0-9])\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+([A-Za-z0-9]+(?:\s+[A-Za-z0-9]+)*)/i);
      if (ymmMatch) {
        listing.year = parseInt(ymmMatch[1], 10);
        listing.make = ymmMatch[2].trim();
        listing.model = ymmMatch[3].trim();
      }
    }

    // Extract VIN - universal patterns
    const vinPatterns = [
      /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,  // US/Canada/Mexico
      /\bVIN:?\s*([A-HJ-NPR-Z0-9]{17})\b/i,
      /\bVehicle Identification Number:?\s*([A-HJ-NPR-Z0-9]{17})\b/i
    ];

    for (const pattern of vinPatterns) {
      const match = html.match(pattern);
      if (match) {
        listing.vin = match[1].toUpperCase();
        break;
      }
    }

    // Extract mileage
    const mileagePatterns = [
      /(\d{1,3}(?:,\d{3})*)\s*(?:miles|mi\b)/i,
      /mileage:?\s*(\d{1,3}(?:,\d{3})*)/i,
      /odometer:?\s*(\d{1,3}(?:,\d{3})*)/i
    ];

    for (const pattern of mileagePatterns) {
      const match = html.match(pattern);
      if (match) {
        listing.mileage = parseInt(match[1].replace(/,/g, ''), 10);
        if (!isNaN(listing.mileage) && listing.mileage < 1000000) {
          break;
        }
        listing.mileage = undefined;
      }
    }

    // Extract location
    const locationPatterns = [
      /location:?\s*([^<\n]+)/i,
      /(?:located in|location)\s*:?\s*([A-Za-z\s]+,\s*[A-Z]{2})/i
    ];

    for (const pattern of locationPatterns) {
      const match = html.match(pattern);
      if (match) {
        listing.location = match[1].trim();
        break;
      }
    }

    // Extract images - look for vehicle photos
    const imagePatterns = [
      /src=["']([^"']+(?:\.jpg|\.jpeg|\.png|\.webp)[^"']*)/gi,
      /data-src=["']([^"']+(?:\.jpg|\.jpeg|\.png|\.webp)[^"']*)/gi
    ];

    const seenImages = new Set<string>();
    for (const pattern of imagePatterns) {
      let match;
      while ((match = pattern.exec(html)) !== null) {
        let imgUrl = match[1];

        // Skip tiny images, icons, logos
        if (imgUrl.includes('thumb') && imgUrl.includes('50')) continue;
        if (imgUrl.includes('icon') || imgUrl.includes('logo')) continue;
        if (imgUrl.includes('1x1') || imgUrl.includes('pixel')) continue;

        // Convert relative URLs
        if (imgUrl.startsWith('//')) {
          imgUrl = 'https:' + imgUrl;
        } else if (imgUrl.startsWith('/')) {
          const baseUrl = originalUrl.match(/^(https?:\/\/[^\/]+)/)?.[1];
          if (baseUrl) imgUrl = baseUrl + imgUrl;
        }

        // Wayback-ify the URL
        if (!imgUrl.includes('web.archive.org')) {
          imgUrl = `${WAYBACK_WEB_BASE}/${timestamp}im_/${imgUrl}`;
        }

        if (!seenImages.has(imgUrl)) {
          seenImages.add(imgUrl);
          listing.image_urls.push(imgUrl);
        }

        if (listing.image_urls.length >= 10) break;
      }
    }

    // Extract description text
    const descPatterns = [
      /<section id="postingbody"[^>]*>([\s\S]*?)<\/section>/i,  // Craigslist
      /id="viDescription"[^>]*>([\s\S]*?)<\/div>/i,  // eBay
      /class="description"[^>]*>([\s\S]*?)<\/div>/i
    ];

    for (const pattern of descPatterns) {
      const match = html.match(pattern);
      if (match) {
        // Strip HTML tags
        listing.description = match[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 2000);
        break;
      }
    }

    return listing;
  } catch (e) {
    console.error('[wayback] Extract error:', e);
    return null;
  }
}

// Ingest extracted listing as an observation
async function ingestAsObservation(
  listing: ExtractedListing,
  supabaseUrl: string,
  serviceRoleKey: string
): Promise<{ observation_id: string; vehicle_id?: string } | null> {
  try {
    const response = await fetch(
      `${supabaseUrl}/functions/v1/ingest-observation`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source_slug: 'wayback-machine',
          kind: 'listing',
          observed_at: listing.snapshot_date,
          source_url: listing.snapshot_url,
          source_identifier: `wayback-${listing.snapshot_date}-${listing.domain}`,
          content_text: [listing.title, listing.description].filter(Boolean).join('\n'),
          structured_data: {
            original_url: listing.original_url,
            snapshot_date: listing.snapshot_date,
            domain: listing.domain,
            historical_price: listing.price,
            historical_mileage: listing.mileage,
            location: listing.location,
            image_count: listing.image_urls.length
          },
          vehicle_hints: {
            vin: listing.vin,
            year: listing.year,
            make: listing.make,
            model: listing.model,
            url: listing.original_url
          }
        })
      }
    );

    if (response.ok) {
      return await response.json();
    }

    console.log('[wayback] Ingest failed:', await response.text());
    return null;
  } catch (e) {
    console.error('[wayback] Ingest error:', e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: WaybackRequest = await req.json();
    const { mode, ingest = false } = body;

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    let result: any = {};

    switch (mode) {
      case 'search_vin': {
        if (!body.vin) {
          return new Response(
            JSON.stringify({ error: 'VIN required for search_vin mode' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const snapshots = await searchVinInWayback(body.vin, {
          domains: body.domains,
          fromYear: body.from_year,
          toYear: body.to_year,
          limit: body.limit
        });

        // Extract data from each snapshot
        const listings: ExtractedListing[] = [];
        for (const snapshot of snapshots.slice(0, 5)) {  // Limit to avoid timeout
          const listing = await extractFromSnapshot(snapshot.snapshot_url);
          if (listing) {
            listings.push(listing);

            if (ingest) {
              await ingestAsObservation(listing, supabaseUrl, serviceRoleKey);
            }
          }
        }

        result = {
          vin: body.vin,
          snapshots_found: snapshots.length,
          listings_extracted: listings.length,
          listings
        };
        break;
      }

      case 'search_url': {
        if (!body.url_pattern) {
          return new Response(
            JSON.stringify({ error: 'url_pattern required for search_url mode' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const snapshots = await searchWaybackSnapshots(body.url_pattern, {
          from: body.from_year ? `${body.from_year}0101` : undefined,
          to: body.to_year ? `${body.to_year}1231` : undefined,
          limit: body.limit || 50
        });

        result = {
          url_pattern: body.url_pattern,
          snapshots_found: snapshots.length,
          snapshots: snapshots.slice(0, 20)  // Return first 20
        };
        break;
      }

      case 'extract_snapshot': {
        if (!body.snapshot_url) {
          return new Response(
            JSON.stringify({ error: 'snapshot_url required for extract_snapshot mode' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const listing = await extractFromSnapshot(body.snapshot_url);

        if (!listing) {
          return new Response(
            JSON.stringify({ error: 'Failed to extract listing from snapshot' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        let observation = null;
        if (ingest) {
          observation = await ingestAsObservation(listing, supabaseUrl, serviceRoleKey);
        }

        result = {
          listing,
          observation
        };
        break;
      }

      case 'find_vehicle_history': {
        // Search by year/make/model across multiple domains
        const searchTerms: string[] = [];

        if (body.vin) {
          searchTerms.push(body.vin);
        }

        if (body.year && body.make && body.model) {
          searchTerms.push(`${body.year}+${body.make}+${body.model}`);
          searchTerms.push(`${body.year} ${body.make} ${body.model}`);
        }

        if (searchTerms.length === 0) {
          return new Response(
            JSON.stringify({ error: 'Need VIN or year/make/model for find_vehicle_history' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const allListings: ExtractedListing[] = [];
        const domains = body.domains || Object.keys(KNOWN_DOMAINS);

        for (const domain of domains) {
          for (const term of searchTerms) {
            const pattern = `*.${domain}/*${term}*`;
            const snapshots = await searchWaybackSnapshots(pattern, {
              from: body.from_year ? `${body.from_year}0101` : undefined,
              to: body.to_year ? `${body.to_year}1231` : undefined,
              limit: 10
            });

            for (const snapshot of snapshots.slice(0, 3)) {
              const listing = await extractFromSnapshot(snapshot.snapshot_url);
              if (listing && listing.price) {
                allListings.push(listing);

                if (ingest) {
                  await ingestAsObservation(listing, supabaseUrl, serviceRoleKey);
                }
              }
            }
          }
        }

        // Sort by date
        allListings.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

        result = {
          search_terms: searchTerms,
          domains_searched: domains,
          listings_found: allListings.length,
          listings: allListings,
          price_history: allListings
            .filter(l => l.price)
            .map(l => ({
              date: l.snapshot_date,
              price: l.price,
              domain: l.domain,
              mileage: l.mileage
            }))
        };
        break;
      }

      case 'gold_rush': {
        // Search for desirable vehicles in OLD archives (2003-2012 Craigslist/eBay)
        // This finds the "$4500 in 2008" listings that are now $200k+
        const query = body.search_query;
        if (!query) {
          return new Response(
            JSON.stringify({ error: 'search_query required for gold_rush mode (e.g., "1967 Camaro SS")' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Focus on dead/changed sites first (priority 1)
        const priorityDomains = body.priority_domains_only
          ? Object.entries(HISTORICAL_DOMAINS).filter(([, v]) => v.priority === 1).map(([k]) => k)
          : body.domains || ['craigslist.org', 'ebay.com'];

        // Default to the "gold rush" era: 2003-2012 when classics were cheap
        const fromYear = body.from_year || 2003;
        const toYear = body.to_year || 2012;

        const allListings: ExtractedListing[] = [];
        const searchVariants = [
          query.replace(/\s+/g, '+'),
          query.replace(/\s+/g, '%20'),
          query.toLowerCase().replace(/\s+/g, '-')
        ];

        console.log(`[wayback] Gold rush search: "${query}" in ${priorityDomains.join(', ')} (${fromYear}-${toYear})`);

        for (const domain of priorityDomains) {
          const domainConfig = HISTORICAL_DOMAINS[domain];
          if (!domainConfig) continue;

          // Use domain's gold rush years if more restrictive
          const effectiveFrom = Math.max(fromYear, domainConfig.goldRushYears[0]);
          const effectiveTo = Math.min(toYear, domainConfig.goldRushYears[1]);

          for (const variant of searchVariants) {
            try {
              // Search pattern optimized for each domain
              let pattern = `*.${domain}/*`;
              if (domain === 'craigslist.org') {
                // Craigslist: search in cars+trucks section
                pattern = `*.craigslist.org/cto/*${variant}*`;
              } else if (domain === 'ebay.com') {
                // eBay Motors
                pattern = `*motors.ebay.com/itm/*${variant}*`;
              } else {
                pattern = `*.${domain}/*${variant}*`;
              }

              const snapshots = await searchWaybackSnapshots(pattern, {
                from: `${effectiveFrom}0101`,
                to: `${effectiveTo}1231`,
                limit: body.limit || 20
              });

              console.log(`[wayback] ${domain}: ${snapshots.length} snapshots for "${variant}"`);

              // Extract from each snapshot (limit to avoid timeout)
              for (const snapshot of snapshots.slice(0, 5)) {
                const listing = await extractFromSnapshot(snapshot.snapshot_url);
                if (listing && listing.price && listing.price > 0) {
                  allListings.push(listing);

                  if (ingest) {
                    await ingestAsObservation(listing, supabaseUrl, serviceRoleKey);
                  }
                }
              }

              // Found enough? Stop searching this domain
              if (allListings.length >= 10) break;

            } catch (e) {
              console.log(`[wayback] Search failed for ${domain}/${variant}:`, e);
            }

            // Rate limit protection
            await new Promise(r => setTimeout(r, 200));
          }

          if (allListings.length >= 15) break;
        }

        // Sort by date (oldest first - shows the cheap era)
        allListings.sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));

        result = {
          query,
          search_era: `${fromYear}-${toYear}`,
          domains_searched: priorityDomains,
          listings_found: allListings.length,
          listings: allListings,
          // Calculate what these prices look like now (for context)
          summary: {
            oldest_listing: allListings[0] || null,
            lowest_price: allListings.reduce((min, l) => l.price && l.price < min ? l.price : min, Infinity),
            average_price: allListings.length > 0
              ? Math.round(allListings.reduce((sum, l) => sum + (l.price || 0), 0) / allListings.length)
              : 0,
            sources: [...new Set(allListings.map(l => l.domain))]
          }
        };
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown mode: ${mode}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[extract-wayback-listing] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
