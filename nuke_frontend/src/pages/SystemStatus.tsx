import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

const estimate = (value: number | null) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `≈${value.toLocaleString()}` : 'Unmeasured';
const measuredCount = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : 'Unmeasured';

type ExpandedSection = 'tier1' | 'catalog' | 'vehicles' | 'auctions' | null;

export default function SystemStatus() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<any>(null);
  const [recentImages, setRecentImages] = useState<any[]>([]);
  const [recentParts, setRecentParts] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const [listData, setListData] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<any>(null);
  const [pulse, setPulse] = useState<any>(null);
  const [pulseError, setPulseError] = useState(false);
  const [statsError, setStatsError] = useState(false);
  const statsLoading = useRef(false);
  const pulseLoading = useRef(false);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Row arrivals measure throughput; neither throughput nor job exits verify data quality.
  useEffect(() => {
    const loadPulse = async () => {
      if (pulseLoading.current) return;
      pulseLoading.current = true;
      try {
        const { data, error } = await supabase.rpc('get_pipeline_pulse', { p_days: 14 }).abortSignal(AbortSignal.timeout(10_000));
        if (error || !data || data.error || !data.organs || !Number.isInteger(data.days) || data.days < 1 || data.days > 31
          || !Number.isFinite(Date.parse(data.generated_at))
          || (data.degraded != null && (!Array.isArray(data.degraded) || !data.degraded.every((item: unknown) => typeof item === 'string')))) throw new Error('pulse unavailable');
        setPulse(data);
        setPulseError(false);
      } catch { setPulseError(true); }
      finally { pulseLoading.current = false; }
    };
    loadPulse();
    const t = setInterval(loadPulse, 60_000);
    return () => clearInterval(t);
  }, []);

  const loadListData = async (section: ExpandedSection) => {
    if (!section) return;
    
    try {
      if (section === 'tier1') {
        const { data } = await supabase
          .from('vehicle_images')
          .select('id, image_url, ai_processing_status, ai_scan_metadata, created_at')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      } else if (section === 'catalog') {
        const { data } = await supabase
          .from('catalog_parts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      } else if (section === 'vehicles') {
        const { data } = await supabase
          .from('vehicles')
          .select('id, year, make, model, status, created_at')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      } else if (section === 'auctions') {
        const { data } = await supabase
          .from('auction_events')
          .select('id, listing_url, outcome, high_bid, created_at')
          .order('created_at', { ascending: false })
          .limit(100);
        setListData(data || []);
      }
    } catch (error) {
      console.error('Error loading list:', error);
    }
  };

  const handlePanelClick = (section: ExpandedSection) => {
    if (expandedSection === section) {
      setExpandedSection(null);
      setListData([]);
    } else {
      setExpandedSection(section);
      loadListData(section);
    }
  };

  async function loadStats() {
    if (statsLoading.current) return;
    statsLoading.current = true;
    const readSignal = AbortSignal.timeout(8_000);
    try {
      // Get image counts
      const { count: totalImages, error: totalImagesError } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal);

      const { count: analyzedImages, error: analyzedImagesError } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal)
        .eq('ai_processing_status', 'completed');

      const { count: pendingImages, error: pendingImagesError } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal)
        .eq('ai_processing_status', 'pending');

      const { count: failedImages, error: failedImagesError } = await supabase
        .from('vehicle_images')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal)
        .eq('ai_processing_status', 'failed');

      // Get catalog counts
      const { count: totalParts, error: totalPartsError } = await supabase
        .from('catalog_parts')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal);

      const { count: chunksDone, error: chunksDoneError } = await supabase
        .from('catalog_text_chunks')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal)
        .eq('status', 'completed');

      const { count: chunksPending, error: chunksPendingError } = await supabase
        .from('catalog_text_chunks')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal)
        .eq('status', 'pending');

      // Get vehicle counts
      const { count: totalVehicles, error: totalVehiclesError } = await supabase
        .from('vehicles')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal);

      const { count: activeVehicles, error: activeVehiclesError } = await supabase
        .from('vehicles')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal)
        .eq('status', 'active');

      const { count: pendingVehicles, error: pendingVehiclesError } = await supabase
        .from('vehicles')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal)
        .eq('status', 'pending');

      // Get auction stats
      const { count: totalAuctions, error: totalAuctionsError } = await supabase
        .from('auction_events')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal);

      const { count: totalComments, error: totalCommentsError } = await supabase
        .from('auction_comments')
        .select('id', { count: 'planned', head: true }).limit(0).abortSignal(readSignal);

      setStats({
        images: { 
          total: totalImagesError ? null : totalImages,
          analyzed: analyzedImagesError ? null : analyzedImages,
          pending: pendingImagesError ? null : pendingImages,
          failed: failedImagesError ? null : failedImages
        },
        catalog: {
          total_parts: totalPartsError ? null : totalParts,
          chunks_done: chunksDoneError ? null : chunksDone,
          chunks_pending: chunksPendingError ? null : chunksPending
        },
        vehicles: {
          total: totalVehiclesError ? null : totalVehicles,
          active: activeVehiclesError ? null : activeVehicles,
          pending: pendingVehiclesError ? null : pendingVehicles
        },
        auctions: {
          total: totalAuctionsError ? null : totalAuctions,
          comments: totalCommentsError ? null : totalComments
        },
        incomplete: [
          totalImagesError || totalImages === null, analyzedImagesError || analyzedImages === null,
          pendingImagesError || pendingImages === null, failedImagesError || failedImages === null,
          totalPartsError || totalParts === null, chunksDoneError || chunksDone === null, chunksPendingError || chunksPending === null,
          totalVehiclesError || totalVehicles === null, activeVehiclesError || activeVehicles === null, pendingVehiclesError || pendingVehicles === null,
          totalAuctionsError || totalAuctions === null, totalCommentsError || totalComments === null,
        ].some(Boolean),
        lastUpdate: new Date().toLocaleTimeString()
      });
      
      // Get recent analyzed images
      const { data: recent } = await supabase
        .from('vehicle_images')
        .select('id, ai_processing_completed_at, ai_scan_metadata')
        .eq('ai_processing_status', 'completed')
        .order('ai_processing_completed_at', { ascending: false })
        .limit(10).abortSignal(readSignal);

      // Get recent catalog parts
      const { data: recentCatalog } = await supabase
        .from('catalog_parts')
        .select('part_number, name, price_current, created_at')
        .order('created_at', { ascending: false })
        .limit(5).abortSignal(readSignal);

      setRecentImages(recent || []);
      setRecentParts(recentCatalog || []);
      setStatsError(false);
    } catch {
      setStatsError(true);
    } finally { statsLoading.current = false; }
  }

  if (!stats) {
    return (
      <div role="status" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-disabled)' }}>
        {statsError ? 'System totals unavailable. Retrying each minute.' : 'Loading system status...'}
      </div>
    );
  }

  const imagePercent = typeof stats.images.analyzed === 'number' && stats.images.total > 0 && stats.images.analyzed <= stats.images.total
    ? stats.images.analyzed / stats.images.total * 100 : null;

  return (
    <div style={{ padding: '16px', maxWidth: '1400px', margin: '0 auto', background: 'var(--surface)', minHeight: '100vh' }}>
      
      {/* Header */}
      <div style={{ marginBottom: '16px', borderBottom: '2px solid var(--text)', paddingBottom: '8px' }}>
        <h1 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          ADMIN SYSTEM STATUS
        </h1>
        <p style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
          Estimated totals • Refreshes every minute • Last: {stats.lastUpdate}
        </p>
      </div>

      {stats.incomplete && <p role="status" style={{ fontSize: '11px', marginBottom: 12 }}>Some totals are unmeasured. Missing readings do not mean zero.</p>}
      {statsError && <p role="status" style={{ fontSize: '11px', marginBottom: 12 }}>System totals unavailable. Showing the last received estimates.</p>}
      {pulseError && <p role="status" style={{ fontSize: '11px', marginBottom: 12 }}>Pipeline measurements unavailable.{pulse ? ' Showing the last received reading.' : ''}</p>}
      {/* Pipeline Pulse — measured arrivals, with explicit partial coverage */}
      {pulse?.organs && (
        <div style={{ border: '2px solid var(--text)', padding: '12px', marginBottom: '16px', background: 'var(--bg)' }}>
          <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '8px' }}>
            PIPELINE PULSE — NEW ROWS / DAY (LAST {pulse.days}D)
          </div>
          {pulse.degraded?.length > 0 && <p role="status" style={{ fontSize: '11px' }}>Some pipeline measurements are unavailable.</p>}
          <p style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Recorded arrivals measure flow, not data quality. Reading: {pulse.generated_at ? new Date(pulse.generated_at).toLocaleString() : 'time unmeasured'}.</p>
          {(() => {
            const dayKeys: string[] = [];
            for (let i = pulse.days - 1; i >= 0; i--) {
              const d = new Date(pulse.generated_at || Date.now()); d.setUTCDate(d.getUTCDate() - i);
              dayKeys.push(d.toISOString().slice(0, 10));
            }
            const organLabels: Record<string, string> = {
              vehicles: 'VEHICLES', images: 'IMAGES', observations: 'OBSERVATIONS', auction_comments: 'AUCTION COMMENTS',
            };
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontFamily: "'Courier New', monospace", fontSize: '10px' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', paddingRight: 10, fontFamily: 'Arial, sans-serif', fontSize: '8px', letterSpacing: '0.1em' }}>ORGAN</th>
                      {dayKeys.map((d) => (
                        <th key={d} style={{ padding: '0 4px', fontWeight: 400, color: 'var(--text-secondary)', fontSize: '8px' }}>{d.slice(5)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(organLabels).map(([key, label]) => {
                      const series: Record<string, number> = {};
                      const available = Array.isArray(pulse.organs[key]) && pulse.organs[key].every((p: any) =>
                        p && typeof p.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.d)
                        && Number.isFinite(Date.parse(p.d)) && new Date(p.d).toISOString().slice(0, 10) === p.d
                        && Number.isSafeInteger(p.n) && p.n >= 0)
                        && new Set(pulse.organs[key].map((p: any) => p.d)).size === pulse.organs[key].length
                        && !(pulse.degraded || []).some((message: unknown) =>
                        typeof message === 'string' && message.startsWith((key === 'auction_comments' ? 'comments' : key) + ':'));
                      if (available) pulse.organs[key].forEach((p: any) => { series[p.d] = p.n; });
                      return (
                        <tr key={key}>
                          <td style={{ fontFamily: 'Arial, sans-serif', fontSize: '8px', fontWeight: 700, letterSpacing: '0.08em', paddingRight: 10, whiteSpace: 'nowrap' }}>{label}</td>
                          {dayKeys.map((d) => {
                            const n = available ? (series[d] ?? 0) : null;
                            return (
                              <td key={d} style={{
                                padding: '2px 4px', textAlign: 'right', border: '1px solid var(--border)',
                                color: n === 0 ? 'var(--bg)' : 'var(--text)',
                                background: n === 0 ? 'var(--error, #a00)' : 'transparent',
                                fontWeight: n === 0 ? 700 : 400,
                              }}>
                                {measuredCount(n)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {pulse.backlogs && (
                  <div style={{ marginTop: 8, fontSize: '10px', fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)' }}>
                    BACKLOGS — import_queue pending: {measuredCount(pulse.backlogs.import_queue_pending)}
                    {' · '}images analysis pending: {typeof pulse.backlogs.cap === 'number' && pulse.backlogs.images_analysis_pending_capped >= pulse.backlogs.cap
                      ? `${(pulse.backlogs.cap - 1).toLocaleString()}+` : measuredCount(pulse.backlogs.images_analysis_pending_capped)}
                    {' · '}failed: {typeof pulse.backlogs.cap === 'number' && pulse.backlogs.images_analysis_failed_capped >= pulse.backlogs.cap
                      ? `${(pulse.backlogs.cap - 1).toLocaleString()}+` : measuredCount(pulse.backlogs.images_analysis_failed_capped)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Main Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginBottom: '16px' }}>
        
        {/* Tier 1 Analysis */}
        <div 
          onClick={() => handlePanelClick('tier1')}
          style={{ 
            background: expandedSection === 'tier1' ? 'var(--surface-hover)' : 'var(--bg)',
            border: '2px solid var(--text)',
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            TIER 1 ANALYSIS {expandedSection === 'tier1' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '21px', fontWeight: 700, marginBottom: '4px', fontFamily: "'Courier New', monospace" }}>
            {estimate(stats.images.analyzed)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            of {estimate(stats.images.total)} images
          </div>
          <div style={{ height: '8px', background: 'var(--border)', border: '1px solid var(--text)', overflow: 'hidden', marginBottom: '8px' }}>
            <div style={{
              width: `${imagePercent ?? 0}%`,
              height: '100%',
              background: 'var(--text)',
              transition: 'width 0.5s ease'
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ fontWeight: 700 }}>{imagePercent === null ? 'Unmeasured' : `≈${imagePercent.toFixed(1)}%`}</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {estimate(stats.images.pending)} pending
            </span>
          </div>
          {stats.images.failed > 0 && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--error)' }}>
              {estimate(stats.images.failed)} failed
            </div>
          )}
        </div>

        {/* LMC Catalog */}
        <div 
          onClick={() => handlePanelClick('catalog')}
          style={{ 
            background: expandedSection === 'catalog' ? 'var(--surface-hover)' : 'var(--bg)',
            border: '2px solid var(--text)',
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            LMC CATALOG {expandedSection === 'catalog' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '21px', fontWeight: 700, marginBottom: '4px', fontFamily: "'Courier New', monospace" }}>
            {estimate(stats.catalog.total_parts)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            parts indexed
          </div>
          <div style={{ fontSize: '11px', marginBottom: '4px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Chunks done:</span>
              <span style={{ fontWeight: 700 }}>{estimate(stats.catalog.chunks_done)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Chunks pending:</span>
              <span style={{ fontWeight: 700 }}>{estimate(stats.catalog.chunks_pending)}</span>
            </div>
          </div>
        </div>

        {/* Vehicles */}
        <div 
          onClick={() => handlePanelClick('vehicles')}
          style={{ 
            background: expandedSection === 'vehicles' ? 'var(--surface-hover)' : 'var(--bg)',
            border: '2px solid var(--text)',
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            VEHICLES {expandedSection === 'vehicles' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '21px', fontWeight: 700, marginBottom: '4px', fontFamily: "'Courier New', monospace" }}>
            {estimate(stats.vehicles.active)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            active vehicles
          </div>
          <div style={{ fontSize: '11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total:</span>
              <span style={{ fontWeight: 700 }}>{estimate(stats.vehicles.total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Pending:</span>
              <span style={{ fontWeight: 700 }}>{estimate(stats.vehicles.pending)}</span>
            </div>
          </div>
        </div>

        {/* Auctions */}
        <div 
          onClick={() => handlePanelClick('auctions')}
          style={{ 
            background: expandedSection === 'auctions' ? 'var(--surface-hover)' : 'var(--bg)',
            border: '2px solid var(--text)',
            padding: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '8px', textTransform: 'uppercase' }}>
            AUCTION DATA {expandedSection === 'auctions' ? '▼' : '▶'}
          </div>
          <div style={{ fontSize: '21px', fontWeight: 700, marginBottom: '4px', fontFamily: "'Courier New', monospace" }}>
            {estimate(stats.auctions.comments)}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '8px' }}>
            comments analyzed
          </div>
          <div style={{ fontSize: '11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Auctions:</span>
              <span style={{ fontWeight: 700 }}>{estimate(stats.auctions.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Expanded List View */}
      {expandedSection && (
        <div style={{ marginBottom: '16px', background: 'var(--surface)', border: '2px solid var(--text)', padding: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' }}>
              {expandedSection === 'tier1' && 'ALL IMAGES'}
              {expandedSection === 'catalog' && 'ALL CATALOG PARTS'}
              {expandedSection === 'vehicles' && 'ALL VEHICLES'}
              {expandedSection === 'auctions' && 'ALL AUCTIONS'}
            </h3>
            <button 
              onClick={() => setExpandedSection(null)}
              style={{ fontSize: '11px', fontWeight: 700, border: '1px solid var(--text)', background: 'var(--surface)', padding: '4px 8px', cursor: 'pointer' }}
            >
              CLOSE
            </button>
          </div>
          <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid var(--border)' }}>
            {listData.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-disabled)' }}>Loading...</div>
            ) : (
              <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse' }}>
                <tbody>
                  {listData.map((item, idx) => (
                    <tr 
                      key={item.id || idx} 
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => {
                        if (expandedSection === 'tier1') setSelectedImage(item);
                        if (expandedSection === 'vehicles') navigate(`/vehicle/${item.id}`);
                        if (expandedSection === 'auctions') window.open(item.listing_url, '_blank');
                      }}
                    >
                      {expandedSection === 'tier1' && (
                        <>
                          <td style={{ padding: '6px', fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)' }}>{item.id.substring(0, 8)}</td>
                          <td style={{ padding: '6px' }}>{item.ai_processing_status || 'pending'}</td>
                          <td style={{ padding: '6px' }}>{item.ai_scan_metadata?.tier_1_analysis?.category || 'unknown'}</td>
                          <td style={{ padding: '6px' }}>{item.ai_scan_metadata?.tier_1_analysis?.angle || 'unknown'}</td>
                        </>
                      )}
                      {expandedSection === 'catalog' && (
                        <>
                          <td style={{ padding: '6px', fontFamily: "'Courier New', monospace" }}>{item.part_number}</td>
                          <td style={{ padding: '6px' }}>{item.name || 'No name'}</td>
                          <td style={{ padding: '6px', fontSize: '9px', color: 'var(--text-secondary)' }}>{item.category || 'Uncategorized'}</td>
                          <td style={{ padding: '6px', fontSize: '9px', color: 'var(--text-secondary)' }}>
                            {item.year_start && item.year_end ? `${item.year_start}-${item.year_end}` : 'N/A'}
                          </td>
                          <td style={{ padding: '6px', fontWeight: 700 }}>${item.price_current?.toFixed(2) || '0.00'}</td>
                          <td style={{ padding: '6px', textAlign: 'center' }}>
                            {item.product_image_url ? '✓' : '—'}
                          </td>
                        </>
                      )}
                      {expandedSection === 'vehicles' && (
                        <>
                          <td style={{ padding: '6px' }}>{item.year} {item.make} {item.model}</td>
                          <td style={{ padding: '6px' }}>{item.status}</td>
                          <td style={{ padding: '6px', color: 'var(--text-disabled)' }}>{new Date(item.created_at).toLocaleDateString()}</td>
                        </>
                      )}
                      {expandedSection === 'auctions' && (
                        <>
                          <td style={{ padding: '6px', fontFamily: "'Courier New', monospace", fontSize: '11px' }}>{item.id.substring(0, 8)}</td>
                          <td style={{ padding: '6px' }}>{item.outcome || 'unknown'}</td>
                          <td style={{ padding: '6px' }}>${item.high_bid?.toLocaleString() || 'N/A'}</td>
                          <td style={{ padding: '6px', color: 'var(--text-disabled)' }}>{new Date(item.created_at).toLocaleDateString()}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Two Column Recent Activity */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
        
        {/* Recent Tier 1 Analysis */}
        <div style={{ background: 'var(--bg)', border: '2px solid var(--text)', padding: '12px' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recent Tier 1 Analysis
          </h2>
          <div style={{ display: 'grid', gap: '6px' }}>
            {recentImages.slice(0, 8).map((img, idx) => {
              const secondsAgo = img.ai_processing_completed_at 
                ? Math.floor((Date.now() - new Date(img.ai_processing_completed_at).getTime()) / 1000)
                : 0;
              const timeAgo = secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)}m`;
              const category = img.ai_scan_metadata?.tier_1_analysis?.category || 'unknown';
              const angle = img.ai_scan_metadata?.tier_1_analysis?.angle || 'unknown';

              return (
                <div 
                  key={img.id}
                  onClick={() => setSelectedImage(img)}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '6px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer'
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{
                      fontSize: '11px',
                      fontFamily: "'Courier New', monospace",
                      color: 'var(--text-secondary)'
                    }}>
                      {img.id.substring(0, 8)}
                    </div>
                    <div style={{ fontSize: '11px', fontWeight: 600 }}>
                      {category}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {angle}
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>
                    {timeAgo}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Recent Catalog Parts */}
        <div style={{ background: 'var(--bg)', border: '2px solid var(--text)', padding: '12px' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Recent Catalog Parts
          </h2>
          <div style={{ display: 'grid', gap: '6px' }}>
            {recentParts.slice(0, 8).map((part, idx) => {
              const secondsAgo = part.created_at 
                ? Math.floor((Date.now() - new Date(part.created_at).getTime()) / 1000)
                : 0;
              const timeAgo = secondsAgo < 60 ? `${secondsAgo}s` : `${Math.floor(secondsAgo / 60)}m`;

              return (
                <div 
                  key={idx}
                  style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    padding: '6px',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <div style={{ 
                      fontSize: '11px', 
                      fontFamily: "'Courier New', monospace", 
                      fontWeight: 600
                    }}>
                      {part.part_number}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {part.name?.substring(0, 30) || 'No name'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700 }}>
                      ${part.price_current?.toFixed(2) || 'N/A'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>
                      {timeAgo}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: 'flex', gap: '8px', borderTop: '2px solid var(--text)', paddingTop: '12px' }}>
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '8px 16px',
            background: 'var(--text)',
            color: 'var(--bg)',
            fontWeight: 700,
            fontSize: '11px',
            border: '2px solid var(--text)',
            cursor: 'pointer'
          }}
        >
          VEHICLES
        </button>
        <button
          onClick={() => navigate('/admin/scripts')}
          style={{
            padding: '8px 16px',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontWeight: 700,
            fontSize: '11px',
            border: '2px solid var(--text)',
            cursor: 'pointer'
          }}
        >
          SCRIPTS
        </button>
        <button
          onClick={() => navigate('/admin/image-processing')}
          style={{
            padding: '8px 16px',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontWeight: 700,
            fontSize: '11px',
            border: '2px solid var(--text)',
            cursor: 'pointer'
          }}
        >
          IMAGES
        </button>
        <button
          onClick={() => navigate('/admin/verifications')}
          style={{
            padding: '8px 16px',
            background: 'var(--surface)',
            color: 'var(--text)',
            fontWeight: 700,
            fontSize: '11px',
            border: '2px solid var(--text)',
            cursor: 'pointer'
          }}
        >
          VERIFY
        </button>
      </div>

      {/* Image Detail Modal */}
      {selectedImage && (
        <div 
          onClick={() => setSelectedImage(null)}
          style={{ 
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0,0,0,0.8)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 9999
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{ 
              background: 'var(--surface)',
              border: '2px solid var(--text)',
              padding: '16px', 
              maxWidth: '800px',
              maxHeight: '90vh',
              overflow: 'auto'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '11px', fontWeight: 700 }}>IMAGE ANALYSIS</h3>
              <button 
                onClick={() => setSelectedImage(null)}
                style={{ fontSize: '11px', border: '1px solid var(--text)', background: 'var(--surface)', padding: '4px 8px', cursor: 'pointer' }}
              >
                CLOSE
              </button>
            </div>
            
            {selectedImage.image_url && (
              <img 
                src={selectedImage.image_url} 
                alt="Vehicle" 
                style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', marginBottom: '12px', border: '1px solid var(--border)' }}
              />
            )}

            <div style={{ fontSize: '11px', marginBottom: '8px' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>ID:</div>
              <div style={{ fontFamily: "'Courier New', monospace", color: 'var(--text-secondary)' }}>{selectedImage.id}</div>
            </div>

            <div style={{ fontSize: '11px', marginBottom: '8px' }}>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>STATUS:</div>
              <div>{selectedImage.ai_processing_status || 'pending'}</div>
            </div>

            {selectedImage.ai_scan_metadata?.tier_1_analysis && (
              <>
                <div style={{ fontSize: '11px', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>CATEGORY:</div>
                  <div>{selectedImage.ai_scan_metadata.tier_1_analysis.category || 'unknown'}</div>
                </div>

                <div style={{ fontSize: '11px', marginBottom: '8px' }}>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>ANGLE:</div>
                  <div>{selectedImage.ai_scan_metadata.tier_1_analysis.angle || 'unknown'}</div>
                </div>

                {selectedImage.ai_scan_metadata.tier_1_analysis.components && (
                  <div style={{ fontSize: '11px' }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>COMPONENTS:</div>
                    <div>{selectedImage.ai_scan_metadata.tier_1_analysis.components.join(', ')}</div>
                  </div>
                )}
              </>
            )}

            {!selectedImage.ai_scan_metadata?.tier_1_analysis && (
              <div style={{ fontSize: '11px', color: 'var(--text-disabled)' }}>NO ANALYSIS DATA YET</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
