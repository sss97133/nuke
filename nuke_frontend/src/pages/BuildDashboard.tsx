/**
 * BuildDashboard — Build Coordinator surface for a single vehicle.
 * Route: /builds/:vehicleId
 *
 * First product surface for the build-coordinator. Dogfood: Skylar's K20.
 * No auth required — public reads via RLS on work_orders / work_order_line_items / work_order_payments.
 *
 * Sections:
 *   1. Header (vehicle + budget)
 *   2. Cost meter (estimated / actual / paid)
 *   3. Decision Briefs (work_orders with metadata.decision_type)
 *   4. Work Orders table (click to expand line items)
 *   5. Payments timeline
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import './BuildDashboard.css';

// ── Types ──

interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  current_value: number | null;
}

interface WorkOrder {
  id: string;
  title: string | null;
  description: string | null;
  status: string | null;
  estimated_total: number | string | null;
  actual_total: number | string | null;
  metadata: any;
  created_at: string;
}

interface LineItem {
  id: string;
  work_order_id: string;
  line_number: number | null;
  task_type: string | null;
  task_description: string | null;
  hours_labor: number | string | null;
  labor_rate_cents: number | null;
  parts_cost_cents: number | null;
  total_cost_cents: number | null;
  status: string | null;
}

interface Payment {
  id: string;
  work_order_id: string;
  amount: number | string;
  payment_method: string;
  payment_date: string;
  sender_name: string | null;
  memo: string | null;
}

// ── Helpers ──

const num = (v: number | string | null | undefined): number => {
  if (v == null) return 0;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return isFinite(n) ? n : 0;
};

const fmtMoney = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtMoneyDetail = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
};

// ══════════════════════════════════════════════════════
// Component
// ══════════════════════════════════════════════════════

const BuildDashboard: React.FC = () => {
  const { vehicleId = '' } = useParams<{ vehicleId: string }>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [lineItemsByWO, setLineItemsByWO] = useState<Record<string, LineItem[]>>({});
  const [expandedWO, setExpandedWO] = useState<string | null>(null);

  // ── Initial load: vehicle + work orders + payments in parallel ──
  useEffect(() => {
    if (!vehicleId) {
      setLoading(false);
      setError('No vehicle id in route.');
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const [vehicleRes, woRes] = await Promise.all([
          supabase
            .from('vehicles')
            .select('id, year, make, model, vin, current_value')
            .eq('id', vehicleId)
            .maybeSingle(),
          supabase
            .from('work_orders')
            .select('id, title, description, status, estimated_total, actual_total, metadata, created_at')
            .eq('vehicle_id', vehicleId)
            .order('created_at', { ascending: false }),
        ]);

        if (cancelled) return;

        if (vehicleRes.error) {
          // Don't kill the page — vehicles may have RLS issues; continue with work orders
          console.warn('vehicle fetch error:', vehicleRes.error);
        } else {
          setVehicle((vehicleRes.data as Vehicle) || null);
        }

        if (woRes.error) {
          setError(`Could not load work orders: ${woRes.error.message}`);
          setLoading(false);
          return;
        }

        const wos = (woRes.data as WorkOrder[]) || [];
        setWorkOrders(wos);

        // Pull payments for all those work order ids
        const woIds = wos.map(w => w.id);
        if (woIds.length > 0) {
          const payRes = await supabase
            .from('work_order_payments')
            .select('id, work_order_id, amount, payment_method, payment_date, sender_name, memo')
            .in('work_order_id', woIds)
            .order('payment_date', { ascending: false });

          if (!cancelled && !payRes.error) {
            setPayments((payRes.data as Payment[]) || []);
          }
        }

        if (!cancelled) setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(`Load failed: ${err?.message || String(err)}`);
          setLoading(false);
        }
      }
    };

    run();
    return () => { cancelled = true; };
  }, [vehicleId]);

  // ── Lazy load line items when a row is expanded ──
  const toggleExpand = async (woId: string) => {
    if (expandedWO === woId) {
      setExpandedWO(null);
      return;
    }
    setExpandedWO(woId);
    if (lineItemsByWO[woId]) return; // already loaded

    const { data, error: liErr } = await supabase
      .from('work_order_line_items')
      .select('id, work_order_id, line_number, task_type, task_description, hours_labor, labor_rate_cents, parts_cost_cents, total_cost_cents, status')
      .eq('work_order_id', woId)
      .order('line_number', { ascending: true });

    if (!liErr) {
      setLineItemsByWO(prev => ({ ...prev, [woId]: (data as LineItem[]) || [] }));
    } else {
      console.warn('line items fetch error', liErr);
      setLineItemsByWO(prev => ({ ...prev, [woId]: [] }));
    }
  };

  // ── Derived ──

  const decisionBriefs = useMemo(
    () => workOrders.filter(w => w?.metadata && w.metadata.decision_type),
    [workOrders],
  );

  const totals = useMemo(() => {
    const estimated = workOrders.reduce((s, w) => s + num(w.estimated_total), 0);
    const actual = workOrders.reduce((s, w) => s + num(w.actual_total), 0);
    const paid = payments.reduce((s, p) => s + num(p.amount), 0);
    return { estimated, actual, paid };
  }, [workOrders, payments]);

  const budget = useMemo(() => {
    // Prefer explicit budget_total_usd in any work order metadata; fallback to vehicle.current_value
    const fromMeta = workOrders
      .map(w => num(w?.metadata?.budget_total_usd))
      .find(n => n > 0);
    if (fromMeta) return fromMeta;
    if (vehicle?.current_value) return num(vehicle.current_value);
    return null;
  }, [workOrders, vehicle]);

  const vehicleTitle = vehicle
    ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    : 'Build';

  // ── Render ──

  if (loading) {
    return (
      <div className="bd-page">
        <div className="bd-container">
          <div className="bd-loading">Loading build...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="bd-page">
      <div className="bd-container">

        {/* ── Header ── */}
        <div className="bd-header">
          <div className="bd-header-left">
            <h1>{vehicleTitle}</h1>
            {vehicle?.vin && <div className="bd-header-vin">VIN {vehicle.vin}</div>}
          </div>
          {budget != null && (
            <div className="bd-header-right">
              <div className="bd-header-budget-label">Build Budget</div>
              <div className="bd-header-budget-value">{fmtMoney(budget)}</div>
            </div>
          )}
        </div>

        {error && <div className="bd-error">{error}</div>}

        {/* ── Cost meter ── */}
        <div className="bd-section">
          <div className="bd-section-label">Cost Meter</div>
          <div className="bd-meter">
            <div className="bd-meter-numbers">
              <div>
                <div className="bd-meter-num-label">Estimated</div>
                <div className="bd-meter-num-value">{fmtMoney(totals.estimated)}</div>
              </div>
              <div>
                <div className="bd-meter-num-label">Actual</div>
                <div className="bd-meter-num-value">{fmtMoney(totals.actual)}</div>
              </div>
              <div>
                <div className="bd-meter-num-label">Paid</div>
                <div className="bd-meter-num-value">{fmtMoney(totals.paid)}</div>
              </div>
            </div>
            <div className="bd-meter-bar">
              {totals.estimated > 0 && (
                <>
                  <div
                    className="bd-meter-bar-actual"
                    style={{
                      width: `${Math.min(100, (totals.actual / totals.estimated) * 100)}%`,
                    }}
                  />
                  <div
                    className="bd-meter-bar-paid"
                    style={{
                      width: `${Math.min(100, (totals.paid / totals.estimated) * 100)}%`,
                    }}
                  />
                </>
              )}
            </div>
            <div className="bd-meter-legend">
              <span>
                <span className="bd-meter-legend-dot" style={{ background: '#555' }} />
                Actual / Estimated
              </span>
              <span>
                <span className="bd-meter-legend-dot" style={{ background: '#fff' }} />
                Paid / Estimated
              </span>
            </div>
          </div>
        </div>

        {/* ── Decision Briefs ── */}
        {decisionBriefs.length > 0 && (
          <div className="bd-section">
            <div className="bd-section-label">Decision Briefs</div>
            {decisionBriefs.map(brief => {
              const briefPath = brief.metadata?.evidence_brief_path as string | undefined;
              const decisionType = brief.metadata?.decision_type as string | undefined;
              const tldr = (brief.description || '').slice(0, 200);
              return (
                <div key={brief.id} className="bd-brief">
                  <div className="bd-brief-header">
                    <h3 className="bd-brief-title">{brief.title || 'Untitled decision'}</h3>
                    {decisionType && (
                      <span className="bd-brief-badge">{decisionType.replace(/_/g, ' ')}</span>
                    )}
                  </div>
                  {tldr && <p className="bd-brief-tldr">{tldr}{(brief.description || '').length > 200 ? '...' : ''}</p>}
                  {briefPath && (
                    <span className="bd-brief-link">{briefPath}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Work Orders table ── */}
        <div className="bd-section">
          <div className="bd-section-label">Work Orders</div>
          {workOrders.length === 0 ? (
            <div className="bd-empty">No work orders yet for this build. Add one to start tracking.</div>
          ) : (
            <table className="bd-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th style={{ width: 100 }}>Status</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Estimated</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Actual</th>
                  <th style={{ width: 110 }}>Created</th>
                </tr>
              </thead>
              <tbody>
                {workOrders.map(wo => (
                  <React.Fragment key={wo.id}>
                    <tr
                      className={`bd-table-row ${expandedWO === wo.id ? 'bd-expanded' : ''}`}
                      onClick={() => toggleExpand(wo.id)}
                    >
                      <td>{wo.title || '—'}</td>
                      <td>
                        <span className="bd-status-badge">{wo.status || 'unknown'}</span>
                      </td>
                      <td className="bd-num">{fmtMoney(num(wo.estimated_total))}</td>
                      <td className="bd-num">{fmtMoney(num(wo.actual_total))}</td>
                      <td>{fmtDate(wo.created_at)}</td>
                    </tr>
                    {expandedWO === wo.id && (
                      <tr>
                        <td colSpan={5} className="bd-expansion">
                          {(() => {
                            const items = lineItemsByWO[wo.id];
                            if (!items) return <div className="bd-expansion-empty">Loading line items...</div>;
                            if (items.length === 0) return <div className="bd-expansion-empty">No line items yet.</div>;
                            return (
                              <table className="bd-expansion-table">
                                <thead>
                                  <tr>
                                    <th>#</th>
                                    <th>Task</th>
                                    <th style={{ textAlign: 'right' }}>Hours</th>
                                    <th style={{ textAlign: 'right' }}>Parts</th>
                                    <th style={{ textAlign: 'right' }}>Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map(li => (
                                    <tr key={li.id}>
                                      <td>{li.line_number ?? '—'}</td>
                                      <td>{li.task_description || li.task_type || '—'}</td>
                                      <td className="bd-num">{li.hours_labor != null ? num(li.hours_labor) : '—'}</td>
                                      <td className="bd-num">
                                        {li.parts_cost_cents != null ? fmtMoneyDetail(li.parts_cost_cents / 100) : '—'}
                                      </td>
                                      <td className="bd-num">
                                        {li.total_cost_cents != null ? fmtMoneyDetail(li.total_cost_cents / 100) : '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Payments timeline ── */}
        {payments.length > 0 && (
          <div className="bd-section">
            <div className="bd-section-label">Payments</div>
            {payments.map(p => (
              <div key={p.id} className="bd-payment">
                <div className="bd-payment-date">{fmtDate(p.payment_date)}</div>
                <div>
                  <span className="bd-payment-method">{p.payment_method}</span>
                  {p.sender_name && <span style={{ marginLeft: 8, color: '#aaa' }}>{p.sender_name}</span>}
                  {p.memo && <span style={{ marginLeft: 8, color: '#666', fontStyle: 'italic' }}>{p.memo}</span>}
                </div>
                <div className="bd-payment-amount">{fmtMoneyDetail(num(p.amount))}</div>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
};

export default BuildDashboard;
