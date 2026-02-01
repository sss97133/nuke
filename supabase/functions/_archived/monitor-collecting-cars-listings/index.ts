// Monitor Collecting Cars auction listings for updates
// Collecting Cars is an online auction platform with timed auctions

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MonitorResult {
  current_bid: number | null;
  bid_count: number | null;
  watcher_count: number | null;
  auction_status: string | null;
  auction_end_date: string | null;
  reserve_met: boolean | null;
  last_checked_at: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const {
      listing_id,
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
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Single listing mode
    if (listing_id || listing_url) {
      let url = listing_url

      if (!url && listing_id) {
        const { data: listing } = await supabase
          .from('external_listings')
          .select('listing_url')
          .eq('id', listing_id)
          .single()

        if (listing) url = listing.listing_url
      }

      if (!url) {
        return new Response(
          JSON.stringify({ success: false, error: 'Could not determine listing URL' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const update = await monitorListing(url, firecrawlKey)

      if (update && listing_id) {
        await updateListingRecord(supabase, listing_id, update)
      }

      return new Response(
        JSON.stringify({ success: true, update }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Batch mode
    const { data: listings } = await supabase
      .from('external_listings')
      .select('id, vehicle_id, listing_url, end_date, current_bid, listing_status')
      .eq('platform', 'collecting_cars')
      .in('listing_status', ['active', 'live', 'upcoming'])
      .order('updated_at', { ascending: true })
      .limit(batch_size)

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { checked: 0, updated: 0 },
          message: 'No active Collecting Cars listings to monitor',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const stats = { checked: 0, updated: 0, errors: 0 }
    const results: any[] = []

    for (const listing of listings) {
      if (!listing.listing_url) continue

      try {
        const update = await monitorListing(listing.listing_url, firecrawlKey)

        if (update) {
          await updateListingRecord(supabase, listing.id, update, listing.vehicle_id)
          results.push({
            listing_id: listing.id,
            url: listing.listing_url,
            previous_bid: listing.current_bid,
            current_bid: update.current_bid,
            end_date: update.auction_end_date,
            status: update.auction_status,
          })
          stats.updated++
        }

        stats.checked++
        await new Promise(resolve => setTimeout(resolve, 1500))
      } catch (error: any) {
        console.error(`Error monitoring ${listing.listing_url}:`, error.message)
        stats.errors++
      }
    }

    return new Response(
      JSON.stringify({ success: true, stats, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error in monitor-collecting-cars-listings:', error)
    return new Response(
      JSON.stringify({ success: false, error: error?.message || String(error) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function updateListingRecord(supabase: any, listingId: string, update: MonitorResult, vehicleId?: string) {
  const updateData: Record<string, any> = {
    updated_at: new Date().toISOString(),
  }

  if (update.current_bid !== null) updateData.current_bid = update.current_bid
  if (update.bid_count !== null) updateData.bid_count = update.bid_count
  if (update.watcher_count !== null) updateData.watcher_count = update.watcher_count
  if (update.auction_end_date) updateData.end_date = update.auction_end_date
  if (update.auction_status) {
    updateData.listing_status = update.auction_status === 'sold' ? 'sold' :
                                update.auction_status === 'ended' ? 'ended' : 'active'
    if (update.auction_status === 'sold' && update.current_bid) {
      updateData.final_price = update.current_bid
      updateData.sold_at = new Date().toISOString()
    }
  }

  await supabase.from('external_listings').update(updateData).eq('id', listingId)

  if (vehicleId && (update.auction_end_date || update.current_bid)) {
    const vehicleUpdate: Record<string, any> = { updated_at: new Date().toISOString() }
    if (update.auction_end_date) vehicleUpdate.auction_end_date = update.auction_end_date
    if (update.current_bid) vehicleUpdate.asking_price = update.current_bid
    if (update.auction_status === 'sold') {
      vehicleUpdate.sale_price = update.current_bid
      vehicleUpdate.auction_outcome = 'sold'
    }
    await supabase.from('vehicles').update(vehicleUpdate).eq('id', vehicleId)
  }
}

async function monitorListing(url: string, firecrawlKey: string | undefined): Promise<MonitorResult | null> {
  try {
    let html = ''

    // Collecting Cars uses React/Next.js, so we need JS rendering
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
          waitFor: 3000,
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
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      })
      html = await response.text()
    }

    const result: MonitorResult = {
      current_bid: null,
      bid_count: null,
      watcher_count: null,
      auction_status: null,
      auction_end_date: null,
      reserve_met: null,
      last_checked_at: new Date().toISOString(),
    }

    // Extract current bid - Collecting Cars uses GBP primarily
    const bidPatterns = [
      /Current\s+(?:Bid|bid)[:\s]*[£$€]?([\d,]+)/i,
      /High\s+(?:Bid|bid)[:\s]*[£$€]?([\d,]+)/i,
      /Winning\s+(?:Bid|bid)[:\s]*[£$€]?([\d,]+)/i,
      /"currentBid"[:\s]*[£$€]?([\d,]+)/i,
      /"highestBid"[:\s]*[£$€]?([\d,]+)/i,
      /Sold\s+for[:\s]*[£$€]?([\d,]+)/i,
      /Hammer\s+Price[:\s]*[£$€]?([\d,]+)/i,
    ]

    for (const pattern of bidPatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        result.current_bid = parseInt(match[1].replace(/,/g, ''), 10)
        break
      }
    }

    // Extract bid count
    const bidCountMatch = html.match(/(\d+)\s+bids?/i) ||
                          html.match(/"bidCount"[:\s]*(\d+)/i)
    if (bidCountMatch) {
      result.bid_count = parseInt(bidCountMatch[1], 10)
    }

    // Extract watcher count
    const watcherMatch = html.match(/(\d+)\s+watch(?:ers?|ing)/i) ||
                         html.match(/"watcherCount"[:\s]*(\d+)/i)
    if (watcherMatch) {
      result.watcher_count = parseInt(watcherMatch[1], 10)
    }

    // Extract reserve status
    result.reserve_met = html.toLowerCase().includes('reserve met') ||
                         html.toLowerCase().includes('no reserve')

    // Extract auction status
    const htmlLower = html.toLowerCase()
    if (htmlLower.includes('sold for') || htmlLower.includes('hammer price') || htmlLower.includes('winning bid')) {
      result.auction_status = 'sold'
    } else if (htmlLower.includes('not sold') || htmlLower.includes('no sale') || htmlLower.includes('reserve not met')) {
      result.auction_status = 'ended'
    } else if (htmlLower.includes('auction ended') || htmlLower.includes('bidding closed')) {
      result.auction_status = 'ended'
    } else if (htmlLower.includes('live now') || htmlLower.includes('bidding open') || htmlLower.includes('place bid') || htmlLower.includes('bid now')) {
      result.auction_status = 'active'
    }

    // Extract auction end date - multiple patterns
    // Pattern 1: Unix timestamp
    const timestampMatch = html.match(/data-end(?:-time)?[="'\s]+(\d{10,13})/i) ||
                          html.match(/"endTime"[:\s]*(\d{10,13})/i) ||
                          html.match(/"endsAt"[:\s]*(\d{10,13})/i) ||
                          html.match(/"auctionEnd"[:\s]*(\d{10,13})/i)
    if (timestampMatch) {
      const ts = parseInt(timestampMatch[1], 10)
      const timestamp = ts > 9999999999 ? ts : ts * 1000
      result.auction_end_date = new Date(timestamp).toISOString()
    }

    // Pattern 2: ISO date string
    if (!result.auction_end_date) {
      const isoMatch = html.match(/"endDate"[:\s]*"([^"]+)"/i) ||
                       html.match(/"endsAt"[:\s]*"([^"]+)"/i) ||
                       html.match(/"auctionEndDate"[:\s]*"([^"]+)"/i) ||
                       html.match(/Ends?[:\s]+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/i)
      if (isoMatch) {
        try {
          const parsed = new Date(isoMatch[1])
          if (!isNaN(parsed.getTime())) {
            result.auction_end_date = parsed.toISOString()
          }
        } catch { /* ignore */ }
      }
    }

    // Pattern 3: Countdown text like "Ends in 2d 5h" or "1 day 3 hours"
    if (!result.auction_end_date) {
      const countdownMatch = html.match(/(?:ends?\s+in|time\s+left)[:\s]*(\d+)\s*d(?:ays?)?\s*(\d+)\s*h(?:ours?)?/i) ||
                             html.match(/(\d+)\s*days?\s*(\d+)\s*hours?\s*(?:remaining|left)/i)
      if (countdownMatch) {
        const days = parseInt(countdownMatch[1], 10) || 0
        const hours = parseInt(countdownMatch[2], 10) || 0
        const now = new Date()
        now.setDate(now.getDate() + days)
        now.setHours(now.getHours() + hours)
        result.auction_end_date = now.toISOString()
      }
    }

    // Pattern 4: Hours only
    if (!result.auction_end_date) {
      const hoursMatch = html.match(/(?:ends?\s+in|time\s+left)[:\s]*(\d+)\s*h(?:ours?)?/i) ||
                         html.match(/(\d+)\s*hours?\s*(?:remaining|left)/i)
      if (hoursMatch) {
        const hours = parseInt(hoursMatch[1], 10) || 0
        const now = new Date()
        now.setHours(now.getHours() + hours)
        result.auction_end_date = now.toISOString()
      }
    }

    return result
  } catch (error: any) {
    console.error(`Error monitoring listing ${url}:`, error.message)
    return null
  }
}
