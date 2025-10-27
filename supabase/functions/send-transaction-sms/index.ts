/**
 * Send SMS Notifications for Vehicle Transactions via Twilio
 * Body: { transaction_id: string, notification_type: 'sign_request' | 'completion' }
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

async function sendTwilioSMS(to: string, body: string): Promise<any> {
  const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
  const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
  const fromNumber = Deno.env.get('TWILIO_PHONE_NUMBER')

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('Twilio credentials not configured')
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
      Body: body
    })
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Twilio error: ${error}`)
  }

  return await response.json()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { transaction_id, notification_type, carrier_name, carrier_phone, delivery_date } = body

    if (!transaction_id || !notification_type) {
      return json({ error: 'transaction_id and notification_type required' }, 400)
    }

    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')
    if (!serviceKey) throw new Error('SERVICE_ROLE_KEY not configured')

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const supabase = createClient(supabaseUrl!, serviceKey)

    // Get transaction details
    const { data: transaction, error: txError } = await supabase
      .from('vehicle_transactions')
      .select(`
        *,
        buyer:buyer_id(id, email, raw_user_meta_data),
        seller:seller_id(id, email, raw_user_meta_data),
        vehicle:vehicles(year, make, model, vehicle_number)
      `)
      .eq('id', transaction_id)
      .single()

    if (txError || !transaction) {
      return json({ error: 'Transaction not found' }, 404)
    }

    const baseUrl = supabaseUrl.replace('supabase.co', 'vercel.app') || 'https://n-zero.dev'
    const vehicleName = `${transaction.vehicle?.year} ${transaction.vehicle?.make} ${transaction.vehicle?.model}`
    
    const results = []

    if (notification_type === 'carrier_assigned') {
      // Carrier assigned notification
      const carrierNameValue = carrier_name || 'A carrier'
      const carrierPhoneValue = carrier_phone || ''
      
      if (transaction.buyer_phone) {
        const message = `🚚 Carrier assigned for ${vehicleName}!\n\nCarrier: ${carrierNameValue}${carrierPhoneValue ? `\nPhone: ${carrierPhoneValue}` : ''}\n\nTrack at: ${baseUrl}/transaction/${transaction_id}\n\n-n-zero.dev`
        
        try {
          const twilioResponse = await sendTwilioSMS(transaction.buyer_phone, message)
          results.push({ recipient: 'buyer', status: 'sent', type: 'carrier_assigned', sid: twilioResponse.sid })
        } catch (error) {
          results.push({ recipient: 'buyer', status: 'failed', error: error.message })
        }
      }
    } else if (notification_type === 'picked_up') {
      // Vehicle picked up notification
      const deliveryDateValue = delivery_date || 'soon'
      
      if (transaction.buyer_phone) {
        const message = `✅ Your ${vehicleName} has been picked up!\n\nIn transit now. ETA: ${deliveryDateValue}\n\nTrack: ${baseUrl}/transaction/${transaction_id}\n\n-n-zero.dev`
        
        try {
          const twilioResponse = await sendTwilioSMS(transaction.buyer_phone, message)
          results.push({ recipient: 'buyer', status: 'sent', type: 'picked_up', sid: twilioResponse.sid })
        } catch (error) {
          results.push({ recipient: 'buyer', status: 'failed', error: error.message })
        }
      }
    } else if (notification_type === 'delivered') {
      // Vehicle delivered notification
      if (transaction.buyer_phone) {
        const message = `🎉 Your ${vehicleName} has been delivered!\n\nTransaction complete. Enjoy your vehicle!\n\nRate your experience: ${baseUrl}/transaction/${transaction_id}/review\n\n-n-zero.dev`
        
        try {
          const twilioResponse = await sendTwilioSMS(transaction.buyer_phone, message)
          results.push({ recipient: 'buyer', status: 'sent', type: 'delivered', sid: twilioResponse.sid })
        } catch (error) {
          results.push({ recipient: 'buyer', status: 'failed', error: error.message })
        }
      }
    } else if (notification_type === 'sign_request') {
      // SMS to buyer
      if (transaction.buyer_phone) {
        const buyerMessage = `🚗 Sign your purchase agreement for ${vehicleName}!\n\nView & sign: ${baseUrl}/sign/${transaction.buyer_sign_token}\n\n-n-zero.dev`
        
        try {
          const twilioResponse = await sendTwilioSMS(transaction.buyer_phone, buyerMessage)
          
          // Log notification
          await supabase.from('transaction_notifications').insert({
            transaction_id,
            recipient_type: 'buyer',
            notification_type: 'sign_request',
            phone_number: transaction.buyer_phone,
            message_body: buyerMessage,
            twilio_sid: twilioResponse.sid,
            status: 'sent'
          })

          // Update transaction
          await supabase
            .from('vehicle_transactions')
            .update({ buyer_sms_sent_at: new Date().toISOString() })
            .eq('id', transaction_id)

          results.push({ recipient: 'buyer', status: 'sent', sid: twilioResponse.sid })
        } catch (error) {
          console.error('Failed to send buyer SMS:', error)
          results.push({ recipient: 'buyer', status: 'failed', error: error.message })
        }
      }

      // SMS to seller
      if (transaction.seller_phone) {
        const sellerName = transaction.buyer?.raw_user_meta_data?.full_name || 'A buyer'
        const sellerMessage = `🚗 ${sellerName} wants to buy your ${vehicleName}!\n\nSign bill of sale: ${baseUrl}/sign/${transaction.seller_sign_token}\n\n-n-zero.dev`
        
        try {
          const twilioResponse = await sendTwilioSMS(transaction.seller_phone, sellerMessage)
          
          // Log notification
          await supabase.from('transaction_notifications').insert({
            transaction_id,
            recipient_type: 'seller',
            notification_type: 'sign_request',
            phone_number: transaction.seller_phone,
            message_body: sellerMessage,
            twilio_sid: twilioResponse.sid,
            status: 'sent'
          })

          // Update transaction
          await supabase
            .from('vehicle_transactions')
            .update({ seller_sms_sent_at: new Date().toISOString() })
            .eq('id', transaction_id)

          results.push({ recipient: 'seller', status: 'sent', sid: twilioResponse.sid })
        } catch (error) {
          console.error('Failed to send seller SMS:', error)
          results.push({ recipient: 'seller', status: 'failed', error: error.message })
        }
      }
    } else if (notification_type === 'completion') {
      // Both parties signed - send completion SMS
      const salePrice = transaction.sale_price.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
      
      // SMS to buyer
      if (transaction.buyer_phone) {
        const buyerMessage = `✅ All documents signed for ${vehicleName}!\n\nNext: Wire ${salePrice} to seller. Check your email for payment instructions.\n\n-n-zero.dev`
        
        try {
          await sendTwilioSMS(transaction.buyer_phone, buyerMessage)
          results.push({ recipient: 'buyer', status: 'sent', type: 'completion' })
        } catch (error) {
          console.error('Failed to send buyer completion SMS:', error)
          results.push({ recipient: 'buyer', status: 'failed', error: error.message })
        }
      }

      // SMS to seller
      if (transaction.seller_phone) {
        const sellerMessage = `✅ All documents signed for ${vehicleName}!\n\nBuyer will send ${salePrice}. Mark as paid in your dashboard once received.\n\n-n-zero.dev`
        
        try {
          await sendTwilioSMS(transaction.seller_phone, sellerMessage)
          results.push({ recipient: 'seller', status: 'sent', type: 'completion' })
        } catch (error) {
          console.error('Failed to send seller completion SMS:', error)
          results.push({ recipient: 'seller', status: 'failed', error: error.message })
        }
      }

      // Update transaction
      await supabase
        .from('vehicle_transactions')
        .update({ 
          completion_sms_sent_at: new Date().toISOString(),
          status: 'fully_signed'
        })
        .eq('id', transaction_id)
    }

    return json({
      success: true,
      transaction_id,
      notification_type,
      results
    })
  } catch (error) {
    console.error('SMS notification error:', error)
    return json({ error: error.message }, 500)
  }
})

