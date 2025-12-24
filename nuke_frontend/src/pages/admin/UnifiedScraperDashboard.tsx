/**
 * UNIFIED SCRAPER DASHBOARD
 * 
 * Real accountability dashboard that shows:
 * - Source health (active/degraded/failing/unmapped)
 * - Queue status (pending/processing/complete)
 * - Database growth (vehicles added)
 * - Recent activity
 * - Issues and alerts
 * 
 * Ties into unified-scraper-orchestrator for real-time status
 */

import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface SourceStatus {
  id: string;
  domain: string;
  source_name: string;
  scraper_function: string;
  is_active: boolean;
  last_successful_scrape: string | null;
  has_site_map: boolean;
  site_map_coverage: number;
  queue_pending: number;
  queue_processed: number;
  success_rate: number;
  status: 'healthy' | 'degraded' | 'failing' | 'unmapped';
}

interface SystemStatus {
  sources: {
    total: number;
    healthy: number;
    degraded: number;
    failing: number;
    unmapped: number;
    details: SourceStatus[];
  };
  queue: {
    pending: number;
    processing: number;
    complete: number;
  };
  database: {
    total_vehicles: number;
    vehicles_today: number;
  };
}

interface CycleResult {
  cycle_id: string;
  started_at: string;
  completed_at: string;
  sources_checked: number;
  sources_scraped: number;
  queue_processed: number;
  vehicles_added: number;
  issues: string[];
  status: 'success' | 'partial' | 'failed';
}

export default function UnifiedScraperDashboard() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [running, setRunning] = useState(false);
  const [recentCycles, setRecentCycles] = useState<CycleResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
    
    if (autoRefresh) {
      const interval = setInterval(loadStatus, 10000); // Refresh every 10 seconds
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  async function loadStatus() {
    try {
      setError(null);
      
      // Get status from unified-scraper-orchestrator
      const { data, error: fetchError } = await supabase.functions.invoke('unified-scraper-orchestrator', {
        body: { action: 'get_status' }
      });

      if (fetchError) throw fetchError;

      if (data?.status) {
        setStatus(data.status);
      }

      // Get recent cycles
      const { data: cycles } = await supabase
        .from('scraper_runs')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(10);

      if (cycles) {
        setRecentCycles(cycles as CycleResult[]);
      }

      setLoading(false);
    } catch (err: any) {
      console.error('Error loading status:', err);
      setError(err.message);
      setLoading(false);
    }
  }

  async function runCycle() {
    if (running) return;
    
    setRunning(true);
    setError(null);

    try {
      const { data, error: fetchError } = await supabase.functions.invoke('unified-scraper-orchestrator', {
        body: { action: 'run_cycle' }
      });

      if (fetchError) throw fetchError;

      // Reload status after cycle completes
      setTimeout(() => {
        loadStatus();
        setRunning(false);
      }, 5000);

    } catch (err: any) {
      console.error('Error running cycle:', err);
      setError(err.message);
      setRunning(false);
    }
  }

  function getStatusColor(sourceStatus: string) {
    switch (sourceStatus) {
      case 'healthy': return 'text-green-600 bg-green-50';
      case 'degraded': return 'text-yellow-600 bg-yellow-50';
      case 'failing': return 'text-red-600 bg-red-50';
      case 'unmapped': return 'text-gray-600 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  }

  if (loading && !status) {
    return (
      <div className="p-8">
        <div className="text-center">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Unified Scraper Dashboard</h1>
        <p className="text-gray-600">Real-time accountability and monitoring</p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-red-700">
          Error: {error}
        </div>
      )}

      {/* Controls */}
      <div className="mb-6 flex gap-4 items-center">
        <button
          onClick={runCycle}
          disabled={running}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run Cycle'}
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>Auto-refresh (10s)</span>
        </label>
        <button
          onClick={loadStatus}
          className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
        >
          Refresh Now
        </button>
      </div>

      {status && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div className="p-4 bg-white rounded-lg shadow">
              <div className="text-sm text-gray-600">Total Sources</div>
              <div className="text-2xl font-bold">{status.sources.total}</div>
              <div className="text-xs text-gray-500 mt-1">
                {status.sources.healthy} healthy, {status.sources.degraded} degraded, {status.sources.failing} failing
              </div>
            </div>
            <div className="p-4 bg-white rounded-lg shadow">
              <div className="text-sm text-gray-600">Queue Pending</div>
              <div className="text-2xl font-bold">{status.queue.pending}</div>
              <div className="text-xs text-gray-500 mt-1">
                {status.queue.processing} processing
              </div>
            </div>
            <div className="p-4 bg-white rounded-lg shadow">
              <div className="text-sm text-gray-600">Vehicles Today</div>
              <div className="text-2xl font-bold">{status.database.vehicles_today}</div>
              <div className="text-xs text-gray-500 mt-1">
                {status.database.total_vehicles.toLocaleString()} total
              </div>
            </div>
            <div className="p-4 bg-white rounded-lg shadow">
              <div className="text-sm text-gray-600">Unmapped Sources</div>
              <div className="text-2xl font-bold text-red-600">{status.sources.unmapped}</div>
              <div className="text-xs text-gray-500 mt-1">
                Need site mapping
              </div>
            </div>
          </div>

          {/* Sources Table */}
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-4">Source Status</h2>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Site Map</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Queue</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Success Rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Scrape</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {status.sources.details.map((source) => (
                    <tr key={source.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{source.domain}</div>
                        <div className="text-xs text-gray-500">{source.scraper_function}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(source.status)}`}>
                          {source.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {source.has_site_map ? (
                          <span className="text-green-600">
                            {source.site_map_coverage.toFixed(0)}%
                          </span>
                        ) : (
                          <span className="text-red-600">Not mapped</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div>{source.queue_pending} pending</div>
                        <div className="text-xs text-gray-500">{source.queue_processed} processed</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm">
                          {(source.success_rate * 100).toFixed(0)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {source.last_successful_scrape
                          ? new Date(source.last_successful_scrape).toLocaleString()
                          : 'Never'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Recent Cycles */}
          <div>
            <h2 className="text-xl font-bold mb-4">Recent Cycles</h2>
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Started</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Sources</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Queue</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Vehicles</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issues</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {recentCycles.map((cycle) => (
                    <tr key={cycle.cycle_id}>
                      <td className="px-4 py-3 text-sm">
                        {new Date(cycle.started_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {cycle.sources_scraped}/{cycle.sources_checked}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {cycle.queue_processed}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {cycle.vehicles_added}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          cycle.status === 'success' ? 'bg-green-100 text-green-700' :
                          cycle.status === 'partial' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {cycle.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-red-600">
                        {cycle.issues.length > 0 && `${cycle.issues.length} issues`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

