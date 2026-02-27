import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';

/** Simple stats loader for the public landing page — no auth or complex fallbacks needed. */
function useLandingStats() {
  const [stats, setStats] = useState<{ totalVehicles: number | null; totalImages: number | null }>({
    totalVehicles: null,
    totalImages: null,
  });

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('portfolio_stats_cache')
      .select('total_vehicles')
      .eq('id', 'global')
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setStats((prev) => ({
          ...prev,
          totalVehicles: Number(data.total_vehicles) || null,
        }));
      });
    return () => { cancelled = true; };
  }, []);

  return stats;
}

const CursorHomepage = lazy(() => import('./CursorHomepage'));
const GarageTab = lazy(() => import('../components/garage/GarageTab'));
const UnifiedMap = lazy(() => import('../components/map/UnifiedMap'));

type TabId = 'garage' | 'feed' | 'map';

const TABS: { id: TabId; label: string }[] = [
  { id: 'feed', label: 'Feed' },
  { id: 'garage', label: 'Garage' },
  { id: 'map', label: 'Map' },
];

const LS_KEY = 'nuke_hub_tab';

function LandingHero({ onBrowse }: { onBrowse: () => void }) {
  const navigate = useNavigate();
  usePageTitle('Nuke — Vehicle Intelligence');
  const landingStats = useLandingStats();
  const [searchInput, setSearchInput] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    else navigate('/search');
  };

  const formatNum = (n: number | null | undefined) => {
    if (n == null) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return n.toLocaleString();
  };

  const statItems = [
    { value: formatNum(landingStats.totalVehicles), label: 'vehicles tracked' },
    { value: '33M+', label: 'photos indexed' },
    { value: '50+', label: 'data sources' },
  ];

  const features = [
    {
      title: 'Vehicle Identity',
      desc: 'Canonical profiles built from every data source — auction results, service records, photos, VIN decodes.',
    },
    {
      title: 'Market Intelligence',
      desc: 'Real-time pricing across BaT, eBay, Craigslist, Hagerty, Cars & Bids, and dozens more platforms.',
    },
    {
      title: 'Deal Scoring',
      desc: 'Instant valuation estimates and deal scores so you know if a listing is priced right before you bid.',
    },
    {
      title: 'API & SDK',
      desc: 'Programmatic access to 18K+ vehicle profiles. Build your own tools on top of the Nuke dataset.',
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 'calc(100vh - 80px)',
        padding: '40px 24px',
        background: '#111',
        color: '#e5e7eb',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* Hero */}
      <div style={{ textAlign: 'center', maxWidth: 680, marginBottom: 40 }}>
        <h1
          style={{
            fontSize: 'clamp(36px, 7vw, 64px)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            margin: '0 0 12px',
            color: '#fff',
          }}
        >
          Nuke
        </h1>
        <p
          style={{
            fontSize: 'clamp(15px, 2.5vw, 20px)',
            lineHeight: 1.5,
            color: '#9ca3af',
            margin: '0 0 6px',
            fontWeight: 500,
          }}
        >
          Vehicle Intelligence for Collectors
        </p>
        <p
          style={{
            fontSize: 'clamp(13px, 2vw, 15px)',
            lineHeight: 1.7,
            color: '#6b7280',
            margin: '0 0 32px',
            maxWidth: 520,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          The definitive database for collector cars. Market data, deal scoring,
          auction history, and provenance across hundreds of thousands of vehicles.
        </p>

        {/* Search bar */}
        <form
          onSubmit={handleSearch}
          style={{
            display: 'flex',
            gap: 0,
            maxWidth: 520,
            margin: '0 auto 24px',
            boxShadow: '0 0 0 2px #fff',
          }}
        >
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search: 1967 Porsche 911, VIN, make, model..."
            aria-label="Search vehicles"
            style={{
              flex: 1,
              padding: '12px 16px',
              fontSize: 14,
              border: 'none',
              background: '#1a1a1a',
              color: '#fff',
              outline: 'none',
              minWidth: 0,
            }}
          />
          <button
            type="submit"
            style={{
              padding: '12px 24px',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              border: 'none',
              background: '#fff',
              color: '#111',
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            Search
          </button>
        </form>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/signup')}
            style={{
              padding: '10px 28px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              border: '2px solid #fff',
              background: '#fff',
              color: '#111',
              cursor: 'pointer',
            }}
          >
            Get started free
          </button>
          <button
            onClick={onBrowse}
            style={{
              padding: '10px 28px',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              border: '2px solid #444',
              background: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer',
            }}
          >
            Browse the feed
          </button>
        </div>
      </div>

      {/* Live stats */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 40,
          background: '#1a1a1a',
          border: '1px solid #333',
        }}
      >
        {statItems.map((s, i) => (
          <div
            key={s.label}
            style={{
              padding: '16px 28px',
              textAlign: 'center',
              borderRight: i < statItems.length - 1 ? '1px solid #333' : 'none',
            }}
          >
            <div
              style={{
                fontSize: 'clamp(20px, 3vw, 28px)',
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '-0.02em',
                fontFamily: 'monospace',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Feature grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 1,
          maxWidth: 720,
          width: '100%',
          background: '#333',
          border: '1px solid #333',
          marginBottom: 32,
        }}
      >
        {features.map((feature) => (
          <div
            key={feature.title}
            style={{
              padding: '20px 16px',
              background: '#1a1a1a',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                color: '#e5e7eb',
                marginBottom: 6,
              }}
            >
              {feature.title}
            </div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.6,
                color: '#6b7280',
              }}
            >
              {feature.desc}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom links */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
        }}
      >
        <Link to="/api" style={{ color: '#6b7280', textDecoration: 'none' }}>API</Link>
        <Link to="/developers" style={{ color: '#6b7280', textDecoration: 'none' }}>SDK</Link>
        <Link to="/about" style={{ color: '#6b7280', textDecoration: 'none' }}>About</Link>
        <Link to="/search" style={{ color: '#6b7280', textDecoration: 'none' }}>Search</Link>
        <Link to="/offering" style={{ color: '#6b7280', textDecoration: 'none' }}>Investors</Link>
      </div>
    </div>
  );
}

// Minimal skeleton for tab content while lazy loading
function TabSkeleton() {
  return (
    <div
      style={{
        padding: 24,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            height: 80,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 2,
            animation: 'pulse 1.5s ease-in-out infinite',
          }}
        />
      ))}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}

export default function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [showFeed, setShowFeed] = useState(false);

  const defaultTab = useMemo(() => {
    const fromUrl = searchParams.get('tab') as TabId | null;
    if (fromUrl && TABS.some((t) => t.id === fromUrl)) return fromUrl;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (fromStorage && TABS.some((t) => t.id === fromStorage)) return fromStorage;
    return 'feed';
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  useEffect(() => {
    if (authLoading) return;
    const fromUrl = searchParams.get('tab') as TabId | null;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (!fromUrl && !fromStorage) {
      setActiveTab('feed');
    }
    if (!user && fromUrl) {
      setShowFeed(true);
    }
  }, [authLoading, user]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    localStorage.setItem(LS_KEY, tab);
    setSearchParams(tab === 'garage' && user ? {} : { tab }, { replace: true });
  };

  // Logged-out users with no explicit tab request see the landing page
  if (!authLoading && !user && !showFeed) {
    return <LandingHero onBrowse={() => setShowFeed(true)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          background: '#1a1a1a',
          flexShrink: 0,
          borderTop: '1px solid #333',
          borderBottom: '2px solid #000',
          height: 30,
        }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              aria-selected={active}
              style={{
                padding: '0 20px',
                fontSize: '11px',
                fontFamily: 'Arial, sans-serif',
                fontWeight: 600,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                border: 'none',
                borderBottom: active ? '2px solid #fff' : '2px solid transparent',
                background: active ? '#2a2a2a' : 'transparent',
                color: active ? '#fff' : '#999',
                cursor: 'pointer',
                transition: 'color 0.1s, background 0.1s',
                marginBottom: '-2px',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = '#bbb'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = '#999'; }}
            >
              {tab.label}
            </button>
          );
        })}
        {/* Right-aligned external links */}
        <div
          style={{
            marginLeft: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: '2px',
            paddingRight: '8px',
          }}
        >
          <Link
            to="/api"
            style={{
              padding: '0 12px',
              fontSize: '10px',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              textDecoration: 'none',
              color: '#7eb8da',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              height: '100%',
            }}
          >
            API
          </Link>
          <Link
            to="/developers"
            style={{
              padding: '0 12px',
              fontSize: '10px',
              fontFamily: 'Arial, sans-serif',
              fontWeight: 600,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              textDecoration: 'none',
              color: '#7eb8da',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              height: '100%',
            }}
          >
            SDK
          </Link>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto', background: 'var(--bg)' }}>
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'garage' && <GarageTab />}
          {activeTab === 'feed' && <CursorHomepage />}
          {activeTab === 'map' && <UnifiedMap />}
        </Suspense>
      </div>
    </div>
  );
}
