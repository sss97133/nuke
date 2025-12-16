import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeListingLocation } from '../_shared/normalizeListingLocation.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ComprehensiveBaTData {
  // Basic vehicle info
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  mileage?: number;
  
  // Auction data
  auction_start_date?: string;
  auction_end_date?: string;
  sale_date?: string;
  sale_price?: number;
  reserve_price?: number;
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
  
  // Technical specs from essentials
  engine?: string;
  transmission?: string;
  drivetrain?: string;
  color?: string;
  interior_color?: string;
  body_style?: string;
  displacement?: string;
  
  // Location and parties
  location?: string;
  seller?: string;
  buyer?: string;
  lot_number?: string;
  
  // Other metadata
  description?: string;
  title?: string;
  url: string;
  
  // Auction timeline events (for detailed auction process)
  auction_timeline_events?: Array<{
    event_type: string;
    event_date: string;
    title: string;
    description: string;
    metadata: any;
  }>;
  
  // Bid history
  bid_history?: Array<{ amount: number; timestamp?: string; bidder?: string }>;
}

/**
 * Extract VIN using AI inspection as fallback
 */
async function extractVINWithAI(html: string, batUrl: string): Promise<string | undefined> {
  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      console.log('OpenAI API key not configured, skipping AI inspection');
      return undefined;
    }

    // Extract text from essentials div for AI analysis
    const essentialsStart = html.search(/<div[^>]*class="essentials"[^>]*>/i);
    let essentialsText = '';
    
    if (essentialsStart !== -1) {
      // Find matching closing tag
      let depth = 0;
      let pos = essentialsStart;
      let essentialsEnd = -1;
      
      while (pos < html.length) {
        const nextOpen = html.indexOf('<div', pos);
        const nextClose = html.indexOf('</div>', pos);
        
        if (nextClose === -1) break;
        
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          pos = nextClose + 6;
          if (depth === 0) {
            essentialsEnd = nextClose;
            break;
          }
        }
      }
      
      if (essentialsEnd > essentialsStart) {
        const essentialsHTML = html.substring(essentialsStart, essentialsEnd + 6);
        essentialsText = essentialsHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      }
    }

    // If no essentials text, use a sample of the HTML
    const textToAnalyze = essentialsText || html.substring(0, 5000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    console.log('Calling AI inspection to extract VIN from BaT listing...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert at extracting VIN (Vehicle Identification Number) or Chassis numbers from Bring a Trailer listings. VINs are ALWAYS in the BaT Essentials section. Extract the VIN/chassis number and return it.'
          },
          {
            role: 'user',
            content: `Extract the VIN or Chassis number from this BaT listing page content. The VIN/chassis is ALWAYS in the "BaT Essentials" section.

URL: ${batUrl}

Page content (focus on Essentials section):
${textToAnalyze}

Return JSON:
{
  "vin": "the VIN or chassis number found (8-17 characters, alphanumeric)",
  "found_in": "essentials|other",
  "confidence": 0-100
}

If no VIN/chassis is found, return {"vin": null, "confidence": 0}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 200
      })
    });

    if (!response.ok) {
      console.log(`AI inspection failed: ${response.status}`);
      return undefined;
    }

    const data = await response.json();
    const result = JSON.parse(data.choices[0].message.content);
    
    if (result.vin && result.vin.length >= 8 && result.vin.length <= 17 && !/[IOQ]/.test(result.vin.toUpperCase())) {
      const vin = result.vin.toUpperCase();
      console.log(`VIN extracted via AI inspection: ${vin} (confidence: ${result.confidence || 0})`);
      return vin;
    }
    
    return undefined;
  } catch (error: any) {
    console.log(`AI inspection error: ${error.message}`);
    return undefined;
  }
}

/**
 * Extract VIN from BaT HTML using multiple patterns
 * VIN is ALWAYS in the essentials div, so we prioritize that
 * Falls back to AI inspection if regex extraction fails
 */
async function extractVIN(html: string, batUrl: string): Promise<string | undefined> {
  // First, extract the essentials div - need to handle nested divs properly
  // Find the opening tag
  const essentialsStart = html.search(/<div[^>]*class="essentials"[^>]*>/i);
  if (essentialsStart === -1) {
    console.log('Essentials div not found');
    return undefined;
  }
  
  // Find the matching closing tag by counting divs
  let depth = 0;
  let pos = essentialsStart;
  let essentialsEnd = -1;
  
  while (pos < html.length) {
    const nextOpen = html.indexOf('<div', pos);
    const nextClose = html.indexOf('</div>', pos);
    
    if (nextClose === -1) break;
    
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      pos = nextOpen + 4;
    } else {
      depth--;
      pos = nextClose + 6;
      if (depth === 0) {
        essentialsEnd = nextClose;
        break;
      }
    }
  }
  
  let essentialsHTML = '';
  let essentialsText = '';
  
  if (essentialsEnd > essentialsStart) {
    essentialsHTML = html.substring(essentialsStart, essentialsEnd + 6);
    // Strip HTML tags to get text content
    essentialsText = essentialsHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }
  
  // Patterns to try - prioritize essentials div
  // Accept 8-17 character VINs/chassis numbers (pre-1981 vehicles have shorter chassis numbers)
  const patterns = [
    // Pattern 1: In list item with link (most common format) - 8-17 chars
    /<li[^>]*>Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a><\/li>/i,
    // Pattern 2: In list item without link - 8-17 chars
    /<li[^>]*>Chassis:\s*([A-HJ-NPR-Z0-9]{8,17})<\/li>/i,
    // Pattern 3: In essentials text content (after stripping HTML) - 8-17 chars
    essentialsText ? new RegExp(`(?:VIN|Chassis)[:\\s]+([A-HJ-NPR-Z0-9]{8,17})`, 'i') : null,
    // Pattern 4: In essentials HTML (before stripping) - 8-17 chars
    essentialsHTML ? new RegExp(`(?:VIN|Chassis)[:\\s]+([A-HJ-NPR-Z0-9]{8,17})`, 'i') : null,
    // Pattern 5: General pattern in full HTML (fallback) - 8-17 chars
    /(?:VIN|Chassis)[:\s]+([A-HJ-NPR-Z0-9]{8,17})/i,
  ];
  
  for (const pattern of patterns) {
    if (!pattern) continue;
    
    // Try in essentials HTML first, then essentials text, then full HTML
    let match = essentialsHTML ? essentialsHTML.match(pattern) : null;
    if (!match && essentialsText) {
      match = essentialsText.match(pattern);
    }
    if (!match) {
      match = html.match(pattern);
    }
    
    if (match) {
      const vin = match[1].toUpperCase();
      // Validate: no I, O, Q
      // Accept 17-char VINs (standard) or shorter chassis numbers (pre-1981 vehicles)
      if (vin.length >= 8 && vin.length <= 17 && !/[IOQ]/.test(vin)) {
        console.log(`VIN/Chassis extracted: ${vin} (${vin.length} chars)`);
        return vin;
      }
      }
    }
    
    console.log('VIN extraction via regex failed. Trying AI inspection...');
    
    // Fallback to AI inspection
    const aiVin = await extractVINWithAI(html, batUrl);
    if (aiVin) {
      return aiVin;
    }
    
    console.log('VIN extraction failed via both regex and AI inspection.');
    return undefined;
}

/**
 * Extract auction dates from BaT HTML - IMPROVED
 * Looks for dates in multiple formats and locations
 * PRIORITY: Extract from data-auction-ends attribute first (most accurate)
 */
function extractAuctionDates(html: string): { start_date?: string; end_date?: string; sale_date?: string } {
  const dates: { start_date?: string; end_date?: string; sale_date?: string } = {};
  
  // Helper to parse date strings in various formats
  function parseDate(dateStr: string): string | undefined {
    try {
      // Handle formats like "9/6/22", "09/06/2022", "12/19/24"
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        let month = parseInt(parts[0]);
        let day = parseInt(parts[1]);
        let year = parseInt(parts[2]);
        
        // Handle 2-digit years
        if (year < 100) {
          year = year < 50 ? 2000 + year : 1900 + year;
        }
        
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
    } catch (e) {
      console.log('Error parsing date:', e);
    }
    return undefined;
  }
  
  // PRIORITY 1: Extract from data-auction-ends attribute (most accurate for live auctions)
  // Format: data-auction-ends="2025-12-14-18-05-00" (YYYY-MM-DD-HH-MM-SS)
  const auctionEndsMatch = html.match(/data-auction-ends=["'](\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})["']/);
  if (auctionEndsMatch) {
    try {
      // Parse format: "2025-12-14-18-05-00"
      const dateTimeStr = auctionEndsMatch[1];
      // Split by '-' to get all parts: ["2025", "12", "14", "18", "05", "00"]
      const parts = dateTimeStr.split('-');
      if (parts.length === 6) {
        const year = parseInt(parts[0]);
        const month = parseInt(parts[1]);
        const day = parseInt(parts[2]);
        const hour = parseInt(parts[3]);
        const minute = parseInt(parts[4]);
        const second = parseInt(parts[5]);
        
        const endDateTime = new Date(
          year,
          month - 1,
          day,
          hour,
          minute,
          second
        );
        
        if (!isNaN(endDateTime.getTime())) {
          // Store as date string (YYYY-MM-DD) but with time component in mind
          dates.end_date = endDateTime.toISOString().split('T')[0];
          
          // Calculate start date: end - 7 days (BAT auctions run for 7 days)
          const startDateTime = new Date(endDateTime);
          startDateTime.setDate(startDateTime.getDate() - 7);
          dates.start_date = startDateTime.toISOString().split('T')[0];
          
          console.log(`✅ Extracted auction dates from data-auction-ends: end=${dates.end_date}, start=${dates.start_date}`);
        }
      }
    } catch (e) {
      console.log('Error parsing data-auction-ends:', e);
    }
  }
  
  // Extract sale date - look for "Sold for USD $X on MM/DD/YY" or "Bid to USD $X on MM/DD/YY"
  const saleDatePatterns = [
    /Sold for[:\s]*USD\s*\$[0-9,]+\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Sold for[:\s]*\$[0-9,]+\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Bid to USD\s*\$[0-9,]+\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Bid to\s*\$[0-9,]+\s+on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Sold on[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];
  
  for (const pattern of saleDatePatterns) {
    const match = html.match(pattern);
    if (match) {
      const parsed = parseDate(match[1]);
      if (parsed) {
        dates.sale_date = parsed;
        // For completed auctions, end_date is usually same as sale_date
        // Only set if we don't already have end_date from data-auction-ends
        if (!dates.end_date) {
          dates.end_date = parsed;
        }
        break;
      }
    }
  }
  
  // Extract auction end date (fallback if data-auction-ends not found)
  if (!dates.end_date) {
    const endDatePatterns = [
      /Ended[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /Auction ended[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /Closed[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    ];
    
    for (const pattern of endDatePatterns) {
      const match = html.match(pattern);
      if (match) {
        const parsed = parseDate(match[1]);
        if (parsed) {
          dates.end_date = parsed;
          break;
        }
      }
    }
  }
  
  // Calculate auction start date if we have end_date but not start_date
  // BaT auctions typically run for 7 days, so start = end - 7 days
  if (dates.end_date && !dates.start_date) {
    const endDate = new Date(dates.end_date);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7); // Typical BaT auction duration
    dates.start_date = startDate.toISOString().split('T')[0];
    console.log(`📅 Calculated start_date from end_date: ${dates.start_date} (end: ${dates.end_date})`);
  }
  
  // Also try to find explicit start date (overrides calculated if found)
  const startDatePatterns = [
    /Listed[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Started[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /Auction started[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];
  
  for (const pattern of startDatePatterns) {
    const match = html.match(pattern);
    if (match) {
      const parsed = parseDate(match[1]);
      if (parsed) {
        dates.start_date = parsed;
        console.log(`📅 Found explicit start_date in text: ${dates.start_date}`);
        break;
      }
    }
  }
  
  return dates;
}

/**
 * Extract technical specs from BaT essentials section - COMPREHENSIVE
 * Parses the essentials div properly to get ALL data
 */
function extractTechnicalSpecs(html: string): {
  engine?: string;
  transmission?: string;
  drivetrain?: string;
  color?: string;
  interior_color?: string;
  body_style?: string;
  displacement?: string;
  mileage?: number;
} {
  const specs: any = {};
  
  // Get essentials section properly (handle nested divs)
  const essentialsStart = html.search(/<div[^>]*class="essentials"[^>]*>/i);
  let essentialsHTML = '';
  let essentialsText = '';
  
  if (essentialsStart !== -1) {
    let depth = 0;
    let pos = essentialsStart;
    let essentialsEnd = -1;
    
    while (pos < html.length) {
      const nextOpen = html.indexOf('<div', pos);
      const nextClose = html.indexOf('</div>', pos);
      
      if (nextClose === -1) break;
      
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        pos = nextClose + 6;
        if (depth === 0) {
          essentialsEnd = nextClose;
          break;
        }
      }
    }
    
    if (essentialsEnd > essentialsStart) {
      essentialsHTML = html.substring(essentialsStart, essentialsEnd + 6);
      essentialsText = essentialsHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    }
  }
  
  // Extract mileage - handle "31k Miles", "46k Miles Shown", etc.
  const mileagePatterns = [
    /(\d+(?:,\d+)?)\s*k\s*Miles/i,
    /(\d+(?:,\d+)?)\s*Miles\s*Shown/i,
    /(\d+(?:,\d+)?)\s*Miles/i,
  ];
  
  for (const pattern of mileagePatterns) {
    const match = essentialsText.match(pattern) || html.match(pattern);
    if (match) {
      let miles = parseInt(match[1].replace(/,/g, ''));
      if (match[0].toLowerCase().includes('k')) {
        miles = miles * 1000;
      }
      specs.mileage = miles;
      break;
    }
  }
  
  // Extract engine - look for patterns like "Twin-Turbocharged 3.5-Liter V6", "Turbocharged 2.2-Liter Inline-Four"
  const enginePatterns = [
    /(Twin-Turbocharged[^<\n]+?Liter[^<\n]+?V\d+)/i,
    /(Turbocharged[^<\n]+?Liter[^<\n]+?Inline-Four)/i,
    /(Turbocharged[^<\n]+?Liter[^<\n]+?V\d+)/i,
    /(Supercharged[^<\n]+?Liter[^<\n]+?V\d+)/i,
    /(\d+\.\d+[-\s]?Liter[^<\n]+?V\d+)/i,
    /(\d+\.\d+[-\s]?Liter[^<\n]+?Inline-Four)/i,
    /(\d+\.\d+[-\s]?Liter[^<\n]+?Inline-Six)/i,
    /Engine[:\s]*([^<\n]+?Liter[^<\n]+)/i,
  ];
  
  for (const pattern of enginePatterns) {
    const match = essentialsText.match(pattern) || html.match(pattern);
    if (match) {
      specs.engine = match[1].trim();
      // Extract displacement separately
      const dispMatch = match[1].match(/(\d+\.\d+)[-\s]?Liter/i);
      if (dispMatch) {
        specs.displacement = dispMatch[1] + 'L';
      }
      break;
    }
  }
  
  // Extract transmission - look for "Ten-Speed Automatic", "Five-Speed Manual", etc.
  const transPatterns = [
    /(Ten-Speed\s+Automatic)/i,
    /(Five-Speed\s+Manual)/i,
    /(Six-Speed\s+Manual)/i,
    /(\d+-Speed\s+(?:Manual|Automatic)\s+Transmission)/i,
    /(\d+-Speed\s+(?:Manual|Automatic))/i,
    /Transmission[:\s]*([^<\n]+)/i,
  ];
  
  for (const pattern of transPatterns) {
    const match = essentialsText.match(pattern) || html.match(pattern);
    if (match) {
      specs.transmission = match[1].trim();
      break;
    }
  }
  
  // Extract drivetrain - look for "4WD", "AWD", "FWD", "RWD", "Torsen" (for AWD systems)
  const drivetrainPatterns = [
    /(4WD|AWD|FWD|RWD)/i,
    /Drivetrain[:\s]*([^<\n]+)/i,
    /(Torsen[^<\n]+)/i, // Torsen differential indicates AWD
  ];
  
  for (const pattern of drivetrainPatterns) {
    const match = essentialsText.match(pattern) || html.match(pattern);
    if (match) {
      specs.drivetrain = match[1].trim();
      break;
    }
  }
  
  // Extract color from description - look for color names in description text
  // First try to get description section
  const descMatch = html.match(/<div[^>]*class="card-body"[^>]*>([\s\S]*?)<\/div>/i) ||
                   html.match(/<div[^>]*class="post-content"[^>]*>([\s\S]*?)<\/div>/i);
  const descriptionText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ') : '';
  
  // Color patterns - look for specific color names (Code Orange Metallic, etc.)
  const colorPatterns = [
    /(Code\s+Orange\s+Metallic)/i,
    /(finished\s+in\s+([A-Za-z\s]+(?:Metallic|Pearl|Mica)?))/i,
    /(Color[:\s]*([^<\n,]+))/i,
    /(Exterior[:\s]*([^<\n,]+))/i,
    /(Paint[:\s]*([^<\n,]+))/i,
  ];
  
  for (const pattern of colorPatterns) {
    const match = descriptionText.match(pattern) || essentialsText.match(pattern) || html.match(pattern);
    if (match) {
      specs.color = (match[2] || match[1]).trim();
      break;
    }
  }
  
  // Extract interior color - be more precise, avoid extracting too much text
  const interiorColorPatterns = [
    /Upholstery[:\s]*([A-Za-z\s]+(?:leather|cloth|vinyl|suede|alcantara)?)/i,
    /Interior[:\s]*([A-Za-z\s]+(?:leather|cloth|vinyl|suede|alcantara)?)/i,
    /(?:over|with)\s+([A-Za-z\s]+(?:leather|cloth|vinyl|suede|alcantara)?)/i, // "red over tan leather"
  ];
  
  for (const pattern of interiorColorPatterns) {
    const match = essentialsText.match(pattern) || descriptionText.match(pattern);
    if (match) {
      // Clean up the match - limit to reasonable length
      let interior = match[1].trim();
      // Stop at common delimiters
      interior = interior.split(/[,\n<]/)[0].trim();
      // Limit length to avoid extracting too much
      if (interior.length > 0 && interior.length < 50) {
        specs.interior_color = interior;
        break;
      }
    }
  }
  
  return specs;
}

/**
 * Extract auction metrics (bids, views, watchers) - VALIDATED
 * Be careful - don't extract wrong numbers!
 */
function extractAuctionMetrics(html: string): {
  bid_count?: number;
  view_count?: number;
  watcher_count?: number;
  reserve_price?: number;
} {
  const metrics: any = {};
  
  // Extract bid count - look for actual bid count, not random numbers
  // Look for patterns like "X bids" in stats sections
  const bidPatterns = [
    /<span[^>]*data-stats-item="bids"[^>]*>(\d+)\s*bids?<\/span>/i,
    /(\d+)\s*bids?\s*(?:placed|total)/i,
    /Bid\s+count[:\s]*(\d+)/i,
  ];
  
  for (const pattern of bidPatterns) {
    const match = html.match(pattern);
    if (match) {
      const bidCount = parseInt(match[1]);
      // Sanity check - if it's over 10000, it's probably wrong
      if (bidCount > 0 && bidCount < 10000) {
        metrics.bid_count = bidCount;
        break;
      }
    }
  }
  
  // Extract view count
  const viewPatterns = [
    /<span[^>]*data-stats-item="views"[^>]*>([\d,]+)\s*views?<\/span>/i,
    /([\d,]+)\s*views?/i,
    /Views[:\s]*([\d,]+)/i,
  ];
  
  for (const pattern of viewPatterns) {
    const match = html.match(pattern);
    if (match) {
      metrics.view_count = parseInt(match[1].replace(/,/g, ''));
      break;
    }
  }
  
  // Extract watcher count
  const watcherPatterns = [
    /<span[^>]*data-stats-item="watchers"[^>]*>(\d+)\s*watchers?<\/span>/i,
    /(\d+)\s*watchers?/i,
    /Watchers[:\s]*(\d+)/i,
  ];
  
  for (const pattern of watcherPatterns) {
    const match = html.match(pattern);
    if (match) {
      metrics.watcher_count = parseInt(match[1]);
      break;
    }
  }
  
  // Extract reserve price (if disclosed)
  const reserveMatch = html.match(/Reserve[:\s]*\$([0-9,]+)/i) ||
                       html.match(/Reserve\s+met[:\s]*\$([0-9,]+)/i);
  if (reserveMatch) {
    metrics.reserve_price = parseInt(reserveMatch[1].replace(/,/g, ''));
  }
  
  return metrics;
}

/**
 * Extract bid history from BaT comment thread - IMPROVED with timestamps
 * Returns array of bid events with amounts, timestamps, and bidders
 */
function extractBidHistory(html: string): Array<{ amount: number; timestamp?: string; bidder?: string }> {
  const bids: Array<{ amount: number; timestamp?: string; bidder?: string }> = [];
  
  // Helper to parse date from comment timestamps
  function parseCommentDate(dateStr: string): string | undefined {
    try {
      // BaT comment dates might be in various formats
      // Look for patterns like "on 9/6/22", "September 6, 2022", etc.
      const dateMatch = dateStr.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      if (dateMatch) {
        const parts = dateMatch[1].split('/');
        if (parts.length === 3) {
          let month = parseInt(parts[0]);
          let day = parseInt(parts[1]);
          let year = parseInt(parts[2]);
          if (year < 100) {
            year = year < 50 ? 2000 + year : 1900 + year;
          }
          const date = new Date(year, month - 1, day);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split('T')[0];
          }
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
    return undefined;
  }
  
  // Look for bid comments in the HTML with timestamps
  // BaT bid comments typically have format: "USD $X bid placed by [username] on MM/DD/YY"
  const bidPatterns = [
    /USD\s*\$([0-9,]+)\s+bid\s+placed\s+by\s+([A-Za-z0-9_]+)[^<]*on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
    /\$([0-9,]+)\s+bid\s+placed\s+by\s+([A-Za-z0-9_]+)[^<]*on\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/gi,
    /USD\s*\$([0-9,]+)\s+bid\s+placed\s+by\s+([A-Za-z0-9_]+)/gi,
    /\$([0-9,]+)\s+bid\s+placed\s+by\s+([A-Za-z0-9_]+)/gi,
  ];
  
  for (const pattern of bidPatterns) {
    const matches = html.matchAll(pattern);
    for (const match of matches) {
      const amount = parseInt(match[1].replace(/,/g, ''));
      if (amount >= 1000) { // Sanity check
        const bidder = match[2] || undefined;
        const timestamp = match[3] ? parseCommentDate(match[3]) : undefined;
        
        bids.push({
          amount,
          bidder,
          timestamp,
        });
      }
    }
  }
  
  // Remove duplicates and sort by amount
  const uniqueBids = Array.from(
    new Map(bids.map(b => [b.amount, b])).values()
  ).sort((a, b) => a.amount - b.amount);
  
  return uniqueBids;
}

/**
 * Validate extracted data using AI and ask for improvements
 */
async function validateExtractedData(data: ComprehensiveBaTData, html: string, batUrl: string): Promise<ComprehensiveBaTData> {
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    console.log('OpenAI API key not configured, skipping validation');
    return data;
  }

  try {
    // Get essentials and description text for validation
    const essentialsStart = html.search(/<div[^>]*class="essentials"[^>]*>/i);
    let essentialsText = '';
    if (essentialsStart !== -1) {
      let depth = 0;
      let pos = essentialsStart;
      let essentialsEnd = -1;
      
      while (pos < html.length) {
        const nextOpen = html.indexOf('<div', pos);
        const nextClose = html.indexOf('</div>', pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          pos = nextClose + 6;
          if (depth === 0) {
            essentialsEnd = nextClose;
            break;
          }
        }
      }
      if (essentialsEnd > essentialsStart) {
        const essentialsHTML = html.substring(essentialsStart, essentialsEnd + 6);
        essentialsText = essentialsHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      }
    }

    const descMatch = html.match(/<div[^>]*class="card-body"[^>]*>([\s\S]{0,2000})<\/div>/i);
    const descriptionText = descMatch ? descMatch[1].replace(/<[^>]+>/g, ' ') : '';
    
    // Get listing-available-info for price validation
    const listingInfoMatch = html.match(/<div[^>]*class="listing-available-info"[^>]*>([\s\S]{0,500})<\/div>/i);
    const listingInfoText = listingInfoMatch ? listingInfoMatch[1].replace(/<[^>]+>/g, ' ') : '';

    const textToValidate = (essentialsText + ' ' + descriptionText + ' ' + listingInfoText).substring(0, 6000);

    console.log('Validating extracted data with AI and asking for improvements...');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a data extraction expert. Review scraped data, identify what\'s missing or wrong, and suggest improvements. Return ONLY valid JSON.'
          },
          {
            role: 'user',
            content: `I scraped this Bring a Trailer listing. Review what I extracted and tell me what I could do better.

SCRAPED DATA (what I extracted):
${JSON.stringify(data, null, 2)}

SOURCE HTML TEXT (key sections):
Essentials: ${essentialsText.substring(0, 1000)}
Description: ${descriptionText.substring(0, 1000)}
Listing Info: ${listingInfoText.substring(0, 500)}

URL: ${batUrl}

GOAL: Extract ALL data as accurately as possible for database table storage to enable intelligent data analysis.

PRIORITY: Extract the full auction process timeline (bid events, auction milestones) to carefully add to vehicle timeline.

Review and:
1. CORRECT any errors in the extracted data
2. IDENTIFY missing data that should be extracted
3. SUGGEST improvements to extraction patterns

Return JSON:
{
  "corrections": {
    "vin": "corrected or null",
    "mileage": number or null,
    "color": "corrected color or null",
    "transmission": "corrected or null",
    "engine": "corrected or null",
    "drivetrain": "corrected or null",
    "sale_price": number or null (must be >= 1000),
    "bid_count": number or null,
    "view_count": number or null,
    "auction_start_date": "YYYY-MM-DD or null",
    "auction_end_date": "YYYY-MM-DD or null",
    "sale_date": "YYYY-MM-DD or null"
  },
  "missing_data": {
    "fields": ["list of fields that should be extracted but are missing"],
    "suggestions": ["specific suggestions for extraction patterns"]
  },
  "improvements": [
    "specific improvement suggestions for better extraction"
  ],
  "auction_timeline_events": [
    {
      "event_type": "auction_listed|auction_started|auction_bid_placed|auction_reserve_met|auction_ended|auction_sold",
      "event_date": "YYYY-MM-DD",
      "title": "event title",
      "description": "event description",
      "metadata": {}
    }
  ],
  "confidence": 0-100
}`
          }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 2000
      })
    });

    if (response.ok) {
      const validationData = await response.json();
      const validated = JSON.parse(validationData.choices[0].message.content);
      
      // Apply corrections from corrections object
      const corrections = validated.corrections || {};
      
      if (corrections.vin && corrections.vin !== data.vin) {
        console.log(`VIN corrected: ${data.vin} → ${corrections.vin}`);
        data.vin = corrections.vin;
      }
      if (corrections.mileage !== undefined && corrections.mileage !== data.mileage) {
        console.log(`Mileage corrected: ${data.mileage} → ${corrections.mileage}`);
        data.mileage = corrections.mileage;
      }
      if (corrections.color && corrections.color !== data.color) {
        console.log(`Color corrected: ${data.color} → ${corrections.color}`);
        data.color = corrections.color;
      }
      if (corrections.transmission && corrections.transmission !== data.transmission) {
        console.log(`Transmission corrected: ${data.transmission} → ${corrections.transmission}`);
        data.transmission = corrections.transmission;
      }
      if (corrections.engine && corrections.engine !== data.engine) {
        console.log(`Engine corrected: ${data.engine} → ${corrections.engine}`);
        data.engine = corrections.engine;
      }
      if (corrections.drivetrain && corrections.drivetrain !== data.drivetrain) {
        console.log(`Drivetrain corrected: ${data.drivetrain} → ${corrections.drivetrain}`);
        data.drivetrain = corrections.drivetrain;
      }
      if (corrections.bid_count !== undefined && corrections.bid_count !== data.bid_count) {
        console.log(`Bid count corrected: ${data.bid_count} → ${corrections.bid_count}`);
        data.bid_count = corrections.bid_count;
      }
      if (corrections.view_count !== undefined && corrections.view_count !== data.view_count) {
        console.log(`View count corrected: ${data.view_count} → ${corrections.view_count}`);
        data.view_count = corrections.view_count;
      }
      if (corrections.sale_price !== undefined && corrections.sale_price !== data.sale_price) {
        console.log(`Sale price corrected: ${data.sale_price} → ${corrections.sale_price}`);
        data.sale_price = corrections.sale_price;
      }
      if (corrections.auction_start_date && corrections.auction_start_date !== data.auction_start_date) {
        console.log(`Auction start date corrected: ${data.auction_start_date} → ${corrections.auction_start_date}`);
        data.auction_start_date = corrections.auction_start_date;
      }
      if (corrections.auction_end_date && corrections.auction_end_date !== data.auction_end_date) {
        console.log(`Auction end date corrected: ${data.auction_end_date} → ${corrections.auction_end_date}`);
        data.auction_end_date = corrections.auction_end_date;
      }
      if (corrections.sale_date && corrections.sale_date !== data.sale_date) {
        console.log(`Sale date corrected: ${data.sale_date} → ${corrections.sale_date}`);
        data.sale_date = corrections.sale_date;
      }
      
      // Log missing data and improvements
      if (validated.missing_data) {
        console.log('Missing data identified:', validated.missing_data);
      }
      if (validated.improvements && validated.improvements.length > 0) {
        console.log('AI suggested improvements:', validated.improvements);
      }
      
      // Store auction timeline events for later processing
      if (validated.auction_timeline_events) {
        (data as any).auction_timeline_events = validated.auction_timeline_events;
      }
    }
  } catch (error: any) {
    console.log(`AI validation error: ${error.message}`);
  }

  return data;
}

/**
 * Comprehensive BaT listing extraction
 */
async function extractComprehensiveBaTData(html: string, batUrl: string): Promise<ComprehensiveBaTData> {
  const data: ComprehensiveBaTData = { url: batUrl };
  
  // Extract VIN (with AI fallback)
  data.vin = await extractVIN(html, batUrl);
  
  // Extract title and parse year/make/model
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (titleMatch) {
    data.title = titleMatch[1].trim();
    
    const vehicleMatch = data.title.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
    if (vehicleMatch) {
      data.year = parseInt(vehicleMatch[1]);
      data.make = vehicleMatch[2];
      const modelAndTrim = vehicleMatch[3];
      const modelParts = modelAndTrim.split(' ');
      data.model = modelParts.slice(0, 2).join(' ');
      if (modelParts.length > 2) {
        data.trim = modelParts.slice(2).join(' ');
      }
    }
  }
  
  // Extract auction dates
  const dates = extractAuctionDates(html);
  data.auction_start_date = dates.start_date;
  data.auction_end_date = dates.end_date;
  data.sale_date = dates.sale_date;
  
  // Extract sale price - prioritize actual sale prices, then current bids
  // Look for "Sold for" first (completed auctions)
  const soldPriceMatch = html.match(/Sold for[:\s]*USD\s*\$([0-9,]+)/i) ||
                         html.match(/Sold for[:\s]*\$([0-9,]+)/i) ||
                         html.match(/Winning bid[:\s]*USD\s*\$([0-9,]+)/i) ||
                         html.match(/Winning bid[:\s]*\$([0-9,]+)/i) ||
                         html.match(/Final price[:\s]*\$([0-9,]+)/i);
  
  if (soldPriceMatch) {
    const price = parseInt(soldPriceMatch[1].replace(/,/g, ''));
    // Sanity check - sale prices should be at least $1000
    if (price >= 1000) {
      data.sale_price = price;
    }
  } else {
    // For active auctions, look for current bid in listing-available-info
    const bidInfoMatch = html.match(/<div[^>]*class="listing-available-info"[^>]*>[\s\S]*?Bid to USD \$([0-9,]+)/i) ||
                            html.match(/Bid to USD \$([0-9,]+)/i) ||
                            html.match(/Bid to \$([0-9,]+)/i);
    
    if (bidInfoMatch) {
      const bid = parseInt(bidInfoMatch[1].replace(/,/g, ''));
      // Sanity check - bids should be at least $1000
      if (bid >= 1000) {
        data.sale_price = bid; // Store as sale_price for active auctions (current bid)
      }
    }
  }
  
  // Extract auction metrics
  const metrics = extractAuctionMetrics(html);
  data.bid_count = metrics.bid_count;
  data.view_count = metrics.view_count;
  data.watcher_count = metrics.watcher_count;
  data.reserve_price = metrics.reserve_price;
  
  // Extract technical specs
  const specs = extractTechnicalSpecs(html);
  Object.assign(data, specs);
  
  // Extract bid history for auction timeline
  const bidHistory = extractBidHistory(html);
  if (bidHistory.length > 0) {
    data.bid_history = bidHistory;
  }
  
  // Extract location - avoid JavaScript code, look for actual location text
  // Look in essentials section first, then description
  const locationPatterns = [
    /<li[^>]*>Location[:\s]*([^<]+(?:,\s*[^<]+)?)<\/li>/i,
    /Location[:\s]*([A-Za-z\s]+(?:,\s*[A-Z][A-Za-z\s]+)?)/i,
    /Located in[:\s]*([A-Za-z\s]+(?:,\s*[A-Z][A-Za-z\s]+)?)/i,
  ];
  
  for (const pattern of locationPatterns) {
    const match = html.match(pattern);
    if (match) {
      let location = match[1].trim();
      // Reject if it looks like JavaScript code
      if (!location.includes('{') && !location.includes('"') && !location.includes('http') && location.length < 100) {
        data.location = location;
        break;
      }
    }
  }
  
  // Extract seller - avoid JavaScript code, look for actual seller name
  // Look in essentials section first
  const sellerPatterns = [
    /<li[^>]*>Seller[:\s]*([^<]+)<\/li>/i,
    /Seller[:\s]*([A-Za-z0-9_\s]+)/i,
    /Sold by[:\s]*([A-Za-z0-9_]+)/i,
  ];
  
  for (const pattern of sellerPatterns) {
    const match = html.match(pattern);
    if (match) {
      let seller = match[1].trim();
      // Reject if it looks like JavaScript code
      if (!seller.includes('{') && !seller.includes('"') && !seller.includes('http') && seller.length < 50) {
        data.seller = seller;
        break;
      }
    }
  }
  
  // Extract buyer
  const buyerMatch = html.match(/Sold to[:\s]*([A-Za-z0-9_]+)/i) ||
                    html.match(/to\s+([A-Za-z0-9_]+)\s+for/i);
  if (buyerMatch) {
    data.buyer = buyerMatch[1].trim();
  }
  
  // Extract lot number
  const lotMatch = html.match(/Lot[:\s]*#?(\d+)/i);
  if (lotMatch) {
    data.lot_number = lotMatch[1];
  }
  
  // Extract description from multiple sources
  const descPatterns = [
    /<div[^>]*class="card-body"[^>]*>([\s\S]{100,2000})<\/div>/i,
    /<div[^>]*class="post-content"[^>]*>([\s\S]{100,2000})<\/div>/i,
    /<p[^>]*>([^<]{100,500})<\/p>/,
  ];
  
  for (const pattern of descPatterns) {
    const match = html.match(pattern);
    if (match) {
      data.description = match[1].replace(/<[^>]+>/g, ' ').trim().substring(0, 1000);
      break;
    }
  }
  
  // Validate all extracted data with AI before returning
  const validatedData = await validateExtractedData(data, html, batUrl);
  
  return validatedData;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { batUrl, vehicleId } = await req.json();

    if (!batUrl) {
      return new Response(
        JSON.stringify({ error: 'batUrl required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Fetching comprehensive BaT data: ${batUrl}`);
    
    const response = await fetch(batUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch BaT URL: ${response.status}`);
    }
    
    const html = await response.text();
    const extractedData = await extractComprehensiveBaTData(html, batUrl);

    console.log('Extracted data:', JSON.stringify(extractedData, null, 2));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Ensure BaT participant identities exist (seller/buyer/bidders) so we can map actions over time.
    // This does NOT create N-Zero auth users; it populates `bat_users` (public auction identities).
    const ensureBatUser = async (usernameRaw: string | null | undefined): Promise<{ id: string; bat_username: string; profile_url: string | null; external_identity_id?: string } | null> => {
      const username = (usernameRaw || '').trim();
      if (!username) return null;
      // Best-effort profile URL (BaT uses member pages; if wrong, we still store username)
      const profileUrl = `https://bringatrailer.com/member/${encodeURIComponent(username)}`;
      try {
        const { data, error } = await supabase
          .from('bat_users')
          .upsert(
            {
              bat_username: username,
              bat_profile_url: profileUrl,
              last_seen_at: new Date().toISOString(),
            },
            { onConflict: 'bat_username' },
          )
          .select('id, bat_username, bat_profile_url')
          .single();
        if (error) {
          console.log('bat_users upsert failed (non-fatal):', error.message);
          return null;
        }
        // Best-effort: also upsert the generic external identity row (if table exists).
        let externalIdentityId: string | undefined = undefined;
        try {
          const { data: ext, error: extErr } = await supabase
            .from('external_identities')
            .upsert(
              {
                platform: 'bat',
                handle: username,
                profile_url: profileUrl,
                last_seen_at: new Date().toISOString(),
              },
              { onConflict: 'platform,handle' },
            )
            .select('id')
            .single();
          if (!extErr && ext?.id) externalIdentityId = ext.id;
        } catch {
          // ignore if table missing
        }

        return { id: data.id, bat_username: data.bat_username, profile_url: data.bat_profile_url, external_identity_id: externalIdentityId };
      } catch (e) {
        console.log('bat_users upsert exception (non-fatal):', e);
        return null;
      }
    };

    // Ensure a minimal behavioral profile row exists for each observed BaT username.
    // This is intentionally lightweight: it "creates the profile shell" immediately, and downstream pipelines
    // (comments analysis, auction intelligence, etc.) can enrich it over time.
    const touchBatUserProfile = async (usernameRaw: string | null | undefined) => {
      const username = (usernameRaw || '').trim();
      if (!username) return;
      const nowIso = new Date().toISOString();
      try {
        // Update-first to avoid overwriting `first_seen` on existing profiles.
        const { data: updated, error: updErr } = await supabase
          .from('bat_user_profiles')
          .update({ last_seen: nowIso, updated_at: nowIso })
          .eq('username', username)
          .select('username')
          .maybeSingle();

        if (!updErr && updated?.username) return;

        // Insert if missing (race-safe: ignore duplicates).
        const { error: insErr } = await supabase
          .from('bat_user_profiles')
          .insert({ username, first_seen: nowIso, last_seen: nowIso, updated_at: nowIso });

        // If table is missing (or row raced), do not fail the extraction.
        if (insErr) {
          const code = String((insErr as any)?.code || '').toUpperCase();
          const status = (insErr as any)?.status ?? (insErr as any)?.statusCode;
          const msg = String((insErr as any)?.message || '').toLowerCase();
          if (status === 404 || code === '42P01' || msg.includes('does not exist') || msg.includes('not found')) return;
        }
      } catch {
        // ignore
      }
    };

    const participantUsernames = new Set<string>();
    if (extractedData.seller) participantUsernames.add(String(extractedData.seller).trim());
    if (extractedData.buyer) participantUsernames.add(String(extractedData.buyer).trim());
    if (Array.isArray(extractedData.bid_history)) {
      for (const b of extractedData.bid_history) {
        if (b?.bidder) participantUsernames.add(String(b.bidder).trim());
      }
    }

    const batIdentityByUsername = new Map<string, { id: string; bat_username: string; profile_url: string | null; external_identity_id?: string }>();
    for (const u of participantUsernames) {
      const rec = await ensureBatUser(u);
      if (rec) batIdentityByUsername.set(rec.bat_username, rec);
    }

    // Kick off / update bidder profile shells for every participant we just observed.
    for (const u of participantUsernames) {
      await touchBatUserProfile(u);
    }

    // If vehicleId provided, update vehicle and create timeline events
    if (vehicleId) {
      // Update vehicle with extracted data
      const vehicleUpdates: any = {
        bat_auction_url: batUrl,
      };
      
      if (extractedData.vin) {
        // Always update VIN if extracted (even if vehicle has one, BaT VIN is authoritative)
        vehicleUpdates.vin = extractedData.vin;
        console.log(`Updating VIN to: ${extractedData.vin}`);
      }
      
      // Update VIN separately to avoid trigger conflicts
      // Note: There's a broken trigger that may prevent VIN updates, but we'll try anyway
      if (extractedData.vin) {
        console.log(`Attempting to update VIN to: ${extractedData.vin}`);
        // Remove VIN from vehicleUpdates to update it separately
        delete vehicleUpdates.vin;
        
        // Try direct update after other fields
        try {
          const { error: vinError } = await supabase
            .from('vehicles')
            .update({ vin: extractedData.vin })
            .eq('id', vehicleId);
          
          if (vinError) {
            console.error('VIN update failed (trigger may be blocking):', vinError.message);
            // This is expected due to broken trigger - VIN extraction still succeeded
          } else {
            console.log('✅ VIN updated successfully!');
          }
        } catch (e) {
          console.error('VIN update exception:', e);
        }
      }
      
      if (extractedData.year) vehicleUpdates.year = extractedData.year;
      if (extractedData.make) vehicleUpdates.make = extractedData.make;
      if (extractedData.model) vehicleUpdates.model = extractedData.model;
      if (extractedData.trim) vehicleUpdates.trim = extractedData.trim;
      if (extractedData.mileage) vehicleUpdates.mileage = extractedData.mileage;
      if (extractedData.engine) vehicleUpdates.engine_size = extractedData.engine;
      if (extractedData.transmission) vehicleUpdates.transmission = extractedData.transmission;
      if (extractedData.drivetrain) vehicleUpdates.drivetrain = extractedData.drivetrain;
      if (extractedData.color) vehicleUpdates.color = extractedData.color;
      if (extractedData.interior_color) vehicleUpdates.interior_color = extractedData.interior_color;
      if (extractedData.displacement) vehicleUpdates.displacement = extractedData.displacement;
      if (extractedData.description) vehicleUpdates.description = extractedData.description;
      if (extractedData.sale_price) vehicleUpdates.sale_price = extractedData.sale_price;
      if (extractedData.sale_date) vehicleUpdates.sale_date = extractedData.sale_date;
      if (extractedData.location) {
        const loc = normalizeListingLocation(extractedData.location);
        if (loc.clean) {
          vehicleUpdates.bat_location = loc.clean;
          vehicleUpdates.listing_location = loc.clean;
          vehicleUpdates.listing_location_raw = loc.raw;
          vehicleUpdates.listing_location_observed_at =
            extractedData.auction_start_date
              ? new Date(String(extractedData.auction_start_date)).toISOString()
              : new Date().toISOString();
          vehicleUpdates.listing_location_source = 'bat';
          vehicleUpdates.listing_location_confidence = 0.7;
        }
      }
      if (extractedData.seller) vehicleUpdates.bat_seller = extractedData.seller;
      if (extractedData.bid_count !== undefined) vehicleUpdates.bat_bids = extractedData.bid_count;
      if (extractedData.view_count !== undefined) vehicleUpdates.bat_views = extractedData.view_count;
      
      console.log('Updating vehicle with:', JSON.stringify(vehicleUpdates, null, 2));
      
      const { data: updatedVehicle, error: updateError } = await supabase
        .from('vehicles')
        .update(vehicleUpdates)
        .eq('id', vehicleId)
        .select()
        .single();

      // Best-effort: record time-series location observation for this listing.
      try {
        if ((vehicleUpdates as any).listing_location) {
          await supabase.from('vehicle_location_observations').insert({
            vehicle_id: vehicleId,
            source_type: 'listing',
            source_platform: 'bat',
            source_url: batUrl,
            observed_at: (vehicleUpdates as any).listing_location_observed_at || new Date().toISOString(),
            location_text_raw: (vehicleUpdates as any).listing_location_raw || null,
            location_text_clean: (vehicleUpdates as any).listing_location,
            precision: /,/.test(String((vehicleUpdates as any).listing_location)) ? 'region' : 'country',
            confidence: 0.7,
            metadata: { source: 'comprehensive-bat-extraction' },
          } as any);
        }
      } catch {
        // ignore
      }
      
      // CRITICAL: Create source attribution for sale_price if we're updating it
      // This ensures every price has a verifiable source mapped back to the BAT listing
      // Reverse map: price → BAT listing URL, lot number, sale date, etc.
      if (extractedData.sale_price && !updateError) {
        await supabase
          .from('vehicle_field_sources')
          .upsert({
            vehicle_id: vehicleId,
            field_name: 'sale_price',
            field_value: extractedData.sale_price.toString(),
            source_type: 'ai_scraped',
            source_url: batUrl,
            extraction_method: 'bat_listing_scraping',
            confidence_score: 100,
            is_verified: true,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: extractedData.lot_number || null,
              sale_date: extractedData.sale_date || null,
              extraction_date: new Date().toISOString(),
              seller: extractedData.seller || null,
              buyer: extractedData.buyer || null,
              bid_count: extractedData.bid_count || null,
              view_count: extractedData.view_count || null,
              // Reverse mapping: all data points back to the BAT listing
              verified_from: 'bringatrailer_listing',
              listing_url: batUrl
            }
          }, {
            onConflict: 'vehicle_id,field_name,source_type,source_url'
          })
          .then(() => console.log('✅ Created sale_price source attribution with reverse mapping'))
          .catch(err => console.error('Failed to create source attribution:', err));
      }
      
      if (updateError) {
        console.error('Error updating vehicle:', updateError);
        console.error('Update error details:', JSON.stringify(updateError, null, 2));
        
        // Try using RPC function as fallback for VIN update
        if (extractedData.vin) {
          console.log('Attempting VIN update via RPC...');
          const { data: rpcData, error: rpcError } = await supabase.rpc('update_vehicle_vin_safe', {
            p_vehicle_id: vehicleId,
            p_vin: extractedData.vin
          });
          
          if (rpcError) {
            console.error('RPC update also failed:', rpcError);
          } else {
            console.log('RPC update succeeded:', rpcData);
          }
        }
      } else {
        console.log('Vehicle updated successfully');
        console.log('Updated VIN:', updatedVehicle?.vin || 'VIN not in response');
        console.log('Updated fields:', Object.keys(vehicleUpdates).join(', '));
        
        // Verify VIN was actually saved
        if (extractedData.vin && !updatedVehicle?.vin) {
          console.warn('WARNING: VIN was in update payload but not in response!');
          // Try direct RPC call
          const { error: directError } = await supabase.rpc('update_vehicle_vin_safe', {
            p_vehicle_id: vehicleId,
            p_vin: extractedData.vin
          });
          if (directError) {
            console.error('Direct RPC call failed:', directError);
          }
        }
      }

      // Create or update external_listing record
      let listingId: string | null = null;
      
      // Check if external_listing exists
      const { data: existingListing } = await supabase
        .from('external_listings')
        .select('id, metadata')
        .eq('listing_url', batUrl)
        .maybeSingle();
      
      if (existingListing) {
        listingId = existingListing.id;

        const highestBid = Array.isArray(extractedData.bid_history) && extractedData.bid_history.length > 0
          ? [...extractedData.bid_history].sort((a, b) => (b.amount || 0) - (a.amount || 0))[0]
          : null;
        const highBidder = highestBid?.bidder ? String(highestBid.bidder).trim() : null;
        
        // Update existing listing
        await supabase
          .from('external_listings')
          .update({
            start_date: extractedData.auction_start_date ? new Date(extractedData.auction_start_date).toISOString() : null,
            end_date: extractedData.auction_end_date ? new Date(extractedData.auction_end_date).toISOString() : null,
            current_bid: extractedData.sale_price || null,
            final_price: extractedData.sale_price || null,
            reserve_price: extractedData.reserve_price || null,
            bid_count: extractedData.bid_count || 0,
            view_count: extractedData.view_count || 0,
            watcher_count: extractedData.watcher_count || 0,
            sold_at: extractedData.sale_date ? new Date(extractedData.sale_date).toISOString() : null,
            listing_status: extractedData.sale_price ? 'sold' : 'ended',
            metadata: {
              ...(existingListing as any)?.metadata,
              lot_number: extractedData.lot_number,
              seller: extractedData.seller,
              buyer: extractedData.buyer,
              seller_username: extractedData.seller,
              buyer_username: extractedData.buyer,
              high_bidder: highBidder,
              seller_bat_user_id: extractedData.seller ? (batIdentityByUsername.get(String(extractedData.seller).trim())?.id || null) : null,
              buyer_bat_user_id: extractedData.buyer ? (batIdentityByUsername.get(String(extractedData.buyer).trim())?.id || null) : null,
              seller_external_identity_id: extractedData.seller ? (batIdentityByUsername.get(String(extractedData.seller).trim())?.external_identity_id || null) : null,
              buyer_external_identity_id: extractedData.buyer ? (batIdentityByUsername.get(String(extractedData.buyer).trim())?.external_identity_id || null) : null,
              location: (() => {
                const loc = normalizeListingLocation(extractedData.location);
                return loc.clean;
              })(),
              technical_specs: {
                engine: extractedData.engine,
                transmission: extractedData.transmission,
                drivetrain: extractedData.drivetrain,
                displacement: extractedData.displacement,
              },
            },
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', listingId);
      } else {
        // Create new listing (need organization_id - will use first one or null)
        const { data: orgs } = await supabase
          .from('organization_vehicles')
          .select('organization_id')
          .eq('vehicle_id', vehicleId)
          .limit(1);
        
        const orgId = orgs && orgs.length > 0 ? orgs[0].organization_id : null;
        
        const { data: newListing } = await supabase
          .from('external_listings')
          .insert({
            vehicle_id: vehicleId,
            organization_id: orgId || '00000000-0000-0000-0000-000000000000', // Placeholder if no org
            platform: 'bat',
            listing_url: batUrl,
            listing_id: extractedData.lot_number || undefined,
            start_date: extractedData.auction_start_date ? new Date(extractedData.auction_start_date).toISOString() : null,
            end_date: extractedData.auction_end_date ? new Date(extractedData.auction_end_date).toISOString() : null,
            current_bid: extractedData.sale_price || null,
            final_price: extractedData.sale_price || null,
            reserve_price: extractedData.reserve_price || null,
            bid_count: extractedData.bid_count || 0,
            view_count: extractedData.view_count || 0,
            watcher_count: extractedData.watcher_count || 0,
            sold_at: extractedData.sale_date ? new Date(extractedData.sale_date).toISOString() : null,
            listing_status: extractedData.sale_price ? 'sold' : 'ended',
            metadata: {
              lot_number: extractedData.lot_number,
              seller: extractedData.seller,
              buyer: extractedData.buyer,
              seller_username: extractedData.seller,
              buyer_username: extractedData.buyer,
              high_bidder: Array.isArray(extractedData.bid_history) && extractedData.bid_history.length > 0
                ? ([...extractedData.bid_history].sort((a, b) => (b.amount || 0) - (a.amount || 0))[0]?.bidder || null)
                : null,
              seller_bat_user_id: extractedData.seller ? (batIdentityByUsername.get(String(extractedData.seller).trim())?.id || null) : null,
              buyer_bat_user_id: extractedData.buyer ? (batIdentityByUsername.get(String(extractedData.buyer).trim())?.id || null) : null,
              seller_external_identity_id: extractedData.seller ? (batIdentityByUsername.get(String(extractedData.seller).trim())?.external_identity_id || null) : null,
              buyer_external_identity_id: extractedData.buyer ? (batIdentityByUsername.get(String(extractedData.buyer).trim())?.external_identity_id || null) : null,
              location: (() => {
                const loc = normalizeListingLocation(extractedData.location);
                return loc.clean;
              })(),
              technical_specs: {
                engine: extractedData.engine,
                transmission: extractedData.transmission,
                drivetrain: extractedData.drivetrain,
                displacement: extractedData.displacement,
              }
            },
          })
          .select('id')
          .single();
        
        if (newListing) {
          listingId = newListing.id;
        }
      }

      // Create timeline events for auction activity
      // Use AI-suggested timeline events if available, otherwise create standard ones
      const timelineEvents: any[] = [];
      
      // If AI provided timeline events, use those (they're more comprehensive)
      if ((extractedData as any).auction_timeline_events && Array.isArray((extractedData as any).auction_timeline_events)) {
        for (const aiEvent of (extractedData as any).auction_timeline_events) {
          timelineEvents.push({
            vehicle_id: vehicleId,
            event_type: aiEvent.event_type,
            event_category: 'ownership',
            title: aiEvent.title,
            description: aiEvent.description,
            event_date: aiEvent.event_date,
            source: 'Bring a Trailer',
            source_type: 'dealer_record',
            confidence_score: 95,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: extractedData.lot_number,
              platform: 'bat',
              ...aiEvent.metadata,
            },
            cost_amount: aiEvent.event_type === 'auction_sold' ? extractedData.sale_price : undefined,
          });
        }
      } else {
        // Fallback to standard timeline events if AI didn't provide them
        // Auction listed event
        if (extractedData.auction_start_date) {
          timelineEvents.push({
            vehicle_id: vehicleId,
            event_type: 'auction_listed',
            event_category: 'ownership',
            title: 'Listed for Auction',
            description: `Vehicle listed on Bring a Trailer${extractedData.lot_number ? ` (Lot #${extractedData.lot_number})` : ''}`,
            event_date: extractedData.auction_start_date,
            source: 'Bring a Trailer',
            source_type: 'dealer_record',
            confidence_score: 95,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: extractedData.lot_number,
              seller: extractedData.seller,
              platform: 'bat',
            },
          });
        }
        
        // Auction started event
        if (extractedData.auction_start_date) {
          timelineEvents.push({
            vehicle_id: vehicleId,
            event_type: 'auction_started',
            event_category: 'ownership',
            title: 'Auction Started',
            description: `Auction went live on Bring a Trailer${extractedData.reserve_price ? ` with reserve of $${extractedData.reserve_price.toLocaleString()}` : ''}`,
            event_date: extractedData.auction_start_date,
            source: 'Bring a Trailer',
            source_type: 'dealer_record',
            confidence_score: 95,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: extractedData.lot_number,
              reserve_price: extractedData.reserve_price,
              platform: 'bat',
            },
          });
        }
        
        // Create timeline events for significant bid milestones
        if (extractedData.bid_history && extractedData.bid_history.length > 0) {
          const sortedBids = [...extractedData.bid_history].sort((a, b) => b.amount - a.amount);
          
          // First bid - use actual timestamp from bid history if available
          if (sortedBids.length > 0) {
            const firstBid = sortedBids[sortedBids.length - 1];
            timelineEvents.push({
              vehicle_id: vehicleId,
              event_type: 'auction_bid_placed',
              event_category: 'ownership',
              title: `First Bid: $${firstBid.amount.toLocaleString()}`,
              description: `First bid placed on auction${firstBid.bidder ? ` by ${firstBid.bidder}` : ''}`,
              // Don't use today's date as fallback - only create event if we have a valid date
              event_date: firstBid.timestamp || extractedData.auction_start_date || extractedData.sale_date || extractedData.auction_end_date,
              source: 'Bring a Trailer',
              source_type: 'dealer_record',
              confidence_score: 90,
              metadata: {
                source: 'bat_import',
                bat_url: batUrl,
                lot_number: extractedData.lot_number,
                bid_amount: firstBid.amount,
                bidder: firstBid.bidder,
                bid_sequence: 1,
                platform: 'bat',
              },
            });
          }
          
          // Reserve met (if we have reserve price and bids exceeded it)
          if (extractedData.reserve_price && sortedBids.length > 0 && sortedBids[0].amount >= extractedData.reserve_price) {
            const reserveMetBid = sortedBids.find(b => b.amount >= extractedData.reserve_price!);
            if (reserveMetBid) {
              timelineEvents.push({
                vehicle_id: vehicleId,
                event_type: 'auction_reserve_met',
                event_category: 'ownership',
                title: 'Reserve Met',
                description: `Reserve price of $${extractedData.reserve_price.toLocaleString()} met with bid of $${reserveMetBid.amount.toLocaleString()}`,
                // Don't use today's date as fallback - only create event if we have a valid date
                event_date: reserveMetBid.timestamp || extractedData.auction_start_date || extractedData.sale_date || extractedData.auction_end_date,
                source: 'Bring a Trailer',
                source_type: 'dealer_record',
                confidence_score: 95,
                metadata: {
                  source: 'bat_import',
                  bat_url: batUrl,
                  lot_number: extractedData.lot_number,
                  reserve_price: extractedData.reserve_price,
                  bid_amount: reserveMetBid.amount,
                  bidder: reserveMetBid.bidder,
                  platform: 'bat',
                },
              });
            }
          }
          
          // Highest bid (if different from final sale)
          if (sortedBids.length > 0 && sortedBids[0].amount !== extractedData.sale_price) {
            timelineEvents.push({
              vehicle_id: vehicleId,
              event_type: 'auction_bid_placed',
              event_category: 'ownership',
              title: `High Bid: $${sortedBids[0].amount.toLocaleString()}`,
              description: `Highest bid reached${sortedBids[0].bidder ? ` by ${sortedBids[0].bidder}` : ''}`,
              // Don't use today's date as fallback - only create event if we have a valid date
              event_date: sortedBids[0].timestamp || extractedData.auction_end_date || extractedData.auction_start_date || extractedData.sale_date,
              source: 'Bring a Trailer',
              source_type: 'dealer_record',
              confidence_score: 90,
              metadata: {
                source: 'bat_import',
                bat_url: batUrl,
                lot_number: extractedData.lot_number,
                bid_amount: sortedBids[0].amount,
                bidder: sortedBids[0].bidder,
                is_high_bid: true,
                platform: 'bat',
              },
            });
          }
        }
        
        // Auction ended event
        if (extractedData.auction_end_date) {
          timelineEvents.push({
            vehicle_id: vehicleId,
            event_type: 'auction_ended',
            event_category: 'ownership',
            title: 'Auction Ended',
            description: `Auction closed on Bring a Trailer${extractedData.bid_count ? ` with ${extractedData.bid_count} bids` : ''}${extractedData.view_count ? ` and ${extractedData.view_count} views` : ''}`,
            event_date: extractedData.auction_end_date,
            source: 'Bring a Trailer',
            source_type: 'dealer_record',
            confidence_score: 95,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: extractedData.lot_number,
              bid_count: extractedData.bid_count,
              view_count: extractedData.view_count,
              final_bid: extractedData.sale_price,
              platform: 'bat',
            },
          });
        }
        
        // Auction sold event
        if (extractedData.sale_price && extractedData.sale_date) {
          timelineEvents.push({
            vehicle_id: vehicleId,
            event_type: 'auction_sold',
            event_category: 'ownership',
            title: `Sold on Bring a Trailer for $${extractedData.sale_price.toLocaleString()}`,
            description: `Vehicle sold on BaT auction${extractedData.lot_number ? ` #${extractedData.lot_number}` : ''}${extractedData.seller ? `. Seller: ${extractedData.seller}` : ''}${extractedData.buyer ? `, Buyer: ${extractedData.buyer}` : ''}`,
            event_date: extractedData.sale_date,
            cost_amount: extractedData.sale_price,
            source: 'Bring a Trailer',
            source_type: 'dealer_record',
            confidence_score: 100,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: extractedData.lot_number,
              seller: extractedData.seller,
              buyer: extractedData.buyer,
              bid_count: extractedData.bid_count,
              view_count: extractedData.view_count,
              platform: 'bat',
            },
          });
        }
      }
      
      // Insert timeline events (check for duplicates first)
      if (timelineEvents.length > 0) {
        for (const event of timelineEvents) {
          // Check if event already exists
          const { data: existing } = await supabase
            .from('timeline_events')
            .select('id')
            .eq('vehicle_id', vehicleId)
            .eq('event_type', event.event_type)
            .eq('event_date', event.event_date)
            .maybeSingle();
          
          if (!existing) {
            await supabase
              .from('timeline_events')
              .insert(event);
          }
        }
      }
      
      // Create data validations
      const validations: any[] = [];
      
      if (extractedData.vin) {
        validations.push({
          entity_type: 'vehicle',
          entity_id: vehicleId,
          field_name: 'vin',
          field_value: extractedData.vin,
          validation_source: 'bat_listing',
          confidence_score: 100,
          source_url: batUrl,
          notes: `VIN extracted from BaT listing${extractedData.lot_number ? ` #${extractedData.lot_number}` : ''}`,
        });
      }
      
      if (extractedData.sale_price) {
        validations.push({
          entity_type: 'vehicle',
          entity_id: vehicleId,
          field_name: 'sale_price',
          field_value: extractedData.sale_price.toString(),
          validation_source: 'bat_listing',
          confidence_score: 100,
          source_url: batUrl,
          notes: `Sale price verified from BaT listing${extractedData.lot_number ? ` #${extractedData.lot_number}` : ''}`,
        });
      }
      
      if (validations.length > 0) {
        await supabase
          .from('data_validations')
          .upsert(validations, { onConflict: 'vehicle_id,field_name' });
      }
      
      // Also ensure vehicle_field_sources exists for sale_price if we have it
      // This creates the reverse map from price → BAT listing (all data annotated)
      // Every price claim must have a verifiable source mapped back to the listing
      if (extractedData.sale_price && vehicleId) {
        await supabase
          .from('vehicle_field_sources')
          .upsert({
            vehicle_id: vehicleId,
            field_name: 'sale_price',
            field_value: extractedData.sale_price.toString(),
            source_type: 'ai_scraped',
            source_url: batUrl,
            extraction_method: 'bat_listing_scraping',
            confidence_score: 100,
            is_verified: true,
            metadata: {
              source: 'bat_import',
              bat_url: batUrl,
              lot_number: extractedData.lot_number || null,
              sale_date: extractedData.sale_date || null,
              extraction_date: new Date().toISOString(),
              seller: extractedData.seller || null,
              buyer: extractedData.buyer || null,
              bid_count: extractedData.bid_count || null,
              view_count: extractedData.view_count || null,
              // Reverse mapping: all data points back to the BAT listing
              verified_from: 'bringatrailer_listing',
              listing_url: batUrl
            }
          }, {
            onConflict: 'vehicle_id,field_name,source_type,source_url'
          });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: extractedData,
        vehicleId: vehicleId || null,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error extracting BaT data:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

