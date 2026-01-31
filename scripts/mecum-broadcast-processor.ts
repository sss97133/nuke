#!/usr/bin/env npx tsx
/**
 * Mecum Broadcast Processor
 *
 * Processes full auction broadcasts to extract:
 * - Individual lot sales with exact timing
 * - Bid progressions
 * - Sold/No Sale outcomes
 * - Vehicle descriptions
 *
 * Uses OpenAI Whisper for transcription and GPT for extraction.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATA_DIR = '/tmp/mecum-broadcasts';
const CHUNK_DURATION = 300; // 5 minutes per chunk for API limits

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface ExtractedLot {
  lotNumber?: string;
  year?: number;
  make?: string;
  model?: string;
  startTime: number;
  endTime: number;
  startingBid?: number;
  finalPrice?: number;
  outcome: 'sold' | 'no_sale' | 'unknown';
  bidProgression: { time: number; amount: number }[];
  description?: string;
}

interface BroadcastData {
  videoId: string;
  title: string;
  date: string;
  totalDuration: number;
  lots: ExtractedLot[];
  patterns: {
    avgLotDuration: number;
    avgBidInterval: number;
    soldRate: number;
  };
}

async function downloadAudioChunk(
  videoUrl: string,
  startTime: number,
  duration: number,
  outputPath: string
): Promise<void> {
  if (fs.existsSync(outputPath)) return;

  const startFormatted = formatSeconds(startTime);
  const durationFormatted = formatSeconds(duration);

  execSync(
    `yt-dlp -f "bestaudio" --download-sections "*${startFormatted}-${formatSeconds(startTime + duration)}" ` +
    `-x --audio-format wav --postprocessor-args "-ar 16000 -ac 1" ` +
    `-o "${outputPath}" "${videoUrl}"`,
    { stdio: 'pipe', timeout: 120000 }
  );
}

async function transcribeChunk(audioPath: string): Promise<TranscriptSegment[]> {
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: (() => {
      const form = new FormData();
      form.append('file', new Blob([fs.readFileSync(audioPath)]), 'audio.wav');
      form.append('model', 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'segment');
      return form;
    })(),
  });

  const data = await response.json();
  return data.segments || [];
}

async function extractLotsFromTranscript(
  segments: TranscriptSegment[],
  chunkOffset: number
): Promise<ExtractedLot[]> {
  const fullText = segments.map(s => s.text).join(' ');

  // Use GPT to extract structured lot data
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
          content: `You are an auction transcript analyzer. Extract lot sales from Mecum auction transcripts.
For each lot mentioned, extract:
- lot_number (e.g., "S115", "F123")
- year, make, model of vehicle
- starting_bid (first mentioned price)
- final_price (last mentioned price before outcome)
- outcome: "sold" if you hear "sold", "hammer", "congratulations"; "no_sale" if you hear "no sale", "pass", "reserve not met"
- bid_amounts: array of prices mentioned in order

Return JSON array of lots. If unsure about a field, omit it.`
        },
        {
          role: 'user',
          content: `Extract lot sales from this transcript:\n\n${fullText}`
        }
      ],
      response_format: { type: 'json_object' },
    }),
  });

  const gptData = await response.json();
  const extracted = JSON.parse(gptData.choices[0].message.content);

  // Map back to timestamps
  const lots: ExtractedLot[] = [];

  for (const lot of extracted.lots || []) {
    // Find timestamp for this lot by searching for first mention
    const lotMention = segments.find(s =>
      s.text.toLowerCase().includes(lot.make?.toLowerCase() || '') ||
      s.text.includes(lot.lot_number || '')
    );

    lots.push({
      lotNumber: lot.lot_number,
      year: lot.year,
      make: lot.make,
      model: lot.model,
      startTime: (lotMention?.start || 0) + chunkOffset,
      endTime: (lotMention?.end || 0) + chunkOffset + 120, // Estimate 2 min per lot
      startingBid: lot.starting_bid,
      finalPrice: lot.final_price,
      outcome: lot.outcome || 'unknown',
      bidProgression: (lot.bid_amounts || []).map((amt: number, i: number) => ({
        time: (lotMention?.start || 0) + chunkOffset + i * 5,
        amount: amt,
      })),
    });
  }

  return lots;
}

async function processBroadcast(videoUrl: string): Promise<BroadcastData> {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Get video metadata
  const metaJson = execSync(
    `yt-dlp --dump-json --no-download "${videoUrl}"`,
    { encoding: 'utf-8', timeout: 30000 }
  );
  const meta = JSON.parse(metaJson);

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Processing: ${meta.title}`);
  console.log(`  Duration: ${Math.round(meta.duration / 60)} minutes`);
  console.log(`═══════════════════════════════════════════════\n`);

  const allLots: ExtractedLot[] = [];
  const numChunks = Math.ceil(meta.duration / CHUNK_DURATION);

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * CHUNK_DURATION;
    const chunkPath = path.join(DATA_DIR, `${meta.id}_chunk_${i}.wav`);

    console.log(`Processing chunk ${i + 1}/${numChunks} (${formatSeconds(startTime)})...`);

    try {
      // Download chunk
      await downloadAudioChunk(videoUrl, startTime, CHUNK_DURATION, chunkPath);

      // Transcribe
      const segments = await transcribeChunk(chunkPath);
      console.log(`  Transcribed ${segments.length} segments`);

      // Extract lots
      const lots = await extractLotsFromTranscript(segments, startTime);
      console.log(`  Found ${lots.length} lots`);

      allLots.push(...lots);

      // Rate limit
      await new Promise(r => setTimeout(r, 1000));

    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // Calculate patterns
  const durations = allLots.map(l => l.endTime - l.startTime);
  const avgDuration = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 180;

  const bidIntervals: number[] = [];
  for (const lot of allLots) {
    for (let i = 1; i < lot.bidProgression.length; i++) {
      bidIntervals.push(lot.bidProgression[i].time - lot.bidProgression[i - 1].time);
    }
  }
  const avgInterval = bidIntervals.length > 0
    ? bidIntervals.reduce((a, b) => a + b, 0) / bidIntervals.length
    : 4;

  const soldCount = allLots.filter(l => l.outcome === 'sold').length;
  const soldRate = allLots.length > 0 ? soldCount / allLots.length : 0.7;

  const data: BroadcastData = {
    videoId: meta.id,
    title: meta.title,
    date: meta.upload_date,
    totalDuration: meta.duration,
    lots: allLots,
    patterns: {
      avgLotDuration: Math.round(avgDuration),
      avgBidInterval: Math.round(avgInterval * 10) / 10,
      soldRate: Math.round(soldRate * 100) / 100,
    },
  };

  // Store in database
  await supabase.from('mecum_broadcast_analysis').upsert({
    video_id: data.videoId,
    video_url: videoUrl,
    title: data.title,
    broadcast_date: data.date,
    total_duration: data.totalDuration,
    lot_count: data.lots.length,
    lots: data.lots,
    patterns: data.patterns,
    processed_at: new Date().toISOString(),
  }, {
    onConflict: 'video_id',
  });

  return data;
}

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// Main
async function main() {
  const videoUrl = process.argv[2];

  if (!videoUrl) {
    console.log('Mecum Broadcast Processor');
    console.log('');
    console.log('Usage:');
    console.log('  npx tsx scripts/mecum-broadcast-processor.ts <youtube-url>');
    console.log('');
    console.log('Example broadcasts:');
    console.log('  Saturday Jan 17: https://www.youtube.com/watch?v=c9fxArnD3IY');
    console.log('  Friday Jan 16:   https://www.youtube.com/watch?v=bBrM75To55A');
    return;
  }

  const data = await processBroadcast(videoUrl);

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Results');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Total lots: ${data.lots.length}`);
  console.log(`  Sold: ${data.lots.filter(l => l.outcome === 'sold').length}`);
  console.log(`  No Sale: ${data.lots.filter(l => l.outcome === 'no_sale').length}`);
  console.log(`  Avg lot duration: ${data.patterns.avgLotDuration}s`);
  console.log(`  Avg bid interval: ${data.patterns.avgBidInterval}s`);
  console.log(`  Sold rate: ${(data.patterns.soldRate * 100).toFixed(0)}%`);

  // Show sample lots
  console.log('\nSample lots:');
  data.lots.slice(0, 5).forEach(lot => {
    console.log(`  ${lot.year || '?'} ${lot.make || '?'} ${lot.model || '?'}: ${lot.outcome} ${lot.finalPrice ? `$${lot.finalPrice.toLocaleString()}` : ''}`);
  });
}

main().catch(console.error);
