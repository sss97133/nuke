#!/usr/bin/env npx tsx
/**
 * Auction Forensics Analyzer
 *
 * Extracts MAXIMUM data from auction recordings to detect patterns:
 *
 * 1. TIMING ANALYSIS
 *    - Vehicle on-screen time (lot duration)
 *    - Time from first bid to hammer
 *    - Auctioneer pace (words per minute)
 *
 * 2. BID VELOCITY
 *    - Bids per second
 *    - Bid acceleration/deceleration
 *    - Dead time between bids
 *    - Final rush patterns
 *
 * 3. AUCTIONEER TRANSLATION
 *    - Decode auction chant ("I got 50, now 55, 55 bid...")
 *    - Extract actual bid amounts from gibberish
 *    - Identify filler vs real bids
 *
 * 4. PATTERN DETECTION
 *    - Too-fast lots (rushed through)
 *    - Unusual bid patterns (shill bidding?)
 *    - Price vs estimate discrepancies
 *    - Auctioneer behavior patterns
 *
 * Hypothesis: Find evidence of cars being run through too fast / sold too low
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATA_DIR = '/tmp/auction-forensics';

// ═══════════════════════════════════════════════════════════════
// DATABASE INTEGRATION
// ═══════════════════════════════════════════════════════════════

interface VehicleEstimates {
  vehicleId: string;
  auctionEventId: string;
  estimateLow: number | null;
  estimateHigh: number | null;
  year: number;
  make: string;
  model: string;
}

async function lookupVehicleEstimates(
  lotNumber: string,
  vehicleDesc: string,
  auctionSource: string = 'mecum'
): Promise<VehicleEstimates | null> {
  // Only match by EXACT lot number - no fuzzy year/make matching
  // Fuzzy matching creates wrong data

  // Check if it looks like a real Mecum lot (S98, F89, T306, S115.1, etc.)
  const realLotPattern = /^[STFK]\d+(\.\d+)?$/i;
  const cleanLot = lotNumber.replace(/^Lot\s*/i, '').trim().toUpperCase();

  if (!realLotPattern.test(cleanLot)) {
    // Not a real lot number (e.g., "Lot 1" from GPT) - can't match reliably
    console.log(`    ⚠️ Cannot match "${lotNumber}" - not a valid Mecum lot number`);
    return null;
  }

  const { data } = await supabase
    .from('auction_events')
    .select('id, vehicle_id, lot_number, estimate_low, estimate_high, vehicles(year, make, model)')
    .eq('source', auctionSource)
    .ilike('lot_number', cleanLot)
    .limit(1)
    .single();

  if (data?.vehicle_id) {
    const v = data.vehicles as any;
    console.log(`    ✓ Matched ${cleanLot} → ${v?.year} ${v?.make} ${v?.model}`);
    return {
      vehicleId: data.vehicle_id,
      auctionEventId: data.id,
      estimateLow: data.estimate_low,
      estimateHigh: data.estimate_high,
      year: v?.year,
      make: v?.make,
      model: v?.model,
    };
  }

  console.log(`    ⚠️ No match for lot ${cleanLot} in database`);
  return null;
}

