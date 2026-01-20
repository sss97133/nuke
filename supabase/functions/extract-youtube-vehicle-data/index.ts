/**
 * EXTRACT YOUTUBE VEHICLE DATA
 *
 * Extracts vehicle information from YouTube videos by:
 * 1. Fetching video metadata and captions/transcripts
 * 2. Analyzing content with LLM to find vehicle mentions
 * 3. Creating vehicle profile entries from found data
 *
 * Supports channels like:
 * - Jay Leno's Garage (detailed specs, ownership history)
 * - Petrolicious (owner stories, vehicle backgrounds)
 * - Doug DeMuro (detailed reviews with quirks and features)
 * - VINwiki (ownership stories, vehicle history)
 * - Harry's Garage (reviews and collection tours)
 *
 * Actions:
 * - process_video: Process a single video
 * - process_channel: Process recent videos from a channel
 * - run_cycle: Process pending videos
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
const YOUTUBE_API_KEY = Deno.env.get('YOUTUBE_API_KEY');

interface VehicleMention {
  year?: number;
  make: string;
  model: string;
  trim?: string;
  vin?: string;
  color?: string;
  mileage?: number;
  price?: number;
  owner_name?: string;
  location?: string;
  notable_features?: string[];
  history_notes?: string;
  timestamps?: string[];  // When in the video this vehicle is discussed
  confidence: number;
}

interface VideoAnalysis {
  video_type: string;
  primary_vehicle?: VehicleMention;
  additional_vehicles: VehicleMention[];
  owner_info?: {
    name?: string;
    location?: string;
    collection_size?: number;
    notable_info?: string;
  };
  key_facts: string[];
  data_quality: 'high' | 'medium' | 'low';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const { action = 'run_cycle', video_id, channel_id, max_videos = 10 } = body;

    console.log('='.repeat(70));
    console.log('EXTRACT YOUTUBE VEHICLE DATA');
    console.log('='.repeat(70));
    console.log(`Action: ${action}`);
    console.log(`Time: ${new Date().toISOString()}\n`);

    switch (action) {
      case 'process_video':
        if (!video_id) {
          return errorResponse('video_id required');
        }
        return await processVideo(supabase, video_id);

      case 'process_channel':
        if (!channel_id) {
          return errorResponse('channel_id required');
        }
        return await processChannel(supabase, channel_id, max_videos);

      case 'run_cycle':
        return await runCycle(supabase, max_videos);

      case 'list_channels':
        return await listChannels(supabase);

      default:
        return errorResponse(`Unknown action: ${action}`);
    }

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function errorResponse(message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Process a single YouTube video
 */
