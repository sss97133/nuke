import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface InstagramPost {
  id: string;
  media_type: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  media_url?: string;
  permalink: string;
  caption?: string;
  timestamp: string;
  thumbnail_url?: string;
  children?: { data: Array<{ id: string; media_url: string }> };
}

interface SyncRequest {
  organization_id: string;
  instagram_account_id?: string;
  instagram_handle?: string;
  limit?: number;
  since?: string; // ISO date string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const request: SyncRequest = await req.json();
    const { organization_id, instagram_account_id, instagram_handle, limit = 25, since } = request;

    if (!organization_id) {
      throw new Error('organization_id is required');
    }

    console.log(`[sync-instagram-organization] Starting sync for org: ${organization_id}`);

    // 1. Get or create external identity for Instagram
    let externalIdentityId: string | null = null;
    
    if (instagram_handle) {
      const { data: existingIdentity, error: identityError } = await supabase
        .from('external_identities')
        .select('id')
        .eq('platform', 'instagram')
        .eq('handle', instagram_handle.toLowerCase())
        .maybeSingle();

      if (identityError && identityError.code !== 'PGRST116') {
        throw identityError;
      }

      if (existingIdentity) {
        externalIdentityId = existingIdentity.id;
      } else {
        // Create new external identity
        const { data: newIdentity, error: createError } = await supabase
          .from('external_identities')
          .insert({
            platform: 'instagram',
            handle: instagram_handle.toLowerCase(),
            profile_url: `https://www.instagram.com/${instagram_handle}/`,
            display_name: instagram_handle,
            metadata: {
              instagram_account_id: instagram_account_id
            }
          })
          .select('id')
          .single();

        if (createError) throw createError;
        externalIdentityId = newIdentity.id;
      }
    }

    // 2. Get Instagram access token (from organization metadata or external_identities)
    // For now, we'll need to store this in external_identities.metadata or organization metadata
    const accessToken = Deno.env.get('INSTAGRAM_ACCESS_TOKEN'); // TODO: Get from org/external_identity
    if (!accessToken) {
      throw new Error('Instagram access token not configured. Set INSTAGRAM_ACCESS_TOKEN or store in organization metadata.');
    }

    // 3. Get Instagram Business Account ID
    let igAccountId = instagram_account_id;
    if (!igAccountId && instagram_handle) {
      // Try to get from external_identities metadata
      if (externalIdentityId) {
        const { data: identity } = await supabase
          .from('external_identities')
          .select('metadata')
          .eq('id', externalIdentityId)
          .single();
        
        igAccountId = identity?.metadata?.instagram_account_id;
      }
    }

    if (!igAccountId) {
      throw new Error('Instagram account ID required. Provide instagram_account_id or ensure it\'s in external_identities metadata.');
    }

    // 4. Fetch posts from Instagram Graph API
    const fields = 'id,media_type,media_url,permalink,caption,timestamp,thumbnail_url,children{id,media_url}';
    const url = `https://graph.instagram.com/${igAccountId}/media?fields=${fields}&limit=${limit}&access_token=${accessToken}${since ? `&since=${since}` : ''}`;

    console.log(`[sync-instagram-organization] Fetching posts from: ${url.replace(accessToken, 'TOKEN')}`);

    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Instagram API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const posts: InstagramPost[] = data.data || [];

    console.log(`[sync-instagram-organization] Fetched ${posts.length} posts`);

    // 5. Process each post
    const results = {
      processed: 0,
      created: 0,
      updated: 0,
      errors: [] as string[]
    };

