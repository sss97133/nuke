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

async function trySaveHtmlSnapshot(args: {
  supabase: any
  platform: string
  listingUrl: string
  fetchMethod: string
  httpStatus: number | null
  success: boolean
  errorMessage: string | null
  html: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  const {
    supabase,
    platform,
    listingUrl,
    fetchMethod,
    httpStatus,
    success,
    errorMessage,
    html,
    metadata,
  } = args

  try {
    const htmlText = html ?? null
    const htmlSha = htmlText ? await sha256Hex(htmlText) : null
    const contentLength = htmlText ? htmlText.length : 0

    const payload: any = {
      platform,
      listing_url: listingUrl,
      fetch_method: fetchMethod,
      http_status: httpStatus,
      success,
      error_message: errorMessage,
      html: htmlText,
      html_sha256: htmlSha,
      content_length: contentLength,
      metadata: metadata || {},
    }

    // Dedup is enforced by a PARTIAL unique index in SQL:
    //   UNIQUE(platform, listing_url, html_sha256) WHERE html_sha256 IS NOT NULL
    // Supabase/PostgREST upsert cannot express the partial-index predicate, so we use plain INSERT
    // and treat unique-violation as a no-op.
    const { error } = await supabase
      .from('listing_page_snapshots')
      .insert(payload)

    if (error) {
      // 23505 = unique_violation (duplicate snapshot); ignore.
      if (String(error.code || '') === '23505') return
      console.warn('listing_page_snapshots insert failed (non-fatal):', error?.message || String(error))
    }
  } catch (e: any) {
    console.warn('listing_page_snapshots save failed (non-fatal):', e?.message || String(e))
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim()
    const serviceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '').trim()

    if (!supabaseUrl) throw new Error('Missing SUPABASE_URL')
    if (!serviceRoleKey) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

    const supabase = createClient(supabaseUrl, serviceRoleKey)

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

    // ⚠️ FREE MODE: Direct HTML fetch (no Firecrawl due to budget constraints)
    // BaT comments may be in HTML or require JS rendering - try direct fetch first
    console.log('Fetching BaT page HTML directly (free mode - no Firecrawl)...')
    
    // User agent rotation for IP safety (avoids detection patterns)
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    ]
    const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)]
    
    // Random delay to appear more human (1-3 seconds)
    const humanDelay = Math.random() * 2000 + 1000
    await new Promise(resolve => setTimeout(resolve, humanDelay))
    
    let html = ''
    try {
      const response = await fetch(auctionUrlNorm, {
        headers: {
          'User-Agent': randomUserAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Referer': 'https://www.google.com/', // Appear to come from search
        },
        signal: AbortSignal.timeout(30000)
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      html = await response.text()
      
      if (!html || html.length < 1000) {
        throw new Error(`Direct fetch returned insufficient HTML (${html?.length || 0} chars)`)
      }
      
      console.log(`Direct fetch returned ${html.length} characters of HTML`)

      // Evidence-first: store HTML snapshot so we can re-parse later without re-scraping.
      // This is especially useful in free mode to reduce repeated site hits.
      if (platformGuess === 'bat') {
        await trySaveHtmlSnapshot({
          supabase,
          platform: 'bat',
          listingUrl: auctionUrlNorm,
          fetchMethod: 'direct',
          httpStatus: response.status,
          success: true,
          errorMessage: null,
          html,
          metadata: {
            extractor: 'extract-auction-comments',
            mode: 'free',
            user_agent: randomUserAgent,
            vehicle_id: vehicleId,
            auction_event_id: eventId,
          },
        })
      }
    } catch (e: any) {
      console.error(`Direct fetch failed: ${e.message}`)

      if (platformGuess === 'bat') {
        await trySaveHtmlSnapshot({
          supabase,
          platform: 'bat',
          listingUrl: auctionUrlNorm,
          fetchMethod: 'direct',
          httpStatus: null,
          success: false,
          errorMessage: e?.message ? String(e.message) : 'Direct fetch failed',
          html: null,
          metadata: {
            extractor: 'extract-auction-comments',
            mode: 'free',
            user_agent: randomUserAgent,
            vehicle_id: vehicleId,
            auction_event_id: eventId,
          },
        })
      }

      throw new Error(`Direct HTML fetch failed: ${e.message}. BaT comments may require JavaScript rendering (Firecrawl needed).`)
    }
    
    // ⚠️ PRIORITY: Extract from embedded JSON comments array (BaT embeds comments as "comments":[{...}])
    // This is the FREE way to get comments without JavaScript rendering!
    let commentsFromJson: any[] = []
    try {
      // Pattern 1: Look for "comments":[{...},...,{...}] in HTML
      const commentsMatch = html.match(/"comments":\s*\[([\s\S]*?)\](?=,"[a-z])/)
      if (commentsMatch && commentsMatch[1]) {
        try {
          const arrayContent = '[' + commentsMatch[1] + ']'
          const parsed = JSON.parse(arrayContent)
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log(`Found ${parsed.length} comments in embedded JSON array`)
            commentsFromJson = parsed
          }
        } catch (parseErr: any) {
          console.warn(`Failed to parse comments JSON array: ${parseErr?.message}`)
        }
      }
      
      // Pattern 2: Try __NEXT_DATA__ (BaT might use Next.js for some pages)
      if (commentsFromJson.length === 0) {
        const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
        const nextDataMatch = html.match(nextDataPattern)
        if (nextDataMatch && nextDataMatch[1]) {
          try {
            const nextData = JSON.parse(nextDataMatch[1])
            const pageData = nextData?.props?.pageProps?.pageData || nextData?.props?.pageProps || {}
            const listing = pageData.listing || pageData
            const rawComments = pageData.comments || listing?.comments || []
            
            if (Array.isArray(rawComments) && rawComments.length > 0) {
              console.log(`Found ${rawComments.length} comments in __NEXT_DATA__`)
              commentsFromJson = rawComments
            }
          } catch (e: any) {
            console.warn(`Failed to parse __NEXT_DATA__ for comments: ${e?.message}`)
          }
        }
      }
      
      // Pattern 3: Try individual comment objects (fallback for edge cases)
      if (commentsFromJson.length === 0) {
        const objectMatches = html.matchAll(/\{"channels":\[.*?"type":"(bat-bid|comment)".*?\}/g)
        const found: any[] = []
        for (const match of objectMatches) {
          try {
            const obj = JSON.parse(match[0])
            if (obj?.type && (obj.type === 'bat-bid' || obj.type === 'comment')) {
              found.push(obj)
            }
          } catch { /* skip malformed */ }
        }
        if (found.length > 0) {
          console.log(`Found ${found.length} comments from individual JSON objects`)
          commentsFromJson = found
        }
      }
    } catch (e: any) {
      console.warn(`Failed to extract comments from JSON: ${e?.message}`)
    }

    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (!doc) throw new Error('Failed to parse HTML (DOMParser returned null)')

    // Extract auction metadata
    const auctionEndMatch = html.match(/Auction ended?[:\s]+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
    const auctionEndDate = auctionEndMatch ? new Date(auctionEndMatch[1]) : new Date()

    const comments = []
    const authorSet = new Set<string>()
    const authorProfileUrls = new Map<string, string>() // Map author username to profile URL
    
    // Process comments from embedded JSON (preferred method - FREE, no JS needed!)
    if (commentsFromJson.length > 0) {
      console.log(`Processing ${commentsFromJson.length} comments from embedded JSON...`)
      for (let i = 0; i < commentsFromJson.length; i++) {
        const c = commentsFromJson[i]
        const authorRaw = String(c?.authorName || c?.author || '').trim()
        const author = authorRaw.replace(/\s*\(The\s+Seller\)/i, '').trim() || 'Unknown'
        const isSeller = authorRaw.toLowerCase().includes('(the seller)')
        
        // Parse timestamp (BaT uses Unix timestamp in seconds)
        const timestamp = c?.timestamp ? (typeof c.timestamp === 'number' ? new Date(c.timestamp * 1000) : new Date(c.timestamp)) : null
        const posted_at = timestamp || auctionEndDate
        
        // Extract text (may be HTML, strip tags)
        const rawText = String(c?.content || c?.comment || c?.text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        if (!rawText || rawText.length < 3) continue
        
        // Detect comment type
        const isBid = c?.type === 'bat-bid' || /bid\s+placed\s+by/i.test(rawText)
        const bidAmount = (isBid && c?.bidAmount) ? (typeof c.bidAmount === 'number' ? c.bidAmount : parseFloat(String(c.bidAmount).replace(/,/g, ''))) : null
        
        const comment_type = 
          bidAmount ? 'bid' :
          isSeller ? 'seller_response' :
          rawText.includes('?') ? 'question' :
          'observation'
        
        const hours_until_close = timestamp ? (auctionEndDate.getTime() - posted_at.getTime()) / (1000 * 60 * 60) : 0
        
        // Generate content hash for idempotency
        const content_hash = await sha256Hex([
          'bat',
          String(auctionUrlNorm),
          String(i + 1),
          String(posted_at.toISOString()),
          String(author),
          String(rawText),
        ].join('|'))
        
        // Extract profile URL if available
        if (c?.authorProfileUrl || (author && author !== 'Unknown')) {
          const profileUrl = c?.authorProfileUrl || `https://bringatrailer.com/member/${author.toLowerCase().replace(/\s+/g, '-')}`
          authorProfileUrls.set(author, profileUrl)
        }
        
        comments.push({
          auction_event_id: eventId,
          vehicle_id: vehicleId,
          // Canonical platform key used across the DB is 'bat' (matches external_listings.platform, auction_events.source).
          platform: platformGuess,
          source_url: String(auctionUrlNorm),
          content_hash,
          sequence_number: i + 1,
          posted_at: posted_at.toISOString(),
          hours_until_close: Math.max(0, hours_until_close),
          author_username: author,
          is_seller: isSeller,
          author_total_likes: typeof c?.likes === 'number' ? c.likes : 0,
          comment_type,
          comment_text: rawText,
          word_count: rawText.split(/\s+/).length,
          has_question: rawText.includes('?'),
          has_media: Boolean(c?.hasImage || c?.hasVideo),
          bid_amount: bidAmount,
          comment_likes: typeof c?.commentLikes === 'number' ? c.commentLikes : 0
        })
        
        if (author && author !== 'Unknown') {
          authorSet.add(author)
        }
      }
      
      console.log(`Successfully processed ${comments.length} comments from embedded JSON (free mode)`)
    }
    
    // Fallback: Try DOM parsing if JSON extraction had no comments
    if (comments.length === 0) {
      console.log(`No comments found in embedded JSON, trying DOM fallback (may not work without JS rendering)...`)
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
    } // End of DOM fallback section
    
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

    // Store comments (canonical)
    // Do this BEFORE any legacy BaT table writes so we never end up with partial state
    // (e.g. bat_bids written but auction_comments missing).
    if (comments.length > 0) {
      console.log(`Attempting to upsert ${comments.length} comments...`)
      const { data: inserted, error } = await supabase
        .from('auction_comments')
        .upsert(commentsWithIdentities, { onConflict: 'vehicle_id,content_hash' })
        .select('id')
      
      if (error) {
        const e: any = error
        console.error('Upsert error:', e)
        throw new Error(
          [
            'auction_comments upsert failed',
            e?.message ? `message=${String(e.message)}` : null,
            e?.code ? `code=${String(e.code)}` : null,
            e?.details ? `details=${String(e.details)}` : null,
            e?.hint ? `hint=${String(e.hint)}` : null,
          ]
            .filter(Boolean)
            .join(' | ')
        )
      }
      console.log(`Successfully saved ${inserted?.length || comments.length} comments`)
    } else {
      console.warn('No comments to save (comments array is empty)')
    }

    let batListingId: string | null = null
    try {
      const nowIso = new Date().toISOString()
      const { data: extListing } = await supabase
        .from('external_listings')
        .select('id, final_price, current_bid, listing_status, end_date, sold_at, listing_id, metadata')
        .eq('vehicle_id', vehicleId)
        .eq('platform', 'bat')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const inferredHighBid = commentsWithIdentities
        .map((c: any) => (typeof c?.bid_amount === 'number' && Number.isFinite(c.bid_amount) ? c.bid_amount : null))
        .filter((n: any) => typeof n === 'number')
        .reduce((acc: number, n: number) => (n > acc ? n : acc), 0)

      // Safety net: If the core extractor didn't set final_price, infer it from the SOLD system comment.
      const soldCommentText =
        commentsWithIdentities.find((c: any) => String(c?.comment_type || '').toLowerCase() === 'sold')?.comment_text ||
        commentsWithIdentities.find((c: any) => /\bsold\s+on\b|\bsold\s+for\b/i.test(String(c?.comment_text || '')))?.comment_text ||
        null

      const parseMoney = (raw: string | null): number | null => {
        const m = String(raw || '').match(/\$([0-9,]+)/)
        if (!m?.[1]) return null
        const n = Number(String(m[1]).replace(/,/g, ''))
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null
      }

      const inferredSoldPriceFromComment =
        soldCommentText
          ? (
              parseMoney(String(soldCommentText).match(/\bfor\s+(?:USD\s*)?\$[0-9,]+/i)?.[0] || soldCommentText) ||
              parseMoney(soldCommentText)
            )
          : null

      const inferredBuyerFromComment = (() => {
        if (!soldCommentText) return null
        const m = String(soldCommentText).match(/\bto\s+([A-Za-z0-9_]{2,})\b/i)
        return m?.[1] ? String(m[1]).trim() : null
      })()

      const inferredFinalPrice =
        (typeof extListing?.final_price === 'number' && Number.isFinite(extListing.final_price) && extListing.final_price > 0)
          ? Math.floor(extListing.final_price)
          : (inferredSoldPriceFromComment || null)

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
        // If we inferred a sold price from comments, treat as sold.
        if (inferredFinalPrice && inferredFinalPrice > 0) return 'sold'
        return null
      })()

      // If we inferred SOLD (either from the system comment or from an existing external_listings.final_price),
      // persist it back into external_listings so the rest of the system (auctionPulse, header owner guess, etc.)
      // becomes consistent. Also ensure `current_bid` matches `final_price` for sold listings.
      if (extListing?.id && inferredFinalPrice && inferredFinalPrice > 0) {
        const existingStatus = String(extListing?.listing_status || '').toLowerCase()
        const existingFinal =
          (typeof extListing?.final_price === 'number' && Number.isFinite(extListing.final_price) && extListing.final_price > 0)
            ? Math.floor(extListing.final_price)
            : null
        const existingCurrent =
          (typeof extListing?.current_bid === 'number' && Number.isFinite(extListing.current_bid) && extListing.current_bid > 0)
            ? Math.floor(extListing.current_bid)
            : null

        const needsSync =
          existingStatus !== 'sold' ||
          existingFinal !== inferredFinalPrice ||
          existingCurrent !== inferredFinalPrice

        if (needsSync) {
          const existingMeta = (extListing as any)?.metadata && typeof (extListing as any).metadata === 'object'
            ? (extListing as any).metadata
            : {}
          const reserveFromHtml =
            html.includes('no-reserve') || /\bNo Reserve\b/i.test(html) ? 'no_reserve' : null

          await supabase
            .from('external_listings')
            .update({
              listing_status: 'sold',
              final_price: inferredFinalPrice,
              current_bid: inferredFinalPrice,
              sold_at: extListing?.sold_at || extListing?.end_date || nowIso,
              metadata: {
                ...existingMeta,
                ...(inferredBuyerFromComment ? { buyer_username: inferredBuyerFromComment } : {}),
                ...(reserveFromHtml ? { reserve_status: reserveFromHtml } : {}),
                source: existingMeta?.source || 'extract-auction-comments',
              },
              updated_at: nowIso,
            })
            .eq('id', extListing.id)
        }
      }

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
    const e: any = error
    const message =
      e instanceof Error
        ? e.message
        : typeof e?.message === 'string'
          ? e.message
          : (() => {
              try {
                return JSON.stringify(e)
              } catch {
                return String(e)
              }
            })()

    const details =
      typeof e?.details === 'string'
        ? e.details
        : (() => {
            try {
              return e?.details ? JSON.stringify(e.details) : null
            } catch {
              return null
            }
          })()

    const hint =
      typeof e?.hint === 'string'
        ? e.hint
        : (() => {
            try {
              return e?.hint ? JSON.stringify(e.hint) : null
            } catch {
              return null
            }
          })()

    const code = typeof e?.code === 'string' ? e.code : null

    console.error('Error:', { message, code, details, hint, raw: e })

    return new Response(JSON.stringify({ error: message, code, details, hint }), {
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

