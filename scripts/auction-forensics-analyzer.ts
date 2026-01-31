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
 *    - Auctioneer behavior anomalies
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

  // Outcome
  outcome: 'sold' | 'no_sale';
  estimatedValue?: number;
  priceVsEstimate?: number;     // Ratio of final to estimate

  // Flags
  flags: {
    tooFast: boolean;           // Duration < threshold
    lowActivity: boolean;       // Few real bids
    unusualPattern: boolean;    // Anomaly detected
    priceAnomaly: boolean;      // Sold way under/over estimate
  };

  anomalyScore: number;         // Overall suspicion score 0-100
  anomalyReasons: string[];
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

const AUCTIONEER_PATTERNS = {
  // Real bid announcements
  bidPatterns: [
    /(?:i['\s]?(?:ve\s)?got|now|bid|at)\s*\$?(\d{1,3}(?:,?\d{3})*)/gi,
    /(\d{1,3}(?:,?\d{3})*)\s*(?:thousand|hundred|bid|now)/gi,
    /\$(\d{1,3}(?:,?\d{3})*)/g,
  ],

  // Filler phrases (not real bids)
  fillerPhrases: [
    'looking for', 'who wants', 'who\'s in', 'come on', 'don\'t miss',
    'last chance', 'fair warning', 'going once', 'going twice',
    'anybody else', 'any more', 'one more time', 'right here',
    'yep yep yep', 'hey hey hey', 'money money money',
  ],

  // Outcome indicators
  soldPhrases: ['sold', 'hammer', 'congratulations', 'you got it', 'yours'],
  noSalePhrases: ['no sale', 'pass', 'reserve not met', 'take it back'],

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

    // Check if it's filler
    const isFiller = AUCTIONEER_PATTERNS.fillerPhrases.some(f => text.includes(f));

    // Try to extract bid amount
    let bidAmount: number | undefined;
    for (const pattern of AUCTIONEER_PATTERNS.bidPatterns) {
      const match = text.match(pattern);
      if (match) {
        const numStr = match[1]?.replace(/,/g, '') || match[0].replace(/[^\d]/g, '');
        const num = parseInt(numStr);
        if (num > 0 && num < 100000000) {
          bidAmount = num;
          // Normalize: if small number, likely in thousands
          if (bidAmount < 1000 && text.includes('thousand')) {
            bidAmount *= 1000;
          }
          break;
        }
      }
    }

    // Generate translation
    let translated = seg.text;
    if (bidAmount && !isFiller) {
      translated = `BID: $${bidAmount.toLocaleString()}`;
    } else if (AUCTIONEER_PATTERNS.soldPhrases.some(p => text.includes(p))) {
      translated = `SOLD${bidAmount ? ` at $${bidAmount.toLocaleString()}` : ''}`;
    } else if (AUCTIONEER_PATTERNS.noSalePhrases.some(p => text.includes(p))) {
      translated = 'NO SALE';
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
    if (phrase.bidAmount && !phrase.isFiller && phrase.bidAmount > lastBidAmount) {
      // Determine bid source
      let source: BidEvent['source'] = 'unknown';
      const text = phrase.raw.toLowerCase();
      if (AUCTIONEER_PATTERNS.phoneBid.some(p => text.includes(p))) {
        source = 'phone';
      } else if (AUCTIONEER_PATTERNS.floorBid.some(p => text.includes(p))) {
        source = 'floor';
      }

      bids.push({
        timestamp: phrase.timestamp,
        amount: phrase.bidAmount,
        source,
        isReal: true,
        confidence: 0.8,
      });

      lastBidAmount = phrase.bidAmount;
    }
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

function detectAnomalies(
  lot: Partial<LotAnalysis>,
  thresholds = DEFAULT_THRESHOLDS
): { anomalyScore: number; reasons: string[] } {
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

  return { anomalyScore: Math.min(100, score), reasons };
}

// ═══════════════════════════════════════════════════════════════
// FULL LOT ANALYSIS
// ═══════════════════════════════════════════════════════════════

async function analyzeLot(
  segments: { start: number; end: number; text: string }[],
  lotInfo: { lotNumber: string; vehicle: string; estimate?: number }
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

  // Build partial analysis for anomaly detection
  const partial: Partial<LotAnalysis> = {
    totalDuration,
    realBidCount: bids.length,
    bidsPerSecond: velocity.bidsPerSecond,
    fillerRatio,
    finalRushIntensity: velocity.finalRushIntensity,
    outcome,
    priceVsEstimate: lotInfo.estimate && bids.length > 0
      ? bids[bids.length - 1].amount / lotInfo.estimate
      : undefined,
  };

  // Detect anomalies
  const { anomalyScore, reasons } = detectAnomalies(partial);

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

    outcome,
    estimatedValue: lotInfo.estimate,
    priceVsEstimate: partial.priceVsEstimate,

    flags: {
      tooFast: totalDuration < DEFAULT_THRESHOLDS.minLotDuration,
      lowActivity: bids.length < DEFAULT_THRESHOLDS.minBidCount,
      unusualPattern: velocity.bidAcceleration < 0.5 || velocity.bidAcceleration > 3,
      priceAnomaly: partial.priceVsEstimate !== undefined &&
        (partial.priceVsEstimate < 0.5 || partial.priceVsEstimate > 2),
    },

    anomalyScore,
    anomalyReasons: reasons,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN PROCESSING
// ═══════════════════════════════════════════════════════════════

async function processVideoForForensics(videoUrl: string) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  AUCTION FORENSICS ANALYZER');
  console.log('  Maximum data extraction + anomaly detection');
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
        const analysis = await analyzeLot(lotSegments, {
          lotNumber: lot.lotNumber,
          vehicle: lot.vehicle,
          estimate: lot.estimate,
        });

        allAnalyses.push(analysis);

        // Report
        const flag = analysis.anomalyScore > 30 ? '⚠️' : analysis.anomalyScore > 10 ? '⚡' : '✓';
        console.log(`  ${flag} ${analysis.lotNumber}: ${analysis.vehicleDescription}`);
        console.log(`     Duration: ${analysis.totalDuration}s | Bids: ${analysis.bidCount} | Final: $${analysis.finalPrice.toLocaleString()}`);
        if (analysis.anomalyReasons.length > 0) {
          console.log(`     ⚠️ ${analysis.anomalyReasons.join('; ')}`);
        }
      }
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  // Summary report
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  FORENSICS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const flagged = allAnalyses.filter(a => a.anomalyScore > 30);
  const suspicious = allAnalyses.filter(a => a.anomalyScore > 10 && a.anomalyScore <= 30);

  console.log(`Total lots analyzed: ${allAnalyses.length}`);
  console.log(`Flagged (score > 30): ${flagged.length}`);
  console.log(`Suspicious (score 10-30): ${suspicious.length}`);
  console.log(`Clean: ${allAnalyses.length - flagged.length - suspicious.length}`);

  if (flagged.length > 0) {
    console.log('\n🚨 FLAGGED LOTS:');
    for (const lot of flagged) {
      console.log(`  ${lot.lotNumber}: ${lot.vehicleDescription}`);
      console.log(`    Score: ${lot.anomalyScore} | ${lot.anomalyReasons.join('; ')}`);
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
): Promise<{ lotNumber: string; vehicle: string; estimate?: number; startTime: number; endTime: number }[]> {
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
          content: `Identify individual auction lots from this transcript. Each timestamp in brackets is seconds.
For each lot, extract:
- lot_number: The lot number mentioned (e.g., "S115.1", "Lot 47")
- vehicle: Year make model
- estimate: Estimated value if mentioned
- start_time: Timestamp when lot starts (first mention)
- end_time: Timestamp when sold/no-sale

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
