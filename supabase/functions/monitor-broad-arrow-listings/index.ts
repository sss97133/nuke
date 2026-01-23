// Monitor Broad Arrow auction listings for updates (bids, status, end dates)
// Broad Arrow is a traditional auction house with timed online bidding

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MonitorResult {
  current_bid: number | null;
  estimate_low: number | null;
  estimate_high: number | null;
  lot_number: string | null;
  auction_status: string | null;
  auction_end_date: string | null;
  auction_name: string | null;
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
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
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

        if (listing) {
          url = listing.listing_url
        }
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

    // Batch mode: monitor all active Broad Arrow listings
    const { data: listings } = await supabase
      .from('external_listings')
      .select('id, vehicle_id, listing_url, end_date, current_bid, listing_status')
      .eq('platform', 'broad_arrow')
      .in('listing_status', ['active', 'live', 'upcoming'])
      .order('updated_at', { ascending: true })
      .limit(batch_size)

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { checked: 0, updated: 0 },
          message: 'No active Broad Arrow listings to monitor',
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
    console.error('Error in monitor-broad-arrow-listings:', error)
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
  if (update.auction_end_date) updateData.end_date = update.auction_end_date
  if (update.auction_status) {
    updateData.listing_status = update.auction_status === 'sold' ? 'sold' :
                                update.auction_status === 'ended' ? 'ended' : 'active'
    if (update.auction_status === 'sold' && update.current_bid) {
      updateData.final_price = update.current_bid
      updateData.sold_at = new Date().toISOString()
    }
  }

  // Store estimate in metadata
  if (update.estimate_low || update.estimate_high || update.lot_number || update.auction_name) {
    const { data: existing } = await supabase
      .from('external_listings')
      .select('metadata')
      .eq('id', listingId)
      .single()

    updateData.metadata = {
      ...(existing?.metadata || {}),
      estimate_low: update.estimate_low,
      estimate_high: update.estimate_high,
      lot_number: update.lot_number,
      auction_name: update.auction_name,
      last_checked_at: update.last_checked_at,
    }
  }

  await supabase
    .from('external_listings')
    .update(updateData)
    .eq('id', listingId)

  // Also update vehicles table if we have vehicle_id
  if (vehicleId && (update.auction_end_date || update.current_bid)) {
    const vehicleUpdate: Record<string, any> = {
      updated_at: new Date().toISOString(),
    }
    if (update.auction_end_date) vehicleUpdate.auction_end_date = update.auction_end_date
    if (update.current_bid) vehicleUpdate.asking_price = update.current_bid
    if (update.auction_status === 'sold') {
      vehicleUpdate.sale_price = update.current_bid
      vehicleUpdate.auction_outcome = 'sold'
    }

    await supabase
      .from('vehicles')
      .update(vehicleUpdate)
      .eq('id', vehicleId)
  }
}

