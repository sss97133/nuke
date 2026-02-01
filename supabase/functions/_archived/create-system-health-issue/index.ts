/**
 * CREATE SYSTEM HEALTH ISSUE
 * 
 * Helper function to create system health issues from various sources:
 * - RLS violations
 * - AI errors
 * - Duplicate detection
 * - Image/vehicle mismatches
 * - Data quality issues
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateIssueRequest {
  issue_type: 'rls_violation' | 'ai_confusion' | 'duplicate_vehicle' | 'duplicate_image' | 'image_vehicle_mismatch' | 'org_vehicle_mismatch' | 'data_quality' | 'validation_error' | 'ai_error' | 'scraper_error' | 'import_error'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description?: string
  error_message?: string
  error_code?: string
  vehicle_id?: string
  image_id?: string
  organization_id?: string
  document_id?: string
  context_data?: any
  suggested_fix?: string
  fix_action?: any
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const issue: CreateIssueRequest = await req.json()

    // Validate required fields
    if (!issue.issue_type || !issue.severity || !issue.title) {
      throw new Error('Missing required fields: issue_type, severity, title')
    }

    // Create issue using RPC function
    const { data, error } = await supabase.rpc('create_system_health_issue', {
      p_issue_type: issue.issue_type,
      p_severity: issue.severity,
      p_title: issue.title,
      p_description: issue.description || null,
      p_vehicle_id: issue.vehicle_id || null,
      p_image_id: issue.image_id || null,
      p_organization_id: issue.organization_id || null,
      p_context_data: issue.context_data || {},
      p_suggested_fix: issue.suggested_fix || null,
      p_fix_action: issue.fix_action || null
    })

    if (error) throw error

    return new Response(
      JSON.stringify({ success: true, issue_id: data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    console.error('Error creating system health issue:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

