import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { WorkOrderReceipt, BuildStatusTotals } from './hooks/useBuildStatus';

interface Props {
  workOrders: WorkOrderReceipt[];
  totals: BuildStatusTotals;
  isOwnerView: boolean;
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDate = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--vp-brg, #006847)',
  in_progress: 'var(--vp-gulf-orange, #f48024)',
  draft: 'var(--vp-pencil, #888)',
  quoted: 'var(--vp-pencil, #888)',
};

interface WODetail {
  parts: any[];
  labor: any[];
  payments: any[];
}

const BuildStatusPanel: React.FC<Props> = ({ workOrders, totals, isOwnerView }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, WODetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<Set<string>>(new Set());

  const toggleOrder = async (woId: string) => {
    const next = new Set(expanded);
    if (next.has(woId)) {
      next.delete(woId);
      setExpanded(next);
      return;
    }
    next.add(woId);
    setExpanded(next);

    // Lazy-load detail if not cached
    if (!details[woId]) {
      setLoadingDetail(prev => new Set(prev).add(woId));
      try {
        const [partsRes, laborRes, paymentsRes] = await Promise.all([
          supabase.from('work_order_parts').select('part_name, supplier, total_price, is_comped, comp_reason, comp_retail_value, quantity').eq('work_order_id', woId).order('part_name'),
          supabase.from('work_order_labor').select('task_name, hours, total_cost, rate_source, hourly_rate, is_comped, comp_reason, comp_retail_value').eq('work_order_id', woId).order('task_name'),
          supabase.from('work_order_payments').select('payment_date, payment_method, amount, sender_name, memo').eq('work_order_id', woId).order('payment_date'),
        ]);
        setDetails(prev => ({
          ...prev,
          [woId]: {
            parts: partsRes.data || [],
            labor: laborRes.data || [],
            payments: paymentsRes.data || [],
          },
        }));
      } catch { /* silently degrade */ }
      setLoadingDetail(prev => { const n = new Set(prev); n.delete(woId); return n; });
    }
  };

  // Filter out zero-invoice work orders (draft/quoted with no line items)
  const activeOrders = workOrders.filter(wo => wo.invoice_total > 0 || wo.work_order_status === 'in_progress' || wo.work_order_status === 'completed');

  if (activeOrders.length === 0) return null;

  return (
    <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
      {/* Summary grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '2px', marginBottom: '4px' }}>
        <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>CHARGED</div>
          <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(totals.invoice)}</div>
        </div>
        <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>PAID</div>
          <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700 }}>{fmt(totals.paid)}</div>
        </div>
        <div style={{ border: '2px solid var(--vp-border)', padding: '6px 8px' }}>
          <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>BALANCE DUE</div>
          <div style={{
            fontFamily: 'var(--vp-font-mono)', fontSize: '11px', fontWeight: 700,
            color: totals.balance > 0 ? 'var(--vp-martini-red)' : 'var(--vp-brg)',
          }}>{fmt(totals.balance)}</div>
        </div>
      </div>

      {/* Goodwill line */}
      {totals.comped > 0 && (
        <div style={{
          fontSize: '8px', color: 'var(--vp-pencil)', textTransform: 'uppercase',
          letterSpacing: '0.08em', fontWeight: 700, marginBottom: '8px', paddingLeft: '2px',
        }}>
          GOODWILL: {fmt(totals.comped)}
        </div>
      )}

      {/* Work order rows */}
      {activeOrders.map(wo => {
        const isExp = expanded.has(wo.work_order_id);
        const dotColor = STATUS_COLORS[wo.work_order_status] || STATUS_COLORS.draft;
        const detail = details[wo.work_order_id];
        const isLoading = loadingDetail.has(wo.work_order_id);

        return (
          <div key={wo.work_order_id} style={{ marginBottom: '4px' }}>
            {/* Row header */}
            <div
              onClick={() => toggleOrder(wo.work_order_id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '6px 1fr auto auto',
                gap: '4px 8px',
                alignItems: 'center',
                padding: '4px 6px',
                cursor: 'pointer',
                border: '2px solid var(--vp-border)',
                background: isExp ? 'var(--vp-bg-alt, #fafafa)' : 'transparent',
                userSelect: 'none',
              }}
            >
              <span style={{
                display: 'inline-block', width: '6px', height: '6px',
                background: dotColor, flexShrink: 0,
              }} />
              <span style={{
                fontSize: '8px', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {isExp ? '\u25BE' : '\u25B8'} {wo.work_order_title}
              </span>
              <span style={{
                display: 'inline-block', padding: '1px 4px', fontSize: '7px',
                fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
                border: `1px solid ${dotColor}`, color: dotColor,
                fontFamily: 'var(--vp-font-mono)',
              }}>
                {wo.work_order_status.replace(/_/g, ' ')}
              </span>
              <span style={{
                fontFamily: 'var(--vp-font-mono)', fontSize: '9px', fontWeight: 700,
                textAlign: 'right', minWidth: '50px',
                color: wo.balance_due > 0 ? 'var(--vp-martini-red)' : 'var(--vp-brg)',
              }}>
                {fmt(wo.balance_due)}
              </span>
            </div>

            {/* Expanded detail */}
            {isExp && (
              <div style={{
                borderLeft: '2px solid var(--vp-border)',
                borderRight: '2px solid var(--vp-border)',
                borderBottom: '2px solid var(--vp-border)',
                padding: '6px 8px',
              }}>
                {isLoading && (
                  <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', padding: '4px 0' }}>Loading...</div>
                )}
                {detail && (
                  <>
                    {/* Parts */}
                    {detail.parts.length > 0 && (
                      <div style={{ marginBottom: '6px' }}>
                        <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '2px' }}>PARTS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1px 8px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>
                          {detail.parts.map((p: any, i: number) => (
                            <React.Fragment key={i}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.part_name}
                                {p.is_comped && (
                                  <span style={{
                                    marginLeft: '4px', padding: '0 3px', fontSize: '6px',
                                    fontWeight: 700, letterSpacing: '0.1em',
                                    border: '1px solid var(--vp-gulf-orange)', color: 'var(--vp-gulf-orange)',
                                  }}>COMPED</span>
                                )}
                              </span>
                              <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>{p.supplier || ''}</span>
                              <span style={{ textAlign: 'right' }}>{p.total_price != null ? fmt(Number(p.total_price)) : '\u2014'}</span>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Labor */}
                    {detail.labor.length > 0 && (
                      <div style={{ marginBottom: '6px' }}>
                        <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '2px' }}>LABOR</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1px 8px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>
                          {detail.labor.map((l: any, i: number) => (
                            <React.Fragment key={i}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {l.task_name}
                                {l.is_comped && (
                                  <span style={{
                                    marginLeft: '4px', padding: '0 3px', fontSize: '6px',
                                    fontWeight: 700, letterSpacing: '0.1em',
                                    border: '1px solid var(--vp-gulf-orange)', color: 'var(--vp-gulf-orange)',
                                  }}>COMPED</span>
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

                    {/* Payments */}
                    {detail.payments.length > 0 && (
                      <div>
                        <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '2px' }}>PAYMENTS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '1px 8px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px' }}>
                          {detail.payments.map((p: any, i: number) => (
                            <React.Fragment key={i}>
                              <span>{p.payment_date ? fmtDate(p.payment_date) : '\u2014'}</span>
                              <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>{p.payment_method || ''}</span>
                              <span style={{ textAlign: 'right', color: 'var(--vp-brg)' }}>{fmt(Number(p.amount))}</span>
                            </React.Fragment>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {detail.parts.length === 0 && detail.labor.length === 0 && detail.payments.length === 0 && (
                      <div style={{ fontSize: '8px', color: 'var(--vp-pencil)' }}>No line items yet</div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default BuildStatusPanel;
