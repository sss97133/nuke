#!/usr/bin/env npx tsx
/**
 * Mecum Video Catalog Builder
 *
 * Catalogs all Mecum YouTube broadcasts and maps them to auctions.
 * Creates a queue for processing when compute is available.
 *
 * Usage:
 *   npx tsx scripts/mecum-video-catalog.ts catalog   # Build video catalog
 *   npx tsx scripts/mecum-video-catalog.ts queue     # Show processing queue
 *   npx tsx scripts/mecum-video-catalog.ts stats     # Show coverage stats
 */

import { execSync, spawnSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const CATALOG_FILE = '/tmp/mecum-video-catalog.json';

interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  channel: string;
  uploadDate?: string;
  auctionName?: string;
  auctionDate?: string;
  auctionLocation?: string;
  videoType: 'full_broadcast' | 'block_cam' | 'highlight' | 'lot_clip' | 'other';
}

function parseAuctionFromTitle(title: string): Partial<VideoInfo> {
  const result: Partial<VideoInfo> = {};

  // Parse auction location
  const locations = ['Kissimmee', 'Houston', 'Indy', 'Glendale', 'Dallas', 'Fort Worth', 'Las Vegas', 'Harrisburg', 'Kansas City', 'Monterey', 'Chicago'];
  for (const loc of locations) {
    if (title.toLowerCase().includes(loc.toLowerCase())) {
      result.auctionLocation = loc;
      break;
    }
  }

  // Parse year
  const yearMatch = title.match(/20(2[0-9])/);
  if (yearMatch) {
    result.auctionDate = `20${yearMatch[1]}`;
  }

  // Parse date
  const dateMatch = title.match(/(January|February|March|April|May|June|July|August|September|October|November|December)[,.\s]+(\d{1,2})/i);
  if (dateMatch && result.auctionDate) {
    const month = dateMatch[1];
    const day = dateMatch[2];
    const monthNum = new Date(`${month} 1, 2000`).getMonth() + 1;
    result.auctionDate = `${result.auctionDate}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // Parse video type
  if (title.toLowerCase().includes('block cam')) {
    result.videoType = 'block_cam';
  } else if (title.toLowerCase().includes('full broadcast') || title.toLowerCase().includes('full show')) {
    result.videoType = 'full_broadcast';
  } else if (title.toLowerCase().includes('lot #') || title.toLowerCase().includes('lot#')) {
    result.videoType = 'lot_clip';
  } else if (title.toLowerCase().includes('highlight') || title.toLowerCase().includes('best moment') || title.toLowerCase().includes('top sales')) {
    result.videoType = 'highlight';
  } else {
    result.videoType = 'other';
  }

  // Build auction name
  if (result.auctionLocation && result.auctionDate) {
    result.auctionName = `Mecum ${result.auctionLocation} ${result.auctionDate.slice(0, 4)}`;
  }

  return result;
}

async function searchYouTube(query: string, limit: number = 50): Promise<VideoInfo[]> {
  const results: VideoInfo[] = [];

  try {
    const output = execSync(
      `yt-dlp "ytsearch${limit}:${query}" --flat-playlist --print "%(id)s|%(title)s|%(duration)s|%(channel)s" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 120000 }
    );

    for (const line of output.trim().split('\n')) {
      if (!line) continue;
      const [id, title, durationStr, channel] = line.split('|');
      if (!id || !title) continue;

      const duration = parseFloat(durationStr) || 0;
      const parsed = parseAuctionFromTitle(title);

      results.push({
        id,
        title,
        duration,
        channel: channel || '',
        ...parsed
      } as VideoInfo);
    }
  } catch (e) {
    console.error('YouTube search failed:', e);
  }

  return results;
}

