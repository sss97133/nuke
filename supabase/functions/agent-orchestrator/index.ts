import "jsr:@supabase/functions-js/edge-runtime.d.ts";

interface AgentTask {
  agent: string;
  action: string;
  params: Record<string, any>;
  priority: 'low' | 'medium' | 'high' | 'critical';
  max_retries?: number;
}

interface AgentResponse {
  agent: string;
  action: string;
  success: boolean;
  data?: any;
  error?: string;
  duration_ms: number;
  recommendations?: string[];
}

interface ScaleMetrics {
  profiles_per_hour: number;
  extraction_success_rate: number;
  analysis_completion_rate: number;
  pipeline_health_score: number;
  bottlenecks: string[];
}

/**
 * AGENT ORCHESTRATOR
 * 
 * Coordinates all pipeline agents for 33k+ profiles/day scale
 * Can be invoked by Claude or automated systems
 * Handles agent coordination, monitoring, and scale optimization
 */
const AVAILABLE_AGENTS = {
  'source-sourcing': 'agent-source-sourcing',
  'extraction-planning': 'agent-extraction-planning', 
  'pipeline-reliability': 'agent-pipeline-reliability',
  'facebook-marketplace': 'agent-facebook-marketplace',
  'firecrawl-optimization': 'agent-firecrawl-optimization',
  'analysis-standards': 'agent-analysis-standards',
  'database-optimizer': 'agent-database-optimizer',
  'ui-agent': 'agent-ui',
  'debug-agent': 'agent-debug'
};

const SCALE_TARGETS = {
  daily_profiles: 33333,  // 1M in 30 days
  hourly_profiles: 1389,  // 33333 / 24
  extraction_success_rate: 0.95,
  analysis_completion_rate: 0.90,
  max_response_time_ms: 2000
};

Deno.serve(async (req) => {
  try {
    const { action, agents, params = {}, scale_check = true } = await req.json();
    
    switch (action) {
      case 'status':
        return await getAgentStatus();
      
      case 'scale_metrics':
        return await getScaleMetrics();
      
      case 'invoke_agent':
        return await invokeAgent(params.agent, params.agent_action, params.agent_params);
      
      case 'invoke_multiple':
        return await invokeMultipleAgents(agents);
      
      case 'scale_optimization':
        return await optimizeForScale();
      
      case 'emergency_debug':
        return await emergencyDebug();
      
      case 'daily_pipeline_run':
        return await runDailyPipeline(params);
      
      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
    }
  } catch (error) {
    console.error('Orchestrator error:', error);
    return new Response(JSON.stringify({ 
      error: error.message,
      timestamp: new Date().toISOString()
    }), { status: 500 });
  }
});

async function getAgentStatus() {
  const status = {};
  
  for (const [agentName, functionName] of Object.entries(AVAILABLE_AGENTS)) {
    try {
      const response = await callAgent(functionName, 'health_check', {});
      status[agentName] = {
        status: response.success ? 'healthy' : 'unhealthy',
        last_response_ms: response.duration_ms,
        details: response.data
      };
    } catch (error) {
      status[agentName] = {
        status: 'error',
        error: error.message
      };
    }
  }
  
  return new Response(JSON.stringify({
    agents: status,
    overall_health: Object.values(status).filter((s: any) => s.status === 'healthy').length / Object.keys(status).length,
    timestamp: new Date().toISOString()
  }));
}

