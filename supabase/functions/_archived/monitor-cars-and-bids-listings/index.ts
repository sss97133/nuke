// Batch monitor for Cars & Bids listings
// Updates end_date, bid data, and status for active listings

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface SyncResult {
  current_bid: number | null;
  bid_count: number | null;
  watcher_count: number | null;
  view_count: number | null;
  auction_status: string | null;
  auction_end_date: string | null;
  final_price: number | null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { batch_size = 20 } = await req.json()

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing Supabase configuration' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Get active C&B listings that need sync (no end_date or old updated_at)
    const { data: listings } = await supabase
      .from('external_listings')
      .select('id, vehicle_id, listing_url, current_bid, end_date, listing_status')
      .in('platform', ['cars_and_bids', 'carsandbids'])
      .in('listing_status', ['active', 'live'])
      .order('updated_at', { ascending: true })
      .limit(batch_size)

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { checked: 0, updated: 0, ended: 0 },
          message: 'No active Cars & Bids listings to monitor',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const stats = { checked: 0, updated: 0, ended: 0, errors: 0 }
    const results: any[] = []

    for (const listing of listings) {
      if (!listing.listing_url) continue

      try {
        const syncResult = await syncListing(listing.listing_url)

        if (syncResult) {
          const updateData: Record<string, any> = {
            updated_at: new Date().toISOString(),
          }

          // Only update fields that have values
          if (syncResult.current_bid !== null) updateData.current_bid = syncResult.current_bid
          if (syncResult.bid_count !== null) updateData.bid_count = syncResult.bid_count
          if (syncResult.watcher_count !== null) updateData.watcher_count = syncResult.watcher_count
          if (syncResult.view_count !== null) updateData.view_count = syncResult.view_count
          if (syncResult.auction_end_date) updateData.end_date = syncResult.auction_end_date

          // Update status
          if (syncResult.auction_status) {
            if (syncResult.auction_status === 'sold') {
              updateData.listing_status = 'sold'
              updateData.final_price = syncResult.final_price || syncResult.current_bid
              updateData.sold_at = new Date().toISOString()
              stats.ended++
            } else if (syncResult.auction_status === 'ended') {
              updateData.listing_status = 'ended'
              stats.ended++
            } else {
              updateData.listing_status = 'active'
            }
          }

          await supabase
            .from('external_listings')
            .update(updateData)
            .eq('id', listing.id)

          results.push({
            id: listing.id,
            url: listing.listing_url,
            prev_bid: listing.current_bid,
            new_bid: syncResult.current_bid,
            end_date: syncResult.auction_end_date,
            status: syncResult.auction_status,
          })

          stats.updated++
        }

        stats.checked++
        // Rate limit - 1 second between requests
        await new Promise(r => setTimeout(r, 1000))
      } catch (err: any) {
        console.error(`Error syncing ${listing.listing_url}:`, err.message)
        stats.errors++
      }
    }

    return new Response(
      JSON.stringify({ success: true, stats, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error in monitor-cars-and-bids-listings:', error)
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function syncListing(url: string): Promise<SyncResult | null> {
  try {
    let html = ''
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')

    // Use Firecrawl for JS rendering (C&B requires it)
    if (firecrawlKey) {
      const fcResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['html'],
          waitFor: 3000,
          onlyMainContent: false,
        }),
      })

      if (fcResponse.ok) {
        const data = await fcResponse.json()
        html = data.data?.html || ''
      }
    }

    // Fallback to direct fetch if Firecrawl fails
    if (!html) {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      html = await response.text()
    }

    const result: SyncResult = {
      current_bid: null,
      bid_count: null,
      watcher_count: null,
      view_count: null,
      auction_status: null,
      auction_end_date: null,
      final_price: null,
    }

    // Extract current/high bid
    const bidPatterns = [
      /(?:Current|High)\s+Bid[^$]*\$([0-9,]+)/i,
      /"currentBid"\s*:\s*(\d+)/i,
      /"highBid"\s*:\s*(\d+)/i,
      /data-current-bid="(\d+)"/i,
    ]

    for (const pattern of bidPatterns) {
      const match = html.match(pattern)
      if (match) {
        const bid = parseInt(match[1].replace(/,/g, ''), 10)
        if (Number.isFinite(bid) && bid > 0) {
          result.current_bid = bid
          break
        }
      }
    }

    // Extract bid count
    const bidCountMatch = html.match(/(\d+)\s+bids?/i) ||
                          html.match(/"bidCount"\s*:\s*(\d+)/i)
    if (bidCountMatch) {
      result.bid_count = parseInt(bidCountMatch[1], 10)
    }

    // Extract watcher count
    const watcherMatch = html.match(/(\d+)\s+watchers?/i)
    if (watcherMatch) {
      result.watcher_count = parseInt(watcherMatch[1], 10)
    }

    // Extract view count
    const viewMatch = html.match(/([0-9,]+)\s+views?/i)
    if (viewMatch) {
      result.view_count = parseInt(viewMatch[1].replace(/,/g, ''), 10)
    }

    // Determine auction status
    const htmlLower = html.toLowerCase()

    // Check for sold
    const soldMatch = html.match(/Sold\s+(?:for|For)[^$]*\$([0-9,]+)/i)
    if (soldMatch) {
      result.auction_status = 'sold'
      result.final_price = parseInt(soldMatch[1].replace(/,/g, ''), 10)
    }
    // Check for ended (no sale)
    else if (htmlLower.includes('auction ended') ||
             htmlLower.includes('bidding has ended') ||
             htmlLower.includes('reserve not met')) {
      result.auction_status = 'ended'
    }
    // Check for active
    else if (htmlLower.includes('place bid') ||
             htmlLower.includes('current bid') ||
             htmlLower.includes('time left') ||
             htmlLower.includes('ends in')) {
      result.auction_status = 'active'

      // Extract end date for active auctions
      // Pattern 1: __NEXT_DATA__ JSON
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/i)
      if (nextDataMatch) {
        try {
          const nextData = JSON.parse(nextDataMatch[1])
          const auction = nextData?.props?.pageProps?.auction ||
                         nextData?.props?.pageProps?.listing ||
                         nextData?.props?.pageProps
          if (auction) {
            // Look for end date in various fields
            const endDateStr = auction.endDate || auction.endsAt || auction.endTime ||
                              auction.auctionEndDate || auction.end_date
            if (endDateStr) {
              const parsed = new Date(endDateStr)
              if (!isNaN(parsed.getTime())) {
                result.auction_end_date = parsed.toISOString()
              }
            }
            // Also try to get current bid from JSON
            if (!result.current_bid && auction.currentBid) {
              const bid = parseInt(String(auction.currentBid).replace(/[^0-9]/g, ''), 10)
              if (Number.isFinite(bid) && bid > 0) result.current_bid = bid
            }
          }
        } catch { /* JSON parse failed */ }
      }

      // Pattern 2: data-countdown attribute
      if (!result.auction_end_date) {
        const countdownMatch = html.match(/data-countdown[^=]*=\s*["']([^"']+)["']/i) ||
                               html.match(/data-end-date[^=]*=\s*["']([^"']+)["']/i)
        if (countdownMatch) {
          const dateStr = countdownMatch[1]
          // Check if it's a timestamp
          if (/^\d+$/.test(dateStr)) {
            const ts = parseInt(dateStr, 10)
            const timestamp = ts > 9999999999 ? ts : ts * 1000
            result.auction_end_date = new Date(timestamp).toISOString()
          } else {
            try {
              const parsed = new Date(dateStr)
              if (!isNaN(parsed.getTime())) {
                result.auction_end_date = parsed.toISOString()
              }
            } catch { /* ignore */ }
          }
        }
      }

      // Pattern 3: Ends in X days/hours text
      if (!result.auction_end_date) {
        const endsMatch = html.match(/(?:ends?\s+in|time\s+left)[:\s]*(\d+)\s*d(?:ays?)?\s*(\d+)\s*h/i) ||
                          html.match(/(\d+)\s*days?\s*(\d+)\s*hours?/i)
        if (endsMatch) {
          const days = parseInt(endsMatch[1], 10) || 0
          const hours = parseInt(endsMatch[2], 10) || 0
          const endDate = new Date()
          endDate.setDate(endDate.getDate() + days)
          endDate.setHours(endDate.getHours() + hours)
          result.auction_end_date = endDate.toISOString()
        }
      }

      // Pattern 4: Just hours
      if (!result.auction_end_date) {
        const hoursMatch = html.match(/(?:ends?\s+in|time\s+left)[:\s]*(\d+)\s*h(?:ours?)?/i)
        if (hoursMatch) {
          const hours = parseInt(hoursMatch[1], 10)
          const endDate = new Date()
          endDate.setHours(endDate.getHours() + hours)
          result.auction_end_date = endDate.toISOString()
        }
      }
    }

    return result
  } catch (error: any) {
    console.error(`Error syncing ${url}:`, error.message)
    return null
  }
}
