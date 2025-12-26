// Monitor SBX Cars listings for updates (bids, status changes, etc.)
// Designed to run periodically on existing vehicles from SBX Cars

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, discovery_url, asking_price, auction_end_date')
      .eq('discovery_source', 'sbxcars')
      .or('auction_end_date.is.null,auction_end_date.gt.' + new Date().toISOString())
      .limit(batch_size)

    if (!vehicles || vehicles.length === 0) {
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

    for (const vehicle of vehicles) {
      if (!vehicle.discovery_url) continue

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

    return {
      current_bid: currentBid,
      sale_price: salePrice,
      auction_status: auctionStatus,
      auction_end_date: null, // Could extract if needed
      last_checked_at: new Date().toISOString(),
    }
  } catch (error: any) {
    console.error(`Error monitoring listing ${url}:`, error.message)
    return null
  }
}

