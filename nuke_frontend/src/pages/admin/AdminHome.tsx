import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminNotificationService, type AdminDashboardStats } from '../../services/adminNotificationService';
import { supabase } from '../../lib/supabase';

type Card = {
  title: string;
  description: string;
  to: string;
};

const cards: Card[] = [
  { title: 'Reviews', description: 'Contributor onboarding, queues, and admin review tools', to: '/admin/reviews' },
  { title: 'Verifications', description: 'User verification review and status changes', to: '/admin/verifications' },
  { title: 'Ownership Verifications', description: 'Ownership documentation review dashboard', to: '/admin/ownership-verifications' },
  { title: 'Mission Control', description: 'Batch ops and system actions', to: '/admin/mission-control' },
  { title: 'System Status', description: 'Health, pipeline, and operational telemetry', to: '/admin/status' },
  { title: 'Price Tools', description: 'Bulk edit and CSV import', to: '/admin/price-editor' },
  { title: 'Scrapers', description: 'KSL import and other ingestion tools', to: '/admin/ksl-scraper' },
  { title: 'Catalog', description: 'Browse extracted catalog data', to: '/admin/catalog' },
];

export default function AdminHome() {
  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [ralphLoading, setRalphLoading] = useState(false);
  const [ralphError, setRalphError] = useState<string | null>(null);
  const [ralphData, setRalphData] = useState<any | null>(null);
  const [ralphUpdatedAt, setRalphUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await AdminNotificationService.getDashboardStats();
        if (!cancelled) setStats(s);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRalph = async (mode: 'snapshot' | 'explain') => {
    if (ralphLoading) return;
    setRalphLoading(true);
    setRalphError(null);
    try {
      const action = mode === 'snapshot' ? 'dry_run' : 'brief';
      const { data, error } = await supabase.functions.invoke('ralph-wiggum-rlm-extraction-coordinator', {
        body: { action, max_failed_samples: 250 }
      });
      if (error) throw error;
      setRalphData(data || null);
      setRalphUpdatedAt(new Date());
    } catch (e: any) {
      setRalphError(e?.message || 'Failed to load Ralph brief');
      setRalphData(null);
    } finally {
      setRalphLoading(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
        <div>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Admin</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>Everything admin lives here.</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Pending</div>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>
            {loading ? '…' : String(stats?.total_pending_notifications ?? 0)}
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 'var(--space-6)',
        borderRadius: '0px',
        border: '2px solid var(--border-light)',
        backgroundColor: 'var(--white)',
        padding: 'var(--space-4)'
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <div>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Ralph brief</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>
              One page of “what’s happening + what to do next”.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {ralphUpdatedAt && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                updated {ralphUpdatedAt.toLocaleTimeString()}
              </div>
            )}
            <button
              className="button button-secondary"
              disabled={ralphLoading}
              onClick={() => void loadRalph('snapshot')}
              title="No LLM call — just counts + top failure patterns"
            >
              Snapshot
            </button>
            <button
              className="button"
              disabled={ralphLoading}
              onClick={() => void loadRalph('explain')}
              title="LLM-generated coordination brief"
            >
              {ralphLoading ? 'Working…' : 'Explain'}
            </button>
          </div>
        </div>

        {ralphError && (
          <div style={{ marginTop: 'var(--space-3)', fontSize: '8pt', color: '#b91c1c' }}>
            {ralphError}
          </div>
        )}

        {ralphData?.snapshot && (
          <div style={{
            marginTop: 'var(--space-3)',
            fontSize: '8pt',
            color: 'var(--text)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-3)'
          }}>
            <div>
              <b>import_queue</b>: {String(ralphData.snapshot.queue?.pending ?? 0)} pending / {String(ralphData.snapshot.queue?.failed ?? 0)} failed
            </div>
            <div>
              <b>vehicles</b>: {String(ralphData.snapshot.vehicles?.total ?? 0)} total / {String(ralphData.snapshot.vehicles?.created_last_24h ?? 0)} last 24h
            </div>
            {ralphData.snapshot.analysis?.vehicle_image_analysis && (
              <div>
                <b>vehicle_images</b>: {String(ralphData.snapshot.analysis.vehicle_image_analysis.pending ?? 0)} pending / {String(ralphData.snapshot.analysis.vehicle_image_analysis.analyzed ?? 0)} analyzed
              </div>
            )}
            {ralphData.snapshot.analysis?.analysis_queue && (
              <div>
                <b>analysis_queue</b>: {String((ralphData.snapshot.analysis.analysis_queue.pending ?? 0) + (ralphData.snapshot.analysis.analysis_queue.retrying ?? 0))} pending/retrying
              </div>
            )}
          </div>
        )}

        {Array.isArray(ralphData?.output?.headlines) && ralphData.output.headlines.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Headlines</div>
            <ul style={{ marginTop: 'var(--space-2)', paddingLeft: '18px', fontSize: '8pt', color: 'var(--text)' }}>
              {ralphData.output.headlines.slice(0, 8).map((h: string, idx: number) => (
                <li key={idx} style={{ marginBottom: '4px' }}>{h}</li>
              ))}
            </ul>
          </div>
        )}

        {Array.isArray(ralphData?.output?.priorities_now) && ralphData.output.priorities_now.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Do now</div>
            <div style={{ marginTop: 'var(--space-2)', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 'var(--space-3)' }}>
              {ralphData.output.priorities_now.slice(0, 4).map((p: any, idx: number) => (
                <div key={idx} style={{ border: '1px solid var(--border-light)', background: 'var(--grey-50)', padding: 'var(--space-3)' }}>
                  <div style={{ fontSize: '8pt', fontWeight: 600 }}>{String(p?.title || 'Untitled')}</div>
                  {p?.why && <div style={{ marginTop: '6px', fontSize: '8pt', color: 'var(--text-muted)' }}>{String(p.why)}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 'var(--space-4)',
        marginTop: 'var(--space-6)'
      }}>
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            style={{
              display: 'block',
              borderRadius: '0px',
              border: '2px solid var(--border-light)',
              backgroundColor: 'var(--white)',
              padding: 'var(--space-4)',
              transition: 'all 0.12s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--grey-50)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--white)';
            }}
          >
            <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>{c.title}</div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>{c.description}</div>
          </Link>
        ))}
      </div>

      <div style={{
        marginTop: 'var(--space-6)',
        borderRadius: '0px',
        border: '2px solid var(--border-light)',
        backgroundColor: 'var(--white)',
        padding: 'var(--space-4)'
      }}>
        <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Quick links</div>
        <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <Link className="button button-secondary" to="/admin/legacy-dashboard">
            Legacy dashboard
          </Link>
          <Link className="button button-secondary" to="/admin/business-intelligence">
            Business intelligence
          </Link>
          <Link className="button button-secondary" to="/admin/shipping-settings">
            Shipping
          </Link>
          <Link className="button button-secondary" to="/admin/x402-settings">
            x402
          </Link>
        </div>
      </div>
    </div>
  );
}






