import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DOMParser } from 'https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Comment {
  author_username: string;
  comment_text: string;
  posted_at: string;
  comment_likes?: number;
  is_seller?: boolean;
  bid_amount?: number;
  is_leading_bid?: boolean;
  sequence_number: number;
}

/**
 * Extract comments from PCarMarket auction page
 */
async function extractComments(url: string): Promise<Comment[]> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    if (!doc) {
      throw new Error('Failed to parse HTML');
    }
    
    const comments: Comment[] = [];
    
    // Look for comment elements - try multiple selectors
    const commentSelectors = [
      '[class*="comment"]',
      '[class*="message"]',
      '[class*="post"]',
      '[id*="comment"]',
      'article',
      '.comment-item',
      '.comment-block'
    ];
    
    let commentElements: any[] = [];
    for (const selector of commentSelectors) {
      const elements = Array.from(doc.querySelectorAll(selector));
      if (elements.length > 0) {
        commentElements = elements;
        break;
      }
    }
    
    // If no comments found, try to find in text patterns
    if (commentElements.length === 0) {
      // Look for comment-like structures in HTML
      const commentPattern = /<div[^>]*class="[^"]*comment[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
      const matches = html.matchAll(commentPattern);
      // Would need more sophisticated parsing here
    }
    
    for (let i = 0; i < commentElements.length; i++) {
      const el = commentElements[i];
      
      // Extract author
      const authorLink = el.querySelector('a[href*="/member/"], a[href*="/user/"], a[href*="/profile/"]');
      const authorText = authorLink?.textContent?.trim() || 
                        el.querySelector('[class*="author"], [class*="user"], [class*="username"]')?.textContent?.trim() ||
                        'Unknown';
      
      // Extract comment text
      const textEl = el.querySelector('[class*="text"], [class*="content"], [class*="body"], p');
      const commentText = textEl?.textContent?.trim() || el.textContent?.trim() || '';
      
      if (!commentText || commentText.length < 3) continue; // Skip empty comments
      
      // Extract timestamp
      const timeEl = el.querySelector('time, [class*="time"], [class*="date"]');
      const timeText = timeEl?.getAttribute('datetime') || 
                      timeEl?.textContent?.trim() || 
                      '';
      
      let postedAt = new Date().toISOString();
      if (timeText) {
        try {
          const parsed = new Date(timeText);
          if (!isNaN(parsed.getTime())) {
            postedAt = parsed.toISOString();
          }
        } catch (e) {
          // Try to parse relative times like "2 hours ago"
          const relativeMatch = timeText.match(/(\d+)\s+(hour|minute|day|week)/i);
          if (relativeMatch) {
            const amount = parseInt(relativeMatch[1], 10);
            const unit = relativeMatch[2].toLowerCase();
            const now = new Date();
            if (unit.includes('hour')) {
              now.setHours(now.getHours() - amount);
            } else if (unit.includes('minute')) {
              now.setMinutes(now.getMinutes() - amount);
            } else if (unit.includes('day')) {
              now.setDate(now.getDate() - amount);
            } else if (unit.includes('week')) {
              now.setDate(now.getDate() - (amount * 7));
            }
            postedAt = now.toISOString();
          }
        }
      }
      
      // Extract likes
      const likesEl = el.querySelector('[class*="like"], [class*="favorite"], [class*="heart"]');
      const likesText = likesEl?.textContent?.trim() || '';
      const likesMatch = likesText.match(/(\d+)/);
      const commentLikes = likesMatch ? parseInt(likesMatch[1], 10) : 0;
      
      // Check if seller
      const isSeller = authorText.toLowerCase().includes('seller') || 
                      el.textContent?.toLowerCase().includes('the seller') ||
                      false;
      
      // Check if bid comment
      const bidMatch = commentText.match(/[\$]([\d,]+)/);
      const bidAmount = bidMatch ? Math.round(parseFloat(bidMatch[1].replace(/,/g, '')) * 100) : undefined;
      
      comments.push({
        author_username: authorText,
        comment_text: commentText,
        posted_at: postedAt,
        comment_likes: commentLikes > 0 ? commentLikes : undefined,
        is_seller: isSeller || undefined,
        bid_amount: bidAmount,
        is_leading_bid: false, // Will be determined later
        sequence_number: i + 1
      });
    }
    
    // Determine leading bid
    if (comments.length > 0) {
      const bidComments = comments.filter(c => c.bid_amount);
      if (bidComments.length > 0) {
        const highestBid = Math.max(...bidComments.map(c => c.bid_amount!));
        bidComments.forEach(c => {
          if (c.bid_amount === highestBid) {
            c.is_leading_bid = true;
          }
        });
      }
    }
    
    return comments;
    
  } catch (error: any) {
    console.error(`Error extracting comments from ${url}:`, error.message);
    return [];
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { vehicle_id, listing_url, auction_event_id } = await req.json();

    if (!listing_url && !vehicle_id) {
      return new Response(
        JSON.stringify({ error: 'listing_url or vehicle_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get listing URL
    let url = listing_url;
    let vehicleId = vehicle_id;

    if (!url && vehicleId) {
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('discovery_url, origin_metadata')
        .eq('id', vehicleId)
        .single();

      if (vehicle) {
        url = vehicle.discovery_url || vehicle.origin_metadata?.pcarmarket_url;
      }
    }

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'Could not determine listing URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`💬 Extracting comments from: ${url}`);

    // Extract comments
    const comments = await extractComments(url);

    console.log(`✅ Extracted ${comments.length} comments`);

    // Store comments if vehicle_id provided
    if (vehicleId) {
      // Get or create auction_event
      let eventId = auction_event_id;

      if (!eventId) {
        const { data: existingEvent } = await supabase
          .from('auction_events')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .eq('source', 'pcarmarket')
          .eq('source_url', url)
          .maybeSingle();

        if (existingEvent) {
          eventId = existingEvent.id;
        } else {
          // Create new auction_event
          const { data: newEvent, error: eventError } = await supabase
            .from('auction_events')
            .insert({
              vehicle_id: vehicleId,
              source: 'pcarmarket',
              source_url: url,
              platform: 'pcarmarket',
              status: 'active'
            })
            .select('id')
            .single();

          if (eventError) {
            console.error('Error creating auction_event:', eventError);
          } else {
            eventId = newEvent.id;
          }
        }
      }

      // Insert comments into auction_comments table
      if (eventId && comments.length > 0) {
        const commentsToInsert = comments.map(c => ({
          auction_event_id: eventId,
          vehicle_id: vehicleId,
          comment_type: c.bid_amount ? 'bid' : 'observation',
          posted_at: c.posted_at,
          sequence_number: c.sequence_number,
          author_username: c.author_username,
          author_type: c.is_seller ? 'seller' : undefined,
          is_seller: c.is_seller || false,
          comment_text: c.comment_text,
          comment_likes: c.comment_likes || 0,
          bid_amount: c.bid_amount ? c.bid_amount / 100 : undefined, // Convert cents to dollars
          is_leading_bid: c.is_leading_bid || false,
          word_count: c.comment_text.split(/\s+/).length
        }));

        // Insert in batches to avoid timeouts
        const batchSize = 10;
        for (let i = 0; i < commentsToInsert.length; i += batchSize) {
          const batch = commentsToInsert.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from('auction_comments')
            .upsert(batch, {
              onConflict: 'author_username,posted_at,vehicle_id',
              ignoreDuplicates: false
            });

          if (insertError) {
            console.error(`Error inserting comment batch ${i / batchSize + 1}:`, insertError);
          }
        }

        console.log(`✅ Stored ${comments.length} comments for vehicle ${vehicleId}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        listing_url: url,
        vehicle_id: vehicleId,
        comment_count: comments.length,
        comments: comments.slice(0, 10), // Return first 10 for preview
        bid_comments: comments.filter(c => c.bid_amount),
        seller_comments: comments.filter(c => c.is_seller)
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in extract-pcarmarket-comments:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

