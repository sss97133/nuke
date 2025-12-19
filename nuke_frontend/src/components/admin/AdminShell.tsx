import React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAccess } from '../../hooks/useAdminAccess';

type AdminNavItem = {
  label: string;
  to: string;
  description?: string;
};

const primary: AdminNavItem[] = [
  { label: 'Home', to: '/admin' },
  { label: 'Reviews', to: '/admin/reviews', description: 'Contributor onboarding, ownership review, queues' },
  { label: 'Verifications', to: '/admin/verifications' },
  { label: 'Ownership Verifications', to: '/admin/ownership-verifications' },
  { label: 'Merge Proposals', to: '/admin/merge-proposals' },
];

const operations: AdminNavItem[] = [
  { label: 'Mission Control', to: '/admin/mission-control' },
  { label: 'System Status', to: '/admin/status' },
  { label: 'Image Processing', to: '/admin/image-processing' },
  { label: 'Live Analysis', to: '/admin/live-analysis' },
  { label: 'Batch Analysis', to: '/admin/batch-analysis' },
  { label: 'Extraction Monitor', to: '/admin/extraction-monitor' },
  { label: 'Extraction Review', to: '/admin/extraction-review' },
];

const tools: AdminNavItem[] = [
  { label: 'Business Intelligence', to: '/admin/business-intelligence' },
  { label: 'Price Editor', to: '/admin/price-editor' },
  { label: 'Price Import', to: '/admin/price-import' },
  { label: 'Shipping Settings', to: '/admin/shipping-settings' },
  { label: 'x402 Settings', to: '/admin/x402-settings' },
  { label: 'KSL Scraper', to: '/admin/ksl-scraper' },
  { label: 'Meme Library', to: '/admin/meme-library' },
  { label: 'Catalog Browser', to: '/admin/catalog' },
  { label: 'Database Audit', to: '/admin/database-audit' },
  { label: 'Data Diagnostic', to: '/admin/data-diagnostic' },
  { label: 'Test Contributions', to: '/admin/test-contributions' },
];

function Section({ title, items }: { title: string; items: AdminNavItem[] }) {
  return (
    <div className="mb-6">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</div>
      <div className="space-y-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `block rounded-md px-3 py-2 text-sm transition-colors ${
                isActive ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`
            }
            title={item.description}
            end={item.to === '/admin'}
          >
            <div className="font-medium">{item.label}</div>
            {item.description ? <div className="text-xs text-gray-500 mt-0.5">{item.description}</div> : null}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

export default function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, isAdmin } = useAdminAccess();

  React.useEffect(() => {
    if (loading) return;
    if (!isAdmin) {
      // Keep this deterministic: admins only.
      navigate('/org/dashboard', { replace: true, state: { from: location.pathname } });
    }
  }, [isAdmin, loading, location.pathname, navigate]);

  if (loading) {
    return <div className="p-6 text-sm text-gray-600">Loading admin…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="max-w-xl border border-gray-200 rounded-lg p-4 bg-white">
          <div className="text-lg font-semibold text-gray-900">Access denied</div>
          <div className="text-sm text-gray-600 mt-1">Admin privileges are required to view this area.</div>
          <div className="mt-4 flex gap-2">
            <button className="button button-secondary" onClick={() => navigate('/org/dashboard')}>
              Return to dashboard
            </button>
            <button className="button" onClick={() => navigate('/login')}>
              Log in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-64px)]">
      <aside className="w-72 border-r border-gray-200 bg-white p-4">
        <div className="mb-4">
          <div className="text-sm font-semibold text-gray-900">Admin</div>
          <div className="text-xs text-gray-500 mt-1">Central admin hub</div>
        </div>
        <Section title="Primary" items={primary} />
        <Section title="Operations" items={operations} />
        <Section title="Tools" items={tools} />
      </aside>

      <main className="flex-1 bg-gray-50">
        <div className="p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}






