#!/usr/bin/env tsx
/**
 * Import Popular Reaction Meme Images
 * 
 * This script imports popular 4chan/YouTube-style reaction meme images
 * from safe, legal sources (Wikimedia Commons, public domain, etc.)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env.local') });
dotenv.config({ path: resolve(process.cwd(), '.env') });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Reaction meme templates from GIPHY and other sources
 * 
 * NOTE: GIPHY GIFs can be imported using direct URLs like:
 * https://i.giphy.com/[ID].gif or https://media.giphy.com/media/[ID]/giphy.gif
 * 
 * To add more memes:
 * 1. Add to this array with direct image/GIF URLs
 * 2. Use the admin UI at /admin/meme-library to import via URL
 * 3. Upload files directly through the admin UI
 */

interface MemeTemplate {
  pack: string;
  slug: string;
  title: string;
  url: string;
  tags: string[];
  source_url?: string;
  attribution?: string;
  license: string;
}

const MEME_TEMPLATES: MemeTemplate[] = [
  // Reaction Pack - General reactions
  {
    pack: 'reactions',
    slug: 'arthur_fist',
    title: 'Arthur Fist',
    url: '', // Will need GIPHY direct URL - placeholder
    tags: ['arthur', 'angry', 'reaction', 'fist'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'reactions',
    slug: 'confused_charlie',
    title: 'Confused Charlie',
    url: '', // GIPHY direct URL needed
    tags: ['confused', 'always sunny', 'reaction'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'reactions',
    slug: 'crying_dawson',
    title: 'Crying Dawson',
    url: '', // GIPHY direct URL needed
    tags: ['crying', 'dawson', 'dramatic', 'reaction'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'reactions',
    slug: 'hair_flip',
    title: 'Hair Flip',
    url: '', // GIPHY direct URL needed
    tags: ['hair flip', 'ariana grande', 'reaction'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'reactions',
    slug: 'like_a_boss',
    title: 'Like a Boss',
    url: '', // GIPHY direct URL needed
    tags: ['boss', 'andy samberg', 'snl', 'reaction'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'reactions',
    slug: 'sips_tea',
    title: 'Sips Tea',
    url: '', // GIPHY direct URL needed
    tags: ['tea', 'reaction', 'sipping'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },

  // Negative Energy Pack
  {
    pack: 'negative_energy',
    slug: 'fail_kids',
    title: 'Fail - Kids Falling',
    url: '', // GIPHY direct URL needed
    tags: ['fail', 'fall', 'negative'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'negative_energy',
    slug: 'forever_alone',
    title: 'Forever Alone',
    url: '', // GIPHY direct URL needed
    tags: ['alone', 'sad', 'negative'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },

  // Hater Pack
  {
    pack: 'hater',
    slug: 'idgaf',
    title: 'No Fucks Given',
    url: '', // GIPHY direct URL needed
    tags: ['hater', 'idgaf', 'dont care'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'hater',
    slug: 'look_at_fucks',
    title: 'Look at All the Fucks I Give',
    url: '', // GIPHY direct URL needed
    tags: ['hater', 'idgaf', 'sarcasm'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },

  // Chad Pack
  {
    pack: 'chad',
    slug: 'steal_yo_girl',
    title: 'Steal Yo Girl',
    url: '', // GIPHY direct URL needed
    tags: ['chad', 'alpha', 'swag'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'chad',
    slug: 'money_swag',
    title: 'Money Swag',
    url: '', // GIPHY direct URL needed
    tags: ['chad', 'money', 'swag'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'chad',
    slug: 'deal_with_it',
    title: 'Deal With It',
    url: '', // GIPHY direct URL needed
    tags: ['chad', 'deal with it', 'confident'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },

  // YouTube Pack
  {
    pack: 'youtube',
    slug: 'judge_judy',
    title: 'Judge Judy',
    url: '', // GIPHY direct URL needed
    tags: ['youtube', 'judge', 'reaction'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'youtube',
    slug: 'dank_memes',
    title: 'Dank Memes',
    url: '', // GIPHY direct URL needed
    tags: ['youtube', 'dank', 'memes'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'youtube',
    slug: 'cuca',
    title: 'Cuca',
    url: '', // GIPHY direct URL needed
    tags: ['youtube', 'cuca', 'tv globo'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
  {
    pack: 'youtube',
    slug: 'feels',
    title: 'Feels',
    url: '', // GIPHY direct URL needed
    tags: ['youtube', 'feels', 'emotion'],
    source_url: 'https://giphy.com/categories/memes',
    attribution: 'GIPHY',
    license: 'Fair Use',
  },
];

// Filter out memes without URLs (placeholders)
const VALID_MEMES = MEME_TEMPLATES.filter(m => m.url && m.url.length > 0);

async function importMeme(template: typeof MEME_TEMPLATES[0]) {
  try {
    console.log(`Importing: ${template.title}...`);

    // Fetch the image
    const response = await fetch(template.url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`Not an image: ${contentType}`);
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 10 * 1024 * 1024) {
      throw new Error('File too large');
    }

    // Determine file extension
    let ext = 'png';
    if (contentType.includes('gif')) ext = 'gif';
    else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
    else if (contentType.includes('webp')) ext = 'webp';
    else if (contentType.includes('png')) ext = 'png';
    
    // Also check URL for extension hint
    try {
      const urlPath = new URL(template.url).pathname.toLowerCase();
      if (urlPath.endsWith('.gif')) ext = 'gif';
      else if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg')) ext = 'jpg';
      else if (urlPath.endsWith('.webp')) ext = 'webp';
      else if (urlPath.endsWith('.png')) ext = 'png';
    } catch {}
    
    const objectPath = `packs/${template.pack}/${template.slug}.${ext}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('meme-assets')
      .upload(objectPath, buffer, {
        upsert: true,
        contentType: contentType,
        cacheControl: '3600',
      });

    if (uploadErr) {
      throw uploadErr;
    }

    const { data: { publicUrl } } = supabase.storage.from('meme-assets').getPublicUrl(uploadData.path);

    // Get pack ID
    const { data: packData, error: packErr } = await supabase
      .from('stream_action_packs')
      .select('id')
      .eq('slug', template.pack)
      .single();

    if (packErr || !packData) {
      throw new Error(`Pack not found: ${template.pack}`);
    }

    // Create/update action
    const { error: actionErr } = await supabase.rpc('admin_upsert_stream_action', {
      p_pack_id: packData.id,
      p_slug: template.slug,
      p_title: template.title,
      p_kind: 'image_popup',
      p_render_text: null,
      p_image_url: publicUrl,
      p_sound_key: null,
      p_duration_ms: 1800,
      p_cooldown_ms: 2500,
      p_is_active: true,
      p_source_url: template.source_url,
      p_attribution: template.attribution,
      p_license: template.license,
      p_tags: template.tags,
      p_metadata: { imported_via: 'script', imported_at: new Date().toISOString() },
    });

    if (actionErr) {
      throw actionErr;
    }

    console.log(`  ✓ Imported: ${template.title}`);
    return true;
  } catch (error: any) {
    console.error(`  ✗ Failed: ${template.title} - ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('🎨 Importing Popular Reaction Meme Images\n');
  console.log(`Found ${MEME_TEMPLATES.length} templates configured`);
  console.log(`${VALID_MEMES.length} with valid URLs to import\n`);

  if (VALID_MEMES.length === 0) {
    console.log('⚠️  No memes with valid URLs found.');
    console.log('\nTo add memes:');
    console.log('1. Edit this file and add GIPHY direct URLs (https://i.giphy.com/[ID].gif)');
    console.log('2. Or use the admin UI at /admin/meme-library to import via URL');
    console.log('3. Or upload files directly through the admin UI\n');
    return;
  }

  let success = 0;
  let failed = 0;

  for (const template of VALID_MEMES) {
    const result = await importMeme(template);
    if (result) {
      success++;
    } else {
      failed++;
    }
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n✅ Import complete:`);
  console.log(`   Success: ${success}`);
  console.log(`   Failed: ${failed}`);
}

main().catch(console.error);
