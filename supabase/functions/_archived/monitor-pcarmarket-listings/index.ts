// Monitor PCarMarket listings for updates (bids, status changes, end dates)
// Designed to run periodically on existing external_listings from PCarMarket

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface MonitorResult {
  current_bid: number | null;
  bid_count: number | null;
  view_count: number | null;
  auction_status: string | null;
  auction_end_date: string | null;
  seller_username: string | null;
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

    // If specific listing provided, monitor just that one
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
        const updateData: Record<string, any> = {
          updated_at: new Date().toISOString(),
        }
        if (update.current_bid !== null) updateData.current_bid = update.current_bid
        if (update.bid_count !== null) updateData.bid_count = update.bid_count
        if (update.view_count !== null) updateData.view_count = update.view_count
        if (update.auction_end_date) updateData.end_date = update.auction_end_date
        if (update.auction_status) {
          updateData.listing_status = update.auction_status === 'sold' ? 'sold' :
                                      update.auction_status === 'ended' ? 'ended' : 'active'
          if (update.auction_status === 'sold' && update.current_bid) {
            updateData.final_price = update.current_bid
            updateData.sold_at = new Date().toISOString()
          }
        }

        await supabase
          .from('external_listings')
          .update(updateData)
          .eq('id', listing_id)
      }

      return new Response(
        JSON.stringify({
          success: true,
          update,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // Batch mode: monitor all active PCarMarket listings
    const { data: listings } = await supabase
      .from('external_listings')
      .select('id, vehicle_id, listing_url, end_date, current_bid, listing_status')
      .eq('platform', 'pcarmarket')
      .in('listing_status', ['active', 'live', 'upcoming'])
      .order('updated_at', { ascending: true })
      .limit(batch_size)

    if (!listings || listings.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          stats: { checked: 0, updated: 0 },
          message: 'No active PCarMarket listings to monitor',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    const stats = {
      checked: 0,
      updated: 0,
      errors: 0,
    }

    const results: any[] = []

    for (const listing of listings) {
      if (!listing.listing_url) continue

      try {
        const update = await monitorListing(listing.listing_url, firecrawlKey)

        if (update) {
          const updateData: Record<string, any> = {
            updated_at: new Date().toISOString(),
          }

          if (update.current_bid !== null) updateData.current_bid = update.current_bid
          if (update.bid_count !== null) updateData.bid_count = update.bid_count
          if (update.view_count !== null) updateData.view_count = update.view_count
          if (update.auction_end_date) updateData.end_date = update.auction_end_date
          if (update.auction_status) {
            updateData.listing_status = update.auction_status === 'sold' ? 'sold' :
                                        update.auction_status === 'ended' ? 'ended' : 'active'
            if (update.auction_status === 'sold' && update.current_bid) {
              updateData.final_price = update.current_bid
              updateData.sold_at = new Date().toISOString()
            }
          }

          await supabase
            .from('external_listings')
            .update(updateData)
            .eq('id', listing.id)

          // Also update vehicles table if we have vehicle_id
          if (listing.vehicle_id && (update.auction_end_date || update.current_bid)) {
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
              .eq('id', listing.vehicle_id)
          }

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
        await new Promise(resolve => setTimeout(resolve, 1500)) // Rate limit
      } catch (error: any) {
        console.error(`Error monitoring ${listing.listing_url}:`, error.message)
        stats.errors++
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        stats,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error: any) {
    console.error('Error in monitor-pcarmarket-listings:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || String(error),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})

async function monitorListing(url: string, firecrawlKey: string | undefined): Promise<MonitorResult | null> {
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
      view_count: null,
      auction_status: null,
      auction_end_date: null,
      seller_username: null,
      last_checked_at: new Date().toISOString(),
    }

    // Extract current bid - multiple patterns for PCarMarket
    const bidPatterns = [
      /Current bid:\s*\$?([\d,]+)/i,
      /High bid:\s*\$?([\d,]+)/i,
      /Final bid:\s*\$?([\d,]+)/i,
      /Winning bid:\s*\$?([\d,]+)/i,
      /"currentBid"\s*:\s*"?\$?([\d,]+)"?/i,
      /"highBid"\s*:\s*"?\$?([\d,]+)"?/i,
    ]

    for (const pattern of bidPatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        result.current_bid = parseInt(match[1].replace(/,/g, ''), 10)
        break
      }
    }

    // Extract bid count
    const bidCountMatch = html.match(/([\d,]+)\s+bids?/i) ||
                          html.match(/bid count[:\s]*([\d,]+)/i)
    if (bidCountMatch) {
      result.bid_count = parseInt(bidCountMatch[1].replace(/,/g, ''), 10)
    }

    // Extract view count
    const viewCountMatch = html.match(/([\d,]+)\s+views?/i)
    if (viewCountMatch) {
      result.view_count = parseInt(viewCountMatch[1].replace(/,/g, ''), 10)
    }

    // Extract auction status
    const htmlLower = html.toLowerCase()
    if (htmlLower.includes('sold for') || htmlLower.includes('winning bid') || htmlLower.includes('auction ended')) {
      if (htmlLower.includes('sold') || htmlLower.includes('winning bid')) {
        result.auction_status = 'sold'
      } else {
        result.auction_status = 'ended'
      }
    } else if (htmlLower.includes('reserve not met') && htmlLower.includes('ended')) {
      result.auction_status = 'ended'
    } else if (htmlLower.includes('active') || htmlLower.includes('bid now') || htmlLower.includes('place bid')) {
      result.auction_status = 'active'
    }

    // Extract auction end date
    // Pattern 1: data-countdown or data-end attributes (Unix timestamp)
    const countdownMatch = html.match(/data-countdown\s*=\s*["'](\d+)["']/i) ||
                          html.match(/data-end-time\s*=\s*["'](\d+)["']/i) ||
                          html.match(/data-end\s*=\s*["'](\d+)["']/i) ||
                          html.match(/data-auction-end\s*=\s*["'](\d+)["']/i)
    if (countdownMatch) {
      const ts = parseInt(countdownMatch[1], 10)
      const timestamp = ts > 9999999999 ? ts : ts * 1000
      result.auction_end_date = new Date(timestamp).toISOString()
    }

    // Pattern 2: ISO date string in JSON or attributes
    if (!result.auction_end_date) {
      const isoDateMatch = html.match(/"endDate"\s*:\s*"([^"]+)"/i) ||
                          html.match(/"end_date"\s*:\s*"([^"]+)"/i) ||
                          html.match(/"auctionEnd"\s*:\s*"([^"]+)"/i) ||
                          html.match(/data-end-date\s*=\s*["']([^"']+)["']/i)
      if (isoDateMatch) {
        try {
          const parsed = new Date(isoDateMatch[1])
          if (!isNaN(parsed.getTime())) {
            result.auction_end_date = parsed.toISOString()
          }
        } catch { /* ignore */ }
      }
    }

    // Pattern 3: Time remaining text
    if (!result.auction_end_date) {
      const timeMatch = html.match(/(\d+)\s*days?\s*(?:,?\s*(\d+)\s*hours?)?(?:\s+(?:remaining|left))?/i) ||
                        html.match(/(\d+)\s*hours?(?:\s*,?\s*(\d+)\s*min(?:ute)?s?)?(?:\s+(?:remaining|left))?/i)
      if (timeMatch) {
        const now = new Date()
        const firstNum = parseInt(timeMatch[1], 10) || 0
        const secondNum = parseInt(timeMatch[2], 10) || 0

        if (/hours?/i.test(timeMatch[0].split(/\d+/)[1] || '')) {
          // First number is hours
          now.setHours(now.getHours() + firstNum)
          now.setMinutes(now.getMinutes() + secondNum)
        } else {
          // First number is days
          now.setDate(now.getDate() + firstNum)
          now.setHours(now.getHours() + secondNum)
        }
        result.auction_end_date = now.toISOString()
      }
    }

    // Extract seller username
    const sellerMatch = html.match(/seller[:\s]+([a-zA-Z0-9_-]+)/i) ||
                        html.match(/listed by[:\s]+([a-zA-Z0-9_-]+)/i) ||
                        html.match(/member\/([a-zA-Z0-9_-]+)/i)
    if (sellerMatch) {
      result.seller_username = sellerMatch[1]
    }

    return result
  } catch (error: any) {
    console.error(`Error monitoring listing ${url}:`, error.message)
    return null
  }
}