async function getScaleMetrics(): Promise<Response> {
  try {
    // Get recent extraction metrics
    const debugResponse = await callAgent('agent-debug', 'get_pipeline_metrics', {
      time_range: '1h'
    });
    
    const metrics: ScaleMetrics = {
      profiles_per_hour: debugResponse.data?.profiles_created_last_hour || 0,
      extraction_success_rate: debugResponse.data?.extraction_success_rate || 0,
      analysis_completion_rate: debugResponse.data?.analysis_completion_rate || 0,
      pipeline_health_score: debugResponse.data?.overall_health_score || 0,
      bottlenecks: debugResponse.data?.bottlenecks || []
    };
    
    // Calculate if we're on track for 1M in 30 days
    const daily_rate = metrics.profiles_per_hour * 24;
    const projected_30_day = daily_rate * 30;
    const on_track = projected_30_day >= 1000000;
    
    return new Response(JSON.stringify({
      current_metrics: metrics,
      scale_targets: SCALE_TARGETS,
      performance: {
        daily_rate_current: daily_rate,
        daily_rate_target: SCALE_TARGETS.daily_profiles,
        on_track_for_1m: on_track,
        projected_30_day_total: projected_30_day,
        efficiency_score: daily_rate / SCALE_TARGETS.daily_profiles
      },
      recommendations: generateScaleRecommendations(metrics, daily_rate)
    }));
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

async function invokeAgent(agent: string, action: string, params: any): Promise<Response> {
  const functionName = AVAILABLE_AGENTS[agent];
  if (!functionName) {
    return new Response(JSON.stringify({ error: `Unknown agent: ${agent}` }), { status: 400 });
  }
  
  try {
    const response = await callAgent(functionName, action, params);
    return new Response(JSON.stringify(response));
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: error.message,
      agent,
      action 
    }), { status: 500 });
  }
}

async function invokeMultipleAgents(tasks: AgentTask[]): Promise<Response> {
  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      const functionName = AVAILABLE_AGENTS[task.agent];
      if (!functionName) throw new Error(`Unknown agent: ${task.agent}`);
      
      return await callAgent(functionName, task.action, task.params);
    })
  );
  
  const responses = results.map((result, index) => ({
    agent: tasks[index].agent,
    action: tasks[index].action,
    success: result.status === 'fulfilled',
    ...(result.status === 'fulfilled' ? { data: result.value } : { error: result.reason?.message })
  }));
  
  return new Response(JSON.stringify({
    total_agents: tasks.length,
    successful: responses.filter(r => r.success).length,
    failed: responses.filter(r => !r.success).length,
    results: responses
  }));
}

async function optimizeForScale(): Promise<Response> {
  console.log('Running scale optimization...');
  
  // Get current metrics
  const metricsResponse = await getScaleMetrics();
  const metrics = await metricsResponse.json();
  
  // Run optimizations across agents
  const optimizations = await Promise.allSettled([
    // Database optimizer: tune for high-volume inserts
    callAgent('agent-database-optimizer', 'optimize_for_scale', {
      target_daily_profiles: SCALE_TARGETS.daily_profiles
    }),
    
    // Firecrawl optimizer: batch requests, tune concurrency
    callAgent('agent-firecrawl-optimization', 'scale_optimization', {
      target_hourly_requests: SCALE_TARGETS.hourly_profiles * 5 // assume 5 requests per profile
    }),
    
    // Pipeline reliability: increase monitoring frequency
    callAgent('agent-pipeline-reliability', 'scale_mode', {
      enable_high_frequency_monitoring: true,
      auto_scaling: true
    })
  ]);
  
  return new Response(JSON.stringify({
    optimization_results: optimizations.map((result, index) => ({
      agent: ['database-optimizer', 'firecrawl-optimization', 'pipeline-reliability'][index],
      success: result.status === 'fulfilled',
      ...(result.status === 'fulfilled' ? { data: result.value } : { error: result.reason?.message })
    })),
    current_metrics: metrics,
    timestamp: new Date().toISOString()
  }));
}

