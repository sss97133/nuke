/**
 * WorkOrderStatement — Editable Invoice (Owner View)
 *
 * Full CRUD on parts, labor, payments with inline editing.
 * Route: /work-orders/statement?q=granholm (or ?vehicle_id=UUID)
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import {
  useWorkOrderStatement,
  type PartRow,
  type LaborRow,
  type PaymentRow,
} from './vehicle-profile/hooks/useWorkOrderStatement';

// ── Helpers ──

const fmt = (n: number) =>
  '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtDateShort = (d: string) => {
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ── Inline Cell Editor ──

interface CellEditorProps {
  value: any;
  type?: 'text' | 'number';
  format?: 'currency' | 'plain';  // currency adds $, plain shows raw number
  onSave: (value: any) => void;
  style?: React.CSSProperties;
  placeholder?: string;
}

const CellEditor: React.FC<CellEditorProps> = ({ value, type = 'text', format = 'currency', onSave, style, placeholder }) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const saveRef = useRef<NodeJS.Timeout>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value ?? '');
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const doSave = useCallback(async (val: any) => {
    const parsed = type === 'number' ? (val === '' ? null : Number(val)) : val;
    if (parsed === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(parsed);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      // revert
      setEditValue(value ?? '');
    }
    setSaving(false);
    setEditing(false);
  }, [value, type, onSave]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setEditValue(v);
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => doSave(v), 1500);
  };

  const handleBlur = () => {
    if (saveRef.current) clearTimeout(saveRef.current);
    doSave(editValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (saveRef.current) clearTimeout(saveRef.current);
      doSave(editValue);
    }
    if (e.key === 'Escape') {
      setEditValue(value ?? '');
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div style={{ position: 'relative', ...style }}>
        <input
          ref={inputRef}
          type={type}
          step={type === 'number' ? '0.01' : undefined}
          value={editValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            width: '100%',
            border: '1px solid var(--vp-gulf-orange, #EE7623)',
            padding: '1px 4px',
            fontSize: 'inherit',
            fontFamily: 'inherit',
            fontWeight: 'inherit',
            textAlign: 'inherit',
            background: 'var(--bg)',
            color: 'var(--text)',
            outline: 'none',
          }}
        />
        {saving && (
          <span style={{
            position: 'absolute', right: '-40px', top: '50%', transform: 'translateY(-50%)',
            fontSize: '7px', color: 'var(--vp-gulf-orange)', whiteSpace: 'nowrap',
          }}>saving...</span>
        )}
      </div>
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      style={{
        cursor: 'pointer',
        borderBottom: 'none',
        transition: 'background 150ms',
        padding: '0 2px',
        ...style,
        ...(saved ? { background: 'rgba(0, 66, 37, 0.06)' } : {}),
      }}
      onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'rgba(238, 118, 35, 0.06)'; }}
      onMouseLeave={(e) => { (e.target as HTMLElement).style.background = saved ? 'rgba(0, 66, 37, 0.06)' : 'transparent'; }}
      title="Click to edit"
    >
      {value != null && value !== '' ? (type === 'number' ? (format === 'currency' ? fmt(Number(value)) : String(value)) : value) : '\u2014'}
    </span>
  );
};

// ── Status Select ──

const PART_STATUSES = [
  { value: 'installed', label: 'INSTALLED', color: 'var(--vp-brg, #004225)' },
  { value: 'received', label: 'RECEIVED', color: 'var(--text, var(--vp-ink, #1a1a1a))' },
  { value: 'ordered', label: 'ORDERED', color: 'var(--vp-gulf-orange, #EE7623)' },
  { value: 'agreed', label: 'AGREED', color: 'var(--text-secondary, var(--vp-pencil, #888))' },
  { value: 'quoted', label: 'QUOTED', color: 'var(--text-secondary, var(--vp-pencil, #888))' },
  { value: 'replaced', label: 'REPLACED', color: '#8B6914' },
  { value: 'wrong_order', label: 'WRONG ORDER', color: 'var(--vp-martini-red, #C8102E)' },
  { value: 'not_used', label: 'NOT USED', color: 'var(--text-secondary, var(--vp-pencil, #888))' },
  { value: 'returned', label: 'RETURNED', color: '#666' },
  { value: 'cancelled', label: 'CANCELLED', color: 'var(--vp-martini-red, #C8102E)' },
];

const LABOR_STATUSES = [
  { value: 'active', label: 'ACTIVE', color: 'var(--vp-brg, #004225)' },
  { value: 'complete', label: 'COMPLETE', color: 'var(--vp-brg, #004225)' },
  { value: 'in_progress', label: 'IN PROGRESS', color: 'var(--vp-gulf-orange, #EE7623)' },
  { value: 'not_needed', label: 'NOT NEEDED', color: 'var(--text-secondary, var(--vp-pencil, #888))' },
  { value: 'cancelled', label: 'CANCELLED', color: 'var(--vp-martini-red, #C8102E)' },
];

interface StatusSelectProps {
  value: string | null;
  options: { value: string; label: string; color: string }[];
  onSave: (value: string) => void;
}

const StatusSelect: React.FC<StatusSelectProps> = ({ value, options, onSave }) => {
  const current = options.find(o => o.value === value) || options[0];

  return (
    <select
      value={value || ''}
      onChange={(e) => onSave(e.target.value)}
      style={{
        appearance: 'none',
        WebkitAppearance: 'none',
        border: `1px solid ${current.color}`,
        color: current.color,
        background: 'transparent',
        padding: '1px 4px',
        fontSize: '6px',
        fontWeight: 700,
        fontFamily: 'Courier New',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        maxWidth: '80px',
        textOverflow: 'ellipsis',
      }}
    >
      {options.map(o => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
};

// ── Main Component ──

const WorkOrderStatement: React.FC = () => {
  const [searchParams] = useSearchParams();
  const query = searchParams.get('q') || searchParams.get('vehicle_id') || null;

  const {
    data, loading, error,
    updateField, addRow, deleteRow, toggleComp,
    refetch,
  } = useWorkOrderStatement(query);

  const [sending, setSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'sent' | 'error'>('idle');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showSource, setShowSource] = useState<Set<string>>(new Set());

  const toggleSource = (id: string) => {
    setShowSource(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleCollapse = (woId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(woId)) next.delete(woId); else next.add(woId);
      return next;
    });
  };

  // ── Send Invoice ──
  const handleSend = useCallback(async () => {
    if (!data?.contact?.email || !data.vehicle) return;
    setSending(true);
    setSentStatus('idle');

    try {
      const vehicleTitle = [data.vehicle.year, data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ');
      const invoiceDate = new Date().toISOString().split('T')[0];
      const invoiceNumber = `INV-${(data.vehicle.model || 'VEH').replace(/\s+/g, '').toUpperCase().slice(0, 8)}-${invoiceDate.replace(/-/g, '').slice(4)}`;

      // Upsert generated_invoices
      await supabase
        .from('generated_invoices')
        .upsert({
          work_order_id: data.workOrders[0]?.id || null,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: invoiceDate,
          subtotal: data.totals.subtotal,
          tax_amount: 0,
          tax_rate: 0,
          total_amount: data.totals.subtotal,
          amount_paid: data.totals.payments,
          amount_due: data.totals.balance,
          payment_status: data.totals.balance > 0 ? 'partial' : 'paid',
          status: 'sent',
          sent_at: new Date().toISOString(),
        }, { onConflict: 'work_order_id' });

      // Send via edge function
      const { error: sendError } = await supabase.functions.invoke('send-invoice-email', {
        body: {
          to: data.contact.email,
          subject: `Invoice: ${vehicleTitle} — ${fmt(data.totals.balance)} Balance Due`,
          customer_name: data.contact.name,
          vehicle_title: vehicleTitle,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          total: data.totals.subtotal,
          paid: data.totals.payments,
          balance: data.totals.balance,
          line_items: data.workOrders.map(wo => ({
            description: wo.title,
            amount: wo.parts_total + wo.labor_total,
          })),
        },
      });
      if (sendError) throw sendError;
      setSentStatus('sent');
    } catch (err) {
      console.error('Failed to send invoice:', err);
      setSentStatus('error');
    } finally {
      setSending(false);
    }
  }, [data]);

  // ── Render ──

  if (!query) {
    return (
      <div style={S.page}>
        <div style={S.empty}>
          <div style={S.emptyTitle}>WORK ORDER STATEMENT</div>
          <div style={S.emptyText}>
            Add <code>?q=granholm</code> or <code>?vehicle_id=UUID</code> to the URL
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={S.page}>
        <div style={{ ...S.empty, fontSize: '9px', fontFamily: 'Courier New', color: 'var(--text-secondary, var(--vp-pencil, #888))' }}>
          LOADING STATEMENT...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={S.page}>
        <div style={S.empty}>
          <div style={S.emptyTitle}>NO MATCH</div>
          <div style={S.emptyText}>{error || `No work orders found for "${query}"`}</div>
        </div>
      </div>
    );
  }

  const vehicleTitle = [data.vehicle.year, data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ');

  // Collect all comped items for goodwill section
  const compedItems: { type: string; name: string; reason: string | null; value: number }[] = [];
  for (const rows of Object.values(data.parts)) {
    for (const p of rows) {
      if (p.is_comped) {
        compedItems.push({
          type: 'Part',
          name: p.part_name,
          reason: p.comp_reason,
          value: p.comp_retail_value || p.total_price || (p.unit_price || 0) * (p.quantity || 1),
        });
      }
    }
  }
  for (const rows of Object.values(data.labor)) {
    for (const l of rows) {
      if (l.is_comped) {
        compedItems.push({
          type: 'Labor',
          name: l.task_name,
          reason: l.comp_reason,
          value: l.comp_retail_value || l.total_cost || 0,
        });
      }
    }
  }

  return (
    <div style={S.page}>
      <div style={S.container}>

        {/* ── HEADER ── */}
        <div style={S.header}>
          <div>
            <div style={S.brand}>NUKE</div>
            <div style={S.brandSub}>Vehicle Build Services</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={S.docTitle}>WORK ORDER STATEMENT</div>
            <div style={S.docDate}>{fmtDate(new Date().toISOString())}</div>
          </div>
        </div>

        {/* ── INFO BAR ── */}
        <div style={S.infoBar}>
          <div style={S.infoCol}>
            <div style={S.infoLabel}>CUSTOMER</div>
            {data.contact ? (
              <>
                <div style={{ fontWeight: 700 }}>{data.contact.name}</div>
                {data.contact.email && <div style={S.infoMono}>{data.contact.email}</div>}
                {data.contact.phone && <div style={S.infoMono}>{data.contact.phone}</div>}
              </>
            ) : (
              <div style={S.infoMuted}>No customer on file</div>
            )}
          </div>
          <div style={S.infoCol}>
            <div style={S.infoLabel}>VEHICLE</div>
            <div style={{ fontWeight: 700 }}>{vehicleTitle}</div>
            {data.vehicle.vin && <div style={S.infoMono}>VIN: {data.vehicle.vin}</div>}
          </div>
          <div style={{ ...S.infoCol, textAlign: 'right' }}>
            <div style={S.infoLabel}>BALANCE DUE</div>
            <div style={{
              fontFamily: 'Courier New',
              fontSize: '18px',
              fontWeight: 700,
              color: data.totals.balance > 0 ? 'var(--vp-martini-red, #C8102E)' : 'var(--vp-brg, #004225)',
            }}>
              {fmt(data.totals.balance)}
            </div>
          </div>
        </div>

        {/* ── WORK ORDERS ── */}
        {data.workOrders.map(wo => {
          const isCollapsed = collapsed.has(wo.id);
          const woParts = data.parts[wo.id] || [];
          const woLabor = data.labor[wo.id] || [];
          const woPayments = data.payments[wo.id] || [];

          return (
            <div key={wo.id} style={S.woSection}>
              {/* WO Header */}
              <div
                onClick={() => toggleCollapse(wo.id)}
                style={S.woHeader}
              >
                <span style={S.woToggle}>{isCollapsed ? '\u25B8' : '\u25BE'}</span>
                <span style={S.woTitle}>{wo.title}</span>
                <span style={S.woBadge(wo.status)}>{wo.status.replace(/_/g, ' ')}</span>
              </div>

              {!isCollapsed && (
                <div style={S.woBody}>

                  {/* ── Parts Table ── */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={S.sectionLabel}>PARTS</div>
                    <div style={S.partsHeader}>
                      <span>DESCRIPTION</span>
                      <span style={S.right}>SUPPLIER</span>
                      <span style={S.right}>QTY</span>
                      <span style={S.right}>TOTAL</span>
                      <span style={S.center}>COMP</span>
                      <span>STATUS</span>
                    </div>
                    {woParts.map(part => {
                      const isDead = ['cancelled', 'returned', 'wrong_order', 'not_used'].includes(part.status || '');
                      const hasSource = !!(part.notes || part.buy_url || part.ai_extracted);
                      const sourceOpen = showSource.has(part.id);
                      // Derive source tag from notes
                      const sourceTag = part.notes?.match(/Amazon order/i) ? 'AMAZON'
                        : part.notes?.match(/gmail|email/i) ? 'GMAIL'
                        : part.notes?.match(/quickbooks|qb/i) ? 'QB'
                        : part.ai_extracted ? 'AI'
                        : part.user_verified ? 'VERIFIED'
                        : part.notes ? 'NOTE'
                        : null;
                      return (
                        <React.Fragment key={part.id}>
                          <div
                            style={{
                              ...S.partsRow,
                              opacity: part.is_comped || isDead ? 0.5 : 1,
                            }}
                          >
                            <span style={S.cellName}>
                              {/* Source indicator */}
                              {sourceTag && (
                                <span
                                  onClick={() => toggleSource(part.id)}
                                  style={S.sourceTag}
                                  title="Click to view source"
                                >
                                  {sourceTag}
                                </span>
                              )}
                              {part.buy_url ? (
                                <a
                                  href={part.buy_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted var(--vp-gulf-orange)' }}
                                  title={part.buy_url}
                                >
                                  <CellEditor
                                    value={part.part_name}
                                    onSave={(v) => updateField('work_order_parts', part.id, 'part_name', v)}
                                  />
                                </a>
                              ) : (
                                <CellEditor
                                  value={part.part_name}
                                  onSave={(v) => updateField('work_order_parts', part.id, 'part_name', v)}
                                />
                              )}
                            </span>
                            <span style={{ ...S.cellMono, ...S.right }}>
                              <CellEditor
                                value={part.supplier}
                                onSave={(v) => updateField('work_order_parts', part.id, 'supplier', v)}
                                placeholder="supplier"
                              />
                            </span>
                            <span style={{ ...S.cellMono, ...S.right }}>
                              <CellEditor
                                value={part.quantity}
                                type="number"
                                format="plain"
                                onSave={(v) => updateField('work_order_parts', part.id, 'quantity', v)}
                              />
                            </span>
                            <span style={{ ...S.cellMono, ...S.right, fontWeight: 700, textDecoration: part.is_comped || isDead ? 'line-through' : 'none' }}>
                              <CellEditor
                                value={part.total_price}
                                type="number"
                                onSave={(v) => updateField('work_order_parts', part.id, 'total_price', v)}
                              />
                            </span>
                            <span style={S.center}>
                              <span
                                onClick={() => toggleComp('work_order_parts', part.id)}
                                style={S.compCheck(part.is_comped)}
                                title={part.is_comped ? 'Uncomp' : 'Mark as comped'}
                              >
                                {part.is_comped ? '\u2713' : ''}
                              </span>
                            </span>
                            <span>
                              <StatusSelect
                                value={part.status}
                                options={PART_STATUSES}
                                onSave={(v) => updateField('work_order_parts', part.id, 'status', v)}
                              />
                            </span>
                          </div>
                          {/* Provenance disclosure */}
                          {sourceOpen && (
                            <div style={S.provenanceRow}>
                              <div style={S.provenanceChain}>
                                {part.notes && <div><span style={S.provenanceKey}>SOURCE:</span> {part.notes}</div>}
                                {part.buy_url && <div><span style={S.provenanceKey}>PRODUCT:</span> <a href={part.buy_url} target="_blank" rel="noopener noreferrer" style={S.provenanceLink}>{part.buy_url}</a></div>}
                                {part.part_number && <div><span style={S.provenanceKey}>PART #:</span> {part.part_number}</div>}
                                {part.brand && <div><span style={S.provenanceKey}>BRAND:</span> {part.brand}</div>}
                                <div><span style={S.provenanceKey}>ADDED:</span> {fmtDate(part.created_at || '')}{part.ai_extracted ? ' (AI extracted)' : ''}{part.user_verified ? ' (user verified)' : ''}</div>
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {/* Comp reason inline for comped parts */}
                    {woParts.filter(p => p.is_comped && !p.comp_reason).map(part => (
                      <div key={`comp-reason-${part.id}`} style={S.compReasonRow}>
                        <span style={{ fontSize: '7px', color: 'var(--vp-gulf-orange)' }}>COMP REASON for {part.part_name}:</span>
                        <CellEditor
                          value={part.comp_reason}
                          onSave={(v) => updateField('work_order_parts', part.id, 'comp_reason', v)}
                          placeholder="reason..."
                          style={{ flex: 1 }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => addRow('work_order_parts', wo.id)}
                      style={S.addBtn}
                    >
                      + ADD PART
                    </button>
                  </div>

                  {/* ── Labor Table ── */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={S.sectionLabel}>LABOR</div>
                    <div style={S.laborHeader}>
                      <span>TASK</span>
                      <span style={S.right}>HOURS</span>
                      <span style={S.right}>RATE</span>
                      <span style={S.right}>TOTAL</span>
                      <span style={S.center}>COMP</span>
                      <span>STATUS</span>
                    </div>
                    {woLabor.map(labor => {
                      const isDead = ['cancelled', 'not_needed'].includes(labor.status || '');
                      const hasSource = !!(labor.rate_source || labor.notes);
                      const sourceOpen = showSource.has(labor.id);
                      const sourceTag = labor.rate_source?.match(/iMessage|imessage|text/i) ? 'iMSG'
                        : labor.rate_source?.match(/flat rate/i) ? 'AGREED'
                        : labor.rate_source?.match(/book/i) ? 'BOOK'
                        : labor.ai_estimated ? 'AI'
                        : labor.rate_source ? 'RATE'
                        : labor.notes ? 'NOTE'
                        : null;
                      return (
                        <React.Fragment key={labor.id}>
                          <div
                            style={{
                              ...S.laborRow,
                              opacity: labor.is_comped || isDead ? 0.5 : 1,
                            }}
                          >
                            <span style={S.cellName}>
                              {sourceTag && (
                                <span
                                  onClick={() => toggleSource(labor.id)}
                                  style={S.sourceTag}
                                  title="Click to view source"
                                >
                                  {sourceTag}
                                </span>
                              )}
                              <CellEditor
                                value={labor.task_name}
                                onSave={(v) => updateField('work_order_labor', labor.id, 'task_name', v)}
                              />
                            </span>
                            <span style={{ ...S.cellMono, ...S.right }}>
                              <CellEditor
                                value={labor.hours}
                                type="number"
                                format="plain"
                                onSave={(v) => updateField('work_order_labor', labor.id, 'hours', v)}
                              />
                            </span>
                            <span style={{ ...S.cellMono, ...S.right }}>
                              <CellEditor
                                value={labor.hourly_rate}
                                type="number"
                                onSave={(v) => updateField('work_order_labor', labor.id, 'hourly_rate', v)}
                              />
                            </span>
                            <span style={{ ...S.cellMono, ...S.right, fontWeight: 700, textDecoration: labor.is_comped || isDead ? 'line-through' : 'none' }}>
                              <CellEditor
                                value={labor.total_cost}
                                type="number"
                                onSave={(v) => updateField('work_order_labor', labor.id, 'total_cost', v)}
                              />
                            </span>
                            <span style={S.center}>
                              <span
                                onClick={() => toggleComp('work_order_labor', labor.id)}
                                style={S.compCheck(labor.is_comped)}
                                title={labor.is_comped ? 'Uncomp' : 'Mark as comped'}
                              >
                                {labor.is_comped ? '\u2713' : ''}
                              </span>
                            </span>
                            <span>
                              <StatusSelect
                                value={labor.status}
                                options={LABOR_STATUSES}
                                onSave={(v) => updateField('work_order_labor', labor.id, 'status', v)}
                              />
                            </span>
                          </div>
                          {sourceOpen && (
                            <div style={S.provenanceRow}>
                              <div style={S.provenanceChain}>
                                {labor.rate_source && <div><span style={S.provenanceKey}>RATE SOURCE:</span> {labor.rate_source}</div>}
                                {labor.notes && <div><span style={S.provenanceKey}>NOTES:</span> {labor.notes}</div>}
                                <div><span style={S.provenanceKey}>ADDED:</span> {fmtDate(labor.created_at || '')}{labor.ai_estimated ? ' (AI estimated)' : ''}</div>
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {woLabor.filter(l => l.is_comped && !l.comp_reason).map(labor => (
                      <div key={`comp-reason-${labor.id}`} style={S.compReasonRow}>
                        <span style={{ fontSize: '7px', color: 'var(--vp-gulf-orange)' }}>COMP REASON for {labor.task_name}:</span>
                        <CellEditor
                          value={labor.comp_reason}
                          onSave={(v) => updateField('work_order_labor', labor.id, 'comp_reason', v)}
                          placeholder="reason..."
                          style={{ flex: 1 }}
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => addRow('work_order_labor', wo.id)}
                      style={S.addBtn}
                    >
                      + ADD LABOR
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* ── GOODWILL SECTION ── */}
        {compedItems.length > 0 && (
          <div style={S.goodwillSection}>
            <div style={S.sectionLabel}>
              <span style={{ color: 'var(--vp-gulf-orange, #EE7623)' }}>GOODWILL</span>
            </div>
            {compedItems.map((item, i) => (
              <div key={i} style={S.goodwillRow}>
                <span style={{ fontSize: '7px', color: 'var(--vp-pencil)', textTransform: 'uppercase' }}>{item.type}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                  {item.reason && <span style={{ color: 'var(--vp-pencil)', marginLeft: '6px' }}>({item.reason})</span>}
                </span>
                <span style={{ fontFamily: 'Courier New', fontWeight: 700, color: 'var(--vp-gulf-orange)' }}>
                  {fmt(item.value)}
                </span>
              </div>
            ))}
            <div style={S.goodwillTotal}>
              <span>TOTAL GOODWILL VALUE</span>
              <span style={{ fontFamily: 'Courier New', fontWeight: 700, color: 'var(--vp-gulf-orange)' }}>
                {fmt(data.totals.goodwill)}
              </span>
            </div>
          </div>
        )}

        {/* ── PAYMENTS TABLE ── */}
        <div style={{ marginBottom: '16px' }}>
          <div style={S.sectionLabel}>PAYMENTS</div>
          <div style={S.gridHeader4pay}>
            <span>DATE</span>
            <span>METHOD</span>
            <span>MEMO</span>
            <span style={S.right}>AMOUNT</span>
          </div>
          {data.workOrders.map(wo => {
            const woPayments = data.payments[wo.id] || [];
            return woPayments.map(pm => {
              const sourceOpen = showSource.has(pm.id);
              const sourceTag = pm.source === 'gmail_afcu_deposit' ? 'GMAIL'
                : pm.source === 'imessage_sms' ? 'iMSG'
                : pm.source === 'quickbooks' ? 'QB'
                : pm.source === 'manual' ? 'MANUAL'
                : pm.source ? pm.source.toUpperCase().slice(0, 5)
                : null;
              const meta = pm.source_metadata || {};
              return (
                <React.Fragment key={pm.id}>
                  <div style={S.gridRow4pay}>
                    <span style={S.cellMono}>{pm.payment_date ? fmtDateShort(pm.payment_date) : '\u2014'}</span>
                    <span style={S.cellMono}>
                      {sourceTag && (
                        <span onClick={() => toggleSource(pm.id)} style={S.sourceTag} title="Click to view source">{sourceTag}</span>
                      )}
                      <CellEditor
                        value={pm.payment_method}
                        onSave={(v) => updateField('work_order_payments', pm.id, 'payment_method', v)}
                      />
                    </span>
                    <span>
                      <CellEditor
                        value={pm.memo}
                        onSave={(v) => updateField('work_order_payments', pm.id, 'memo', v)}
                        placeholder="memo"
                      />
                    </span>
                    <span style={{ ...S.cellMono, ...S.right, fontWeight: 700, color: 'var(--vp-brg, #004225)' }}>
                      <CellEditor
                        value={pm.amount}
                        type="number"
                        onSave={(v) => updateField('work_order_payments', pm.id, 'amount', v)}
                      />
                    </span>
                    <span
                      onClick={() => deleteRow('work_order_payments', pm.id)}
                      style={S.deleteBtn}
                      title="Delete payment"
                    >
                      \u2715
                    </span>
                  </div>
                  {sourceOpen && (
                    <div style={S.provenanceRow}>
                      <div style={S.provenanceChain}>
                        <div><span style={S.provenanceKey}>SOURCE:</span> {pm.source}</div>
                        {pm.sender_name && <div><span style={S.provenanceKey}>SENDER:</span> {pm.sender_name}</div>}
                        {pm.reference_id && <div><span style={S.provenanceKey}>REF:</span> {pm.reference_id}</div>}
                        {meta.confirmation_number && <div><span style={S.provenanceKey}>CONFIRMATION:</span> {meta.confirmation_number}</div>}
                        {meta.bank && <div><span style={S.provenanceKey}>BANK:</span> {meta.bank}</div>}
                        {meta.account_suffix && <div><span style={S.provenanceKey}>ACCOUNT:</span> ***{meta.account_suffix}</div>}
                        {meta.gmail_message_id && <div><span style={S.provenanceKey}>GMAIL MSG:</span> {meta.gmail_message_id}</div>}
                        {meta.dave_text && <div><span style={S.provenanceKey}>CUSTOMER TEXT:</span> "{meta.dave_text}"</div>}
                        {meta.raw_text && <div><span style={S.provenanceKey}>RAW:</span> <span style={{ fontSize: '6px', wordBreak: 'break-all' }}>{meta.raw_text.slice(0, 200)}{meta.raw_text.length > 200 ? '...' : ''}</span></div>}
                        {meta.deposit_date && <div><span style={S.provenanceKey}>DEPOSIT:</span> {meta.deposit_date}</div>}
                      </div>
                    </div>
                  )}
                </React.Fragment>
              );
            });
          })}
          {Object.values(data.payments).flat().length === 0 && (
            <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', padding: '4px 0' }}>No payments recorded</div>
          )}
          <button
            onClick={() => {
              const woId = data.workOrders[0]?.id;
              if (woId) addRow('work_order_payments', woId);
            }}
            style={S.addBtn}
          >
            + ADD PAYMENT
          </button>
        </div>

        {/* ── GRAND TOTALS ── */}
        <div style={S.totalsBox}>
          <div style={S.totalRow}>
            <span style={S.totalLabel}>PARTS</span>
            <span style={S.totalValue}>{fmt(data.totals.parts)}</span>
          </div>
          <div style={S.totalRow}>
            <span style={S.totalLabel}>LABOR</span>
            <span style={S.totalValue}>{fmt(data.totals.labor)}</span>
          </div>
          <div style={{ ...S.totalRow, borderTop: '1px solid var(--border, var(--vp-ghost, #ddd))', paddingTop: '4px', marginTop: '2px' }}>
            <span style={{ ...S.totalLabel, fontWeight: 700 }}>SUBTOTAL</span>
            <span style={{ ...S.totalValue, fontWeight: 700 }}>{fmt(data.totals.subtotal)}</span>
          </div>
          {data.totals.goodwill > 0 && (
            <div style={S.totalRow}>
              <span style={{ ...S.totalLabel, color: 'var(--vp-gulf-orange)' }}>GOODWILL</span>
              <span style={{ ...S.totalValue, color: 'var(--vp-gulf-orange)' }}>({fmt(data.totals.goodwill)})</span>
            </div>
          )}
          {data.totals.payments > 0 && (
            <div style={S.totalRow}>
              <span style={{ ...S.totalLabel, color: 'var(--vp-brg, #004225)' }}>PAYMENTS</span>
              <span style={{ ...S.totalValue, color: 'var(--vp-brg, #004225)' }}>({fmt(data.totals.payments)})</span>
            </div>
          )}
          <div style={{
            ...S.totalRow,
            borderTop: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
            paddingTop: '8px',
            marginTop: '4px',
          }}>
            <span style={{ ...S.totalLabel, fontSize: '10px', fontWeight: 700 }}>BALANCE DUE</span>
            <span style={{
              fontFamily: 'Courier New',
              fontSize: '16px',
              fontWeight: 700,
              color: data.totals.balance > 0 ? 'var(--vp-martini-red, #C8102E)' : 'var(--vp-brg, #004225)',
            }}>
              {fmt(data.totals.balance)}
            </span>
          </div>
        </div>

        {/* ── ACTIONS ── */}
        <div style={S.actions}>
          <button
            onClick={() => window.print()}
            style={S.actionBtn}
          >
            PRINT
          </button>
          {data.contact?.email && (
            <button
              onClick={handleSend}
              disabled={sending || sentStatus === 'sent'}
              style={{
                ...S.actionBtnPrimary,
                opacity: sending ? 0.6 : 1,
                cursor: sending ? 'wait' : sentStatus === 'sent' ? 'default' : 'pointer',
                background: sentStatus === 'sent' ? 'var(--vp-brg, #004225)' : 'var(--text, var(--vp-ink, #1a1a1a))',
              }}
            >
              {sending ? 'SENDING...' : sentStatus === 'sent' ? 'SENT' : sentStatus === 'error' ? 'RETRY SEND' : 'GENERATE & SEND'}
            </button>
          )}
        </div>
        {sentStatus === 'sent' && (
          <div style={S.sentMsg}>Invoice sent to {data.contact?.email}</div>
        )}
        {sentStatus === 'error' && (
          <div style={{ ...S.sentMsg, color: 'var(--vp-martini-red)' }}>Failed to send — check edge function logs</div>
        )}
      </div>
    </div>
  );
};

export default WorkOrderStatement;

// ── Styles ──

const S = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: 'Arial, sans-serif',
    fontSize: '9px',
    lineHeight: 1.6,
    padding: '20px',
  } as React.CSSProperties,

  container: {
    maxWidth: '900px',
    margin: '0 auto',
  } as React.CSSProperties,

  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '40vh',
    gap: '8px',
  } as React.CSSProperties,

  emptyTitle: {
    fontSize: '11px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  } as React.CSSProperties,

  emptyText: {
    fontSize: '9px',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
  } as React.CSSProperties,

  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingBottom: '12px',
    borderBottom: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    marginBottom: '12px',
  } as React.CSSProperties,

  brand: {
    fontSize: '14px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
  } as React.CSSProperties,

  brandSub: {
    fontSize: '7px',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    fontFamily: 'Courier New',
  } as React.CSSProperties,

  docTitle: {
    fontSize: '10px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
  } as React.CSSProperties,

  docDate: {
    fontSize: '7px',
    fontFamily: 'Courier New',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    marginTop: '2px',
  } as React.CSSProperties,

  // Info bar
  infoBar: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '12px',
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    fontSize: '8px',
  } as React.CSSProperties,

  infoCol: {} as React.CSSProperties,

  infoLabel: {
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    marginBottom: '2px',
  } as React.CSSProperties,

  infoMono: {
    fontFamily: 'Courier New',
    fontSize: '7px',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
  } as React.CSSProperties,

  infoMuted: {
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
  } as React.CSSProperties,

  // Work order sections
  woSection: {
    marginBottom: '16px',
  } as React.CSSProperties,

  woHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 8px',
    border: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    cursor: 'pointer',
    userSelect: 'none' as const,
    background: 'var(--bg-secondary, var(--vp-bg-alt, #fafafa))',
  } as React.CSSProperties,

  woToggle: {
    fontSize: '10px',
    fontWeight: 700,
    width: '12px',
    flexShrink: 0,
  } as React.CSSProperties,

  woTitle: {
    flex: 1,
    fontSize: '9px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  woBadge: (status: string): React.CSSProperties => {
    const color = status === 'completed' ? 'var(--vp-brg, #004225)' :
      status === 'in_progress' ? 'var(--vp-gulf-orange, #EE7623)' :
      'var(--text-secondary, var(--vp-pencil, #888))';
    return {
      padding: '1px 4px',
      fontSize: '7px',
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      border: `1px solid ${color}`,
      color,
      fontFamily: 'Courier New',
    };
  },

  woBody: {
    borderLeft: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    borderRight: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    borderBottom: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    padding: '10px 12px',
  } as React.CSSProperties,

  // Section label
  sectionLabel: {
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    marginBottom: '4px',
  } as React.CSSProperties,

  // Grid headers — parts (desc, supplier, qty, total, comp, status)
  partsHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 90px 36px 70px 30px 80px',
    gap: '2px 6px',
    padding: '3px 0',
    borderBottom: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
  } as React.CSSProperties,

  partsRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 90px 36px 70px 30px 80px',
    gap: '2px 6px',
    padding: '3px 0',
    borderBottom: '1px solid var(--border, var(--vp-ghost, #ddd))',
    fontSize: '8px',
    alignItems: 'center',
  } as React.CSSProperties,

  // Grid headers — labor (task, hours, rate, total, comp, status)
  laborHeader: {
    display: 'grid',
    gridTemplateColumns: '1fr 50px 60px 70px 30px 80px',
    gap: '2px 6px',
    padding: '3px 0',
    borderBottom: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
  } as React.CSSProperties,

  laborRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 50px 60px 70px 30px 80px',
    gap: '2px 6px',
    padding: '3px 0',
    borderBottom: '1px solid var(--border, var(--vp-ghost, #ddd))',
    fontSize: '8px',
    alignItems: 'center',
  } as React.CSSProperties,

  gridHeader4pay: {
    display: 'grid',
    gridTemplateColumns: '80px 80px 1fr 80px 20px',
    gap: '2px 6px',
    padding: '3px 0',
    borderBottom: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
  } as React.CSSProperties,

  gridRow4pay: {
    display: 'grid',
    gridTemplateColumns: '80px 80px 1fr 80px 20px',
    gap: '2px 6px',
    padding: '3px 0',
    borderBottom: '1px solid var(--border, var(--vp-ghost, #ddd))',
    fontSize: '8px',
    alignItems: 'center',
  } as React.CSSProperties,

  // Cell styles
  cellName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  cellMono: {
    fontFamily: 'Courier New',
    fontSize: '8px',
  } as React.CSSProperties,

  right: {
    textAlign: 'right' as const,
  } as React.CSSProperties,

  center: {
    textAlign: 'center' as const,
  } as React.CSSProperties,

  // Comp checkbox
  compCheck: (checked: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    border: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    cursor: 'pointer',
    fontSize: '9px',
    fontWeight: 700,
    background: checked ? 'var(--vp-gulf-orange, #EE7623)' : 'transparent',
    color: checked ? '#fff' : 'transparent',
    lineHeight: 1,
  }),

  compReasonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 0 2px 8px',
    fontSize: '8px',
  } as React.CSSProperties,

  // Source tag (inline provenance badge)
  sourceTag: {
    display: 'inline-block',
    padding: '0 3px',
    marginRight: '4px',
    fontSize: '5px',
    fontWeight: 700,
    fontFamily: 'Courier New',
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    border: '1px solid var(--text-secondary, var(--vp-pencil, #888))',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    cursor: 'pointer',
    verticalAlign: 'middle',
    lineHeight: '10px',
  } as React.CSSProperties,

  // Provenance disclosure row
  provenanceRow: {
    gridColumn: '1 / -1',
    padding: '4px 8px 6px 20px',
    background: 'var(--bg-secondary, var(--vp-bg-alt, #fafafa))',
    borderBottom: '1px solid var(--border, var(--vp-ghost, #ddd))',
    fontSize: '7px',
    fontFamily: 'Courier New',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    lineHeight: 1.8,
  } as React.CSSProperties,

  provenanceChain: {} as React.CSSProperties,

  provenanceKey: {
    fontWeight: 700,
    color: 'var(--text, var(--vp-ink, #1a1a1a))',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    marginRight: '4px',
    fontSize: '6px',
  } as React.CSSProperties,

  provenanceLink: {
    color: 'var(--vp-gulf-orange, #EE7623)',
    fontSize: '6px',
    wordBreak: 'break-all' as const,
  } as React.CSSProperties,

  // Delete button
  deleteBtn: {
    cursor: 'pointer',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    fontSize: '9px',
    textAlign: 'center' as const,
    opacity: 0.4,
    transition: 'opacity 150ms',
  } as React.CSSProperties,

  // Add button
  addBtn: {
    display: 'inline-block',
    padding: '4px 10px',
    marginTop: '4px',
    fontSize: '7px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    border: '1px dashed var(--border, var(--vp-ghost, #ddd))',
    background: 'transparent',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  } as React.CSSProperties,

  // Goodwill
  goodwillSection: {
    marginBottom: '16px',
    padding: '10px 12px',
    border: '2px solid var(--vp-gulf-orange, #EE7623)',
    background: 'rgba(238, 118, 35, 0.03)',
  } as React.CSSProperties,

  goodwillRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '2px 0',
    borderBottom: '1px solid rgba(238, 118, 35, 0.15)',
    fontSize: '8px',
  } as React.CSSProperties,

  goodwillTotal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '6px',
    marginTop: '4px',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--vp-gulf-orange, #EE7623)',
  } as React.CSSProperties,

  // Totals box
  totalsBox: {
    border: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    padding: '12px 16px',
    marginBottom: '12px',
  } as React.CSSProperties,

  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '2px 0',
  } as React.CSSProperties,

  totalLabel: {
    fontSize: '8px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
  } as React.CSSProperties,

  totalValue: {
    fontFamily: 'Courier New',
    fontSize: '9px',
    textAlign: 'right' as const,
  } as React.CSSProperties,

  // Actions
  actions: {
    display: 'flex',
    gap: '6px',
    marginBottom: '8px',
  } as React.CSSProperties,

  actionBtn: {
    flex: 1,
    padding: '8px 12px',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    border: '2px solid var(--border, var(--vp-ghost, #ddd))',
    background: 'transparent',
    color: 'var(--text-secondary, var(--vp-pencil, #888))',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  } as React.CSSProperties,

  actionBtnPrimary: {
    flex: 2,
    padding: '8px 12px',
    fontSize: '8px',
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    border: '2px solid var(--text, var(--vp-ink, #1a1a1a))',
    background: 'var(--text, var(--vp-ink, #1a1a1a))',
    color: 'var(--bg, #fff)',
    cursor: 'pointer',
    fontFamily: 'Arial, sans-serif',
  } as React.CSSProperties,

  sentMsg: {
    fontSize: '7px',
    fontFamily: 'Courier New',
    color: 'var(--vp-brg, #004225)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  } as React.CSSProperties,
};
