
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AgentAction {
  agentId: string;
  actionType: string;
  actionData: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get all active agents
    const { data: agents, error: agentsError } = await supabaseClient
      .from('ai_agents')
      .select('*')
      .eq('status', 'active')

    if (agentsError) throw agentsError

    const actions: AgentAction[] = []

    // Simulate actions for each agent
    for (const agent of agents) {
      const currentHour = new Date().getHours()
      const workingHours = agent.behavior_config.working_hours
      
      // Check if agent is within working hours
      if (currentHour >= workingHours.start && currentHour < workingHours.end) {
        switch (agent.agent_type) {
          case 'garage_owner':
            actions.push(...await simulateGarageOwnerActions(agent))
            break
          case 'service_provider':
            actions.push(...await simulateServiceProviderActions(agent))
            break
          case 'parts_dealer':
            actions.push(...await simulatePartsDealer(agent))
            break
        }
      }
    }

    // Record all actions
    for (const action of actions) {
      const { error: actionError } = await supabaseClient
        .from('agent_actions')
        .insert({
          agent_id: action.agentId,
          action_type: action.actionType,
          action_data: action.actionData,
          status: 'completed',
          completed_at: new Date().toISOString()
        })

      if (actionError) throw actionError
    }

    // Update agents' last_action_at timestamp
    const { error: updateError } = await supabaseClient
      .from('ai_agents')
      .update({ last_action_at: new Date().toISOString() })
      .eq('status', 'active')

    if (updateError) throw updateError

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `Simulated ${actions.length} actions for ${agents.length} agents` 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    )
  }
})

async function simulateGarageOwnerActions(agent: any): Promise<AgentAction[]> {
  const actions: AgentAction[] = []
  
  // Simulate creating service tickets
  if (Math.random() > 0.7) {
    actions.push({
      agentId: agent.id,
      actionType: 'create_service_ticket',
      actionData: {
        description: `${agent.name} service ticket - ${agent.behavior_config.specialties[0]}`,
        status: 'pending',
        priority: Math.random() > 0.5 ? 'high' : 'medium',
        service_type: agent.behavior_config.specialties[0]
      }
    })
  }

  // Simulate inventory updates
  if (Math.random() > 0.8) {
    actions.push({
      agentId: agent.id,
      actionType: 'update_inventory',
      actionData: {
        items: [
          {
            name: `${agent.behavior_config.specialties[0]} parts`,
            quantity: Math.floor(Math.random() * 10) + 1,
            category: agent.behavior_config.specialties[0]
          }
        ]
      }
    })
  }

  // Simulate feed posts
  if (Math.random() > 0.9) {
    actions.push({
      agentId: agent.id,
      actionType: 'create_feed_post',
      actionData: {
        content: `${agent.name} - New service available for ${agent.behavior_config.specialties[0]}!`,
        item_type: 'service_announcement'
      }
    })
  }

  return actions
}

async function simulateServiceProviderActions(agent: any): Promise<AgentAction[]> {
  const actions: AgentAction[] = []

  // Simulate updating service tickets
  if (Math.random() > 0.6) {
    actions.push({
      agentId: agent.id,
      actionType: 'update_service_ticket',
      actionData: {
        status: Math.random() > 0.5 ? 'in_progress' : 'completed',
        technician_notes: `Service performed by ${agent.name} - ${agent.behavior_config.specialties[0]}`
      }
    })
  }

  return actions
}

async function simulatePartsDealer(agent: any): Promise<AgentAction[]> {
  const actions: AgentAction[] = []

  // Simulate inventory updates
  if (Math.random() > 0.5) {
    actions.push({
      agentId: agent.id,
      actionType: 'update_inventory',
      actionData: {
        items: [
          {
            name: `${agent.behavior_config.specialties[0]} - New Stock`,
            quantity: Math.floor(Math.random() * 20) + 1,
            category: 'parts'
          }
        ]
      }
    })
  }

  return actions
}
