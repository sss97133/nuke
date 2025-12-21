import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WebhookRequest {
  object: string;
  entry: Array<{
    id: string;
    time: number;
    messaging?: Array<any>;
    changes?: Array<{
      value: {
        media_id?: string;
        comment_id?: string;
        [key: string]: any;
      };
      field: string;
    }>;
  }>;
}

serve(async (req) => {
  // Handle webhook verification (GET request)
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    const verifyToken = Deno.env.get('INSTAGRAM_WEBHOOK_VERIFY_TOKEN') || 'n-zero-webhook-token';

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('[process-instagram-webhook] Webhook verified');
      return new Response(challenge, { status: 200 });
    } else {
      return new Response('Forbidden', { status: 403 });
    }
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const webhookData: WebhookRequest = await req.json();

    console.log('[process-instagram-webhook] Received webhook:', JSON.stringify(webhookData));

    // Process each entry
    for (const entry of webhookData.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'media' && change.value.media_id) {
          // New media (post) created
          const mediaId = change.value.media_id;
          
          console.log(`[process-instagram-webhook] New media detected: ${mediaId}`);

          // Find organization that owns this Instagram account
          // We need to match the Instagram account ID to an organization
          // This could be stored in external_identities metadata
          const { data: identities } = await supabase
            .from('external_identities')
            .select('id, handle, metadata, claimed_by_user_id')
            .eq('platform', 'instagram')
            .not('metadata->instagram_account_id', 'is', null);

          // For now, we'll need to determine which organization this belongs to
          // In a production system, you'd store the webhook subscription ID
          // and map it to organizations
          
          // Process the new post
          // We'll trigger a sync for all organizations with Instagram accounts
          // In production, you'd have a mapping of webhook subscriptions to orgs
          
          for (const identity of identities || []) {
            const orgId = identity.metadata?.organization_id;
            if (orgId) {
              // Trigger sync for this specific post
              await supabase.functions.invoke('sync-instagram-organization', {
                body: {
                  organization_id: orgId,
                  instagram_handle: identity.handle,
                  instagram_account_id: identity.metadata?.instagram_account_id,
                  limit: 1 // Just sync this one post
                }
              });
            }
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[process-instagram-webhook] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

