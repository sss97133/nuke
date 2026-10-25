import React, { useState, useEffect, useRef } from 'react';
import PrefetchLink from '../../components/PrefetchLink';
import './settings-workspace.css';
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
  rate_limit_remaining: number | null;
}

export default function UsageDashboardPage() {
  const { user, loading } = useAuth();
  if (loading) return <p role="status" className="settings-workspace">Checking your account…</p>;
  if (!user) return <p role="status" className="settings-workspace">Sign in to view your API usage.</p>;
  return <UsageDashboard key={user.id} userId={user.id} />;
}

function UsageDashboard({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [totalRequests, setTotalRequests] = useState<number | null>(null);
  const [todayRequests, setTodayRequests] = useState<number | null>(null);
  const [weekRequests, setWeekRequests] = useState<number | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [resourceBreakdown, setResourceBreakdown] = useState<ResourceBreakdown[]>([]);
  const [recentLogs, setRecentLogs] = useState<UsageLog[] | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyUsage[] | null>(null);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [selectedResource, setSelectedResource] = useState('all');
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setErrors([]);
    setSelectedResource('all');
    const now = new Date();
    const daysBack = Number(timeRange.slice(0, -1));
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = new Date(today.getTime() - (daysBack - 1) * 86400000);
    const count = (since?: string) => {
      const query = supabase.from('api_usage_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      return since ? query.gte('timestamp', since) : query;
    };
    void (async () => {
      const responses = await Promise.allSettled([
        count(), count(today.toISOString()), count(new Date(now.getTime() - 7 * 86400000).toISOString()),
        supabase.from('api_usage_logs').select('id, resource, action, resource_id, timestamp')
          .eq('user_id', userId).gte('timestamp', start.toISOString())
          .order('timestamp', { ascending: false }).order('id', { ascending: false }).limit(101),
        supabase.from('api_keys').select('id, name, last_used_at, rate_limit_remaining')
          .eq('user_id', userId).eq('is_active', true),
      ]);
      if (generation.current !== request) return;
      const failures: string[] = [];
      const response = (index: number, label: string) => {
        const result = responses[index];
        if (result.status === 'rejected' || result.value.error) {
          failures.push(`${label} could not be read.`);
          return null;
        }
        return result.value;
      };
      const readCount = (index: number, label: string) => {
        const result = response(index, label);
        if (result && typeof result.count === 'number' && Number.isFinite(result.count) && result.count >= 0) return result.count;
        if (result) failures.push(`${label} count is unavailable.`);
        return null;
      };
      setTotalRequests(readCount(0, 'All-time usage'));
      setTodayRequests(readCount(1, 'Today’s usage'));
      setWeekRequests(readCount(2, 'Past seven days'));
      const logResult = response(3, 'Recent requests');
      const keyResult = response(4, 'API keys');
      const logs = logResult && Array.isArray(logResult.data) ? logResult.data.slice(0, 100) as UsageLog[] : null;
      const keys = keyResult && Array.isArray(keyResult.data) ? keyResult.data as ApiKeyUsage[] : null;
      if (logResult && !logs) failures.push('Recent request rows are unavailable.');
      if (keyResult && !keys) failures.push('API key rows are unavailable.');
      setRecentLogs(logs); setApiKeys(keys);
      setHasMoreLogs(Array.isArray(logResult?.data) && logResult.data.length > 100);
      const dailyMap = new Map<string, number>();
      const resources = new Map<string, number>();
      for (const log of logs || []) {
        const date = new Date(log.timestamp);
        if (Number.isFinite(date.getTime())) {
          const day = date.toISOString().slice(0, 10);
          dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
        }
        const resource = `${log.resource}:${log.action}`;
        resources.set(resource, (resources.get(resource) || 0) + 1);
      }
      setDailyUsage(logs ? Array.from({ length: daysBack }, (_, i) => {
        const date = new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10);
        return { date, count: dailyMap.get(date) || 0 };
      }) : []);
      setResourceBreakdown([...resources].map(([resource, count]) => ({ resource, count })).sort((a, b) => b.count - a.count));
      setErrors(failures); setLoading(false);
    })();
    return () => { generation.current++; };
  }, [userId, timeRange, attempt]);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric', timeZone: 'UTC',
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
    ? (recentLogs || [])
    : (recentLogs || []).filter((log) => `${log.resource}:${log.action}` === selectedResource);

  if (loading) return <div className="settings-workspace"><h1>API usage</h1><p role="status">Reading your saved usage…</p></div>;

  return (
    <div className="settings-workspace settings-usage">
      <div className="settings-page-heading">
        <div>
          <h1 className="text-2xl font-bold">API Usage</h1>
          <p className="settings-muted mt-1">
            Inspect recorded API traffic and your current key list.
          </p>
        </div>
        <select
          aria-label="Usage period"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as any)}
          className="px-3 py-2 border"
        >
          <option value="7d">Last 7 UTC days</option>
          <option value="30d">Last 30 UTC days</option>
          <option value="90d">Last 90 UTC days</option>
        </select>
      </div>

      <div className="settings-reader-actions"><PrefetchLink to="/settings">Settings</PrefetchLink><button type="button" className="button" onClick={() => setAttempt(value => value + 1)}>Refresh usage</button></div>
      {errors.length > 0 && <div role="alert" className="settings-reader-error">{errors.map(error => <p key={error}>{error}</p>)}<button type="button" className="button" onClick={() => setAttempt(value => value + 1)}>Retry usage reads</button></div>}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="settings-surface">
          <div className="text-sm settings-muted mb-1">Today (UTC)</div>
          <div className="text-3xl font-bold">{todayRequests === null ? 'Unavailable' : todayRequests.toLocaleString()}</div>
          <div className="text-sm settings-muted">requests</div>
        </div>
        <div className="settings-surface">
          <div className="text-sm settings-muted mb-1">Past 7 days</div>
          <div className="text-3xl font-bold">{weekRequests === null ? 'Unavailable' : weekRequests.toLocaleString()}</div>
          <div className="text-sm settings-muted">requests</div>
        </div>
        <div className="settings-surface">
          <div className="text-sm settings-muted mb-1">All time</div>
          <div className="text-3xl font-bold">{totalRequests === null ? 'Unavailable' : totalRequests.toLocaleString()}</div>
          <div className="text-sm settings-muted">requests</div>
        </div>
      </div>

      {/* Usage Chart */}
      <div className="settings-surface mb-8">
        <h2 className="text-lg font-semibold mb-4">Loaded requests by day</h2>
        <p className="settings-scope">{recentLogs === null ? 'Recent request coverage is unknown.' : `Newest ${recentLogs.length} loaded requests in the selected UTC days. ${hasMoreLogs ? 'More requests exist; these charts are a partial sample.' : 'No additional row was returned in this bounded read.'}`}</p>
        <div className="settings-usage-chart" aria-label="Loaded requests by UTC day">
          {dailyUsage.map((day, i) => {
            const height = (day.count / getMaxCount()) * 100;
            return (
              <div
                key={day.date}
                className="settings-usage-day"
              >
                <div className="settings-usage-bar-track">
                  <div
                    className="settings-usage-bar"
                    style={{ height: `${height}%` }} role="img" aria-label={`${day.date}: ${day.count} loaded requests`} title={`${day.date}: ${day.count} loaded requests`}
                  ></div>

                </div>
                <div className="settings-usage-day-label settings-muted">
                  {(i === 0 || i === dailyUsage.length - 1 || i % Math.ceil(dailyUsage.length / 7) === 0) ? formatDate(day.date) : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Resource Breakdown */}
        <div className="settings-surface">
          <h2 className="text-lg font-semibold mb-4">Endpoints in the loaded sample</h2>
          {recentLogs === null ? <p role="status">Endpoint coverage is unavailable.</p> : resourceBreakdown.length === 0 ? (
            <p className="settings-muted text-sm">No requests were returned in this selected period.</p>
          ) : (
            <div className="space-y-3">
              {resourceBreakdown.slice(0, 10).map((item) => {
                const pct = (item.count / (recentLogs?.length || 1)) * 100;
                return (
                  <div key={item.resource}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-mono">{item.resource}</span>
                      <span className="settings-muted">{item.count}</span>
                    </div>
                    <div className="w-full settings-muted-surface h-2">
                      <div
                        className="settings-usage-fill h-2"
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
        <div className="settings-surface">
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          {apiKeys === null ? <p role="status">API key status is unavailable.</p> : apiKeys.length === 0 ? (
            <div className="text-center py-6">
              <p className="settings-muted text-sm mb-2">No active API keys returned</p>
              <PrefetchLink
                to="/settings/api-keys"
                className="text-blue-600 text-sm hover:underline"
              >
                Manage API keys
              </PrefetchLink>
            </div>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <div key={key.id} className="border p-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-medium">{key.name}</div>
                      <div className="text-sm settings-muted">
                        {key.last_used_at
                          ? `Last used ${formatTime(key.last_used_at)}`
                          : 'No recorded use'}
                      </div>
                    </div>
                    {key.rate_limit_remaining !== null && (
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {key.rate_limit_remaining.toLocaleString()}
                        </div>
                        <div className="text-xs settings-muted">remaining · stored snapshot</div>
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
      <div className="settings-surface">
        <div className="settings-page-heading">
          <h2 className="text-lg font-semibold">Loaded request records</h2>
          <select
            aria-label="Filter loaded requests by endpoint"
            value={selectedResource}
            onChange={(e) => setSelectedResource(e.target.value)}
            className="px-3 py-1 border text-sm"
          >
            <option value="all">All endpoints</option>
            {resourceBreakdown.map((item) => (
              <option key={item.resource} value={item.resource}>
                {item.resource}
              </option>
            ))}
          </select>
        </div>

        {recentLogs === null ? <p role="status">Recent requests could not be loaded.</p> : filteredLogs.length === 0 ? (
          <p className="settings-muted text-sm text-center py-8">
            No matching requests in the loaded sample
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3 font-medium settings-muted">Time</th>
                  <th className="text-left py-2 px-3 font-medium settings-muted">Resource</th>
                  <th className="text-left py-2 px-3 font-medium settings-muted">Action</th>
                  <th className="text-left py-2 px-3 font-medium settings-muted">Resource ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.slice(0, 50).map((log) => (
                  <tr key={log.id} className="settings-usage-row">
                    <td className="py-2 px-3 settings-muted">
                      {formatTime(log.timestamp)}
                    </td>
                    <td className="py-2 px-3">
                      <span className="font-mono settings-muted-surface px-2 py-0.5 text-xs">
                        {log.resource}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className="settings-event-kind px-2 py-0.5 text-xs">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-2 px-3 settings-muted font-mono text-xs">
                      {log.resource_id ? log.resource_id.substring(0, 8) + '...' : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredLogs.length > 50 && (
              <p className="text-center settings-muted text-sm mt-4">
                Showing 50 of {filteredLogs.length} matching loaded requests
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
