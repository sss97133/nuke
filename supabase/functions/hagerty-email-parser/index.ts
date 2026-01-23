/**
 * HAGERTY EMAIL PARSER
 *
 * Receives inbound emails from SendGrid/Postmark webhook
 * Parses Hagerty bid notification emails
 * Inserts bids into external_auction_bids table
 *
 * Email types handled:
 * - "New bid on [vehicle]" - bid notification
 * - "You've been outbid on [vehicle]" - outbid notification
 * - "Auction ending soon" - reminder (extract current bid)
 * - "Auction ended" - final result
 *
 * Webhook setup:
 * 1. Create email: bids@yourdomain.com
 * 2. Forward to SendGrid Inbound Parse or Postmark Inbound
 * 3. Configure webhook URL: https://[project].supabase.co/functions/v1/hagerty-email-parser
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedBid {
  auction_url: string;
  auction_uuid: string;
  vehicle_title: string;
  bid_amount: number;
  bidder_username: string | null;
  is_outbid: boolean;
  is_auction_ended: boolean;
  winning_bid: boolean;
  email_timestamp: string;
}

// Extract auction URL from email
function extractAuctionUrl(html: string, text: string): string | null {
  // Try HTML first - look for View Auction link
  const htmlPatterns = [
    /href="(https:\/\/www\.hagerty\.com\/marketplace\/auction\/[^"]+)"/i,
    /href="(https:\/\/hagerty\.com\/marketplace\/auction\/[^"]+)"/i,
  ];

  for (const pattern of htmlPatterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }

  // Try text version
  const textPatterns = [
    /(https:\/\/www\.hagerty\.com\/marketplace\/auction\/[^\s]+)/i,
    /(https:\/\/hagerty\.com\/marketplace\/auction\/[^\s]+)/i,
  ];

  for (const pattern of textPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// Extract auction UUID from URL
function extractAuctionUuid(url: string): string | null {
  // URL format: /marketplace/auction/TITLE/UUID
  const match = url.match(/\/auction\/[^\/]+\/([a-f0-9-]+(?:[A-Za-z0-9]+)?)\/?$/i);
  return match ? match[1] : null;
}

// Extract bid amount from email
function extractBidAmount(html: string, text: string): number | null {
  const combined = html + ' ' + text;
  let highestBid = 0;

  // Global pattern to find all dollar amounts
  const dollarPattern = /\$([0-9,]+)/g;
  let match;
  while ((match = dollarPattern.exec(combined)) !== null) {
    const amount = parseInt(match[1].replace(/,/g, ''));
    if (amount > highestBid && amount < 100000000) { // Sanity check
      highestBid = amount;
    }
  }

  return highestBid > 0 ? highestBid : null;
}

// Extract bidder username from email
function extractBidderUsername(html: string, text: string): string | null {
  const patterns = [
    /([A-Za-z0-9_-]+)\s+placed\s+a\s+bid/i,
    /bid\s+(?:placed\s+)?by\s+([A-Za-z0-9_-]+)/i,
    /bidder[:\s]+([A-Za-z0-9_-]+)/i,
    /won\s+by\s+([A-Za-z0-9_-]+)/i,
  ];

  const combined = html + ' ' + text;

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match && match[1].length > 2 && match[1].length < 50) {
      return match[1];
    }
  }

  return null;
}

// Extract vehicle title from subject or body
function extractVehicleTitle(subject: string, html: string): string | null {
  // From subject: "New bid on 1967 Chevrolet Chevelle"
  const subjectMatch = subject.match(/(?:bid\s+on|outbid\s+on|ending\s+soon[:\s]+|ended[:\s]+)\s*(.+?)(?:\s*-\s*Hagerty)?$/i);
  if (subjectMatch) return subjectMatch[1].trim();

  // From HTML - look for vehicle title
  const htmlMatch = html.match(/<h[12][^>]*>([^<]*\d{4}[^<]+)<\/h[12]>/i);
  if (htmlMatch) return htmlMatch[1].trim();

  return null;
}

// Detect email type
function detectEmailType(subject: string, html: string, text: string): {
  isOutbid: boolean;
  isEnded: boolean;
  isNewBid: boolean;
} {
  const combined = (subject + ' ' + text).toLowerCase();

  return {
    isOutbid: combined.includes('outbid') || combined.includes('been outbid'),
    isEnded: combined.includes('auction ended') || combined.includes('sold for') || combined.includes('auction has ended'),
    isNewBid: combined.includes('new bid') || combined.includes('placed a bid'),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse incoming webhook
    // SendGrid sends multipart/form-data, Postmark sends JSON
    const contentType = req.headers.get('content-type') || '';

    let from = '';
    let subject = '';
    let html = '';
    let text = '';
    let messageId = '';
    let receivedAt = new Date().toISOString();

    if (contentType.includes('multipart/form-data')) {
      // SendGrid Inbound Parse format
      const formData = await req.formData();
      from = formData.get('from')?.toString() || '';
      subject = formData.get('subject')?.toString() || '';
      html = formData.get('html')?.toString() || '';
      text = formData.get('text')?.toString() || '';
      messageId = formData.get('Message-Id')?.toString() || '';
    } else {
      // Postmark or JSON format
      const body = await req.json();
      from = body.From || body.from || '';
      subject = body.Subject || body.subject || '';
      html = body.HtmlBody || body.html || '';
      text = body.TextBody || body.text || '';
      messageId = body.MessageID || body.messageId || '';
      receivedAt = body.Date || body.date || receivedAt;
    }

    console.log(`[hagerty-email] Received email from: ${from}, subject: ${subject}`);

    // Verify it's from Hagerty
    if (!from.toLowerCase().includes('hagerty')) {
      console.log('[hagerty-email] Ignoring non-Hagerty email');
      return new Response(JSON.stringify({
        success: true,
        ignored: true,
        reason: 'Not from Hagerty'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Extract auction URL
    const auctionUrl = extractAuctionUrl(html, text);
    if (!auctionUrl) {
      console.log('[hagerty-email] No auction URL found in email');
      return new Response(JSON.stringify({
        success: true,
        ignored: true,
        reason: 'No auction URL found'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const auctionUuid = extractAuctionUuid(auctionUrl);
    const bidAmount = extractBidAmount(html, text);
    const bidderUsername = extractBidderUsername(html, text);
    const vehicleTitle = extractVehicleTitle(subject, html);
    const emailType = detectEmailType(subject, html, text);

    console.log(`[hagerty-email] Parsed: ${vehicleTitle}, $${bidAmount}, bidder: ${bidderUsername}, url: ${auctionUrl}`);

    if (!bidAmount) {
      console.log('[hagerty-email] No bid amount found');
      return new Response(JSON.stringify({
        success: true,
        ignored: true,
        reason: 'No bid amount found'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Find the external_listing
    const { data: listing, error: listingError } = await supabase
      .from('external_listings')
      .select('id, vehicle_id, current_bid, bid_count')
      .eq('platform', 'hagerty')
      .or(`listing_url.ilike.%${auctionUuid}%,listing_id.eq.${auctionUuid}`)
      .limit(1)
      .maybeSingle();

    if (listingError || !listing) {
      console.log(`[hagerty-email] Listing not found for UUID: ${auctionUuid}`);
      // Still save the bid with null listing reference - we can link later
    }

    // Upsert bidder to external_identities
    let bidderIdentityId: string | null = null;
    if (bidderUsername) {
      const { data: identity, error: identityError } = await supabase
        .from('external_identities')
        .upsert({
          platform: 'hagerty',
          handle: bidderUsername,
          display_name: bidderUsername,
          first_seen_at: receivedAt,
          last_seen_at: receivedAt,
          metadata: {
            first_seen_as_bidder: auctionUrl,
          },
        }, { onConflict: 'platform,handle' })
        .select('id')
        .single();

      if (!identityError && identity) {
        bidderIdentityId = identity.id;
        console.log(`[hagerty-email] Upserted bidder identity: ${bidderUsername} -> ${bidderIdentityId}`);
      }
    }

    // Insert bid record
    const { data: bid, error: bidError } = await supabase
      .from('external_auction_bids')
      .upsert({
        external_listing_id: listing?.id || null,
        vehicle_id: listing?.vehicle_id || null,
        platform: 'hagerty',
        bid_amount: bidAmount,
        bid_timestamp: receivedAt,
        bidder_username: bidderUsername,
        bidder_external_identity_id: bidderIdentityId,
        is_winning_bid: emailType.isEnded,
        source: 'email_webhook',
        source_email_id: messageId,
        raw_data: {
          from,
          subject,
          auction_url: auctionUrl,
          auction_uuid: auctionUuid,
          vehicle_title: vehicleTitle,
          email_type: emailType,
        },
      }, {
        onConflict: 'external_listing_id,bid_amount,bidder_username,bid_timestamp',
        ignoreDuplicates: true
      })
      .select('id')
      .single();

    if (bidError) {
      // Might be duplicate, that's OK
      console.log(`[hagerty-email] Bid insert: ${bidError.message}`);
    } else {
      console.log(`[hagerty-email] Saved bid: ${bid?.id}`);
    }

    // Update external_listing with new bid info
    if (listing && bidAmount > (listing.current_bid || 0)) {
      await supabase
        .from('external_listings')
        .update({
          current_bid: bidAmount,
          bid_count: (listing.bid_count || 0) + 1,
          listing_status: emailType.isEnded ? 'sold' : 'active',
          final_price: emailType.isEnded ? bidAmount : null,
          updated_at: receivedAt,
        })
        .eq('id', listing.id);

      console.log(`[hagerty-email] Updated listing current_bid to $${bidAmount}`);
    }

    return new Response(JSON.stringify({
      success: true,
      parsed: {
        auction_url: auctionUrl,
        auction_uuid: auctionUuid,
        vehicle_title: vehicleTitle,
        bid_amount: bidAmount,
        bidder_username: bidderUsername,
        email_type: emailType,
      },
      listing_id: listing?.id,
      bid_id: bid?.id,
      bidder_identity_id: bidderIdentityId,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: any) {
    console.error('[hagerty-email] Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
