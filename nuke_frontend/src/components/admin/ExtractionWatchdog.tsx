import React, { useState, useEffect } from 'react';
import { supabase, getSupabaseFunctionsUrl } from '../../lib/supabase';

interface QueueHealth {
  pending: number;
  processing: number;
  complete: number;
  failed: number;
  skipped: number;
  stale_locks: number;
  stuck_items: number;
  processing_rate: number;
  error_rate: number;
  oldest_pending_hours: number;
  top_errors: Array<{ pattern: string; count: number }>;
  workers_active: number;
}

interface WatchdogStatus {
  timestamp: string;
  health: QueueHealth;
  issues: string[];
  healthy: boolean;
}

export const ExtractionWatchdog: React.FC = () => {
  const [status, setStatus] = useState<WatchdogStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const fetchStatus = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const response = await fetch(`${getSupabaseFunctionsUrl()}/extraction-watchdog`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.session?.access_token || ''}`,
        },
        body: JSON.stringify({ action: 'status' }),
      });

      if (!response.ok) throw new Error('Failed to fetch status');

      const data = await response.json();
      setStatus(data);
      setLastRefresh(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (loading && !status) {
    return (
      <div className="bg-neutral-900 rounded-lg p-4 border border-neutral-800">
        <div className="animate-pulse">Loading extraction status...</div>
      </div>
    );
  }

  const h = status?.health;
  const isHealthy = status?.healthy ?? true;
  const etaHours = h && h.processing_rate > 0 ? (h.pending / h.processing_rate).toFixed(1) : '?';

  return (
    <div className={`bg-neutral-900 rounded-lg p-4 border ${isHealthy ? 'border-neutral-800' : 'border-amber-600'}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-medium flex items-center gap-2">
          {isHealthy ? '✅' : '⚠️'} Extraction Status
        </h3>
        <button
          onClick={fetchStatus}
          className="text-xs text-neutral-400 hover:text-white"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-red-400 text-sm mb-3">Error: {error}</div>
      )}

      {h && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-neutral-400">Pending</div>
            <div className="text-xl font-mono">{h.pending.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-neutral-400">Processing</div>
            <div className="text-xl font-mono text-blue-400">{h.processing}</div>
          </div>
          <div>
            <div className="text-neutral-400">Rate/hr</div>
            <div className="text-xl font-mono text-green-400">{h.processing_rate}</div>
          </div>
          <div>
            <div className="text-neutral-400">ETA</div>
            <div className="text-xl font-mono">{etaHours}h</div>
          </div>
          <div>
            <div className="text-neutral-400">Complete</div>
            <div className="text-xl font-mono text-green-600">{h.complete.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-neutral-400">Failed</div>
            <div className="text-xl font-mono text-red-400">{h.failed.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-neutral-400">Error Rate</div>
            <div className={`text-xl font-mono ${h.error_rate > 20 ? 'text-red-400' : 'text-neutral-300'}`}>
              {h.error_rate}%
            </div>
          </div>
          <div>
            <div className="text-neutral-400">Workers</div>
            <div className="text-xl font-mono">{h.workers_active}</div>
          </div>
        </div>
      )}

      {status?.issues && status.issues.length > 0 && (
        <div className="mt-4 p-2 bg-amber-900/30 rounded border border-amber-700">
          <div className="text-amber-400 text-sm font-medium mb-1">Issues Detected:</div>
          <ul className="text-sm text-amber-200">
            {status.issues.map((issue, i) => (
              <li key={i}>• {issue}</li>
            ))}
          </ul>
        </div>
      )}

      {h?.top_errors && h.top_errors.length > 0 && (
        <div className="mt-4">
          <div className="text-neutral-400 text-xs mb-1">Top Errors (last hour):</div>
          <div className="text-xs font-mono text-neutral-500 space-y-1">
            {h.top_errors.slice(0, 3).map((err, i) => (
              <div key={i}>({err.count}x) {err.pattern.slice(0, 60)}...</div>
            ))}
          </div>
        </div>
      )}

      {lastRefresh && (
        <div className="mt-3 text-xs text-neutral-500">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};

export default ExtractionWatchdog;
