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
import { MiniDistribution, PriceDistributionChart } from '../components/charts/PriceDistribution';

// =============================================================================
// DATA HOOKS
// =============================================================================

interface LandingDataV3 {
  vitals: { total_vehicles: number; total_with_price: number; min_year: number; max_year: number; distinct_years: number; distinct_makes: number } | null;
  platform: { total_observations: number; total_images: number; total_comments: number; total_sources: number; schema_tables: number; schema_columns: number; vehicle_columns: number; pipeline_entries: number } | null;
  makes: { make: string; vehicle_count: number; avg_price: number; model_count: number }[] | null;
  make_models: { make: string; model: string; vehicle_count: number; avg_price: number }[] | null;
  price_histograms: Record<string, { b: number; n: number }[]> | null;
  source_categories: { category: string; source_count: number; avg_trust: number; min_trust: number; max_trust: number }[] | null;
  sources: { slug: string; display_name: string; category: string; base_trust_score: number }[] | null;
  observation_kinds: { kind: string; cnt: number }[] | null;
  pipeline_tables: { table_name: string; governed_columns: number; protected_columns: number; function_count: number }[] | null;
  pipeline_columns: { table_name: string; column_name: string; owned_by: string; do_not_write_directly: boolean; description: string | null }[] | null;
}

function useLandingDataV3() {
  const [data, setData] = useState<LandingDataV3 | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.rpc('landing_page_v3_cached').then(({ data: result }) => {
      if (!cancelled && result) setData(result as unknown as LandingDataV3);
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

function useLiveShowcase() {
  const [vehicles, setVehicles] = useState<ShowcaseVehicle[]>([]);
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
      const { data } = await q
        .not('sale_price', 'is', null)
        .gt('sale_price', 1000)
        .order('created_at', { ascending: false })
        .limit(20);
      if (data && data.length > 0) setVehicles(data);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [load]);
  return vehicles;
}

interface SearchPreviewResult {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  sale_price: number | null;
  asking_price: number | null;
  primary_image_url: string | null;
}

function useSearchPreview(query: string) {
  const [results, setResults] = useState<SearchPreviewResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setNoResults(false); return; }
    setLoading(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const words = q.split(/\s+/).filter(w => w.length > 0);
        let builder = supabase
          .from('vehicles')
          .select('id, year, make, model, sale_price, asking_price, primary_image_url');
        builder = applyNonAutoFilters(builder);
        for (const word of words) {
          builder = builder.or(`make.ilike.%${word}%,model.ilike.%${word}%,vin.ilike.%${word}%`);
        }
        const yearMatch = q.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) builder = builder.eq('year', parseInt(yearMatch[0]));
        const { data, error } = await builder.limit(6);
        if (error) throw error;
        setResults(data || []);
        setNoResults((data || []).length === 0);
      } catch { setResults([]); setNoResults(false); }
      finally { setLoading(false); }
    }, 300);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [query]);
  return { results, loading, noResults };
}

// =============================================================================
// ANIMATED COMPONENTS
// =============================================================================

/** Smoothly counts from 0 to target over duration ms */
function AnimatedNumber({ value, duration = 1200 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    if (!value) { setDisplay(0); return; }
    startRef.current = null;
    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * value));
      if (progress < 1) frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  return <>{display.toLocaleString()}</>;
}

/** Continuous auto-scrolling marquee */
function LiveMarquee({ children, speed = 30 }: { children: React.ReactNode; speed?: number }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    if (innerRef.current) {
      setContentWidth(innerRef.current.scrollWidth / 2); // we duplicate content
    }
  }, [children]);

  useEffect(() => {
    if (!contentWidth || paused) return;
    const animate = (ts: number) => {
      if (!lastRef.current) lastRef.current = ts;
      const dt = (ts - lastRef.current) / 1000;
      lastRef.current = ts;
      setOffset(prev => {
        const next = prev + speed * dt;
        return next >= contentWidth ? next - contentWidth : next;
      });
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [contentWidth, speed, paused]);

  return (
    <div
      ref={outerRef}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => { setPaused(false); lastRef.current = 0; }}
      style={{ overflow: 'hidden', width: '100%' }}
    >
      <div
        ref={innerRef}
        style={{
          display: 'flex',
          gap: 8,
          transform: `translateX(-${offset}px)`,
          willChange: 'transform',
        }}
      >
        {children}
        {children}
      </div>
    </div>
  );
}

