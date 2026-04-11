import React, { useState } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { supabase } from '../../lib/supabase';
import { useInvestmentLedger, type OwnerEpoch } from './hooks/useInvestmentLedger';
import type { WorkOrderReceipt, VehicleReceipt } from './hooks/useBuildStatus';

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDate = (d: string) => {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};

const fmtDateFull = (d: string) => {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtDateShort = (d: string) => {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--vp-brg, #006847)',
  in_progress: 'var(--vp-gulf-orange, #f48024)',
  draft: 'var(--vp-pencil, #888)',
  quoted: 'var(--vp-pencil, #888)',
};

// ── Work Order Detail (lazy-loaded) ──

interface WODetail {
  parts: any[];
  labor: any[];
  payments: any[];
}

const WorkOrderRow: React.FC<{ wo: WorkOrderReceipt; isOwnerView: boolean }> = ({ wo, isOwnerView }) => {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<WODetail | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (!detail) {
      setLoading(true);
      try {
        const [partsRes, laborRes, paymentsRes] = await Promise.all([
          supabase.from('work_order_parts').select('part_name, supplier, total_price, is_comped, comp_reason, comp_retail_value, quantity').eq('work_order_id', wo.work_order_id).order('part_name'),
          supabase.from('work_order_labor').select('task_name, hours, total_cost, rate_source, hourly_rate, is_comped, comp_reason, comp_retail_value').eq('work_order_id', wo.work_order_id).order('task_name'),
          supabase.from('work_order_payments').select('payment_date, payment_method, amount, sender_name, memo').eq('work_order_id', wo.work_order_id).order('payment_date'),
        ]);
        setDetail({
          parts: partsRes.data || [],
          labor: laborRes.data || [],
          payments: paymentsRes.data || [],
        });
      } catch { /* silently degrade */ }
      setLoading(false);
    }
  };

  const dotColor = STATUS_COLORS[wo.work_order_status] || STATUS_COLORS.draft;

  return (
    <div style={{ marginBottom: '2px' }}>
      <div
        onClick={toggle}
        style={{
          display: 'grid',
          gridTemplateColumns: '6px 1fr auto auto',
          gap: '4px 8px',
          alignItems: 'center',
          padding: '4px 6px',
          cursor: 'pointer',
          border: '2px solid var(--vp-border)',
          background: expanded ? 'var(--vp-bg-alt, #fafafa)' : 'transparent',
          userSelect: 'none',
        }}
      >
        <span style={{ display: 'inline-block', width: '6px', height: '6px', background: dotColor, flexShrink: 0 }} />
        <span style={{ fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {expanded ? '\u25BE' : '\u25B8'} {wo.work_order_title}
        </span>
        <span style={{
          display: 'inline-block', padding: '1px 4px', fontSize: '7px',
          fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
          border: `1px solid ${dotColor}`, color: dotColor, fontFamily: 'var(--vp-font-mono)',
        }}>
          {wo.work_order_status.replace(/_/g, ' ')}
        </span>
        <span style={{
          fontFamily: 'var(--vp-font-mono)', fontSize: '9px', fontWeight: 700,
          textAlign: 'right', minWidth: '50px',
        }}>
          {fmt(wo.invoice_total)}
        </span>
      </div>

      {expanded && (
        <div style={{
          borderLeft: '2px solid var(--vp-border)',
          borderRight: '2px solid var(--vp-border)',
          borderBottom: '2px solid var(--vp-border)',
          padding: '6px 8px',
        }}>
          {loading && null}
          {detail && (
            <>
              {detail.parts.length > 0 && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '2px' }}>PARTS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1px 8px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>
                    {detail.parts.map((p: any, i: number) => (
                      <React.Fragment key={i}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.part_name}
                          {p.is_comped && (
                            <span style={{ marginLeft: '4px', padding: '0 3px', fontSize: '6px', fontWeight: 700, letterSpacing: '0.1em', border: '1px solid var(--vp-gulf-orange)', color: 'var(--vp-gulf-orange)' }}>COMPED</span>
                          )}
                        </span>
                        <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>{p.supplier || ''}</span>
                        <span style={{ textAlign: 'right' }}>{p.total_price != null ? fmt(Number(p.total_price)) : '\u2014'}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
              {detail.labor.length > 0 && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '2px' }}>LABOR</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1px 8px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>
                    {detail.labor.map((l: any, i: number) => (
                      <React.Fragment key={i}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.task_name}
                          {l.is_comped && (
                            <span style={{ marginLeft: '4px', padding: '0 3px', fontSize: '6px', fontWeight: 700, letterSpacing: '0.1em', border: '1px solid var(--vp-gulf-orange)', color: 'var(--vp-gulf-orange)' }}>COMPED</span>
                          )}
                        </span>
                        <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>
                          {l.hours != null ? `${Number(l.hours)}h` : ''}
                          {isOwnerView && l.rate_source ? ` (${l.rate_source})` : ''}
                        </span>
                        <span style={{ textAlign: 'right' }}>{l.total_cost != null ? fmt(Number(l.total_cost)) : '\u2014'}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
              {detail.payments.length > 0 && (
                <div>
                  <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '2px' }}>PAYMENTS</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1px 8px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>
                    {detail.payments.map((p: any, i: number) => (
                      <React.Fragment key={i}>
                        <span>{p.payment_date ? fmtDateShort(p.payment_date) : '\u2014'}</span>
                        <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>{p.payment_method || ''}</span>
                        <span style={{ textAlign: 'right', color: 'var(--vp-brg)' }}>{fmt(Number(p.amount))}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}
              {detail.parts.length === 0 && detail.labor.length === 0 && detail.payments.length === 0 && (
                <div style={{ fontSize: '8px', color: 'var(--vp-pencil)' }}>No line items yet</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

// ── Epoch Section ──

const EpochSection: React.FC<{
  epoch: OwnerEpoch;
  vehicleId: string;
  vehicle: any;
  isOwnerView: boolean;
}> = ({ epoch, vehicleId, vehicle, isOwnerView }) => {
  const activeOrders = epoch.workOrders.filter(wo => wo.invoice_total > 0 || wo.work_order_status === 'in_progress' || wo.work_order_status === 'completed');
  const receiptsTotal = epoch.receipts.reduce((s, r) => s + r.total, 0);

  // Lazy-load GenerateBill and WorkOrderProgress only for current owner
  const GenerateBill = React.lazy(() => import('./GenerateBill'));
  const WorkOrderProgress = React.lazy(() => import('./WorkOrderProgress'));

  // Build totals for GenerateBill
  const woTotals = {
    invoice: epoch.workOrders.reduce((s, w) => s + w.invoice_total, 0),
    paid: epoch.workOrders.reduce((s, w) => s + w.payments_total, 0),
    balance: epoch.workOrders.reduce((s, w) => s + w.balance_due, 0),
    comped: epoch.workOrders.reduce((s, w) => s + w.total_comped_value, 0),
    orderCount: epoch.workOrders.length,
    receiptsTotal,
  };

  const dateRange = [
    epoch.startDate ? fmtDate(epoch.startDate) : '?',
    epoch.endDate ? fmtDate(epoch.endDate) : 'present',
  ].join(' \u2014 ');

  return (
    <div style={{ marginBottom: '12px' }}>
      {/* Epoch header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        borderBottom: '2px solid var(--vp-ink)',
        padding: '4px 0 2px',
        marginBottom: '6px',
      }}>
        <span style={{
          fontSize: '9px', fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.06em', fontFamily: 'var(--vp-font-sans)',
        }}>
          {epoch.ownerName}
        </span>
        <span style={{
          fontSize: '8px', color: 'var(--vp-pencil)',
          fontFamily: 'var(--vp-font-mono)', letterSpacing: '0.04em',
        }}>
          {dateRange}
        </span>
      </div>

      {/* Financial summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', marginBottom: '6px' }}>
        {epoch.acquisitionCost != null && (
          <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>ACQUIRED</div>
            <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(epoch.acquisitionCost)}</div>
          </div>
        )}
        <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>INVESTED</div>
          <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(epoch.totalInvested)}</div>
        </div>
        {epoch.isCurrent && epoch.balanceDue > 0 ? (
          <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>BALANCE DUE</div>
            <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700, color: 'var(--vp-martini-red)' }}>{fmt(epoch.balanceDue)}</div>
          </div>
        ) : epoch.salePrice != null ? (
          <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>SOLD FOR</div>
            <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(epoch.salePrice)}</div>
          </div>
        ) : null}
      </div>

      {/* Work orders */}
      {activeOrders.length > 0 && (
        <div style={{ marginBottom: '6px' }}>
          <div style={{
            fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase',
            letterSpacing: '0.1em', fontWeight: 700, marginBottom: '4px', paddingLeft: '2px',
          }}>
            WORK ORDERS ({activeOrders.length})
          </div>
          {activeOrders.map(wo => (
            <WorkOrderRow key={wo.work_order_id} wo={wo} isOwnerView={isOwnerView} />
          ))}
        </div>
      )}

      {/* Receipts / parts orders */}
      {epoch.receipts.length > 0 && (
        <div style={{ marginBottom: '6px' }}>
          <div style={{
            fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase',
            letterSpacing: '0.1em', fontWeight: 700, marginBottom: '4px', paddingLeft: '2px',
          }}>
            PARTS ORDERS ({epoch.receipts.length})
          </div>
          {epoch.receipts.map(r => (
            <div
              key={r.id}
              style={{
                display: 'grid', gridTemplateColumns: '60px 1fr auto',
                gap: '4px 8px', alignItems: 'center',
                padding: '3px 6px', border: '1px solid var(--vp-border)',
                marginBottom: '2px', fontSize: '8px', fontFamily: 'var(--vp-font-mono)',
              }}
            >
              <span style={{ color: 'var(--vp-pencil)' }}>
                {r.receipt_date ? fmtDateShort(r.receipt_date) : '\u2014'}
              </span>
              <span style={{
                fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: 'var(--vp-font-sans)',
              }}>
                {r.vendor_name || 'Unknown vendor'}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(r.total)}</span>
            </div>
          ))}
          <div style={{
            fontSize: '8px', fontWeight: 700, textAlign: 'right',
            fontFamily: 'var(--vp-font-mono)', padding: '2px 6px', color: 'var(--vp-pencil)',
          }}>
            PARTS TOTAL: {fmt(receiptsTotal)}
          </div>
        </div>
      )}

      {/* Goodwill */}
      {epoch.totalComped > 0 && (
        <div style={{
          fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: '6px', paddingLeft: '2px',
        }}>
          GOODWILL: {fmt(epoch.totalComped)}
        </div>
      )}

      {/* Current owner actions: GenerateBill + WorkOrderProgress */}
      {epoch.isCurrent && isOwnerView && woTotals.orderCount > 0 && (
        <React.Suspense fallback={null}>
          <div style={{ display: 'flex', gap: '4px', marginBottom: '4px' }}>
            <div style={{ flex: 1 }}>
              <GenerateBill
                vehicleId={vehicleId}
                workOrders={epoch.workOrders}
                totals={woTotals}
                contact={epoch.contact}
                vehicle={vehicle}
                isOwnerView={isOwnerView}
              />
            </div>
          </div>
          <WorkOrderProgress vehicleId={vehicleId} isOwnerView={isOwnerView} />
        </React.Suspense>
      )}

      {/* ROI line for completed epochs */}
      {!epoch.isCurrent && epoch.profitLoss != null && (
        <div style={{
          fontSize: '8px', fontWeight: 700, fontFamily: 'var(--vp-font-mono)',
          color: epoch.profitLoss >= 0 ? 'var(--vp-brg)' : 'var(--vp-martini-red)',
          padding: '4px 2px',
        }}>
          RETURN: {epoch.profitLoss >= 0 ? '+' : ''}{fmt(epoch.profitLoss)}
          {epoch.acquisitionCost != null && epoch.acquisitionCost > 0 && (
            <span> on {fmt(epoch.acquisitionCost)} basis</span>
          )}
          {epoch.roiPercent != null && (
            <span> ({epoch.roiPercent >= 0 ? '+' : ''}{epoch.roiPercent.toLocaleString()}%)</span>
          )}
        </div>
      )}

      {/* Empty state */}
      {activeOrders.length === 0 && epoch.receipts.length === 0 && (
        <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', fontStyle: 'italic', padding: '2px' }}>
          No tracked work orders or receipts in this period.
        </div>
      )}
    </div>
  );
};

// ── Main Component ──

interface InvestmentLedgerProps {
  vehicleId: string;
  vehicle?: any;
  isOwnerView: boolean;
}

const InvestmentLedger: React.FC<InvestmentLedgerProps> = ({ vehicleId, vehicle, isOwnerView }) => {
  const { data, loading } = useInvestmentLedger(vehicleId);

  if (loading || !data.hasData) return null;

  // Show epochs in reverse order (current owner first)
  const epochs = [...data.epochs].reverse();

  const totalInvested = data.epochs.reduce((s, ep) => s + ep.totalInvested, 0);

  return (
    <CollapsibleWidget
      variant="profile"
      title="Investment Ledger"
      defaultCollapsed={false}
      badge={
        totalInvested > 0 ? (
          <span className="widget__count">
            TOTAL IN: {fmt(totalInvested)}
          </span>
        ) : undefined
      }
    >
      <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
        {epochs.map(ep => (
          <EpochSection
            key={ep.index}
            epoch={ep}
            vehicleId={vehicleId}
            vehicle={vehicle}
            isOwnerView={isOwnerView}
          />
        ))}
      </div>
    </CollapsibleWidget>
  );
};

export default InvestmentLedger;
