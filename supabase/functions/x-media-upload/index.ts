/**
 * X Media Upload
 *
 * Uploads images to X for use in tweets.
 * Uses chunked upload for reliability.
 *
 * X API v2 tweets can reference media uploaded via v1.1 endpoint.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UploadRequest {
  user_id: string;
  image_url: string;  // URL to fetch image from
  alt_text?: string;  // Accessibility text
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: UploadRequest = await req.json();
    const { user_id, image_url, alt_text } = body;

    if (!user_id || !image_url) {
      return new Response(
        JSON.stringify({ error: 'user_id and image_url required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get X credentials
    const { data: identity, error: identityError } = await supabase
      .from('external_identities')
      .select('id, handle, metadata')
      .eq('platform', 'x')
      .eq('claimed_by_user_id', user_id)
      .maybeSingle();

    if (identityError || !identity) {
      return new Response(
        JSON.stringify({ error: 'X account not connected' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metadata = identity.metadata as any;
    let accessToken = metadata?.access_token;

    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'No access token - reconnect X account' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check token expiry and refresh if needed
    const tokenExpiry = new Date(metadata.token_expires_at || 0);
    if (tokenExpiry < new Date()) {
      accessToken = await refreshToken(identity.id, metadata.refresh_token, supabase);
    }

    // Fetch the image
    console.log(`[x-media-upload] Fetching image from ${image_url}`);
    const imageResponse = await fetch(image_url);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBytes = new Uint8Array(imageBuffer);
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';

    // Determine media category
    let mediaCategory = 'tweet_image';
    if (contentType.includes('gif')) {
      mediaCategory = 'tweet_gif';
    } else if (contentType.includes('video')) {
      mediaCategory = 'tweet_video';
    }

    // INIT - Initialize upload
    const initResponse = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        command: 'INIT',
        total_bytes: imageBytes.length.toString(),
        media_type: contentType,
        media_category: mediaCategory,
      }),
    });

    if (!initResponse.ok) {
      const errorText = await initResponse.text();
      throw new Error(`INIT failed: ${errorText}`);
    }

    const initData = await initResponse.json();
    const mediaId = initData.media_id_string;

    console.log(`[x-media-upload] Initialized upload, media_id: ${mediaId}`);

    // APPEND - Upload chunks (for images under 5MB, single chunk is fine)
    const base64Image = btoa(String.fromCharCode(...imageBytes));

    const appendResponse = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        command: 'APPEND',
        media_id: mediaId,
        media_data: base64Image,
        segment_index: '0',
      }),
    });

    if (!appendResponse.ok) {
      const errorText = await appendResponse.text();
      throw new Error(`APPEND failed: ${errorText}`);
    }

    console.log(`[x-media-upload] Appended image data`);

    // FINALIZE - Complete upload
    const finalizeResponse = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        command: 'FINALIZE',
        media_id: mediaId,
      }),
    });

    if (!finalizeResponse.ok) {
      const errorText = await finalizeResponse.text();
      throw new Error(`FINALIZE failed: ${errorText}`);
    }

    const finalizeData = await finalizeResponse.json();
    console.log(`[x-media-upload] Finalized upload`);

    // Add alt text if provided
    if (alt_text) {
      await fetch('https://upload.twitter.com/1.1/media/metadata/create.json', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          media_id: mediaId,
          alt_text: { text: alt_text }
        }),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        media_id: mediaId,
        media_key: finalizeData.media_key,
        size: imageBytes.length,
        type: contentType
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[x-media-upload] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function refreshToken(identityId: string, refreshToken: string, supabase: any): Promise<string> {
  const X_CLIENT_ID = Deno.env.get('X_CLIENT_ID');
  const X_CLIENT_SECRET = Deno.env.get('X_CLIENT_SECRET');

  if (!X_CLIENT_ID || !X_CLIENT_SECRET) {
    throw new Error('X API credentials not configured');
  }

  const response = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + btoa(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`)
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Token refresh failed: ${errorText}`);
  }

  const tokens = await response.json();
  const expiresIn = tokens.expires_in || 7200;

  // Update stored tokens
  const { error: updateError } = await supabase
    .from('external_identities')
    .update({
      metadata: {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString()
      },
      updated_at: new Date().toISOString()
    })
    .eq('id', identityId);

  if (updateError) {
    console.warn('Failed to update tokens:', updateError.message);
  }

  return tokens.access_token;
}
