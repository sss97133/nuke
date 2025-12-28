// ONE function to extract EVERYTHING from a BaT listing
// BaT is a simple WordPress site - every listing has the same structure

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BatComment {
  type: 'bid' | 'observation' | 'question' | 'seller_response';
  author_username: string;
  is_seller: boolean;
  posted_at: string | null;
  text: string;
  bid_amount: number | null;
  likes: number;
}

interface BatExtracted {
  url: string;
  title: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  location: string | null;
  // Specs
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
  // Auction data
  seller_username: string | null;
  buyer_username: string | null;
  sale_price: number | null;
  high_bid: number | null;
  bid_count: number;
  comment_count: number;
  view_count: number;
  auction_end_date: string | null;
  description: string | null;
  vehicle_id?: string;
  image_urls: string[];
  comments: BatComment[];
}

// VIN patterns by manufacturer - covers 99% of vehicles on BaT
const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,       // US/Canada/Mexico (1-5)
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,           // Japan
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,           // Korea
  /\b(L[A-HJ-NPR-Z0-9]{16})\b/g,           // China
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,           // UK
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,           // Germany
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,           // Sweden/Belgium
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,           // Italy
  /\b(WP0[A-Z0-9]{14})\b/g,                // Porsche
  /\b(WDB[A-Z0-9]{14})\b/g,                // Mercedes
  /\b(WVW[A-Z0-9]{14})\b/g,                // VW
  /\b(WBA[A-Z0-9]{14})\b/g,                // BMW
  /\b(WAU[A-Z0-9]{14})\b/g,                // Audi
  /\b(ZFF[A-Z0-9]{14})\b/g,                // Ferrari
  /\b(ZAM[A-Z0-9]{14})\b/g,                // Maserati
  /\b(SCFZ[A-Z0-9]{13})\b/g,               // Aston Martin
  /\b(SAJ[A-Z0-9]{14})\b/g,                // Jaguar
  /\b(SAL[A-Z0-9]{14})\b/g,                // Land Rover
];

function extractVin(html: string): string | null {
  for (const pattern of VIN_PATTERNS) {
    const matches = html.match(pattern);
    if (matches && matches.length > 0) {
      // Return the most common VIN (in case of noise)
      const counts: Record<string, number> = {};
      for (const m of matches) {
        counts[m] = (counts[m] || 0) + 1;
      }
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    }
  }
  return null;
}

