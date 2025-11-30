/**
 * Test analyze-image function for a specific image
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const imageId = '299014ca-4adc-43e6-880e-7697f2480661'

async function testAnalyze() {
  // Get image details
  const { data: image, error: fetchError } = await supabase
    .from('vehicle_images')
    .select('id, image_url, vehicle_id')
    .eq('id', imageId)
    .single()
  
  // Get user_id from vehicle if available
  let userId = null
  if (image?.vehicle_id) {
    const { data: vehicle } = await supabase
      .from('vehicles')
      .select('uploaded_by')
      .eq('id', image.vehicle_id)
      .maybeSingle()
    userId = vehicle?.uploaded_by || null
  }

  if (fetchError || !image) {
    console.error('Error fetching image:', fetchError)
    process.exit(1)
  }

  console.log('Testing analyze-image for:', image.image_url)
  console.log('Vehicle ID:', image.vehicle_id)
  console.log('User ID:', userId)

  try {
    const { data, error } = await supabase.functions.invoke('analyze-image', {
      body: {
        image_url: image.image_url,
        vehicle_id: image.vehicle_id,
        timeline_event_id: null,
        user_id: userId
      }
    })

    if (error) {
      console.error('❌ Error:', error)
      console.error('Error details:', JSON.stringify(error, null, 2))
    } else {
      console.log('✅ Success:', JSON.stringify(data, null, 2))
    }
  } catch (err) {
    console.error('❌ Exception:', err)
    console.error('Stack:', err.stack)
  }
}

testAnalyze().catch(console.error)

