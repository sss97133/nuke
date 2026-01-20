/**
 * EXTRACT CARS & BIDS COMMENTS
 * Pulls all comments from a Cars & Bids auction listing
 * Similar to extract-auction-comments but adapted for Cars & Bids structure
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts'
import { firecrawlScrape } from '../_shared/firecrawl.ts'

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
    // Keep pathname as-is (don't force trailing slash for Cars & Bids)
    return u.toString();
  } catch {
    return String(raw).split('#')[0].split('?')[0];
  }
}

function extractNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+)/);
  if (match && match[1]) {
    const num = parseInt(match[1], 10);
    return Number.isFinite(num) && num >= 0 ? num : null;
  }
  return null;
}

function parseCarsAndBidsDate(dateText: string, auctionEndDate: Date): Date {
  if (!dateText || !dateText.trim()) return new Date();
  
  const now = new Date();
  const text = dateText.trim().toLowerCase();
  
  // Try relative time patterns: "2 hours ago", "1 day ago", "Just now"
  const relativePatterns = [
    { pattern: /(\d+)\s+minutes?\s+ago/i, unit: 60000 },
    { pattern: /(\d+)\s+hours?\s+ago/i, unit: 3600000 },
    { pattern: /(\d+)\s+days?\s+ago/i, unit: 86400000 },
    { pattern: /(\d+)\s+weeks?\s+ago/i, unit: 604800000 },
    { pattern: /just\s+now|a few seconds ago/i, unit: 0 },
  ];
  
  for (const { pattern, unit } of relativePatterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = match[1] ? parseInt(match[1], 10) : 0;
      return new Date(now.getTime() - (amount * unit));
    }
  }
  
  // Try absolute date patterns: "Jan 9, 2025 2:54 PM", "1/9/2025 2:54 PM"
  const absolutePatterns = [
    /([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i, // "Jan 9, 2025 2:54 PM"
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i, // "1/9/2025 2:54 PM" or "1/9/25 2:54"
    /([A-Za-z]{3,9})\s+(\d{1,2}),\s+(\d{4})/i, // "Jan 9, 2025"
    /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i, // "1/9/2025"
  ];
  
  for (const pattern of absolutePatterns) {
    const match = text.match(pattern);
    if (match) {
      try {
        // Parse month names
        const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                           'july', 'august', 'september', 'october', 'november', 'december'];
        let month = 0, day = 0, year = 0, hour = 12, minute = 0;
        
        if (match[0].match(/^[A-Za-z]/)) {
          // Month name format
          const monthName = match[1].toLowerCase().substring(0, 3);
          month = monthNames.findIndex(m => m.startsWith(monthName));
          day = parseInt(match[2], 10);
          year = parseInt(match[3], 10);
          if (match[4] && match[5]) {
            hour = parseInt(match[4], 10);
            minute = parseInt(match[5], 10);
            if (match[6] && match[6].toUpperCase() === 'PM' && hour !== 12) hour += 12;
            if (match[6] && match[6].toUpperCase() === 'AM' && hour === 12) hour = 0;
          }
        } else {
          // Numeric format
          month = parseInt(match[1], 10) - 1;
          day = parseInt(match[2], 10);
          year = parseInt(match[3], 10);
          if (year < 100) year = year < 50 ? 2000 + year : 1900 + year;
          if (match[4] && match[5]) {
            hour = parseInt(match[4], 10);
            minute = parseInt(match[5], 10);
            if (match[6] && match[6].toUpperCase() === 'PM' && hour !== 12) hour += 12;
            if (match[6] && match[6].toUpperCase() === 'AM' && hour === 12) hour = 0;
          }
        }
        
        const date = new Date(year, month, day, hour, minute);
        if (Number.isFinite(date.getTime())) return date;
      } catch {
        // Try native Date parsing as fallback
        const date = new Date(text);
        if (Number.isFinite(date.getTime())) return date;
      }
    }
  }
  
  // Fallback to current time if parsing fails
  return new Date();
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
    const urlCandidates = Array.from(new Set([auctionUrlRaw, auctionUrlNorm].filter(Boolean)))

    console.log(`Extracting Cars & Bids comments from: ${auctionUrlNorm}`)

    // Resolve auction_event_id if caller didn't provide it
    const platformGuess = auctionUrlNorm.includes('carsandbids.com') ? 'cars_and_bids' : null
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
      console.warn('Missing auction_event_id - creating auction_event record')
      // Create auction_event if it doesn't exist
      const { data: newEvent, error: createErr } = await supabase
        .from('auction_events')
        .insert({
          source: platformGuess || 'cars_and_bids',
          source_url: auctionUrlNorm,
          vehicle_id: vehicle_id || null,
        })
        .select('id')
        .single()
      if (newEvent?.id && !createErr) {
        eventId = String(newEvent.id)
        console.log(`✅ Created auction_event ${eventId}`)
      }
    }

    // Resolve vehicle_id
    let vehicleId: string | null = vehicle_id ? String(vehicle_id) : null
    if (!vehicleId && eventId) {
      const { data: ev2 } = await supabase
        .from('auction_events')
        .select('vehicle_id')
        .eq('id', eventId)
        .maybeSingle()
      if (ev2?.vehicle_id) vehicleId = String(ev2.vehicle_id)
    }
    if (!vehicleId && platformGuess) {
      const { data: ext } = await supabase
        .from('external_listings')
        .select('vehicle_id')
        .eq('platform', 'cars_and_bids')
        .in('listing_url', urlCandidates)
        .limit(1)
        .maybeSingle()
      if (ext?.vehicle_id) vehicleId = String(ext.vehicle_id)
    }
    if (!vehicleId) {
      const { data: v1 } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', `%carsandbids.com%`)
        .in('discovery_url', urlCandidates)
        .limit(1)
        .maybeSingle()
      if (v1?.id) vehicleId = String(v1.id)
    }
    if (!vehicleId) {
      throw new Error(`Could not resolve vehicle_id for ${auctionUrlNorm}`)
    }

    console.log(`✅ Resolved vehicle_id: ${vehicleId}, event_id: ${eventId || 'none'}`)

    // Try direct fetch first (Cars & Bids uses Next.js, so __NEXT_DATA__ should be in initial HTML)
    console.log('🌐 Fetching HTML directly (__NEXT_DATA__ should be available)...')
    
    let html = ''
    try {
      const directResponse = await fetch(auctionUrlNorm, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })

      if (!directResponse.ok) {
        throw new Error(`Direct fetch failed: ${directResponse.status} ${directResponse.statusText}`)
      }

      html = await directResponse.text()
      
      if (!html || html.length < 1000) {
        throw new Error(`Direct fetch returned insufficient HTML (${html.length} chars)`)
      }

      // Check if __NEXT_DATA__ is present (indicates Next.js data is available)
      const hasNextData = html.includes('__NEXT_DATA__')
      console.log(`✅ Direct fetch returned ${html.length} characters of HTML (__NEXT_DATA__: ${hasNextData})`)

      // If __NEXT_DATA__ is present, we can extract from it directly
      if (hasNextData) {
        console.log('✅ __NEXT_DATA__ found - can extract comments without Firecrawl')
      } else {
        console.warn('⚠️ No __NEXT_DATA__ found - comments may require JavaScript rendering')
      }
    } catch (directError: any) {
      console.warn(`⚠️ Direct fetch failed: ${directError.message}, trying Firecrawl...`)
      
      // Fallback to Firecrawl if direct fetch fails
      const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY') || Deno.env.get('FIRECRAWL_KEY')
      if (!firecrawlKey) {
        console.error('❌ FIRECRAWL_API_KEY not configured, and direct fetch failed')
        throw new Error(`Direct fetch failed and FIRECRAWL_API_KEY not configured: ${directError.message}`)
      }

      console.log('🌐 Fetching HTML with Firecrawl (JavaScript rendering fallback)...')
      
      const firecrawl = await firecrawlScrape(
        {
          url: auctionUrlNorm,
          formats: ['html'],
          onlyMainContent: false,
          waitFor: 3000, // Wait 3 seconds for JavaScript to render
        },
        {
          apiKey: firecrawlKey,
          timeoutMs: 45000,
          maxAttempts: 3,
        }
      )

      html = firecrawl.data?.html || ''
      
      if (!html || html.length < 1000) {
        const rawErr = (firecrawl.raw as any)?.error
        const errText = firecrawl.error || ''
        const looksLikeCredits =
          /credits/i.test(errText) ||
          /insufficient/i.test(errText) ||
          /credits/i.test(JSON.stringify(rawErr || '')) ||
          /insufficient/i.test(JSON.stringify(rawErr || ''))
        if (looksLikeCredits) {
          throw new Error(`Firecrawl account has insufficient credits. Direct fetch also failed. Please add credits to Firecrawl account or use an active auction URL.`)
        }
        throw new Error(firecrawl.error || `Firecrawl returned insufficient HTML (${html.length} chars)`)
      }
      
      console.log(`✅ Firecrawl returned ${html.length} characters of HTML`)
    }

    // Try to extract from __NEXT_DATA__ first (more reliable)
    // Use recursive search to find comments in nested structures (Cars & Bids may store them in various locations)
    let commentsFromNextData: any[] = []
    try {
      const nextDataPattern = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
      const nextDataMatch = nextDataPattern.exec(html)
      if (nextDataMatch && nextDataMatch[1]) {
        const nextData = JSON.parse(nextDataMatch[1])
        const auction = nextData?.props?.pageProps?.auction || 
                       nextData?.props?.pageProps?.data?.auction ||
                       nextData?.props?.auction ||
                       nextData?.auction

        // First try direct path
        if (auction && Array.isArray(auction.comments)) {
          console.log(`✅ Found ${auction.comments.length} comments in __NEXT_DATA__ (direct path)`)
          commentsFromNextData = auction.comments
        }
        
        // ALWAYS do recursive search to find ALL comments (comments may be in nested structures)
        const findCommentsArray = (root: any, depth = 0, seen = new Set<any>()): any[] | null => {
          if (depth > 12) return null
          if (!root || typeof root !== 'object') return null
          if (seen.has(root)) return null // Avoid circular references
          seen.add(root)

          // Check common comment array locations
          const candidateArrays = [
            root?.comments,
            root?.commentThreads,
            root?.comment_threads,
            root?.items, // Sometimes comments are in an items array
            root?.results, // GraphQL-style results
          ].filter(Boolean)

          for (const arr of candidateArrays) {
            if (Array.isArray(arr) && arr.length > 0) {
              // Verify it looks like a comments array (has objects with text/body/content/message)
              const firstItem = arr[0]
              if (firstItem && typeof firstItem === 'object') {
                const hasCommentLikeField = firstItem.text || firstItem.body || firstItem.content || firstItem.message || firstItem.node?.text || firstItem.node?.body
                if (hasCommentLikeField) {
                  return arr
                }
              }
            }
          }

          // Check GraphQL relay structure (edges)
          const edges = root?.comments?.edges || root?.edges
          if (Array.isArray(edges) && edges.length > 0) {
            return edges
          }

          // Recursively search nested objects
          if (depth < 8) {
            if (Array.isArray(root)) {
              for (const item of root) {
                if (item && typeof item === 'object') {
                  const found = findCommentsArray(item, depth + 1, seen)
                  if (found) return found
                }
              }
            } else {
              for (const key of Object.keys(root)) {
                const value = root[key]
                if (value && typeof value === 'object') {
                  const found = findCommentsArray(value, depth + 1, seen)
                  if (found) return found
                }
              }
            }
          }

          return null
        }

        // Use recursive search to find comments array
        const commentsArray = findCommentsArray(auction || nextData)
        if (commentsArray && Array.isArray(commentsArray) && commentsArray.length > 0) {
          if (commentsFromNextData.length === 0 || commentsArray.length > commentsFromNextData.length) {
            console.log(`✅ Found ${commentsArray.length} comments in __NEXT_DATA__ (recursive search)`)
            commentsFromNextData = commentsArray
          }
        }
      }
    } catch (e: any) {
      console.warn(`⚠️ Failed to parse __NEXT_DATA__ for comments: ${e?.message}`)
    }

    // Parse HTML with DOMParser for fallback extraction
    const doc = new DOMParser().parseFromString(html, 'text/html')
    if (!doc) throw new Error('Failed to parse HTML (DOMParser returned null)')

    // Extract auction end date for relative time calculations
    const auctionEndMatch = html.match(/Auction\s+(?:ends?|ended)[:\s]+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i)
    const auctionEndDate = auctionEndMatch ? parseCarsAndBidsDate(auctionEndMatch[1], new Date()) : new Date()

    // Extract comments - try multiple selectors for Cars & Bids
    let commentElements: any[] = []
    
    // Method 1: Look for comment containers (Cars & Bids specific)
    const commentSelectors = [
      '[class*="comment"]',
      '[class*="Comment"]',
      '[data-comment-id]',
      '.comment-item',
      '.comment-wrapper',
      '[class*="comment"] [class*="text"]',
    ]
    
    for (const selector of commentSelectors) {
      const found = doc.querySelectorAll(selector)
      if (found.length > 0) {
        commentElements = Array.from(found)
        console.log(`✅ Found ${commentElements.length} comments using selector: ${selector}`)
        break
      }
    }

    // If no comments found, try extracting from __NEXT_DATA__ structure
    if (commentElements.length === 0 && commentsFromNextData.length > 0) {
      // Use __NEXT_DATA__ comments directly
      console.log(`✅ Using ${commentsFromNextData.length} comments from __NEXT_DATA__`)
    } else if (commentElements.length === 0) {
      console.warn('⚠️ No comments found with standard selectors, trying fallback patterns')
      // Fallback: Look for any divs with comment-like text patterns
      const allDivs = doc.querySelectorAll('div')
      for (let i = 0; i < allDivs.length; i++) {
        const div = allDivs[i]
        const text = div.textContent || ''
        // Look for patterns like "username 2 hours ago" or similar
        if (text.match(/\d+\s+(?:minutes?|hours?|days?)\s+ago/i) && text.length > 20) {
          commentElements.push(div)
        }
      }
      console.log(`✅ Found ${commentElements.length} comments using fallback patterns`)
    }

    const comments: any[] = []
    const authorSet = new Set<string>()
    const authorProfileUrls = new Map<string, string>()

    // Process comments from __NEXT_DATA__ (most reliable)
    if (commentsFromNextData.length > 0) {
      for (let i = 0; i < commentsFromNextData.length; i++) {
        // Handle GraphQL relay structure (edge.node) or direct comment objects
        const rawComment = commentsFromNextData[i]
        const commentData = rawComment?.node || rawComment // Support GraphQL relay edges
        
        const authorRaw = commentData?.author || commentData?.username || commentData?.user?.username || commentData?.user?.name || commentData?.user?.handle || 'Unknown'
        const author = String(authorRaw).trim() || 'Unknown'
        const text = commentData?.text || commentData?.content || commentData?.body || commentData?.message || ''
        const postedAt = commentData?.created_at || commentData?.timestamp || commentData?.date || commentData?.posted_at || commentData?.createdAt
        
        if (!text || text.length < 3) continue

        const posted_at = postedAt ? new Date(postedAt) : parseCarsAndBidsDate(commentData.date_text || '', auctionEndDate)
        const hours_until_close = (auctionEndDate.getTime() - posted_at.getTime()) / (1000 * 60 * 60)

        // Extract profile URL if available
        if (commentData.author_url || commentData.user?.profile_url) {
          const profileUrl = commentData.author_url || commentData.user?.profile_url || `https://carsandbids.com/users/${encodeURIComponent(author)}`
          authorProfileUrls.set(author, profileUrl)
        }

        // Detect comment type
        const isSeller = commentData.is_seller || commentData.seller || false
        const isBid = commentData.is_bid || text.toLowerCase().includes('bid') || false
        const isSold = commentData.is_sold || text.toLowerCase().includes('sold') || false

        const comment_type = 
          isSold ? 'sold' :
          isBid ? 'bid' :
          isSeller ? 'seller_response' :
          text.includes('?') ? 'question' :
          'observation'

        const bid_amount = commentData.bid_amount || commentData.amount || null
        const authorLikes = commentData.author_likes || commentData.user?.total_likes || null
        const commentLikes = commentData.likes || commentData.upvotes || null

        const content_hash = await sha256Hex([
          'cars_and_bids',
          String(auctionUrlNorm),
          String(i + 1),
          String(posted_at.toISOString()),
          String(author),
          String(text),
        ].join('|'))

        comments.push({
          auction_event_id: eventId,
          vehicle_id: vehicleId,
          platform: 'cars_and_bids',
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
          has_media: commentData.has_media || false,
          bid_amount,
          comment_likes: commentLikes,
        })

        if (author && author !== 'Unknown') {
          authorSet.add(author)
        }
      }
    }

    // Process comments from HTML DOM (fallback)
    if (comments.length === 0 && commentElements.length > 0) {
      for (let i = 0; i < commentElements.length; i++) {
        const el = commentElements[i]
        
        // Extract author
        const authorLink = el.querySelector('a[href*="/user/"]') || el.querySelector('a[href*="/users/"]') as any
        let authorRaw = authorLink?.textContent?.trim() || ''
        if (!authorRaw) {
          // Try other patterns
          const authorEl = el.querySelector('[class*="author"]') || el.querySelector('[class*="username"]')
          authorRaw = authorEl?.textContent?.trim() || ''
        }
        const author = String(authorRaw).trim() || 'Unknown'

        // Extract date
        let dateText = ''
        const dateEl = el.querySelector('[class*="date"]') || el.querySelector('[class*="time"]')
        dateText = dateEl?.textContent?.trim() || ''
        if (!dateText) {
          // Try to extract from full text
          const fullText = el.textContent || ''
          const dateMatch = fullText.match(/(\d+\s+(?:minutes?|hours?|days?)\s+ago|[A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i)
          if (dateMatch) dateText = dateMatch[1]
        }

        // Extract text
        let text = el.querySelector('p')?.textContent?.trim() || el.querySelector('[class*="text"]')?.textContent?.trim() || ''
        if (!text) {
          text = el.textContent || ''
          // Clean up metadata from text
          text = text
            .replace(/\d+\s+(?:minutes?|hours?|days?)\s+ago/gi, '')
            .replace(authorRaw, '')
            .trim()
        }

        if (!text || text.length < 3) continue

        const posted_at = parseCarsAndBidsDate(dateText, auctionEndDate)
        const hours_until_close = (auctionEndDate.getTime() - posted_at.getTime()) / (1000 * 60 * 60)

        // Extract profile URL
        if (authorLink) {
          const href = authorLink.getAttribute('href') || ''
          if (href) {
            const profileUrl = href.startsWith('http') ? href : `https://carsandbids.com${href}`
            authorProfileUrls.set(author, profileUrl)
          }
        }

        // Detect comment type
        const fullText = el.textContent || ''
        const isSeller = el.classList.contains('seller') || fullText.toLowerCase().includes('seller')
        const isBid = fullText.toLowerCase().includes('bid')
        const isSold = fullText.toLowerCase().includes('sold')

        const comment_type = 
          isSold ? 'sold' :
          isBid ? 'bid' :
          isSeller ? 'seller_response' :
          text.includes('?') ? 'question' :
          'observation'

        const bidMatch = text.match(/\$([0-9,]+)/)
        const bid_amount = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, '')) : null

        const authorLikesEl = el.querySelector('[class*="likes"]')
        const authorLikes = extractNumber(authorLikesEl?.textContent)

        const content_hash = await sha256Hex([
          'cars_and_bids',
          String(auctionUrlNorm),
          String(i + 1),
          String(posted_at.toISOString()),
          String(author),
          String(text),
        ].join('|'))

        comments.push({
          auction_event_id: eventId,
          vehicle_id: vehicleId,
          platform: 'cars_and_bids',
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
          has_media: el.querySelector('img') !== null || el.querySelector('video') !== null,
          bid_amount,
          comment_likes: null,
        })

        if (author && author !== 'Unknown') {
          authorSet.add(author)
        }
      }
    }

    console.log(`✅ Extracted ${comments.length} comments`)

    // Upsert external identities
    const handleToExternalIdentityId = new Map<string, string>()
    if (authorSet.size > 0) {
      const nowIso = new Date().toISOString()
      const rows = Array.from(authorSet).map((h) => ({
        platform: 'cars_and_bids',
        handle: h,
        profile_url: authorProfileUrls.get(h) || `https://carsandbids.com/users/${encodeURIComponent(h)}`,
        last_seen_at: nowIso,
        updated_at: nowIso,
      }))

      const { data: upserted, error: upsertErr } = await supabase
        .from('external_identities')
        .upsert(rows, { onConflict: 'platform,handle' })
        .select('id, handle')

      if (upsertErr) {
        console.warn('Failed to upsert external identities (non-fatal):', upsertErr)
      } else if (upserted) {
        for (const identity of upserted) {
          handleToExternalIdentityId.set(identity.handle, identity.id)
        }
      }
    }

    // Upsert comments (idempotent on content_hash)
    if (comments.length > 0) {
      const { error: commentsErr } = await supabase
        .from('auction_comments')
        .upsert(comments, { onConflict: 'vehicle_id,content_hash' })

      if (commentsErr) {
        throw new Error(`Failed to upsert comments: ${commentsErr.message}`)
      }
      console.log(`✅ Upserted ${comments.length} comments`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        vehicle_id: vehicleId,
        auction_event_id: eventId,
        comments_extracted: comments.length,
        authors_found: authorSet.size,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error extracting Cars & Bids comments:', error)
    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