async function buildCatalog() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  MECUM VIDEO CATALOG BUILDER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allVideos: Map<string, VideoInfo> = new Map();

  // Search queries to find all Mecum videos
  const searches = [
    'mecum full broadcast',
    'mecum block cam',
    'mecum kissimmee broadcast',
    'mecum indy broadcast',
    'mecum houston broadcast',
    'mecum glendale broadcast',
    'mecum las vegas broadcast',
    'mecum dallas broadcast',
    'mecum harrisburg broadcast',
    'mecum auction 2024',
    'mecum auction 2025',
    'mecum auction 2023',
  ];

  for (const query of searches) {
    console.log(`🔍 Searching: ${query}`);
    const videos = await searchYouTube(query, 50);

    let newCount = 0;
    for (const video of videos) {
      if (!allVideos.has(video.id) && video.channel.toLowerCase().includes('mecum')) {
        allVideos.set(video.id, video);
        newCount++;
      }
    }
    console.log(`   Found ${videos.length} videos, ${newCount} new\n`);
  }

  // Convert to array and sort by duration (longest first)
  const catalog = Array.from(allVideos.values())
    .sort((a, b) => b.duration - a.duration);

  // Save catalog
  fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2));
  console.log(`\n💾 Saved ${catalog.length} videos to ${CATALOG_FILE}`);

  // Stats
  const broadcasts = catalog.filter(v => v.videoType === 'full_broadcast');
  const blockCams = catalog.filter(v => v.videoType === 'block_cam');
  const totalHours = catalog.reduce((sum, v) => sum + v.duration, 0) / 3600;

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('CATALOG SUMMARY');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(`Total videos: ${catalog.length}`);
  console.log(`Full broadcasts: ${broadcasts.length}`);
  console.log(`Block cams: ${blockCams.length}`);
  console.log(`Total hours: ${totalHours.toFixed(0)}`);
  console.log('───────────────────────────────────────────────────────────────\n');

  // Show top videos
  console.log('TOP 20 VIDEOS BY DURATION:');
  for (const video of catalog.slice(0, 20)) {
    const hours = (video.duration / 3600).toFixed(1);
    const type = video.videoType === 'block_cam' ? '📹' : video.videoType === 'full_broadcast' ? '🎬' : '📺';
    console.log(`${type} ${hours}h | ${video.auctionName || 'Unknown'} | ${video.id}`);
    console.log(`   ${video.title.slice(0, 60)}...`);
  }

  return catalog;
}

async function showQueue() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PROCESSING QUEUE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Load catalog
  if (!fs.existsSync(CATALOG_FILE)) {
    console.log('No catalog found. Run: npx tsx scripts/mecum-video-catalog.ts catalog\n');
    return;
  }

  const catalog: VideoInfo[] = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf-8'));

  // Get already processed videos
  const { data: processed } = await supabase
    .from('auction_events')
    .select('broadcast_video_url')
    .not('broadcast_video_url', 'is', null)
    .not('broadcast_timestamp_start', 'is', null);

  const processedIds = new Set(
    (processed || [])
      .map(p => {
        const match = p.broadcast_video_url?.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return match ? match[1] : null;
      })
      .filter(Boolean)
  );

  // Filter to processable videos (broadcasts and block cams)
  const queue = catalog
    .filter(v => ['full_broadcast', 'block_cam'].includes(v.videoType))
    .filter(v => !processedIds.has(v.id));

  const totalHours = queue.reduce((sum, v) => sum + v.duration, 0) / 3600;

  console.log(`Unprocessed broadcasts: ${queue.length}`);
  console.log(`Total hours to process: ${totalHours.toFixed(0)}`);
  console.log(`Estimated local processing time: ${(totalHours * 0.2).toFixed(0)} hours (at 5x realtime)`);
  console.log('');

  // Estimate costs if we used OpenAI
  const audioCost = totalHours * 0.36; // Whisper API ~$0.006/min
  const llmCost = totalHours * 0.20; // Rough LLM cost
  console.log(`💰 OpenAI API cost estimate: $${(audioCost + llmCost).toFixed(0)}`);
  console.log(`💰 Local processing cost: $0.00`);
  console.log('');

  // Group by auction
  const byAuction: Record<string, VideoInfo[]> = {};
  for (const video of queue) {
    const key = video.auctionName || 'Unknown';
    if (!byAuction[key]) byAuction[key] = [];
    byAuction[key].push(video);
  }

  console.log('───────────────────────────────────────────────────────────────');
  console.log('QUEUE BY AUCTION:');
  console.log('───────────────────────────────────────────────────────────────');
  for (const [auction, videos] of Object.entries(byAuction).sort()) {
    const hours = videos.reduce((sum, v) => sum + v.duration, 0) / 3600;
    console.log(`${auction}: ${videos.length} videos (${hours.toFixed(1)}h)`);
  }
  console.log('───────────────────────────────────────────────────────────────\n');
}