function extractTitle(html: string): { title: string | null; year: number | null; make: string | null; model: string | null } {
  // BaT title is always in <h1 class="post-title">
  const h1Match = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([^<]+)</i);
  let title = h1Match?.[1]?.trim() || null;
  
  if (!title) return { title: null, year: null, make: null, model: null };
  
  // Clean BaT-specific suffixes from title
  title = title
    .replace(/\s+for sale on BaT Auctions.*$/i, '')
    .replace(/\s+on BaT Auctions.*$/i, '')
    .replace(/\s*\|.*Bring a Trailer.*$/i, '')
    .replace(/\s*\(Lot #[\d,]+\).*$/i, '')
    .trim();
  
  // Parse year from title
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  
  // Everything after the year is make + model
  if (year) {
    const afterYear = title.slice(title.indexOf(yearMatch![0]) + yearMatch![0].length).trim();
    const parts = afterYear.split(/\s+/);
    const make = parts[0] || null;
    const model = parts.slice(1).join(' ') || null;
    return { title, year, make, model };
  }
  
  return { title, year: null, make: null, model: null };
}

function extractAuctionData(html: string): {
  seller_username: string | null;
  buyer_username: string | null;
  sale_price: number | null;
  high_bid: number | null;
  bid_count: number;
  comment_count: number;
  auction_end_date: string | null;
} {
  // Look for seller in essentials or common patterns
  const sellerMatch = html.match(/Sold by\s+<a[^>]*>([^<]+)</i) || 
                      html.match(/"authorName":"([^"]+)\s*\(The Seller\)"/);
  const seller_username = sellerMatch?.[1] || null;
  
  // Buyer is in the final bid comment
  const buyerMatch = html.match(/Sold[^"]*to\s+<a[^>]*>([^<]+)</i) ||
                     html.match(/Sold[^"]*for[^"]*to\s+([A-Za-z0-9_]+)/i);
  const buyer_username = buyerMatch?.[1] || null;
  
  // Sale price
  const priceMatch = html.match(/Sold for[^$]*\$([0-9,]+)/i) ||
                     html.match(/Winning Bid[^$]*\$([0-9,]+)/i);
  const sale_price = priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null;
  
  // High bid (for unsold)
  const bidMatch = html.match(/Current Bid[^$]*\$([0-9,]+)/i) ||
                   html.match(/High Bid[^$]*\$([0-9,]+)/i);
  const high_bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;
  
  // Bid count - from the JSON blob
  const bidCountMatch = html.match(/"type":"bat-bid"/g);
  const bid_count = bidCountMatch ? bidCountMatch.length : 0;
  
  // Comment count - count non-bid comments
  const commentCountMatch = html.match(/"type":"comment"/g);
  const comment_count = commentCountMatch ? commentCountMatch.length : 0;
  
  // Auction end date
  const endMatch = html.match(/data-ends="(\d+)"/);
  let auction_end_date: string | null = null;
  if (endMatch) {
    const timestamp = parseInt(endMatch[1]);
    auction_end_date = new Date(timestamp * 1000).toISOString().split('T')[0];
  }
  
  return { seller_username, buyer_username, sale_price, high_bid, bid_count, comment_count, auction_end_date };
}

function extractViewCount(html: string): number {
  const viewMatch = html.match(/data-stats-item="views">([0-9,]+)/);
  return viewMatch ? parseInt(viewMatch[1].replace(/,/g, '')) : 0;
}

function extractLocation(html: string): string | null {
  // Location is in the group-item: "Location</strong>Located in United States"
  const locMatch = html.match(/Location<\/strong>Located in ([^<]+)/i) ||
                   html.match(/group-title-label">Location<\/strong>([^<]+)/i) ||
                   html.match(/title="Listing location"[^>]*>([^<]+)</i);
  return locMatch?.[1]?.trim() || null;
}

// Extract specs from BaT description text (more reliable than parsing HTML structure)
function extractSpecs(html: string): {
  mileage: number | null;
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  drivetrain: string | null;
  engine: string | null;
  body_style: string | null;
} {
  // First, extract the description text for cleaner matching
  const descMatch = html.match(/<div[^>]*class="post-excerpt"[^>]*>([\s\S]*?)<\/div>\s*<script/i);
  const descText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ') : html;
  
  // Mileage - from description patterns
  let mileage: number | null = null;
  const mileagePatterns = [
    /odometer\s+(?:indicates|shows|reads)\s+([0-9,]+)\s*k?\s*miles/i,
    /([0-9,]+)\s*k?\s*miles\s+(?:are|were)\s+(?:shown|indicated)/i,
    /shows?\s+([0-9,]+)\s*k?\s*miles/i,
    /([0-9,]+)\s*k\s+miles/i,
  ];
  for (const pattern of mileagePatterns) {
    const match = descText.match(pattern);
    if (match) {
      let num = parseInt(match[1].replace(/,/g, ''));
      // Handle "18k" notation
      if (match[0].toLowerCase().includes('k') && num < 1000) {
        num = num * 1000;
      }
      mileage = num;
      break;
    }
  }
  
  // Exterior color - "finished in X Metallic" or "X paint"
  let exterior_color: string | null = null;
  const colorMatch = descText.match(/finished in ([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}(?:\s+Metallic)?)/i);
  if (colorMatch) {
    exterior_color = colorMatch[1].trim();
  }
  
  // Interior color - "X leather" or "X and Y leather interior"
  let interior_color: string | null = null;
  const intMatch = descText.match(/(?:trimmed in|upholstered in)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:and\s+[A-Z][a-zA-Z]+\s+)?leather/i) ||
                   descText.match(/([A-Z][a-zA-Z]+(?:\s+Beige|Black|Brown|Tan|Red)?)\s+leather\s+interior/i);
  if (intMatch) {
    interior_color = intMatch[1].trim();
  }
  
  // Transmission - from description
  let transmission: string | null = null;
  if (descText.match(/PDK|dual-clutch/i)) {
    const speedMatch = descText.match(/(\d+)-speed\s+PDK/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed PDK` : 'PDK Dual-Clutch';
  } else if (descText.match(/(\d)-speed\s+manual/i)) {
    const speedMatch = descText.match(/(\d)-speed\s+manual/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Manual` : 'Manual';
  } else if (descText.match(/automatic\s+transaxle|automatic\s+transmission/i)) {
    const speedMatch = descText.match(/(\d+)-speed\s+(?:automatic|transaxle)/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Automatic` : 'Automatic';
  }
  
  // Drivetrain - explicit patterns only
  let drivetrain: string | null = null;
  if (descText.match(/\ball[- ]wheel[- ]drive\b/i) || descText.match(/\bAWD\b/) || descText.match(/\bfour[- ]wheel[- ]drive\b/i)) {
    drivetrain = 'AWD';
  } else if (descText.match(/\brear[- ]wheel[- ]drive\b/i) || descText.match(/\bRWD\b/)) {
    drivetrain = 'RWD';
  } else if (descText.match(/\bfront[- ]wheel[- ]drive\b/i) || descText.match(/\bFWD\b/)) {
    drivetrain = 'FWD';
  }
  
  // Engine - from description
  let engine: string | null = null;
  const engineMatch = descText.match(/(twin-turbocharged|turbocharged|supercharged|naturally-aspirated)?\s*([0-9.]+)[- ]?(?:liter|L)\s+(flat-six|flat-four|V6|V8|V10|V12|inline-four|inline-six|I4|I6|straight-six)/i);
  if (engineMatch) {
    const [, turbo, displacement, config] = engineMatch;
    engine = `${turbo ? turbo + ' ' : ''}${displacement}L ${config}`.trim();
  }
  
  // Body style - from title in HTML
  let body_style: string | null = null;
  const titleMatch = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([^<]+)</i);
  const title = titleMatch?.[1]?.toLowerCase() || descText.toLowerCase();
  
  if (title.includes('coupe')) body_style = 'Coupe';
  else if (title.includes('convertible') || title.includes('cabriolet') || title.includes('roadster') || title.includes('spyder') || title.includes('targa')) body_style = 'Convertible';
  else if (title.includes('sedan')) body_style = 'Sedan';
  else if (title.includes('wagon') || title.includes('estate') || title.includes('avant') || title.includes('touring')) body_style = 'Wagon';
  else if (title.includes('suv') || title.includes('crossover')) body_style = 'SUV';
  else if (title.includes('hatchback')) body_style = 'Hatchback';
  else if (title.includes('pickup') || title.includes('truck')) body_style = 'Truck';
  
  return {
    mileage,
    exterior_color,
    interior_color,
    transmission,
    drivetrain,
    engine,
    body_style,
  };
}

function extractDescription(html: string): string | null {
  // Description is in <div class="post-excerpt"> - contains multiple <p> tags
  const excerptMatch = html.match(/<div[^>]*class="post-excerpt"[^>]*>([\s\S]*?)<\/div>\s*<script/i);
  if (excerptMatch) {
    // Extract just the text from <p> tags
    const paragraphs = excerptMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || [];
    const text = paragraphs
      .map(p => p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(p => p.length > 0 && !p.includes('Carfax'))  // Skip carfax line
      .join('\n\n');
    return text.slice(0, 10000) || null;
  }
  return null;
}

function extractImages(html: string): string[] {
  // Images are in data-gallery-items JSON
  const galleryMatch = html.match(/data-gallery-items="([^"]+)"/);
  if (!galleryMatch) return [];
  
  try {
    // Decode HTML entities
    const json = galleryMatch[1]
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
    
    const items = JSON.parse(json);
    return items.map((item: any) => {
      // Get highest resolution
      const url = item?.full?.url || item?.large?.url || item?.small?.url;
      if (!url) return null;
      // Remove resize params to get full res
      return url.split('?')[0].replace(/-scaled\./, '.');
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function extractComments(html: string, sellerUsername: string | null): BatComment[] {
  // BaT comments are in a JSON array: "comments":[{...},{...}]
  const comments: BatComment[] = [];
  
  try {
    // Find the comments array in the HTML (it's embedded in a script or inline JSON)
    // Pattern: "comments":[{...},...,{...}]
    const commentsMatch = html.match(/"comments":\s*\[([\s\S]*?)\](?=,"[a-z])/);
    if (commentsMatch) {
      const arrayContent = '[' + commentsMatch[1] + ']';
      try {
        const parsed = JSON.parse(arrayContent);
        if (Array.isArray(parsed)) {
          for (const c of parsed) {
            const author = String(c?.authorName || '').replace(/\s*\(The Seller\)\s*/i, '').trim();
            const isSeller = String(c?.authorName || '').toLowerCase().includes('(the seller)') ||
                            (sellerUsername && author.toLowerCase() === sellerUsername.toLowerCase().trim());
            
            const timestamp = c?.timestamp ? new Date(c.timestamp * 1000).toISOString() : null;
            const text = String(c?.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const bidAmount = c?.type === 'bat-bid' && typeof c?.bidAmount === 'number' ? c.bidAmount : null;
            
            // Determine comment type based on content and author
            let commentType: 'bid' | 'observation' | 'question' | 'seller_response' = 'observation';
            if (bidAmount) {
              commentType = 'bid';
            } else if (isSeller) {
              commentType = 'seller_response';
            } else if (text.includes('?')) {
              commentType = 'question';
            }
            
            comments.push({
              type: commentType,
              author_username: author || 'Unknown',
              is_seller: isSeller,
              posted_at: timestamp,
              text,
              bid_amount: bidAmount,
              likes: typeof c?.likes === 'number' ? c.likes : 0,
            });
          }
        }
      } catch (e) {
        console.error('Failed to parse comments JSON:', e);
      }
    }
    
    // If no comments found via JSON, try individual object matching
    if (comments.length === 0) {
      const objectMatches = html.matchAll(/\{"channels":\[.*?"type":"(bat-bid|comment)".*?\}/g);
      for (const match of objectMatches) {
        try {
          const obj = JSON.parse(match[0]);
          const author = String(obj?.authorName || '').replace(/\s*\(The Seller\)\s*/i, '').trim();
          const isSeller = String(obj?.authorName || '').toLowerCase().includes('(the seller)') ||
                          (sellerUsername && author.toLowerCase() === sellerUsername.toLowerCase().trim());
          
          const text = String(obj?.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          const bidAmount = typeof obj?.bidAmount === 'number' ? obj.bidAmount : null;
          
          let commentType: 'bid' | 'observation' | 'question' | 'seller_response' = 'observation';
          if (bidAmount) {
            commentType = 'bid';
          } else if (isSeller) {
            commentType = 'seller_response';
          } else if (text.includes('?')) {
            commentType = 'question';
          }
          
          comments.push({
            type: commentType,
            author_username: author || 'Unknown',
            is_seller: isSeller,
            posted_at: obj?.timestamp ? new Date(obj.timestamp * 1000).toISOString() : null,
            text,
            bid_amount: bidAmount,
            likes: typeof obj?.likes === 'number' ? obj.likes : 0,
          });
        } catch { /* skip malformed */ }
      }
    }
  } catch (e) {
    console.error('Error extracting comments:', e);
  }
  
  console.log(`Extracted ${comments.length} comments/bids from HTML`);
  return comments;
}


async function extractBatListing(url: string): Promise<BatExtracted> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  
  const html = await response.text();
  
  const titleData = extractTitle(html);
  const auctionData = extractAuctionData(html);
  const specs = extractSpecs(html);
  const comments = extractComments(html, auctionData.seller_username);
  
  return {
    url,
    ...titleData,
    vin: extractVin(html),
    location: extractLocation(html),
    ...specs,
    ...auctionData,
    view_count: extractViewCount(html),
    description: extractDescription(html),
    image_urls: extractImages(html),
    comments,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db } = await req.json();
    
    if (!url || !url.includes('bringatrailer.com/listing/')) {
      return new Response(
        JSON.stringify({ error: 'Invalid BaT listing URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Extracting: ${url}`);
    const extracted = await extractBatListing(url);
    console.log(`Extracted: ${extracted.title} | VIN: ${extracted.vin} | $${extracted.sale_price}`);
    console.log(`Specs: ${extracted.mileage}mi | ${extracted.exterior_color} | ${extracted.transmission} | ${extracted.drivetrain}`);
    console.log(`Comments: ${extracted.comments.length} (${extracted.comments.filter(c => c.type === 'bid').length} bids)`);
    
    // Optionally save to database
    if (save_to_db) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      
      // Insert new vehicle (not upsert - start fresh)
      const { data, error } = await supabase
        .from('vehicles')
        .insert({
          bat_auction_url: extracted.url,
          year: extracted.year,
          make: extracted.make,
          model: extracted.model,
          vin: extracted.vin,
          bat_listing_title: extracted.title,
          bat_seller: extracted.seller_username,
          bat_buyer: extracted.buyer_username,
          sale_price: extracted.sale_price,
          high_bid: extracted.high_bid,
          bat_bids: extracted.bid_count,
          bat_comments: extracted.comment_count,
          bat_views: extracted.view_count,
          bat_location: extracted.location,
          // Specs extracted from listing
          mileage: extracted.mileage,
          color: extracted.exterior_color,
          interior_color: extracted.interior_color,
          transmission: extracted.transmission,
          drivetrain: extracted.drivetrain,
          engine_type: extracted.engine,
          body_style: extracted.body_style,
          // Standard fields
          description: extracted.description,
          auction_end_date: extracted.auction_end_date,
          listing_source: 'bat_simple_extract',
          profile_origin: 'bat_import',
          discovery_url: extracted.url,
          discovery_source: 'bat',
          is_public: true,
          sale_status: extracted.sale_price ? 'sold' : 'available',
        })
        .select()
        .single();
      
      if (error) {
        console.error('DB error:', error);
        throw new Error(`Failed to save vehicle: ${error.message}`);
      }
      
      console.log(`Saved vehicle: ${data.id}`);
      extracted.vehicle_id = data.id;
      
      // Save ALL images (BaT has great galleries - use them)
      if (extracted.image_urls.length > 0) {
        const imageRecords = extracted.image_urls.map((img_url, i) => ({
          vehicle_id: data.id,
          image_url: img_url,
          position: i,
          source: 'bat_import',
          is_external: true,
        }));
        
        const { error: imgError } = await supabase
          .from('vehicle_images')
          .insert(imageRecords);
        
        if (imgError) {
          console.error('Image save error:', imgError);
        } else {
          console.log(`Saved ${imageRecords.length} images`);
        }
      }
      
      // Add timeline events
      const events = [];
      if (extracted.auction_end_date) {
        // Listing event (day before end)
        const endDate = new Date(extracted.auction_end_date);
        const listDate = new Date(endDate);
        listDate.setDate(listDate.getDate() - 7); // Assume 7-day auction
        
        events.push({
          vehicle_id: data.id,
          event_type: 'auction_listed',
          event_date: listDate.toISOString().split('T')[0],
          title: 'Listed on Bring a Trailer',
          description: `Listed by ${extracted.seller_username || 'seller'}`,
          source: 'bat_import',
        });
        
        // Sold event
        if (extracted.sale_price) {
          events.push({
            vehicle_id: data.id,
            event_type: 'auction_sold',
            event_date: extracted.auction_end_date,
            title: 'Sold at Auction',
            description: `Sold for $${extracted.sale_price.toLocaleString()} with ${extracted.bid_count} bids. Buyer: ${extracted.buyer_username || 'unknown'}`,
            source: 'bat_import',
          });
        }
      }
      
      if (events.length > 0) {
        await supabase.from('timeline_events').insert(events);
        console.log(`Created ${events.length} timeline events`);
      }
      
      // Save comments and bids
      if (extracted.comments.length > 0) {
        const commentRecords = extracted.comments.map((c, i) => ({
          vehicle_id: data.id,
          platform: 'bat',
          source_url: extracted.url,
          comment_type: c.type,
          sequence_number: i + 1,
          author_username: c.author_username,
          is_seller: c.is_seller,
          posted_at: c.posted_at,
          comment_text: c.text,
          bid_amount: c.bid_amount,
          comment_likes: c.likes,
        }));
        
        // Insert in batches of 100
        for (let i = 0; i < commentRecords.length; i += 100) {
          const batch = commentRecords.slice(i, i + 100);
          const { error: commentError } = await supabase
            .from('auction_comments')
            .insert(batch);
          
          if (commentError) {
            console.error('Comment save error:', commentError);
          }
        }
        console.log(`Saved ${commentRecords.length} comments/bids`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, extracted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