    for (const post of posts) {
      try {
        // Download images to Supabase Storage
        const imageUrls: string[] = [];
        
        if (post.media_type === 'IMAGE' && post.media_url) {
          const imageUrl = await downloadImageToStorage(
            post.media_url,
            `organizations/${organization_id}/instagram/${post.id}`,
            supabase
          );
          if (imageUrl) imageUrls.push(imageUrl);
        } else if (post.media_type === 'CAROUSEL_ALBUM' && post.children?.data) {
          for (const child of post.children.data) {
            if (child.media_url) {
              const imageUrl = await downloadImageToStorage(
                child.media_url,
                `organizations/${organization_id}/instagram/${post.id}/${child.id}`,
                supabase
              );
              if (imageUrl) imageUrls.push(imageUrl);
            }
          }
        } else if (post.thumbnail_url) {
          // For videos, use thumbnail
          const imageUrl = await downloadImageToStorage(
            post.thumbnail_url,
            `organizations/${organization_id}/instagram/${post.id}/thumbnail`,
            supabase
          );
          if (imageUrl) imageUrls.push(imageUrl);
        }

        // Extract hashtags from caption
        const hashtags = post.caption?.match(/#\w+/g) || [];
        const mentions = post.caption?.match(/@\w+/g) || [];

        // Create or update user_content record
        const contentData = {
          organization_id: organization_id,
          external_identity_id: externalIdentityId,
          platform: 'instagram',
          content_type: post.media_type === 'CAROUSEL_ALBUM' ? 'reel' : post.media_type === 'VIDEO' ? 'video' : 'post',
          external_content_id: post.id,
          content_url: post.permalink,
          title: post.caption ? post.caption.substring(0, 200) : null,
          description: post.caption || null,
          thumbnail_url: imageUrls[0] || post.thumbnail_url || null,
          published_at: post.timestamp,
          metadata: {
            hashtags: hashtags,
            mentions: mentions,
            media_type: post.media_type,
            image_urls: imageUrls,
            instagram_post_id: post.id
          },
          status: 'pending_review' // Will be updated after vehicle detection
        };

        const { data: existingContent } = await supabase
          .from('user_content')
          .select('id')
          .eq('platform', 'instagram')
          .eq('external_content_id', post.id)
          .maybeSingle();

        let contentId: string;
        if (existingContent) {
          // Update existing
          const { data: updated, error: updateError } = await supabase
            .from('user_content')
            .update({
              ...contentData,
              last_synced_at: new Date().toISOString()
            })
            .eq('id', existingContent.id)
            .select('id')
            .single();

          if (updateError) throw updateError;
          contentId = updated.id;
          results.updated++;
        } else {
          // Create new
          const { data: created, error: createError } = await supabase
            .from('user_content')
            .insert(contentData)
            .select('id')
            .single();

          if (createError) throw createError;
          contentId = created.id;
          results.created++;
        }

        // 6. Queue for vehicle detection
        if (imageUrls.length > 0) {
          await supabase.functions.invoke('detect-vehicles-in-content', {
            body: {
              content_id: contentId,
              image_urls: imageUrls,
              organization_id: organization_id
            }
          });
        }

        results.processed++;
      } catch (error: any) {
        console.error(`[sync-instagram-organization] Error processing post ${post.id}:`, error);
        results.errors.push(`Post ${post.id}: ${error.message}`);
      }
    }

    console.log(`[sync-instagram-organization] Complete: ${results.processed} processed, ${results.created} created, ${results.updated} updated`);

    return new Response(
      JSON.stringify({
        success: true,
        results: results,
        next_cursor: data.paging?.cursors?.after || null
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[sync-instagram-organization] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function downloadImageToStorage(
  imageUrl: string,
  path: string,
  supabase: any
): Promise<string | null> {
  try {
    // Fetch image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      console.warn(`[sync-instagram-organization] Failed to fetch image: ${imageUrl}`);
      return null;
    }

    const imageBlob = await imageResponse.blob();
    const imageArrayBuffer = await imageBlob.arrayBuffer();
    const imageUint8Array = new Uint8Array(imageArrayBuffer);

    // Determine file extension
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const filePath = `${path}.${ext}`;

    // Upload to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('vehicle-images')
      .upload(filePath, imageUint8Array, {
        contentType: contentType,
        upsert: true
      });

    if (uploadError) {
      console.warn(`[sync-instagram-organization] Failed to upload image: ${uploadError.message}`);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('vehicle-images')
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error: any) {
    console.warn(`[sync-instagram-organization] Error downloading image: ${error.message}`);
    return null;
  }
}

