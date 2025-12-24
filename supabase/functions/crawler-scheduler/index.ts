/**
 * Crawler Scheduler & Queue Management
 * 
 * Manages the intelligent crawler queue with priority scheduling,
 * failure recovery, and adaptive rate limiting.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { 
      action = 'process_queue',
      batch_size = 10,
      priority_threshold = 5,
      concurrency = 2
    } = await req.json()
    
    console.log(`🎯 Crawler scheduler: ${action}`)
    
    let result
    
    switch (action) {
      case 'process_queue':
        result = await processScheduledCrawls(batch_size, priority_threshold, concurrency)
        break
        
      case 'health_check':
        result = await performHealthCheck()
        break
        
      case 'cleanup':
        result = await performCleanup()
        break
        
      case 'get_stats':
        result = await getCrawlerStatistics()
        break
        
      default:
        throw new Error(`Unknown action: ${action}`)
    }
    
    return new Response(JSON.stringify({
      success: true,
      action,
      result,
      processed_at: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
    
  } catch (error) {
    console.error('❌ Scheduler error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    })
  }
})

/**
 * Process scheduled crawls with intelligent prioritization
 */
async function processScheduledCrawls(batchSize: number, priorityThreshold: number, concurrency: number) {
  const safeBatchSize = Math.max(1, Math.min(Number(batchSize) || 10, 200))
  const safeConcurrency = Math.max(1, Math.min(Number(concurrency) || 2, 10))
  console.log(`🚀 Processing crawler queue (batch: ${safeBatchSize}, priority: ${priorityThreshold}+, concurrency: ${safeConcurrency})`)
  
  // Get pending crawls ordered by priority and age
  const { data: pendingCrawls, error } = await supabase
    .from('crawler_schedule')
    .select('*')
    .eq('is_active', true)
    .lte('next_run', new Date().toISOString())
    .gte('priority', priorityThreshold)
    .order('priority', { ascending: false })
    .order('next_run', { ascending: true })
    .limit(safeBatchSize)
  
  if (error || !pendingCrawls || pendingCrawls.length === 0) {
    return {
      processed_count: 0,
      message: 'No pending crawls found'
    }
  }
  
  console.log(`📋 Found ${pendingCrawls.length} pending crawls`)
  
  const results = []

  const processOne = async (crawl: any) => {
    try {
      console.log(`🕷️ Processing crawl for vehicle ${crawl.vehicle_id}`)
      
      const startTime = Date.now()
      
      // Execute the intelligent crawler
      const crawlResponse = await supabase.functions.invoke('intelligent-crawler', {
        body: {
          search_params: crawl.search_params,
          crawler_mode: 'comprehensive',
          force_refresh: true
        }
      })
      
      const executionTime = Date.now() - startTime
      
      if (crawlResponse.error) {
        throw new Error(crawlResponse.error.message)
      }
      
      // Update schedule for next run
      const nextRun = calculateNextRun(crawl.schedule_type)
      
      await supabase
        .from('crawler_schedule')
        .update({
          last_run: new Date().toISOString(),
          run_count: crawl.run_count + 1,
          next_run: nextRun,
          updated_at: new Date().toISOString()
        })
        .eq('id', crawl.id)
      
      // Log success
      await logCrawlExecution(crawl, true, executionTime, null)
      
      results.push({
        vehicle_id: crawl.vehicle_id,
        status: 'success',
        execution_time_ms: executionTime,
        listings_found: crawlResponse.data?.data?.total_listings || 0
      })
      
    } catch (error: any) {
      console.error(`❌ Crawl failed for vehicle ${crawl.vehicle_id}:`, error.message)
      
      // Log failure
      await logCrawlExecution(crawl, false, 0, error.message)
      
      // Implement exponential backoff for failed crawls
      const backoffDelay = Math.min(
        Math.pow(2, crawl.run_count || 0) * 60000, // Exponential backoff in minutes
        24 * 60 * 60 * 1000 // Max 24 hours
      )
      
      const nextRetry = new Date(Date.now() + backoffDelay).toISOString()
      
      await supabase
        .from('crawler_schedule')
        .update({
          next_run: nextRetry,
          updated_at: new Date().toISOString()
        })
        .eq('id', crawl.id)
      
      results.push({
        vehicle_id: crawl.vehicle_id,
        status: 'error',
        error: error.message,
        next_retry: nextRetry
      })
    }
  }

  const workerCount = Math.min(safeConcurrency, pendingCrawls.length)
  let nextIndex = 0
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const idx = nextIndex++
      if (idx >= pendingCrawls.length) break
      await processOne(pendingCrawls[idx])
    }
  })
  await Promise.all(workers)
  
  return {
    processed_count: results.length,
    successful_crawls: results.filter(r => r.status === 'success').length,
    failed_crawls: results.filter(r => r.status === 'error').length,
    results
  }
}

