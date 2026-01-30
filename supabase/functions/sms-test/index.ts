/**
 * Simple SMS test - send a message to verify Twilio works
 * POST { "to": "+17026246793", "message": "Test!" }
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    })
  }

  try {
    const { to, message } = await req.json()

    const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
    const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')

    console.log('Twilio config:', {
      hasSid: !!accountSid,
      hasToken: !!authToken,
      hasFrom: !!fromNumber,
      fromNumber: fromNumber
    })

    if (!accountSid || !authToken || !fromNumber) {
      return new Response(JSON.stringify({
        error: 'Missing Twilio config',
        hasSid: !!accountSid,
        hasToken: !!authToken,
        hasFrom: !!fromNumber
      }), { status: 500 })
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: to,
        From: fromNumber,
        Body: message || 'Test from Nuke!'
      })
    })

    const result = await response.text()
    console.log('Twilio response:', response.status, result)

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: 'Twilio error',
        status: response.status,
        details: result
      }), { status: 500 })
    }

    return new Response(JSON.stringify({
      success: true,
      sid: JSON.parse(result).sid
    }))

  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})
