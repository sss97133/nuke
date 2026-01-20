// ONE function to extract EVERYTHING from a BaT listing
// BaT is a simple WordPress site - every listing has the same structure

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchBatPage, logFetchCost, type FetchResult } from '../_shared/batFetcher.ts';
import { normalizeListingUrlKey } from '../_shared/listingUrl.ts';

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
  watcher_count: number;
  lot_number: string | null;
  reserve_status: string | null;
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&#x([a-fA-F0-9]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&times;/g, '×')
    .replace(/&#215;/g, '×');
}

function extractTitle(html: string): { title: string | null; year: number | null; make: string | null; model: string | null } {
  // BaT title is always in <h1 class="post-title">
  const h1Match = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([^<]+)</i);
  let title = h1Match?.[1]?.trim() || null;
  
  if (!title) return { title: null, year: null, make: null, model: null };
  
  // Decode HTML entities (like &#215; -> ×)
  title = decodeHtmlEntities(title);
  
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
  view_count: number;
  watcher_count: number;
  lot_number: string | null;
  auction_end_date: string | null;
  reserve_status: string | null;
} {
  // Seller - multiple patterns (ordered by reliability)
  // Pattern 1: BaT History "Sold by <strong>username</strong>"
  // Pattern 2: Essentials ">Seller</strong>: <a>username</a>"
  // Pattern 3: From comments "(The Seller)"
  const sellerMatch = html.match(/Sold by <strong>([^<]+)<\/strong>/i) ||
                      html.match(/>Seller<\/strong>:\s*<a[^>]*>([^<]+)<\/a>/i) ||
                      html.match(/"authorName":"([^"]+)\s*\(The Seller\)"/);
  const seller_username = sellerMatch?.[1]?.trim() || null;
  
  // Buyer - from BaT History "to <strong>username</strong> for"
  const buyerMatch = html.match(/to <strong>([^<]+)<\/strong> for/i) ||
                     html.match(/<a[^>]*href="[^"]*\/member\/([^"\/]+)\/"[^>]*target="_blank">([^<]+)<\/a>\s*<\/span>\s*<\/div>\s*<div class="identifier">This Listing/i);
  const buyer_username = buyerMatch?.[1]?.trim() || null;
  
  // Sale price - "Sold for <strong>USD $6,954</strong>" or "for <strong>USD $6,954.00</strong>"
  // Extract full price string first, then parse
  const priceMatch = html.match(/Sold for\s*<strong>USD \$([0-9,]+(?:\.\d{2})?)/i) ||
                     html.match(/for <strong>USD \$([0-9,]+(?:\.\d{2})?)<\/strong>/i) ||
                     html.match(/Sold for[^$]*\$([0-9,]+)/i);
  let sale_price: number | null = null;
  if (priceMatch) {
    // Remove commas and parse - ignore cents
    const priceStr = priceMatch[1].replace(/,/g, '').split('.')[0];
    sale_price = parseInt(priceStr);
  }
  
  // High bid (for active/unsold auctions)
  const bidMatch = html.match(/Current Bid[^$]*\$([0-9,]+)/i) ||
                   html.match(/High Bid[^$]*\$([0-9,]+)/i);
  const high_bid = bidMatch ? parseInt(bidMatch[1].replace(/,/g, '')) : null;
  
  // Bid count - from JSON blob (more accurate than counting)
  const bidCountMatch = html.match(/"type":"bat-bid"/g);
  const bid_count = bidCountMatch ? bidCountMatch.length : 0;
  
  // Comment count - from header "<span class="info-value">26</span><span class="info-label">Comments</span>"
  const commentHeaderMatch = html.match(/<span class="info-value">(\d+)<\/span>\s*<span class="info-label">Comments<\/span>/i);
  const comment_count = commentHeaderMatch ? parseInt(commentHeaderMatch[1]) : 0;
  
  // Views - "data-stats-item="views">26,541 views"
  const viewMatch = html.match(/data-stats-item="views">([0-9,]+)/);
  const view_count = viewMatch ? parseInt(viewMatch[1].replace(/,/g, '')) : 0;
  
  // Watchers - "data-stats-item="watchers">982 watchers"
  const watcherMatch = html.match(/data-stats-item="watchers">([0-9,]+)/);
  const watcher_count = watcherMatch ? parseInt(watcherMatch[1].replace(/,/g, '')) : 0;
  
  // Lot number - "<strong>Lot</strong> #225044"
  const lotMatch = html.match(/<strong>Lot<\/strong>\s*#([0-9,]+)/i);
  const lot_number = lotMatch ? lotMatch[1].replace(/,/g, '') : null;
  
  // Reserve status - look for "No Reserve" badge or reserve not met
  let reserve_status: string | null = null;
  if (html.includes('no-reserve') || html.includes('No Reserve')) {
    reserve_status = 'no_reserve';
  } else if (html.includes('Reserve Not Met') || html.includes('reserve-not-met')) {
    reserve_status = 'reserve_not_met';
  } else if (html.includes('Reserve Met') || sale_price) {
    reserve_status = 'reserve_met';
  }
  
  // Auction end date - from data-ends timestamp or from "on 12/27/25" text
  // NOTE: auction_end_date column is DATE type, so we store date only
  // Full timestamp is stored in auction_end_timestamp for accurate countdowns
  let auction_end_date: string | null = null;
  let auction_end_timestamp: string | null = null;  // Full ISO timestamp for timers

  // Try data-ends (Unix timestamp)
  const endMatch = html.match(/data-ends="(\d+)"/) || html.match(/data-until="(\d+)"/);
  if (endMatch) {
    const timestamp = parseInt(endMatch[1]);
    const endDate = new Date(timestamp * 1000);
    auction_end_date = endDate.toISOString().split('T')[0];  // YYYY-MM-DD for DATE column
    auction_end_timestamp = endDate.toISOString();  // Full timestamp for timers
  } else {
    // Try to parse from "on 12/27/25" format
    const dateMatch = html.match(/on (\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
    if (dateMatch) {
      const [, month, day, year] = dateMatch;
      auction_end_date = `20${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      // No exact time available from text format
    }
  }
  
  return { 
    seller_username, 
    buyer_username, 
    sale_price, 
    high_bid, 
    bid_count, 
    comment_count, 
    view_count,
    watcher_count,
    lot_number,
    auction_end_date,
    reserve_status
  };
}

// View count is now extracted in extractAuctionData for consistency

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
  
  // Exterior color - multiple BaT patterns
  // "finished in X Metallic", "wears X paint", "painted X"
  let exterior_color: string | null = null;
  const colorPatterns = [
    /finished in ([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}(?:\s+Metallic)?)/i,
    /wears ([A-Za-z]+(?:\s+[A-Za-z-]+)?)\s+(?:camouflage[- ]?style\s+)?paint/i,
    /wears ([A-Za-z]+)\s+camouflage/i,
    /painted (?:in )?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/i,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:over|exterior|paint)/i,
  ];
  for (const pattern of colorPatterns) {
    const match = descText.match(pattern);
    if (match && match[1].length < 30) {
      const colorRaw = match[1].trim().toLowerCase();
      // Skip garbage matches
      if (colorRaw.includes('mounted') || colorRaw.includes('wheel') || colorRaw.includes('and')) continue;
      // Capitalize first letter of each word
      exterior_color = colorRaw
        .split(/[\s-]+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      break;
    }
  }
  
  // Interior color - "X leather" or "X and Y leather interior"
  let interior_color: string | null = null;
  const intMatch = descText.match(/(?:trimmed in|upholstered in)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:and\s+[A-Z][a-zA-Z]+\s+)?leather/i) ||
                   descText.match(/([A-Z][a-zA-Z]+(?:\s+Beige|Black|Brown|Tan|Red)?)\s+leather\s+interior/i);
  if (intMatch) {
    interior_color = intMatch[1].trim();
  }
  
  // Transmission - from description or title
  let transmission: string | null = null;
  
  // Extract title from HTML for checking (often has "4-Speed" etc)
  const titleMatch = html.match(/<h1[^>]*class="[^"]*post-title[^"]*"[^>]*>([^<]+)</i);
  const title = titleMatch?.[1] || '';
  const fullText = title + ' ' + descText;
  
  if (fullText.match(/PDK|dual-clutch/i)) {
    const speedMatch = fullText.match(/(\d+)-speed\s+PDK/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed PDK` : 'PDK Dual-Clutch';
  } else if (fullText.match(/(\d+)[- ]speed\s+manual/i)) {
    const speedMatch = fullText.match(/(\d+)[- ]speed\s+manual/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Manual` : 'Manual';
  } else if (fullText.match(/(\d+)[- ]speed/i) && !fullText.match(/automatic/i)) {
    // Title often just has "4-Speed" meaning manual
    const speedMatch = fullText.match(/(\d+)[- ]speed/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Manual` : 'Manual';
  } else if (fullText.match(/automatic/i)) {
    const speedMatch = fullText.match(/(\d+)-speed\s+automatic/i);
    transmission = speedMatch ? `${speedMatch[1]}-Speed Automatic` : 'Automatic';
  } else if (fullText.match(/manual\s+transmission/i)) {
    transmission = 'Manual';
  }
  
  // Drivetrain - explicit patterns (check title too)
  let drivetrain: string | null = null;
  const driveText = fullText; // Already includes title + description
  
  // 4x4 / 4WD patterns (common in trucks/SUVs)
  if (driveText.match(/\b4[x×]4\b/i) || driveText.match(/\b4WD\b/i) || driveText.match(/\bfour[- ]wheel[- ]drive\b/i)) {
    drivetrain = '4WD';
  } else if (driveText.match(/\ball[- ]wheel[- ]drive\b/i) || driveText.match(/\bAWD\b/)) {
    drivetrain = 'AWD';
  } else if (driveText.match(/\brear[- ]wheel[- ]drive\b/i) || driveText.match(/\bRWD\b/)) {
    drivetrain = 'RWD';
  } else if (driveText.match(/\bfront[- ]wheel[- ]drive\b/i) || driveText.match(/\bFWD\b/)) {
    drivetrain = 'FWD';
  }
  
  // Engine - from description
  let engine: string | null = null;
  const engineMatch = descText.match(/(twin-turbocharged|turbocharged|supercharged|naturally-aspirated)?\s*([0-9.]+)[- ]?(?:liter|L)\s+(flat-six|flat-four|V6|V8|V10|V12|inline-four|inline-six|I4|I6|straight-six)/i);
  if (engineMatch) {
    const [, turbo, displacement, config] = engineMatch;
    engine = `${turbo ? turbo + ' ' : ''}${displacement}L ${config}`.trim();
  }
  
  // Body style - from title (already extracted above)
  let body_style: string | null = null;
  const titleLower = title.toLowerCase() || descText.toLowerCase();
  
  if (titleLower.includes('coupe')) body_style = 'Coupe';
  else if (titleLower.includes('convertible') || titleLower.includes('cabriolet') || titleLower.includes('roadster') || titleLower.includes('spyder') || titleLower.includes('targa')) body_style = 'Convertible';
  else if (titleLower.includes('sedan')) body_style = 'Sedan';
  else if (titleLower.includes('wagon') || titleLower.includes('estate') || titleLower.includes('avant') || titleLower.includes('touring') || titleLower.includes('suburban')) body_style = 'Wagon';
  else if (titleLower.includes('suv') || titleLower.includes('crossover')) body_style = 'SUV';
  else if (titleLower.includes('hatchback')) body_style = 'Hatchback';
  else if (titleLower.includes('pickup') || titleLower.includes('truck')) body_style = 'Truck';
  
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


// Store the last fetch result for cost logging
let lastFetchResult: FetchResult | null = null;

async function extractBatListing(url: string): Promise<BatExtracted> {
  // Use the transparent hybrid fetcher (tries direct first, falls back to Firecrawl if rate limited)
  const fetchResult = await fetchBatPage(url);
  lastFetchResult = fetchResult;  // Store for cost logging
  
  if (!fetchResult.html) {
    throw new Error(`Failed to fetch ${url}: ${fetchResult.error || 'unknown error'}`);
  }
  
  const html = fetchResult.html;
  
  const titleData = extractTitle(html);
  const auctionData = extractAuctionData(html);
  const specs = extractSpecs(html);
  // Comments extraction removed - use extract-auction-comments function instead
  // const comments = extractComments(html, auctionData.seller_username);
  
  return {
    url,
    ...titleData,
    vin: extractVin(html),
    location: extractLocation(html),
    ...specs,
    seller_username: auctionData.seller_username,
    buyer_username: auctionData.buyer_username,
    sale_price: auctionData.sale_price,
    high_bid: auctionData.high_bid,
    bid_count: auctionData.bid_count,
    comment_count: auctionData.comment_count,
    view_count: auctionData.view_count,
    watcher_count: auctionData.watcher_count,
    lot_number: auctionData.lot_number,
    reserve_status: auctionData.reserve_status,
    auction_end_date: auctionData.auction_end_date,
    description: extractDescription(html),
    image_urls: extractImages(html),
    comments: [], // Empty - comments extracted separately via extract-auction-comments
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url, save_to_db, vehicle_id } = await req.json();
    
    if (!url || !url.includes('bringatrailer.com/listing/')) {
      return new Response(
        JSON.stringify({ error: 'Invalid BaT listing URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Always create supabase client for cost logging
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    console.log(`Extracting: ${url}`);
    const extracted = await extractBatListing(url);
    
    // Log fetch cost if Firecrawl was used (transparent cost tracking)
    if (lastFetchResult) {
      await logFetchCost(supabase, 'bat-simple-extract', url, lastFetchResult);
      console.log(`=== FETCH SOURCE: ${lastFetchResult.source.toUpperCase()} (cost: ${lastFetchResult.costCents} cents) ===`);
    }
    
    console.log(`=== EXTRACTION RESULTS ===`);
    console.log(`Title: ${extracted.title}`);
    console.log(`Year/Make/Model: ${extracted.year} ${extracted.make} ${extracted.model}`);
    console.log(`VIN: ${extracted.vin || 'NOT FOUND'}`);
    console.log(`Lot #: ${extracted.lot_number || 'NOT FOUND'}`);
    console.log(`Sale Price: $${extracted.sale_price?.toLocaleString() || 'N/A'}`);
    console.log(`Seller: @${extracted.seller_username || 'NOT FOUND'}`);
    console.log(`Buyer: @${extracted.buyer_username || 'NOT FOUND'}`);
    console.log(`Views: ${extracted.view_count} | Watchers: ${extracted.watcher_count}`);
    console.log(`Bids: ${extracted.bid_count} | Comments: ${extracted.comment_count}`);
    console.log(`Reserve: ${extracted.reserve_status || 'unknown'}`);
    console.log(`Specs: ${extracted.mileage || '?'}mi | ${extracted.exterior_color || '?'} | ${extracted.transmission || '?'} | ${extracted.drivetrain || '?'}`);
    console.log(`Images: ${extracted.image_urls.length} | Parsed comments: ${extracted.comments.length}`);
    
    // Optionally save to database
    if (save_to_db || vehicle_id) {
      let targetVehicleId = vehicle_id;
      
      // If vehicle_id provided, update existing vehicle; otherwise create new
      if (vehicle_id) {
        // Update existing vehicle
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            bat_auction_url: extracted.url,
            bat_listing_title: extracted.title,
            bat_seller: extracted.seller_username,
            bat_buyer: extracted.buyer_username,
            sale_price: extracted.sale_price,
            high_bid: extracted.high_bid,
            bat_bids: extracted.bid_count,
            bat_comments: extracted.comment_count,
            bat_views: extracted.view_count,
            bat_watchers: extracted.watcher_count,
            bat_lot_number: extracted.lot_number,
            bat_location: extracted.location,
            reserve_status: extracted.reserve_status,
            mileage: extracted.mileage,
            color: extracted.exterior_color,
            interior_color: extracted.interior_color,
            transmission: extracted.transmission,
            drivetrain: extracted.drivetrain,
            engine_type: extracted.engine,
            body_style: extracted.body_style,
            description: extracted.description,
            auction_end_date: extracted.auction_end_date,
            sale_status: extracted.sale_price ? 'sold' : 'available',
            // Only update VIN if vehicle doesn't have one
            vin: extracted.vin || undefined,
          })
          .eq('id', vehicle_id);
        
        if (updateError) {
          console.error('Vehicle update error:', updateError);
          throw new Error(`Failed to update vehicle: ${updateError.message}`);
        }
        
        console.log(`Updated vehicle: ${vehicle_id}`);
        extracted.vehicle_id = vehicle_id;
      } else {
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
            bat_watchers: extracted.watcher_count,
            bat_lot_number: extracted.lot_number,
            bat_location: extracted.location,
            reserve_status: extracted.reserve_status,
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
      }
      
      // Save ALL images (BaT has great galleries - use them)
      if (extracted.image_urls.length > 0 && extracted.vehicle_id) {
        const imageRecords = extracted.image_urls.map((img_url, i) => ({
          vehicle_id: extracted.vehicle_id,
          image_url: img_url,
          position: i,
          source: 'bat_import',
          is_external: true,
        }));
        
        const { error: imgError } = await supabase
          .from('vehicle_images')
          .upsert(imageRecords, {
            onConflict: 'vehicle_id,image_url',
            ignoreDuplicates: false
          });
        
        if (imgError) {
          console.error('Image save error:', imgError);
        } else {
          console.log(`Saved ${imageRecords.length} images`);
        }
      }
      
      // Create/update external_listings record for platform tracking
      if (extracted.vehicle_id) {
        const listingUrlKey = normalizeListingUrlKey(extracted.url);
        const listingIdFallback = (() => {
          const trimmed = String(extracted.url || '').trim().replace(/\/+$/, '');
          return trimmed.split('/').filter(Boolean).pop() || null;
        })();
        const { error: listingError } = await supabase
          .from('external_listings')
          .upsert({
            vehicle_id: extracted.vehicle_id,
            platform: 'bat',
            listing_url: extracted.url,
            listing_url_key: listingUrlKey,
            listing_id: extracted.lot_number || listingIdFallback || listingUrlKey,
            listing_status: extracted.sale_price ? 'sold' : 'ended',
            end_date: extracted.auction_end_date,
            final_price: extracted.sale_price,
            bid_count: extracted.bid_count,
            view_count: extracted.view_count,
            watcher_count: extracted.watcher_count,
            sold_at: extracted.sale_price ? extracted.auction_end_date : null,
            metadata: {
              lot_number: extracted.lot_number,
              seller_username: extracted.seller_username,
              buyer_username: extracted.buyer_username,
              reserve_status: extracted.reserve_status,
            },
          }, {
            onConflict: 'platform,listing_url_key'
          });
      
        if (listingError) {
          console.error('External listing save error:', listingError);
        } else {
          console.log(`Created/updated external_listings record`);
        }
      }
      
      // Add timeline events
      const events = [];
      if (extracted.auction_end_date) {
        // Listing event (7 days before end - standard BaT auction)
        const endDate = new Date(extracted.auction_end_date);
        const listDate = new Date(endDate);
        listDate.setDate(listDate.getDate() - 7);
        
        events.push({
          vehicle_id: extracted.vehicle_id,
          event_type: 'auction_listed',
          event_date: listDate.toISOString().split('T')[0],
          title: `Listed on Bring a Trailer (Lot #${extracted.lot_number || 'N/A'})`,
          description: `Listed by @${extracted.seller_username || 'seller'}. ${extracted.reserve_status === 'no_reserve' ? 'No Reserve.' : ''}`,
          source: 'bat_import',
          metadata: { lot_number: extracted.lot_number, seller: extracted.seller_username },
        });
        
        // Sold/Ended event
        if (extracted.sale_price) {
          events.push({
            vehicle_id: extracted.vehicle_id,
            event_type: 'auction_sold',
            event_date: extracted.auction_end_date,
            title: `Sold for $${extracted.sale_price.toLocaleString()}`,
            description: `Won by @${extracted.buyer_username || 'unknown'} with ${extracted.bid_count} bids. ${extracted.view_count.toLocaleString()} views, ${extracted.watcher_count.toLocaleString()} watchers.`,
            source: 'bat_import',
            metadata: { 
              lot_number: extracted.lot_number, 
              buyer: extracted.buyer_username,
              sale_price: extracted.sale_price,
              bid_count: extracted.bid_count,
              view_count: extracted.view_count,
              watcher_count: extracted.watcher_count,
            },
          });
        }
      }
      
      if (events.length > 0) {
        await supabase.from('timeline_events').insert(events);
        console.log(`Created ${events.length} timeline events`);
      }
      
      // NOTE: Comment extraction removed from bat-simple-extract
      // Comments should be extracted using extract-auction-comments function
      // which properly parses DOM, uses content_hash for deduplication, and links to auction_events
      // This function only extracts vehicle data, images, and metadata - NOT comments
    }

    return new Response(
      JSON.stringify({
        success: true,
        extracted,
        _fetch: lastFetchResult ? {
          source: lastFetchResult.source,
          cost_cents: lastFetchResult.costCents,
        } : null,
      }),
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

