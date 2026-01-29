/**
 * Generate Then vs Now
 *
 * Creates viral "then vs now" comparison posts by:
 * 1. Finding old Craigslist/eBay listings from Wayback Machine
 * 2. Matching with recent auction results (Barrett Jackson, BaT, etc.)
 * 3. Generating comparison content that shows price appreciation
 *
 * This format is proven engagement bait - sparks debate about build costs,
 * market speculation, nostalgia, etc.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ThenVsNowRequest {
  // Find opportunities automatically
  mode: 'find_opportunities' | 'generate_for_vehicle' | 'generate_for_vin' | 'discover_gold';

  // For specific vehicle
  vehicle_id?: string;
  vin?: string;

  // For discover_gold mode - search for specific desirable vehicles
  search_query?: string;  // e.g., "1967 Camaro SS", "E30 M3", "964 Turbo"
  current_price?: number;  // What they sell for now (to calculate appreciation)

  // Filters
  min_appreciation?: number;  // e.g., 5 = 5x appreciation
  year_range?: { from: number; to: number };
  wayback_years?: { from: number; to: number };  // When to search Wayback (default 2003-2012)

  // Content options
  style?: 'factual' | 'provocative' | 'nostalgic';
  include_images?: boolean;
}

interface ThenVsNowResult {
  vehicle: {
    year: number;
    make: string;
    model: string;
    vin?: string;
  };
  then: {
    date: string;
    price: number;
    source: string;
    mileage?: number;
    location?: string;
    snapshot_url?: string;
    image_url?: string;
  };
  now: {
    date: string;
    price: number;
    source: string;
    mileage?: number;
    auction_house?: string;
    url?: string;
    image_url?: string;
  };
  appreciation: {
    multiple: number;  // e.g., 5.2x
    percentage: number;  // e.g., 420%
    annual_rate: number;  // CAGR
    years: number;
  };
  content: {
    hook: string;
    body: string;
    cta?: string;
    hashtags?: string[];
  };
}

// Calculate compound annual growth rate
function calculateCAGR(startValue: number, endValue: number, years: number): number {
  if (years <= 0 || startValue <= 0) return 0;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

// Generate content in different styles
function generateContent(
  result: Omit<ThenVsNowResult, 'content'>,
  style: 'factual' | 'provocative' | 'nostalgic'
): ThenVsNowResult['content'] {
  const { vehicle, then, now, appreciation } = result;
  const vehicleName = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;

  switch (style) {
    case 'provocative':
      return {
        hook: `This ${vehicleName} sold for $${then.price.toLocaleString()} in ${then.date.slice(0, 4)}.`,
        body: `It just sold for $${now.price.toLocaleString()} at ${now.auction_house || now.source}.\n\nThat's ${appreciation.multiple.toFixed(1)}x in ${appreciation.years} years.\n\nYour 401k could never.`,
        cta: `We track these appreciation stories from barn find to Barrett Jackson.`,
        hashtags: ['carsandmoney', 'investment', 'classiccars']
      };

    case 'nostalgic':
      return {
        hook: `Remember when you could get a ${vehicleName} for $${then.price.toLocaleString()}?`,
        body: `${then.date.slice(0, 4)}: Listed on ${then.source} for $${then.price.toLocaleString()}${then.mileage ? ` with ${then.mileage.toLocaleString()} miles` : ''}.\n\n${now.date.slice(0, 4)}: Sold at ${now.auction_house || now.source} for $${now.price.toLocaleString()}.\n\nShould've bought one.`,
        hashtags: ['classiccars', 'shouldaboughtone', 'hindsight']
      };

    case 'factual':
    default:
      return {
        hook: `${vehicleName} price history`,
        body: `${then.date.slice(0, 4)}: $${then.price.toLocaleString()} (${then.source})\n${now.date.slice(0, 4)}: $${now.price.toLocaleString()} (${now.source})\n\n${appreciation.multiple.toFixed(1)}x appreciation\n${appreciation.annual_rate.toFixed(1)}% annual return`,
        hashtags: ['marketdata', 'classiccars', 'pricehistory']
      };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: ThenVsNowRequest = await req.json();
    const {
      mode,
      vehicle_id,
      vin,
      min_appreciation = 3,
      year_range,
      style = 'provocative',
      include_images = true
    } = body;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    const results: ThenVsNowResult[] = [];

    if (mode === 'find_opportunities') {
      // Find vehicles with recent high-value sales
      const { data: recentSales } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, vin, sale_price,
          auction_events!inner(
            platform, sold_at, final_price, url
          )
        `)
        .not('sale_price', 'is', null)
        .gte('sale_price', 50000)  // High value sales
        .order('sale_price', { ascending: false })
        .limit(20);

      if (recentSales) {
        for (const vehicle of recentSales) {
          if (!vehicle.vin) continue;

          // Search Wayback for historical listings
          try {
            const waybackResponse = await fetch(
              `${supabaseUrl}/functions/v1/extract-wayback-listing`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${serviceRoleKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  mode: 'search_vin',
                  vin: vehicle.vin,
                  from_year: year_range?.from || 2000,
                  to_year: year_range?.to || 2015,
                  limit: 5
                })
              }
            );

            if (waybackResponse.ok) {
              const waybackData = await waybackResponse.json();

              if (waybackData.listings?.length > 0) {
                // Find the oldest listing with a price
                const oldListing = waybackData.listings
                  .filter((l: any) => l.price && l.price > 0)
                  .sort((a: any, b: any) => a.snapshot_date.localeCompare(b.snapshot_date))[0];

                if (oldListing && vehicle.sale_price) {
                  const multiple = vehicle.sale_price / oldListing.price;

                  if (multiple >= min_appreciation) {
                    const thenYear = parseInt(oldListing.snapshot_date.slice(0, 4));
                    const nowYear = new Date().getFullYear();
                    const years = nowYear - thenYear;

                    const resultData = {
                      vehicle: {
                        year: vehicle.year,
                        make: vehicle.make,
                        model: vehicle.model,
                        vin: vehicle.vin
                      },
                      then: {
                        date: oldListing.snapshot_date,
                        price: oldListing.price,
                        source: oldListing.domain,
                        mileage: oldListing.mileage,
                        location: oldListing.location,
                        snapshot_url: oldListing.snapshot_url,
                        image_url: oldListing.image_urls?.[0]
                      },
                      now: {
                        date: (vehicle as any).auction_events?.[0]?.sold_at || new Date().toISOString(),
                        price: vehicle.sale_price,
                        source: (vehicle as any).auction_events?.[0]?.platform || 'Auction',
                        auction_house: (vehicle as any).auction_events?.[0]?.platform,
                        url: (vehicle as any).auction_events?.[0]?.url
                      },
                      appreciation: {
                        multiple,
                        percentage: (multiple - 1) * 100,
                        annual_rate: calculateCAGR(oldListing.price, vehicle.sale_price, years),
                        years
                      }
                    };

                    results.push({
                      ...resultData,
                      content: generateContent(resultData, style)
                    });
                  }
                }
              }
            }
          } catch (e) {
            console.log(`[then-vs-now] Failed to search Wayback for ${vehicle.vin}:`, e);
          }

          // Limit to avoid timeout
          if (results.length >= 5) break;
        }
      }
    } else if (mode === 'generate_for_vehicle' && vehicle_id) {
      // Get specific vehicle
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select(`
          id, year, make, model, vin, sale_price,
          vehicle_images(image_url),
          auction_events(platform, sold_at, final_price, url)
        `)
        .eq('id', vehicle_id)
        .single();

      if (vehicle?.vin) {
        // Search Wayback
        const waybackResponse = await fetch(
          `${supabaseUrl}/functions/v1/extract-wayback-listing`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceRoleKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              mode: 'find_vehicle_history',
              vin: vehicle.vin,
              year: vehicle.year,
              make: vehicle.make,
              model: vehicle.model,
              from_year: year_range?.from || 2000,
              to_year: year_range?.to || 2018
            })
          }
        );

        if (waybackResponse.ok) {
          const waybackData = await waybackResponse.json();

          if (waybackData.listings?.length > 0) {
            const oldListing = waybackData.listings
              .filter((l: any) => l.price && l.price > 0)
              .sort((a: any, b: any) => a.snapshot_date.localeCompare(b.snapshot_date))[0];

            const currentPrice = vehicle.sale_price ||
              (vehicle as any).auction_events?.[0]?.final_price;

            if (oldListing && currentPrice) {
              const multiple = currentPrice / oldListing.price;
              const thenYear = parseInt(oldListing.snapshot_date.slice(0, 4));
              const nowYear = new Date().getFullYear();
              const years = nowYear - thenYear;

              const resultData = {
                vehicle: {
                  year: vehicle.year,
                  make: vehicle.make,
                  model: vehicle.model,
                  vin: vehicle.vin
                },
                then: {
                  date: oldListing.snapshot_date,
                  price: oldListing.price,
                  source: oldListing.domain,
                  mileage: oldListing.mileage,
                  snapshot_url: oldListing.snapshot_url,
                  image_url: oldListing.image_urls?.[0]
                },
                now: {
                  date: (vehicle as any).auction_events?.[0]?.sold_at || new Date().toISOString(),
                  price: currentPrice,
                  source: (vehicle as any).auction_events?.[0]?.platform || 'Current',
                  auction_house: (vehicle as any).auction_events?.[0]?.platform,
                  image_url: (vehicle as any).vehicle_images?.[0]?.image_url
                },
                appreciation: {
                  multiple,
                  percentage: (multiple - 1) * 100,
                  annual_rate: calculateCAGR(oldListing.price, currentPrice, years),
                  years
                }
              };

              results.push({
                ...resultData,
                content: generateContent(resultData, style)
              });
            }
          }
        }
      }
    } else if (mode === 'generate_for_vin' && vin) {
      // Direct VIN search - no existing vehicle required
      const waybackResponse = await fetch(
        `${supabaseUrl}/functions/v1/extract-wayback-listing`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            mode: 'search_vin',
            vin,
            from_year: year_range?.from || 2000,
            to_year: year_range?.to || 2018,
            ingest: true  // Store findings
          })
        }
      );

      if (waybackResponse.ok) {
        const waybackData = await waybackResponse.json();

        // Return raw findings - user can match with current sale manually
        return new Response(
          JSON.stringify({
            vin,
            historical_listings: waybackData.listings || [],
            message: waybackData.listings?.length > 0
              ? `Found ${waybackData.listings.length} historical listings. Match with current sale price to generate content.`
              : 'No historical listings found for this VIN.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } else if (mode === 'discover_gold' && body.search_query) {
      // NEW: Search old Craigslist/eBay archives for specific vehicles
      // This is the "gold rush" - finding $4500 listings from 2008 that are now $200k+
      const waybackFrom = body.wayback_years?.from || 2003;
      const waybackTo = body.wayback_years?.to || 2012;

      const waybackResponse = await fetch(
        `${supabaseUrl}/functions/v1/extract-wayback-listing`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            mode: 'gold_rush',
            search_query: body.search_query,
            from_year: waybackFrom,
            to_year: waybackTo,
            priority_domains_only: true,  // Only dead/changed sites
            limit: 20,
            ingest: true
          })
        }
      );

      if (!waybackResponse.ok) {
        return new Response(
          JSON.stringify({ error: 'Failed to search Wayback archives', details: await waybackResponse.text() }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const waybackData = await waybackResponse.json();
      const listings = waybackData.listings || [];

      if (listings.length === 0) {
        return new Response(
          JSON.stringify({
            query: body.search_query,
            message: `No old listings found for "${body.search_query}" in ${waybackFrom}-${waybackTo} archives.`,
            tip: 'Try different search terms or a broader date range.'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // If user provided current price, generate comparison content
      if (body.current_price) {
        const currentPrice = body.current_price;

        for (const oldListing of listings.filter((l: any) => l.price && l.price > 0)) {
          const multiple = currentPrice / oldListing.price;

          if (multiple >= min_appreciation) {
            const thenYear = parseInt(oldListing.snapshot_date.slice(0, 4));
            const nowYear = new Date().getFullYear();
            const years = nowYear - thenYear;

            const resultData = {
              vehicle: {
                year: oldListing.year || parseInt(body.search_query.match(/\b(19[0-9]{2}|20[0-2][0-9])\b/)?.[1] || '0'),
                make: oldListing.make || body.search_query.split(' ')[1] || 'Unknown',
                model: oldListing.model || body.search_query.split(' ').slice(2).join(' ') || 'Unknown',
                vin: oldListing.vin
              },
              then: {
                date: oldListing.snapshot_date,
                price: oldListing.price,
                source: oldListing.domain,
                mileage: oldListing.mileage,
                location: oldListing.location,
                snapshot_url: oldListing.snapshot_url,
                image_url: oldListing.image_urls?.[0]
              },
              now: {
                date: new Date().toISOString().slice(0, 10),
                price: currentPrice,
                source: 'Current Market',
                auction_house: 'Estimated'
              },
              appreciation: {
                multiple,
                percentage: (multiple - 1) * 100,
                annual_rate: calculateCAGR(oldListing.price, currentPrice, years),
                years
              }
            };

            results.push({
              ...resultData,
              content: generateContent(resultData, style)
            });
          }
        }

        // Sort by appreciation
        results.sort((a, b) => b.appreciation.multiple - a.appreciation.multiple);
      }

      // Return both raw listings and any generated content
      return new Response(
        JSON.stringify({
          query: body.search_query,
          search_era: `${waybackFrom}-${waybackTo}`,
          raw_listings: listings,
          summary: waybackData.summary,
          // If we generated content
          opportunities: results.length,
          results: results.length > 0 ? results : undefined,
          best_story: results[0] || null,
          // Guidance if no current_price provided
          message: !body.current_price
            ? `Found ${listings.length} old listings. Provide current_price to generate "then vs now" content.`
            : `Generated ${results.length} comparison stories from ${listings.length} old listings.`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sort by appreciation multiple
    results.sort((a, b) => b.appreciation.multiple - a.appreciation.multiple);

    return new Response(
      JSON.stringify({
        opportunities: results.length,
        results,
        best_story: results[0] || null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[generate-then-vs-now] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
