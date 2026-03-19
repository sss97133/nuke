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

/** All landing page data in one RPC call. */
interface LandingData {
  decades: { decade: number; vehicle_count: number; avg_price: number }[] | null;
  makes: { make: string; vehicle_count: number; avg_price: number }[] | null;
  price_brackets: { bracket: string; vehicle_count: number; min_price: number }[] | null;
  top_models: { make: string; model: string; vehicle_count: number; avg_price: number }[] | null;
  year_range: { min_year: number; max_year: number; distinct_years: number } | null;
}

function useLandingData() {
  const [data, setData] = useState<LandingData | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc('landing_page_data').then(({ data: result }) => {
      if (!cancelled && result) setData(result as unknown as LandingData);
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

/** Shared label styles */
const sectionLabel: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text-secondary)',
  marginBottom: 12,
};

/** Shared clickable row styles */
const rowButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  width: '100%',
  padding: '10px 16px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'Arial, sans-serif',
  gap: 12,
  position: 'relative',
};

function LandingHero({ onBrowse }: { onBrowse: () => void }) {
  const navigate = useNavigate();
  usePageTitle('Nuke — Vehicle Intelligence');
  const landingData = useLandingData();
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

  const showDropdown = searchFocused && searchInput.trim().length >= 2 && (searchResults.length > 0 || noResults);

  // Compute maxes for proportional bars
  const maxDecadeCount = landingData?.decades ? Math.max(...landingData.decades.map(d => d.vehicle_count)) : 1;
  const maxMakeCount = landingData?.makes ? Math.max(...landingData.makes.map(m => m.vehicle_count)) : 1;
  const maxBracketCount = landingData?.price_brackets ? Math.max(...landingData.price_brackets.map(p => p.vehicle_count)) : 1;

  // Price bracket → search params mapping
  const bracketParams: Record<string, string> = {
    'Under $25K': 'priceMax=25000',
    '$25K–$50K': 'priceMin=25000&priceMax=50000',
    '$50K–$100K': 'priceMin=50000&priceMax=100000',
    '$100K–$250K': 'priceMin=100000&priceMax=250000',
    '$250K–$500K': 'priceMin=250000&priceMax=500000',
    '$500K–$1M': 'priceMin=500000&priceMax=1000000',
    '$1M+': 'priceMin=1000000',
  };

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
      {/* Hero */}
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

      {/* Decade Timeline */}
      {landingData?.decades && landingData.year_range && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 48 }}>
          <div style={sectionLabel}>
            {landingData.year_range.min_year}–{landingData.year_range.max_year} · {landingData.year_range.distinct_years} YEARS OF AUCTION DATA
          </div>
          <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
            {landingData.decades.map((d, i) => {
              const pct = (d.vehicle_count / maxDecadeCount) * 100;
              return (
                <button
                  key={d.decade}
                  onClick={() => navigate(`/search?yearMin=${d.decade}&yearMax=${d.decade + 9}`)}
                  style={{
                    ...rowButton,
                    borderBottom: i < landingData.decades!.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: 'var(--text)',
                    minWidth: 36,
                    flexShrink: 0,
                  }}>
                    {d.decade}s
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', position: 'relative' }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'var(--text-secondary)',
                      opacity: 0.4,
                      transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }} />
                  </div>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    fontFamily: 'Courier New, monospace',
                    whiteSpace: 'nowrap',
                    minWidth: 52,
                    textAlign: 'right',
                  }}>
                    {d.vehicle_count.toLocaleString()}
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text)',
                    fontFamily: 'Courier New, monospace',
                    whiteSpace: 'nowrap',
                    minWidth: 50,
                    textAlign: 'right',
                  }}>
                    {formatAvgPrice(d.avg_price)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Market */}
      {landingData?.makes && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 48 }}>
          <div style={sectionLabel}>MARKET</div>
          <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
            {landingData.makes.map((row, i) => {
              const pct = (row.vehicle_count / maxMakeCount) * 100;
              return (
                <button
                  key={row.make}
                  onClick={() => navigate(`/search?make=${encodeURIComponent(row.make)}`)}
                  style={{
                    ...rowButton,
                    borderBottom: i < landingData.makes!.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  {/* Background proportion bar */}
                  <div style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${pct}%`,
                    background: 'var(--text-secondary)',
                    opacity: 0.06,
                    pointerEvents: 'none',
                  }} />
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text)',
                    flex: 1,
                    minWidth: 0,
                    position: 'relative',
                  }}>
                    {row.make}
                  </span>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    fontFamily: 'Courier New, monospace',
                    whiteSpace: 'nowrap',
                    position: 'relative',
                  }}>
                    {Number(row.vehicle_count).toLocaleString()}
                  </span>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: 'var(--text)',
                    fontFamily: 'Courier New, monospace',
                    whiteSpace: 'nowrap',
                    minWidth: 50,
                    textAlign: 'right',
                    position: 'relative',
                  }}>
                    {formatAvgPrice(Number(row.avg_price))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Price Distribution */}
      {landingData?.price_brackets && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 48 }}>
          <div style={sectionLabel}>PRICE DISTRIBUTION</div>
          <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
            {landingData.price_brackets.map((b, i) => {
              const pct = (b.vehicle_count / maxBracketCount) * 100;
              return (
                <button
                  key={b.bracket}
                  onClick={() => navigate(`/search?${bracketParams[b.bracket] || ''}`)}
                  style={{
                    ...rowButton,
                    borderBottom: i < landingData.price_brackets!.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    color: 'var(--text)',
                    minWidth: 90,
                    flexShrink: 0,
                  }}>
                    {b.bracket}
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', position: 'relative' }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'var(--text-secondary)',
                      opacity: 0.4,
                      transition: 'width 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }} />
                  </div>
                  <span style={{
                    fontSize: 10,
                    color: 'var(--text-secondary)',
                    fontFamily: 'Courier New, monospace',
                    whiteSpace: 'nowrap',
                    minWidth: 52,
                    textAlign: 'right',
                  }}>
                    {b.vehicle_count.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Models */}
      {landingData?.top_models && (
        <div style={{ width: '100%', maxWidth: 600, marginBottom: 48 }}>
          <div style={sectionLabel}>TOP MODELS</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 8,
          }}>
            {landingData.top_models.map((m) => (
              <button
                key={`${m.make}-${m.model}`}
                onClick={() => navigate(`/search?make=${encodeURIComponent(m.make)}&model=${encodeURIComponent(m.model)}`)}
                style={{
                  padding: '12px 16px',
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'Arial, sans-serif',
                  color: 'var(--text)',
                  transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}>
                  {m.model}
                </div>
                <div style={{
                  display: 'flex',
                  gap: 12,
                  fontSize: 10,
                  fontFamily: 'Courier New, monospace',
                }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {m.vehicle_count.toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 700 }}>
                    {formatAvgPrice(m.avg_price)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Sales */}
      {showcaseVehicles.length > 0 && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48 }}>
          <div style={sectionLabel}>RECENT SALES</div>
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
