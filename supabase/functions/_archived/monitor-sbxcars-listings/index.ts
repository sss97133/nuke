// Monitor SBX Cars listings for updates (bids, status changes, etc.)
// Designed to run periodically on existing vehicles from SBX Cars

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function detectCurrencyCodeFromText(text: string | null | undefined): string | null {
  const raw = String(text || '');
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper.includes('AED') || raw.includes('د.إ')) return 'AED';
  if (upper.includes('EUR') || raw.includes('€')) return 'EUR';
  if (upper.includes('GBP') || raw.includes('£')) return 'GBP';
  if (upper.includes('CHF')) return 'CHF';
  if (upper.includes('JPY') || raw.includes('¥')) return 'JPY';
  if (upper.includes('CAD')) return 'CAD';
  if (upper.includes('AUD')) return 'AUD';
  if (upper.includes('USD') || raw.includes('US$') || raw.includes('$')) return 'USD';
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const {
      vehicle_id,
      listing_url,
      batch_size = 50,
    } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY') || ''
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Supabase configuration' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    // If specific vehicle/URL provided, monitor just that one
    if (vehicle_id || listing_url) {
      let url = listing_url
      
      if (!url && vehicle_id) {
        const { data: vehicle } = await supabase
          .from('vehicles')
          .select('discovery_url')
          .eq('id', vehicle_id)
          .single()

        if (vehicle) {
          url = vehicle.discovery_url
        }
      }

      if (!url) {
        return new Response(
          JSON.stringify({ success: false, error: 'Could not determine listing URL' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const update = await monitorListing(url, firecrawlKey)
      
      if (update && vehicle_id) {
        // Update vehicle record
        await supabase
          .from('vehicles')
          .update({
            asking_price: update.current_bid || undefined,
            sale_price: update.sale_price || undefined,
            auction_end_date: update.auction_end_date || undefined,
            auction_status: update.auction_status || undefined,
            updated_at: new Date().toISOString(),
          })
          .eq('id', vehicle_id)
      }

      return new Response(
        JSON.stringify({
          success: true,
          update,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Batch mode: monitor all active SBX Cars listings
    // Query external_listings directly since that's where SBX data is stored
    const { data: listings } = await supabase
      .from('external_listings')
      .select('id, vehicle_id, listing_url, end_date, current_bid, listing_status, metadata')
      .eq('platform', 'sbx')
      .in('listing_status', ['active', 'live', 'upcoming'])
      .order('updated_at', { ascending: true })
      .limit(batch_size)

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { checked: 0, updated: 0 },
          message: 'No active SBX Cars listings to monitor',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const stats = {
      checked: 0,
      updated: 0,
      errors: 0,
    }

    for (const listing of listings) {
      if (!listing.listing_url) continue
      const vehicle = { id: listing.vehicle_id, discovery_url: listing.listing_url }

      try {
        const update = await monitorListing(vehicle.discovery_url, firecrawlKey)
        
        if (update) {
          const updates: any = {
            updated_at: new Date().toISOString(),
          }

          if (update.current_bid !== null) updates.asking_price = update.current_bid
          if (update.sale_price !== null) updates.sale_price = update.sale_price
          if (update.auction_end_date) updates.auction_end_date = update.auction_end_date
          if (update.auction_status) updates.auction_status = update.auction_status

          await supabase
            .from('vehicles')
            .update(updates)
            .eq('id', vehicle.id)

          // Also update external_listings for countdown timer support
          const listingUpdates: any = {
            updated_at: new Date().toISOString(),
          }
          if (update.current_bid !== null) listingUpdates.current_bid = update.current_bid
          if (update.sale_price !== null) listingUpdates.final_price = update.sale_price
          if (update.auction_end_date) listingUpdates.end_date = update.auction_end_date
          if (update.auction_status) {
            listingUpdates.listing_status = update.auction_status === 'live' ? 'active' : update.auction_status
          }
          if (update.currency_code) {
            const existingMeta =
              listing?.metadata && typeof listing.metadata === 'object' ? listing.metadata : {}
            listingUpdates.metadata = {
              ...existingMeta,
              currency_code: update.currency_code,
              currency: update.currency_code,
              price_currency: update.currency_code,
            }
          }

          await supabase
            .from('external_listings')
            .update(listingUpdates)
            .eq('vehicle_id', vehicle.id)
            .eq('platform', 'sbx')

          stats.updated++
        }

        stats.checked++
        await new Promise(resolve => setTimeout(resolve, 1000)) // Rate limit
      } catch (error: any) {
        console.error(`Error monitoring ${vehicle.discovery_url}:`, error.message)
        stats.errors++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error in monitor-sbxcars-listings:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function monitorListing(url: string, firecrawlKey: string | undefined): Promise<any> {
  try {
    let html = ''

    if (firecrawlKey) {
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['html'],
          waitFor: 2000,
          onlyMainContent: false,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        html = data.data?.html || ''
      }
    }

    if (!html) {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      })
      html = await response.text()
    }

    const doc = new DOMParser().parseFromString(html, 'text/html')

    // Extract current bid
    const bidSection = doc?.querySelector('[class*="bid"], [class*="current"]')
    const bidText = bidSection?.textContent || ''
    const bidMatch = bidText.match(/(?:latest|current)\s+bid[:\s]+(?:US\$|AED|€|£)?([\d,]+)/i)
    const currentBid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null

    // Extract auction status
    const statusText = doc?.textContent || ''
    let auctionStatus: string | null = null
    if (statusText.toLowerCase().includes('sold')) auctionStatus = 'sold'
    else if (statusText.toLowerCase().includes('ended')) auctionStatus = 'ended'
    else if (statusText.toLowerCase().includes('live')) auctionStatus = 'live'
    else if (statusText.toLowerCase().includes('upcoming')) auctionStatus = 'upcoming'

    // Extract sale price if sold
    const salePriceMatch = statusText.match(/(?:sold|final)[:\s]+(?:US\$|AED|€|£)?([\d,]+)/i)
    const salePrice = salePriceMatch ? parseInt(salePriceMatch[1].replace(/,/g, '')) : null
    const currencyCode = detectCurrencyCodeFromText(bidText) || detectCurrencyCodeFromText(statusText)

    // Extract auction end date from countdown or time remaining
    let auctionEndDate: string | null = null

    // Try to find countdown data attribute
    const countdownMatch = html.match(/data-countdown\s*=\s*["'](\d+)["']/i) ||
                          html.match(/data-end-time\s*=\s*["'](\d+)["']/i) ||
                          html.match(/"endTime"\s*:\s*(\d+)/i)
    if (countdownMatch) {
      const timestamp = parseInt(countdownMatch[1], 10)
      if (timestamp > 0) {
        // Check if it's seconds or milliseconds
        const ts = timestamp > 9999999999 ? timestamp : timestamp * 1000
        auctionEndDate = new Date(ts).toISOString()
      }
    }

    // Fallback: parse "X days", "X hours" remaining
    if (!auctionEndDate) {
      const timeRemainingMatch = statusText.match(/(\d+)\s*(?:day|days)\s*(?:remaining|left)?/i) ||
                                  statusText.match(/(\d+)\s*(?:hour|hours|H)\s*(?:remaining|left)?/i)
      if (timeRemainingMatch) {
        const value = parseInt(timeRemainingMatch[1], 10)
        const isHours = /hour|H/i.test(timeRemainingMatch[0])
        const now = new Date()
        if (isHours) {
          now.setHours(now.getHours() + value)
        } else {
          now.setDate(now.getDate() + value)
        }
        auctionEndDate = now.toISOString()
      }
    }

    return {
      current_bid: currentBid,
      sale_price: salePrice,
      auction_status: auctionStatus,
      auction_end_date: auctionEndDate,
      currency_code: currencyCode,
      last_checked_at: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error(`Error monitoring listing ${url}:`, error.message)
    return null
  }
}

