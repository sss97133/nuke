import React from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAdminAccess } from '../../hooks/useAdminAccess';
import { supabase } from '../../lib/supabase';
import './AdminShell.css';

type AdminNavItem = {
  label: string;
  to: string;
  description?: string;
  countKey?: string;
};

type NavCounts = Record<string, number>;

const primary: AdminNavItem[] = [
  { label: 'Home', to: '/admin' },
  { label: 'Transfers', to: '/admin/transfers', description: 'Advance transfer milestones and inspect deal records' },
  { label: 'Inbox', to: '/admin/inbox', countKey: 'inbox' },
  { label: 'Agent Inbox', to: '/admin/agent-inbox', countKey: 'agentInbox' },
  { label: 'Reviews', to: '/admin/reviews', description: 'Contributor onboarding, ownership review, queues', countKey: 'reviews' },
  { label: 'Verifications', to: '/admin/verifications', countKey: 'verifications' },
  { label: 'Ownership Verifications', to: '/admin/ownership-verifications', countKey: 'ownership' },
  { label: 'Merge Proposals', to: '/admin/merge-proposals' },
  { label: 'Pending Vehicles', to: '/admin/pending-vehicles' },
];

const operations: AdminNavItem[] = [
  { label: 'Inventory Analytics', to: '/admin/analytics', description: 'Full inventory visualization & data quality' },
  { label: 'Data Pulse', to: '/admin/data-pulse', description: 'Platform ingestion telemetry + heartbeat health' },
  { label: 'Ralph Brief', to: '/admin/ralph', description: "What's broken + what to do next" },
  { label: 'Mission Control', to: '/admin/mission-control' },
  { label: 'System Status', to: '/admin/status' },
  { label: 'Scripts', to: '/admin/scripts', description: 'Batch ops and maintenance actions' },
  { label: 'Image Processing', to: '/admin/image-processing' },
  { label: 'Live Analysis', to: '/admin/live-analysis' },
  { label: 'Batch Analysis', to: '/admin/batch-analysis' },
  { label: 'Sources', to: '/admin/sources', description: 'Source onboarding, coverage, and data flow' },
  { label: 'Extraction Monitor', to: '/admin/extraction-monitor' },
  { label: 'Data Quality', to: '/admin/data-quality', description: 'Field completion rates + enrichment workforce' },
  { label: 'User Metrics', to: '/admin/user-metrics', description: 'Inspect source identity records and activity' },
  { label: 'Extraction Review', to: '/admin/extraction-review' },
];

