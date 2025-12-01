import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';

interface QueueStats {
  pending: number;
  processing: number;
  complete: number;
  failed: number;
  skipped: number;
  total: number;
}

interface QueueItem {
  id: string;
  listing_url: string;
  region: string | null;
  search_term: string | null;
  status: string;
  vehicle_id: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  processed_at: string | null;
  updated_at: string;
}

interface RecentActivity {
  id: string;
  listing_url: string;
  status: string;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

const CraigslistQueueDashboard: React.FC = () => {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    loadData();
    // Auto-refresh every 5 seconds
    const interval = setInterval(() => {
      loadData();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      // Get stats by status
      const { data: queueData, error: queueError } = await supabase
        .from('craigslist_listing_queue')
        .select('status');

      if (queueError) throw queueError;

      const stats: QueueStats = {
        pending: 0,
        processing: 0,
        complete: 0,
        failed: 0,
        skipped: 0,
        total: queueData?.length || 0
      };

      queueData?.forEach(item => {
        if (item.status === 'pending') stats.pending++;
        else if (item.status === 'processing') stats.processing++;
        else if (item.status === 'complete') stats.complete++;
        else if (item.status === 'failed') stats.failed++;
        else if (item.status === 'skipped') stats.skipped++;
      });

      setStats(stats);

      // Get recent activity
      const { data: recentData, error: recentError } = await supabase
        .from('craigslist_listing_queue')
        .select('id, listing_url, status, error_message, created_at, processed_at')
        .order('updated_at', { ascending: false })
        .limit(20);

      if (recentError) throw recentError;

      setRecentActivity(recentData || []);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error loading queue data:', error);
    } finally {
      setLoading(false);
    }
  };

  const triggerDiscovery = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('discover-cl-squarebodies', {
        body: {
          max_regions: 10, // Test with 10 regions
          max_searches_per_region: 5
        }
      });

      if (error) throw error;

      alert(`Discovery started: ${data.message}`);
      loadData();
    } catch (error: any) {
      console.error('Error triggering discovery:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const triggerProcessing = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('process-cl-queue', {
        body: {
          batch_size: 10
        }
      });

      if (error) throw error;

      alert(`Processing started: ${data.message}`);
      loadData();
    } catch (error: any) {
      console.error('Error triggering processing:', error);
      alert(`Error: ${error.message}`);
    }
  };

  const retryFailed = async () => {
    try {
      const { error } = await supabase
        .from('craigslist_listing_queue')
        .update({
          status: 'pending',
          retry_count: 0,
          error_message: null,
          updated_at: new Date().toISOString()
        })
        .eq('status', 'failed')
        .lt('retry_count', 3);

      if (error) throw error;

      alert('Failed items reset to pending');
      loadData();
    } catch (error: any) {
      console.error('Error retrying failed:', error);
      alert(`Error: ${error.message}`);
    }
  };

  if (loading && !stats) {
    return (
      <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: '8pt' }}>Loading queue data...</div>
      </div>
    );
  }

  const percentComplete = stats && stats.total > 0
    ? ((stats.complete / stats.total) * 100).toFixed(1)
    : '0.0';

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '8pt', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>
            Craigslist Squarebody Scraping Queue
          </h2>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={triggerDiscovery}
            className="button button-primary cursor-button"
            style={{ padding: '8px 16px', fontSize: '8pt' }}
          >
            TRIGGER DISCOVERY
          </button>
          <button
            onClick={triggerProcessing}
            className="button button-primary cursor-button"
            style={{ padding: '8px 16px', fontSize: '8pt' }}
          >
            PROCESS QUEUE
          </button>
          {stats && stats.failed > 0 && (
            <button
              onClick={retryFailed}
              className="button button-secondary cursor-button"
              style={{ padding: '8px 16px', fontSize: '8pt', color: 'var(--warning)' }}
            >
              RETRY FAILED ({stats.failed})
            </button>
          )}
        </div>
      </div>

      {/* Stats Grid */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '24px' }}>
          <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Pending
            </div>
            <div style={{ fontSize: '16pt', fontWeight: '700', color: 'var(--warning)' }}>
              {stats.pending.toLocaleString()}
            </div>
          </div>

          <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Processing
            </div>
            <div style={{ fontSize: '16pt', fontWeight: '700', color: 'var(--accent)' }}>
              {stats.processing.toLocaleString()}
            </div>
          </div>

          <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Complete
            </div>
            <div style={{ fontSize: '16pt', fontWeight: '700', color: 'var(--success)' }}>
              {stats.complete.toLocaleString()}
            </div>
          </div>

          <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Failed
            </div>
            <div style={{ fontSize: '16pt', fontWeight: '700', color: 'var(--error)' }}>
              {stats.failed.toLocaleString()}
            </div>
          </div>

          <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Skipped
            </div>
            <div style={{ fontSize: '16pt', fontWeight: '700', color: 'var(--text-muted)' }}>
              {stats.skipped.toLocaleString()}
            </div>
          </div>

          <div className="card" style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px', textTransform: 'uppercase' }}>
              Total
            </div>
            <div style={{ fontSize: '16pt', fontWeight: '700', color: 'var(--text)' }}>
              {stats.total.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Progress Bar */}
      {stats && stats.total > 0 && (
        <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div style={{ fontSize: '8pt', fontWeight: '700', textTransform: 'uppercase' }}>
              Processing Progress
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
              {stats.complete} / {stats.total} ({percentComplete}%)
            </div>
          </div>
          <div style={{
            width: '100%',
            height: '24px',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '4px',
            overflow: 'hidden',
            border: '2px solid var(--border)'
          }}>
            <div style={{
              width: `${percentComplete}%`,
              height: '100%',
              backgroundColor: 'var(--success)',
              transition: 'width 0.3s ease'
            }} />
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="card" style={{ padding: '16px' }}>
        <div style={{ fontSize: '8pt', fontWeight: '700', textTransform: 'uppercase', marginBottom: '16px' }}>
          Recent Activity
        </div>
        {recentActivity.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
            No activity yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recentActivity.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '12px',
                  backgroundColor: 'var(--bg-secondary)',
                  borderRadius: '4px',
                  border: '1px solid var(--border-light)',
                  fontSize: '8pt'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '4px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '700', marginBottom: '2px', wordBreak: 'break-all' }}>
                      {item.listing_url}
                    </div>
                    {item.error_message && (
                      <div style={{ color: 'var(--error)', fontSize: '7pt', marginTop: '4px' }}>
                        Error: {item.error_message}
                      </div>
                    )}
                  </div>
                  <div style={{ marginLeft: '12px', textAlign: 'right' }}>
                    <div style={{
                      padding: '2px 6px',
                      borderRadius: '2px',
                      fontSize: '7pt',
                      fontWeight: '700',
                      backgroundColor:
                        item.status === 'complete' ? 'var(--success)' :
                        item.status === 'failed' ? 'var(--error)' :
                        item.status === 'processing' ? 'var(--accent)' :
                        item.status === 'skipped' ? 'var(--text-muted)' :
                        'var(--warning)',
                      color: 'white'
                    }}>
                      {item.status.toUpperCase()}
                    </div>
                    <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {item.processed_at
                        ? new Date(item.processed_at).toLocaleString()
                        : new Date(item.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default CraigslistQueueDashboard;

