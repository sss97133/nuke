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

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.search = '';
    if (!u.pathname.endsWith('/')) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    return String(raw).split('#')[0].split('?')[0];
  }
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

    const auctionUrlRaw = String(auction_url)
    const auctionUrlNorm = normalizeUrl(auctionUrlRaw)
    const auctionUrlAlt = auctionUrlNorm.endsWith('/') ? auctionUrlNorm.slice(0, -1) : `${auctionUrlNorm}/`
    const urlCandidates = Array.from(new Set([auctionUrlRaw, auctionUrlNorm, auctionUrlAlt].filter(Boolean)))

    console.log(`Extracting comments from: ${auctionUrlNorm}`)

    // Resolve auction_event_id if caller didn't provide it (best-effort convenience).
    const platformGuess = auctionUrlNorm.includes('bringatrailer.com') ? 'bat' : null
    let eventId: string | null = auction_event_id ? String(auction_event_id) : null
    if (!eventId && platformGuess) {
      const { data: ev } = await supabase
        .from('auction_events')
        .select('id')
        .eq('source', platformGuess)
        .in('source_url', urlCandidates)
        .limit(1)
        .maybeSingle()
      if (ev?.id) eventId = String(ev.id)
    }
    if (!eventId) {
      console.warn('Missing auction_event_id (and could not resolve by listing_url) - proceeding without auction_event_id')
    }

    // Resolve vehicle_id for UI filters + auction pulse; prefer explicit input, else read from auction_events.
    let vehicleId: string | null = vehicle_id ? String(vehicle_id) : null
    if (!vehicleId && eventId) {
      const { data: ev2 } = await supabase
        .from('auction_events')
        .select('vehicle_id')
        .eq('id', eventId)
        .maybeSingle()
      if (ev2?.vehicle_id) vehicleId = String(ev2.vehicle_id)
    }
    if (!vehicleId && platformGuess === 'bat') {
      const { data: ext } = await supabase
        .from('external_listings')
        .select('vehicle_id')
        .eq('platform', 'bat')
        .in('listing_url', urlCandidates)
        .limit(1)
        .maybeSingle()
      if (ext?.vehicle_id) vehicleId = String(ext.vehicle_id)
    }
    if (!vehicleId && platformGuess === 'bat') {
      const { data: v1 } = await supabase
        .from('vehicles')
        .select('id')
        .in('bat_auction_url', urlCandidates)
        .limit(1)
        .maybeSingle()
      if (v1?.id) vehicleId = String(v1.id)
    }
    if (!vehicleId && platformGuess === 'bat') {
      const { data: v2 } = await supabase
        .from('vehicles')
        .select('id')
        .in('discovery_url', urlCandidates)
        .limit(1)
        .maybeSingle()
      if (v2?.id) vehicleId = String(v2.id)
    }
    if (!vehicleId) throw new Error('Missing vehicle_id (and could not resolve by auction_event_id, external_listings, or vehicles URLs)')

    // Use Firecrawl to get JavaScript-rendered page (REQUIRED for BaT comments)
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY')
    if (!firecrawlKey) {
      throw new Error('FIRECRAWL_API_KEY is required for comment extraction. BaT pages require JavaScript rendering.')
    }
    
    console.log('🔥 Using Firecrawl to fetch BaT page with JS rendering...')
    const fcResp = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: auctionUrlNorm,
        formats: ['html'],
        onlyMainContent: false,
        waitFor: 8000, // Give JS time to render BaT's dynamic comments
        actions: [
          {
            type: 'wait',
            milliseconds: 2000 // Initial page load
          },
          {
            type: 'scroll',
            direction: 'down',
            pixels: 3000 // Scroll to trigger lazy loading of comments
          },
          {
            type: 'wait',
            milliseconds: 3000 // Wait for comments to load after scroll
          }
        ]
      }),
      signal: AbortSignal.timeout(60000) // 60 second timeout
    })
    
    if (!fcResp.ok) {
      const errorText = await fcResp.text().catch(() => '')
      throw new Error(`Firecrawl API error ${fcResp.status}: ${errorText.slice(0, 200)}`)
    }
    
    const fcData = await fcResp.json()
    if (!fcData.success) {
      throw new Error(`Firecrawl failed: ${fcData.error || JSON.stringify(fcData).slice(0, 200)}`)
    }
    
    const html = fcData.data?.html || ''
    if (!html) {
      throw new Error('Firecrawl returned no HTML content')
    }
    
    console.log(`✅ Firecrawl returned ${html.length} characters of HTML`)
    
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (!doc) throw new Error('Failed to parse HTML (DOMParser returned null)')

    // Extract auction metadata
    const auctionEndMatch = html.match(/Auction ended?[:\s]+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
    const auctionEndDate = auctionEndMatch ? new Date(auctionEndMatch[1]) : new Date()

    // Extract all comments - try multiple selectors for robustness
    let commentElements = doc.querySelectorAll('.comment')
    if (commentElements.length === 0) {
      // Fallback: look for comment-like structures in comments-javascript-enabled
      const commentsContainer = doc.querySelector('#comments-javascript-enabled')
      if (commentsContainer) {
        // Try to find individual comment blocks by looking for patterns
        commentElements = commentsContainer.querySelectorAll('[data-cursor-element-id]')
      }
    }
    
    const comments = []
    const authorSet = new Set<string>()
    const authorProfileUrls = new Map<string, string>() // Map author username to profile URL
    
    for (let i = 0; i < commentElements.length; i++) {
      const el = commentElements[i]
      
      // Extract fields - try multiple patterns
      let dateText = el.querySelector('.comment-datetime')?.textContent?.trim() || ''
      
      // Try to find author link first (most reliable)
      const authorLink = el.querySelector('a[href*="/member/"]') as HTMLAnchorElement | null
      let authorRaw = authorLink?.textContent?.trim() || ''
      
      // If no author link, try other selectors
      if (!authorRaw) {
        const authorEl = el.querySelector('[data-bind*="authorName"]') || el.querySelector('.comment-user-name')
        authorRaw = authorEl?.textContent?.trim() || ''
      }
      
      // If still no author, try to extract from text content patterns
      const fullText = el.textContent || ''
      if (!authorRaw && fullText) {
        // Try patterns like "12/27/24 at 6:01 PM Username" or "Username This author's likes:"
        const authorMatch = fullText.match(/(\d{1,2}\/\d{1,2}\/\d{2,4}\s+at\s+\d{1,2}:\d{2}\s+[AP]M)\s+([A-Za-z0-9_]+)/i)
        if (authorMatch) {
          dateText = authorMatch[1]
          authorRaw = authorMatch[2]
        } else {
          // Fallback: look for username before "This author's likes:"
          const authorMatch2 = fullText.match(/([A-Za-z0-9_]+)\s+This author's likes:/i)
          if (authorMatch2) authorRaw = authorMatch2[1]
        }
      }
      
      // Clean up author name (remove "The Seller" suffix, etc) - but keep original for profile URL lookup
      const authorClean = authorRaw.replace(/\s*\(The\s+Seller\)/i, '').trim()
      
      // Normalize to a stable BaT handle key for attribution + future claiming.
      const author = String(authorClean).trim() || 'Unknown'
      
      // Extract profile URL from author link if available
      if (authorLink && author && author !== 'Unknown' && author.length > 0) {
        const href = authorLink.getAttribute('href') || ''
        if (href) {
          const profileUrl = href.startsWith('http') ? href : `https://bringatrailer.com${href}`
          authorProfileUrls.set(author, profileUrl)
          // Also map original if different and not empty
          const originalTrimmed = authorRaw.trim()
          if (originalTrimmed && originalTrimmed !== author) {
            authorProfileUrls.set(originalTrimmed, profileUrl)
          }
        }
      }
      
      // Extract text - try p tag first, then direct textContent
      let text = el.querySelector('p')?.textContent?.trim() || ''
      if (!text) {
        // Try to extract just the comment text, excluding metadata
        const textMatch = fullText.match(/This comment's likes:[\s\S]*?(.+?)(?:Flag as|$)/i)
        if (textMatch) {
          text = textMatch[1].trim()
        } else {
          // Last resort: use all text but remove common patterns
          text = fullText
            .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}\s+at\s+\d{1,2}:\d{2}\s+[AP]M/gi, '')
            .replace(/This author's likes:\s*\d+/gi, '')
            .replace(/This comment's likes:\s*\d+/gi, '')
            .replace(/Flag as not constructive/gi, '')
            .replace(/Keep me in this conversation via email/gi, '')
            .trim()
        }
      }
      
      if (!text || text.length < 3) continue // Skip empty or too short
      
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

      // Stable idempotency key (unique on (vehicle_id, content_hash) exists in DB).
      const content_hash = await sha256Hex(
        [
          'bat',
          String(auctionUrlNorm),
          String(i + 1),
          String(posted_at.toISOString()),
          String(author),
          String(text),
        ].join('|')
      )
      
      comments.push({
        auction_event_id: eventId,
        vehicle_id: vehicleId,
        platform: platformGuess,
        source_url: String(auctionUrlNorm),
        content_hash,
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

    // Upsert external identities (platform + handle) with profile URLs so later humans can claim/merge them.
    // NOTE: This function runs with service role key, so it can write to external_identities.
    const handleToExternalIdentityId = new Map<string, string>()
    if (authorSet.size > 0) {
      const nowIso = new Date().toISOString()
      const rows = Array.from(authorSet).map((h) => {
        // Clean handle for URL lookup (remove "The Seller" suffix)
        const cleanHandle = h.replace(/\s*\(The\s+Seller\)/i, '').trim()
        // Try to find profile URL for this handle
        const profileUrl = authorProfileUrls.get(h) || 
                          authorProfileUrls.get(cleanHandle) ||
                          `https://bringatrailer.com/member/${encodeURIComponent(cleanHandle)}`
        
        return {
          platform: 'bat',
          // Use the handle as seen on BaT. (We keep it as-is for display; uniqueness is platform+handle.)
          handle: h,
          profile_url: profileUrl,
          last_seen_at: nowIso,
          updated_at: nowIso,
        }
      })

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

    let batListingId: string | null = null
    try {
      const nowIso = new Date().toISOString()
      const { data: extListing } = await supabase
        .from('external_listings')
        .select('final_price, current_bid, listing_status, end_date, sold_at, listing_id')
        .eq('vehicle_id', vehicleId)
        .eq('platform', 'bat')
        .maybeSingle()

      const inferredHighBid = commentsWithIdentities
        .map((c: any) => (typeof c?.bid_amount === 'number' && Number.isFinite(c.bid_amount) ? c.bid_amount : null))
        .filter((n: any) => typeof n === 'number')
        .reduce((acc: number, n: number) => (n > acc ? n : acc), 0)

      const inferredFinalPrice =
        (typeof extListing?.final_price === 'number' && Number.isFinite(extListing.final_price) && extListing.final_price > 0)
          ? Math.floor(extListing.final_price)
          : null

      const inferredSaleDate = (() => {
        const t = extListing?.sold_at || extListing?.end_date || null
        if (!t) return null
        const d = new Date(t)
        if (!Number.isFinite(d.getTime())) return null
        return d.toISOString().split('T')[0]
      })()

      const inferredStatus = (() => {
        const s = String(extListing?.listing_status || '').toLowerCase()
        if (s === 'sold') return 'sold'
        if (s === 'active' || s === 'live') return 'active'
        if (s === 'ended' || s === 'complete' || s === 'completed') return 'ended'
        return null
      })()

      const listingPayload: any = {
        vehicle_id: vehicleId,
        bat_listing_url: String(auctionUrlNorm),
        bat_lot_number: extListing?.listing_id ? String(extListing.listing_id) : null,
        listing_status: inferredStatus || undefined,
        comment_count: commentsWithIdentities.length,
        bid_count: commentsWithIdentities.filter((c: any) => typeof c?.bid_amount === 'number' && Number.isFinite(c.bid_amount) && c.bid_amount > 0).length,
        sale_price: inferredFinalPrice,
        final_bid: inferredFinalPrice || (inferredHighBid > 0 ? Math.floor(inferredHighBid) : null),
        sale_date: inferredFinalPrice ? inferredSaleDate : null,
        auction_end_date: inferredSaleDate || undefined,
        last_updated_at: nowIso,
        updated_at: nowIso,
        raw_data: {
          source: 'extract-auction-comments',
          auction_event_id: eventId,
          last_extracted_at: nowIso,
        }
      }

      const { data: upsertedListing, error: upsertListingErr } = await supabase
        .from('bat_listings')
        .upsert(listingPayload, { onConflict: 'bat_listing_url' })
        .select('id')
        .single()
      if (!upsertListingErr && upsertedListing?.id) {
        batListingId = String(upsertedListing.id)
      }

      if (batListingId) {
        const batCommentRows = commentsWithIdentities.map((c: any) => ({
          bat_listing_id: batListingId,
          vehicle_id: vehicleId,
          bat_username: String(c.author_username || 'Unknown'),
          external_identity_id: c.external_identity_id,
          content_hash: c.content_hash,
          comment_text: String(c.comment_text || ''),
          comment_html: null,
          comment_timestamp: c.posted_at,
          scraped_at: nowIso,
          bat_comment_id: null,
          comment_url: null,
          is_seller_comment: !!c.is_seller,
          likes_count: typeof c.comment_likes === 'number' && Number.isFinite(c.comment_likes) ? Math.max(0, Math.floor(c.comment_likes)) : 0,
          replies_count: 0,
          parent_comment_id: null,
          updated_at: nowIso,
        }))

        await supabase
          .from('bat_comments')
          .upsert(batCommentRows, { onConflict: 'bat_listing_id,content_hash' })

        const bidRows = commentsWithIdentities
          .filter((c: any) => typeof c?.bid_amount === 'number' && Number.isFinite(c.bid_amount) && c.bid_amount > 0)
          .map((c: any) => ({
            bat_listing_id: batListingId,
            vehicle_id: vehicleId,
            bat_user_id: null,
            bat_username: String(c.author_username || 'Unknown'),
            external_identity_id: c.external_identity_id,
            bid_amount: c.bid_amount,
            bid_timestamp: c.posted_at,
            is_winning_bid: false,
            is_final_bid: false,
            source: 'comment',
            bat_comment_id: null,
            auction_event_id: eventId,
            metadata: {
              source_url: String(auctionUrlNorm),
              comment_content_hash: c.content_hash,
              sequence_number: c.sequence_number,
            },
            updated_at: nowIso,
          }))

        if (bidRows.length > 0) {
          await supabase
            .from('bat_bids')
            .upsert(bidRows, { onConflict: 'bat_listing_id,bat_username,bid_amount,bid_timestamp' })
        }

        if (inferredStatus || inferredFinalPrice || inferredHighBid > 0) {
          const maxBid = bidRows
            .map((b: any) => (typeof b?.bid_amount === 'number' && Number.isFinite(b.bid_amount) ? b.bid_amount : null))
            .filter((n: any) => typeof n === 'number')
            .reduce((acc: number, n: number) => (n > acc ? n : acc), 0)

          await supabase
            .from('bat_listings')
            .update({
              comment_count: batCommentRows.length,
              bid_count: bidRows.length,
              final_bid: inferredFinalPrice || (maxBid > 0 ? Math.floor(maxBid) : null),
              sale_price: inferredFinalPrice,
              sale_date: inferredFinalPrice ? inferredSaleDate : null,
              listing_status: inferredStatus || undefined,
              last_updated_at: nowIso,
              updated_at: nowIso,
            })
            .eq('id', batListingId)
        }
      }
    } catch (e: any) {
      console.warn('BaT table upserts failed (non-fatal):', e?.message || String(e))
    }

    // Store comments
    if (comments.length > 0) {
      console.log(`Attempting to upsert ${comments.length} comments...`)
      const { data: inserted, error } = await supabase
        .from('auction_comments')
        .upsert(commentsWithIdentities, { onConflict: 'vehicle_id,content_hash' })
        .select('id')
      
      if (error) {
        console.error('Upsert error:', error)
        throw error
      }
      console.log(`Successfully saved ${inserted?.length || comments.length} comments`)
    } else {
      console.warn('No comments to save (comments array is empty)')
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
        body: JSON.stringify({ auction_event_id: eventId })
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
    const message = error instanceof Error ? error.message : String(error)
    console.error('Error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function parseBaTDate(dateStr: string, referenceDate: Date): Date {
  // Try "12/27/24 at 6:01 PM" format first
  const dateTimeMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d+):(\d+)\s+(AM|PM)/i)
  if (dateTimeMatch) {
    const [, month, day, year, hour, minute, ampm] = dateTimeMatch
    const fullYear = year.length === 2 ? 2000 + parseInt(year) : parseInt(year)
    const date = new Date(fullYear, parseInt(month) - 1, parseInt(day), 
      parseInt(hour) + (ampm.toUpperCase() === 'PM' && hour !== '12' ? 12 : 0) + (ampm.toUpperCase() === 'AM' && hour === '12' ? -12 : 0), 
      parseInt(minute))
    if (!isNaN(date.getTime())) return date
  }
  
  // Try "Nov 21 at 3:38 PM" format
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

