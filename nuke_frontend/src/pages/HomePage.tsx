import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';

/** Simple stats loader for the public landing page — no auth or complex fallbacks needed. */
function useLandingStats() {
  const [stats, setStats] = useState<{ totalVehicles: number | null; totalImages: number | null; totalSources: number | null }>({
    totalVehicles: null,
    totalImages: null,
    totalSources: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase
        .from('portfolio_stats_cache')
        .select('total_vehicles')
        .eq('id', 'global')
        .maybeSingle(),
      supabase
        .from('vehicle_images')
        .select('*', { count: 'estimated', head: true }),
      supabase
        .from('observation_sources')
        .select('*', { count: 'exact', head: true }),
    ]).then(([cacheRes, imagesRes, sourcesRes]) => {
      if (cancelled) return;
      setStats({
        totalVehicles: cacheRes.data ? Number(cacheRes.data.total_vehicles) || null : null,
        totalImages: imagesRes.count != null ? imagesRes.count : null,
        totalSources: sourcesRes.count != null ? sourcesRes.count : null,
      });
    });
    return () => { cancelled = true; };
  }, []);

  return stats;
}

interface ShowcaseVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
  asking_price: number | null;
}

/** Loads 8 recent vehicles that have images for the live showcase strip. */
function useLiveShowcase() {
  const [vehicles, setVehicles] = useState<ShowcaseVehicle[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data, error: err } = await supabase
        .from('vehicles')
        .select('id, year, make, model, primary_image_url, sale_price, asking_price')
        .not('primary_image_url', 'is', null)
        .order('created_at', { ascending: false })
        .limit(8);
      if (err) throw err;
      if (data && data.length > 0) {
        setVehicles(data);
        setError(false);
      }
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);

  return { vehicles, error };
}

interface SearchPreviewResult {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  asking_price: number | null;
}

