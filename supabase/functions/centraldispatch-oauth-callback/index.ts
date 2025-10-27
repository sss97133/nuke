/**
 * Central Dispatch OAuth Callback Handler
 * Receives authorization code and exchanges for access token
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error')

    if (error) {
      console.error('OAuth error:', error)
      return new Response(
        `<html><body><h1>Authorization Failed</h1><p>${error}</p></body></html>`,
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      )
    }

    if (!code) {
      return new Response(
        '<html><body><h1>Missing Authorization Code</h1></body></html>',
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      )
    }

    // Get OAuth credentials
    const clientId = Deno.env.get('CENTRAL_DISPATCH_CLIENT_ID')
    const clientSecret = Deno.env.get('CENTRAL_DISPATCH_CLIENT_SECRET')
    const tokenUrl = Deno.env.get('CENTRAL_DISPATCH_TOKEN_URL') || 'https://api.centraldispatch.com/oauth/token'
    const testMode = Deno.env.get('CENTRAL_DISPATCH_TEST_MODE') === 'true'

    if (!clientId || !clientSecret) {
      throw new Error('Central Dispatch credentials not configured')
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`)
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${url.origin}/functions/v1/centraldispatch-oauth-callback`
      })
    })

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text()
      console.error('Token exchange error:', errorText)
      throw new Error(`Token exchange failed: ${errorText}`)
    }

    const tokens = await tokenResponse.json()
    console.log('OAuth tokens received:', { ...tokens, access_token: '***', refresh_token: '***' })

    // Store tokens in Supabase (you'll need to manually add these as secrets)
    // For now, log them for manual storage
    console.log('='.repeat(60))
    console.log('CENTRAL DISPATCH TOKENS RECEIVED')
    console.log('Add these to Supabase secrets:')
    console.log(`supabase secrets set CENTRAL_DISPATCH_ACCESS_TOKEN="${tokens.access_token}"`)
    console.log(`supabase secrets set CENTRAL_DISPATCH_REFRESH_TOKEN="${tokens.refresh_token}"`)
    console.log(`supabase secrets set CENTRAL_DISPATCH_TOKEN_EXPIRES_AT="${Date.now() + (tokens.expires_in * 1000)}"`)
    console.log('='.repeat(60))

    // Store in database for later retrieval
    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl!, serviceKey!)

    // Create/update central dispatch connection record
    await supabase
      .from('platform_integrations')
      .upsert({
        integration_name: 'central_dispatch',
        status: 'connected',
        token_expires_at: new Date(Date.now() + (tokens.expires_in * 1000)).toISOString(),
        metadata: {
          test_mode: testMode,
          connected_at: new Date().toISOString(),
          token_type: tokens.token_type
        }
      }, {
        onConflict: 'integration_name'
      })

    // Redirect to success page
    const redirectUrl = testMode 
      ? `${url.origin}/admin/shipping-settings?connected=true&test_mode=true`
      : `${url.origin}/admin/shipping-settings?connected=true`

    return new Response(
      `<html>
        <head>
          <meta http-equiv="refresh" content="2;url=${redirectUrl}">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            h1 { color: #10b981; }
          </style>
        </head>
        <body>
          <h1>✅ Connected to Central Dispatch!</h1>
          <p>Redirecting to settings...</p>
          <p>If not redirected, <a href="${redirectUrl}">click here</a></p>
        </body>
      </html>`,
      { 
        status: 200, 
        headers: { 'Content-Type': 'text/html' } 
      }
    )
  } catch (error) {
    console.error('OAuth callback error:', error)
    return new Response(
      `<html><body><h1>OAuth Error</h1><p>${error.message}</p></body></html>`,
      { status: 500, headers: { 'Content-Type': 'text/html' } }
    )
  }
})

