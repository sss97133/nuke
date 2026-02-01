import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Message templates
const MESSAGES = {
  // To Telegram channel - new deposit
  telegram_new_booking: (quote: any, items: any[]) => {
    const itemList = items.length > 0
      ? items.map(i => `• ${i.service_name || i.name} (${i.service_type})`).join('\n')
      : '• Services to be confirmed'

    return `🔔 *NEW DEPOSIT RECEIVED*

👤 *Guest:* ${quote.guest_name || 'Guest'}
📞 ${quote.guest_phone || 'No phone'}
📧 ${quote.guest_email || 'No email'}

💰 *Deposit:* $${(quote.deposit_amount || 0).toLocaleString()}
💵 *Total:* $${(quote.total || 0).toLocaleString()}

📅 *Dates:* ${quote.arrival_date || 'TBD'} → ${quote.departure_date || 'TBD'}
👥 *Guests:* ${quote.guest_count || 'TBD'}

*REQUESTED BOOKINGS:*
${itemList}

_Reply to confirm with partners_

🔗 Quote #${(quote.id || '').slice(0, 8)}`
  },

  // Guest deposit confirmation
  guest_deposit_received: (quote: any) => `L'Officiel Concierge ◈

Your deposit of $${(quote.deposit_amount || 0).toLocaleString()} has been received.

We're now confirming your bookings.
Dates: ${quote.arrival_date} - ${quote.departure_date}

Our team will confirm each booking shortly.`,

  // Booking confirmed
  telegram_booking_confirmed: (booking: any) =>
    `✅ *CONFIRMED*: ${booking.service_name}\n📅 ${booking.booking_date}${booking.confirmation_number ? `\n🔖 Ref: ${booking.confirmation_number}` : ''}`,
}

async function sendTelegram(message: string, parseMode: string = 'Markdown') {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHANNEL_ID')

  if (!botToken || !chatId) {
    console.log('Telegram not configured')
    return { success: false, reason: 'not_configured' }
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
        }),
      }
    )

    const data = await response.json()

    if (!data.ok) {
      throw new Error(data.description || 'Telegram send failed')
    }

    return { success: true, message_id: data.result.message_id }
  } catch (error: any) {
    console.error('Telegram error:', error)
    return { success: false, error: error.message }
  }
}

async function sendSMS(to: string, message: string) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!accountSid || !authToken || !fromNumber || accountSid.startsWith('your-')) {
    console.log('Twilio not configured, skipping SMS')
    return { success: false, reason: 'not_configured' }
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const auth = btoa(`${accountSid}:${authToken}`)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: to,
        From: fromNumber,
        Body: message,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || 'SMS failed')
    }

    return { success: true, sid: data.sid }
  } catch (error: any) {
    console.error('SMS error:', error)
    return { success: false, error: error.message }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { quote_id, type, booking_id, message } = await req.json()

    // Handle direct message to channel
    if (type === 'direct') {
      const result = await sendTelegram(message, 'Markdown')
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get quote
    const { data: quote } = await supabase
      .from('concierge_quotes')
      .select('*')
      .eq('id', quote_id)
      .single()

    if (!quote) {
      return new Response(
        JSON.stringify({ error: 'Quote not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const results: any = { type, quote_id }

    switch (type) {
      case 'deposit_received': {
        // Get line items for this quote
        const { data: items } = await supabase
          .from('concierge_quote_items')
          .select('*')
          .eq('quote_id', quote_id)

        // 1. Send to Telegram channel (primary)
        const telegramMsg = MESSAGES.telegram_new_booking(quote, items || [])
        results.telegram = await sendTelegram(telegramMsg)

        // 2. Try SMS to guest if configured
        if (quote.guest_phone) {
          results.guest_sms = await sendSMS(
            quote.guest_phone,
            MESSAGES.guest_deposit_received(quote)
          )
        }

        // 3. Update quote status
        await supabase
          .from('concierge_quotes')
          .update({
            status: 'deposit_paid',
            deposit_paid_at: new Date().toISOString(),
            concierge_notified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', quote_id)

        break
      }

      case 'booking_confirmed': {
        const { data: booking } = await supabase
          .from('concierge_bookings')
          .select('*')
          .eq('id', booking_id)
          .single()

        if (booking) {
          results.telegram = await sendTelegram(
            MESSAGES.telegram_booking_confirmed(booking)
          )
        }
        break
      }

      case 'test': {
        // Test message
        results.telegram = await sendTelegram(
          `🧪 *Test from L'Officiel Concierge*\n\nNotifications are working!\n\n_${new Date().toISOString()}_`
        )
        break
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Unknown notification type' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }

    return new Response(
      JSON.stringify(results),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Notify error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