/** Inline search preview hook — debounced 300ms. */
function useSearchPreview(query: string) {
  const [results, setResults] = useState<SearchPreviewResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setNoResults(false);
      return;
    }

    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      try {
        // Split query into words for flexible matching
        const words = q.split(/\s+/).filter(w => w.length > 0);
        let builder = supabase
          .from('vehicles')
          .select('id, year, make, model, sale_price, asking_price');

        // Apply ilike for each word across make+model concatenation
        for (const word of words) {
          builder = builder.or(`make.ilike.%${word}%,model.ilike.%${word}%,vin.ilike.%${word}%`);
        }

        // If query looks like a year, also filter by year
        const yearMatch = q.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          builder = builder.eq('year', parseInt(yearMatch[0]));
        }

        const { data, error } = await builder.limit(5);
        if (error) throw error;
        setResults(data || []);
        setNoResults((data || []).length === 0);
      } catch {
        setResults([]);
        setNoResults(false);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query]);

  return { results, loading, noResults };
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
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const { vehicles: showcaseVehicles } = useLiveShowcase();
  const { results: searchResults, noResults } = useSearchPreview(searchInput);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    else navigate('/search');
  };

  // Close search dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatNum = (n: number | null | undefined) => {
    if (n == null) return '—';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return n.toLocaleString();
  };

  const formatPrice = (v: { sale_price?: number | null; asking_price?: number | null }) => {
    const p = v.sale_price || v.asking_price;
    if (!p) return null;
    if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
    if (p >= 1_000) return `$${Math.round(p / 1_000)}K`;
    return `$${p.toLocaleString()}`;
  };

  const statItems = [
    { value: formatNum(landingStats.totalVehicles), label: 'vehicles tracked' },
    { value: formatNum(landingStats.totalImages), label: 'photos indexed' },
    { value: formatNum(landingStats.totalSources), label: 'data sources' },
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
      desc: `Programmatic access to ${formatNum(landingStats.totalVehicles)} vehicle profiles. Build your own tools on top of the Nuke dataset.`,
    },
  ];

  const showDropdown = searchFocused && searchInput.trim().length >= 2 && (searchResults.length > 0 || noResults);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '40px 24px',
        background: 'var(--bg)',
        color: 'var(--text)',
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
            color: 'var(--surface)',
          }}
        >
          Nuke
        </h1>
        <p
          style={{
            fontSize: 'clamp(15px, 2.5vw, 20px)',
            lineHeight: 1.5,
            color: 'var(--text-disabled)',
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
            color: 'var(--text-secondary)',
            margin: '0 0 32px',
            maxWidth: 520,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}
        >
          The definitive database for collector cars. Market data, deal scoring,
          auction history, and provenance across hundreds of thousands of vehicles.
        </p>

        {/* Search bar with inline preview */}
        <div ref={searchContainerRef} style={{ position: 'relative', maxWidth: 520, margin: '0 auto 24px' }}>
          <form
            onSubmit={handleSearch}
            style={{
              display: 'flex',
              gap: 0,
              boxShadow: '0 0 0 2px var(--surface)',
            }}
          >
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              placeholder="Search: 1967 Porsche 911, VIN, make, model..."
              aria-label="Search vehicles"
              style={{
                flex: 1,
                padding: '12px 16px',
                fontSize: 14,
                border: 'none',
                background: 'var(--surface)',
                color: 'var(--text)',
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
                background: 'var(--surface)',
                color: 'var(--text)',
                cursor: 'pointer',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              Search
            </button>
          </form>

          {/* Inline search preview dropdown */}
          {showDropdown && (
            <div style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              zIndex: 100,
            }}>
              {searchResults.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setSearchFocused(false);
                    navigate(`/vehicle/${v.id}`);
                  }}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    width: '100%',
                    padding: '10px 16px',
                    border: 'none',
                    borderBottom: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 13,
                    fontFamily: 'Arial, sans-serif',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span>
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle'}
                  </span>
                  {formatPrice(v) && (
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 12 }}>
                      {formatPrice(v)}
                    </span>
                  )}
                </button>
              ))}
              {noResults && (
                <div style={{ padding: '10px 16px', color: 'var(--text-secondary)', fontSize: 12 }}>
                  No vehicles found for "{searchInput.trim()}"
                </div>
              )}
            </div>
          )}
        </div>

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
              border: '2px solid var(--surface)',
              background: 'var(--surface)',
              color: 'var(--text)',
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
              border: '2px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-disabled)',
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
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        {statItems.map((s, i) => (
          <div
            key={s.label}
            style={{
              padding: '16px 28px',
              textAlign: 'center',
              borderRight: i < statItems.length - 1 ? '1px solid var(--border)' : 'none',
            }}
          >
            <div
              style={{
                fontSize: 'clamp(20px, 3vw, 28px)',
                fontWeight: 700,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                fontFamily: 'monospace',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 2 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Live Vehicle Showcase */}
      {showcaseVehicles.length > 0 && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 40 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
          }}>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--success)',
              animation: 'livePulse 2s ease-in-out infinite',
            }} />
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: 'var(--text-secondary)',
            }}>
              LIVE FEED — LATEST ARRIVALS
            </span>
          </div>
          <div style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 8,
            scrollbarWidth: 'thin',
          }}>
            {showcaseVehicles.map((v) => (
              <Link
                key={v.id}
                to={`/vehicle/${v.id}`}
                style={{
                  flexShrink: 0,
                  width: 160,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  textDecoration: 'none',
                  color: 'var(--text)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  width: '100%',
                  height: 100,
                  overflow: 'hidden',
                  background: 'var(--bg)',
                }}>
                  <img
                    src={v.primary_image_url || ''}
                    alt={`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()}
                    loading="lazy"
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    lineHeight: 1.3,
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}
                  </div>
                  {formatPrice(v) && (
                    <div style={{
                      fontSize: 11,
                      fontFamily: 'monospace',
                      color: 'var(--text-muted)',
                    }}>
                      {formatPrice(v)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
          <style>{`
            @keyframes livePulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
          `}</style>
        </div>
      )}

      {/* Feature grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 1,
          maxWidth: 720,
          width: '100%',
          background: 'var(--border)',
          border: '1px solid var(--border)',
          marginBottom: 32,
        }}
      >
        {features.map((feature) => (
          <div
            key={feature.title}
            style={{
              padding: '20px 16px',
              background: 'var(--surface)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                color: 'var(--text)',
                marginBottom: 6,
              }}
            >
              {feature.title}
            </div>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
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
        <Link to="/api" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>API</Link>
        <Link to="/developers" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>SDK</Link>
        <Link to="/about" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>About</Link>
        <Link to="/search" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Search</Link>
        <Link to="/offering" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>Investors</Link>
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
          background: 'var(--surface)',
          flexShrink: 0,
          borderTop: '1px solid var(--border)',
          borderBottom: '2px solid var(--text)',
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
                borderBottom: active ? '2px solid var(--surface)' : '2px solid transparent',
                background: active ? 'var(--bg)' : 'transparent',
                color: active ? 'var(--surface)' : 'var(--text-disabled)',
                cursor: 'pointer',
                transition: 'color 0.1s, background 0.1s',
                marginBottom: '-2px',
              }}
              onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)'; }}
              onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-disabled)'; }}
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
              color: 'var(--accent)',
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
              color: 'var(--accent)',
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
      <div style={{ flex: 1, overflow: activeTab === 'map' ? 'hidden' : 'auto', background: 'var(--bg)', position: 'relative' }}>
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'garage' && <GarageTab />}
          {activeTab === 'feed' && <CursorHomepage />}
          {activeTab === 'map' && <UnifiedMap />}
        </Suspense>
      </div>
    </div>
  );
}