/**
 * Perform health check on crawler system
 */
async function performHealthCheck() {
  console.log('🏥 Performing crawler health check')
  
  // Check database connectivity
  const { data: dbTest } = await supabase
    .from('crawler_monitoring')
    .select('count')
    .limit(1)
  
  // Get recent performance metrics
  const { data: recentMetrics } = await supabase
    .from('crawler_monitoring')
    .select('*')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(100)
  
  // Analyze source health
  const sourceHealth = analyzeSourceHealth(recentMetrics || [])
  
  // Check queue status
  const { data: queueStatus } = await supabase
    .from('crawler_schedule')
    .select('*')
    .eq('is_active', true)
  
  const pendingCount = queueStatus?.filter(q => 
    new Date(q.next_run) <= new Date()
  ).length || 0
  
  const overdueCount = queueStatus?.filter(q => 
    new Date(q.next_run) < new Date(Date.now() - 60 * 60 * 1000) // 1 hour overdue
  ).length || 0
  
  // Overall health assessment
  const overallHealth = assessOverallHealth(sourceHealth, pendingCount, overdueCount)
  
  return {
    overall_health: overallHealth,
    database_connectivity: dbTest ? 'healthy' : 'unhealthy',
    source_health: sourceHealth,
    queue_status: {
      total_scheduled: queueStatus?.length || 0,
      pending_crawls: pendingCount,
      overdue_crawls: overdueCount
    },
    performance_metrics: calculatePerformanceMetrics(recentMetrics || []),
    recommendations: generateHealthRecommendations(sourceHealth, pendingCount, overdueCount)
  }
}

/**
 * Analyze health of individual crawler sources
 */
function analyzeSourceHealth(metrics: any[]) {
  const sourceGroups = new Map<string, any[]>()
  
  // Group metrics by source domain
  metrics.forEach(metric => {
    if (!sourceGroups.has(metric.source_domain)) {
      sourceGroups.set(metric.source_domain, [])
    }
    sourceGroups.get(metric.source_domain)!.push(metric)
  })
  
  const sourceHealth: any[] = []
  
  sourceGroups.forEach((domainMetrics, domain) => {
    const totalRequests = domainMetrics.length
    const successfulRequests = domainMetrics.filter(m => m.success).length
    const rateLimitedRequests = domainMetrics.filter(m => m.rate_limited).length
    const blockedRequests = domainMetrics.filter(m => m.blocked).length
    
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 0
    const avgResponseTime = domainMetrics.reduce((sum, m) => 
      sum + (m.response_time_ms || 0), 0
    ) / totalRequests
    
    let healthStatus = 'unknown'
    if (successRate >= 90) healthStatus = 'excellent'
    else if (successRate >= 70) healthStatus = 'good'
    else if (successRate >= 50) healthStatus = 'fair'
    else healthStatus = 'poor'
    
    sourceHealth.push({
      domain,
      health_status: healthStatus,
      success_rate: Math.round(successRate * 100) / 100,
      total_requests: totalRequests,
      rate_limited_requests: rateLimitedRequests,
      blocked_requests: blockedRequests,
      avg_response_time_ms: Math.round(avgResponseTime),
      last_request: domainMetrics[0]?.created_at
    })
  })
  
  return sourceHealth.sort((a, b) => b.success_rate - a.success_rate)
}

/**
 * Calculate performance metrics
 */
