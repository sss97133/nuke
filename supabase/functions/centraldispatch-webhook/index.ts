/**
 * Central Dispatch Webhook Handler
 * Receives events from Central Dispatch (Premium Plan feature)
 * Events: carrier_assigned, pickup_scheduled, picked_up, in_transit, delivered
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
    const event = await req.json()
    console.log('Central Dispatch webhook received:', event)

    const { createClient } = await import('jsr:@supabase/supabase-js@2')
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('PROJECT_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl!, serviceKey!)

    const eventType = event.event_type || event.type
    const listingId = event.listing_id || event.data?.listing_id

    if (!listingId) {
      console.error('No listing_id in webhook event')
      return json({ received: true, warning: 'No listing_id found' })
    }

    // Find transaction by listing ID
    const { data: transaction, error: txError } = await supabase
      .from('vehicle_transactions')
      .select('*')
      .eq('shipping_listing_id', listingId)
      .single()

    if (txError || !transaction) {
      console.error('Transaction not found for listing:', listingId)
      return json({ received: true, warning: 'Transaction not found' })
    }

    // Log event
    await supabase.from('shipping_events').insert({
      transaction_id: transaction.id,
      listing_id: listingId,
      event_type: eventType,
      event_data: event.data || event,
      carrier_info: event.carrier || event.data?.carrier
    })

    // Handle different event types
    switch (eventType) {
      case 'carrier.assigned':
      case 'carrier_assigned':
        await handleCarrierAssigned(supabase, transaction, event)
        break
      
      case 'dispatch.pickup_scheduled':
      case 'pickup_scheduled':
        await handlePickupScheduled(supabase, transaction, event)
        break
      
      case 'dispatch.picked_up':
      case 'picked_up':
        await handlePickedUp(supabase, transaction, event)
        break
      
      case 'dispatch.in_transit':
      case 'in_transit':
        await handleInTransit(supabase, transaction, event)
        break
      
      case 'dispatch.delivered':
      case 'delivered':
        await handleDelivered(supabase, transaction, event)
        break
      
      default:
        console.log('Unhandled event type:', eventType)
    }

    return json({ received: true, event_type: eventType })
  } catch (error) {
    console.error('Webhook error:', error)
    return json({ error: error.message }, 500)
  }
})

async function handleCarrierAssigned(supabase: any, transaction: any, event: any) {
  const carrier = event.carrier || event.data?.carrier

  await supabase
    .from('vehicle_transactions')
    .update({
      shipping_status: 'carrier_assigned',
      shipping_carrier_name: carrier?.name,
      shipping_carrier_phone: carrier?.phone,
      shipping_carrier_email: carrier?.email,
      shipping_actual_cost: event.data?.price || event.price
    })
    .eq('id', transaction.id)

  // Send SMS to buyer
  if (transaction.buyer_phone) {
    await supabase.functions.invoke('send-transaction-sms', {
      body: {
        transaction_id: transaction.id,
        notification_type: 'carrier_assigned',
        carrier_name: carrier?.name,
        carrier_phone: carrier?.phone
      }
    })
  }

  console.log('Carrier assigned:', carrier?.name)
}

async function handlePickupScheduled(supabase: any, transaction: any, event: any) {
  const pickupDate = event.data?.pickup_date || event.pickup_date

  await supabase
    .from('vehicle_transactions')
    .update({
      shipping_status: 'pickup_scheduled',
      shipping_pickup_date: pickupDate
    })
    .eq('id', transaction.id)

  console.log('Pickup scheduled:', pickupDate)
}

async function handlePickedUp(supabase: any, transaction: any, event: any) {
  await supabase
    .from('vehicle_transactions')
    .update({
      shipping_status: 'picked_up',
      metadata: {
        ...transaction.metadata,
        picked_up_at: new Date().toISOString()
      }
    })
    .eq('id', transaction.id)

  // Send SMS to buyer
  if (transaction.buyer_phone) {
    const deliveryDate = transaction.shipping_delivery_date || 'soon'
    await supabase.functions.invoke('send-transaction-sms', {
      body: {
        transaction_id: transaction.id,
        notification_type: 'picked_up',
        delivery_date: deliveryDate
      }
    })
  }

  console.log('Vehicle picked up')
}

async function handleInTransit(supabase: any, transaction: any, event: any) {
  await supabase
    .from('vehicle_transactions')
    .update({
      shipping_status: 'in_transit',
      shipping_tracking_url: event.data?.tracking_url || event.tracking_url
    })
    .eq('id', transaction.id)

  console.log('Vehicle in transit')
}

async function handleDelivered(supabase: any, transaction: any, event: any) {
  await supabase
    .from('vehicle_transactions')
    .update({
      shipping_status: 'delivered',
      status: 'completed',
      metadata: {
        ...transaction.metadata,
        delivered_at: new Date().toISOString()
      }
    })
    .eq('id', transaction.id)

  // Send SMS to buyer
  if (transaction.buyer_phone) {
    await supabase.functions.invoke('send-transaction-sms', {
      body: {
        transaction_id: transaction.id,
        notification_type: 'delivered'
      }
    })
  }

  // Transfer vehicle ownership
  if (transaction.vehicle_id) {
    await supabase
      .from('vehicles')
      .update({ user_id: transaction.buyer_id })
      .eq('id', transaction.vehicle_id)
  }

  console.log('Vehicle delivered - transaction complete!')
}

