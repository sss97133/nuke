/**
 * EXTRACT AUCTION COMMENTS
 * Pulls all comments from a BaT auction and analyzes them
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    )

    const { auction_url, auction_event_id, vehicle_id } = await req.json()
    if (!auction_url) throw new Error('Missing auction_url')

    console.log(`Extracting comments from: ${auction_url}`)

    // Resolve auction_event_id if caller didn't provide it (best-effort convenience).
    const platformGuess = String(auction_url).includes('bringatrailer.com') ? 'bat' : null
    let eventId: string | null = auction_event_id ? String(auction_event_id) : null
    if (!eventId && platformGuess) {
      const { data: ev } = await supabase
        .from('auction_events')
        .select('id')
        .eq('platform', platformGuess)
        .eq('listing_url', String(auction_url))
        .limit(1)
        .maybeSingle()
      if (ev?.id) eventId = String(ev.id)
    }
    if (!eventId) throw new Error('Missing auction_event_id (and could not resolve by listing_url)')

    // Resolve vehicle_id for UI filters + auction pulse; prefer explicit input, else read from auction_events.
    let vehicleId: string | null = vehicle_id ? String(vehicle_id) : null
    if (!vehicleId) {
      const { data: ev2 } = await supabase
        .from('auction_events')
        .select('vehicle_id')
        .eq('id', eventId)
        .maybeSingle()
      if (ev2?.vehicle_id) vehicleId = String(ev2.vehicle_id)
    }

    // Use Firecrawl to get JavaScript-rendered page
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
    let html = ''
    
    if (firecrawlKey) {
      const fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${firecrawlKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url: auction_url,
          waitFor: 3000,
          formats: ['html']
        })
      })
      
      if (fcResp.ok) {
        const fcData = await fcResp.json()
        html = fcData.data?.html || ''
      }
    }
    
    // Fallback to direct fetch if Firecrawl fails
    if (!html) {
      const response = await fetch(auction_url)
      html = await response.text()
    }
    
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (!doc) throw new Error('Failed to parse HTML (DOMParser returned null)')

    // Extract auction metadata
    const auctionEndMatch = html.match(/Auction ended?[:\s]+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
    const auctionEndDate = auctionEndMatch ? new Date(auctionEndMatch[1]) : new Date()

    // Extract all comments
    const commentElements = doc.querySelectorAll('.comment')
    const comments = []
    const authorSet = new Set<string>()
    
    for (let i = 0; i < commentElements.length; i++) {
      const el = commentElements[i]
      
      // Extract fields
      const dateText = el.querySelector('.comment-datetime')?.textContent?.trim() || ''
      const authorEl = el.querySelector('[data-bind*="authorName"]')
      const authorRaw = authorEl?.textContent?.trim() || 'Unknown'
      // Normalize to a stable BaT handle key for attribution + future claiming.
      const author = String(authorRaw).trim()
      const textEl = el.querySelector('p')
      const text = textEl?.textContent?.trim() || ''
      
      if (!text) continue // Skip empty
      
      // Parse date (format: "Nov 21 at 3:38 PM")
      const posted_at = parseBaTDate(dateText, auctionEndDate)
      const hours_until_close = (auctionEndDate.getTime() - posted_at.getTime()) / (1000 * 60 * 60)
      
      // Detect comment type
      const isSeller = el.classList.contains('bat_seller_comment')
      const isBid = text.includes('bid placed by')
      const isSold = text.includes('Sold on') || text.includes('sold for')
      
      const comment_type = 
        isSold ? 'sold' :
        isBid ? 'bid' :
        isSeller ? 'seller_response' :
        text.includes('?') ? 'question' :
        'observation'
      
      // Extract bid amount
      const bidMatch = text.match(/\$([0-9,]+)\s+bid placed by/)
      const bid_amount = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, '')) : null
      
      // Extract likes
      const authorLikesEl = el.querySelector('.total-likes')
      const authorLikes = extractNumber(authorLikesEl?.textContent)
      
      const commentLikesEl = el.querySelector('.comment-actions-approve')
      const commentLikes = extractNumber(commentLikesEl?.textContent)
      
      // Media detection
      const has_video = text.toLowerCase().includes('cold start') || text.toLowerCase().includes('video')
      const has_image = el.querySelector('img') !== null
      
      comments.push({
        auction_event_id: eventId,
        vehicle_id: vehicleId,
        sequence_number: i + 1,
        posted_at: posted_at.toISOString(),
        hours_until_close: Math.max(0, hours_until_close),
        author_username: author,
        is_seller: isSeller,
        author_total_likes: authorLikes,
        comment_type,
        comment_text: text,
        word_count: text.split(/\s+/).length,
        has_question: text.includes('?'),
        has_media: has_video || has_image,
        bid_amount,
        comment_likes: commentLikes
      })

      if (author && author !== 'Unknown') {
        authorSet.add(author)
      }
    }

    console.log(`Extracted ${comments.length} comments`)

    // Upsert external identities (platform + handle) so later humans can claim/merge them.
    // NOTE: This function runs with service role key, so it can write to external_identities.
    const handleToExternalIdentityId = new Map<string, string>()
    if (authorSet.size > 0) {
      const nowIso = new Date().toISOString()
      const rows = Array.from(authorSet).map((h) => ({
        platform: 'bat',
        // Use the handle as seen on BaT. (We keep it as-is for display; uniqueness is platform+handle.)
        handle: h,
        last_seen_at: nowIso,
        updated_at: nowIso,
      }))

      // Idempotent upsert
      const { data: upserted, error: upsertErr } = await supabase
        .from('external_identities')
        .upsert(rows, { onConflict: 'platform,handle' })
        .select('id, handle')

      if (upsertErr) {
        console.warn('Failed to upsert external identities (non-fatal):', upsertErr)
      } else {
        ;(upserted || []).forEach((r: any) => {
          if (r?.handle && r?.id) handleToExternalIdentityId.set(String(r.handle), String(r.id))
        })
      }
    }

    // Attach external identity IDs to comments when possible.
    const commentsWithIdentities = comments.map((c: any) => ({
      ...c,
      external_identity_id: handleToExternalIdentityId.get(String(c.author_username)) || null,
    }))

    // Store comments
    if (comments.length > 0) {
      const { error } = await supabase
        .from('auction_comments')
        .upsert(commentsWithIdentities, { onConflict: 'auction_event_id,sequence_number' })
      
      if (error) throw error
    }

    // Trigger AI analysis on comments (async, don't wait)
    if (comments.length > 0) {
      const anonJwt = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? ''
      const inboundAuth = req.headers.get('Authorization') || ''
      const authToUse = inboundAuth || (anonJwt.startsWith('eyJ') ? `Bearer ${anonJwt}` : '')
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze-auction-comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // analyze-auction-comments is deployed with verify_jwt enabled.
          ...(authToUse ? { 'Authorization': authToUse } : {})
        },
        body: JSON.stringify({ auction_event_id })
      }).catch(e => console.error('Failed to trigger analysis:', e))
    }

    return new Response(JSON.stringify({
      success: true,
      comments_extracted: comments.length,
      auction_event_id: eventId,
      vehicle_id: vehicleId
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function parseBaTDate(dateStr: string, referenceDate: Date): Date {
  // "Nov 21 at 3:38 PM" -> actual date
  const match = dateStr.match(/([A-Za-z]+)\s+(\d+)\s+at\s+(\d+):(\d+)\s+(AM|PM)/)
  if (!match) return new Date()
  
  const [, month, day, hour, minute, ampm] = match
  const year = referenceDate.getFullYear()
  
  const date = new Date(`${month} ${day}, ${year}`)
  let hours = parseInt(hour)
  if (ampm === 'PM' && hours !== 12) hours += 12
  if (ampm === 'AM' && hours === 12) hours = 0
  
  date.setHours(hours, parseInt(minute))
  return date
}

function extractNumber(text: string | null | undefined): number {
  if (!text) return 0
  const match = text.match(/(\d+)/)
  return match ? parseInt(match[1]) : 0
}

