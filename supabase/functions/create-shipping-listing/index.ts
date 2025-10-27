/**
 * Create Central Dispatch Shipping Listing
 * Called after both parties sign transaction documents
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

// Map vehicle body types to Central Dispatch types
function mapVehicleType(bodyType?: string): string {
  const typeMap: Record<string, string> = {
    'sedan': 'SEDAN',
    'suv': 'SUV',
    'truck': 'PICKUP',
    'pickup': 'PICKUP',
    'van': 'VAN',
    'coupe': 'COUPE',
    'convertible': 'CONVERTIBLE',
    'wagon': 'WAGON',
    'hatchback': 'HATCHBACK',
  }
  
  const normalized = bodyType?.toLowerCase() || '';
  return typeMap[normalized] || 'OTHER';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')
    if (!serviceKey) throw new Error('SERVICE_ROLE_KEY not configured')

    const { transaction_id } = await req.json()
    if (!transaction_id) return json({ error: 'transaction_id required' }, 400)

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
        vehicle:vehicles(*)
      `)
      .eq('id', transaction_id)
      .single()

    if (txError || !transaction) {
      return json({ error: 'Transaction not found' }, 404)
    }

    // Check if both parties signed
    if (!transaction.buyer_signed_at || !transaction.seller_signed_at) {
      return json({ error: 'Both parties must sign before creating shipping listing' }, 400)
    }

    // Check if listing already created
    if (transaction.shipping_listing_id) {
      return json({ 
        success: true, 
        already_exists: true,
        listing_id: transaction.shipping_listing_id 
      })
    }

    // Get Central Dispatch credentials
    const cdClientId = Deno.env.get('CENTRAL_DISPATCH_CLIENT_ID')
    const cdClientSecret = Deno.env.get('CENTRAL_DISPATCH_CLIENT_SECRET')
    const cdAccessToken = Deno.env.get('CENTRAL_DISPATCH_ACCESS_TOKEN')
    const cdTestMode = Deno.env.get('CENTRAL_DISPATCH_TEST_MODE') === 'true'

    if (!cdAccessToken) {
      console.log('Central Dispatch not configured - storing as pending')
      
      // Mark as pending shipping (manual coordination required)
      await supabase
        .from('vehicle_transactions')
        .update({ 
          shipping_status: 'pending_manual',
          metadata: { 
            ...transaction.metadata,
            shipping_note: 'Central Dispatch not configured - manual coordination required'
          }
        })
        .eq('id', transaction_id)

      return json({ 
        success: true, 
        manual_required: true,
        message: 'Central Dispatch not configured - manual shipping coordination required'
      })
    }

    // Prepare addresses
    const pickupAddress = transaction.pickup_address || {
      city: transaction.seller?.raw_user_meta_data?.city || 'Unknown',
      state: transaction.seller?.raw_user_meta_data?.state || 'XX',
      zip: transaction.seller?.raw_user_meta_data?.zip || '00000'
    }

    const deliveryAddress = transaction.delivery_address || {
      city: transaction.buyer?.raw_user_meta_data?.city || 'Unknown',
      state: transaction.buyer?.raw_user_meta_data?.state || 'XX',
      zip: transaction.buyer?.raw_user_meta_data?.zip || '00000'
    }

    // Calculate pickup/delivery dates (pickup in 7 days, delivery 7 days after)
    const pickupDate = new Date()
    pickupDate.setDate(pickupDate.getDate() + 7)
    const deliveryDate = new Date(pickupDate)
    deliveryDate.setDate(deliveryDate.getDate() + 7)

    // Create Central Dispatch listing
    const cdApiUrl = cdTestMode 
      ? 'https://api-test.centraldispatch.com'
      : 'https://api.centraldispatch.com'

    const listingPayload = {
      origin: {
        city: pickupAddress.city,
        state: pickupAddress.state,
        zip: pickupAddress.zip
      },
      destination: {
        city: deliveryAddress.city,
        state: deliveryAddress.state,
        zip: deliveryAddress.zip
      },
      vehicles: [{
        year: transaction.vehicle?.year,
        make: transaction.vehicle?.make,
        model: transaction.vehicle?.model,
        type: mapVehicleType(transaction.vehicle?.body_type),
        inop: false,
        vin: transaction.vehicle?.vin || undefined
      }],
      pickup_date: pickupDate.toISOString().split('T')[0],
      delivery_date: deliveryDate.toISOString().split('T')[0],
      ship_via: 'OPEN', // Open transport (default)
      contact: {
        name: transaction.seller?.raw_user_meta_data?.full_name || 'Seller',
        phone: transaction.seller_phone,
        email: transaction.seller_email || transaction.seller?.email
      }
    }

    console.log('Creating Central Dispatch listing:', JSON.stringify(listingPayload, null, 2))

    const cdResponse = await fetch(`${cdApiUrl}/v2/listings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cdAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(listingPayload)
    })

    if (!cdResponse.ok) {
      const error = await cdResponse.text()
      console.error('Central Dispatch API error:', error)
      throw new Error(`Central Dispatch API error: ${error}`)
    }

    const listing = await cdResponse.json()
    console.log('Central Dispatch listing created:', listing)

    // Update transaction with listing info
    await supabase
      .from('vehicle_transactions')
      .update({
        shipping_listing_id: listing.id || listing.listing_id,
        shipping_status: 'listed',
        shipping_pickup_date: pickupDate.toISOString().split('T')[0],
        shipping_delivery_date: deliveryDate.toISOString().split('T')[0],
        pickup_address: pickupAddress,
        delivery_address: deliveryAddress
      })
      .eq('id', transaction_id)

    // Log shipping event
    await supabase.from('shipping_events').insert({
      transaction_id,
      listing_id: listing.id || listing.listing_id,
      event_type: 'listing_created',
      event_data: listing
    })

    return json({
      success: true,
      listing_id: listing.id || listing.listing_id,
      listing,
      pickup_date: pickupDate.toISOString().split('T')[0],
      delivery_date: deliveryDate.toISOString().split('T')[0]
    })
  } catch (error) {
    console.error('Shipping listing error:', error)
    return json({ error: error.message }, 500)
  }
})

