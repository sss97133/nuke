/**
 * REMOTE-AGENT
 *
 * Command & control via Supabase for portable machines.
 *
 * POST /remote-agent { action: "setup" } - Create tables
 * POST /remote-agent { action: "send", command: "..." } - Queue command
 * POST /remote-agent { action: "poll", machine_id: "..." } - Get pending commands
 * POST /remote-agent { action: "complete", id: "...", output: "..." } - Mark done
 * POST /remote-agent { action: "status" } - Get all recent commands
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const { action, command, machine_id = 'portable-1', id, output, error: cmdError } = await req.json()

    switch (action) {
      case 'setup': {
        // Create table if not exists
        const { error } = await supabase.rpc('exec_sql', {
          sql: `
            CREATE TABLE IF NOT EXISTS remote_commands (
              id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
              machine_id text NOT NULL DEFAULT 'portable-1',
              command text NOT NULL,
              status text DEFAULT 'pending',
              output text,
              error text,
              created_at timestamptz DEFAULT now(),
              executed_at timestamptz
            );
            CREATE INDEX IF NOT EXISTS idx_remote_commands_pending
            ON remote_commands(machine_id, status) WHERE status = 'pending';
          `
        })

        if (error && !error.message.includes('already exists')) {
          // Try direct insert to create table implicitly via API
          return new Response(JSON.stringify({
            success: false,
            error: error.message,
            hint: 'Table may need manual creation in Supabase dashboard'
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
        }

        return new Response(JSON.stringify({ success: true, message: 'Setup complete' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'send': {
        if (!command) {
          return new Response(JSON.stringify({ error: 'command required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const { data, error } = await supabase
          .from('remote_commands')
          .insert({ command, machine_id, status: 'pending' })
          .select()
          .single()

        if (error) throw error

        return new Response(JSON.stringify({ success: true, id: data.id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'poll': {
        const { data, error } = await supabase
          .from('remote_commands')
          .select('*')
          .eq('machine_id', machine_id)
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        if (error && error.code !== 'PGRST116') throw error

        return new Response(JSON.stringify({ command: data || null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'complete': {
        if (!id) {
          return new Response(JSON.stringify({ error: 'id required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          })
        }

        const { error } = await supabase
          .from('remote_commands')
          .update({
            status: 'completed',
            output,
            error: cmdError,
            executed_at: new Date().toISOString()
          })
          .eq('id', id)

        if (error) throw error

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      case 'status': {
        const { data, error } = await supabase
          .from('remote_commands')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)

        if (error) throw error

        return new Response(JSON.stringify({ commands: data }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
    }

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