async function showStats() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  MECUM DATA COVERAGE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Current database coverage
  const { data: stats } = await supabase.rpc('exec_sql', {
    query: `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE broadcast_video_url IS NOT NULL) as has_video,
        COUNT(*) FILTER (WHERE broadcast_timestamp_start IS NOT NULL) as has_timestamp,
        COUNT(*) FILTER (WHERE estimate_low IS NOT NULL) as has_estimates,
        COUNT(*) FILTER (WHERE winning_bid IS NOT NULL) as has_sale_price,
        COUNT(DISTINCT lot_number) as unique_lots,
        COUNT(DISTINCT auction_name) as unique_auctions
      FROM auction_events
      WHERE source = 'mecum'
    `
  });

  // Fallback manual query
  const { data: manualStats } = await supabase
    .from('auction_events')
    .select('id, broadcast_video_url, broadcast_timestamp_start, estimate_low, winning_bid, lot_number, auction_name')
    .eq('source', 'mecum');

  if (manualStats) {
    const total = manualStats.length;
    const hasVideo = manualStats.filter(r => r.broadcast_video_url).length;
    const hasTimestamp = manualStats.filter(r => r.broadcast_timestamp_start).length;
    const hasEstimates = manualStats.filter(r => r.estimate_low).length;
    const hasSalePrice = manualStats.filter(r => r.winning_bid).length;
    const uniqueLots = new Set(manualStats.map(r => r.lot_number).filter(Boolean)).size;
    const uniqueAuctions = new Set(manualStats.map(r => r.auction_name).filter(Boolean)).size;

    console.log('DATABASE COVERAGE:');
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`Total Mecum records:    ${total.toLocaleString()}`);
    console.log(`With video URL:         ${hasVideo.toLocaleString()} (${(hasVideo/total*100).toFixed(1)}%)`);
    console.log(`With timestamp:         ${hasTimestamp.toLocaleString()} (${(hasTimestamp/total*100).toFixed(1)}%)`);
    console.log(`With estimates:         ${hasEstimates.toLocaleString()} (${(hasEstimates/total*100).toFixed(1)}%)`);
    console.log(`With sale price:        ${hasSalePrice.toLocaleString()} (${(hasSalePrice/total*100).toFixed(1)}%)`);
    console.log(`Unique lot numbers:     ${uniqueLots.toLocaleString()}`);
    console.log(`Unique auctions:        ${uniqueAuctions.toLocaleString()}`);
    console.log('───────────────────────────────────────────────────────────────\n');
  }

  // Video catalog stats
  if (fs.existsSync(CATALOG_FILE)) {
    const catalog: VideoInfo[] = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf-8'));
    const broadcasts = catalog.filter(v => v.videoType === 'full_broadcast' || v.videoType === 'block_cam');
    const totalHours = broadcasts.reduce((sum, v) => sum + v.duration, 0) / 3600;

    console.log('VIDEO CATALOG:');
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`Total videos cataloged: ${catalog.length}`);
    console.log(`Broadcasts & block cams: ${broadcasts.length}`);
    console.log(`Total hours of footage: ${totalHours.toFixed(0)}`);
    console.log('───────────────────────────────────────────────────────────────\n');
  } else {
    console.log('No video catalog found. Run: npx tsx scripts/mecum-video-catalog.ts catalog\n');
  }

  // What we need
  console.log('WHAT WE NEED:');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('1. Scrape Mecum website for lot results (lot#, estimate, price)');
  console.log('2. Process video broadcasts to extract timestamps');
  console.log('3. Match lots to video moments');
  console.log('4. ~500+ hours of footage to process');
  console.log('5. ~20,000+ lots per year at Kissimmee alone');
  console.log('───────────────────────────────────────────────────────────────\n');
}

// Main
const command = process.argv[2];

if (!command) {
  console.log('\nMecum Video Catalog Builder\n');
  console.log('Usage:');
  console.log('  npx tsx scripts/mecum-video-catalog.ts catalog  # Build video catalog');
  console.log('  npx tsx scripts/mecum-video-catalog.ts queue    # Show processing queue');
  console.log('  npx tsx scripts/mecum-video-catalog.ts stats    # Show coverage stats\n');
  process.exit(0);
}

switch (command) {
  case 'catalog':
    buildCatalog();
    break;
  case 'queue':
    showQueue();
    break;
  case 'stats':
    showStats();
    break;
  default:
    console.log(`Unknown command: ${command}`);
}
