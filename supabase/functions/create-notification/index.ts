/**
 * CREATE NOTIFICATION
 * 
 * Simple function to create user notifications
 * Covers fundamental notification types
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateNotificationRequest {
  user_id: string
  notification_type: string
  title: string
  message?: string
  vehicle_id?: string
  image_id?: string
  organization_id?: string
  from_user_id?: string
  action_url?: string
  metadata?: any
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const notification: CreateNotificationRequest = await req.json()

    // Validate required fields
    if (!notification.user_id || !notification.notification_type || !notification.title) {
      throw new Error('Missing required fields: user_id, notification_type, title')
    }

    // Create notification using RPC function
    const { data, error } = await supabase.rpc('create_user_notification', {
      p_user_id: notification.user_id,
      p_notification_type: notification.notification_type,
      p_title: notification.title,
      p_message: notification.message || null,
      p_vehicle_id: notification.vehicle_id || null,
      p_image_id: notification.image_id || null,
      p_organization_id: notification.organization_id || null,
      p_from_user_id: notification.from_user_id || null,
      p_action_url: notification.action_url || null,
      p_metadata: notification.metadata || {}
    })

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, notification_id: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error creating notification:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

