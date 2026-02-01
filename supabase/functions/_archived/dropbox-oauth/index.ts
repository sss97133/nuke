/**
 * Dropbox OAuth Handler
 * Step 1: Generate auth URL
 * Step 2: Handle callback and exchange code for token
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const DROPBOX_APP_KEY = Deno.env.get('DROPBOX_APP_KEY');
const DROPBOX_APP_SECRET = Deno.env.get('DROPBOX_APP_SECRET');
const REDIRECT_URI = 'https://n-zero.dev/dropbox/callback';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // STEP 1: Generate authorization URL
    if (action === 'authorize') {
      const { organizationId } = await req.json();
      
      // Store state for CSRF protection
      const state = crypto.randomUUID();
      
      // Store in database temporarily
      await supabase
        .from('dropbox_oauth_states')
        .insert({
          state,
          organization_id: organizationId,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 min
        });

      const authUrl = `https://www.dropbox.com/oauth2/authorize?` +
        `client_id=${DROPBOX_APP_KEY}&` +
        `response_type=code&` +
        `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
        `state=${state}&` +
        `token_access_type=offline`; // Get refresh token

      return new Response(
        JSON.stringify({ authUrl }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // STEP 2: Handle OAuth callback
    if (action === 'callback') {
      const { code, state } = await req.json();

      // Verify state
      const { data: stateData } = await supabase
        .from('dropbox_oauth_states')
        .select('organization_id')
        .eq('state', state)
        .gt('expires_at', new Date().toISOString())
        .single();

      if (!stateData) {
        throw new Error('Invalid or expired state');
      }

      // Exchange code for access token
      const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          grant_type: 'authorization_code',
          client_id: DROPBOX_APP_KEY!,
          client_secret: DROPBOX_APP_SECRET!,
          redirect_uri: REDIRECT_URI
        })
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        throw new Error(`Dropbox token exchange failed: ${error}`);
      }

      const tokens = await tokenResponse.json();

      // Store connection
      await supabase
        .from('dropbox_connections')
        .upsert({
          organization_id: stateData.organization_id,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          root_folder: '/Viva Inventory',
          auto_import_enabled: true
        });

      // Clean up state
      await supabase
        .from('dropbox_oauth_states')
        .delete()
        .eq('state', state);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    throw new Error('Invalid action');

  } catch (error: any) {
    console.error('Dropbox OAuth error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