async function emergencyDebug(): Promise<Response> {
  console.log('Running emergency debug...');
  
  try {
    const debugResponse = await callAgent('agent-debug', 'emergency_diagnostic', {
      check_all_systems: true,
      include_performance_analysis: true,
      check_scale_bottlenecks: true
    });
    
    return new Response(JSON.stringify({
      emergency_status: debugResponse.data,
      recommended_actions: debugResponse.recommendations || [],
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    return new Response(JSON.stringify({ 
      error: `Emergency debug failed: ${error.message}`,
      fallback_diagnostics: await getFallbackDiagnostics()
    }), { status: 500 });
  }
}

async function runDailyPipeline(params: any): Promise<Response> {
  console.log('Running daily pipeline for scale...');
  
  const pipelineSteps = [
    // 1. Source discovery and planning
    { agent: 'source-sourcing', action: 'discover_new_sources', params: { max_sources: 50 } },
    { agent: 'extraction-planning', action: 'update_all_plans', params: { priority_sources: true } },
    
    // 2. Scale up extraction
    { agent: 'firecrawl-optimization', action: 'batch_extract', params: { 
      target_profiles: SCALE_TARGETS.daily_profiles,
      batch_size: 100,
      parallel_workers: 20
    }},
    
    // 3. Analysis and optimization
    { agent: 'analysis-standards', action: 'bulk_analysis', params: { 
      max_concurrent: 50,
      quality_threshold: 0.9
    }},
    { agent: 'database-optimizer', action: 'daily_optimization', params: {} },
    
    // 4. Monitor and report
    { agent: 'pipeline-reliability', action: 'daily_health_report', params: {} },
    { agent: 'debug-agent', action: 'generate_scale_report', params: {} }
  ];
  
  const results = [];
  
  for (const step of pipelineSteps) {
    try {
      console.log(`Running ${step.agent}: ${step.action}`);
      const result = await callAgent(AVAILABLE_AGENTS[step.agent], step.action, step.params);
      results.push({
        agent: step.agent,
        action: step.action,
        success: result.success,
        duration_ms: result.duration_ms,
        data: result.data
      });
      
      // If critical step fails, abort pipeline
      if (!result.success && ['firecrawl-optimization', 'database-optimizer'].includes(step.agent)) {
        throw new Error(`Critical step failed: ${step.agent}`);
      }
    } catch (error) {
      results.push({
        agent: step.agent,
        action: step.action,
        success: false,
        error: error.message
      });
    }
  }
  
  const finalMetrics = await getScaleMetrics();
  
  return new Response(JSON.stringify({
    pipeline_results: results,
    total_steps: pipelineSteps.length,
    successful_steps: results.filter(r => r.success).length,
    final_metrics: await finalMetrics.json(),
    timestamp: new Date().toISOString()
  }));
}

async function callAgent(functionName: string, action: string, params: any): Promise<AgentResponse> {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`https://your-project.supabase.co/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ action, params })
    });
    
    const data = await response.json();
    const duration = Date.now() - startTime;
    
    return {
      agent: functionName,
      action,
      success: response.ok,
      data: data,
      duration_ms: duration,
      recommendations: data.recommendations
    };
  } catch (error) {
    return {
      agent: functionName,
      action,
      success: false,
      error: error.message,
      duration_ms: Date.now() - startTime
    };
  }
}

function generateScaleRecommendations(metrics: ScaleMetrics, currentDailyRate: number): string[] {
  const recommendations = [];
  
  if (currentDailyRate < SCALE_TARGETS.daily_profiles * 0.5) {
    recommendations.push("CRITICAL: Profile creation rate is <50% of target. Increase parallel workers and optimize extraction.");
  }
  
  if (metrics.extraction_success_rate < 0.9) {
    recommendations.push("Extraction success rate is low. Review source reliability and error handling.");
  }
  
  if (metrics.analysis_completion_rate < 0.85) {
    recommendations.push("Analysis completion rate is low. Consider optimizing AI analysis prompts and timeouts.");
  }
  
  if (metrics.bottlenecks.includes('database')) {
    recommendations.push("Database bottleneck detected. Run database optimizer with scale settings.");
  }
  
  if (metrics.bottlenecks.includes('firecrawl')) {
    recommendations.push("Firecrawl bottleneck detected. Increase concurrency and implement request batching.");
  }
  
  return recommendations;
}

async function getFallbackDiagnostics(): Promise<any> {
  // Basic diagnostics when debug agent fails
  return {
    timestamp: new Date().toISOString(),
    available_agents: Object.keys(AVAILABLE_AGENTS),
    scale_targets: SCALE_TARGETS,
    note: "Debug agent unavailable - using fallback diagnostics"
  };
}
