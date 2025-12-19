import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminNotificationService, type AdminDashboardStats } from '../../services/adminNotificationService';

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






