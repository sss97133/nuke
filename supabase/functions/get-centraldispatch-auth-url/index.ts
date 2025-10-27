/**
 * Get Central Dispatch OAuth Authorization URL
 * Used for admin setup to connect platform account
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const clientId = Deno.env.get('CENTRAL_DISPATCH_CLIENT_ID')
    const testMode = Deno.env.get('CENTRAL_DISPATCH_TEST_MODE') === 'true'
    
    if (!clientId) {
      return json({ 
        error: 'Central Dispatch not configured yet',
        message: 'Please wait for API credentials from Central Dispatch'
      }, 400)
    }

    // Build OAuth URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const redirectUri = `${supabaseUrl}/functions/v1/centraldispatch-oauth-callback`
    
    // Generate random state for CSRF protection
    const state = crypto.randomUUID()
    
    const authBaseUrl = testMode
      ? 'https://api-test.centraldispatch.com/oauth/authorize'
      : 'https://api.centraldispatch.com/oauth/authorize'
    
    const authUrl = new URL(authBaseUrl)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('scope', 'listings fulfillment') // Request necessary scopes

    return json({
      auth_url: authUrl.toString(),
      redirect_uri: redirectUri,
      test_mode: testMode
    })
  } catch (error) {
    console.error('Auth URL generation error:', error)
    return json({ error: error.message }, 500)
  }
})

