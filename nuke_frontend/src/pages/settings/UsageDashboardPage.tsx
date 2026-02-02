import React, { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';

interface UsageLog {
  id: string;
  resource: string;
  action: string;
  resource_id: string | null;
  timestamp: string;
}

interface DailyUsage {
  date: string;
  count: number;
}

interface ResourceBreakdown {
  resource: string;
  count: number;
}

interface ApiKeyUsage {
  id: string;
  name: string;
  last_used_at: string | null;
  request_count: number;
  rate_limit_remaining: number | null;
}

export default function UsageDashboardPage() {
  const { session, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [totalRequests, setTotalRequests] = useState(0);
  const [todayRequests, setTodayRequests] = useState(0);
  const [weekRequests, setWeekRequests] = useState(0);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [resourceBreakdown, setResourceBreakdown] = useState<ResourceBreakdown[]>([]);
  const [recentLogs, setRecentLogs] = useState<UsageLog[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyUsage[]>([]);

  // Filters
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [selectedResource, setSelectedResource] = useState<string>('all');

  useEffect(() => {
    if (user?.id) {
      loadDashboardData();
    }
  }, [user, timeRange]);

  async function loadDashboardData() {
    setLoading(true);
    setError(null);

    try {
      const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 90;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);
      const startIso = startDate.toISOString();

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString();

      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekIso = weekAgo.toISOString();

      // Fetch all data in parallel
      const [
        { count: totalCount },
        { count: todayCount },
        { count: weekCount },
        { data: logs },
        { data: keys },
      ] = await Promise.all([
        // Total requests
        supabase
          .from('api_usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user!.id),

        // Today's requests
        supabase
          .from('api_usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user!.id)
          .gte('timestamp', todayIso),

        // This week's requests
        supabase
          .from('api_usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user!.id)
          .gte('timestamp', weekIso),

        // Recent logs
        supabase
          .from('api_usage_logs')
          .select('id, resource, action, resource_id, timestamp')
          .eq('user_id', user!.id)
          .gte('timestamp', startIso)
          .order('timestamp', { ascending: false })
          .limit(100),

        // API keys
        supabase
          .from('api_keys')
          .select('id, name, last_used_at, rate_limit_remaining')
          .eq('user_id', user!.id)
          .eq('is_active', true),
      ]);

      setTotalRequests(totalCount || 0);
      setTodayRequests(todayCount || 0);
      setWeekRequests(weekCount || 0);
      setRecentLogs(logs || []);

      // Calculate daily usage from logs
      const dailyMap = new Map<string, number>();
      for (const log of logs || []) {
        const date = new Date(log.timestamp).toISOString().split('T')[0];
        dailyMap.set(date, (dailyMap.get(date) || 0) + 1);
      }

      const daily: DailyUsage[] = [];
      for (let i = daysBack - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        daily.push({
          date: dateStr,
          count: dailyMap.get(dateStr) || 0,
        });
      }
      setDailyUsage(daily);

      // Calculate resource breakdown
      const resourceMap = new Map<string, number>();
      for (const log of logs || []) {
        const key = `${log.resource}:${log.action}`;
        resourceMap.set(key, (resourceMap.get(key) || 0) + 1);
      }

      const breakdown: ResourceBreakdown[] = Array.from(resourceMap.entries())
        .map(([resource, count]) => ({ resource, count }))
        .sort((a, b) => b.count - a.count);
      setResourceBreakdown(breakdown);

      // Add request counts to API keys
      const keyUsage: ApiKeyUsage[] = (keys || []).map((key) => ({
        ...key,
        request_count: 0, // We'd need a separate query with join to get this accurately
      }));
      setApiKeys(keyUsage);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  function formatTime(timestamp: string) {
    return new Date(timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getMaxCount() {
    return Math.max(...dailyUsage.map((d) => d.count), 1);
  }

  const filteredLogs = selectedResource === 'all'
    ? recentLogs
    : recentLogs.filter((log) => `${log.resource}:${log.action}` === selectedResource);

  if (loading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-3 gap-4 mb-8">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-gray-100 rounded"></div>
            ))}
          </div>
          <div className="h-64 bg-gray-100 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">API Usage</h1>
          <p className="text-gray-600 mt-1">
            Monitor your API usage and request patterns.
          </p>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as any)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-1">Today</div>
          <div className="text-3xl font-bold">{todayRequests.toLocaleString()}</div>
          <div className="text-sm text-gray-400">requests</div>
        </div>
        <div className="bg-white border rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-1">This Week</div>
          <div className="text-3xl font-bold">{weekRequests.toLocaleString()}</div>
          <div className="text-sm text-gray-400">requests</div>
        </div>
        <div className="bg-white border rounded-lg p-6">
          <div className="text-sm text-gray-500 mb-1">All Time</div>
          <div className="text-3xl font-bold">{totalRequests.toLocaleString()}</div>
          <div className="text-sm text-gray-400">requests</div>
        </div>
      </div>

      {/* Usage Chart */}
      <div className="bg-white border rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Request Volume</h2>
        <div className="h-48 flex items-end gap-1">
          {dailyUsage.map((day, i) => {
            const height = (day.count / getMaxCount()) * 100;
            return (
              <div
                key={day.date}
                className="flex-1 flex flex-col items-center group"
              >
                <div className="relative w-full">
                  <div
                    className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-600"
                    style={{ height: `${Math.max(height, 2)}%`, minHeight: '2px' }}
                  ></div>
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
                    {day.count} requests
                  </div>
                </div>
                {(i === 0 || i === dailyUsage.length - 1 || i % Math.ceil(dailyUsage.length / 7) === 0) && (
                  <div className="text-xs text-gray-400 mt-2">
                    {formatDate(day.date)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Resource Breakdown */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Endpoint Breakdown</h2>
          {resourceBreakdown.length === 0 ? (
            <p className="text-gray-500 text-sm">No API calls yet</p>
          ) : (
            <div className="space-y-3">
              {resourceBreakdown.slice(0, 10).map((item) => {
                const pct = (item.count / (recentLogs.length || 1)) * 100;
                return (
                  <div key={item.resource}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-mono">{item.resource}</span>
                      <span className="text-gray-500">{item.count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full"
                        style={{ width: `${pct}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* API Keys Status */}
        <div className="bg-white border rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          {apiKeys.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-500 text-sm mb-2">No API keys yet</p>
              <a
                href="/settings/api-keys"
                className="text-blue-600 text-sm hover:underline"
              >
                Create your first API key
              </a>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <div key={key.id} className="border rounded p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{key.name}</div>
                      <div className="text-sm text-gray-500">
                        {key.last_used_at
                          ? `Last used ${formatTime(key.last_used_at)}`
                          : 'Never used'}
                      </div>
                    </div>
                    {key.rate_limit_remaining !== null && (
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {key.rate_limit_remaining.toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-400">remaining</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Request Logs */}
      <div className="bg-white border rounded-lg p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">Recent Requests</h2>
          <select
            value={selectedResource}
            onChange={(e) => setSelectedResource(e.target.value)}
            className="px-3 py-1 border rounded text-sm"
          >
            <option value="all">All endpoints</option>
            {resourceBreakdown.map((item) => (
              <option key={item.resource} value={item.resource}>
                {item.resource}
              </option>
            ))}
          </select>
        </div>

        {filteredLogs.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">
            No API requests in this time period
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Time</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Resource</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Action</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Resource ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.slice(0, 50).map((log) => (
                  <tr key={log.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-500">
                      {formatTime(log.timestamp)}
                    </td>
                    <td className="py-2 px-3">
                      <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">
                        {log.resource}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs ${
                        log.action === 'create' ? 'bg-green-100 text-green-700' :
                        log.action === 'update' ? 'bg-yellow-100 text-yellow-700' :
                        log.action === 'delete' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-gray-500 font-mono text-xs">
                      {log.resource_id ? log.resource_id.substring(0, 8) + '...' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredLogs.length > 50 && (
              <p className="text-center text-gray-400 text-sm mt-4">
                Showing 50 of {filteredLogs.length} requests
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
