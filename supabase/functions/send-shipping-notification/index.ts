import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NotificationRequest {
  taskId: string
  message: string
  recipients: Array<{
    id: string
    recipient_name: string
    recipient_phone: string
    recipient_email: string
    notification_method: 'sms' | 'email' | 'both'
  }>
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get request body
    const { taskId, message, recipients } = await req.json() as NotificationRequest

    // Get Twilio credentials from environment
    const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID')
    const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')
    const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER')

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
      throw new Error('Twilio configuration missing')
    }

    const results = []

    // Send notifications to each recipient
    for (const recipient of recipients) {
      if (recipient.notification_method === 'sms' || recipient.notification_method === 'both') {
        try {
          // Send SMS via Twilio
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`
          
          const response = await fetch(twilioUrl, {
            method: 'POST',
            headers: {
              'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              To: recipient.recipient_phone,
              From: TWILIO_PHONE_NUMBER,
              Body: `Vehicle Shipping Update: ${message}`
            })
          })

          if (!response.ok) {
            const error = await response.text()
            console.error('Twilio error:', error)
            results.push({
              recipient: recipient.recipient_name,
              status: 'failed',
              error: error
            })
          } else {
            results.push({
              recipient: recipient.recipient_name,
              status: 'sent',
              method: 'sms'
            })
          }
        } catch (error) {
          console.error('SMS send error:', error)
          results.push({
            recipient: recipient.recipient_name,
            status: 'failed',
            error: error.message
          })
        }
      }

      // Email notifications could be added here using SendGrid or similar
      if (recipient.notification_method === 'email' || recipient.notification_method === 'both') {
        // For now, just log that we would send an email
        console.log(`Would send email to ${recipient.recipient_email}: ${message}`)
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        message: `Sent ${results.filter(r => r.status === 'sent').length} of ${recipients.length} notifications`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      }
    )
  }
})
