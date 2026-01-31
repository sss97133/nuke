#!/usr/bin/env npx tsx
/**
 * Mecum Moment Extractor
 *
 * Processes YouTube broadcasts and links each lot to its vehicle record,
 * storing exact timestamps so users can "Watch the Moment" for any vehicle.
 *
 * Flow:
 * 1. Download broadcast audio in chunks
 * 2. Transcribe with Whisper
 * 3. Extract lot numbers, vehicle info, prices, timestamps
 * 4. Match to existing vehicles in DB
 * 5. Store broadcast timestamps on auction_events
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATA_DIR = '/tmp/mecum-moments';
const CHUNK_SECONDS = 300; // 5 min chunks

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface ExtractedMoment {
  lotNumber: string;
  timestampStart: number;
  timestampEnd: number;
  year?: number;
  make?: string;
  model?: string;
  finalPrice?: number;
  outcome: 'sold' | 'no_sale' | 'unknown';
  transcript: string;
}

// Kissimmee 2026 broadcast schedule
const BROADCASTS: Record<string, { url: string; date: string }> = {
  'c9fxArnD3IY': { url: 'https://www.youtube.com/watch?v=c9fxArnD3IY', date: '2026-01-17' },
  'bBrM75To55A': { url: 'https://www.youtube.com/watch?v=bBrM75To55A', date: '2026-01-16' },
  'rpJ0POdkMh0': { url: 'https://www.youtube.com/watch?v=rpJ0POdkMh0', date: '2026-01-15' },
  'owTlZmi5LB8': { url: 'https://www.youtube.com/watch?v=owTlZmi5LB8', date: '2026-01-14' },
  'QQHb2JN1OFM': { url: 'https://www.youtube.com/watch?v=QQHb2JN1OFM', date: '2026-01-10' },
  'HZRKpQvYqQc': { url: 'https://www.youtube.com/watch?v=HZRKpQvYqQc', date: '2026-01-09' },
};

async function getVideoMeta(url: string) {
  const result = spawnSync('yt-dlp', ['--dump-json', '--no-download', url], {
    encoding: 'utf-8',
    timeout: 30000,
  });
  return JSON.parse(result.stdout);
}

async function downloadChunk(url: string, start: number, duration: number, outPath: string) {
  if (fs.existsSync(outPath)) return;

  const startStr = formatTime(start);
  const endStr = formatTime(start + duration);

  execSync(
    `yt-dlp -f "bestaudio" --download-sections "*${startStr}-${endStr}" ` +
    `-x --audio-format wav --postprocessor-args "-ar 16000 -ac 1" ` +
    `-o "${outPath}" "${url}" 2>/dev/null`,
    { timeout: 180000 }
  );
}

async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  const audioData = fs.readFileSync(audioPath);

  const form = new FormData();
  form.append('file', new Blob([audioData]), 'audio.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  const data = await resp.json();
  return data.segments || [];
}

async function extractMoments(
  segments: TranscriptSegment[],
  chunkOffset: number
): Promise<ExtractedMoment[]> {
  const fullText = segments.map(s => `[${formatTime(s.start + chunkOffset)}] ${s.text}`).join('\n');

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
          content: `Extract auction lot sales from this Mecum transcript. Each line has a timestamp.

For each lot that crosses the block, extract:
- lot_number: The lot number (e.g., "S115.1", "F123")
- timestamp_start: When the lot is first announced (format: "H:MM:SS")
- timestamp_end: When sold/no-sale is called (format: "H:MM:SS")
- year: Vehicle year
- make: Vehicle make (Chevrolet, Ford, etc.)
- model: Vehicle model (Camaro, Mustang, etc.)
- final_price: The hammer price in dollars (no commas)
- outcome: "sold" or "no_sale"
- key_quote: A notable quote from the auctioneer

Return as JSON: { "lots": [...] }
If a lot spans multiple timestamps, use the earliest for start and latest for end.`
        },
        { role: 'user', content: fullText }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  const gptData = await resp.json();
  const content = gptData.choices?.[0]?.message?.content || '{"lots":[]}';
  const extracted = JSON.parse(content);

  return (extracted.lots || []).map((lot: any) => ({
    lotNumber: lot.lot_number,
    timestampStart: parseTime(lot.timestamp_start) || chunkOffset,
    timestampEnd: parseTime(lot.timestamp_end) || chunkOffset + 180,
    year: lot.year,
    make: lot.make,
    model: lot.model,
    finalPrice: lot.final_price,
    outcome: lot.outcome === 'sold' ? 'sold' : lot.outcome === 'no_sale' ? 'no_sale' : 'unknown',
    transcript: lot.key_quote || '',
  }));
}

async function matchVehicle(moment: ExtractedMoment, auctionDate: string): Promise<string | null> {
  // Try to find matching vehicle by lot number first
  if (moment.lotNumber) {
    const { data: byLot } = await supabase
      .from('auction_events')
      .select('vehicle_id')
      .eq('source', 'mecum')
      .ilike('lot_number', `%${moment.lotNumber}%`)
      .limit(1)
      .single();

    if (byLot?.vehicle_id) return byLot.vehicle_id;
  }

  // Try by year/make/model
  if (moment.year && moment.make) {
    const { data: byVehicle } = await supabase
      .from('vehicles')
      .select('id')
      .eq('year', moment.year)
      .ilike('make', `%${moment.make}%`)
      .ilike('model', `%${moment.model || ''}%`)
      .limit(1)
      .single();

    if (byVehicle?.id) return byVehicle.id;
  }

  return null;
}

async function updateAuctionEvent(
  vehicleId: string,
  videoId: string,
  videoUrl: string,
  moment: ExtractedMoment
) {
  const { error } = await supabase
    .from('auction_events')
    .update({
      broadcast_video_id: videoId,
      broadcast_video_url: videoUrl,
      broadcast_timestamp_start: moment.timestampStart,
      broadcast_timestamp_end: moment.timestampEnd,
      outcome: moment.outcome === 'sold' ? 'sold' : moment.outcome === 'no_sale' ? 'no_sale' : undefined,
      winning_bid: moment.finalPrice,
    })
    .eq('vehicle_id', vehicleId)
    .eq('source', 'mecum');

  return !error;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseTime(timeStr: string): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

async function processBroadcast(videoUrl: string) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Mecum Moment Extractor');
  console.log('═══════════════════════════════════════════════\n');

  const meta = await getVideoMeta(videoUrl);
  const videoId = meta.id;
  const broadcast = BROADCASTS[videoId];

  console.log(`Video: ${meta.title}`);
  console.log(`Duration: ${formatTime(meta.duration)}`);
  console.log(`Date: ${broadcast?.date || 'unknown'}\n`);

  const numChunks = Math.ceil(meta.duration / CHUNK_SECONDS);
  let totalMoments = 0;
  let linkedVehicles = 0;

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = i * CHUNK_SECONDS;
    const chunkPath = path.join(DATA_DIR, `${videoId}_chunk_${i}.wav`);

    console.log(`\nChunk ${i + 1}/${numChunks} [${formatTime(chunkStart)}]`);

    try {
      // Download
      process.stdout.write('  Downloading... ');
      await downloadChunk(videoUrl, chunkStart, CHUNK_SECONDS, chunkPath);
      console.log('✓');

      // Transcribe
      process.stdout.write('  Transcribing... ');
      const segments = await transcribeAudio(chunkPath);
      console.log(`✓ (${segments.length} segments)`);

      // Extract moments
      process.stdout.write('  Extracting lots... ');
      const moments = await extractMoments(segments, chunkStart);
      console.log(`✓ (${moments.length} lots)`);

      // Match and update
      for (const moment of moments) {
        const vehicleId = await matchVehicle(moment, broadcast?.date || '');

        if (vehicleId) {
          const updated = await updateAuctionEvent(vehicleId, videoId, videoUrl, moment);
          if (updated) {
            linkedVehicles++;
            console.log(`    ✓ ${moment.year} ${moment.make} ${moment.model} @ ${formatTime(moment.timestampStart)}`);
          }
        } else {
          console.log(`    ? ${moment.lotNumber || ''} ${moment.year || ''} ${moment.make || ''} - no match`);
        }

        totalMoments++;
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 2000));

    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Total moments extracted: ${totalMoments}`);
  console.log(`  Vehicles linked: ${linkedVehicles}`);
  console.log(`  YouTube URL format: ${videoUrl}?t=SECONDS`);
}

// Quick test mode - process just first 10 minutes
async function testMode(videoUrl: string) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log('TEST MODE - Processing first 10 minutes only\n');

  const meta = await getVideoMeta(videoUrl);
  const videoId = meta.id;

  for (let i = 0; i < 2; i++) {
    const chunkStart = i * CHUNK_SECONDS;
    const chunkPath = path.join(DATA_DIR, `${videoId}_test_${i}.wav`);

    console.log(`Chunk ${i + 1}/2 [${formatTime(chunkStart)}]`);

    await downloadChunk(videoUrl, chunkStart, CHUNK_SECONDS, chunkPath);
    console.log('  Downloaded');

    const segments = await transcribeAudio(chunkPath);
    console.log(`  Transcribed ${segments.length} segments`);

    const moments = await extractMoments(segments, chunkStart);
    console.log(`  Found ${moments.length} lots:`);

    for (const m of moments) {
      const timeUrl = `${videoUrl}&t=${m.timestampStart}`;
      console.log(`    ${m.lotNumber || '?'} ${m.year || ''} ${m.make || ''} ${m.model || ''}`);
      console.log(`      ${m.outcome} ${m.finalPrice ? `$${m.finalPrice.toLocaleString()}` : ''}`);
      console.log(`      ${timeUrl}`);
    }

    await new Promise(r => setTimeout(r, 1000));
  }
}

// Main
const videoUrl = process.argv[2];
const isTest = process.argv.includes('--test');

if (!videoUrl) {
  console.log('Mecum Moment Extractor');
  console.log('');
  console.log('Links YouTube broadcast timestamps to vehicle records.');
  console.log('');
  console.log('Usage:');
  console.log('  npx tsx scripts/mecum-moment-extractor.ts <youtube-url>');
  console.log('  npx tsx scripts/mecum-moment-extractor.ts <youtube-url> --test');
  console.log('');
  console.log('Available Kissimmee 2026 broadcasts:');
  Object.entries(BROADCASTS).forEach(([id, b]) => {
    console.log(`  ${b.date}: ${b.url}`);
  });
  process.exit(0);
}

if (isTest) {
  testMode(videoUrl).catch(console.error);
} else {
  processBroadcast(videoUrl).catch(console.error);
}