function calculatePerformanceMetrics(metrics: any[]) {
  if (metrics.length === 0) {
    return {
      total_requests: 0,
      overall_success_rate: 0,
      avg_response_time: 0
    }
  }
  
  const successfulRequests = metrics.filter(m => m.success).length
  const totalResponseTime = metrics.reduce((sum, m) => sum + (m.response_time_ms || 0), 0)
  
  return {
    total_requests: metrics.length,
    overall_success_rate: Math.round((successfulRequests / metrics.length) * 100 * 100) / 100,
    avg_response_time_ms: Math.round(totalResponseTime / metrics.length),
    rate_limited_percentage: Math.round((metrics.filter(m => m.rate_limited).length / metrics.length) * 100 * 100) / 100,
    blocked_percentage: Math.round((metrics.filter(m => m.blocked).length / metrics.length) * 100 * 100) / 100
  }
}

/**
 * Assess overall system health
 */
function assessOverallHealth(sourceHealth: any[], pendingCount: number, overdueCount: number) {
  const avgSuccessRate = sourceHealth.length > 0 ? 
    sourceHealth.reduce((sum, s) => sum + s.success_rate, 0) / sourceHealth.length : 0
  
  const healthySources = sourceHealth.filter(s => s.success_rate >= 70).length
  const totalSources = sourceHealth.length
  
  if (avgSuccessRate >= 85 && overdueCount === 0 && healthySources >= totalSources * 0.8) {
    return 'excellent'
  } else if (avgSuccessRate >= 70 && overdueCount < 5 && healthySources >= totalSources * 0.6) {
    return 'good'
  } else if (avgSuccessRate >= 50 && overdueCount < 20) {
    return 'fair'
  } else {
    return 'poor'
  }
}

/**
 * Generate health recommendations
 */
function generateHealthRecommendations(sourceHealth: any[], pendingCount: number, overdueCount: number) {
  const recommendations: string[] = []
  
  // Source-specific recommendations
  sourceHealth.forEach(source => {
    if (source.success_rate < 50) {
      recommendations.push(`${source.domain}: Success rate too low (${source.success_rate}%) - consider adjusting rate limits or user agents`)
    }
    
    if (source.blocked_requests > source.total_requests * 0.1) {
      recommendations.push(`${source.domain}: High block rate - implement better anti-detection measures`)
    }
    
    if (source.avg_response_time_ms > 10000) {
      recommendations.push(`${source.domain}: Slow response times - consider timeout adjustments`)
    }
  })
  
  // Queue recommendations
  if (overdueCount > 10) {
    recommendations.push(`${overdueCount} overdue crawls - consider increasing batch size or frequency`)
  }
  
  if (pendingCount > 50) {
    recommendations.push(`Large queue backlog (${pendingCount}) - consider scaling crawler resources`)
  }
  
  return recommendations
}

/**
 * Perform system cleanup
 */
async function performCleanup() {
  console.log('🧹 Performing crawler system cleanup')
  
  const { data: cleanupResult, error } = await supabase.rpc('cleanup_crawler_data')
  
  if (error) {
    throw error
  }
  
  return cleanupResult
}

/**
 * Get comprehensive crawler statistics
 */
async function getCrawlerStatistics() {
  const { data: stats, error } = await supabase.rpc('get_crawler_stats')
  
  if (error) {
    throw error
  }
  
  return stats
}

/**
 * Log crawler execution
 */
async function logCrawlExecution(crawl: any, success: boolean, executionTime: number, error: string | null) {
  await supabase.from('crawler_monitoring').insert({
    source_domain: 'scheduler',
    request_url: `vehicle_${crawl.vehicle_id}`,
    status_code: success ? 200 : 500,
    response_time_ms: executionTime,
    success,
    error_message: error,
    created_at: new Date().toISOString()
  })
}

/**
 * Calculate next run time based on schedule type
 */
function calculateNextRun(scheduleType: string): string {
  const now = new Date()
  
  switch (scheduleType) {
    case 'hourly':
      return new Date(now.getTime() + 60 * 60 * 1000).toISOString()
    case 'daily':
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    case 'weekly':
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
    default:
      return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  }
}