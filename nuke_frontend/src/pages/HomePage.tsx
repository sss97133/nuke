import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { supabase } from '../lib/supabase';
import { useVehiclesDashboard } from '../hooks/useVehiclesDashboard';
import { useAppLayoutContext } from '../components/layout/AppLayoutContext';
import { GarageToolbar } from '../components/garage/GarageToolbar';
import { applyNonAutoFilters } from '../lib/nonAutoExclusion';
import { OnboardingSlideshow } from '../components/onboarding/OnboardingSlideshow';

/** Landing page stats: vehicles, sale prices, comments. */
function useLandingStats() {
  const [stats, setStats] = useState<{ totalVehicles: number | null; salePrices: number | null; totalComments: number | null }>({
    totalVehicles: null,
    salePrices: null,
    totalComments: null,
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
        .from('vehicles')
        .select('*', { count: 'estimated', head: true })
        .not('sale_price', 'is', null),
      supabase
        .from('auction_comments')
        .select('*', { count: 'estimated', head: true }),
    ]).then(([cacheRes, pricesRes, commentsRes]) => {
      if (cancelled) return;
      setStats({
        totalVehicles: cacheRes.data ? Number(cacheRes.data.total_vehicles) || null : null,
        salePrices: pricesRes.count != null ? pricesRes.count : null,
        totalComments: commentsRes.count != null ? commentsRes.count : null,
      });
    });
    return () => { cancelled = true; };
  }, []);

  return stats;
}

/** Market snapshot: top makes with vehicle counts and avg prices. */
function useMarketSnapshot() {
  const [data, setData] = useState<{ make: string; vehicle_count: number; avg_price: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('landing_market_snapshot').then(({ data: rows }) => {
      if (!cancelled && rows) setData(rows);
    });
    return () => { cancelled = true; };
  }, []);

  return data;
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
      let q = supabase
        .from('vehicles')
        .select('id, year, make, model, primary_image_url, sale_price, asking_price')
        .not('primary_image_url', 'is', null)
        .not('year', 'is', null)
        .not('make', 'is', null)
        .not('model', 'is', null)
        .eq('is_public', true)
        .neq('status', 'deleted')
        .neq('status', 'pending');
      q = applyNonAutoFilters(q);
      q = q.is('origin_organization_id', null);
      // Prefer vehicles with sale prices (auction results are more interesting)
      const { data, error: err } = await q
        .not('sale_price', 'is', null)
        .gt('sale_price', 1000)
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
        builder = applyNonAutoFilters(builder);

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

