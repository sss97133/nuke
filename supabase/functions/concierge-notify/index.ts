import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Human concierges - they review and confirm bookings
const CONCIERGE_TEAM = [
  { name: 'Jenny', phone: '+17029304818' },
  { name: 'Philippe', phone: '+33673313030' },
]

// Message templates
const MESSAGES = {
  // To guest - deposit received
  guest_deposit_received: (quote: any) => `L'Officiel Concierge ◈

Your deposit of $${quote.deposit_amount?.toLocaleString()} has been received.

We're now confirming your bookings:
${quote.request_summary}

Dates: ${quote.arrival_date} - ${quote.departure_date}

Our team will confirm each booking shortly.`,

  // To concierge team - new deposit, review needed
  concierge_new_booking: (quote: any, items: any[]) => {
    const itemList = items.map(i => `• ${i.service_name || i.name} (${i.service_type})`).join('\n')
    return `🔔 NEW DEPOSIT RECEIVED

Guest: ${quote.guest_name || 'Guest'}
Phone: ${quote.guest_phone || 'Not provided'}
Email: ${quote.guest_email || 'Not provided'}

Deposit: $${quote.deposit_amount?.toLocaleString()}
Total: $${quote.total?.toLocaleString()}

Dates: ${quote.arrival_date} → ${quote.departure_date}
Guests: ${quote.guest_count}

REQUESTED BOOKINGS:
${itemList}

Reply CONFIRM to push bookings to partners.
Reply HOLD to pause.

Quote #${quote.id.slice(0, 8)}`
  },

  // To guest - booking confirmed
  guest_booking_confirmed: (quote: any, booking: any) => `L'Officiel Concierge ◈

✓ Confirmed: ${booking.service_name}
Date: ${booking.booking_date}
${booking.confirmation_number ? `Ref: ${booking.confirmation_number}` : ''}

Booked under: L'Officiel Concierge`,

  // To guest - quote ready
  guest_quote_ready: (quote: any) => `L'Officiel Concierge ◈

Your personalized quote is ready!

Total: $${quote.total?.toLocaleString()}
Deposit (30%): $${quote.deposit_amount?.toLocaleString()}

View & pay: https://lofficiel-concierge.vercel.app/quote/${quote.id}`,
}

async function sendSMS(to: string, message: string) {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!accountSid || !authToken || !fromNumber || accountSid.startsWith('your-')) {
    console.log('Twilio not configured, logging message instead:')
    console.log(`TO: ${to}`)
    console.log(`MESSAGE: ${message}`)
    return { success: false, reason: 'not_configured', logged: true }
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

    const { quote_id, type, booking_id } = await req.json()

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

        // 1. Notify guest
        if (quote.guest_phone) {
          const guestResult = await sendSMS(
            quote.guest_phone,
            MESSAGES.guest_deposit_received(quote)
          )
          results.guest_sms = guestResult
        }

        // 2. Notify concierge team (Jenny & Philippe)
        const conciergeMessage = MESSAGES.concierge_new_booking(quote, items || [])
        results.concierge_sms = []

        for (const concierge of CONCIERGE_TEAM) {
          const result = await sendSMS(concierge.phone, conciergeMessage)
          results.concierge_sms.push({
            name: concierge.name,
            phone: concierge.phone,
            ...result,
          })
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

        // 4. Log for audit
        await supabase
          .from('concierge_activity_log')
          .insert({
            quote_id,
            action: 'deposit_received',
            details: {
              amount: quote.deposit_amount,
              guest_notified: !!quote.guest_phone,
              concierge_notified: CONCIERGE_TEAM.map(c => c.name),
            },
          })
          .catch(() => {}) // Ignore if table doesn't exist

        break
      }

      case 'booking_confirmed': {
        const { data: booking } = await supabase
          .from('concierge_bookings')
          .select('*')
          .eq('id', booking_id)
          .single()

        if (quote.guest_phone && booking) {
          results.guest_sms = await sendSMS(
            quote.guest_phone,
            MESSAGES.guest_booking_confirmed(quote, booking)
          )
        }
        break
      }

      case 'quote_ready': {
        if (quote.guest_phone) {
          results.guest_sms = await sendSMS(
            quote.guest_phone,
            MESSAGES.guest_quote_ready(quote)
          )
        }
        break
      }

      case 'concierge_alert': {
        // Direct alert to concierge team
        const { message } = await req.json()
        results.concierge_sms = []

        for (const concierge of CONCIERGE_TEAM) {
          const result = await sendSMS(concierge.phone, message)
          results.concierge_sms.push({
            name: concierge.name,
            ...result,
          })
        }
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
