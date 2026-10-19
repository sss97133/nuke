import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';
import { PrefetchLink } from '../PrefetchLink';

function sourceLocator(raw: string | null | undefined): string | null {
  try {
    const url = new URL(raw || '');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

// ============================================================================
// PRICE BREAKDOWN POPUP
// ============================================================================

interface PriceBreakdownProps {
  recordedAmount: number;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  source?: string;
  sourceUrl?: string | null;
  lotNumber?: string | null;
  vehicleId?: string;
  onClose: () => void;
}

interface PriceLineItem {
  label: string;
  value: number | string;
  definition: string;
  highlight?: 'success' | 'warning' | 'muted';
}

export const PriceBreakdownPopup: React.FC<PriceBreakdownProps> = ({
  recordedAmount,
  estimateLow,
  estimateHigh,
  source,
  sourceUrl,
  lotNumber,
  vehicleId,
  onClose
}) => {
  const [saleContext, setSaleContext] = useState<{ vehicleId: string; href: string } | null>(null);
  const [activeDefinition, setActiveDefinition] = useState<string | null>(null);
  const sourceLink = sourceLocator(sourceUrl);

  // Reuse the qualified sale reader; a raw year/model match is not a comparable sale.
  useEffect(() => {
    let cancelled = false;
    setSaleContext(null);
    if (vehicleId) void (async () => {
      try {
        const { data: vehicle, error } = await supabase.from('vehicles')
          .select('id, year, make, model').eq('id', vehicleId)
          .eq('is_public', true).is('deleted_at', null)
          .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item').maybeSingle();
        if (cancelled || error || vehicle?.id !== vehicleId || !Number.isInteger(vehicle.year) || vehicle.year <= 0
          || !vehicle.make?.trim() || !vehicle.model?.trim()) return;
        // Same identity/subject-exclusion contract as AuctionEvidence. Do not lend this amount units.
        setSaleContext({ vehicleId, href: `/valuation?${new URLSearchParams({
          year: String(vehicle.year), make: vehicle.make, model: vehicle.model, vehicle_id: vehicleId,
        })}` });
      } catch { /* Failed or denied metadata leaves the attributed amount intact. */ }
    })();
    return () => { cancelled = true; };
  }, [vehicleId]);

  const lineItems: PriceLineItem[] = [
    {
      label: 'Recorded auction amount',
      value: recordedAmount,
      definition: 'Amount recorded for this auction lot. Currency and fee basis are unknown in this read; it does not establish a hammer price or buyer total.',
    },
    {
      label: 'Currency and fee basis',
      value: 'Unknown',
      definition: 'This auction record does not supply attributed currency or fee terms. The source name alone cannot establish them.',
      highlight: 'muted'
    },
    ...(typeof estimateLow === 'number' && Number.isFinite(estimateLow) && estimateLow > 0
      && typeof estimateHigh === 'number' && Number.isFinite(estimateHigh) && estimateHigh >= estimateLow ? [{
      label: 'Recorded estimate range',
      value: `${estimateLow.toLocaleString()} – ${estimateHigh.toLocaleString()}`,
      definition: 'Recorded source estimates; currency and comparability to the recorded auction amount are unestablished. No price-versus-estimate calculation is made.',
      highlight: 'muted' as const
    }] : []),
    {
      label: 'Fees and proceeds',
      value: 'Unrecorded',
      definition: 'Lot-specific buyer fees, seller commission and entry fees are not recorded in this read, so buyer total, seller proceeds and house revenue are unknown.',
      highlight: 'muted'
    },
  ];

  return ReactDOM.createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'var(--surface)',
          borderRadius: 0,
          maxHeight: '80vh',
          overflow: 'auto'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          background: 'var(--surface)',
          zIndex: 1
        }}>
          <span style={{ fontWeight: 700, fontSize: '13px' }}>AUCTION AMOUNT</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '18px', color: 'var(--text-muted)', lineHeight: 1
          }}>×</button>
        </div>

        <div style={{ padding: '8px 16px', fontSize: '11px', color: 'var(--text-muted)' }}>
          {source?.toUpperCase() || 'Auction record'}{lotNumber ? ` · Lot ${lotNumber}` : ''}
          {sourceLink && <> · <a href={sourceLink} target="_blank" rel="noopener noreferrer">Original listing ↗</a></>}
        </div>

        {/* Line Items */}
        <div style={{ padding: '8px 0' }}>
          {lineItems.map((item, idx) => (
            <div
              key={idx}
              onClick={() => setActiveDefinition(activeDefinition === item.label ? null : item.label)}
              style={{
                padding: '10px 16px',
                cursor: 'pointer',
                background: activeDefinition === item.label ? 'var(--surface-raised)' : 'transparent',
                borderBottom: '1px solid var(--border-dim)'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <span style={{
                  fontSize: '11px',
                  color: item.highlight === 'muted' ? 'var(--text-muted)' : 'var(--text)'
                }}>
                  {item.label}
                </span>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  fontFamily: typeof item.value === 'number' ? 'monospace' : 'inherit',
                  color: item.highlight === 'success' ? 'var(--success)' :
                         item.highlight === 'warning' ? 'var(--warning)' :
                         item.highlight === 'muted' ? 'var(--text-muted)' : 'var(--text)'
                }}>
                  {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                </span>
              </div>
              {activeDefinition === item.label && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px',
                  background: 'var(--surface)',
                  borderRadius: 0,
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  lineHeight: 1.4
                }}>
                  {item.definition}
                </div>
              )}
            </div>
          ))}
        </div>

        {saleContext && saleContext.vehicleId === vehicleId && (
          <div style={{ borderTop: '2px solid var(--border)', padding: '12px 16px', fontSize: '11px' }}>
            <PrefetchLink to={saleContext.href}
              onMouseEnter={() => { void import('../../pages/Valuation').catch(() => {}); }}
              onFocus={() => { void import('../../pages/Valuation').catch(() => {}); }}>Recorded sale context →</PrefetchLink>
            <div style={{ marginTop: '4px', color: 'var(--text-muted)' }}>
              Source-qualified sales use their own currency, dates and fee basis. Condition and equipment remain unmatched.
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};


// ============================================================================
// LOT STATS POPUP
// ============================================================================

interface LotStatsProps {
  lotNumber: string;
  source: string;
  videoOffset: string;
  videoSpan: string;
  auctionName?: string | null;
  onClose: () => void;
}

interface LotHistorical {
  id: string;
  vehicle_id: string;
  source: string;
  source_url: string | null;
  lot_number: string;
  auction_start_date: string | null;
  winning_bid: number | null;
  outcome: string;
  year?: number;
  make?: string;
  model?: string;
}

export const LotStatsPopup: React.FC<LotStatsProps> = ({
  lotNumber,
  source,
  videoOffset,
  videoSpan,
  auctionName,
  onClose
}) => {
  const [activeSection, setActiveSection] = useState<'performance' | 'historical'>('performance');
  const scope = JSON.stringify([source, lotNumber]);
  const [history, setHistory] = useState<{
    scope: string; status: 'loading' | 'ready' | 'error'; rows: LotHistorical[];
  } | null>(null);
  const currentHistory = history?.scope === scope ? history : null;

  useEffect(() => {
    if (activeSection !== 'historical') return;
    let cancelled = false;
    setHistory({ scope, status: 'loading', rows: [] });
    void (async () => {
      try {
        const { data, error } = await supabase.from('auction_events')
          .select(`id, vehicle_id, source, source_url, lot_number, auction_start_date, winning_bid, outcome,
            vehicles!inner(id, year, make, model, is_public, deleted_at, listing_kind)`)
          .eq('lot_number', lotNumber).eq('source', source)
          .eq('vehicles.is_public', true).is('vehicles.deleted_at', null)
          .or('listing_kind.is.null,listing_kind.neq.non_vehicle_item', { referencedTable: 'vehicles' })
          .order('auction_start_date', { ascending: false }).limit(10);
        if (cancelled) return;
        if (error) throw error;
        const rows = (data || []).filter((h: any) => h.source === source && h.lot_number === lotNumber
          && h.vehicles?.id === h.vehicle_id && h.vehicles?.is_public === true
          && h.vehicles?.deleted_at === null && h.vehicles?.listing_kind !== 'non_vehicle_item')
          .map((h: any) => ({ ...h, year: h.vehicles.year, make: h.vehicles.make, model: h.vehicles.model }));
        setHistory({ scope, status: 'ready', rows });
      } catch {
        if (!cancelled) setHistory({ scope, status: 'error', rows: [] });
      }
    })();
    return () => { cancelled = true; };
  }, [activeSection, source, lotNumber, scope]);

  return ReactDOM.createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '480px',
          background: 'var(--surface)',
          borderRadius: 0,
          maxHeight: '80vh',
          overflow: 'auto'
        }}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          background: 'var(--surface)',
          zIndex: 1
        }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: '15px' }}>LOT {lotNumber}</span>
            <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
              {source?.toUpperCase()}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '18px', color: 'var(--text-muted)', lineHeight: 1
          }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface-raised)'
        }}>
          {(['performance', 'historical'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveSection(tab)}
              style={{
                flex: 1,
                padding: '10px',
                background: activeSection === tab ? 'var(--surface)' : 'transparent',
                border: 'none',
                borderBottom: activeSection === tab ? '2px solid var(--accent)' : '2px solid transparent',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                color: activeSection === tab ? 'var(--text)' : 'var(--text-muted)'
              }}
            >
              {tab === 'performance' ? 'This Lot' : 'Matching labels'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '12px 16px' }}>
          {activeSection === 'performance' && (
            <>
              <div style={{ padding: '12px', background: 'var(--surface-raised)', marginBottom: '12px' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>RECORDED LOT LABEL</div>
                <div style={{ fontSize: '14px', fontWeight: 600 }}>{lotNumber}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  The source's lot label does not establish stage, placement, day or sub-lot meaning.
                </div>
              </div>

              {/* Timing */}
              <div style={{
                padding: '12px',
                background: 'var(--surface-raised)',
                borderRadius: 0,
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  RECORDED VIDEO MARKERS
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: "'Courier New', monospace" }}>
                      {videoSpan}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Recorded video span</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: "'Courier New', monospace" }}>
                      {videoOffset}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Offset into video</div>
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Auction local time and hourly performance are not established by video offsets.
              </div>
            </>
          )}

          {activeSection === 'historical' && (
            <>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Up to 10 public {source?.toUpperCase()} records with lot label {lotNumber}. A repeated label does not establish the same vehicle or sale, or complete source history.
              </div>
              {!currentHistory || currentHistory.status === 'loading' ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Reading matching lot labels…
                </div>
              ) : currentHistory.status === 'error' ? (
                <div role="status" style={{ padding: '20px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Matching lot records could not be read.
                </div>
              ) : currentHistory.rows.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                  No matching public lot records returned
                </div>
              ) : (
                <div>
                  {currentHistory.rows.map((h) => (
                    <div
                      key={h.id}
                      style={{
                        display: 'block',
                        padding: '10px',
                        margin: '4px 0',
                        background: 'var(--surface-raised)',
                        borderRadius: 0,
                        textDecoration: 'none',
                        color: 'inherit'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 600 }}>
                            <PrefetchLink to={`/vehicle/${h.vehicle_id}`}>{h.year} {h.make} {h.model}</PrefetchLink>
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {h.source?.toUpperCase()} · Lot {h.lot_number}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {typeof h.winning_bid === 'number' && Number.isFinite(h.winning_bid) && h.winning_bid > 0 ? (
                            <div style={{ fontSize: '11px' }}>
                              Recorded amount {h.winning_bid.toLocaleString()} · currency and fee basis unknown
                            </div>
                          ) : (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {h.outcome || 'Outcome unknown'}
                            </div>
                          )}
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                            {h.auction_start_date && Number.isFinite(Date.parse(h.auction_start_date))
                              ? `Recorded open (UTC): ${new Date(h.auction_start_date).toISOString().slice(0, 10)}` : 'Open date unknown'}
                            {sourceLocator(h.source_url) && <> · <a href={sourceLocator(h.source_url)!} target="_blank" rel="noopener noreferrer">Original listing ↗</a></>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

        </div>
      </div>
    </div>,
    document.body
  );
};
