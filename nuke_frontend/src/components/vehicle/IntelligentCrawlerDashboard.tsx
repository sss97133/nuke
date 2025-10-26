/**
 * Intelligent Crawler Dashboard
 * 
 * Comprehensive monitoring and control interface for the intelligent crawler system
 */

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  Activity, 
  Database, 
  Globe, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle, 
  Clock,
  RefreshCw,
  BarChart3,
  Settings,
  Zap
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface CrawlerHealth {
  overall_health: string
  source_health: Array<{
    domain: string
    health_status: string
    success_rate: number
    total_requests: number
    rate_limited_requests: number
    blocked_requests: number
    avg_response_time_ms: number
    last_request: string
  }>
  cache_stats: {
    total_entries: number
    active_entries: number
    hit_rate: number
  }
  queue_stats: {
    pending_crawls: number
    scheduled_crawls: number
    total_runs: number
  }
}

interface CrawlerStats {
  cache_stats: {
    total_entries: number
    active_entries: number
    expired_entries: number
    total_hits: number
    cache_size_mb: number
  }
  crawl_stats: {
    total_crawls: number
    avg_listings_per_crawl: number
    avg_sources_per_crawl: number
    avg_execution_time_ms: number
    avg_success_rate: number
  }
  monitoring_stats: {
    total_requests: number
    success_rate: number
    rate_limited_rate: number
    blocked_rate: number
    avg_response_time: number
  }
  queue_stats: {
    pending_crawls: number
    scheduled_crawls: number
    high_priority: number
    overdue_crawls: number
  }
}