const FeedPage = lazy(() => import('../feed/components/FeedPage'));
const GarageTab = lazy(() => import('../components/garage/GarageTab'));
const UnifiedMap = lazy(() => import('../components/map/NukeMap'));

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
  const marketSnapshot = useMarketSnapshot();
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

  const formatAvgPrice = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
    return `$${n.toLocaleString()}`;
  };

  const statItems = [
    { value: formatNum(landingStats.totalVehicles), label: 'VEHICLES' },
    { value: formatNum(landingStats.salePrices), label: 'SALE PRICES' },
    { value: formatNum(landingStats.totalComments), label: 'COMMENTS' },
  ];

  const showDropdown = searchFocused && searchInput.trim().length >= 2 && (searchResults.length > 0 || noResults);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '48px 24px 40px',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: 'Arial, sans-serif',
      }}
    >
      {/* Hero — stripped */}
      <div style={{ textAlign: 'center', maxWidth: 680, marginBottom: 40 }}>
        <h1
          style={{
            fontSize: 'clamp(36px, 7vw, 64px)',
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            margin: '0 0 8px',
            color: 'var(--text)',
          }}
        >
          NUKE
        </h1>
        <p
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            margin: '0 0 32px',
          }}
        >
          Vehicle data intelligence.
        </p>

        {/* Search bar */}
        <div ref={searchContainerRef} style={{ position: 'relative', maxWidth: 520, margin: '0 auto 20px' }}>
          <form
            onSubmit={handleSearch}
            style={{
              display: 'flex',
              gap: 0,
              border: '2px solid var(--border)',
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
                padding: '10px 16px',
                fontSize: 11,
                fontFamily: 'Arial, sans-serif',
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
                padding: '10px 24px',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                fontFamily: 'Arial, sans-serif',
                border: 'none',
                borderLeft: '2px solid var(--border)',
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

        {/* Single CTA */}
        <button
          onClick={onBrowse}
          style={{
            padding: '10px 28px',
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            border: '2px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Browse
        </button>
      </div>

      {/* Stats */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 48,
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        {statItems.map((s, i) => (
          <div
            key={s.label}
            style={{
              padding: '16px 32px',
              textAlign: 'center',
              borderRight: i < statItems.length - 1 ? '2px solid var(--border)' : 'none',
            }}
          >
            <div
              style={{
                fontSize: 'clamp(18px, 3vw, 24px)',
                fontWeight: 700,
                color: 'var(--text)',
                letterSpacing: '-0.02em',
                fontFamily: 'Courier New, monospace',
              }}
            >
              {s.value}
            </div>
            <div style={{ fontSize: 8, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Market Snapshot */}
      {marketSnapshot.length > 0 && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 48 }}>
          <div style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
            marginBottom: 12,
          }}>
            MARKET
          </div>
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
          }}>
            {marketSnapshot.map((row, i) => (
              <div
                key={row.make}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 16px',
                  borderBottom: i < marketSnapshot.length - 1 ? '1px solid var(--border)' : 'none',
                  gap: 12,
                }}
              >
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--text)',
                  flex: 1,
                  minWidth: 0,
                }}>
                  {row.make}
                </span>
                <span style={{
                  fontSize: 10,
                  color: 'var(--text-secondary)',
                  fontFamily: 'Courier New, monospace',
                  whiteSpace: 'nowrap',
                }}>
                  {Number(row.vehicle_count).toLocaleString()} vehicles
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text)',
                  fontFamily: 'Courier New, monospace',
                  whiteSpace: 'nowrap',
                  minWidth: 60,
                  textAlign: 'right',
                }}>
                  {formatAvgPrice(Number(row.avg_price))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Sales */}
      {showcaseVehicles.length > 0 && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48 }}>
          <div style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
            marginBottom: 12,
          }}>
            RECENT SALES
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
                  width: 180,
                  background: 'var(--surface)',
                  border: '2px solid var(--border)',
                  textDecoration: 'none',
                  color: 'var(--text)',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{
                  width: '100%',
                  height: 120,
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
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase' as const,
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
                      fontFamily: 'Courier New, monospace',
                      fontWeight: 700,
                      color: 'var(--text)',
                    }}>
                      {formatPrice(v)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <a
        href="https://nuke.ag"
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'var(--text-secondary)',
          textDecoration: 'none',
        }}
      >
        nuke.ag
      </a>
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
  const { setToolbarSlot } = useAppLayoutContext();

  const defaultTab = useMemo(() => {
    const fromUrl = searchParams.get('tab') as TabId | null;
    if (fromUrl && TABS.some((t) => t.id === fromUrl)) return fromUrl;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (fromStorage && TABS.some((t) => t.id === fromStorage)) return fromStorage;
    return 'feed';
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  // Garage dashboard state — lifted here so toolbar + GarageTab share it
  const garage = useVehiclesDashboard(user?.id);

  // Register / unregister the garage toolbar in the AppHeader
  useEffect(() => {
    if (activeTab === 'garage' && user && !garage.isLoading) {
      setToolbarSlot(
        <GarageToolbar
          vehicleCount={garage.vehicles.length}
          totalValue={garage.totalEstimatedValue}
          viewMode={garage.viewMode}
          sortMode={garage.sortMode}
          filterMode={garage.filterMode}
          onViewChange={garage.setViewMode}
          onSortChange={garage.setSortMode}
          onFilterChange={garage.setFilterMode}
        />
      );
    } else {
      setToolbarSlot(null);
    }
  }, [
    activeTab,
    user,
    garage.isLoading,
    garage.vehicles.length,
    garage.totalEstimatedValue,
    garage.viewMode,
    garage.sortMode,
    garage.filterMode,
    garage.setViewMode,
    garage.setSortMode,
    garage.setFilterMode,
    setToolbarSlot,
  ]);

  // Clean up toolbar on unmount
  useEffect(() => {
    return () => setToolbarSlot(null);
  }, [setToolbarSlot]);

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

  // Onboarding for first-time authenticated users
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!authLoading && user && !localStorage.getItem('nuke_onboarding_seen')) {
      setShowOnboarding(true);
    }
  }, [authLoading, user]);

  const handleOnboardingClose = () => {
    setShowOnboarding(false);
    localStorage.setItem('nuke_onboarding_seen', '1');
  };

  // Logged-out users with no explicit tab request see the landing page
  if (!authLoading && !user && !showFeed) {
    return <LandingHero onBrowse={() => setShowFeed(true)} />;
  }

  return (
    <div>
      {showOnboarding && (
        <OnboardingSlideshow isOpen={showOnboarding} onClose={handleOnboardingClose} />
      )}
      {/* Tab bar — only show for non-feed tabs (feed uses its own chrome) */}
      {activeTab !== 'feed' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'var(--surface)',
            flexShrink: 0,
            borderBottom: '2px solid var(--border)',
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
                  padding: '0 16px',
                  height: 30,
                  fontSize: 9,
                  fontFamily: 'Arial, sans-serif',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-disabled)',
                  cursor: 'pointer',
                  transition: 'color 180ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                  borderRadius: 0,
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)'; }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--text-disabled)'; }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Tab content — feed scrolls with window, map needs fixed height */}
      {activeTab === 'map' ? (
        <div style={{ height: 'calc(100vh - var(--header-height, 40px) - 30px)', overflow: 'hidden', position: 'relative' }}>
          <Suspense fallback={<TabSkeleton />}>
            <UnifiedMap />
          </Suspense>
        </div>
      ) : (
        <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'garage' && <GarageTab dashboard={garage} />}
          {activeTab === 'feed' && <FeedPage />}
        </Suspense>
      )}
    </div>
  );
}