// =============================================================================
// VEHICLE DRILL-DOWN (Make → Model → Vehicles)
// =============================================================================

interface DrillVehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  primary_image_url: string | null;
  sale_price: number | null;
  asking_price: number | null;
  mileage: number | null;
  color: string | null;
}

function useModelVehicles(make: string | null, model: string | null) {
  const [vehicles, setVehicles] = useState<DrillVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!make || !model) { setVehicles([]); setTotal(0); return; }
    setLoading(true);
    let cancelled = false;

    (async () => {
      try {
        let q = supabase
          .from('vehicles')
          .select('id, year, make, model, primary_image_url, sale_price, asking_price, mileage, color', { count: 'exact' })
          .ilike('make', `%${make}%`)
          .ilike('model', `%${model}%`)
          .neq('status', 'deleted')
          .neq('status', 'pending')
          .order('sale_price', { ascending: false, nullsFirst: false })
          .limit(12);
        q = applyNonAutoFilters(q);
        const { data, count, error } = await q;
        if (!cancelled && !error) {
          setVehicles(data || []);
          setTotal(count ?? data?.length ?? 0);
        }
      } catch (e) { console.error('[useModelVehicles] catch:', e); }
      finally { if (!cancelled) setLoading(false); }
    })();

    return () => { cancelled = true; };
  }, [make, model]);

  return { vehicles, loading, total };
}

// =============================================================================
// FORMATTING
// =============================================================================

const fmtNum = (n: number) => n?.toLocaleString() ?? '--';

const formatPrice = (v: { sale_price?: number | null; asking_price?: number | null }) => {
  const p = v.sale_price || v.asking_price;
  if (!p) return null;
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(1)}M`;
  if (p >= 1_000) return `$${Math.round(p / 1_000).toLocaleString()}K`;
  return `$${p.toLocaleString()}`;
};

const formatAvgPrice = (n: number) => {
  if (!n) return '--';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
  return `$${n.toLocaleString()}`;
};

const formatMileage = (m: number | null) => {
  if (!m) return null;
  if (m >= 1000) return `${Math.round(m / 1000).toLocaleString()}K mi`;
  return `${m} mi`;
};

// =============================================================================
// STYLES
// =============================================================================

const EASE = '220ms cubic-bezier(0.16, 1, 0.3, 1)';

const GLOBAL_STYLES = `
  @keyframes fadeSlideIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.4; }
    50% { opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }
  @keyframes slideDown {
    from { opacity: 0; max-height: 0; }
    to { opacity: 1; max-height: 2000px; }
  }
  @keyframes liveDot {
    0%, 100% { box-shadow: 0 0 0 0 rgba(22, 130, 93, 0.5); }
    50% { box-shadow: 0 0 0 4px rgba(22, 130, 93, 0); }
  }
