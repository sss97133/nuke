/**
 * Operator Transfer Dashboard
 * /admin/transfers
 *
 * Lists all in_progress transfers sorted by overdue milestone count.
 * Operators can advance milestones manually or see buyer/seller pages.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const SERVICE_ROLE_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

const MILESTONE_LABELS: Record<string, string> = {
  agreement_reached: 'Deal agreed',
  contact_exchanged: 'Contact exchanged',
  discussion_complete: 'Discussion complete',
  contract_drafted: 'Contract drafted',
  contract_signed_seller: 'Seller signed',
  contract_signed_buyer: 'Buyer signed',
  deposit_triggered: 'Deposit requested',
  deposit_sent: 'Deposit sent',
  deposit_received: 'Deposit received',
  deposit_confirmed: 'Deposit confirmed',
  full_payment_triggered: 'Payment requested',
  full_payment_sent: 'Payment sent',
  full_payment_received: 'Payment received',
  payment_confirmed: 'Payment confirmed',
  inspection_scheduled: 'Inspection scheduled',
  inspection_live: 'Inspection in progress',
  inspection_completed: 'Inspection done',
  insurance_triggered: 'Insurance requested',
  insurance_confirmed: 'Insurance confirmed',
  title_sent: 'Title mailed',
  title_in_transit: 'Title in transit',
  title_received: 'Title received',
  shipping_requested: 'Shipping requested',
  shipping_initiated: 'Vehicle picked up',
  vehicle_arrived: 'Vehicle delivered',
  transfer_complete: 'Transfer complete',
  obligations_defined: 'Obligations set',
  obligation_met: 'Obligation fulfilled',
};

interface TransferRow {
  id: string;
  vehicle_id: string;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  agreed_price: number | null;
  currency: string;
  status: string;
  inbox_email: string | null;
  created_at: string;
  last_milestone_at: string | null;
  seller_handle: string | null;
  seller_platform: string | null;
  buyer_handle: string | null;
  buyer_platform: string | null;
  overdue_count: number;
  completed_count: number;
  total_milestones: number;
  current_milestone_type: string | null;
  buyer_access_token: string;
  seller_access_token: string;
}

interface MilestoneRow {
  id: string;
  sequence: number;
  milestone_type: string;
  status: string;
  required: boolean;
  deadline_at: string | null;
  completed_at: string | null;
}

type SortKey = 'overdue' | 'created' | 'price' | 'last_activity';

const PAGE_SIZE = 50;

export default function TransfersDashboard() {
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>('overdue');
  const [statusFilter, setStatusFilter] = useState<string>('in_progress');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  // Expanded transfer state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [milestonesLoading, setMilestonesLoading] = useState(false);

  // Advance state
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  // Log a Deal modal
  const [showLogDeal, setShowLogDeal] = useState(false);
  const [dealForm, setDealForm] = useState({ vehicle_id: '', agreed_price: '', buyer_handle: '', seller_handle: '', sale_date: '' });
  const [dealSubmitting, setDealSubmitting] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);
  const [dealSuccess, setDealSuccess] = useState(false);

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Build query with Supabase client
      let q = supabase
        .from('ownership_transfers')
        .select(`
          id, vehicle_id, agreed_price, currency, status, inbox_email,
          created_at, last_milestone_at,
          buyer_access_token, seller_access_token,
          seller:external_identities!from_identity_id(platform, handle),
          buyer:external_identities!to_identity_id(platform, handle),
          vehicles!inner(year, make, model),
          milestones:transfer_milestones(sequence, milestone_type, status, required, deadline_at, completed_at)
        `, { count: 'exact' })
        .eq('status', statusFilter)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (search.trim()) {
        // Search by vehicle make/model - can't do join filter easily, so we do post-filter
      }

      const { data, error: qErr, count } = await q;
      if (qErr) throw qErr;

      setTotal(count ?? 0);

      // Shape the data
      const rows: TransferRow[] = (data ?? []).map((t: any) => {
        const ms: any[] = t.milestones ?? [];
        const overdueMs = ms.filter((m: any) => m.status === 'overdue');
        const completedMs = ms.filter((m: any) => m.status === 'completed');
        const currentMs = ms
          .filter((m: any) => m.status !== 'completed' && m.status !== 'skipped')
          .sort((a: any, b: any) => a.sequence - b.sequence)[0] ?? null;

        return {
          id: t.id,
          vehicle_id: t.vehicle_id,
          vehicle_year: t.vehicles?.year ?? null,
          vehicle_make: t.vehicles?.make ?? null,
          vehicle_model: t.vehicles?.model ?? null,
          agreed_price: t.agreed_price ? parseFloat(t.agreed_price) : null,
          currency: t.currency ?? 'USD',
          status: t.status,
          inbox_email: t.inbox_email,
          created_at: t.created_at,
          last_milestone_at: t.last_milestone_at,
          seller_handle: t.seller?.handle ?? null,
          seller_platform: t.seller?.platform ?? null,
          buyer_handle: t.buyer?.handle ?? null,
          buyer_platform: t.buyer?.platform ?? null,
          overdue_count: overdueMs.length,
          completed_count: completedMs.length,
          total_milestones: ms.length,
          current_milestone_type: currentMs?.milestone_type ?? null,
          buyer_access_token: t.buyer_access_token,
          seller_access_token: t.seller_access_token,
        };
      });

      // Client-side sort
      const sorted = [...rows].sort((a, b) => {
        if (sortBy === 'overdue') return b.overdue_count - a.overdue_count;
        if (sortBy === 'created') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        if (sortBy === 'price') return (b.agreed_price ?? 0) - (a.agreed_price ?? 0);
        if (sortBy === 'last_activity') {
          const aT = a.last_milestone_at ?? a.created_at;
          const bT = b.last_milestone_at ?? b.created_at;
          return new Date(aT).getTime() - new Date(bT).getTime(); // oldest first
        }
        return 0;
      });

      // Apply search filter client-side
      const filtered = search.trim()
        ? sorted.filter(r =>
            [r.vehicle_year?.toString(), r.vehicle_make, r.vehicle_model, r.seller_handle, r.buyer_handle, r.inbox_email]
              .some(v => v?.toLowerCase().includes(search.toLowerCase()))
          )
        : sorted;

      setTransfers(filtered);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, sortBy, page, search]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const loadMilestones = async (transferId: string) => {
    if (expandedId === transferId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(transferId);
    setMilestonesLoading(true);
    const { data } = await supabase
      .from('transfer_milestones')
      .select('id, sequence, milestone_type, status, required, deadline_at, completed_at')
      .eq('transfer_id', transferId)
      .order('sequence', { ascending: true });
    setMilestones(data ?? []);
    setMilestonesLoading(false);
  };

  const advanceMilestone = async (transferId: string, milestoneType: string) => {
    const key = `${transferId}:${milestoneType}`;
    setAdvancing(key);
    setAdvanceError(null);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/transfer-advance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'advance_manual',
          transfer_id: transferId,
          milestone_type: milestoneType,
          notes: 'Manually advanced by operator',
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) throw new Error(json.error ?? 'Failed');
      // Refresh milestones
      const { data } = await supabase
        .from('transfer_milestones')
        .select('id, sequence, milestone_type, status, required, deadline_at, completed_at')
        .eq('transfer_id', transferId)
        .order('sequence', { ascending: true });
      setMilestones(data ?? []);
      // Refresh row count
      fetchTransfers();
    } catch (e: any) {
      setAdvanceError(e.message ?? String(e));
    } finally {
      setAdvancing(null);
    }
  };

  const submitLogDeal = async () => {
    setDealSubmitting(true);
    setDealError(null);
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/transfer-automator`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          action: 'seed_from_listing',
          vehicle_id: dealForm.vehicle_id.trim(),
          agreed_price: dealForm.agreed_price ? parseFloat(dealForm.agreed_price) : undefined,
          buyer_handle: dealForm.buyer_handle.trim() || undefined,
          seller_handle: dealForm.seller_handle.trim() || undefined,
          sale_date: dealForm.sale_date || undefined,
          suppress_notifications: false,
        }),
      });
      const json = await resp.json();
      if (!resp.ok || json.error) throw new Error(json.error ?? 'Failed to seed transfer');
      setDealSuccess(true);
      setTimeout(() => {
        setShowLogDeal(false);
        setDealSuccess(false);
        setDealForm({ vehicle_id: '', agreed_price: '', buyer_handle: '', seller_handle: '', sale_date: '' });
        fetchTransfers();
      }, 2000);
    } catch (e: any) {
      setDealError(e.message ?? String(e));
    } finally {
      setDealSubmitting(false);
    }
  };

  const fmtPrice = (price: number | null, currency: string) => {
    if (!price) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(price);
  };

  const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const days = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return 'Today';
    if (days === 1) return '1d ago';
    if (days < 30) return `${days}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const milestoneStatusColor = (status: string) => {
    if (status === 'completed') return '#22c55e';
    if (status === 'overdue') return '#ef4444';
    if (status === 'skipped') return '#6b7280';
    return '#94a3b8';
  };

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#e2e8f0', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#f8fafc' }}>Transfer Dashboard</h1>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>
            {total.toLocaleString()} transfers · operator view
          </p>
        </div>
        <button
          onClick={() => setShowLogDeal(true)}
          style={{
            background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px',
            padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
          }}
        >
          + Log a Deal
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search make, model, handle..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
            color: '#e2e8f0', padding: '7px 12px', fontSize: '13px', width: '220px',
          }}
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
          style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
            color: '#e2e8f0', padding: '7px 12px', fontSize: '13px',
          }}
        >
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="stalled">Stalled</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortKey)}
          style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
            color: '#e2e8f0', padding: '7px 12px', fontSize: '13px',
          }}
        >
          <option value="overdue">Sort: Most Overdue</option>
          <option value="last_activity">Sort: Least Active</option>
          <option value="price">Sort: Highest Price</option>
          <option value="created">Sort: Newest</option>
        </select>
        <button
          onClick={fetchTransfers}
          style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: '6px',
            color: '#94a3b8', padding: '7px 12px', fontSize: '13px', cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {error && (
        <div style={{ background: '#450a0a', border: '1px solid #7f1d1d', borderRadius: '6px', padding: '12px', marginBottom: '16px', color: '#fca5a5', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: '#475569', fontSize: '13px', padding: '40px', textAlign: 'center' }}>Loading transfers...</div>
      ) : transfers.length === 0 ? (
        <div style={{ color: '#475569', fontSize: '13px', padding: '40px', textAlign: 'center' }}>No transfers found.</div>
      ) : (
        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: '8px', overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1fr 1fr 80px 100px 120px',
            padding: '10px 16px',
            background: '#1e293b',
            fontSize: '11px',
            color: '#64748b',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            gap: '8px',
          }}>
            <div>Vehicle / Parties</div>
            <div>Price</div>
            <div>Progress</div>
            <div>Current Step</div>
            <div>Overdue</div>
            <div>Last Activity</div>
            <div>Actions</div>
          </div>

          {transfers.map((t, idx) => {
            const isExpanded = expandedId === t.id;
            const vehicleName = [t.vehicle_year, t.vehicle_make, t.vehicle_model].filter(Boolean).join(' ') || 'Unknown Vehicle';
            const daysSince = t.last_milestone_at
              ? Math.floor((Date.now() - new Date(t.last_milestone_at).getTime()) / (1000 * 60 * 60 * 24))
              : null;

            return (
              <div key={t.id} style={{ borderTop: idx > 0 ? '1px solid #1e293b' : 'none' }}>
                {/* Main row */}
                <div
                  onClick={() => loadMilestones(t.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 80px 100px 120px',
                    padding: '12px 16px',
                    gap: '8px',
                    alignItems: 'center',
                    cursor: 'pointer',
                    background: isExpanded ? '#1e293b' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = '#0f1929'; }}
                  onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {/* Vehicle + Parties */}
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#f1f5f9', marginBottom: '2px' }}>
                      <Link
                        to={`/vehicle/${t.vehicle_id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ color: '#93c5fd', textDecoration: 'none' }}
                      >
                        {vehicleName}
                      </Link>
                    </div>
                    <div style={{ fontSize: '11px', color: '#475569' }}>
                      {t.seller_handle && <span style={{ marginRight: '8px' }}>Seller: <span style={{ color: '#94a3b8' }}>{t.seller_handle}</span></span>}
                      {t.buyer_handle && <span>Buyer: <span style={{ color: '#94a3b8' }}>{t.buyer_handle}</span></span>}
                      {!t.seller_handle && !t.buyer_handle && <span style={{ color: '#334155' }}>No party info</span>}
                    </div>
                    {t.inbox_email && (
                      <div style={{ fontSize: '10px', color: '#334155', marginTop: '2px', fontFamily: 'monospace' }}>{t.inbox_email}</div>
                    )}
                  </div>

                  {/* Price */}
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#34d399' }}>
                    {fmtPrice(t.agreed_price, t.currency)}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>
                      {t.completed_count}/{t.total_milestones}
                    </div>
                    <div style={{ background: '#1e293b', borderRadius: '4px', height: '6px', width: '100%', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${t.total_milestones > 0 ? (t.completed_count / t.total_milestones) * 100 : 0}%`,
                          background: t.overdue_count > 0 ? '#f59e0b' : '#22c55e',
                          borderRadius: '4px',
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                  </div>

                  {/* Current step */}
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                    {t.current_milestone_type ? MILESTONE_LABELS[t.current_milestone_type] ?? t.current_milestone_type : <span style={{ color: '#334155' }}>—</span>}
                  </div>

                  {/* Overdue count */}
                  <div>
                    {t.overdue_count > 0 ? (
                      <span style={{
                        background: '#450a0a', color: '#f87171', borderRadius: '12px',
                        padding: '2px 8px', fontSize: '12px', fontWeight: 700,
                      }}>
                        {t.overdue_count}
                      </span>
                    ) : (
                      <span style={{ color: '#334155', fontSize: '12px' }}>—</span>
                    )}
                  </div>

                  {/* Last activity */}
                  <div style={{ fontSize: '12px', color: daysSince !== null && daysSince > 7 ? '#f87171' : '#64748b' }}>
                    {fmtDate(t.last_milestone_at)}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                    <Link
                      to={`/t/${t.id}?token=${t.buyer_access_token}`}
                      target="_blank"
                      style={{
                        background: '#1e3a5f', color: '#93c5fd', borderRadius: '4px',
                        padding: '4px 8px', fontSize: '11px', fontWeight: 600, textDecoration: 'none',
                      }}
                      title="Open buyer view"
                    >
                      Buyer
                    </Link>
                    <Link
                      to={`/t/${t.id}?token=${t.seller_access_token}`}
                      target="_blank"
                      style={{
                        background: '#1e3a5f', color: '#93c5fd', borderRadius: '4px',
                        padding: '4px 8px', fontSize: '11px', fontWeight: 600, textDecoration: 'none',
                      }}
                      title="Open seller view"
                    >
                      Seller
                    </Link>
                  </div>
                </div>

                {/* Expanded milestones */}
                {isExpanded && (
                  <div style={{ padding: '0 16px 16px', background: '#0d1a2e' }}>
                    {advanceError && (
                      <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '8px' }}>{advanceError}</div>
                    )}
                    {milestonesLoading ? (
                      <div style={{ color: '#475569', fontSize: '12px', padding: '12px 0' }}>Loading milestones...</div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '8px' }}>
                        {milestones.map(m => {
                          const label = MILESTONE_LABELS[m.milestone_type] ?? m.milestone_type;
                          const isAdvanceable = m.status === 'pending' || m.status === 'overdue';
                          const advKey = `${t.id}:${m.milestone_type}`;
                          const isAdvancing = advancing === advKey;

                          return (
                            <div
                              key={m.id}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '6px',
                                background: '#1e293b', borderRadius: '6px', padding: '6px 10px',
                                border: `1px solid ${m.status === 'overdue' ? '#7f1d1d' : '#334155'}`,
                                fontSize: '12px',
                              }}
                            >
                              {/* Status dot */}
                              <span style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: milestoneStatusColor(m.status),
                                flexShrink: 0,
                              }} />
                              <span style={{ color: '#cbd5e1' }}>{label}</span>
                              {m.status === 'overdue' && m.deadline_at && (
                                <span style={{ color: '#f87171', fontSize: '10px' }}>
                                  due {new Date(m.deadline_at).toLocaleDateString()}
                                </span>
                              )}
                              {m.status === 'completed' && m.completed_at && (
                                <span style={{ color: '#64748b', fontSize: '10px' }}>
                                  {new Date(m.completed_at).toLocaleDateString()}
                                </span>
                              )}
                              {isAdvanceable && (
                                <button
                                  onClick={() => advanceMilestone(t.id, m.milestone_type)}
                                  disabled={isAdvancing || !!advancing}
                                  style={{
                                    background: '#166534', color: '#86efac', border: 'none',
                                    borderRadius: '4px', padding: '2px 8px', fontSize: '11px',
                                    fontWeight: 600, cursor: isAdvancing ? 'wait' : 'pointer',
                                    marginLeft: '4px', opacity: advancing && !isAdvancing ? 0.5 : 1,
                                  }}
                                >
                                  {isAdvancing ? '...' : '✓ Done'}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', alignItems: 'center', justifyContent: 'center' }}>
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
              borderRadius: '6px', padding: '6px 14px', fontSize: '13px', cursor: page === 0 ? 'not-allowed' : 'pointer',
              opacity: page === 0 ? 0.4 : 1,
            }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: '12px', color: '#64748b' }}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <button
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage(p => p + 1)}
            style={{
              background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
              borderRadius: '6px', padding: '6px 14px', fontSize: '13px',
              cursor: (page + 1) * PAGE_SIZE >= total ? 'not-allowed' : 'pointer',
              opacity: (page + 1) * PAGE_SIZE >= total ? 0.4 : 1,
            }}
          >
            Next →
          </button>
        </div>
      )}

      {/* Log a Deal Modal */}
      {showLogDeal && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 50,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) setShowLogDeal(false); }}
        >
          <div style={{
            background: '#1e293b', border: '1px solid #334155', borderRadius: '12px',
            padding: '28px', width: '420px', maxWidth: '95vw',
          }}>
            <h2 style={{ margin: '0 0 20px', fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>Log a Deal</h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b' }}>
              Record a private sale that didn't go through an auction.
            </p>

            {dealSuccess ? (
              <div style={{ color: '#86efac', fontSize: '14px', textAlign: 'center', padding: '20px 0' }}>
                ✓ Transfer created successfully!
              </div>
            ) : (
              <>
                {dealError && (
                  <div style={{ background: '#450a0a', color: '#fca5a5', borderRadius: '6px', padding: '10px', marginBottom: '16px', fontSize: '13px' }}>
                    {dealError}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Vehicle ID *</div>
                    <input
                      type="text"
                      placeholder="UUID from vehicles table"
                      value={dealForm.vehicle_id}
                      onChange={e => setDealForm(f => ({ ...f, vehicle_id: e.target.value }))}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </label>
                  <label>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Agreed Price</div>
                    <input
                      type="number"
                      placeholder="e.g. 45000"
                      value={dealForm.agreed_price}
                      onChange={e => setDealForm(f => ({ ...f, agreed_price: e.target.value }))}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </label>
                  <label>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Seller Handle</div>
                    <input
                      type="text"
                      placeholder="e.g. BaT username"
                      value={dealForm.seller_handle}
                      onChange={e => setDealForm(f => ({ ...f, seller_handle: e.target.value }))}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </label>
                  <label>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Buyer Handle</div>
                    <input
                      type="text"
                      placeholder="e.g. BaT username"
                      value={dealForm.buyer_handle}
                      onChange={e => setDealForm(f => ({ ...f, buyer_handle: e.target.value }))}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', boxSizing: 'border-box' }}
                    />
                  </label>
                  <label>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>Sale Date</div>
                    <input
                      type="date"
                      value={dealForm.sale_date}
                      onChange={e => setDealForm(f => ({ ...f, sale_date: e.target.value }))}
                      style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: '6px', color: '#e2e8f0', padding: '8px 12px', fontSize: '13px', boxSizing: 'border-box', colorScheme: 'dark' }}
                    />
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '10px', marginTop: '20px', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => setShowLogDeal(false)}
                    style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={submitLogDeal}
                    disabled={dealSubmitting || !dealForm.vehicle_id.trim()}
                    style={{
                      background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px',
                      padding: '8px 20px', fontSize: '13px', fontWeight: 600, cursor: dealSubmitting ? 'wait' : 'pointer',
                      opacity: !dealForm.vehicle_id.trim() ? 0.5 : 1,
                    }}
                  >
                    {dealSubmitting ? 'Creating...' : 'Create Transfer'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
