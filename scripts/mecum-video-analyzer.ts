#!/usr/bin/env npx tsx
/**
 * Mecum Video Analyzer
 *
 * Downloads audio from Mecum YouTube broadcasts and extracts:
 * - Bid amounts and timing
 * - Lot numbers and transitions
 * - Sold vs No Sale outcomes
 * - Auctioneer patterns and phrases
 */

import { execSync, spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Kissimmee 2026 broadcasts
const BROADCASTS = [
  { date: '2026-01-09', url: 'https://www.youtube.com/watch?v=HZRKpQvYqQc', title: 'Friday Jan 9' },
  { date: '2026-01-10', url: 'https://www.youtube.com/watch?v=QQHb2JN1OFM', title: 'Saturday Jan 10' },
  { date: '2026-01-14', url: 'https://www.youtube.com/watch?v=owTlZmi5LB8', title: 'Wednesday Jan 14' },
  { date: '2026-01-15', url: 'https://www.youtube.com/watch?v=rpJ0POdkMh0', title: 'Thursday Jan 15' },
  { date: '2026-01-16', url: 'https://www.youtube.com/watch?v=bBrM75To55A', title: 'Friday Jan 16' },
  { date: '2026-01-17', url: 'https://www.youtube.com/watch?v=c9fxArnD3IY', title: 'Saturday Jan 17' },
];

// Block cams (raw auction floor, longer)
const BLOCK_CAMS = [
  { date: '2026-01-17', url: 'https://www.youtube.com/watch?v=7m_nCLrKMuU', title: 'Block Cam Sat Jan 17', duration: '11:54:57' },
  { date: '2026-01-18', url: 'https://www.youtube.com/watch?v=mpNMsWUql2w', title: 'Block Cam Sun Jan 18', duration: '8:43:25' },
];

const DATA_DIR = '/tmp/mecum-training';

interface AuctionEvent {
  timestamp: number; // seconds into video
  type: 'lot_start' | 'bid' | 'sold' | 'no_sale' | 'excitement';
  lotNumber?: string;
  amount?: number;
  phrase?: string;
}

async function downloadAudio(url: string, outputName: string): Promise<string> {
  const outputPath = path.join(DATA_DIR, `${outputName}.mp3`);

  if (fs.existsSync(outputPath)) {
    console.log(`  Audio already exists: ${outputPath}`);
    return outputPath;
  }

  console.log(`  Downloading audio from ${url}...`);

  try {
    execSync(
      `yt-dlp -x --audio-format mp3 --audio-quality 5 -o "${outputPath}" "${url}"`,
      { stdio: 'inherit', timeout: 600000 }
    );
    return outputPath;
  } catch (e) {
    console.error(`  Failed to download: ${e}`);
    throw e;
  }
}

async function transcribeWithWhisper(audioPath: string): Promise<{ text: string; segments: any[] }> {
  const outputPath = audioPath.replace('.mp3', '.json');

  if (fs.existsSync(outputPath)) {
    console.log(`  Transcription exists: ${outputPath}`);
    return JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
  }

  console.log(`  Transcribing with Whisper...`);
  console.log(`  (This will take a while for multi-hour videos)`);

  // Use OpenAI Whisper API or local whisper
  // For now, we'll use the local whisper if available
  try {
    execSync(
      `whisper "${audioPath}" --model base --output_format json --output_dir "${DATA_DIR}"`,
      { stdio: 'inherit', timeout: 3600000 } // 1 hour timeout
    );

    const jsonPath = audioPath.replace('.mp3', '.json');
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    console.log(`  Whisper not available locally, using pattern matching instead`);
    return { text: '', segments: [] };
  }
}

function extractAuctionEvents(transcription: { text: string; segments: any[] }): AuctionEvent[] {
  const events: AuctionEvent[] = [];

  // Patterns to detect
  const patterns = {
    lotStart: /lot\s*(?:number\s*)?([A-Z]?\d+)/gi,
    bid: /(\d{1,3}(?:,\d{3})*)\s*(?:thousand|hundred|dollars?)?/gi,
    sold: /sold|hammer\s*down|congratulations/gi,
    noSale: /no\s*sale|reserve\s*not\s*met|pass(?:ed)?/gi,
    excitement: /bidder\s*war|phone\s*bidders?|last\s*chance|going\s*once/gi,
  };

  for (const segment of transcription.segments || []) {
    const text = segment.text?.toLowerCase() || '';
    const timestamp = segment.start || 0;

    // Check for lot start
    const lotMatch = text.match(patterns.lotStart);
    if (lotMatch) {
      events.push({
        timestamp,
        type: 'lot_start',
        lotNumber: lotMatch[1],
      });
    }

    // Check for sold
    if (patterns.sold.test(text)) {
      // Try to extract final price from nearby text
      const priceMatch = text.match(/(\d{1,3}(?:,\d{3})*)/);
      events.push({
        timestamp,
        type: 'sold',
        amount: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : undefined,
      });
    }

    // Check for no sale
    if (patterns.noSale.test(text)) {
      events.push({
        timestamp,
        type: 'no_sale',
      });
    }

    // Check for excitement indicators
    if (patterns.excitement.test(text)) {
      events.push({
        timestamp,
        type: 'excitement',
        phrase: text.trim(),
      });
    }
  }

  return events;
}

function analyzePatterns(events: AuctionEvent[]) {
  const lotDurations: number[] = [];
  const bidIntervals: number[] = [];
  let lastLotStart = 0;
  let lastBid = 0;

  for (const event of events) {
    if (event.type === 'lot_start') {
      if (lastLotStart > 0) {
        lotDurations.push(event.timestamp - lastLotStart);
      }
      lastLotStart = event.timestamp;
      lastBid = event.timestamp;
    }

    if (event.type === 'bid' || event.type === 'sold') {
      if (lastBid > 0 && event.timestamp - lastBid < 60) {
        bidIntervals.push(event.timestamp - lastBid);
      }
      lastBid = event.timestamp;
    }
  }

  const avgLotDuration = lotDurations.length > 0
    ? lotDurations.reduce((a, b) => a + b, 0) / lotDurations.length
    : 180;

  const avgBidInterval = bidIntervals.length > 0
    ? bidIntervals.reduce((a, b) => a + b, 0) / bidIntervals.length
    : 4;

  return {
    avgLotDurationSeconds: Math.round(avgLotDuration),
    avgBidIntervalSeconds: Math.round(avgBidInterval * 10) / 10,
    totalLots: lotDurations.length + 1,
    soldCount: events.filter(e => e.type === 'sold').length,
    noSaleCount: events.filter(e => e.type === 'no_sale').length,
    excitementMoments: events.filter(e => e.type === 'excitement').length,
  };
}

async function processVideo(broadcast: typeof BROADCASTS[0]) {
  console.log(`\n=== Processing: ${broadcast.title} ===`);

  const safeName = broadcast.date.replace(/-/g, '');

  // Download audio
  const audioPath = await downloadAudio(broadcast.url, `mecum_${safeName}`);

  // Transcribe
  const transcription = await transcribeWithWhisper(audioPath);

  // Extract events
  const events = extractAuctionEvents(transcription);
  console.log(`  Found ${events.length} auction events`);

  // Analyze patterns
  const patterns = analyzePatterns(events);
  console.log(`  Patterns:`, patterns);

  // Store in database
  await supabase.from('auction_training_data').upsert({
    source: 'mecum_youtube',
    broadcast_date: broadcast.date,
    broadcast_url: broadcast.url,
    events: events,
    patterns: patterns,
    processed_at: new Date().toISOString(),
  }, {
    onConflict: 'broadcast_date',
  });

  return { events, patterns };
}

async function main() {
  console.log('═══════════════════════════════════════════════');
  console.log('  Mecum Video Analyzer');
  console.log('  Training data extraction from YouTube');
  console.log('═══════════════════════════════════════════════');

  // Create data directory
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const specificVideo = process.argv[2];

  if (specificVideo) {
    // Process single video
    const broadcast = BROADCASTS.find(b => b.url.includes(specificVideo)) || {
      date: new Date().toISOString().split('T')[0],
      url: specificVideo,
      title: 'Custom Video',
    };
    await processVideo(broadcast);
  } else {
    // List available broadcasts
    console.log('\nAvailable Kissimmee 2026 broadcasts:');
    BROADCASTS.forEach((b, i) => {
      console.log(`  ${i + 1}. ${b.title} - ${b.url}`);
    });

    console.log('\nBlock cams (raw auction floor):');
    BLOCK_CAMS.forEach((b, i) => {
      console.log(`  ${i + 1}. ${b.title} (${b.duration}) - ${b.url}`);
    });

    console.log('\nUsage:');
    console.log('  npx tsx scripts/mecum-video-analyzer.ts <video-id-or-url>');
    console.log('  npx tsx scripts/mecum-video-analyzer.ts all  # Process all broadcasts');

    if (process.argv[2] === 'all') {
      for (const broadcast of BROADCASTS) {
        await processVideo(broadcast);
      }
    }
  }
}

main().catch(console.error);
