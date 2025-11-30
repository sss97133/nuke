/**
 * Create timeline event documenting image transfer
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

const targetVehicleId = '05f27cc4-914e-425a-8ed8-cfea35c1928d'
const sourceVehicleId = '89afcc13-febb-4a79-a4ad-533471c2062f'

async function createTimelineEvent() {
  // Get user ID (system user or first admin)
  const { data: users } = await supabase
    .from('profiles')
    .select('id')
    .limit(1)

  const userId = users?.[0]?.id || null

  // Create timeline event
  const { error } = await supabase
    .from('timeline_events')
    .insert({
      vehicle_id: targetVehicleId,
      user_id: userId,
      event_type: 'other',
      source: 'system',
      title: 'Image transferred from another vehicle profile',
      description: `Image was moved from vehicle profile ${sourceVehicleId} to this profile. The source vehicle had no other valuable data.`,
      event_date: new Date().toISOString().split('T')[0]
    })

  if (error) {
    console.error('Error creating timeline event:', error)
    process.exit(1)
  }

  console.log('✅ Timeline event created')
}

createTimelineEvent().catch(console.error)

