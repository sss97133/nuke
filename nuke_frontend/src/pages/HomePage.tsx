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

/** v3 landing page data — single RPC, all sections. */
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

const OBSERVATION_DESCRIPTIONS: Record<string, string> = {
  media: 'Photographs, videos, and visual documentation. Each image is zone-classified (exterior, interior, engine bay, undercarriage, detail) and processed through multi-model vision analysis for condition assessment, component identification, and authenticity verification.',
  comment: 'Auction comments, forum posts, and social discussions. Analyzed for sentiment, technical claims, provenance hints, ownership history, and market signals. Comments are rhizomatic — they reveal vehicle condition, commenter expertise, auction mood, and geographic patterns simultaneously.',
  bid: 'Auction bid records with timestamps, amounts, and bidder identifiers. Used to reconstruct price discovery curves, identify bidding patterns, and calibrate market valuations across platforms and time periods.',
  spec: 'Factory specifications, build sheet data, RPO/option codes, and technical documentation. Cross-referenced against registry databases and service manual data to verify claimed configurations.',
  work_record: 'Service records, restoration logs, and maintenance history from shops and owners. Tied to actor records (shop/mechanic/owner) with location and timestamp for full provenance chains.',
  listing: 'Marketplace and auction listings with full seller descriptions, asking prices, and claimed specifications. Descriptions are treated as testimony with category-specific half-lives — mechanical claims decay faster than body claims.',
  provenance: 'Ownership chain documentation, title history, and registry records. Each transfer links to actor records with timestamps, creating a complete chain of custody from factory to present.',
  ownership: 'Current and historical owner records tied to the actor system. Includes purchase dates, locations, and relationship to the vehicle (daily driver, show car, investment, project).',
  sale: 'Completed transaction records with final prices, buyer/seller data, and sale conditions (reserve met, buy-it-now, negotiated). Used to build the definitive price history for each vehicle.',
  valuation: 'Professional appraisals, insurance valuations, and algorithmic estimates. Each valuation is scored by source authority and recency. Multiple valuations create a confidence-weighted price envelope.',
  condition: 'Structured condition assessments from inspections, vision analysis, and expert evaluations. Scored across body, mechanical, interior, and originality dimensions with photographic evidence links.',
};

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

const easeOut = '180ms cubic-bezier(0.16, 1, 0.3, 1)';

