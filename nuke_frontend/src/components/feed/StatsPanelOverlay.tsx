import React from 'react';
import { Link } from 'react-router-dom';
import { optimizeImageUrl } from '../../lib/imageOptimizer';

/**
 * StatsPanelOverlay — Modal overlay showing value/sales/vehicle analytics.
 *
 * Extracted from CursorHomepage.tsx lines ~4650-5004.
 */

type StatsPanelKind = 'vehicles' | 'value' | 'for_sale' | 'sold_today' | 'auctions';
type ValueMetricMode = 'best_known' | 'mark' | 'ask' | 'realized' | 'cost';

export interface StatsPanelOverlayProps {
  statsPanel: StatsPanelKind;
  statsPanelLoading: boolean;
  statsPanelError: string | null;
  statsPanelMeta: any;
  statsPanelRows: any[];
  displayStats: {
    totalVehicles: number;
    totalValue: number;
    vehiclesAddedToday: number;
    valueMarkTotal: number;
    valueAskTotal: number;
    valueRealizedTotal: number;
    valueCostTotal: number;
    valueImportedToday: number;
    valueImported24h: number;
    valueImported7d: number;
    marketInterestValue: number;
    rnmVehicleCount: number;
  };
  valueMetricMode: ValueMetricMode;
  setValueMetricMode: (m: ValueMetricMode) => void;
  closeStatsPanel: () => void;
  toggleAddedTodayOnly: () => void;
  toggleShowSoldOnly: () => void;
  formatCurrency: (n: number) => string;
}

