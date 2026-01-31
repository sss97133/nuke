#!/usr/bin/env npx tsx
/**
 * Broadcast Backfill Worker
 *
 * Agent-friendly worker that:
 * 1. Claims pending broadcasts from queue
 * 2. Processes them (extract timestamps, link to vehicles)
 * 3. Updates queue status
 *
 * Run this when agents are free to contribute to backfill.
 *
 * Usage:
 *   npx tsx scripts/broadcast-backfill-worker.ts           # Process one broadcast
 *   npx tsx scripts/broadcast-backfill-worker.ts --all     # Process all pending
 *   npx tsx scripts/broadcast-backfill-worker.ts --status  # Show queue status
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATA_DIR = '/tmp/broadcast-backfill';
const CHUNK_SECONDS = 300;
const AGENT_ID = `worker-${process.pid}-${Date.now()}`;

interface QueueItem {
  id: string;
  video_id: string;
  video_url: string;
  auction_house: string;
  auction_name: string;
  broadcast_date: string;
  duration_seconds: number;
  priority: number;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

async function showStatus() {
  const { data: queue } = await supabase
    .from('broadcast_backfill_queue')
    .select('*')
    .order('priority', { ascending: false });

  console.log('\n═══════════════════════════════════════════════');
  console.log('  Broadcast Backfill Queue');
  console.log('═══════════════════════════════════════════════\n');

  const byStatus: Record<string, typeof queue> = {};
  for (const item of queue || []) {
    const status = item.status;
    if (!byStatus[status]) byStatus[status] = [];
    byStatus[status].push(item);
  }

  for (const [status, items] of Object.entries(byStatus)) {
    console.log(`${status.toUpperCase()} (${items.length}):`);
    for (const item of items) {
      const duration = Math.round((item.duration_seconds || 0) / 60);
      const linked = item.lots_linked ? ` → ${item.lots_linked} linked` : '';
      console.log(`  [${item.auction_house}] ${item.auction_name} ${item.broadcast_date} (${duration}m)${linked}`);
    }
    console.log('');
  }

  const pending = byStatus['pending']?.length || 0;
  const processing = byStatus['processing']?.length || 0;
  const completed = byStatus['completed']?.length || 0;
  const totalHours = Math.round((queue || []).reduce((s, i) => s + (i.duration_seconds || 0), 0) / 3600);

  console.log('───────────────────────────────────────────────');
  console.log(`Total: ${queue?.length || 0} broadcasts (${totalHours} hours)`);
  console.log(`Pending: ${pending} | Processing: ${processing} | Completed: ${completed}`);
}

async function claimNext(): Promise<QueueItem | null> {
  // Atomic claim: find pending, update to processing
  const { data, error } = await supabase.rpc('claim_broadcast_backfill', {
    p_agent_id: AGENT_ID,
  });

  if (error) {
    // Fallback if RPC doesn't exist
    const { data: pending } = await supabase
      .from('broadcast_backfill_queue')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .limit(1)
      .single();

    if (pending) {
      await supabase
        .from('broadcast_backfill_queue')
        .update({
          status: 'processing',
          claimed_by: AGENT_ID,
          claimed_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
        })
        .eq('id', pending.id)
        .eq('status', 'pending');

      return pending;
    }
    return null;
  }

  return data;
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

async function extractLots(segments: TranscriptSegment[], chunkOffset: number, auctionHouse: string) {
  const fullText = segments.map(s => `[${formatTime(s.start + chunkOffset)}] ${s.text}`).join('\n');

  const systemPrompt = auctionHouse === 'barrett_jackson'
    ? `Extract auction lot sales from this Barrett-Jackson transcript. Each line has a timestamp.
For each lot, extract: lot_number, timestamp_start (H:MM:SS), timestamp_end, year, make, model, final_price, outcome (sold/no_sale).
Return as JSON: { "lots": [...] }`
    : `Extract auction lot sales from this Mecum transcript. Each line has a timestamp.
For each lot, extract: lot_number (e.g., S115.1), timestamp_start (H:MM:SS), timestamp_end, year, make, model, final_price, outcome (sold/no_sale).
Return as JSON: { "lots": [...] }`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: fullText }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  const gptData = await resp.json();
  const content = gptData.choices?.[0]?.message?.content || '{"lots":[]}';
  return JSON.parse(content).lots || [];
}

async function linkToVehicle(lot: any, auctionHouse: string): Promise<string | null> {
  // Try lot number first
  if (lot.lot_number) {
    const { data } = await supabase
      .from('auction_events')
      .select('vehicle_id')
      .eq('source', auctionHouse)
      .ilike('lot_number', `%${lot.lot_number}%`)
      .limit(1)
      .single();

    if (data?.vehicle_id) return data.vehicle_id;
  }

  // Try year/make/model
  if (lot.year && lot.make) {
    const { data } = await supabase
      .from('vehicles')
      .select('id')
      .eq('year', lot.year)
      .ilike('make', `%${lot.make}%`)
      .limit(1)
      .single();

    if (data?.id) return data.id;
  }

  return null;
}

async function processBroadcast(item: QueueItem) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`  Processing: ${item.auction_name} (${item.broadcast_date})`);
  console.log(`  ${item.auction_house} | ${Math.round(item.duration_seconds / 60)} minutes`);
  console.log(`═══════════════════════════════════════════════\n`);

  const numChunks = Math.ceil(item.duration_seconds / CHUNK_SECONDS);
  let totalLots = 0;
  let linkedLots = 0;

  for (let i = 0; i < numChunks; i++) {
    const chunkStart = i * CHUNK_SECONDS;
    const chunkPath = path.join(DATA_DIR, `${item.video_id}_chunk_${i}.wav`);

    console.log(`Chunk ${i + 1}/${numChunks} [${formatTime(chunkStart)}]`);

    try {
      // Download
      await downloadChunk(item.video_url, chunkStart, CHUNK_SECONDS, chunkPath);

      // Transcribe
      const segments = await transcribeAudio(chunkPath);

      // Extract lots
      const lots = await extractLots(segments, chunkStart, item.auction_house);
      console.log(`  Found ${lots.length} lots`);

      // Link to vehicles
      for (const lot of lots) {
        totalLots++;
        const vehicleId = await linkToVehicle(lot, item.auction_house);

        if (vehicleId) {
          const timestampStart = parseTime(lot.timestamp_start) || chunkStart;
          const timestampEnd = parseTime(lot.timestamp_end) || timestampStart + 180;

          await supabase
            .from('auction_events')
            .update({
              broadcast_video_id: item.video_id,
              broadcast_video_url: item.video_url,
              broadcast_timestamp_start: timestampStart,
              broadcast_timestamp_end: timestampEnd,
              outcome: lot.outcome === 'sold' ? 'sold' : lot.outcome === 'no_sale' ? 'no_sale' : undefined,
              winning_bid: lot.final_price,
            })
            .eq('vehicle_id', vehicleId)
            .eq('source', item.auction_house);

          linkedLots++;
          console.log(`    ✓ ${lot.year} ${lot.make} ${lot.model}`);
        }
      }

      // Cleanup chunk file
      fs.unlinkSync(chunkPath);

      // Rate limit
      await new Promise(r => setTimeout(r, 2000));

    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }

    // Update progress
    await supabase
      .from('broadcast_backfill_queue')
      .update({
        lots_extracted: totalLots,
        lots_linked: linkedLots,
      })
      .eq('id', item.id);
  }

  // Mark complete
  await supabase
    .from('broadcast_backfill_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      lots_extracted: totalLots,
      lots_linked: linkedLots,
    })
    .eq('id', item.id);

  console.log(`\n✅ Complete: ${totalLots} lots extracted, ${linkedLots} linked to vehicles`);
  return { totalLots, linkedLots };
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

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--status')) {
    await showStatus();
    return;
  }

  if (args.includes('--all')) {
    console.log('Processing all pending broadcasts...\n');
    while (true) {
      const item = await claimNext();
      if (!item) {
        console.log('\nNo more pending broadcasts.');
        break;
      }
      await processBroadcast(item);
    }
    return;
  }

  // Process single broadcast
  const item = await claimNext();
  if (!item) {
    console.log('No pending broadcasts in queue.');
    await showStatus();
    return;
  }

  await processBroadcast(item);
}

main().catch(async (e) => {
  console.error('Worker error:', e);

  // Mark current job as failed if we were processing
  await supabase
    .from('broadcast_backfill_queue')
    .update({
      status: 'failed',
      error_message: e.message,
    })
    .eq('claimed_by', AGENT_ID)
    .eq('status', 'processing');
});