async function saveForensicsToVehicle(
  vehicleId: string,
  auctionEventId: string,
  analysis: LotAnalysis,
  videoUrl?: string
): Promise<void> {
  // Update auction_event with forensics data
  const { error } = await supabase
    .from('auction_events')
    .update({
      broadcast_video_url: videoUrl || null,
      broadcast_timestamp_start: Math.round(analysis.announcementTime),
      broadcast_timestamp_end: Math.round(analysis.hammerTime),
      outcome: analysis.outcome,
      winning_bid: analysis.finalPrice > 0 ? analysis.finalPrice : null,
      // Store forensics metadata
      forensics_data: {
        lotNumber: analysis.lotNumber,
        vehicleDescription: analysis.vehicleDescription,
        duration: analysis.totalDuration,
        bidCount: analysis.bidCount,
        bidsPerSecond: analysis.bidsPerSecond,
        wordsPerMinute: analysis.wordsPerMinute,
        alertScore: analysis.alertScore,
        alerts: analysis.alerts,
        flags: analysis.flags,
        bids: analysis.bids,
        translatedSpeech: analysis.translatedSpeech?.slice(0, 10), // Keep top 10 key phrases
        analyzedAt: new Date().toISOString(),
      },
    })
    .eq('id', auctionEventId);

  if (error) {
    console.log(`    ❌ Failed to save: ${error.message}`);
  } else {
    console.log(`    💾 Saved to lot ${analysis.lotNumber}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// DATA STRUCTURES
// ═══════════════════════════════════════════════════════════════

interface BidEvent {
  timestamp: number;        // Seconds into video
  amount: number;           // Bid amount in dollars
  source: 'floor' | 'phone' | 'internet' | 'unknown';
  isReal: boolean;          // True bid vs auctioneer filler
  confidence: number;       // 0-1 confidence score
}

interface LotAnalysis {
  lotNumber: string;
  vehicleDescription: string;

  // Timing
  announcementTime: number;     // When lot announced
  firstBidTime: number;         // When bidding started
  hammerTime: number;           // When sold/no-sale
  totalDuration: number;        // Total seconds on block
  activeBiddingTime: number;    // Time with actual bids
  deadTime: number;             // Gaps with no activity

  // Bids
  bids: BidEvent[];
  startingBid: number;
  finalPrice: number;
  bidCount: number;
  realBidCount: number;         // Excluding filler
  avgBidIncrement: number;
  maxBidIncrement: number;

  // Velocity
  bidsPerSecond: number;
  peakBidsPerSecond: number;
  bidAcceleration: number;      // How much bidding sped up
  finalRushIntensity: number;   // Activity in last 10 seconds

  // Auctioneer
  auctioneerId?: string;
  wordsPerMinute: number;
  fillerRatio: number;          // % of speech that's filler
  urgencyScore: number;         // How urgently they pushed

  // Auctioneer Translation (decoded speech)
  translatedSpeech: AuctioneerPhrase[];  // Full decoded auctioneer commentary

  // Outcome
  outcome: 'sold' | 'no_sale';
  estimateLow?: number;         // Low estimate from auction house
  estimateHigh?: number;        // High estimate from auction house
  estimatedValue?: string;      // Single estimate (from transcript if no DB data)
  priceVsEstimate?: number;     // Ratio of final to estimate midpoint

  // Flags
  flags: {
    tooFast: boolean;           // Duration < threshold
    lowActivity: boolean;       // Few real bids
    unusualPattern: boolean;    // Anomaly detected
    priceAlert: boolean;      // Sold way under/over estimate
  };

  alertScore: number;           // Risk/alert score 0-100 (higher = more concerning)
  alerts: string[];             // List of specific concerns/flags
}

interface AuctioneerPhrase {
  timestamp: number;
  raw: string;              // What they said
  translated: string;       // What it means
  bidAmount?: number;       // If announcing a bid
  isFiller: boolean;        // "Looking for", "Who's in", etc.
}

// ═══════════════════════════════════════════════════════════════
// AUCTIONEER TRANSLATION
// ═══════════════════════════════════════════════════════════════

// Written number to digit conversion (Whisper transcribes numbers as words)
const WORD_TO_NUM: Record<string, number> = {
  'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
  'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
  'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
  'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
  'seventy': 70, 'eighty': 80, 'ninety': 90,
  'hundred': 100, 'thousand': 1000, 'million': 1000000,
  'grand': 1000, 'k': 1000,
};

function parseWrittenNumber(text: string): number | null {
  // Handle digit patterns first
  const digitMatch = text.match(/\$?([\d,]+)\s*(?:thousand|grand|k)?/i);
  if (digitMatch) {
    const num = parseInt(digitMatch[1].replace(/,/g, ''));
    if (text.toLowerCase().match(/thousand|grand|k/)) return num * 1000;
    return num;
  }

  // Handle written numbers: "ninety thousand", "six hundred forty five thousand"
  const words = text.toLowerCase().split(/[\s-]+/);
  let total = 0;
  let current = 0;

  for (const word of words) {
    const val = WORD_TO_NUM[word];
    if (val === undefined) continue;

    if (val === 1000000) {
      current = current === 0 ? 1 : current;
      total += current * 1000000;
      current = 0;
    } else if (val === 1000) {
      current = current === 0 ? 1 : current;
      total += current * 1000;
      current = 0;
    } else if (val === 100) {
      current = current === 0 ? 1 : current;
      current *= 100;
    } else {
      current += val;
    }
  }

  total += current;
  return total > 0 ? total : null;
}

// Common engine sizes that should NOT be parsed as bid amounts
const ENGINE_SIZES = new Set([
  '289', '302', '305', '307', '327', '350', '351', '360', '383', '390',
  '400', '401', '409', '426', '427', '428', '429', '430', '440', '454',
  '455', '460', '462', '472', '500', '502', '572',
]);

/**
 * Extract auctioneer shorthand bids from rapid-fire chant
 * Examples:
 *   "1 80" = $180,000 (1 hundred 80 thousand)
 *   "1 75" = $175,000
 *   "90" = $90,000
 *   "65" = $65,000
 *
 * Filters out:
 *   - Common engine sizes (302, 350, 427, 454, etc.)
 *   - Numbers in technical context (horsepower, displacement)
 */
function extractAuctioneerShorthand(text: string, hasBidContext: boolean): number[] {
  const amounts: number[] = [];

  // Only extract shorthand if there's bid-related context nearby
  // This prevents parsing engine specs as bids
  if (!hasBidContext) {
    return amounts;
  }

  // Pattern for "X YY" format (e.g., "1 80" = $180K, "2 50" = $250K)
  // Only match where first digit is 1-3 (typical bid range $100K-$399K)
  // Avoid 4-5 which are usually engine prefixes (4 30 = 430 engine)
  const shorthandPattern = /\b([1-3])\s+([0-9]{2})\b/g;
  let match;
  while ((match = shorthandPattern.exec(text)) !== null) {
    const hundreds = parseInt(match[1]);
    const tens = parseInt(match[2]);
    // "1 80" means $180,000 (100K + 80K)
    const amount = (hundreds * 100 + tens) * 1000;
    if (amount >= 100000 && amount <= 3990000) {
      amounts.push(amount);
    }
  }

  // Pattern for standalone two-digit numbers (50-99 = $50K-$99K)
  // Only if followed/preceded by other bid numbers
  const twoDigitPattern = /\b([5-9][0-9])\b/g;
  while ((match = twoDigitPattern.exec(text)) !== null) {
    const num = match[1];
    // Skip if it looks like a year (50-99 could be 1950-1999)
    if (text.includes('19' + num) || text.includes("'" + num)) continue;
    const amount = parseInt(num) * 1000;
    amounts.push(amount);
  }

  // Pattern for three-digit numbers as potential bids
  // Filter out engine sizes
  const threeDigitPattern = /\b([1-9][0-9]{2})\b/g;
  while ((match = threeDigitPattern.exec(text)) !== null) {
    const numStr = match[1];
    const num = parseInt(numStr);
    // Skip known engine sizes
    if (ENGINE_SIZES.has(numStr)) continue;
    // Skip if context suggests engine (cubic, ci, horsepower, hp)
    const contextWindow = text.substring(
      Math.max(0, match.index - 20),
      Math.min(text.length, match.index + 20)
    ).toLowerCase();
    if (/cubic|ci\b|horse|hp\b|engine|block|displacement/i.test(contextWindow)) continue;
    // In bid context, treat as thousands (180 = $180K)
    if (num >= 100 && num <= 999) {
      amounts.push(num * 1000);
    }
  }

  return amounts;
}

const AUCTIONEER_PATTERNS = {
  // Patterns that indicate a price/bid is being stated
  // Whisper outputs written numbers, so we match phrases and extract numbers separately
  bidPhrasePatterns: [
    // Direct bid statements
    /(?:bid|bidding)\s+(?:at|is|of|now)?\s*(.+?)(?:dollars?|$)/gi,
    /(?:the\s+)?bid\s+(?:at|is)\s*(.+?)(?:dollars?|here|$)/gi,
    // Sale announcements
    /sells?\s+(?:at|for)\s*(.+?)(?:dollars?|here|$)/gi,
    /brought\s+(.+?)(?:dollars?|$)/gi,
    /hammers?\s+(?:it\s+)?(?:at|for)\s*(.+?)(?:dollars?|$)/gi,
    /sold\s+(?:at|for)?\s*(.+?)(?:dollars?|$)/gi,
    // Direct amounts
    /(\w+(?:\s+\w+)*)\s+(?:thousand|grand|k)\s*(?:dollars?)?/gi,
    /(\w+(?:\s+\w+)*)\s+dollars/gi,
    // Numeric patterns
    /\$?([\d,]+)\s*(?:thousand|grand|k)?/gi,
  ],

  // Filler phrases (not real bids)
  fillerPhrases: [
    'looking for', 'who wants', 'who\'s in', 'come on', 'don\'t miss',
    'last chance', 'fair warning', 'going once', 'going twice',
    'anybody else', 'any more', 'one more time', 'right here',
    'yep yep yep', 'hey hey hey', 'money money money',
    'how about', 'can we get', 'we need', 'i need',
  ],

  // Outcome indicators
  soldPhrases: ['sold', 'hammer', 'hammers', 'congratulations', 'you got it', 'yours', 'new owner'],
  noSalePhrases: ['no sale', 'pass', 'reserve not met', 'take it back', 'didn\'t meet'],

  // Bid source indicators
  phoneBid: ['phone', 'on the phone', 'internet', 'online'],
  floorBid: ['floor', 'front row', 'right here', 'in the room'],
};

async function translateAuctioneerSpeech(
  segments: { start: number; end: number; text: string }[]
): Promise<AuctioneerPhrase[]> {
  const phrases: AuctioneerPhrase[] = [];

  for (const seg of segments) {
    const text = seg.text.toLowerCase();

    // Try to extract bid amounts using multiple strategies
    let bidAmount: number | undefined;
    let allShorthandBids: number[] = [];

    // Strategy 1: Try phrase patterns that capture context around numbers
    for (const pattern of AUCTIONEER_PATTERNS.bidPhrasePatterns) {
      pattern.lastIndex = 0; // Reset regex state
      const match = pattern.exec(text);
      if (match && match[1]) {
        const parsed = parseWrittenNumber(match[1]);
        if (parsed && parsed >= 1000 && parsed < 100000000) {
          bidAmount = parsed;
          break;
        }
      }
    }

    // Strategy 2: If no phrase match, try parsing the whole segment for numbers
    if (!bidAmount) {
      const parsed = parseWrittenNumber(text);
      if (parsed && parsed >= 1000 && parsed < 100000000) {
        bidAmount = parsed;
      }
    }

    // Check if segment has bid-related context
    const hasBidContext = /bid|sell|sold|bought|hammer|goes|brings|got|need|call|money|dollar/i.test(text);

    // Strategy 3: Extract auctioneer shorthand (rapid-fire chant like "1 80 1 75 1 80")
    // This captures the actual bid-by-bid action
    // Only run if there's bid context to avoid parsing engine specs as bids
    allShorthandBids = extractAuctioneerShorthand(seg.text, hasBidContext);
    if (allShorthandBids.length > 0) {
      // Shorthand bids from rapid-fire chant OVERRIDE generic number parsing
      // because they're more likely to be accurate in auction context
      const shorthandMax = Math.max(...allShorthandBids);
      if (shorthandMax > (bidAmount || 0)) {
        bidAmount = shorthandMax;
      }
    }

    // Determine event type - check this BEFORE marking as filler
    const isSold = AUCTIONEER_PATTERNS.soldPhrases.some(p => text.includes(p));
    const isNoSale = AUCTIONEER_PATTERNS.noSalePhrases.some(p => text.includes(p));

    // Only mark as filler if there's no meaningful content
    const isFiller = !bidAmount && !isSold && !isNoSale &&
      AUCTIONEER_PATTERNS.fillerPhrases.some(f => text.includes(f));

    // Generate translation
    let translated = seg.text;
    if (isSold && bidAmount) {
      translated = `SOLD at $${bidAmount.toLocaleString()}`;
    } else if (isSold) {
      translated = 'SOLD';
    } else if (isNoSale) {
      translated = 'NO SALE';
    } else if (allShorthandBids.length > 1) {
      // Multiple rapid-fire bids detected - show the sequence
      const bidSequence = allShorthandBids.map(b => `$${(b/1000).toFixed(0)}K`).join(' → ');
      translated = `CHANT: ${bidSequence}`;
    } else if (bidAmount) {
      translated = `BID: $${bidAmount.toLocaleString()}`;
    } else if (isFiller) {
      translated = `[Filler: ${seg.text.trim()}]`;
    }

    phrases.push({
      timestamp: seg.start,
      raw: seg.text,
      translated,
      bidAmount,
      isFiller,
    });
  }

  return phrases;
}

// ═══════════════════════════════════════════════════════════════
// BID EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractBidsFromPhrases(phrases: AuctioneerPhrase[]): BidEvent[] {
  const bids: BidEvent[] = [];
  let lastBidAmount = 0;

  for (const phrase of phrases) {
    if (!phrase.bidAmount || phrase.isFiller) continue;
    if (phrase.bidAmount <= lastBidAmount) continue;

    // Filter out year-like numbers (1900-2099 are likely car years, not prices)
    if (phrase.bidAmount >= 1900 && phrase.bidAmount <= 2099) continue;

    // Filter out very small amounts that are likely misparses
    // Collector car auctions rarely have bids under $5,000
    if (phrase.bidAmount < 5000) continue;

    // Check context - is this actually announcing a bid/sale?
    const text = phrase.raw.toLowerCase();
    const hasBidContext = /bid|sell|sold|bought|hammer|price|thousand|grand|dollars|goes|brings/i.test(text);

    // If it's a large amount, require less context
    // If it's a smaller amount, require stronger bid context
    const isLargeAmount = phrase.bidAmount >= 50000;
    if (!isLargeAmount && !hasBidContext) continue;

    // Determine bid source
    let source: BidEvent['source'] = 'unknown';
    if (AUCTIONEER_PATTERNS.phoneBid.some(p => text.includes(p))) {
      source = 'phone';
    } else if (AUCTIONEER_PATTERNS.floorBid.some(p => text.includes(p))) {
      source = 'floor';
    }

    // Determine confidence based on context quality
    let confidence = 0.5;
    if (hasBidContext) confidence = 0.7;
    if (/sold|hammer|final|gone/i.test(text)) confidence = 0.9;
    if (/bid at|sells for|brought/i.test(text)) confidence = 0.95;

    bids.push({
      timestamp: phrase.timestamp,
      amount: phrase.bidAmount,
      source,
      isReal: true,
      confidence,
    });

    lastBidAmount = phrase.bidAmount;
  }

  return bids;
}

// ═══════════════════════════════════════════════════════════════
// VELOCITY ANALYSIS
// ═══════════════════════════════════════════════════════════════

function analyzeVelocity(bids: BidEvent[], duration: number) {
  if (bids.length < 2) {
    return {
      bidsPerSecond: 0,
      peakBidsPerSecond: 0,
      bidAcceleration: 0,
      finalRushIntensity: 0,
    };
  }

  // Overall rate
  const bidsPerSecond = bids.length / duration;

  // Calculate intervals
  const intervals: number[] = [];
  for (let i = 1; i < bids.length; i++) {
    intervals.push(bids[i].timestamp - bids[i - 1].timestamp);
  }

  // Peak rate (smallest interval = fastest bidding)
  const minInterval = Math.min(...intervals);
  const peakBidsPerSecond = minInterval > 0 ? 1 / minInterval : 0;

  // Acceleration: compare first half vs second half
  const midpoint = Math.floor(intervals.length / 2);
  const firstHalfAvg = intervals.slice(0, midpoint).reduce((a, b) => a + b, 0) / midpoint || 1;
  const secondHalfAvg = intervals.slice(midpoint).reduce((a, b) => a + b, 0) / (intervals.length - midpoint) || 1;
  const bidAcceleration = firstHalfAvg / secondHalfAvg; // >1 means sped up

  // Final rush: bids in last 10 seconds
  const lastBidTime = bids[bids.length - 1].timestamp;
  const finalBids = bids.filter(b => b.timestamp > lastBidTime - 10);
  const finalRushIntensity = finalBids.length / 10;

  return {
    bidsPerSecond,
    peakBidsPerSecond,
    bidAcceleration,
    finalRushIntensity,
  };
}

// ═══════════════════════════════════════════════════════════════
// ANOMALY DETECTION
// ═══════════════════════════════════════════════════════════════

interface AnomalyThresholds {
  minLotDuration: number;       // Seconds - below this is "too fast"
  minBidCount: number;          // Real bids - below this is suspicious
  maxFillerRatio: number;       // Above this = too much filler
  minBidsPerSecond: number;     // Below this = low activity
  priceDeviationThreshold: number; // % deviation from estimate
}

const DEFAULT_THRESHOLDS: AnomalyThresholds = {
  minLotDuration: 60,           // At least 1 minute
  minBidCount: 3,               // At least 3 real bids
  maxFillerRatio: 0.7,          // No more than 70% filler
  minBidsPerSecond: 0.05,       // At least 1 bid per 20 seconds
  priceDeviationThreshold: 0.5, // Within 50% of estimate
};

function detectAlerts(
  lot: Partial<LotAnalysis>,
  thresholds = DEFAULT_THRESHOLDS
): { alertScore: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // Too fast
  if (lot.totalDuration && lot.totalDuration < thresholds.minLotDuration) {
    reasons.push(`Too fast: ${lot.totalDuration}s (min: ${thresholds.minLotDuration}s)`);
    score += 25;
  }

  // Low bid count
  if (lot.realBidCount !== undefined && lot.realBidCount < thresholds.minBidCount) {
    reasons.push(`Low activity: ${lot.realBidCount} bids (min: ${thresholds.minBidCount})`);
    score += 20;
  }

  // High filler ratio
  if (lot.fillerRatio !== undefined && lot.fillerRatio > thresholds.maxFillerRatio) {
    reasons.push(`High filler: ${Math.round(lot.fillerRatio * 100)}% (max: ${thresholds.maxFillerRatio * 100}%)`);
    score += 15;
  }

  // Low bid velocity
  if (lot.bidsPerSecond !== undefined && lot.bidsPerSecond < thresholds.minBidsPerSecond) {
    reasons.push(`Slow bidding: ${lot.bidsPerSecond.toFixed(3)} bids/sec`);
    score += 15;
  }

  // Price anomaly
  if (lot.priceVsEstimate !== undefined) {
    if (lot.priceVsEstimate < (1 - thresholds.priceDeviationThreshold)) {
      reasons.push(`Sold ${Math.round((1 - lot.priceVsEstimate) * 100)}% under estimate`);
      score += 25;
    } else if (lot.priceVsEstimate > (1 + thresholds.priceDeviationThreshold)) {
      reasons.push(`Sold ${Math.round((lot.priceVsEstimate - 1) * 100)}% over estimate`);
      score += 10; // Over-selling is less suspicious
    }
  }

  // No final rush (might indicate pre-arranged sale)
  if (lot.finalRushIntensity !== undefined && lot.finalRushIntensity < 0.1 && lot.outcome === 'sold') {
    reasons.push('No final bidding rush');
    score += 10;
  }

  return { alertScore: Math.min(100, score), reasons };
}

// ═══════════════════════════════════════════════════════════════
// FULL LOT ANALYSIS
// ═══════════════════════════════════════════════════════════════

async function analyzeLot(
  segments: { start: number; end: number; text: string }[],
  lotInfo: {
    lotNumber: string;
    vehicle: string;
    estimate?: number;
    estimateLow?: number;
    estimateHigh?: number;
    vehicleId?: string;
    auctionEventId?: string;
  }
): Promise<LotAnalysis> {
  // Translate auctioneer speech
  const phrases = await translateAuctioneerSpeech(segments);

  // Extract bids
  const bids = extractBidsFromPhrases(phrases);

  // Calculate timing
  const announcementTime = segments[0]?.start || 0;
  const hammerTime = segments[segments.length - 1]?.end || 0;
  const firstBidTime = bids[0]?.timestamp || announcementTime;
  const totalDuration = hammerTime - announcementTime;

  // Calculate dead time (gaps > 3 seconds with no bids)
  let deadTime = 0;
  for (let i = 1; i < bids.length; i++) {
    const gap = bids[i].timestamp - bids[i - 1].timestamp;
    if (gap > 3) deadTime += gap - 3;
  }

  // Velocity analysis
  const velocity = analyzeVelocity(bids, totalDuration);

  // Auctioneer metrics
  const totalWords = segments.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0);
  const wordsPerMinute = totalDuration > 0 ? (totalWords / totalDuration) * 60 : 0;
  const fillerCount = phrases.filter(p => p.isFiller).length;
  const fillerRatio = phrases.length > 0 ? fillerCount / phrases.length : 0;

  // Outcome
  const lastText = segments[segments.length - 1]?.text.toLowerCase() || '';
  const outcome = AUCTIONEER_PATTERNS.soldPhrases.some(p => lastText.includes(p)) ? 'sold' : 'no_sale';

  // Calculate price vs estimate using high/low range if available
  let priceVsEstimate: number | undefined;
  const finalBidAmount = bids.length > 0 ? bids[bids.length - 1].amount : 0;

  if (lotInfo.estimateLow && lotInfo.estimateHigh && finalBidAmount > 0) {
    // Use midpoint of estimate range
    const estimateMidpoint = (lotInfo.estimateLow + lotInfo.estimateHigh) / 2;
    priceVsEstimate = finalBidAmount / estimateMidpoint;
  } else if (lotInfo.estimate && finalBidAmount > 0) {
    priceVsEstimate = finalBidAmount / lotInfo.estimate;
  }

  // Build partial analysis for anomaly detection
  const partial: Partial<LotAnalysis> = {
    totalDuration,
    realBidCount: bids.length,
    bidsPerSecond: velocity.bidsPerSecond,
    fillerRatio,
    finalRushIntensity: velocity.finalRushIntensity,
    outcome,
    priceVsEstimate,
  };

  // Detect anomalies
  const { alertScore, reasons } = detectAlerts(partial);

  // Filter to key translated phrases for output
  const keyPhrases = phrases.filter(p =>
    p.bidAmount || p.translated.includes('SOLD') || p.translated.includes('NO SALE')
  );

  return {
    lotNumber: lotInfo.lotNumber,
    vehicleDescription: lotInfo.vehicle,

    announcementTime,
    firstBidTime,
    hammerTime,
    totalDuration,
    activeBiddingTime: totalDuration - deadTime,
    deadTime,

    bids,
    startingBid: bids[0]?.amount || 0,
    finalPrice: bids[bids.length - 1]?.amount || 0,
    bidCount: bids.length,
    realBidCount: bids.length,
    avgBidIncrement: bids.length > 1
      ? (bids[bids.length - 1].amount - bids[0].amount) / (bids.length - 1)
      : 0,
    maxBidIncrement: bids.length > 1
      ? Math.max(...bids.slice(1).map((b, i) => b.amount - bids[i].amount))
      : 0,

    ...velocity,

    wordsPerMinute,
    fillerRatio,
    urgencyScore: 0, // TODO: sentiment analysis

    translatedSpeech: keyPhrases,

    outcome,
    estimateLow: lotInfo.estimateLow,
    estimateHigh: lotInfo.estimateHigh,
    estimatedValue: lotInfo.estimate?.toString() ||
      (lotInfo.estimateLow && lotInfo.estimateHigh
        ? `${lotInfo.estimateLow.toLocaleString()}-${lotInfo.estimateHigh.toLocaleString()}`
        : undefined),
    priceVsEstimate,

    flags: {
      tooFast: totalDuration < DEFAULT_THRESHOLDS.minLotDuration,
      lowActivity: bids.length < DEFAULT_THRESHOLDS.minBidCount,
      unusualPattern: velocity.bidAcceleration < 0.5 || velocity.bidAcceleration > 3,
      priceAlert: partial.priceVsEstimate !== undefined &&
        (partial.priceVsEstimate < 0.5 || partial.priceVsEstimate > 2),
    },

    alertScore,
    alerts: reasons,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN PROCESSING
// ═══════════════════════════════════════════════════════════════

async function processVideoForForensics(videoUrl: string) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  AUCTION FORENSICS ANALYZER');
  console.log('  Maximum data extraction + pattern alerts');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Get video metadata
  const metaResult = spawnSync('yt-dlp', ['--dump-json', '--no-download', videoUrl], {
    encoding: 'utf-8',
    timeout: 30000,
  });
  const meta = JSON.parse(metaResult.stdout);

  console.log(`Video: ${meta.title}`);
  console.log(`Duration: ${Math.round(meta.duration / 60)} minutes`);
  console.log(`\nExtracting maximum data...\n`);

  // For demo, process first 15 minutes
  const testDuration = Math.min(meta.duration, 900);
  const numChunks = Math.ceil(testDuration / 300);

  const allAnalyses: LotAnalysis[] = [];

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = i * 300;
    const chunkPath = path.join(DATA_DIR, `forensics_${meta.id}_${i}.wav`);

    console.log(`\nChunk ${i + 1}/${numChunks} [${formatTime(chunkStart)}]`);

    // Download audio
    if (!fs.existsSync(chunkPath)) {
      const startStr = formatTime(chunkStart);
      const endStr = formatTime(chunkStart + 300);
      execSync(
        `yt-dlp -f "bestaudio" --download-sections "*${startStr}-${endStr}" ` +
        `-x --audio-format wav --postprocessor-args "-ar 16000 -ac 1" ` +
        `-o "${chunkPath}" "${videoUrl}" 2>/dev/null`,
        { timeout: 180000 }
      );
    }

    // Transcribe with word-level timestamps
    console.log('  Transcribing...');
    const audioData = fs.readFileSync(chunkPath);
    const form = new FormData();
    form.append('file', new Blob([audioData]), 'audio.wav');
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('timestamp_granularities[]', 'word');

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });

    const transcript = await resp.json();
    const segments = (transcript.segments || []).map((s: any) => ({
      start: s.start + chunkStart,
      end: s.end + chunkStart,
      text: s.text,
    }));

    console.log(`  Got ${segments.length} segments`);

    // Use GPT to identify lot boundaries and info
    const lotBoundaries = await identifyLotBoundaries(segments);
    console.log(`  Found ${lotBoundaries.length} lots`);

    // Analyze each lot
    for (const lot of lotBoundaries) {
      const lotSegments = segments.filter(
        (s: any) => s.start >= lot.startTime && s.end <= lot.endTime
      );

      if (lotSegments.length > 0) {
        // Look up vehicle in database for high/low estimates
        const dbVehicle = await lookupVehicleEstimates(lot.lotNumber, lot.vehicle, 'mecum');

        const analysis = await analyzeLot(lotSegments, {
          lotNumber: lot.lotNumber,
          vehicle: lot.vehicle,
          estimate: lot.estimate,
          estimateLow: dbVehicle?.estimateLow || undefined,
          estimateHigh: dbVehicle?.estimateHigh || undefined,
          vehicleId: dbVehicle?.vehicleId,
          auctionEventId: dbVehicle?.auctionEventId,
        });

        allAnalyses.push(analysis);

        // Save to database if we found a matching vehicle
        if (dbVehicle?.vehicleId && dbVehicle?.auctionEventId) {
          await saveForensicsToVehicle(dbVehicle.vehicleId, dbVehicle.auctionEventId, analysis, videoUrl);
        }

        // Report with estimate range if available
        const flag = analysis.alertScore > 30 ? '⚠️' : analysis.alertScore > 10 ? '⚡' : '✓';
        const estimateStr = analysis.estimateLow && analysis.estimateHigh
          ? `Est: $${(analysis.estimateLow/1000).toFixed(0)}K-$${(analysis.estimateHigh/1000).toFixed(0)}K`
          : analysis.estimatedValue ? `Est: $${analysis.estimatedValue}` : '';
        console.log(`  ${flag} ${analysis.lotNumber}: ${analysis.vehicleDescription}`);
        console.log(`     Duration: ${analysis.totalDuration.toFixed(0)}s | Bids: ${analysis.bidCount} | Final: $${analysis.finalPrice.toLocaleString()} ${estimateStr}`);
        if (analysis.alerts.length > 0) {
          console.log(`     ⚠️ ${analysis.alerts.join('; ')}`);
        }
      }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary report
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FORENSICS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const flagged = allAnalyses.filter(a => a.alertScore > 30);
  const suspicious = allAnalyses.filter(a => a.alertScore > 10 && a.alertScore <= 30);

  console.log(`Total lots analyzed: ${allAnalyses.length}`);
  console.log(`Flagged (score > 30): ${flagged.length}`);
  console.log(`Suspicious (score 10-30): ${suspicious.length}`);
  console.log(`Clean: ${allAnalyses.length - flagged.length - suspicious.length}`);

  if (flagged.length > 0) {
    console.log('\n🚨 FLAGGED LOTS:');
    for (const lot of flagged) {
      console.log(`  ${lot.lotNumber}: ${lot.vehicleDescription}`);
      console.log(`    Score: ${lot.alertScore} | ${lot.alerts.join('; ')}`);
    }
  }

  // Save full analysis
  const outputPath = path.join(DATA_DIR, `forensics_${meta.id}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(allAnalyses, null, 2));
  console.log(`\nFull analysis saved to: ${outputPath}`);

  return allAnalyses;
}

async function identifyLotBoundaries(
  segments: { start: number; end: number; text: string }[]
): Promise<{ lotNumber: string; vehicle: string; estimate?: number; startTime: number; endTime: number; outcome?: string; finalPrice?: number }[]> {
  const fullText = segments.map(s => `[${s.start.toFixed(1)}] ${s.text}`).join('\n');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Identify individual auction lots from this Mecum auction transcript. Each timestamp in brackets is seconds.

IMPORTANT: Mecum lot numbers follow specific formats:
- S followed by number (e.g., S98, S115, S115.1) - main stage
- F followed by number (e.g., F123, F89) - featured
- T followed by number (e.g., T266) - other

For each lot, extract:
- lot_number: The ACTUAL Mecum lot number mentioned (e.g., "S98", "F123.1"). Listen for "lot S ninety-eight" = "S98"
- vehicle: Year make model (e.g., "1969 Chevrolet Corvette")
- estimate: Estimated value if mentioned (number only, no $)
- start_time: Timestamp (seconds) when lot is first announced
- end_time: Timestamp (seconds) when hammer falls (sold or no-sale)
- outcome: "sold" or "no_sale" - listen for "sold", "hammer", "congratulations" vs "no sale", "pass", "didn't meet reserve"
- final_price: Hammer price if sold (number only)

Return JSON: { "lots": [...] }`
        },
        { role: 'user', content: fullText }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  const gptData = await resp.json();
  const content = gptData.choices?.[0]?.message?.content || '{"lots":[]}';
  const parsed = JSON.parse(content);

  return (parsed.lots || []).map((lot: any) => ({
    lotNumber: lot.lot_number || 'Unknown',
    vehicle: lot.vehicle || 'Unknown Vehicle',
    estimate: lot.estimate,
    startTime: lot.start_time || 0,
    endTime: lot.end_time || 0,
    outcome: lot.outcome,
    finalPrice: lot.final_price,
  }));
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Main
const videoUrl = process.argv[2];

if (!videoUrl) {
  console.log('Auction Forensics Analyzer');
  console.log('');
  console.log('Extract maximum data from auction recordings to detect patterns.');
  console.log('');
  console.log('Usage:');
  console.log('  npx tsx scripts/auction-forensics-analyzer.ts <youtube-url>');
  console.log('');
  console.log('Analyzes:');
  console.log('  - Vehicle on-screen time');
  console.log('  - Bid velocity and patterns');
  console.log('  - Auctioneer speech translation');
  console.log('  - Anomaly detection (too fast, low activity, price deviation)');
  process.exit(0);
}

processVideoForForensics(videoUrl).catch(console.error);
