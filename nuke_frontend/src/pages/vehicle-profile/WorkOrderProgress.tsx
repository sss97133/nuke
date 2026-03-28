import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

// ── Types ──

interface LineItem {
  id: string;
  line_number: number;
  task_type: string;
  task_description: string;
  hours_labor: number | null;
  parts_cost_cents: number | null;
  total_cost_cents: number | null;
  status: string;
  notes: string | null;
}

interface WorkOrder {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtCents = (c: number) => fmt(c / 100);

const STATUS_BADGE_STYLE = (status: string): React.CSSProperties => {
  const color = status === 'complete' ? 'var(--vp-brg, #004225)' :
    status === 'in_progress' ? 'var(--vp-gulf-orange, #EE7623)' :
    'var(--vp-pencil, #888)';
  return {
    display: 'inline-block',
    padding: '1px 4px',
    fontSize: '6px',
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    border: `1px solid ${color}`,
    color,
    fontFamily: 'var(--vp-font-mono)',
  };
};

// ── Component ──

interface Props {
  vehicleId: string;
  isOwnerView: boolean;
}

const WorkOrderProgress: React.FC<Props> = ({ vehicleId, isOwnerView }) => {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [lineItems, setLineItems] = useState<Record<string, LineItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!vehicleId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const { data: wos, error: woErr } = await supabase
          .from('work_orders')
          .select('id, title, status, created_at')
          .eq('vehicle_id', vehicleId)
          .in('status', ['in_progress', 'draft', 'quoted', 'active'])
          .order('created_at');

        if (cancelled || woErr || !wos?.length) {
          if (!cancelled) setLoading(false);
          return;
        }
        setWorkOrders(wos);

        // Load all line items for these work orders in one query
        const woIds = wos.map(w => w.id);
        const { data: items, error: liErr } = await supabase
          .from('work_order_line_items')
          .select('id, work_order_id, line_number, task_type, task_description, hours_labor, parts_cost_cents, total_cost_cents, status, notes')
          .in('work_order_id', woIds)
          .order('line_number');

        if (cancelled) return;
        if (!liErr && items) {
          const grouped: Record<string, LineItem[]> = {};
          for (const item of items) {
            const woId = (item as any).work_order_id;
            if (!grouped[woId]) grouped[woId] = [];
            grouped[woId].push(item as LineItem);
          }
          setLineItems(grouped);
        }
      } catch {
        // silently degrade
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [vehicleId]);

  const toggleItemStatus = useCallback(async (itemId: string, currentStatus: string, woId: string) => {
    if (!isOwnerView) return;
    const newStatus = currentStatus === 'complete' ? 'in_progress' : 'complete';
    setUpdating(prev => new Set(prev).add(itemId));

    try {
      const { error } = await supabase
        .from('work_order_line_items')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', itemId);

      if (!error) {
        setLineItems(prev => ({
          ...prev,
          [woId]: (prev[woId] || []).map(li =>
            li.id === itemId ? { ...li, status: newStatus } : li
          ),
        }));
      }
    } catch {
      // silently degrade
    } finally {
      setUpdating(prev => {
        const next = new Set(prev);
        next.delete(itemId);
        return next;
      });
    }
  }, [isOwnerView]);

  if (loading) return null;
  if (workOrders.length === 0) return null;

  return (
    <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: 1.6 }}>
      {workOrders.map(wo => {
        const items = lineItems[wo.id] || [];
        if (items.length === 0) return null;

        const completedCount = items.filter(li => li.status === 'complete').length;
        const totalCount = items.length;
        const progressPct = Math.round((completedCount / totalCount) * 100);
        const totalBillable = items.reduce((s, li) => s + (li.total_cost_cents || 0), 0);

        return (
          <div key={wo.id} style={{ marginBottom: '10px' }}>
            {/* Work order header */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '4px 0',
              borderBottom: '2px solid var(--vp-ink, #1a1a1a)',
              marginBottom: '4px',
            }}>
              <span style={{
                fontSize: '8px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}>
                {wo.title}
              </span>
              <span style={{
                fontFamily: 'var(--vp-font-mono)',
                fontSize: '8px',
                fontWeight: 700,
              }}>
                {completedCount}/{totalCount}
              </span>
            </div>

            {/* Progress bar */}
            <div style={{
              height: '3px',
              background: 'var(--vp-ghost, #ddd)',
              marginBottom: '6px',
              position: 'relative',
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                height: '100%',
                width: `${progressPct}%`,
                background: progressPct === 100 ? 'var(--vp-brg, #004225)' : 'var(--vp-gulf-orange, #EE7623)',
                transition: 'width var(--vp-speed, 180ms) var(--vp-ease)',
              }} />
            </div>

            {/* Line items */}
            {items.map(li => {
              const isComplete = li.status === 'complete';
              const isUpdatingThis = updating.has(li.id);

              return (
                <div
                  key={li.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isOwnerView ? '16px 1fr auto auto auto' : '1fr auto auto auto',
                    gap: '2px 8px',
                    alignItems: 'center',
                    padding: '3px 0',
                    borderBottom: '1px solid var(--vp-ghost, #ddd)',
                    opacity: isComplete ? 0.6 : 1,
                    transition: 'opacity var(--vp-speed, 180ms) var(--vp-ease)',
                  }}
                >
                  {/* Checkbox (owner only) */}
                  {isOwnerView && (
                    <div
                      onClick={() => !isUpdatingThis && toggleItemStatus(li.id, li.status, wo.id)}
                      style={{
                        width: '12px',
                        height: '12px',
                        border: '2px solid var(--vp-ink)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: isUpdatingThis ? 'wait' : 'pointer',
                        background: isComplete ? 'var(--vp-brg, #004225)' : 'transparent',
                        flexShrink: 0,
                      }}
                    >
                      {isComplete && (
                        <span style={{ color: '#fff', fontSize: '8px', fontWeight: 700, lineHeight: 1 }}>
                          {'\u2713'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Task description */}
                  <span style={{
                    fontSize: '8px',
                    fontFamily: 'var(--vp-font-sans)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textDecoration: isComplete ? 'line-through' : 'none',
                    color: isComplete ? 'var(--vp-pencil)' : 'var(--vp-ink)',
                  }}>
                    {li.task_description}
                  </span>

                  {/* Status badge */}
                  <span style={STATUS_BADGE_STYLE(li.status)}>
                    {li.status.replace(/_/g, ' ')}
                  </span>

                  {/* Hours */}
                  <span style={{
                    fontFamily: 'var(--vp-font-mono)',
                    fontSize: '7px',
                    color: 'var(--vp-pencil)',
                    textAlign: 'right',
                    minWidth: '28px',
                  }}>
                    {li.hours_labor ? `${Number(li.hours_labor)}h` : ''}
                  </span>

                  {/* Cost */}
                  <span style={{
                    fontFamily: 'var(--vp-font-mono)',
                    fontSize: '8px',
                    fontWeight: 700,
                    textAlign: 'right',
                    minWidth: '45px',
                  }}>
                    {li.total_cost_cents ? fmtCents(li.total_cost_cents) : '\u2014'}
                  </span>
                </div>
              );
            })}

            {/* Total row */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '4px 0 0',
              fontFamily: 'var(--vp-font-mono)',
              fontSize: '8px',
              fontWeight: 700,
            }}>
              <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--vp-pencil)' }}>
                {progressPct}% COMPLETE
              </span>
              <span>{fmtCents(totalBillable)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WorkOrderProgress;