function LandingHero({ onBrowse }: { onBrowse: () => void }) {
  const navigate = useNavigate();
  usePageTitle('Nuke — Vehicle Intelligence');
  const d = useLandingDataV3();
  const [searchInput, setSearchInput] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const [expandedMake, setExpandedMake] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedKind, setExpandedKind] = useState<string | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [showAllMakes, setShowAllMakes] = useState(false);

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
    if (!n) return '--';
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${Math.round(n / 1_000).toLocaleString()}K`;
    return `$${n.toLocaleString()}`;
  };

  const fmtNum = (n: number) => n?.toLocaleString() ?? '--';

  const showDropdown = searchFocused && searchInput.trim().length >= 2 && (searchResults.length > 0 || noResults);

  // Treemap row slicing
  const makes = d?.makes || [];
  const row1 = makes.slice(0, 3);
  const row2 = makes.slice(3, 8);
  const row3 = makes.slice(8, 15);
  const row4 = makes.slice(15);

  // Models for expanded make
  const modelsForMake = expandedMake ? (d?.make_models || []).filter(m => m.make === expandedMake) : [];

  // Sources for expanded category
  const sourcesForCategory = expandedCategory ? (d?.sources || []).filter(s => s.category === expandedCategory) : [];

  // Pipeline columns for expanded table
  const columnsForTable = expandedTable ? (d?.pipeline_columns || []).filter(c => c.table_name === expandedTable) : [];

  // Max observation count for bar widths
  const maxObsCount = d?.observation_kinds ? Math.max(...d.observation_kinds.map(o => o.cnt)) : 1;

  const histograms = d?.price_histograms || {};

  const renderTreemapCell = (m: typeof makes[0], minHeight: number) => {
    const bins = histograms[m.make];
    return (
      <button
        key={m.make}
        onClick={() => setExpandedMake(expandedMake === m.make ? null : m.make)}
        style={{
          flex: m.vehicle_count,
          minHeight,
          padding: '8px 10px',
          border: '2px solid var(--border)',
          borderColor: expandedMake === m.make ? 'var(--text)' : 'var(--border)',
          background: 'var(--surface)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'Arial, sans-serif',
          color: 'var(--text)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          transition: `border-color ${easeOut}`,
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <div style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {m.make}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <span style={{ fontSize: 10, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)', flexShrink: 0 }}>{fmtNum(m.vehicle_count)}</span>
          {bins ? (
            <MiniDistribution bins={bins} width={Math.min(80, Math.max(40, m.vehicle_count / 100))} height={minHeight > 60 ? 20 : 14} />
          ) : (
            <span style={{ fontSize: 10, fontFamily: 'Courier New, monospace', fontWeight: 700 }}>{formatAvgPrice(m.avg_price)}</span>
          )}
        </div>
      </button>
    );
  };

  const renderMakeAccordion = () => {
    if (!expandedMake) return null;
    const bins = histograms[expandedMake];
    return (
      <div style={{
        width: '100%',
        padding: '8px 0',
        animation: 'fadeIn 180ms ease-out',
      }}>
        {/* Price distribution chart */}
        {bins && (
          <div style={{
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            padding: '12px 16px',
            marginBottom: 8,
          }}>
            <PriceDistributionChart bins={bins} make={expandedMake} />
          </div>
        )}
        {/* Model grid */}
        {modelsForMake.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 4,
          }}>
            {modelsForMake.map(mm => (
              <button
                key={`${mm.make}-${mm.model}`}
                onClick={() => navigate(`/search?make=${encodeURIComponent(mm.make)}&model=${encodeURIComponent(mm.model)}`)}
                style={{
                  padding: '8px 10px',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'Arial, sans-serif',
                  color: 'var(--text)',
                  transition: `border-color ${easeOut}`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {mm.model}
                </div>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, fontFamily: 'Courier New, monospace' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>{fmtNum(mm.vehicle_count)}</span>
                  <span style={{ fontWeight: 700 }}>{formatAvgPrice(mm.avg_price)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // Which row is the expanded make in?
  const expandedMakeRow = expandedMake
    ? row1.some(m => m.make === expandedMake) ? 1
    : row2.some(m => m.make === expandedMake) ? 2
    : row3.some(m => m.make === expandedMake) ? 3
    : row4.some(m => m.make === expandedMake) ? 4
    : 0
    : 0;

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
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* ─── Hero ─── */}
      <div style={{ textAlign: 'center', maxWidth: 680, marginBottom: 40 }}>
        <h1 style={{ fontSize: 'clamp(36px, 7vw, 64px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 8px', color: 'var(--text)' }}>
          NUKE
        </h1>
        <p style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', margin: '0 0 32px' }}>
          Vehicle data intelligence.
        </p>

        {/* Search bar */}
        <div ref={searchContainerRef} style={{ position: 'relative', maxWidth: 520, margin: '0 auto 20px' }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 0, border: '2px solid var(--border)' }}>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              placeholder="Search: 1967 Porsche 911, VIN, make, model..."
              aria-label="Search vehicles"
              style={{ flex: 1, padding: '10px 16px', fontSize: 11, fontFamily: 'Arial, sans-serif', border: 'none', background: 'var(--surface)', color: 'var(--text)', outline: 'none', minWidth: 0 }}
            />
            <button type="submit" style={{ padding: '10px 24px', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'Arial, sans-serif', border: 'none', borderLeft: '2px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
              Search
            </button>
          </form>
          {showDropdown && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', zIndex: 100 }}>
              {searchResults.map((v) => (
                <button
                  key={v.id}
                  onClick={() => { setSearchFocused(false); navigate(`/vehicle/${v.id}`); }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', padding: '10px 16px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', cursor: 'pointer', textAlign: 'left', fontSize: 13, fontFamily: 'Arial, sans-serif' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span>{[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle'}</span>
                  {formatPrice(v) && <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: 12 }}>{formatPrice(v)}</span>}
                </button>
              ))}
              {noResults && <div style={{ padding: '10px 16px', color: 'var(--text-secondary)', fontSize: 12 }}>No vehicles found for "{searchInput.trim()}"</div>}
            </div>
          )}
        </div>
        <button onClick={onBrowse} style={{ padding: '10px 28px', fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', border: '2px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          Browse
        </button>
      </div>

      {/* ─── 2. Platform Vitals ─── */}
      {d?.vitals && d?.platform && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48, border: '2px solid var(--border)', padding: '16px 20px' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
            gap: '12px 16px',
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
            ].map(([label, val]) => (
              <div key={label as string}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ fontSize: 14, fontFamily: 'Courier New, monospace', fontWeight: 700, color: 'var(--text)' }}>
                  {fmtNum(val as number)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 3. Market Treemap ─── */}
      {makes.length > 0 && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48 }}>
          <div style={sectionLabel}>MARKET</div>
          {/* Row 1: Top 3 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {row1.map(m => renderTreemapCell(m, 80))}
          </div>
          {expandedMakeRow === 1 && renderMakeAccordion()}
          {/* Row 2: Next 5 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {row2.map(m => renderTreemapCell(m, 64))}
          </div>
          {expandedMakeRow === 2 && renderMakeAccordion()}
          {/* Row 3: Next 7 */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {row3.map(m => renderTreemapCell(m, 52))}
          </div>
          {expandedMakeRow === 3 && renderMakeAccordion()}
          {/* Row 4: Remaining — collapsed by default */}
          {row4.length > 0 && (
            <>
              {showAllMakes ? (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                  {row4.map(m => renderTreemapCell(m, 44))}
                </div>
              ) : (
                <button
                  onClick={() => setShowAllMakes(true)}
                  style={{
                    width: '100%', padding: '8px', border: '2px solid var(--border)',
                    background: 'var(--surface)', cursor: 'pointer', fontFamily: 'Arial, sans-serif',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    color: 'var(--text-secondary)', textAlign: 'center',
                  }}
                >
                  +{row4.length} MORE MAKES
                </button>
              )}
              {expandedMakeRow === 4 && renderMakeAccordion()}
            </>
          )}
        </div>
      )}

      {/* ─── 4. Intelligence Network ─── */}
      {d?.source_categories && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48 }}>
          <div style={sectionLabel}>INTELLIGENCE NETWORK</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 4 }}>
            {d.source_categories.map(cat => (
              <div key={cat.category}>
                <button
                  onClick={() => setExpandedCategory(expandedCategory === cat.category ? null : cat.category)}
                  style={{
                    width: '100%', padding: '12px 14px', border: '2px solid var(--border)',
                    borderColor: expandedCategory === cat.category ? 'var(--text)' : 'var(--border)',
                    background: 'var(--surface)', cursor: 'pointer', textAlign: 'left',
                    fontFamily: 'Arial, sans-serif', color: 'var(--text)', transition: `border-color ${easeOut}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                      {cat.category}
                    </span>
                    <span style={{ fontSize: 10, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)' }}>
                      {cat.source_count}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)', minWidth: 28 }}>
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
                      }} />
                    </div>
                    <span style={{ fontSize: 9, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)', minWidth: 28, textAlign: 'right' }}>
                      {cat.max_trust}
                    </span>
                  </div>
                </button>
                {expandedCategory === cat.category && sourcesForCategory.length > 0 && (
                  <div style={{ border: '1px solid var(--border)', borderTop: 'none', background: 'var(--surface)', animation: 'fadeIn 180ms ease-out' }}>
                    {sourcesForCategory.map(s => (
                      <div key={s.slug} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {s.display_name}
                        </span>
                        <span style={{ fontSize: 10, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)', minWidth: 32, textAlign: 'right' }}>
                          {s.base_trust_score}
                        </span>
                        <div style={{ width: 80, height: 4, background: 'var(--border)', flexShrink: 0 }}>
                          <div style={{ width: `${s.base_trust_score * 100}%`, height: '100%', background: 'var(--text-secondary)', opacity: 0.4 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 5. Observation Graph ─── */}
      {d?.observation_kinds && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48 }}>
          <div style={sectionLabel}>OBSERVATIONS</div>
          <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
            {d.observation_kinds.map((ok, i) => (
              <div key={ok.kind}>
                <button
                  onClick={() => setExpandedKind(expandedKind === ok.kind ? null : ok.kind)}
                  style={{
                    ...rowButton,
                    borderBottom: i < d.observation_kinds!.length - 1 || expandedKind === ok.kind ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text)', minWidth: 90, flexShrink: 0 }}>
                    {ok.kind}
                  </span>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', position: 'relative' }}>
                    <div style={{
                      width: `${(ok.cnt / maxObsCount) * 100}%`, height: '100%',
                      background: 'var(--text-secondary)', opacity: 0.4,
                      transition: `width ${easeOut}`,
                    }} />
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'Courier New, monospace', whiteSpace: 'nowrap', minWidth: 64, textAlign: 'right' }}>
                    {fmtNum(ok.cnt)}
                  </span>
                </button>
                {expandedKind === ok.kind && OBSERVATION_DESCRIPTIONS[ok.kind] && (
                  <div style={{
                    padding: '10px 16px 12px', fontSize: 10, lineHeight: 1.5,
                    color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)',
                    animation: 'fadeIn 180ms ease-out',
                  }}>
                    {OBSERVATION_DESCRIPTIONS[ok.kind]}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 6. Schema Explorer ─── */}
      {d?.pipeline_tables && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48 }}>
          <div style={sectionLabel}>SCHEMA GOVERNANCE</div>
          <div style={{ border: '2px solid var(--border)', background: 'var(--surface)' }}>
            {/* Header */}
            <div style={{ display: 'flex', padding: '8px 16px', borderBottom: '1px solid var(--border)', fontSize: 8, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)', gap: 12 }}>
              <span style={{ flex: 1 }}>TABLE</span>
              <span style={{ minWidth: 64, textAlign: 'right' }}>GOVERNED</span>
              <span style={{ minWidth: 64, textAlign: 'right' }}>PROTECTED</span>
              <span style={{ minWidth: 64, textAlign: 'right' }}>FUNCTIONS</span>
            </div>
            {d.pipeline_tables.map((pt, i) => (
              <div key={pt.table_name}>
                <button
                  onClick={() => setExpandedTable(expandedTable === pt.table_name ? null : pt.table_name)}
                  style={{
                    ...rowButton,
                    borderBottom: i < d.pipeline_tables!.length - 1 || expandedTable === pt.table_name ? '1px solid var(--border)' : 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-secondary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ flex: 1, fontSize: 10, fontFamily: 'Courier New, monospace', fontWeight: 700 }}>
                    {pt.table_name}
                  </span>
                  <span style={{ minWidth: 64, textAlign: 'right', fontSize: 10, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)' }}>
                    {pt.governed_columns}
                  </span>
                  <span style={{ minWidth: 64, textAlign: 'right', fontSize: 10, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)' }}>
                    {pt.protected_columns}
                  </span>
                  <span style={{ minWidth: 64, textAlign: 'right', fontSize: 10, fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)' }}>
                    {pt.function_count}
                  </span>
                </button>
                {expandedTable === pt.table_name && columnsForTable.length > 0 && (
                  <div style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)', animation: 'fadeIn 180ms ease-out' }}>
                    {columnsForTable.map(col => (
                      <div key={col.column_name} style={{ display: 'flex', alignItems: 'center', padding: '5px 16px 5px 32px', gap: 12, borderBottom: '1px solid var(--border)', fontSize: 10 }}>
                        <span style={{ fontFamily: 'Courier New, monospace', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {col.column_name}
                        </span>
                        <span style={{ fontFamily: 'Courier New, monospace', color: 'var(--text-secondary)', fontSize: 9, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                          {col.owned_by}
                        </span>
                        {col.do_not_write_directly && (
                          <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-secondary)', flexShrink: 0 }} title="Protected — writes only via owning function">
                            PROTECTED
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 7. Recent Sales ─── */}
      {showcaseVehicles.length > 0 && (
        <div style={{ width: '100%', maxWidth: 900, marginBottom: 48 }}>
          <div style={sectionLabel}>RECENT SALES</div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 8, scrollbarWidth: 'thin' }}>
            {showcaseVehicles.map((v) => (
              <Link
                key={v.id}
                to={`/vehicle/${v.id}`}
                style={{
                  flexShrink: 0, width: 180, background: 'var(--surface)', border: '2px solid var(--border)',
                  textDecoration: 'none', color: 'var(--text)', display: 'flex', flexDirection: 'column',
                  overflow: 'hidden', transition: `border-color ${easeOut}`,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--text)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <div style={{ width: '100%', height: 120, overflow: 'hidden', background: 'var(--bg)' }}>
                  <img src={v.primary_image_url || ''} alt={`${v.year || ''} ${v.make || ''} ${v.model || ''}`.trim()} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const, lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}
                  </div>
                  {formatPrice(v) && (
                    <div style={{ fontSize: 11, fontFamily: 'Courier New, monospace', fontWeight: 700, color: 'var(--text)' }}>{formatPrice(v)}</div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ─── 8. Footer ─── */}
      <a href="https://nuke.ag" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-secondary)', textDecoration: 'none' }}>
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
            border: '1px solid var(--border)', animation: 'pulse 1.5s ease-in-out infinite',
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
                  transition: 'color 180ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1)', }}
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
