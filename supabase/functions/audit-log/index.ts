/**
 * AUDIT LOG API
 *
 * Secure audit entry creation and retrieval for compliance.
 *
 * POST /audit-log - Create audit entry
 * GET /audit-log?start_date=&end_date=&action_type= - Query entries
 * GET /audit-log/verify - Verify log integrity
 * GET /audit-log/export - Export for compliance review
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AuditLogEntry {
  action_type: string;
  user_id?: string;
  performed_by_user_id?: string;
  entity_type?: string;
  entity_id?: string;
  offering_id?: string;
  previous_state?: any;
  new_state?: any;
  action_description?: string;
  metadata?: any;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const action = pathParts[pathParts.length - 1];

    // Get client IP from headers
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0] ||
                     req.headers.get('x-real-ip') ||
                     'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // POST - Create audit entry
    if (req.method === "POST") {
      const body: AuditLogEntry = await req.json();

      if (!body.action_type) {
        return new Response(JSON.stringify({
          success: false,
          error: 'action_type is required'
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Create entry via RPC function
      const { data, error } = await supabase.rpc('create_audit_log_entry', {
        p_action_type: body.action_type,
        p_user_id: body.user_id || null,
        p_performed_by: body.performed_by_user_id || null,
        p_entity_type: body.entity_type || null,
        p_entity_id: body.entity_id || null,
        p_offering_id: body.offering_id || null,
        p_previous_state: body.previous_state || null,
        p_new_state: body.new_state || null,
        p_action_description: body.action_description || null,
        p_ip_address: clientIP,
        p_user_agent: userAgent,
        p_metadata: body.metadata || {}
      });

      if (error) throw error;

      return new Response(JSON.stringify({
        success: true,
        entry_id: data
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // GET - Query or verify
    if (req.method === "GET") {

      // Verify integrity
      if (action === 'verify') {
        const startDate = url.searchParams.get('start_date');
        const endDate = url.searchParams.get('end_date');

        const { data, error } = await supabase.rpc('verify_audit_log_integrity', {
          p_start_date: startDate || null,
          p_end_date: endDate || null
        });

        if (error) throw error;

        return new Response(JSON.stringify({
          success: true,
          integrity: data
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Export for compliance
      if (action === 'export') {
        const startDate = url.searchParams.get('start_date');
        const endDate = url.searchParams.get('end_date');
        const actionTypes = url.searchParams.get('action_types')?.split(',');
        const offeringId = url.searchParams.get('offering_id');

        if (!startDate || !endDate) {
          return new Response(JSON.stringify({
            success: false,
            error: 'start_date and end_date are required'
          }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const { data, error } = await supabase.rpc('export_audit_log', {
          p_start_date: startDate,
          p_end_date: endDate,
          p_action_types: actionTypes || null,
          p_offering_id: offeringId || null
        });

        if (error) throw error;

        return new Response(JSON.stringify({
          success: true,
          export: data
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      // Query entries
      const startDate = url.searchParams.get('start_date');
      const endDate = url.searchParams.get('end_date');
      const actionType = url.searchParams.get('action_type');
      const userId = url.searchParams.get('user_id');
      const entityType = url.searchParams.get('entity_type');
      const entityId = url.searchParams.get('entity_id');
      const limit = parseInt(url.searchParams.get('limit') || '100');
      const offset = parseInt(url.searchParams.get('offset') || '0');

      let query = supabase
        .from('compliance_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit)
        .range(offset, offset + limit - 1);

      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }
      if (actionType) {
        query = query.eq('action_type', actionType);
      }
      if (userId) {
        query = query.eq('user_id', userId);
      }
      if (entityType) {
        query = query.eq('entity_type', entityType);
      }
      if (entityId) {
        query = query.eq('entity_id', entityId);
      }

      const { data: entries, error, count } = await query;

      if (error) throw error;

      return new Response(JSON.stringify({
        success: true,
        entries: entries || [],
        pagination: {
          limit,
          offset,
          total: count
        }
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: 'Method not allowed'
    }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    console.error("Audit log error:", e);
    return new Response(JSON.stringify({
      success: false,
      error: e.message
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