const StatsPanelOverlay: React.FC<StatsPanelOverlayProps> = ({
  statsPanel,
  statsPanelLoading,
  statsPanelError,
  statsPanelMeta,
  statsPanelRows,
  displayStats,
  valueMetricMode,
  setValueMetricMode,
  closeStatsPanel,
  toggleAddedTodayOnly,
  toggleShowSoldOnly,
  formatCurrency,
}) => {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 20000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        closeStatsPanel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        style={{
          width: 'min(980px, calc(100vw - 24px))',
          maxHeight: 'min(82vh, 860px)',
          overflow: 'auto',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          borderRadius: 'var(--radius)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderBottom: '2px solid var(--border)' }}>
          <div style={{ fontSize: '9pt', fontWeight: 900 }}>
            {statsPanel === 'vehicles'
              ? 'Vehicles'
              : statsPanel === 'value'
              ? 'Value'
              : statsPanel === 'for_sale'
              ? 'For sale'
              : statsPanel === 'sold_today'
              ? 'Sold today'
              : 'Auctions'}
          </div>
          <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: '8px', alignItems: 'center' }}>
            {statsPanel === 'vehicles' && (
              <button
                type="button"
                className="button-win95"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleAddedTodayOnly();
                }}
                style={{ padding: '4px 8px', fontSize: '8pt' }}
                title="Toggle filter: vehicles created today"
              >
                +today
              </button>
            )}
            {statsPanel === 'sold_today' && (
              <button
                type="button"
                className="button-win95"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  closeStatsPanel();
                  toggleShowSoldOnly();
                }}
                style={{ padding: '4px 8px', fontSize: '8pt' }}
                title="Filter feed to sold vehicles only"
              >
                Filter feed
              </button>
            )}
            <button
              type="button"
              className="button-win95"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeStatsPanel();
              }}
              style={{ padding: '4px 8px', fontSize: '8pt' }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--space-4)' }}>
          {statsPanelLoading ? (
            <div style={{ fontSize: 'var(--fs-9)', color: 'var(--text-secondary)' }}>Loading...</div>
          ) : statsPanelError ? (
            <div style={{ fontSize: 'var(--fs-9)', color: 'var(--error)' }}>{statsPanelError}</div>
          ) : (
            <>
              {/* Value panel */}
              {statsPanel === 'value' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px', marginBottom: '16px' }}>
                    <div style={{ border: '2px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>BEST-KNOWN VALUE</div>
                      <div style={{ fontSize: '12pt', fontWeight: 900 }}>{formatCurrency(displayStats.totalValue)}</div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        Uses priority: sale &gt; bids &gt; ask &gt; mark &gt; cost.
                      </div>
                      <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>HEADER:</div>
                        {([
                          { mode: 'best_known' as ValueMetricMode, label: 'val' },
                          { mode: 'mark' as ValueMetricMode, label: 'mark' },
                          { mode: 'ask' as ValueMetricMode, label: 'ask' },
                          { mode: 'realized' as ValueMetricMode, label: 'realized' },
                          { mode: 'cost' as ValueMetricMode, label: 'cost' },
                        ]).map((m) => (
                          <button
                            key={m.mode}
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setValueMetricMode(m.mode);
                            }}
                            style={{
                              padding: '2px 6px',
                              fontSize: '7pt',
                              border: '1px solid var(--border)',
                              background: valueMetricMode === m.mode ? 'var(--grey-600)' : 'transparent',
                              color: valueMetricMode === m.mode ? 'var(--white)' : 'var(--text)',
                              cursor: 'pointer',
                              borderRadius: 6,
                              fontFamily: 'monospace',
                              fontWeight: 900,
                            }}
                            title="Choose which value concept the header shows"
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ border: '2px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>BREAKDOWN</div>
                      <div style={{ fontSize: '8pt', lineHeight: 1.35 }}>
                        <div><b>{formatCurrency(displayStats.valueMarkTotal)}</b> mark (current_value)</div>
                        <div><b>{formatCurrency(displayStats.valueAskTotal)}</b> ask (for sale)</div>
                        <div><b>{formatCurrency(displayStats.valueRealizedTotal)}</b> realized (sale_price)</div>
                        <div><b>{formatCurrency(displayStats.valueCostTotal)}</b> cost (purchase_price)</div>
                      </div>
                    </div>
                    <div style={{ border: '2px solid var(--border)', background: 'var(--surface)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>VALUE ADDED (IMPORTS)</div>
                      <div style={{ fontSize: '8pt', lineHeight: 1.35 }}>
                        <div><b>{formatCurrency(displayStats.valueImportedToday)}</b> today</div>
                        <div><b>{formatCurrency(displayStats.valueImported24h)}</b> last 24h</div>
                        <div><b>{formatCurrency(displayStats.valueImported7d)}</b> last 7d</div>
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '6px' }}>
                        Note: &quot;Sold date&quot; can be old, but &quot;import date&quot; is created_at.
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Vehicles panel */}
              {statsPanel === 'vehicles' && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '10px' }}>
                  <div><b>{displayStats.totalVehicles.toLocaleString()}</b> vehicles</div>
                  {displayStats.vehiclesAddedToday > 0 && <div><b>+{displayStats.vehiclesAddedToday.toLocaleString()}</b> today</div>}
                </div>
              )}

              {/* Sold today panel */}
              {statsPanel === 'sold_today' && statsPanelMeta && (() => {
                const today = statsPanelMeta.today || {};
                const daily = Array.isArray(statsPanelMeta.daily_history) ? statsPanelMeta.daily_history : (statsPanelMeta.daily_history || []);
                const whales = Array.isArray(statsPanelMeta.whales) ? statsPanelMeta.whales : (statsPanelMeta.whales || []);
                const todayVol = Number(today.sales_volume) || 0;
                const todayCnt = Number(today.sales_count) || 0;
                const volumes = daily.map((d: any) => Number(d.sales_volume) || 0).filter((v: number) => v > 0);
                const counts = daily.map((d: any) => Number(d.sales_count) || 0);
                const sortedVol = [...volumes].sort((a: number, b: number) => a - b);
                const sortedCnt = [...counts].sort((a: number, b: number) => a - b);
                const volPercentile = sortedVol.length > 0 && todayVol > 0
                  ? (sortedVol.filter((v: number) => v < todayVol).length / sortedVol.length) * 100
                  : 50;
                const cntMedian = sortedCnt.length > 0 ? sortedCnt[Math.floor(sortedCnt.length / 2)] : 0;
                const volMedian = sortedVol.length > 0 ? sortedVol[Math.floor(sortedVol.length / 2)] : 0;
                const goodDay = todayCnt >= cntMedian && todayVol >= volMedian && (sortedCnt.length > 0 || sortedVol.length > 0);
                const tempLabel = volPercentile >= 80 ? 'Hot' : volPercentile >= 50 ? 'Warm' : volPercentile >= 20 ? 'Cool' : 'Cold';
                const tempColor = volPercentile >= 80 ? '#dc2626' : volPercentile >= 50 ? '#f59e0b' : volPercentile >= 20 ? '#3b82f6' : '#6b7280';
                return (
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '8pt', fontWeight: 900, marginBottom: '8px' }}>Today&apos;s market</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                      <div style={{ border: '2px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>SOLD TODAY</div>
                        <div style={{ fontSize: '12pt', fontWeight: 900 }}>{todayCnt}</div>
                        <div style={{ fontSize: '9pt' }}>{formatCurrency(todayVol)}</div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>avg {formatCurrency(Number(today.avg_sale_price) || 0)}</div>
                      </div>
                      <div style={{ border: '2px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>GOOD DAY?</div>
                        <div style={{ fontSize: '11pt', fontWeight: 900, color: goodDay ? '#059669' : 'var(--text-muted)' }}>
                          {goodDay ? 'Yes' : 'No'}
                        </div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>
                          {sortedCnt.length > 0 || sortedVol.length > 0
                            ? `vs 30d median (${todayCnt} vs ${cntMedian} count, ${formatCurrency(todayVol)} vs ${formatCurrency(volMedian)} vol)`
                            : 'Not enough history yet'}
                        </div>
                      </div>
                      <div style={{ border: '2px solid var(--border)', borderRadius: 'var(--radius)', padding: 'var(--space-2)' }}>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)', fontFamily: 'monospace' }}>MARKET TEMPERATURE</div>
                        <div style={{ fontSize: '11pt', fontWeight: 900, color: tempColor }}>{tempLabel}</div>
                        <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>volume in top {Math.round(100 - volPercentile)}% (30d)</div>
                      </div>
                    </div>
                    {whales.length > 0 && (
                      <>
                        <div style={{ fontSize: '8pt', fontWeight: 900, marginBottom: '6px' }}>Whales (top buyers today)</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
                          {whales.slice(0, 10).map((w: any, i: number) => (
                            <span
                              key={i}
                              style={{
                                padding: '4px 8px',
                                background: 'var(--grey-200)',
                                border: '1px solid var(--border)',
                                borderRadius: 6,
                                fontSize: '7pt',
                                fontFamily: 'monospace',
                              }}
                              title={`${Number(w.vehicle_count) || 0} vehicles`}
                            >
                              {String(w.buyer_display || 'Unknown').replace(/^@/, '')} · {formatCurrency(Number(w.total_spend) || 0)}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* Vehicle preview cards — shared across all panel types */}
              {(statsPanel === 'for_sale' || statsPanel === 'sold_today' || statsPanel === 'auctions' || statsPanel === 'vehicles' || statsPanel === 'value') && (
                <>
                  <div style={{ fontSize: '8pt', fontWeight: 900, marginTop: statsPanel === 'value' ? '12px' : 0 }}>
                    {statsPanel === 'vehicles'
                      ? 'Newest profiles'
                      : statsPanel === 'value'
                      ? 'Newest imports (click to open)'
                      : statsPanel === 'for_sale'
                      ? 'For sale (preview)'
                      : statsPanel === 'sold_today'
                      ? 'Sold today (preview)'
                      : 'Active auctions (preview)'}
                  </div>

                  <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', padding: '10px 0' }}>
                    {(statsPanelRows || []).map((v: any) => {
                      const title = `${v?.year ?? ''} ${v?.make ?? ''} ${v?.model ?? ''}`.trim() || 'Vehicle';
                      const rawImg = String(v?.primary_image_url || v?.image_url || '').trim();
                      const img = rawImg ? (optimizeImageUrl(rawImg, 'thumbnail') || rawImg) : '/nuke.png';

                      const salePrice = typeof v?.sale_price === 'number' ? v.sale_price : Number(v?.sale_price || 0) || 0;
                      const ask = typeof v?.asking_price === 'number' ? v.asking_price : Number(v?.asking_price || 0) || 0;
                      const mark = typeof v?.current_value === 'number' ? v.current_value : Number(v?.current_value || 0) || 0;
                      const subtitle =
                        statsPanel === 'sold_today'
                          ? (salePrice > 0 ? `SOLD ${formatCurrency(salePrice)}` : 'SOLD')
                          : statsPanel === 'for_sale'
                          ? (ask > 0 ? `ASK ${formatCurrency(ask)}` : (mark > 0 ? `MARK ${formatCurrency(mark)}` : 'For sale'))
                          : statsPanel === 'auctions'
                          ? (() => {
                              const bid = Number((v as any)?._listing?.current_bid || 0) || 0;
                              const plat = String((v as any)?._listing?.platform || '').toUpperCase();
                              return bid > 0 ? `${plat ? plat + ' ' : ''}BID ${formatCurrency(bid)}` : (plat ? `${plat} LIVE` : 'Auction');
                            })()
                          : (mark > 0 ? `MARK ${formatCurrency(mark)}` : (ask > 0 ? `ASK ${formatCurrency(ask)}` : (salePrice > 0 ? `SOLD ${formatCurrency(salePrice)}` : '\u2014')));

                      const createdAt = v?.created_at ? String(v.created_at) : '';
                      const saleDate = v?.sale_date ? String(v.sale_date) : '';
                      const metaLine =
                        statsPanel === 'value'
                          ? `imported ${createdAt ? new Date(createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014'}${saleDate ? ` \u00b7 sold ${new Date(saleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`
                          : '';

                      return (
                        <Link
                          key={String(v?.id || Math.random())}
                          to={`/vehicle/${v.id}`}
                          style={{
                            flex: '0 0 auto',
                            width: 140,
                            textDecoration: 'none',
                            color: 'inherit',
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            borderRadius: 6,
                            overflow: 'hidden',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeStatsPanel();
                          }}
                        >
                          <div style={{ width: '100%', paddingBottom: '100%', background: 'var(--grey-200)', position: 'relative' }}>
                            <img
                              src={img}
                              alt=""
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          </div>
                          <div style={{ padding: '6px' }}>
                            <div style={{ fontSize: '8pt', fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={title}>
                              {title}
                            </div>
                            <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
                            {metaLine ? <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: 2 }}>{metaLine}</div> : null}
                          </div>
                        </Link>
                      );
                    })}
                    {(!statsPanelRows || statsPanelRows.length === 0) && (
                      <div style={{ fontSize: '9pt', color: 'var(--text-muted)', padding: '10px 0' }}>
                        No rows found for this panel.
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(StatsPanelOverlay);