`;

// =============================================================================
// MODEL DRILL-DOWN PANEL
// =============================================================================

function ModelDrillDown({ make, model, onClose }: { make: string; model: string; onClose: () => void }) {
  const navigate = useNavigate();
  const { vehicles, loading, total } = useModelVehicles(make, model);

  return (
    <div style={{
      padding: '12px 0',
      animation: 'fadeSlideIn 250ms ease-out',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '0 4px', marginBottom: 8,
      }}>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
          {loading ? 'Loading...' : `${total.toLocaleString()} vehicles`}
        </span>
        <button
          onClick={() => navigate(`/search?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`)}
          style={{
            padding: '4px 12px', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
            textTransform: 'uppercase', border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-secondary)', cursor: 'pointer',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          View All
        </button>
      </div>
      {vehicles.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 4,
        }}>
          {vehicles.map(v => (
            <Link
              key={v.id}
              to={`/vehicle/${v.id}`}
              style={{
                display: 'flex', flexDirection: 'column', border: '1px solid var(--border)',
                background: 'var(--surface)', textDecoration: 'none', color: 'var(--text)',
                overflow: 'hidden', transition: `border-color ${EASE}`,
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div style={{ width: '100%', height: 100, overflow: 'hidden', background: 'var(--bg)' }}>
                <img
                  src={v.primary_image_url || ''}
                  alt={`${v.year} ${v.make} ${v.model}`}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transition: `transform 300ms ease` }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                />
              </div>
              <div style={{ padding: '6px 8px' }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.02em',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
                }}>
                  {[v.year, v.model].filter(Boolean).join(' ')}
                </div>
                <div style={{ display: 'flex', gap: 6, fontSize: 10, fontFamily: "'Courier New', monospace" }}>
                  {formatPrice(v) && <span style={{ fontWeight: 700 }}>{formatPrice(v)}</span>}
                  {v.color && <span style={{ color: 'var(--text-secondary)' }}>{v.color}</span>}
                </div>
                {v.mileage && (
                  <div style={{ fontSize: 9, color: 'var(--text-secondary)', fontFamily: "'Courier New', monospace", marginTop: 1 }}>
                    {formatMileage(v.mileage)}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// LANDING HERO
// =============================================================================

function LandingHero({ onBrowse }: { onBrowse: () => void }) {
  const navigate = useNavigate();
  usePageTitle('Nuke — Vehicle Intelligence');
  const d = useLandingDataV3();
  const showcaseVehicles = useLiveShowcase();
  const [searchInput, setSearchInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const { results: searchResults, noResults } = useSearchPreview(searchInput);

  // Treemap drill-down state
  const [expandedMake, setExpandedMake] = useState<string | null>(null);
  const [expandedModel, setExpandedModel] = useState<{ make: string; model: string } | null>(null);
  const [showAllMakes, setShowAllMakes] = useState(false);

  // Visibility tracking for staggered animations
  const [sectionsVisible, setSectionsVisible] = useState<Record<string, boolean>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            setSectionsVisible(prev => ({ ...prev, [e.target.id]: true }));
          }
        });
      },
      { threshold: 0.1 }
    );
    return () => observerRef.current?.disconnect();
  }, []);

  const trackRef = useCallback((el: HTMLElement | null) => {
    if (el && observerRef.current) observerRef.current.observe(el);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (q) navigate(`/search?q=${encodeURIComponent(q)}`);
    else navigate('/search');
  };

  const showDropdown = searchFocused && searchInput.trim().length >= 2 && (searchResults.length > 0 || noResults);

  // Treemap data
  const makes = d?.makes || [];
  const row1 = makes.slice(0, 3);
  const row2 = makes.slice(3, 8);
  const row3 = makes.slice(8, 15);
  const row4 = makes.slice(15);
  const histograms = d?.price_histograms || {};
  const modelsForMake = expandedMake ? (d?.make_models || []).filter(m => m.make === expandedMake) : [];

  const expandedMakeRow = expandedMake
    ? row1.some(m => m.make === expandedMake) ? 1
    : row2.some(m => m.make === expandedMake) ? 2
    : row3.some(m => m.make === expandedMake) ? 3
    : row4.some(m => m.make === expandedMake) ? 4
    : 0 : 0;

  // ── Treemap Cell ──
  const renderTreemapCell = (m: typeof makes[0], minHeight: number) => {
    const bins = histograms[m.make];
    const isExpanded = expandedMake === m.make;
    return (
      <button
        key={m.make}
        onClick={() => {
          setExpandedMake(isExpanded ? null : m.make);
          setExpandedModel(null);
        }}
        style={{
          flex: m.vehicle_count,
          minHeight,
          padding: '8px 10px',
          border: '2px solid var(--border)',
          borderColor: isExpanded ? 'var(--text)' : 'var(--border)',
          background: isExpanded ? 'var(--bg)' : 'var(--surface)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'Arial, sans-serif',
          color: 'var(--text)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: `border-color ${EASE}, background ${EASE}`,
          overflow: 'hidden',
          minWidth: 0,
        }}
        onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
        onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.borderColor = 'var(--border)'; }}
      >
        <div style={{
          fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {m.make}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <span style={{ fontSize: 13, fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)', flexShrink: 0 }}>
            {fmtNum(m.vehicle_count)}
          </span>
          {bins ? (
            <MiniDistribution bins={bins} width={Math.min(80, Math.max(40, m.vehicle_count / 100))} height={minHeight > 60 ? 20 : 14} />
          ) : (
            <span style={{ fontSize: 11, fontFamily: "'Courier New', monospace", fontWeight: 700 }}>
              {formatAvgPrice(m.avg_price)}
            </span>
          )}
        </div>
      </button>
    );
  };

  // ── Make Accordion (shows models + price dist + drill to vehicles) ──
  const renderMakeAccordion = () => {
    if (!expandedMake) return null;
    const bins = histograms[expandedMake];
    return (
      <div style={{
        width: '100%', padding: '8px 0',
        animation: 'fadeSlideIn 250ms ease-out',
        overflow: 'hidden',
      }}>
        {bins && (
          <div style={{
            border: '2px solid var(--border)', background: 'var(--surface)',
            padding: '12px 16px', marginBottom: 8,
          }}>
            <PriceDistributionChart bins={bins} make={expandedMake} />
          </div>
        )}
        {modelsForMake.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 4,
          }}>
            {modelsForMake.map((mm, i) => {
              const isModelExpanded = expandedModel?.make === mm.make && expandedModel?.model === mm.model;
              return (
                <React.Fragment key={`${mm.make}-${mm.model}`}>
                  <button
                    onClick={() => setExpandedModel(isModelExpanded ? null : { make: mm.make, model: mm.model })}
                    style={{
                      padding: '8px 10px',
                      border: '1px solid var(--border)',
                      borderColor: isModelExpanded ? 'var(--text)' : 'var(--border)',
                      background: isModelExpanded ? 'var(--bg)' : 'var(--surface)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'Arial, sans-serif',
                      color: 'var(--text)',
                      transition: `border-color ${EASE}, background ${EASE}`,
                      animation: `fadeSlideIn ${180 + i * 30}ms ease-out`,
                    }}
                    onMouseEnter={e => { if (!isModelExpanded) e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
                    onMouseLeave={e => { if (!isModelExpanded) e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    <div style={{
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {mm.model}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 13, fontFamily: "'Courier New', monospace" }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{fmtNum(mm.vehicle_count)}</span>
                      <span style={{ fontWeight: 700 }}>{formatAvgPrice(mm.avg_price)}</span>
                    </div>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
        {/* Vehicle drill-down for expanded model */}
        {expandedModel && expandedModel.make === expandedMake && (
          <ModelDrillDown
            make={expandedModel.make}
            model={expandedModel.model}
            onClose={() => setExpandedModel(null)}
          />
        )}
      </div>
    );
  };

  const maxObsCount = d?.observation_kinds ? Math.max(...d.observation_kinds.map(o => o.cnt)) : 1;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '48px 24px 40px', background: 'var(--bg)', color: 'var(--text)',
      fontFamily: 'Arial, sans-serif',
    }}>
      <style>{GLOBAL_STYLES}</style>

      {/* ─── Hero ─── */}
      <div style={{ textAlign: 'center', maxWidth: 800, width: '100%', marginBottom: 32 }}>
        <h1 style={{
          fontSize: 'clamp(36px, 7vw, 64px)', fontWeight: 700,
          letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 8px',
        }}>
          NUKE
        </h1>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', margin: '0 0 28px' }}>
          Full-resolution vehicle ontology. Every field cites its source.
        </p>

        {/* Search bar */}
        <div ref={searchContainerRef} style={{ position: 'relative', maxWidth: 640, margin: '0 auto 16px' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 0, border: '2px solid var(--border)', transition: `border-color ${EASE}` }}>
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              placeholder="Search: 1967 Porsche 911, VIN, make, model..."
              aria-label="Search vehicles"
              style={{
                flex: 1, padding: '10px 16px', fontSize: 12, fontFamily: 'Arial, sans-serif',
                border: 'none', background: 'var(--surface)', color: 'var(--text)', outline: 'none', minWidth: 0,
              }}
            />
            <button type="submit" style={{
              padding: '10px 24px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
              textTransform: 'uppercase', fontFamily: 'Arial, sans-serif', border: 'none',
              borderLeft: '2px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
            }}>
              Search
            </button>
          </form>
          {showDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0,
              background: 'var(--surface)', border: '1px solid var(--border)',
              zIndex: 100, animation: 'fadeSlideIn 150ms ease-out',
            }}>
              {searchResults.map(v => (
                <button
                  key={v.id}
                  onClick={() => { setSearchFocused(false); navigate(`/vehicle/${v.id}`); }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    width: '100%', padding: '8px 16px', border: 'none',
                    borderBottom: '1px solid var(--border)', background: 'transparent',
                    color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
                    fontSize: 12, fontFamily: 'Arial, sans-serif', gap: 12,
                    transition: `background ${EASE}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {v.primary_image_url && (
                      <img
                        src={v.primary_image_url}
                        alt=""
                        style={{ width: 40, height: 28, objectFit: 'cover', flexShrink: 0 }}
                      />
                    )}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle'}
                    </span>
                  </div>
                  {formatPrice(v) && (
                    <span style={{ fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)', fontSize: 11, flexShrink: 0 }}>
                      {formatPrice(v)}
                    </span>
                  )}
                </button>
              ))}
              {noResults && (
                <div style={{ padding: '10px 16px', color: 'var(--text-secondary)', fontSize: 11 }}>
                  No vehicles found for "{searchInput.trim()}"
                </div>
              )}
            </div>
          )}
        </div>
        <button onClick={onBrowse} style={{
          padding: '10px 28px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', border: '2px solid var(--border)', background: 'transparent',
          color: 'var(--text-secondary)', cursor: 'pointer', transition: `all ${EASE}`,
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          Browse
        </button>
      </div>

      {/* ─── Live Showcase Marquee ─── */}
      {showcaseVehicles.length > 0 && (
        <div style={{ width: '100vw', marginLeft: 'calc(-50vw + 50%)', marginBottom: 40 }}>
          <LiveMarquee speed={35}>
            {showcaseVehicles.map(v => (
              <Link
                key={v.id}
                to={`/vehicle/${v.id}`}
                style={{
                  flexShrink: 0, width: 280, background: 'var(--surface)',
                  border: '1px solid var(--border)', textDecoration: 'none',
                  color: 'var(--text)', display: 'flex', flexDirection: 'column',
                  overflow: 'hidden', transition: `border-color ${EASE}, transform 200ms ease`,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                <div style={{ width: '100%', height: 180, overflow: 'hidden', background: 'var(--bg)' }}>
                  <img
                    src={v.primary_image_url || ''}
                    alt={`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{
                    fontSize: 12, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                    lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3,
                  }}>
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}
                  </div>
                  {formatPrice(v) && (
                    <div style={{ fontSize: 15, fontFamily: "'Courier New', monospace", fontWeight: 700 }}>
                      {formatPrice(v)}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </LiveMarquee>
        </div>
      )}

      {/* ─── Platform Vitals ─── */}
      {d?.vitals && d?.platform && (
        <div
          id="section-vitals"
          ref={trackRef}
          style={{
            width: '100%', maxWidth: 1200, marginBottom: 48,
            border: '2px solid var(--border)', padding: '16px 20px',
            opacity: sectionsVisible['section-vitals'] ? 1 : 0,
            transform: sectionsVisible['section-vitals'] ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 600ms ease-out, transform 600ms ease-out',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', background: 'var(--success)',
              animation: 'liveDot 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
              LIVE
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '20px 24px',
            textAlign: 'center',
          }}>
            {[
              ['VEHICLES', d.vitals.total_vehicles],
              ['OBSERVATIONS', d.platform.total_observations],
              ['IMAGES', d.platform.total_images],
              ['COMMENTS', d.platform.total_comments],
              ['SOURCES', d.platform.total_sources],
              ['COLUMNS', d.platform.schema_columns],
              ['TABLES', d.platform.schema_tables],
              ['PIPELINES', d.platform.pipeline_entries],
            ].map(([label, val], i) => (
              <div key={label as string} style={{ animation: `fadeSlideIn ${400 + i * 80}ms ease-out` }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'var(--text-secondary)', marginBottom: 4,
                }}>
                  {label}
                </div>
                <div style={{
                  fontSize: 22, fontFamily: "'Courier New', monospace", fontWeight: 700, color: 'var(--text)',
                }}>
                  <AnimatedNumber value={val as number} duration={1200 + i * 100} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Market Treemap ─── */}
      {makes.length > 0 && (
        <div
          id="section-market"
          ref={trackRef}
          style={{
            width: '100%', maxWidth: 1200, marginBottom: 48,
            opacity: sectionsVisible['section-market'] ? 1 : 0,
            transform: sectionsVisible['section-market'] ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 600ms ease-out 200ms, transform 600ms ease-out 200ms',
          }}
        >
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--text-secondary)', marginBottom: 14,
          }}>
            MARKET
          </div>
          {/* Row 1: Top 3 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {row1.map(m => renderTreemapCell(m, 100))}
          </div>
          {expandedMakeRow === 1 && renderMakeAccordion()}
          {/* Row 2: Next 5 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {row2.map(m => renderTreemapCell(m, 76))}
          </div>
          {expandedMakeRow === 2 && renderMakeAccordion()}
          {/* Row 3: Next 7 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {row3.map(m => renderTreemapCell(m, 64))}
          </div>
          {expandedMakeRow === 3 && renderMakeAccordion()}
          {/* Row 4: Remaining */}
          {row4.length > 0 && (
            <>
              {showAllMakes ? (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {row4.map(m => renderTreemapCell(m, 56))}
                </div>
              ) : (
                <button
                  onClick={() => setShowAllMakes(true)}
                  style={{
                    width: '100%', padding: '10px', border: '2px solid var(--border)',
                    background: 'var(--surface)', cursor: 'pointer', fontFamily: 'Arial, sans-serif',
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--text-secondary)', textAlign: 'center', transition: `all ${EASE}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text)'; e.currentTarget.style.color = 'var(--text)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                >
                  +{row4.length} MORE MAKES
                </button>
              )}
              {expandedMakeRow === 4 && renderMakeAccordion()}
            </>
          )}
        </div>
      )}

      {/* ─── Observation Kinds ─── */}
      {d?.observation_kinds && (
        <div
          id="section-observations"
          ref={trackRef}
          style={{
            width: '100%', maxWidth: 1200, marginBottom: 48,
            opacity: sectionsVisible['section-observations'] ? 1 : 0,
            transform: sectionsVisible['section-observations'] ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 600ms ease-out 300ms, transform 600ms ease-out 300ms',
          }}
        >
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--text-secondary)', marginBottom: 14,
          }}>
            OBSERVATIONS
          </div>
          <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
            {d.observation_kinds.map((ok, i) => (
              <div
                key={ok.kind}
                style={{
                  display: 'flex', alignItems: 'center', width: '100%',
                  padding: '10px 16px', gap: 12,
                  borderBottom: i < d.observation_kinds!.length - 1 ? '1px solid var(--border)' : 'none',
                }}
              >
                <span style={{
                  fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: 'var(--text)', minWidth: 120, flexShrink: 0,
                }}>
                  {ok.kind}
                </span>
                <div style={{ flex: 1, height: 6, background: 'var(--border)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    width: `${(ok.cnt / maxObsCount) * 100}%`, height: '100%',
                    background: 'var(--text-secondary)', opacity: 0.5,
                    transition: `width 800ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 60}ms`,
                  }} />
                </div>
                <span style={{
                  fontSize: 13, color: 'var(--text-secondary)', fontFamily: "'Courier New', monospace",
                  whiteSpace: 'nowrap', minWidth: 80, textAlign: 'right',
                }}>
                  {fmtNum(ok.cnt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Intelligence Network ─── */}
      {d?.source_categories && (
        <div
          id="section-intel"
          ref={trackRef}
          style={{
            width: '100%', maxWidth: 1200, marginBottom: 48,
            opacity: sectionsVisible['section-intel'] ? 1 : 0,
            transform: sectionsVisible['section-intel'] ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 600ms ease-out 400ms, transform 600ms ease-out 400ms',
          }}
        >
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--text-secondary)', marginBottom: 14,
          }}>
            INTELLIGENCE NETWORK — {d.source_categories.reduce((s, c) => s + c.source_count, 0)} SOURCES
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 4 }}>
            {d.source_categories.map(cat => (
              <div
                key={cat.category}
                style={{
                  padding: '14px 16px', border: '2px solid var(--border)', background: 'var(--surface)',
                  transition: `border-color ${EASE}`,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--text-secondary)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    {cat.category}
                  </span>
                  <span style={{ fontSize: 13, fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)' }}>
                    {cat.source_count}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 10, fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)', minWidth: 28 }}>
                    {cat.min_trust}
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', position: 'relative' }}>
                    <div style={{
                      position: 'absolute', left: `${cat.min_trust * 100}%`, right: `${(1 - cat.max_trust) * 100}%`,
                      top: 0, bottom: 0, background: 'var(--text-secondary)', opacity: 0.4,
                    }} />
                    <div style={{
                      position: 'absolute', left: `${cat.avg_trust * 100}%`, top: -2,
                      width: 3, height: 8, background: 'var(--text)',
                      transition: `left 600ms ease-out`,
                    }} />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)', minWidth: 28, textAlign: 'right' }}>
                    {cat.max_trust}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Footer ─── */}
      <a href="https://nuke.ag" style={{
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
        color: 'var(--text-secondary)', textDecoration: 'none',
      }}>
        nuke.ag
      </a>
    </div>
  );
}

// =============================================================================
// HOMEPAGE WRAPPER (Auth-aware: Landing for guests, Tabs for users)
// =============================================================================

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

function TabSkeleton() {
  return (
    <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'Arial, sans-serif' }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{
          height: 80, background: 'var(--surface)', border: '1px solid var(--border)',
          animation: 'pulse 1.5s ease-in-out infinite',
        }} />
      ))}
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
    if (fromUrl && TABS.some(t => t.id === fromUrl)) return fromUrl;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (fromStorage && TABS.some(t => t.id === fromStorage)) return fromStorage;
    return 'feed';
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);
  const garage = useVehiclesDashboard(user?.id);

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
  }, [activeTab, user, garage.isLoading, garage.vehicles.length, garage.totalEstimatedValue, garage.viewMode, garage.sortMode, garage.filterMode, garage.setViewMode, garage.setSortMode, garage.setFilterMode, setToolbarSlot]);

  useEffect(() => () => setToolbarSlot(null), [setToolbarSlot]);

  useEffect(() => {
    if (authLoading) return;
    const fromUrl = searchParams.get('tab') as TabId | null;
    const fromStorage = localStorage.getItem(LS_KEY) as TabId | null;
    if (!fromUrl && !fromStorage) setActiveTab('feed');
    if (!user && fromUrl) setShowFeed(true);
  }, [authLoading, user]);

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    localStorage.setItem(LS_KEY, tab);
    setSearchParams(tab === 'garage' && user ? {} : { tab }, { replace: true });
  };

  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (!authLoading && user && !localStorage.getItem('nuke_onboarding_seen')) setShowOnboarding(true);
  }, [authLoading, user]);
  const handleOnboardingClose = () => { setShowOnboarding(false); localStorage.setItem('nuke_onboarding_seen', '1'); };

  if (!authLoading && !user && !showFeed) {
    return <LandingHero onBrowse={() => setShowFeed(true)} />;
  }

  return (
    <div>
      {showOnboarding && <OnboardingSlideshow isOpen={showOnboarding} onClose={handleOnboardingClose} />}
      {activeTab !== 'feed' && (
        <div style={{
          display: 'flex', alignItems: 'center', background: 'var(--surface)',
          flexShrink: 0, borderBottom: '2px solid var(--border)', height: 30,
        }}>
          {TABS.map(tab => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                aria-selected={active}
                style={{
                  padding: '0 16px', height: 30, fontSize: 10, fontFamily: 'Arial, sans-serif',
                  fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', border: 'none',
                  borderBottom: active ? '2px solid var(--text)' : '2px solid transparent',
                  background: active ? 'var(--bg)' : 'transparent',
                  color: active ? 'var(--text)' : 'var(--text-disabled)', cursor: 'pointer',
                  transition: `color ${EASE}, background ${EASE}`,
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)'; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-disabled)'; }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      )}
      {activeTab === 'map' ? (
        <div style={{ height: 'calc(100vh - var(--header-height, 40px) - 30px)', overflow: 'hidden', position: 'relative' }}>
          <Suspense fallback={<TabSkeleton />}><UnifiedMap /></Suspense>
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