export default function IntelligentCrawlerDashboard({ vehicleId }: { vehicleId?: string }) {
  const [health, setHealth] = useState<CrawlerHealth | null>(null)
  const [stats, setStats] = useState<CrawlerStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    loadDashboardData()
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(loadDashboardData, 30000)
    return () => clearInterval(interval)
  }, [])

  const loadDashboardData = async () => {
    try {
      // Load health data
      const { data: healthData } = await supabase.functions.invoke('crawler-scheduler', {
        body: { action: 'health_check' }
      })
      
      if (healthData?.success) {
        setHealth(healthData.result)
      }

      // Load statistics
      const { data: statsData } = await supabase.functions.invoke('crawler-scheduler', {
        body: { action: 'get_stats' }
      })
      
      if (statsData?.success) {
        setStats(statsData.result)
      }

    } catch (error) {
      console.error('Failed to load crawler dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadDashboardData()
    setRefreshing(false)
  }

  const handleProcessQueue = async () => {
    try {
      await supabase.functions.invoke('crawler-scheduler', {
        body: { action: 'process_queue', batch_size: 5 }
      })
      
      // Refresh data after processing
      setTimeout(loadDashboardData, 2000)
    } catch (error) {
      console.error('Failed to process queue:', error)
    }
  }

  const handleCleanup = async () => {
    try {
      await supabase.functions.invoke('crawler-scheduler', {
        body: { action: 'cleanup' }
      })
      
      // Refresh data after cleanup
      setTimeout(loadDashboardData, 1000)
    } catch (error) {
      console.error('Failed to cleanup:', error)
    }
  }

  const handleCrawlVehicle = async () => {
    if (!vehicleId) return
    
    try {
      await supabase.rpc('crawl_vehicle_now', { p_vehicle_id: vehicleId })
      
      // Refresh data after crawl
      setTimeout(loadDashboardData, 3000)
    } catch (error) {
      console.error('Failed to crawl vehicle:', error)
    }
  }

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'excellent': return 'text-green-600'
      case 'good': return 'text-blue-600'
      case 'fair': return 'text-yellow-600'
      case 'poor': return 'text-red-600'
      default: return 'text-gray-600'
    }
  }

  const getHealthBadge = (status: string) => {
    switch (status) {
      case 'excellent': return <Badge className="bg-green-100 text-green-800">Excellent</Badge>
      case 'good': return <Badge className="bg-blue-100 text-blue-800">Good</Badge>
      case 'fair': return <Badge className="bg-yellow-100 text-yellow-800">Fair</Badge>
      case 'poor': return <Badge className="bg-red-100 text-red-800">Poor</Badge>
      default: return <Badge variant="secondary">Unknown</Badge>
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="h-6 w-6 animate-spin mr-2" />
            Loading crawler dashboard...
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="h-6 w-6" />
            Intelligent Crawler System
          </h2>
          <p className="text-muted-foreground">
            Advanced web crawling with algorithmic overlay
          </p>
        </div>
        
        <div className="flex gap-2">
          {vehicleId && (
            <Button onClick={handleCrawlVehicle} variant="outline">
              <Zap className="h-4 w-4 mr-2" />
              Crawl This Vehicle
            </Button>
          )}
          <Button onClick={handleProcessQueue} variant="outline">
            <Activity className="h-4 w-4 mr-2" />
            Process Queue
          </Button>
          <Button onClick={handleRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* System Health Overview */}
      {health && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              System Health
              {getHealthBadge(health.overall_health)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">
                  {health.queue_stats.pending_crawls}
                </div>
                <div className="text-sm text-muted-foreground">Pending Crawls</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {health.cache_stats.active_entries}
                </div>
                <div className="text-sm text-muted-foreground">Cache Entries</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  {health.cache_stats.hit_rate.toFixed(1)}
                </div>
                <div className="text-sm text-muted-foreground">Cache Hit Rate</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="sources" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="sources">Source Health</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="queue">Queue Status</TabsTrigger>
          <TabsTrigger value="cache">Cache Stats</TabsTrigger>
        </TabsList>

        {/* Source Health Tab */}
        <TabsContent value="sources">
          <Card>
            <CardHeader>
              <CardTitle>Crawler Source Health</CardTitle>
            </CardHeader>
            <CardContent>
              {health?.source_health?.length ? (
                <div className="space-y-4">
                  {health.source_health.map((source) => (
                    <div key={source.domain} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4" />
                          <span className="font-medium">{source.domain}</span>
                          {getHealthBadge(source.health_status)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {source.success_rate.toFixed(1)}% success
                        </div>
                      </div>
                      
                      <Progress 
                        value={source.success_rate} 
                        className="mb-2"
                      />
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <div className="font-medium">{source.total_requests}</div>
                          <div className="text-muted-foreground">Total Requests</div>
                        </div>
                        <div>
                          <div className="font-medium">{source.rate_limited_requests}</div>
                          <div className="text-muted-foreground">Rate Limited</div>
                        </div>
                        <div>
                          <div className="font-medium">{source.blocked_requests}</div>
                          <div className="text-muted-foreground">Blocked</div>
                        </div>
                        <div>
                          <div className="font-medium">{source.avg_response_time_ms}ms</div>
                          <div className="text-muted-foreground">Avg Response</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No source health data available
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  Crawl Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats?.crawl_stats ? (
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span>Total Crawls</span>
                      <span className="font-medium">{stats.crawl_stats.total_crawls}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Listings/Crawl</span>
                      <span className="font-medium">{stats.crawl_stats.avg_listings_per_crawl}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Sources/Crawl</span>
                      <span className="font-medium">{stats.crawl_stats.avg_sources_per_crawl}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Execution Time</span>
                      <span className="font-medium">{stats.crawl_stats.avg_execution_time_ms}ms</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Success Rate</span>
                      <span className="font-medium">{stats.crawl_stats.avg_success_rate}%</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">No performance data available</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Request Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stats?.monitoring_stats ? (
                  <div className="space-y-4">
                    <div className="flex justify-between">
                      <span>Total Requests</span>
                      <span className="font-medium">{stats.monitoring_stats.total_requests}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Success Rate</span>
                      <span className="font-medium">{stats.monitoring_stats.success_rate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Rate Limited</span>
                      <span className="font-medium">{stats.monitoring_stats.rate_limited_rate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Blocked</span>
                      <span className="font-medium">{stats.monitoring_stats.blocked_rate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Avg Response Time</span>
                      <span className="font-medium">{stats.monitoring_stats.avg_response_time}ms</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-muted-foreground">No request statistics available</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Queue Status Tab */}
        <TabsContent value="queue">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Crawler Queue Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.queue_stats ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div className="text-center">
                    <div className="text-3xl font-bold text-blue-600">
                      {stats.queue_stats.pending_crawls}
                    </div>
                    <div className="text-sm text-muted-foreground">Pending</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-green-600">
                      {stats.queue_stats.scheduled_crawls}
                    </div>
                    <div className="text-sm text-muted-foreground">Scheduled</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-purple-600">
                      {stats.queue_stats.high_priority}
                    </div>
                    <div className="text-sm text-muted-foreground">High Priority</div>
                  </div>
                  <div className="text-center">
                    <div className="text-3xl font-bold text-red-600">
                      {stats.queue_stats.overdue_crawls}
                    </div>
                    <div className="text-sm text-muted-foreground">Overdue</div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">No queue data available</div>
              )}
              
              <div className="mt-6 flex gap-2">
                <Button onClick={handleProcessQueue} className="flex-1">
                  <Activity className="h-4 w-4 mr-2" />
                  Process Queue Now
                </Button>
                <Button onClick={handleCleanup} variant="outline">
                  <Settings className="h-4 w-4 mr-2" />
                  Cleanup System
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Cache Stats Tab */}
        <TabsContent value="cache">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                Cache Statistics
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stats?.cache_stats ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {stats.cache_stats.total_entries}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Entries</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {stats.cache_stats.active_entries}
                    </div>
                    <div className="text-sm text-muted-foreground">Active</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-red-600">
                      {stats.cache_stats.expired_entries}
                    </div>
                    <div className="text-sm text-muted-foreground">Expired</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {stats.cache_stats.total_hits}
                    </div>
                    <div className="text-sm text-muted-foreground">Total Hits</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {stats.cache_stats.cache_size_mb}MB
                    </div>
                    <div className="text-sm text-muted-foreground">Cache Size</div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground">No cache data available</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}