async function processVideo(supabase: any, videoId: string) {
  console.log(`\n📹 Processing video: ${videoId}\n`);

  // Check if already processed
  const { data: existing } = await supabase
    .from('youtube_videos')
    .select('id, processing_status')
    .eq('video_id', videoId)
    .single();

  if (existing?.processing_status === 'processed') {
    return new Response(
      JSON.stringify({
        success: true,
        action: 'process_video',
        video_id: videoId,
        status: 'already_processed'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get video metadata
  const videoData = await fetchVideoMetadata(videoId);
  if (!videoData) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Could not fetch video metadata'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log(`Title: ${videoData.title}`);
  console.log(`Channel: ${videoData.channelTitle}`);

  // Get captions/transcript
  const transcript = await fetchTranscript(videoId);
  console.log(`Transcript: ${transcript ? `${transcript.length} chars` : 'not available'}`);

  // Analyze content with LLM
  const analysis = await analyzeVideoContent(videoData, transcript);
  console.log(`Analysis: ${analysis.video_type}, Quality: ${analysis.data_quality}`);

  if (analysis.primary_vehicle) {
    console.log(`Primary vehicle: ${analysis.primary_vehicle.year} ${analysis.primary_vehicle.make} ${analysis.primary_vehicle.model}`);
  }
  console.log(`Additional vehicles: ${analysis.additional_vehicles.length}`);

  // Ensure channel exists
  let channelId = videoData.channelId;
  const { data: channelData } = await supabase
    .from('youtube_channels')
    .select('id')
    .eq('channel_id', channelId)
    .single();

  if (!channelData) {
    // Create channel
    await supabase.from('youtube_channels').insert({
      channel_id: channelId,
      channel_name: videoData.channelTitle,
      channel_type: 'mixed',
      is_active: true
    });
  }

  // Upsert video record
  const { data: videoRecord, error: videoError } = await supabase
    .from('youtube_videos')
    .upsert({
      video_id: videoId,
      channel_id: channelId,
      title: videoData.title,
      description: videoData.description?.substring(0, 5000),
      published_at: videoData.publishedAt,
      duration_seconds: parseDuration(videoData.duration),
      view_count: parseInt(videoData.viewCount || '0'),
      like_count: parseInt(videoData.likeCount || '0'),
      comment_count: parseInt(videoData.commentCount || '0'),
      video_type: analysis.video_type,
      vehicles_mentioned: analysis.additional_vehicles.length > 0 || analysis.primary_vehicle
        ? [analysis.primary_vehicle, ...analysis.additional_vehicles].filter(Boolean)
        : [],
      has_captions: !!transcript,
      captions_extracted: !!transcript,
      caption_text: transcript?.substring(0, 50000),
      processing_status: 'processed',
      processed_at: new Date().toISOString()
    }, { onConflict: 'video_id' })
    .select()
    .single();

  if (videoError) {
    console.error('Error saving video:', videoError);
  }

  // Create vehicle profiles from high-confidence mentions
  let vehiclesCreated = 0;
  const allVehicles = [analysis.primary_vehicle, ...analysis.additional_vehicles].filter(Boolean);

  for (const vehicle of allVehicles) {
    if (vehicle.confidence >= 0.7 && vehicle.make && vehicle.model) {
      const vehicleResult = await createVehicleFromMention(supabase, vehicle, videoRecord?.id, videoData);
      if (vehicleResult.created) {
        vehiclesCreated++;
      }
    }
  }

  // Update channel stats
  await supabase
    .from('youtube_channels')
    .update({
      videos_processed: supabase.raw('videos_processed + 1'),
      vehicles_extracted: supabase.raw(`vehicles_extracted + ${vehiclesCreated}`),
      last_scraped_at: new Date().toISOString()
    })
    .eq('channel_id', channelId);

  return new Response(
    JSON.stringify({
      success: true,
      action: 'process_video',
      video_id: videoId,
      title: videoData.title,
      analysis: {
        video_type: analysis.video_type,
        data_quality: analysis.data_quality,
        primary_vehicle: analysis.primary_vehicle,
        additional_vehicles_count: analysis.additional_vehicles.length,
        key_facts: analysis.key_facts
      },
      vehicles_created: vehiclesCreated,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Process recent videos from a channel
 */
async function processChannel(supabase: any, channelId: string, maxVideos: number) {
  console.log(`\n📺 Processing channel: ${channelId}\n`);

  // Get channel's recent videos
  const videos = await fetchChannelVideos(channelId, maxVideos);
  console.log(`Found ${videos.length} videos to process\n`);

  const results = {
    videos_processed: 0,
    vehicles_extracted: 0,
    errors: [] as string[]
  };

  for (const video of videos) {
    try {
      // Check if already processed
      const { data: existing } = await supabase
        .from('youtube_videos')
        .select('processing_status')
        .eq('video_id', video.id)
        .single();

      if (existing?.processing_status === 'processed') {
        console.log(`Skipping ${video.id} - already processed`);
        continue;
      }

      console.log(`\nProcessing: ${video.title}`);

      const response = await processVideo(supabase, video.id);
      const result = await response.json();

      if (result.success) {
        results.videos_processed++;
        results.vehicles_extracted += result.vehicles_created || 0;
      } else {
        results.errors.push(`${video.id}: ${result.error}`);
      }

    } catch (e: any) {
      results.errors.push(`${video.id}: ${e.message}`);
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'process_channel',
      channel_id: channelId,
      results,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Run a processing cycle on pending videos
 */
async function runCycle(supabase: any, maxVideos: number) {
  console.log(`\n🔄 Running processing cycle (max ${maxVideos} videos)\n`);

  // Get pending videos
  const { data: pendingVideos } = await supabase
    .from('youtube_videos')
    .select('video_id')
    .eq('processing_status', 'pending')
    .limit(maxVideos);

  const videos = pendingVideos || [];
  console.log(`Found ${videos.length} pending videos\n`);

  const results = {
    videos_processed: 0,
    vehicles_extracted: 0,
    errors: [] as string[]
  };

  for (const video of videos) {
    try {
      const response = await processVideo(supabase, video.video_id);
      const result = await response.json();

      if (result.success) {
        results.videos_processed++;
        results.vehicles_extracted += result.vehicles_created || 0;
      }
    } catch (e: any) {
      results.errors.push(`${video.video_id}: ${e.message}`);
    }
  }

  // If no pending videos, try to discover new ones from active channels
  if (videos.length === 0) {
    console.log('No pending videos, checking active channels...');

    const { data: channels } = await supabase
      .from('youtube_channels')
      .select('channel_id')
      .eq('is_active', true)
      .order('last_scraped_at', { ascending: true, nullsFirst: true })
      .limit(3);

    for (const channel of channels || []) {
      const channelVideos = await fetchChannelVideos(channel.channel_id, 5);

      for (const video of channelVideos) {
        await supabase.from('youtube_videos').upsert({
          video_id: video.id,
          channel_id: channel.channel_id,
          title: video.title,
          published_at: video.publishedAt,
          processing_status: 'pending'
        }, { onConflict: 'video_id', ignoreDuplicates: true });
      }
    }
  }

  return new Response(
    JSON.stringify({
      success: true,
      action: 'run_cycle',
      results,
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * List configured YouTube channels
 */
async function listChannels(supabase: any) {
  const { data: channels } = await supabase
    .from('youtube_channels')
    .select('*')
    .order('videos_processed', { ascending: false });

  return new Response(
    JSON.stringify({
      success: true,
      action: 'list_channels',
      channels: channels || [],
      timestamp: new Date().toISOString()
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Fetch video metadata from YouTube
 */
async function fetchVideoMetadata(videoId: string): Promise<any> {
  if (!YOUTUBE_API_KEY) {
    // Fallback: Use oEmbed API (limited data)
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
      );
      if (response.ok) {
        const data = await response.json();
        return {
          id: videoId,
          title: data.title,
          channelTitle: data.author_name,
          channelId: 'unknown',
          description: '',
        };
      }
    } catch (e) {
      console.error('oEmbed failed:', e);
    }
    return null;
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?` +
      `id=${videoId}&part=snippet,contentDetails,statistics&key=${YOUTUBE_API_KEY}`
    );

    if (!response.ok) {
      console.error('YouTube API error:', response.status);
      return null;
    }

    const data = await response.json();
    const video = data.items?.[0];

    if (!video) return null;

    return {
      id: video.id,
      title: video.snippet.title,
      description: video.snippet.description,
      channelId: video.snippet.channelId,
      channelTitle: video.snippet.channelTitle,
      publishedAt: video.snippet.publishedAt,
      duration: video.contentDetails.duration,
      viewCount: video.statistics.viewCount,
      likeCount: video.statistics.likeCount,
      commentCount: video.statistics.commentCount,
    };
  } catch (e: any) {
    console.error('Error fetching video metadata:', e);
    return null;
  }
}

/**
 * Fetch video transcript/captions
 */
async function fetchTranscript(videoId: string): Promise<string | null> {
  // Try to get auto-generated captions from a transcript service
  // Note: YouTube's official API doesn't provide captions easily
  // This would typically use a service like youtube-transcript-api

  try {
    // Attempt to fetch from a transcript aggregator or scrape
    const response = await fetch(
      `https://youtubetranscript.com/?server_vid2=${videoId}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; nzero-bot/1.0)'
        }
      }
    );

    if (response.ok) {
      const text = await response.text();
      // Parse the transcript from response
      // This is a simplified version - actual implementation would parse XML/JSON
      if (text.length > 100) {
        return text.replace(/<[^>]*>/g, ' ').trim();
      }
    }
  } catch (e) {
    // Transcript service not available
  }

  // Fallback: Use video description as content
  return null;
}

/**
 * Fetch recent videos from a channel
 */
async function fetchChannelVideos(channelId: string, maxResults: number): Promise<any[]> {
  if (!YOUTUBE_API_KEY) {
    return [];
  }

  try {
    // First, get the uploads playlist ID
    const channelResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?` +
      `id=${channelId}&part=contentDetails&key=${YOUTUBE_API_KEY}`
    );

    if (!channelResponse.ok) return [];

    const channelData = await channelResponse.json();
    const uploadsPlaylistId = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) return [];

    // Get videos from uploads playlist
    const playlistResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?` +
      `playlistId=${uploadsPlaylistId}&part=snippet&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`
    );

    if (!playlistResponse.ok) return [];

    const playlistData = await playlistResponse.json();

    return (playlistData.items || []).map((item: any) => ({
      id: item.snippet.resourceId.videoId,
      title: item.snippet.title,
      publishedAt: item.snippet.publishedAt,
    }));
  } catch (e: any) {
    console.error('Error fetching channel videos:', e);
    return [];
  }
}

/**
 * Analyze video content with LLM
 */
async function analyzeVideoContent(videoData: any, transcript: string | null): Promise<VideoAnalysis> {
  if (!OPENAI_API_KEY) {
    return {
      video_type: 'unknown',
      additional_vehicles: [],
      key_facts: [],
      data_quality: 'low'
    };
  }

  const content = transcript
    ? `Title: ${videoData.title}\nDescription: ${videoData.description?.substring(0, 2000)}\nTranscript: ${transcript.substring(0, 8000)}`
    : `Title: ${videoData.title}\nDescription: ${videoData.description?.substring(0, 4000)}`;

  const prompt = `Analyze this YouTube video about cars and extract vehicle information.

${content}

Extract:
1. Video type (review, tour, auction_coverage, restoration_update, build_progress, comparison, history, interview, event_coverage, collection_tour, other)
2. Primary vehicle being featured (if any)
3. Any additional vehicles mentioned
4. Owner information if discussed
5. Key facts about vehicles

For each vehicle found, extract: year, make, model, trim, VIN (if mentioned), color, mileage, price (if mentioned), owner name, location, notable features, history notes.

Return JSON:
{
  "video_type": "review",
  "primary_vehicle": {
    "year": 1973,
    "make": "Porsche",
    "model": "911",
    "trim": "Carrera RS",
    "color": "Grand Prix White",
    "mileage": 45000,
    "notable_features": ["matching numbers", "sport seats"],
    "history_notes": "Originally delivered to Germany",
    "confidence": 0.95
  },
  "additional_vehicles": [],
  "owner_info": {
    "name": "John Doe",
    "location": "Los Angeles, CA",
    "collection_size": 15
  },
  "key_facts": ["Numbers matching", "3 owners from new"],
  "data_quality": "high"
}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert car enthusiast and data extractor. Extract vehicle information from YouTube video content. Be precise about years, makes, and models. Return only valid JSON.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      }),
    });

    if (!response.ok) {
      console.error('LLM analysis failed:', response.status);
      return {
        video_type: 'unknown',
        additional_vehicles: [],
        key_facts: [],
        data_quality: 'low'
      };
    }

    const llmData = await response.json();
    return JSON.parse(llmData.choices[0].message.content);

  } catch (e: any) {
    console.error('Error analyzing content:', e);
    return {
      video_type: 'unknown',
      additional_vehicles: [],
      key_facts: [],
      data_quality: 'low'
    };
  }
}

/**
 * Create a vehicle profile from a mention
 */
async function createVehicleFromMention(
  supabase: any,
  vehicle: VehicleMention,
  videoRecordId: string | null,
  videoData: any
): Promise<{ created: boolean; vehicle_id?: string }> {
  // Check for duplicates based on VIN or year/make/model combination
  if (vehicle.vin) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vehicle.vin)
      .single();

    if (existing) {
      console.log(`   Vehicle already exists (VIN): ${vehicle.vin}`);
      return { created: false };
    }
  }

  // Create vehicle profile
  const vehicleData = {
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim,
    vin: vehicle.vin,
    exterior_color: vehicle.color,
    mileage: vehicle.mileage,
    description: vehicle.history_notes,
    discovery_url: `https://www.youtube.com/watch?v=${videoData.id}`,
    discovery_source: 'youtube',
    data_quality_score: vehicle.confidence,
    is_complete: false,
    status: 'pending',
    metadata: {
      youtube_video_id: videoData.id,
      youtube_video_title: videoData.title,
      youtube_channel: videoData.channelTitle,
      notable_features: vehicle.notable_features,
      owner_name: vehicle.owner_name,
      owner_location: vehicle.location,
      extraction_confidence: vehicle.confidence
    }
  };

  const { data: created, error } = await supabase
    .from('vehicles')
    .insert(vehicleData)
    .select()
    .single();

  if (error) {
    console.error('   Error creating vehicle:', error);
    return { created: false };
  }

  console.log(`   Created vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`);

  // Link to video
  if (videoRecordId && created) {
    await supabase
      .from('youtube_videos')
      .update({ primary_vehicle_id: created.id })
      .eq('id', videoRecordId);
  }

  return { created: true, vehicle_id: created.id };
}

/**
 * Parse ISO 8601 duration to seconds
 */
function parseDuration(duration: string): number {
  if (!duration) return 0;

  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');

  return hours * 3600 + minutes * 60 + seconds;
}
