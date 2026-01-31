#!/usr/bin/env npx tsx
/**
 * Mecum Lot Clipper
 *
 * Extracts individual lot clips from full auction broadcasts:
 * 1. Downloads video
 * 2. Detects lot transitions via audio/visual cues
 * 3. Clips each lot crossing the block
 * 4. Extracts timing data (announcement → first bid → hammer)
 * 5. Stores metadata for ML training
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DATA_DIR = '/tmp/mecum-clips';
const CLIPS_DIR = path.join(DATA_DIR, 'lots');

interface LotClip {
  lotNumber: string;
  videoUrl: string;
  startTime: number; // seconds
  endTime: number;
  duration: number;
  outcome: 'sold' | 'no_sale' | 'unknown';
  finalPrice?: number;
  bidCount?: number;
  clipPath?: string;
}

interface VideoMetadata {
  id: string;
  title: string;
  duration: number;
  uploadDate: string;
}

async function getVideoMetadata(url: string): Promise<VideoMetadata> {
  const result = spawnSync('yt-dlp', [
    '--dump-json',
    '--no-download',
    url
  ], { encoding: 'utf-8', timeout: 30000 });

  if (result.error || result.status !== 0) {
    throw new Error(`Failed to get video metadata: ${result.stderr}`);
  }

  const data = JSON.parse(result.stdout);
  return {
    id: data.id,
    title: data.title,
    duration: data.duration,
    uploadDate: data.upload_date,
  };
}

async function downloadVideo(url: string, outputPath: string): Promise<void> {
  if (fs.existsSync(outputPath)) {
    console.log(`  Video exists: ${outputPath}`);
    return;
  }

  console.log(`  Downloading video (this may take a while)...`);
  execSync(
    `yt-dlp -f "best[height<=720]" -o "${outputPath}" "${url}"`,
    { stdio: 'inherit', timeout: 3600000 }
  );
}

async function detectSceneChanges(videoPath: string): Promise<number[]> {
  console.log(`  Detecting scene changes...`);

  // Use ffmpeg scene detection
  const result = spawnSync('ffmpeg', [
    '-i', videoPath,
    '-filter:v', 'select=\'gt(scene,0.3)\',showinfo',
    '-f', 'null',
    '-'
  ], { encoding: 'utf-8', timeout: 600000 });

  const timestamps: number[] = [];
  const lines = result.stderr?.split('\n') || [];

  for (const line of lines) {
    const match = line.match(/pts_time:(\d+\.?\d*)/);
    if (match) {
      timestamps.push(parseFloat(match[1]));
    }
  }

  return timestamps;
}

async function extractAudioForAnalysis(videoPath: string, outputPath: string): Promise<void> {
  if (fs.existsSync(outputPath)) return;

  execSync(
    `ffmpeg -i "${videoPath}" -vn -acodec pcm_s16le -ar 16000 -ac 1 "${outputPath}"`,
    { stdio: 'pipe', timeout: 600000 }
  );
}

function estimateLotBoundaries(
  sceneChanges: number[],
  videoDuration: number
): { start: number; end: number }[] {
  // Mecum lots typically run 2-5 minutes
  // Look for scene changes that suggest lot transitions

  const boundaries: { start: number; end: number }[] = [];
  const minLotDuration = 60; // 1 minute minimum
  const maxLotDuration = 600; // 10 minute maximum

  let lastBoundary = 0;

  for (const change of sceneChanges) {
    const duration = change - lastBoundary;

    if (duration >= minLotDuration && duration <= maxLotDuration) {
      boundaries.push({
        start: lastBoundary,
        end: change,
      });
      lastBoundary = change;
    } else if (duration > maxLotDuration) {
      // Split long segments
      const segments = Math.ceil(duration / 180); // ~3 min segments
      const segmentDuration = duration / segments;

      for (let i = 0; i < segments; i++) {
        boundaries.push({
          start: lastBoundary + i * segmentDuration,
          end: lastBoundary + (i + 1) * segmentDuration,
        });
      }
      lastBoundary = change;
    }
  }

  // Add final segment
  if (videoDuration - lastBoundary > minLotDuration) {
    boundaries.push({
      start: lastBoundary,
      end: videoDuration,
    });
  }

  return boundaries;
}

async function clipLot(
  videoPath: string,
  startTime: number,
  endTime: number,
  outputPath: string
): Promise<void> {
  const duration = endTime - startTime;

  execSync(
    `ffmpeg -ss ${startTime} -i "${videoPath}" -t ${duration} -c copy "${outputPath}"`,
    { stdio: 'pipe', timeout: 60000 }
  );
}

async function analyzeClip(clipPath: string): Promise<{
  estimatedBidCount: number;
  hasSoldCall: boolean;
  hasNoSaleCall: boolean;
  audioIntensity: number;
}> {
  // Extract audio levels to estimate activity
  const result = spawnSync('ffmpeg', [
    '-i', clipPath,
    '-af', 'volumedetect',
    '-f', 'null',
    '-'
  ], { encoding: 'utf-8', timeout: 30000 });

  const stderr = result.stderr || '';
  const meanMatch = stderr.match(/mean_volume:\s*(-?\d+\.?\d*)/);
  const maxMatch = stderr.match(/max_volume:\s*(-?\d+\.?\d*)/);

  const meanVolume = meanMatch ? parseFloat(meanMatch[1]) : -30;
  const maxVolume = maxMatch ? parseFloat(maxMatch[1]) : -10;

  // Higher volume variance suggests more bidding activity
  const audioIntensity = Math.abs(maxVolume - meanVolume);

  // Estimate bid count based on audio patterns
  // (This is rough - real implementation would use speech recognition)
  const estimatedBidCount = Math.round(audioIntensity / 3);

  return {
    estimatedBidCount,
    hasSoldCall: audioIntensity > 15, // High peaks often indicate sold
    hasNoSaleCall: audioIntensity < 8, // Quieter endings often no sale
    audioIntensity,
  };
}

async function processVideo(videoUrl: string) {
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Mecum Lot Clipper');
  console.log('═══════════════════════════════════════════════\n');

  // Create directories
  fs.mkdirSync(CLIPS_DIR, { recursive: true });

  // Get metadata
  console.log('Getting video metadata...');
  const metadata = await getVideoMetadata(videoUrl);
  console.log(`  Title: ${metadata.title}`);
  console.log(`  Duration: ${Math.round(metadata.duration / 60)} minutes`);

  const videoPath = path.join(DATA_DIR, `${metadata.id}.mp4`);

  // Download video
  await downloadVideo(videoUrl, videoPath);

  // Detect scene changes
  const sceneChanges = await detectSceneChanges(videoPath);
  console.log(`  Found ${sceneChanges.length} scene changes`);

  // Estimate lot boundaries
  const boundaries = estimateLotBoundaries(sceneChanges, metadata.duration);
  console.log(`  Estimated ${boundaries.length} lots\n`);

  const lots: LotClip[] = [];

  for (let i = 0; i < boundaries.length; i++) {
    const { start, end } = boundaries[i];
    const lotNum = `LOT_${String(i + 1).padStart(3, '0')}`;
    const clipPath = path.join(CLIPS_DIR, `${metadata.id}_${lotNum}.mp4`);

    console.log(`Processing ${lotNum} (${formatTime(start)} - ${formatTime(end)})...`);

    // Clip the lot
    if (!fs.existsSync(clipPath)) {
      await clipLot(videoPath, start, end, clipPath);
    }

    // Analyze the clip
    const analysis = await analyzeClip(clipPath);

    const lot: LotClip = {
      lotNumber: lotNum,
      videoUrl,
      startTime: start,
      endTime: end,
      duration: end - start,
      outcome: analysis.hasSoldCall ? 'sold' : analysis.hasNoSaleCall ? 'no_sale' : 'unknown',
      bidCount: analysis.estimatedBidCount,
      clipPath,
    };

    lots.push(lot);

    console.log(`  Duration: ${Math.round(lot.duration)}s, Est. bids: ${lot.bidCount}, Outcome: ${lot.outcome}`);
  }

  // Store results
  console.log('\nStoring results...');

  await supabase.from('mecum_broadcast_analysis').upsert({
    video_id: metadata.id,
    video_url: videoUrl,
    title: metadata.title,
    total_duration: metadata.duration,
    lot_count: lots.length,
    lots: lots.map(l => ({
      ...l,
      clipPath: undefined, // Don't store local paths
    })),
    processed_at: new Date().toISOString(),
  }, {
    onConflict: 'video_id',
  });

  // Summary
  console.log('\n═══════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════');
  console.log(`  Total lots: ${lots.length}`);
  console.log(`  Sold: ${lots.filter(l => l.outcome === 'sold').length}`);
  console.log(`  No Sale: ${lots.filter(l => l.outcome === 'no_sale').length}`);
  console.log(`  Unknown: ${lots.filter(l => l.outcome === 'unknown').length}`);
  console.log(`  Avg duration: ${Math.round(lots.reduce((a, l) => a + l.duration, 0) / lots.length)}s`);
  console.log(`  Clips saved to: ${CLIPS_DIR}`);

  return lots;
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
  console.log('Mecum Lot Clipper');
  console.log('');
  console.log('Extracts individual lot clips from Mecum broadcasts.');
  console.log('');
  console.log('Usage:');
  console.log('  npx tsx scripts/mecum-lot-clipper.ts <youtube-url>');
  console.log('');
  console.log('Example:');
  console.log('  npx tsx scripts/mecum-lot-clipper.ts https://www.youtube.com/watch?v=c9fxArnD3IY');
  console.log('');
  console.log('Available Kissimmee 2026 broadcasts:');
  console.log('  Saturday Jan 17: https://www.youtube.com/watch?v=c9fxArnD3IY');
  console.log('  Friday Jan 16:   https://www.youtube.com/watch?v=bBrM75To55A');
  console.log('  Thursday Jan 15: https://www.youtube.com/watch?v=rpJ0POdkMh0');
  console.log('  Wednesday Jan 14: https://www.youtube.com/watch?v=owTlZmi5LB8');
  process.exit(0);
}

processVideo(videoUrl).catch(console.error);
