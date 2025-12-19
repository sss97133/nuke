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
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-semibold text-gray-900">Admin</div>
          <div className="text-sm text-gray-600 mt-1">Everything admin lives here.</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">Pending</div>
          <div className="text-lg font-semibold text-gray-900">
            {loading ? '…' : String(stats?.total_pending_notifications ?? 0)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
        {cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="block rounded-lg border border-gray-200 bg-white p-4 hover:bg-gray-50 transition-colors"
          >
            <div className="text-sm font-semibold text-gray-900">{c.title}</div>
            <div className="text-sm text-gray-600 mt-1">{c.description}</div>
          </Link>
        ))}
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-sm font-semibold text-gray-900">Quick links</div>
        <div className="text-sm text-gray-600 mt-2 flex flex-wrap gap-2">
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