async function monitorListing(url: string, firecrawlKey: string | undefined): Promise<MonitorResult | null> {
  try {
    let html = ''

    // Broad Arrow uses Next.js, so we need JS rendering via Firecrawl
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
      estimate_low: null,
      estimate_high: null,
      lot_number: null,
      auction_status: null,
      auction_end_date: null,
      auction_name: null,
      last_checked_at: new Date().toISOString(),
    }

    // Extract current bid - Broad Arrow patterns
    const bidPatterns = [
      /Current\s+Bid[:\s]*\$?([\d,]+)/i,
      /High\s+Bid[:\s]*\$?([\d,]+)/i,
      /Winning\s+Bid[:\s]*\$?([\d,]+)/i,
      /"currentBid"[:\s]*"?\$?([\d,]+)"?/i,
      /"highBid"[:\s]*"?\$?([\d,]+)"?/i,
      /Sold\s+for[:\s]*\$?([\d,]+)/i,
    ]

    for (const pattern of bidPatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        result.current_bid = parseInt(match[1].replace(/,/g, ''), 10)
        break
      }
    }

    // Extract estimate range
    const estimateMatch = html.match(/Estimate[:\s]*\$?([\d,]+)\s*[-–—]\s*\$?([\d,]+)/i) ||
                          html.match(/"estimateLow"[:\s]*"?\$?([\d,]+)"?.*?"estimateHigh"[:\s]*"?\$?([\d,]+)"?/i)
    if (estimateMatch) {
      result.estimate_low = parseInt(estimateMatch[1].replace(/,/g, ''), 10)
      result.estimate_high = parseInt(estimateMatch[2].replace(/,/g, ''), 10)
    }

    // Extract lot number
    const lotMatch = html.match(/Lot\s+#?(\d+)/i) ||
                     html.match(/"lotNumber"[:\s]*"?(\d+)"?/i)
    if (lotMatch) {
      result.lot_number = lotMatch[1]
    }

    // Extract auction name from URL or page
    const urlMatch = url.match(/\/vehicles\/([a-z]+\d+)/i)
    if (urlMatch) {
      // Decode auction code: ve26 = Velocity 2026, gi26 = Greenwich 2026, am26 = Amelia 2026
      const code = urlMatch[1].toLowerCase()
      if (code.startsWith('ve')) result.auction_name = `Velocity ${code.slice(2)}`
      else if (code.startsWith('gi')) result.auction_name = `Greenwich ${code.slice(2)}`
      else if (code.startsWith('am')) result.auction_name = `Amelia Island ${code.slice(2)}`
      else result.auction_name = code
    }

    // Extract auction status
    const htmlLower = html.toLowerCase()
    if (htmlLower.includes('sold for') || htmlLower.includes('winning bid')) {
      result.auction_status = 'sold'
    } else if (htmlLower.includes('not sold') || htmlLower.includes('no sale') || htmlLower.includes('passed')) {
      result.auction_status = 'ended'
    } else if (htmlLower.includes('bidding closed') || htmlLower.includes('auction ended')) {
      result.auction_status = 'ended'
    } else if (htmlLower.includes('live now') || htmlLower.includes('bidding open') || htmlLower.includes('place bid')) {
      result.auction_status = 'active'
    } else if (htmlLower.includes('coming soon') || htmlLower.includes('upcoming')) {
      result.auction_status = 'upcoming'
    }

    // Extract auction end date
    // Pattern 1: Unix timestamp in data attributes or JSON
    const timestampMatch = html.match(/data-end-time[="'\s]+(\d{10,13})/i) ||
                          html.match(/"endTime"[:\s]*(\d{10,13})/i) ||
                          html.match(/"auctionEnd"[:\s]*(\d{10,13})/i)
    if (timestampMatch) {
      const ts = parseInt(timestampMatch[1], 10)
      const timestamp = ts > 9999999999 ? ts : ts * 1000
      result.auction_end_date = new Date(timestamp).toISOString()
    }

    // Pattern 2: ISO date string
    if (!result.auction_end_date) {
      const isoMatch = html.match(/"endDate"[:\s]*"([^"]+)"/i) ||
                       html.match(/"auctionEndDate"[:\s]*"([^"]+)"/i) ||
                       html.match(/Auction\s+Ends?[:\s]+(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2})/i)
      if (isoMatch) {
        try {
          const parsed = new Date(isoMatch[1])
          if (!isNaN(parsed.getTime())) {
            result.auction_end_date = parsed.toISOString()
          }
        } catch { /* ignore */ }
      }
    }

    // Pattern 3: Human readable date like "January 25, 2026"
    if (!result.auction_end_date) {
      const dateMatch = html.match(/Auction\s+(?:Date|Ends?)[:\s]*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i) ||
                        html.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i)
      if (dateMatch) {
        try {
          const dateStr = `${dateMatch[1]} ${dateMatch[2]}, ${dateMatch[3]}`
          const parsed = new Date(dateStr)
          if (!isNaN(parsed.getTime())) {
            // Default to end of day for auction dates
            parsed.setHours(23, 59, 59)
            result.auction_end_date = parsed.toISOString()
          }
        } catch { /* ignore */ }
      }
    }

    return result
  } catch (error: any) {
    console.error(`Error monitoring listing ${url}:`, error.message)
    return null
  }
}