const tools: AdminNavItem[] = [
  { label: 'Stripe Connect', to: '/stripe-connect', description: 'V2 connected accounts, onboarding, products, storefront' },
  { label: 'Business Intelligence', to: '/admin/business-intelligence' },
  { label: 'Price Editor', to: '/admin/price-editor' },
  { label: 'Price Import', to: '/admin/price-import' },
  { label: 'Shipping Settings', to: '/admin/shipping-settings' },
  { label: 'x402 Settings', to: '/admin/x402-settings' },
  { label: 'Scraper Dashboard', to: '/admin/scrapers', description: 'Monitor and trigger all scrapers' },
  { label: 'Unified Scrapers', to: '/admin/unified-scrapers', description: 'Unified scraper orchestrator dashboard' },
  { label: 'KSL Scraper', to: '/admin/ksl-scraper' },
  { label: 'Proxy Bids', to: '/admin/proxy-bids', description: 'Proxy bid operations and assignment' },
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

function NavBadge({ count }: { count: number }) {
  return count > 0 ? <span className="admin-nav-badge">{count > 999 ? '999+' : count}</span> : null;
}

function NavList({ items, counts }: { items: AdminNavItem[]; counts: NavCounts }) {
  return <div className="admin-nav-list">{items.map(item => <NavLink key={item.to} to={item.to}
    className={({ isActive }) => `admin-nav-link${isActive ? ' admin-nav-link--active' : ''}`}
    title={item.description} end={item.to === '/admin'}>
    <span className="admin-nav-link-title">{item.label}<NavBadge count={item.countKey ? counts[item.countKey] ?? 0 : 0} /></span>
    {item.description && <span className="admin-nav-description">{item.description}</span>}
  </NavLink>)}</div>;
}

function Section({ title, items, counts, collapsed, onToggle }: {
  title: string; items: AdminNavItem[]; counts: NavCounts; collapsed?: boolean; onToggle?: () => void;
}) {
  const id = React.useId();
  return <section className="admin-nav-section">
    {onToggle ? <button type="button" className="admin-nav-section-toggle" onClick={onToggle}
      aria-expanded={!collapsed} aria-controls={id}>
      <span>{title} <span className="admin-nav-count">({items.length})</span></span><span aria-hidden="true">{collapsed ? '+' : '−'}</span>
    </button> : <h2>{title} <span className="admin-nav-count">({items.length})</span></h2>}
    <div id={id} hidden={!!collapsed}><NavList items={items} counts={counts} /></div>
  </section>;
}

export default function AdminShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loading, isAdmin } = useAdminAccess();
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = React.useState('');
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [focusSearch, setFocusSearch] = React.useState(0);
  React.useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);
  React.useEffect(() => { if (focusSearch) searchRef.current?.focus(); }, [focusSearch]);
  const [navCounts, setNavCounts] = React.useState<NavCounts>({});

  React.useEffect(() => {
    let cancelled = false;
    async function fetchNavCounts() {
      try {
        const [
          { count: inbox },
          { count: agentInbox },
          { count: reviews },
          { count: verifications },
          { count: ownership },
        ] = await Promise.all([
          supabase.from('contact_inbox').select('*', { count: 'exact', head: true }).eq('status', 'unread'),
          supabase.from('agent_messages').select('*', { count: 'exact', head: true }).eq('to_role', 'founder').is('read_at', null),
          supabase.from('admin_notifications').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('secure_documents').select('*', { count: 'exact', head: true }).eq('verification_status', 'pending'),
          supabase.from('ownership_verifications').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
        ]);
        if (cancelled) return;
        setNavCounts({
          inbox: inbox ?? 0,
          agentInbox: agentInbox ?? 0,
          reviews: reviews ?? 0,
          verifications: verifications ?? 0,
          ownership: ownership ?? 0,
        });
      } catch {
        // counts are decorative — ignore errors
      }
    }
    fetchNavCounts();
    const interval = setInterval(fetchNavCounts, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
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
        setMobileNavOpen(true);
        setFocusSearch(value => value + 1);
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

  const allItems = React.useMemo(() => {
    return [
      ...primary.map((i) => ({ ...i, _section: 'Primary' })),
      ...operations.map((i) => ({ ...i, _section: 'Operations' })),
      ...tools.map((i) => ({ ...i, _section: 'Tools' })),
      ...experimental.map((i) => ({ ...i, _section: 'Experimental' })),
    ];
  }, []);

  const q = query.trim().toLowerCase();
  const matchItem = (item: AdminNavItem) => {
    if (!q) return true;
    const hay = `${item.label} ${item.description || ''} ${item.to}`.toLowerCase();
    return hay.includes(q);
  };

  const searchResults = q
    ? allItems.filter(matchItem).slice(0, 40)
    : [];

  if (loading) {
    return <div style={{ padding: 'var(--space-6)', fontSize: '11px', color: 'var(--text-muted)' }}>Loading admin…</div>;
  }

  if (!isAdmin) {
    return (
      <div style={{ padding: 'var(--space-6)' }}>
        <div style={{
          maxWidth: '36rem',
          border: '2px solid var(--border-light)', padding: 'var(--space-4)',
          backgroundColor: 'var(--white)'
        }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)', marginBottom: 'var(--space-1)' }}>Access denied</div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'var(--space-1)' }}>Admin privileges are required to view this area.</div>
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

  const currentLabel = allItems.find(item => item.to === location.pathname)?.label || 'Admin';
  return <div className="admin-shell">
    <div className="admin-shell-mobile-header">
      <strong>{currentLabel}</strong>
      <button type="button" className="button" aria-expanded={mobileNavOpen} aria-controls="admin-navigation"
        onClick={() => setMobileNavOpen(open => !open)}>Admin navigation</button>
    </div>
    <aside className="admin-shell-sidebar" id="admin-navigation" data-open={mobileNavOpen}
      onClick={event => { if ((event.target as Element).closest('a[href]')) setMobileNavOpen(false); }}>
      <header className="admin-nav-header"><strong>Admin</strong><span>Workspace operations</span></header>
      <label className="admin-nav-search">Find an admin page
        <input ref={searchRef} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search pages…" />
      </label>
      <p className="admin-nav-shortcut">⌘K or Ctrl+K to search</p>
      <nav aria-label="Admin pages">
        {q ? <section className="admin-nav-section">
          <div className="admin-nav-search-heading"><h2>Search results <span className="admin-nav-count">({searchResults.length})</span></h2>
            <button type="button" className="button" onClick={() => setQuery('')}>Clear search</button></div>
          <NavList items={searchResults} counts={navCounts} />
          {searchResults.length === 0 && <p className="admin-nav-description" role="status">No admin pages match this search.</p>}
        </section> : <>
          <Section title="Primary" items={primary} counts={navCounts} />
          <Section title="Operations" items={operations} counts={navCounts} />
          <Section title="Tools" items={tools} counts={navCounts} collapsed={!showTools} onToggle={() => setShowTools(value => !value)} />
          <Section title="Experimental" items={experimental} counts={navCounts} collapsed={!showExperimental} onToggle={() => setShowExperimental(value => !value)} />
        </>}
      </nav>
    </aside>
    <section className="admin-shell-content" aria-label="Admin page"><Outlet /></section>
  </div>;
}
