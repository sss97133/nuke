/**
 * X (Twitter) Post Function
 *
 * Posts content to X on behalf of authenticated users.
 * Handles token refresh automatically.
 *
 * Usage:
 *   POST /x-post
 *   {
 *     "user_id": "uuid",           // Who to post as (looks up their X credentials)
 *     "text": "The insight...",    // Tweet content (max 280 chars)
 *     "reply_to": "tweet_id",      // Optional: make it a reply
 *     "quote": "tweet_id"          // Optional: quote tweet
 *   }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const X_API_BASE = 'https://api.twitter.com/2';

interface PostRequest {
  user_id?: string;
  handle?: string;  // Alternative: post by handle
  text: string;
  reply_to?: string;
  quote?: string;
  media_ids?: string[];  // Pre-uploaded media IDs
  image_urls?: string[]; // URLs to upload and attach (convenience)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body: PostRequest = await req.json();
    const { user_id, handle, text, reply_to, quote, media_ids, image_urls } = body;

    if (!text || text.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'text is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (text.length > 280) {
      return new Response(
        JSON.stringify({ error: `Text too long: ${text.length} chars (max 280)` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Find the X credentials
    let query = supabase
      .from('external_identities')
      .select('id, handle, metadata')
      .eq('platform', 'x');

    if (user_id) {
      query = query.eq('claimed_by_user_id', user_id);
    } else if (handle) {
      query = query.eq('handle', handle.toLowerCase().replace('@', ''));
    } else {
      return new Response(
        JSON.stringify({ error: 'user_id or handle required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: identity, error: identityError } = await query.maybeSingle();

    if (identityError || !identity) {
      return new Response(
        JSON.stringify({ error: 'X account not connected', details: identityError?.message }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metadata = identity.metadata as any;
    if (!metadata?.access_token) {
      return new Response(
        JSON.stringify({ error: 'No access token found - reconnect X account' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if auto_post is enabled
    if (metadata.auto_post_enabled === false) {
      return new Response(
        JSON.stringify({ error: 'Auto-posting disabled for this account', handle: identity.handle }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let accessToken = metadata.access_token;

    // Check if token needs refresh
    const tokenExpiry = new Date(metadata.token_expires_at || 0);
    if (tokenExpiry < new Date()) {
      console.log(`[x-post] Token expired for @${identity.handle}, refreshing...`);
      accessToken = await refreshToken(identity.id, metadata.refresh_token, supabase);
    }

    // Handle media uploads if image_urls provided
    let finalMediaIds = media_ids || [];

    if (image_urls && image_urls.length > 0 && finalMediaIds.length === 0) {
      console.log(`[x-post] Uploading ${image_urls.length} images...`);
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      for (const imageUrl of image_urls.slice(0, 4)) { // X allows max 4 images
        try {
          const uploadResponse = await fetch(`${supabaseUrl}/functions/v1/x-media-upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${serviceKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              user_id: user_id || null,
              image_url: imageUrl
            })
          });

          const uploadData = await uploadResponse.json();
          if (uploadData.media_id) {
            finalMediaIds.push(uploadData.media_id);
            console.log(`[x-post] Uploaded media: ${uploadData.media_id}`);
          }
        } catch (uploadError: any) {
          console.warn(`[x-post] Failed to upload image: ${uploadError.message}`);
        }
      }
    }

    // Build tweet payload
    const tweetPayload: any = { text };

    if (finalMediaIds.length > 0) {
      tweetPayload.media = { media_ids: finalMediaIds };
    }

    if (reply_to) {
      tweetPayload.reply = { in_reply_to_tweet_id: reply_to };
    }

    if (quote) {
      tweetPayload.quote_tweet_id = quote;
    }

    // Post to X
    const postResponse = await fetch(`${X_API_BASE}/tweets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(tweetPayload)
    });

    if (!postResponse.ok) {
      const errorData = await postResponse.json().catch(() => ({}));

      // Handle token expiry mid-request
      if (postResponse.status === 401) {
        console.log(`[x-post] Got 401, attempting token refresh...`);
        accessToken = await refreshToken(identity.id, metadata.refresh_token, supabase);

        // Retry once
        const retryResponse = await fetch(`${X_API_BASE}/tweets`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(tweetPayload)
        });

        if (!retryResponse.ok) {
          const retryError = await retryResponse.json().catch(() => ({}));
          throw new Error(`Post failed after refresh: ${JSON.stringify(retryError)}`);
        }

        const retryData = await retryResponse.json();
        return new Response(
          JSON.stringify({
            success: true,
            tweet_id: retryData.data?.id,
            handle: identity.handle,
            text: text,
            url: `https://x.com/${identity.handle}/status/${retryData.data?.id}`
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      throw new Error(`Post failed: ${JSON.stringify(errorData)}`);
    }

    const postData = await postResponse.json();
    const tweetId = postData.data?.id;

    console.log(`[x-post] Posted tweet ${tweetId} for @${identity.handle}`);

    // Log the post
    const { error: logError } = await supabase.from('social_posts').insert({
      platform: 'x',
      external_identity_id: identity.id,
      post_id: tweetId,
      content: text,
      post_url: `https://x.com/${identity.handle}/status/${tweetId}`,
      posted_at: new Date().toISOString(),
      metadata: { reply_to, quote }
    });
    if (logError) console.warn('Failed to log post:', logError.message);

    return new Response(
      JSON.stringify({
        success: true,
        tweet_id: tweetId,
        handle: identity.handle,
        text: text,
        url: `https://x.com/${identity.handle}/status/${tweetId}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[x-post] Error:', error);
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

  // Get current metadata and merge with new tokens
  const { data: current } = await supabase
    .from('external_identities')
    .select('metadata')
    .eq('id', identityId)
    .single();

  const updatedMetadata = {
    ...(current?.metadata || {}),
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString()
  };

  await supabase
    .from('external_identities')
    .update({
      metadata: updatedMetadata,
      updated_at: new Date().toISOString()
    })
    .eq('id', identityId);

  return tokens.access_token;
}
