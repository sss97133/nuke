import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { supabase } from '../../lib/supabase';

// ============================================================================
// PRICE BREAKDOWN POPUP
// ============================================================================

interface PriceBreakdownProps {
  hammerPrice: number;
  estimateLow?: number | null;
  estimateHigh?: number | null;
  source?: string;
  vehicleId?: string;
  onClose: () => void;
}

interface ComparableSale {
  id: string;
  year: number;
  make: string;
  model: string;
  winning_bid: number;
  auction_start_date: string;
  source: string;
  lot_number: string;
}

interface PriceLineItem {
  label: string;
  value: number | string;
  definition: string;
  highlight?: 'success' | 'warning' | 'muted';
}

export const PriceBreakdownPopup: React.FC<PriceBreakdownProps> = ({
  hammerPrice,
  estimateLow,
  estimateHigh,
  source = 'mecum',
  vehicleId,
  onClose
}) => {
  const [comparables, setComparables] = useState<ComparableSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDefinition, setActiveDefinition] = useState<string | null>(null);

  // Calculate fees based on source
  const buyerPremiumPct = source === 'mecum' ? 0.10 : source === 'barrett_jackson' ? 0.10 : 0.10;
  const sellerCommPct = source === 'mecum' ? 0.10 : source === 'barrett_jackson' ? 0.10 : 0.10;
  const sellerEntryFee = source === 'mecum' ? 350 : 300;

  const buyerPremium = hammerPrice * buyerPremiumPct;
  const buyerTotal = hammerPrice + buyerPremium;
  const sellerComm = hammerPrice * sellerCommPct;
  const sellerNet = hammerPrice - sellerComm - sellerEntryFee;
  const houseTake = buyerPremium + sellerComm + sellerEntryFee;

  // Price vs estimate
  let vsEstimate = '';
  if (estimateLow && estimateHigh) {
    const mid = (estimateLow + estimateHigh) / 2;
    const diff = ((hammerPrice - mid) / mid) * 100;
    if (diff > 5) vsEstimate = `+${Math.round(diff)}% over`;
    else if (diff < -5) vsEstimate = `${Math.round(diff)}% under`;
    else vsEstimate = 'Within range';
  }

  // Fetch comparables
  useEffect(() => {
    const fetchComparables = async () => {
      if (!vehicleId) {
        setLoading(false);
        return;
      }

      // Get vehicle info first
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('year, make, model')
        .eq('id', vehicleId)
        .single();

      if (!vehicle) {
        setLoading(false);
        return;
      }

      // Find similar vehicles
      const { data: comps } = await supabase
        .from('auction_events')
        .select(`
          id, winning_bid, auction_start_date, source, lot_number,
          vehicles!inner(id, year, make, model)
        `)
        .eq('vehicles.make', vehicle.make)
        .eq('vehicles.model', vehicle.model)
        .gte('vehicles.year', vehicle.year - 3)
        .lte('vehicles.year', vehicle.year + 3)
        .not('winning_bid', 'is', null)
        .neq('vehicle_id', vehicleId)
        .order('auction_start_date', { ascending: false })
        .limit(5);

      if (comps) {
        setComparables(comps.map((c: any) => ({
          id: c.vehicles.id,
          year: c.vehicles.year,
          make: c.vehicles.make,
          model: c.vehicles.model,
          winning_bid: c.winning_bid,
          auction_start_date: c.auction_start_date,
          source: c.source,
          lot_number: c.lot_number
        })));
      }
      setLoading(false);
    };

    fetchComparables();
  }, [vehicleId]);

  const lineItems: PriceLineItem[] = [
    ...(estimateLow && estimateHigh ? [{
      label: 'Estimate Range',
      value: `$${(estimateLow/1000).toFixed(0)}K - $${(estimateHigh/1000).toFixed(0)}K`,
      definition: 'Pre-auction estimate set by the auction house based on market data, condition, and comparable sales.',
      highlight: 'muted' as const
    }] : []),
    {
      label: 'Hammer Price',
      value: hammerPrice,
      definition: 'The final bid amount when the auctioneer\'s hammer falls. This is the base price before any fees.',
    },
    ...(vsEstimate ? [{
      label: 'vs Estimate',
      value: vsEstimate,
      definition: 'How the final price compared to the mid-point of the estimate range.',
      highlight: (vsEstimate.startsWith('+') ? 'success' : vsEstimate.startsWith('-') ? 'warning' : 'muted') as 'success' | 'warning' | 'muted'
    }] : []),
    {
      label: `Buyer Premium (${(buyerPremiumPct*100).toFixed(0)}%)`,
      value: buyerPremium,
      definition: `Fee charged to the buyer on top of hammer price. ${source?.toUpperCase()} charges ${(buyerPremiumPct*100).toFixed(0)}% for in-person bidders.`,
    },
    {
      label: 'Buyer Total',
      value: buyerTotal,
      definition: 'Total amount the buyer pays = Hammer Price + Buyer Premium. Does not include taxes, transport, or registration.',
      highlight: 'success'
    },
    {
      label: `Seller Commission (${(sellerCommPct*100).toFixed(0)}%)`,
      value: sellerComm,
      definition: `Commission taken from the seller\'s proceeds. Standard rate is ${(sellerCommPct*100).toFixed(0)}% for reserve listings.`,
    },
    {
      label: 'Entry Fee',
      value: sellerEntryFee,
      definition: `Flat fee charged to sellers to list their vehicle. Ranges from $${sellerEntryFee} to $1,000 depending on lot placement.`,
    },
    {
      label: 'Seller Net',
      value: sellerNet,
      definition: 'Amount the seller receives after commission and entry fee are deducted from the hammer price.',
      highlight: 'warning'
    },
    {
      label: 'House Take',
      value: houseTake,
      definition: 'Total revenue the auction house earns from this transaction (buyer premium + seller commission + entry fee).',
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
          borderRadius: '8px',
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
          <span style={{ fontWeight: 700, fontSize: '13px' }}>PRICE BREAKDOWN</span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '18px', color: 'var(--text-muted)', lineHeight: 1
          }}>×</button>
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
                  {typeof item.value === 'number' ? `$${item.value.toLocaleString()}` : item.value}
                </span>
              </div>
              {activeDefinition === item.label && (
                <div style={{
                  marginTop: '8px',
                  padding: '8px',
                  background: 'var(--surface)',
                  borderRadius: '4px',
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

        {/* Comparables */}
        {vehicleId && (
          <div style={{ borderTop: '2px solid var(--border)' }}>
            <div style={{
              padding: '12px 16px',
              fontWeight: 700,
              fontSize: '11px',
              color: 'var(--text-muted)'
            }}>
              COMPARABLE SALES
            </div>
            {loading ? (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                Loading...
              </div>
            ) : comparables.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                No comparables found
              </div>
            ) : (
              <div style={{ padding: '0 8px 12px' }}>
                {comparables.map((comp) => (
                  <a
                    key={comp.id}
                    href={`/vehicles/${comp.id}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      display: 'block',
                      padding: '8px',
                      margin: '4px 0',
                      background: 'var(--surface-raised)',
                      borderRadius: '4px',
                      textDecoration: 'none',
                      color: 'inherit'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '11px' }}>
                        {comp.year} {comp.make} {comp.model}
                      </span>
                      <span style={{ fontSize: '11px', fontWeight: 600, fontFamily: 'monospace' }}>
                        ${comp.winning_bid.toLocaleString()}
                      </span>
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {comp.source?.toUpperCase()} {comp.lot_number} • {new Date(comp.auction_start_date).toLocaleDateString()}
                    </div>
                  </a>
                ))}
              </div>
            )}
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
  broadcastStart: number;
  broadcastEnd?: number | null;
  auctionName?: string | null;
  onClose: () => void;
}

interface LotHistorical {
  id: string;
  vehicle_id: string;
  auction_name: string;
  auction_start_date: string;
  winning_bid: number | null;
  outcome: string;
  year?: number;
  make?: string;
  model?: string;
}

interface TimeSlotStats {
  hour: number;
  total: number;
  sold: number;
  avgPrice: number;
  sellRate: number;
}

export const LotStatsPopup: React.FC<LotStatsProps> = ({
  lotNumber,
  source,
  broadcastStart,
  broadcastEnd,
  auctionName,
  onClose
}) => {
  const [historical, setHistorical] = useState<LotHistorical[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlotStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'performance' | 'historical' | 'timeslots'>('performance');

  const duration = (broadcastEnd || broadcastStart + 60) - broadcastStart;
  const hourOfDay = Math.floor(broadcastStart / 3600);
  const minuteOfHour = Math.floor((broadcastStart % 3600) / 60);

  // Lot number analysis
  const lotPrefix = lotNumber.match(/^[A-Z]+/)?.[0] || '';
  const lotNum = parseInt(lotNumber.replace(/^[A-Z]+/, '').split('.')[0]) || 0;
  const lotSuffix = lotNumber.includes('.') ? lotNumber.split('.')[1] : null;

  const lotPrefixMeaning: Record<string, string> = {
    'S': 'Main Stage - Premium placement, highest visibility',
    'F': 'Featured - High-value consignments with prime slots',
    'T': 'Tent/Secondary - Standard consignments',
    'K': 'Kissimmee Special - Event-specific designation',
  };

  useEffect(() => {
    const fetchData = async () => {
      // Fetch historical lot data (same lot number across auctions)
      const { data: histData } = await supabase
        .from('auction_events')
        .select(`
          id, vehicle_id, auction_name, auction_start_date, winning_bid, outcome,
          vehicles(year, make, model)
        `)
        .eq('lot_number', lotNumber)
        .eq('source', source)
        .order('auction_start_date', { ascending: false })
        .limit(10);

      if (histData) {
        setHistorical(histData.map((h: any) => ({
          ...h,
          year: h.vehicles?.year,
          make: h.vehicles?.make,
          model: h.vehicles?.model
        })));
      }

      // Fetch time slot statistics
      const { data: slotData } = await supabase
        .rpc('get_auction_timeslot_stats', { source_filter: source })
        .limit(24);

      if (slotData) {
        setTimeSlots(slotData);
      } else {
        // Fallback: calculate manually if RPC doesn't exist
        const { data: allEvents } = await supabase
          .from('auction_events')
          .select('broadcast_timestamp_start, winning_bid, outcome')
          .eq('source', source)
          .not('broadcast_timestamp_start', 'is', null)
          .limit(500);

        if (allEvents) {
          const byHour: Record<number, { total: number; sold: number; prices: number[] }> = {};
          allEvents.forEach((e: any) => {
            const h = Math.floor(e.broadcast_timestamp_start / 3600);
            if (!byHour[h]) byHour[h] = { total: 0, sold: 0, prices: [] };
            byHour[h].total++;
            if (e.outcome === 'sold' && e.winning_bid) {
              byHour[h].sold++;
              byHour[h].prices.push(e.winning_bid);
            }
          });

          const stats: TimeSlotStats[] = Object.entries(byHour).map(([hour, data]) => ({
            hour: parseInt(hour),
            total: data.total,
            sold: data.sold,
            avgPrice: data.prices.length > 0 ? data.prices.reduce((a,b)=>a+b,0) / data.prices.length : 0,
            sellRate: data.total > 0 ? (data.sold / data.total) * 100 : 0
          })).sort((a,b) => a.hour - b.hour);

          setTimeSlots(stats);
        }
      }

      setLoading(false);
    };

    fetchData();
  }, [lotNumber, source]);

  const currentSlotStats = timeSlots.find(s => s.hour === hourOfDay);

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
          borderRadius: '8px',
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
          {(['performance', 'historical', 'timeslots'] as const).map(tab => (
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
              {tab === 'performance' ? 'This Lot' : tab === 'historical' ? 'History' : 'Time Slots'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: '12px 16px' }}>
          {activeSection === 'performance' && (
            <>
              {/* Lot breakdown */}
              <div style={{
                padding: '12px',
                background: 'var(--surface-raised)',
                borderRadius: '6px',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  LOT NUMBER BREAKDOWN
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{
                    background: 'var(--accent)',
                    color: 'white',
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '14px',
                    fontWeight: 700
                  }}>
                    {lotPrefix}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: 600 }}>{lotNum}</span>
                  {lotSuffix && (
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>.{lotSuffix}</span>
                  )}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {lotPrefixMeaning[lotPrefix] || 'Standard lot designation'}
                </div>
                {lotSuffix && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    .{lotSuffix} = Sub-lot (additional vehicle in same slot)
                  </div>
                )}
              </div>

              {/* Timing */}
              <div style={{
                padding: '12px',
                background: 'var(--surface-raised)',
                borderRadius: '6px',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  TIMING ANALYSIS
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace' }}>
                      {Math.floor(duration / 60)}:{String(duration % 60).padStart(2, '0')}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Time on block</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace' }}>
                      {hourOfDay}:{String(minuteOfHour).padStart(2, '0')}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Broadcast time</div>
                  </div>
                </div>
              </div>

              {/* Current slot performance */}
              {currentSlotStats && (
                <div style={{
                  padding: '12px',
                  background: 'var(--surface-raised)',
                  borderRadius: '6px'
                }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    HOUR {hourOfDay} PERFORMANCE
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 700 }}>{currentSlotStats.total}</div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Total lots</div>
                    </div>
                    <div>
                      <div style={{
                        fontSize: '16px',
                        fontWeight: 700,
                        color: currentSlotStats.sellRate > 70 ? 'var(--success)' : 'var(--warning)'
                      }}>
                        {currentSlotStats.sellRate.toFixed(0)}%
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Sell rate</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace' }}>
                        ${(currentSlotStats.avgPrice / 1000).toFixed(0)}K
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>Avg price</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {activeSection === 'historical' && (
            <>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Same lot number ({lotNumber}) across different {source?.toUpperCase()} auctions
              </div>
              {loading ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Loading...
                </div>
              ) : historical.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                  No historical data for this lot number
                </div>
              ) : (
                <div>
                  {historical.map((h) => (
                    <a
                      key={h.id}
                      href={`/vehicles/${h.vehicle_id}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'block',
                        padding: '10px',
                        margin: '4px 0',
                        background: 'var(--surface-raised)',
                        borderRadius: '4px',
                        textDecoration: 'none',
                        color: 'inherit'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 600 }}>
                            {h.year} {h.make} {h.model}
                          </div>
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {h.auction_name || source?.toUpperCase()}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {h.winning_bid ? (
                            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--success)' }}>
                              ${h.winning_bid.toLocaleString()}
                            </div>
                          ) : (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                              {h.outcome || 'No sale'}
                            </div>
                          )}
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                            {new Date(h.auction_start_date).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          {activeSection === 'timeslots' && (
            <>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '12px' }}>
                Performance by broadcast hour for {source?.toUpperCase()}
              </div>
              {loading ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Loading...
                </div>
              ) : timeSlots.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)' }}>
                  No time slot data available
                </div>
              ) : (
                <div>
                  {/* Mini bar chart */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-end',
                    height: '80px',
                    gap: '2px',
                    marginBottom: '12px',
                    padding: '8px',
                    background: 'var(--surface-raised)',
                    borderRadius: '6px'
                  }}>
                    {timeSlots.map((slot) => {
                      const maxRate = Math.max(...timeSlots.map(s => s.sellRate));
                      const height = maxRate > 0 ? (slot.sellRate / maxRate) * 100 : 0;
                      const isCurrentHour = slot.hour === hourOfDay;

                      return (
                        <div
                          key={slot.hour}
                          style={{
                            flex: 1,
                            background: isCurrentHour ? 'var(--accent)' :
                                        slot.sellRate > 70 ? 'var(--success)' :
                                        slot.sellRate > 50 ? 'var(--warning)' : 'var(--text-muted)',
                            height: `${Math.max(height, 5)}%`,
                            borderRadius: '2px 2px 0 0',
                            opacity: isCurrentHour ? 1 : 0.6
                          }}
                          title={`Hour ${slot.hour}: ${slot.sellRate.toFixed(0)}% sell rate`}
                        />
                      );
                    })}
                  </div>

                  {/* Top performing slots */}
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                    BEST TIME SLOTS
                  </div>
                  {[...timeSlots]
                    .sort((a, b) => b.sellRate - a.sellRate)
                    .slice(0, 3)
                    .map((slot, idx) => (
                      <div
                        key={slot.hour}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '8px',
                          background: slot.hour === hourOfDay ? 'var(--accent-dim)' : 'var(--surface-raised)',
                          borderRadius: '4px',
                          marginBottom: '4px',
                          border: slot.hour === hourOfDay ? '1px solid var(--accent)' : 'none'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            background: idx === 0 ? 'gold' : idx === 1 ? 'silver' : '#cd7f32',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: 700
                          }}>
                            {idx + 1}
                          </span>
                          <span style={{ fontSize: '11px' }}>Hour {slot.hour}</span>
                          {slot.hour === hourOfDay && (
                            <span style={{ fontSize: '9px', color: 'var(--accent)' }}>← This lot</span>
                          )}
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--success)' }}>
                            {slot.sellRate.toFixed(0)}%
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                            {slot.sold}/{slot.total} sold
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
