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
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ 
        fontSize: '8pt', 
        fontWeight: 600, 
        color: 'var(--text-muted)', 
        textTransform: 'uppercase', 
        letterSpacing: '0.5px',
        marginBottom: 'var(--space-2)'
      }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              display: 'block',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: '8pt',
              borderRadius: '0px',
              backgroundColor: isActive ? 'var(--grey-100)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--text-muted)',
              transition: 'all 0.12s ease',
              textDecoration: 'none'
            })}
            className={({ isActive }) => isActive ? 'admin-nav-active' : 'admin-nav-inactive'}
            title={item.description}
            end={item.to === '/admin'}
          >
            <div style={{ fontWeight: 500 }}>{item.label}</div>
            {item.description ? (
              <div style={{ 
                fontSize: '8pt', 
                color: 'var(--text-muted)', 
                marginTop: '2px' 
              }}>{item.description}</div>
            ) : null}
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
    return <div style={{ padding: 'var(--space-6)', fontSize: '8pt', color: 'var(--text-muted)' }}>Loading admin…</div>;
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <div style={{
          maxWidth: '36rem',
          border: '2px solid var(--border-light)',
          borderRadius: '0px',
          padding: 'var(--space-4)',
          backgroundColor: 'var(--white)'
        }}>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-1)' }}>Access denied</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>Admin privileges are required to view this area.</div>
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
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
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 64px)' }}>
      <aside style={{
        width: '18rem',
        borderRight: '2px solid var(--border-light)',
        backgroundColor: 'var(--white)',
        padding: 'var(--space-4)'
      }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 600, color: 'var(--text)' }}>Admin</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>Central admin hub</div>
        </div>
        <Section title="Primary" items={primary} />
        <Section title="Operations" items={operations} />
        <Section title="Tools" items={tools} />
      </aside>

      <main style={{ flex: 1, backgroundColor: 'var(--grey-100)' }}>
        <div style={{ padding: 'var(--space-6)' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}






