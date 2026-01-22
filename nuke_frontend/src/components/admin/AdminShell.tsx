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
  { label: 'Pending Vehicles', to: '/admin/pending-vehicles' },
];

const operations: AdminNavItem[] = [
  { label: 'Ralph Brief', to: '/admin/ralph', description: 'What’s broken + what to do next' },
  { label: 'Mission Control', to: '/admin/mission-control' },
  { label: 'System Status', to: '/admin/status' },
  { label: 'Scripts', to: '/admin/scripts', description: 'Batch ops and maintenance actions' },
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
  { label: 'Scraper Dashboard', to: '/admin/scrapers', description: 'Monitor and trigger all scrapers' },
  { label: 'KSL Scraper', to: '/admin/ksl-scraper' },
  { label: 'Meme Library', to: '/admin/meme-library' },
  { label: 'Catalog Browser', to: '/admin/catalog' },
  { label: 'Make Logos Catalog', to: '/admin/make-logos-catalog', description: 'Vehicle makes + logo links (Wikidata/Commons)' },
  { label: 'Database Audit', to: '/admin/database-audit' },
  { label: 'Data Diagnostic', to: '/admin/data-diagnostic' },
  { label: 'NL Query', to: '/admin/query-console', description: 'Natural language SQL for vehicles' },
];

const experimental: AdminNavItem[] = [
  { label: 'Market Data Tools', to: '/admin/market-data-tools' },
  { label: 'Bot Testing', to: '/admin/bot-testing' },
  { label: 'Test Contributions', to: '/admin/test-contributions' },
  { label: 'Hover Card Demo', to: '/admin/hover-demo', description: 'See what hover cards look like' },
  { label: 'Legacy dashboard', to: '/admin/legacy-dashboard' },
];

function NavList({ items }: { items: AdminNavItem[] }) {
  return (
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
  );
}

function Section({
  title,
  items,
  collapsed,
  onToggle,
  right,
}: {
  title: string;
  items: AdminNavItem[];
  collapsed?: boolean;
  onToggle?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{
        fontSize: '8pt', 
        fontWeight: 600, 
        color: 'var(--text-muted)', 
        textTransform: 'uppercase', 
        letterSpacing: '0.5px',
        marginBottom: 'var(--space-2)',
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 'var(--space-2)',
      }}>
        {onToggle ? (
          <button
            type="button"
            onClick={onToggle}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: '6px',
            }}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <span style={{ fontFamily: 'monospace' }}>{collapsed ? '+' : '-'}</span>
            <span>{title}</span>
            <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>({items.length})</span>
          </button>
        ) : (
          <div>
            {title} <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>({items.length})</span>
          </div>
        )}
        {right ? <div style={{ textTransform: 'none' }}>{right}</div> : null}
      </div>
      {collapsed ? null : <NavList items={items} />}
    </div>
  );
}

export default function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, isAdmin } = useAdminAccess();
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = React.useState('');
  const [showTools, setShowTools] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem('nuke_admin_nav_showTools') === '1';
    } catch {
      return false;
    }
  });
  const [showExperimental, setShowExperimental] = React.useState<boolean>(() => {
    try {
      return localStorage.getItem('nuke_admin_nav_showExperimental') === '1';
    } catch {
      return false;
    }
  });

  React.useEffect(() => {
    try {
      localStorage.setItem('nuke_admin_nav_showTools', showTools ? '1' : '0');
    } catch {
      // ignore
    }
  }, [showTools]);

  React.useEffect(() => {
    try {
      localStorage.setItem('nuke_admin_nav_showExperimental', showExperimental ? '1' : '0');
    } catch {
      // ignore
    }
  }, [showExperimental]);

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = String(e.key || '').toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (key === 'escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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

  const q = query.trim().toLowerCase();
  const matchItem = (item: AdminNavItem) => {
    if (!q) return true;
    const hay = `${item.label} ${item.description || ''} ${item.to}`.toLowerCase();
    return hay.includes(q);
  };

  const allItems = React.useMemo(() => {
    return [
      ...primary.map((i) => ({ ...i, _section: 'Primary' })),
      ...operations.map((i) => ({ ...i, _section: 'Operations' })),
      ...tools.map((i) => ({ ...i, _section: 'Tools' })),
      ...experimental.map((i) => ({ ...i, _section: 'Experimental' })),
    ];
  }, []);

  const searchResults = q
    ? allItems.filter((i: any) => matchItem(i)).slice(0, 40)
    : [];

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

        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search admin…"
              style={{
                width: '100%',
                fontSize: '8pt',
                padding: '8px 10px',
                borderRadius: '0px',
                border: '2px solid var(--border-light)',
                outline: 'none',
              }}
            />
          </div>
          <div style={{ marginTop: '6px', fontSize: '8pt', color: 'var(--text-muted)' }}>
            Tip: press <span style={{ fontFamily: 'monospace' }}>⌘K</span> to focus.
          </div>
        </div>

        {q ? (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <div style={{
              fontSize: '8pt',
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: 'var(--space-2)',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--space-2)',
            }}>
              <div>Search results <span style={{ fontFamily: 'monospace', opacity: 0.7 }}>({searchResults.length})</span></div>
              <button
                type="button"
                onClick={() => setQuery('')}
                style={{ all: 'unset', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                Clear
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {searchResults.map((item: any) => (
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
                  title={item.description}
                  end={item.to === '/admin'}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                    <div style={{ fontWeight: 500 }}>{item.label}</div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{item._section}</div>
                  </div>
                  {item.description ? (
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>{item.description}</div>
                  ) : null}
                </NavLink>
              ))}
              {searchResults.length === 0 ? (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', padding: 'var(--space-2) var(--space-1)' }}>
                  No matches.
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <Section title="Primary" items={primary} />
            <Section title="Operations" items={operations} />
            <Section
              title="Tools"
              items={tools}
              collapsed={!showTools}
              onToggle={() => setShowTools((v) => !v)}
              right={<span style={{ fontFamily: 'monospace' }}>{showTools ? 'shown' : 'hidden'}</span>}
            />
            <Section
              title="Experimental"
              items={experimental}
              collapsed={!showExperimental}
              onToggle={() => setShowExperimental((v) => !v)}
              right={<span style={{ fontFamily: 'monospace' }}>{showExperimental ? 'shown' : 'hidden'}</span>}
            />
          </>
        )}
      </aside>

      <main style={{ flex: 1, backgroundColor: 'var(--grey-100)' }}>
        <div style={{ padding: 'var(--space-6)' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}






