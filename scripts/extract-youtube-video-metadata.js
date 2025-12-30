#!/usr/bin/env node
/**
 * Extract YouTube Video Metadata for Broad Arrow
 * Extracts video release dates, descriptions, and links them to vehicles
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../nuke_frontend/.env.local') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Extract YouTube video ID from URL
 */
function extractYouTubeId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
    /youtube\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/i,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

/**
 * Extract date from YouTube description or metadata
 * Looks for patterns like "Oct 21, 2025", "October 21, 2025", etc.
 */
function extractVideoDate(description) {
  if (!description) return null;
  
  // Try various date patterns
  const datePatterns = [
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})/i,
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i,
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
    /(\d{4})-(\d{1,2})-(\d{1,2})/,
  ];
  
  for (const pattern of datePatterns) {
    const match = description.match(pattern);
    if (match) {
      try {
        // Try to parse the date
        const dateStr = match[0];
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      } catch (e) {
        // Continue to next pattern
      }
    }
  }
  
  return null;
}

/**
 * Update vehicle image with YouTube video metadata
 */
async function updateVideoMetadata(videoImageId, videoUrl, metadata) {
  const videoId = extractYouTubeId(videoUrl);
  if (!videoId) {
    console.warn(`  ⚠️  Could not extract video ID from: ${videoUrl}`);
    return false;
  }
  
  // Fetch YouTube video metadata (would need YouTube API or scraping)
  // For now, extract what we can from the URL and existing data
  const videoDate = extractVideoDate(metadata.description || '');
  
  const updatedExif = {
    ...metadata,
    video_id: videoId,
    video_date: videoDate,
    video_url: videoUrl,
    updated_at: new Date().toISOString(),
  };
  
  const { error } = await supabase
    .from('vehicle_images')
    .update({
      exif_data: updatedExif,
    })
    .eq('id', videoImageId);
  
  if (error) {
    console.error(`  ❌ Error updating video metadata: ${error.message}`);
    return false;
  }
  
  return true;
}

async function processVideos() {
  console.log('🎥 Extracting YouTube Video Metadata for Broad Arrow\n');
  
  // Find all vehicle images that are videos
  const { data: videoImages, error } = await supabase
    .from('vehicle_images')
    .select('id, vehicle_id, exif_data, image_url, source')
    .eq('source', 'broad arrow auctions')
    .not('exif_data->is_video', 'is', null);
  
  if (error) {
    console.error('❌ Error fetching video images:', error);
    return;
  }
  
  if (!videoImages || videoImages.length === 0) {
    console.log('ℹ️  No video images found. Videos will be extracted during vehicle extraction.');
    return;
  }
  
  console.log(`📹 Found ${videoImages.length} video images to process\n`);
  
  let updated = 0;
  let errors = 0;
  
  for (const videoImage of videoImages) {
    const exif = videoImage.exif_data || {};
    const videoUrl = exif.video_url;
    
    if (!videoUrl) {
      console.warn(`  ⚠️  Video image ${videoImage.id} has no video_url`);
      continue;
    }
    
    console.log(`  Processing: ${videoUrl}`);
    
    const success = await updateVideoMetadata(videoImage.id, videoUrl, exif);
    if (success) {
      updated++;
    } else {
      errors++;
    }
  }
  
  console.log(`\n✅ Complete:`);
  console.log(`   Updated: ${updated}`);
  console.log(`   Errors: ${errors}`);
}

processVideos().catch(console.error);

