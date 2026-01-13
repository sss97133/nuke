import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  client_name: string | null;
  event_title: string;
  event_type: string | null;
  mileage: number | null;
  vehicle_name: string | null;
  vehicle_vin: string | null;
  vehicle_license_plate: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  amount_due: number;
  payment_status: string;
  status: string;
  html_content: string | null;
  cashflow?: {
    status: 'ok' | 'missing' | 'pending' | 'error' | 'unknown';
    event_count: number;
    total_cents: number;
    last_occurred_at: string | null;
    unprocessed_count: number;
    error_count: number;
    payout_count: number;
    payout_pending_count: number;
    payout_paid_count: number;
  };
}

const InvoiceManager: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'sent' | 'unpaid' | 'paid'>('all');
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const [myVehicles, setMyVehicles] = useState<Array<{ id: string; year: number | null; make: string | null; model: string | null; trim: string | null }>>([]);
  const [draftVehicleId, setDraftVehicleId] = useState<string>('');
  const [draftLimit, setDraftLimit] = useState<number>(5);
  const [draftBusy, setDraftBusy] = useState<boolean>(false);
  const [draftMessage, setDraftMessage] = useState<string>('');
  const navigate = useNavigate();

  useEffect(() => {
    loadInvoices();
  }, [filter]);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data, error } = await supabase
          .from('vehicles')
          .select('id, year, make, model, trim, created_at')
          .or(`owner_id.eq.${user.id},user_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
          .limit(50);
        if (error) return;
        const rows = (data || []).map((v: any) => ({
          id: String(v.id),
          year: typeof v.year === 'number' ? v.year : null,
          make: v.make ?? null,
          model: v.model ?? null,
          trim: v.trim ?? null,
        }));
        setMyVehicles(rows);
        if (!draftVehicleId && rows.length > 0) setDraftVehicleId(rows[0].id);
      } catch {
        // ignore
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('generated_invoices')
        .select(`
          id,
          invoice_number,
          invoice_date,
          due_date,
          subtotal,
          tax_amount,
          total_amount,
          amount_paid,
          amount_due,
          payment_status,
          status,
          html_content,
          client:clients(client_name),
          event:timeline_events(
            title, 
            event_type,
            mileage_at_event,
            vehicle:vehicles(make, model, year, series, vin, license_plate)
          )
        `)
        .order('invoice_date', { ascending: false });

      if (filter !== 'all') {
        if (filter === 'unpaid') {
          query = query.eq('payment_status', 'unpaid');
        } else if (filter === 'paid') {
          query = query.eq('payment_status', 'paid');
        } else {
          query = query.eq('status', filter);
        }
      }

      const { data, error } = await query;

      if (error) throw error;

      const formatted: Invoice[] = (data || []).map((inv: any) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        due_date: inv.due_date,
        client_name: inv.client?.client_name || null,
        event_title: inv.event?.title || 'Unknown',
        event_type: inv.event?.event_type || null,
        mileage: inv.event?.mileage_at_event || null,
        vehicle_name: inv.event?.vehicle 
          ? `${inv.event.vehicle.year} ${inv.event.vehicle.make} ${inv.event.vehicle.model}${inv.event.vehicle.series ? ' ' + inv.event.vehicle.series : ''}`
          : null,
        vehicle_vin: inv.event?.vehicle?.vin || null,
        vehicle_license_plate: inv.event?.vehicle?.license_plate || null,
        subtotal: parseFloat(inv.subtotal || 0),
        tax_amount: parseFloat(inv.tax_amount || 0),
        total_amount: parseFloat(inv.total_amount || 0),
        amount_paid: parseFloat(inv.amount_paid || 0),
        amount_due: parseFloat(inv.amount_due || 0),
        payment_status: inv.payment_status,
        status: inv.status,
        html_content: inv.html_content,
        cashflow: undefined
      }));

      // Best-effort: attach cashflow health to each invoice (invoice_payment events + payouts)
      try {
        const invoiceIds = formatted.map((i) => i.id).filter(Boolean);
        if (invoiceIds.length > 0) {
          const { data: events, error: evErr } = await supabase
            .from('cashflow_events')
            .select('id, source_ref, amount_cents, occurred_at, processed_at, processing_error')
            .eq('source_type', 'invoice_payment')
            .in('source_ref', invoiceIds)
            .order('occurred_at', { ascending: false });

          if (!evErr && Array.isArray(events) && events.length > 0) {
            const eventIds = events.map((e: any) => e.id).filter(Boolean);
            let payouts: any[] = [];
            if (eventIds.length > 0) {
              const { data: p, error: pErr } = await supabase
                .from('cashflow_payouts')
                .select('id, event_id, status')
                .in('event_id', eventIds);
              if (!pErr && Array.isArray(p)) payouts = p;
            }

            const byInvoice: Record<string, Invoice['cashflow']> = {};
            for (const inv of formatted) {
              byInvoice[inv.id] = {
                status: 'unknown',
                event_count: 0,
                total_cents: 0,
                last_occurred_at: null,
                unprocessed_count: 0,
                error_count: 0,
                payout_count: 0,
                payout_pending_count: 0,
                payout_paid_count: 0,
              };
            }

            for (const e of events as any[]) {
              const invoiceId = String(e.source_ref || '').trim();
              if (!invoiceId || !byInvoice[invoiceId]) continue;

              const c = byInvoice[invoiceId]!;
              c.event_count += 1;
              c.total_cents += Number(e.amount_cents || 0);
              const occurred = e.occurred_at ? String(e.occurred_at) : null;
              if (!c.last_occurred_at || (occurred && occurred > c.last_occurred_at)) c.last_occurred_at = occurred;
              if (!e.processed_at) c.unprocessed_count += 1;
              if (e.processing_error) c.error_count += 1;
            }

            if (payouts.length > 0) {
              const payoutByEventId: Record<string, { pending: number; paid: number; total: number }> = {};
              for (const p of payouts) {
                const eventId = String(p.event_id || '').trim();
                if (!eventId) continue;
                payoutByEventId[eventId] ??= { pending: 0, paid: 0, total: 0 };
                payoutByEventId[eventId].total += 1;
                if (p.status === 'paid') payoutByEventId[eventId].paid += 1;
                if (p.status === 'pending' || p.status === 'partially_paid') payoutByEventId[eventId].pending += 1;
              }

              // Attribute payouts to invoice via the event list (event.source_ref == invoice id)
              for (const e of events as any[]) {
                const invoiceId = String(e.source_ref || '').trim();
                const eventId = String(e.id || '').trim();
                const stats = payoutByEventId[eventId];
                if (!invoiceId || !stats || !byInvoice[invoiceId]) continue;
                byInvoice[invoiceId]!.payout_count += stats.total;
                byInvoice[invoiceId]!.payout_pending_count += stats.pending;
                byInvoice[invoiceId]!.payout_paid_count += stats.paid;
              }
            }

            const withCashflow = formatted.map((inv) => {
              const c = byInvoice[inv.id];
              if (!c) return inv;

              let status: Invoice['cashflow']['status'] = 'unknown';
              if (c.error_count > 0) status = 'error';
              else if (c.unprocessed_count > 0) status = 'pending';
              else if (inv.amount_paid > 0 && c.event_count === 0) status = 'missing';
              else if (c.event_count > 0) status = 'ok';
              c.status = status;

              return { ...inv, cashflow: c };
            });

            setInvoices(withCashflow);
            return;
          }
        }
      } catch {
        // ignore (cashflow tables may not exist in some deployments)
      }

      setInvoices(formatted);
    } catch (error) {
      console.error('Error loading invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateDraftInvoices = async (mode: 'dry_run' | 'create') => {
    if (!draftVehicleId) {
      setDraftMessage('Pick a vehicle first.');
      return;
    }
    setDraftBusy(true);
    setDraftMessage(mode === 'dry_run' ? 'Running dry-run…' : 'Generating draft invoices…');
    try {
      const { data, error } = await supabase.functions.invoke('backfill-invoice-drafts', {
        body: {
          vehicle_id: draftVehicleId,
          limit: draftLimit,
          dry_run: mode === 'dry_run',
        }
      });
      if (error) throw error;
      const created = Number((data as any)?.created || 0);
      const considered = Number((data as any)?.considered || 0);
      setDraftMessage(mode === 'dry_run'
        ? `Dry-run ok: would consider ${considered} events.`
        : `Created ${created} draft invoice(s) from ${considered} event(s).`
      );
      if (mode === 'create') await loadInvoices();
    } catch (e: any) {
      setDraftMessage(e?.message || 'Failed to generate drafts');
    } finally {
      setDraftBusy(false);
    }
  };

  const markAsSent = async (invoiceId: string) => {
    try {
      const { error } = await supabase
        .from('generated_invoices')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', invoiceId);

      if (error) throw error;
      loadInvoices();
    } catch (error) {
      console.error('Error marking as sent:', error);
    }
  };

  const recordPayment = async (invoiceId: string, amount: number) => {
    try {
      const invoice = invoices.find(i => i.id === invoiceId);
      if (!invoice) return;

      const newAmountPaid = invoice.amount_paid + amount;
      const newAmountDue = invoice.total_amount - newAmountPaid;
      const newStatus = newAmountDue <= 0 ? 'paid' : newAmountPaid > 0 ? 'partial' : 'unpaid';

      const { error } = await supabase
        .from('generated_invoices')
        .update({ 
          amount_paid: newAmountPaid,
          amount_due: newAmountDue,
          payment_status: newStatus,
          paid_at: newStatus === 'paid' ? new Date().toISOString() : null
        })
        .eq('id', invoiceId);

      if (error) throw error;
      loadInvoices();
    } catch (error) {
      console.error('Error recording payment:', error);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid': return 'var(--success)';
      case 'partial': return 'var(--warning)';
      case 'overdue': return 'var(--error)';
      case 'sent': return 'var(--text)';
      default: return 'var(--text-secondary)';
    }
  };

  const getCashflowColor = (status: Invoice['cashflow']['status'] | undefined) => {
    switch (status) {
      case 'ok': return 'var(--success)';
      case 'pending': return 'var(--warning)';
      case 'missing':
      case 'error':
        return 'var(--error)';
      default:
        return 'var(--text-secondary)';
    }
  };

  return (
    <div style={{ 
      background: 'var(--bg)', 
      minHeight: '100vh', 
      padding: 'var(--space-4)' 
    }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ 
          marginBottom: 'var(--space-4)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h1 style={{ 
            fontSize: '14px', 
            fontWeight: 700, 
            color: 'var(--text)',
            margin: 0
          }}>
            Invoice Manager
          </h1>
          
          {/* Filters */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(['all', 'draft', 'sent', 'unpaid', 'paid'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '4px var(--space-2)',
                  border: '2px solid var(--border)',
                  background: filter === f ? 'var(--text)' : 'var(--surface)',
                  color: filter === f ? 'var(--surface)' : 'var(--text)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)',
                  transition: 'var(--transition)',
                  textTransform: 'uppercase'
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Draft generator (deterministic, no LLM) */}
        <div style={{
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: 'var(--space-3)',
          marginBottom: 'var(--space-3)'
        }}>
          <div style={{ fontSize: '10px', fontWeight: 700, marginBottom: '6px' }}>
            Generate draft invoices from timeline evidence (deterministic)
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={draftVehicleId}
              onChange={(e) => setDraftVehicleId(e.target.value)}
              style={{
                padding: '4px 6px',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '9px',
                minWidth: '240px'
              }}
            >
              {myVehicles.length === 0 ? (
                <option value="">(no vehicles found)</option>
              ) : myVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {(v.year ? `${v.year} ` : '') + (v.make || '') + (v.make ? ' ' : '') + (v.model || '') + (v.trim ? ` ${v.trim}` : '')}
                </option>
              ))}
            </select>

            <input
              type="number"
              min={1}
              max={50}
              value={draftLimit}
              onChange={(e) => setDraftLimit(Math.max(1, Math.min(50, Number(e.target.value || 5))))}
              style={{
                width: '70px',
                padding: '4px 6px',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                fontSize: '9px'
              }}
              title="How many events to consider"
            />

            <button
              onClick={() => generateDraftInvoices('dry_run')}
              disabled={draftBusy || !draftVehicleId}
              style={{
                padding: '4px 10px',
                border: '2px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: '9px',
                fontWeight: 700,
                cursor: draftBusy ? 'not-allowed' : 'pointer',
                borderRadius: 'var(--radius)',
              }}
            >
              DRY RUN
            </button>
            <button
              onClick={() => generateDraftInvoices('create')}
              disabled={draftBusy || !draftVehicleId}
              style={{
                padding: '4px 10px',
                border: '2px solid var(--text)',
                background: 'var(--text)',
                color: 'var(--surface)',
                fontSize: '9px',
                fontWeight: 800,
                cursor: draftBusy ? 'not-allowed' : 'pointer',
                borderRadius: 'var(--radius)',
              }}
            >
              {draftBusy ? 'WORKING…' : 'GENERATE DRAFTS'}
            </button>

            {draftMessage && (
              <div style={{ fontSize: '9px', color: 'var(--text-secondary)' }}>
                {draftMessage}
              </div>
            )}
          </div>
        </div>

        {/* Invoice List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            Loading invoices...
          </div>
        ) : invoices.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-secondary)', fontSize: '10px' }}>
            No invoices found
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {invoices.map(invoice => (
              <div
                key={invoice.id}
                style={{
                  background: 'var(--surface)',
                  border: '2px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: 'var(--space-3)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'var(--space-4)'
                }}
              >
                {/* Invoice Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    fontSize: '10px', 
                    fontWeight: 700, 
                    color: 'var(--text)',
                    marginBottom: '2px'
                  }}>
                    {invoice.invoice_number}
                  </div>
                  <div style={{ fontSize: '9px', color: 'var(--text)', marginBottom: '4px' }}>
                    {invoice.client_name || 'No client'} • <span style={{ textTransform: 'capitalize' }}>
                      {invoice.event_type ? invoice.event_type.replace('_', ' ') : invoice.event_title}
                    </span>
                  </div>
                  {invoice.vehicle_name && (
                    <div style={{ 
                      fontSize: '9px', 
                      fontWeight: 600,
                      color: 'var(--text)',
                      background: 'var(--bg)',
                      padding: '4px 8px',
                      borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)',
                      display: 'inline-block',
                      marginBottom: '4px'
                    }}>
                      {invoice.vehicle_name}
                      {invoice.vehicle_vin && (
                        <span style={{ marginLeft: '8px', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontSize: '8px' }}>
                          VIN: {invoice.vehicle_vin.slice(-8)}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ fontSize: '8px', color: 'var(--text-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                    <span>Invoice: {new Date(invoice.invoice_date).toLocaleDateString()}</span>
                    <span>Due: {new Date(invoice.due_date).toLocaleDateString()}</span>
                    {invoice.mileage && (
                      <span>Mileage: {invoice.mileage.toLocaleString()} mi</span>
                    )}
                    {invoice.vehicle_license_plate && (
                      <span>Plate: {invoice.vehicle_license_plate}</span>
                    )}
                  </div>
                </div>

                {/* Amount */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ 
                    fontSize: '11px', 
                    fontWeight: 700, 
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text)'
                  }}>
                    {formatCurrency(invoice.total_amount)}
                  </div>
                  <div style={{ 
                    fontSize: '8px', 
                    color: getStatusColor(invoice.payment_status),
                    fontWeight: 600,
                    textTransform: 'uppercase'
                  }}>
                    {invoice.payment_status}
                  </div>
                  {invoice.cashflow && invoice.amount_paid > 0 && (
                    <div
                      style={{
                        fontSize: '8px',
                        marginTop: '2px',
                        color: getCashflowColor(invoice.cashflow.status),
                        fontWeight: 600,
                        textTransform: 'uppercase'
                      }}
                      title={`cashflow_events=${invoice.cashflow.event_count} unprocessed=${invoice.cashflow.unprocessed_count} errors=${invoice.cashflow.error_count} payouts=${invoice.cashflow.payout_count}`}
                    >
                      cashflow: {invoice.cashflow.status}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                  <button
                    onClick={() => setPreviewInvoice(invoice)}
                    style={{
                      padding: '4px var(--space-2)',
                      border: '2px solid var(--border)',
                      background: 'var(--surface)',
                      color: 'var(--text)',
                      fontSize: '9px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: 'var(--radius)',
                      transition: 'var(--transition)'
                    }}
                  >
                    PREVIEW
                  </button>
                  
                  {invoice.status === 'draft' && (
                    <button
                      onClick={() => markAsSent(invoice.id)}
                      style={{
                        padding: '4px var(--space-2)',
                        border: '2px solid var(--text)',
                        background: 'var(--text)',
                        color: 'var(--surface)',
                        fontSize: '9px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        borderRadius: 'var(--radius)',
                        transition: 'var(--transition)'
                      }}
                    >
                      SEND
                    </button>
                  )}
                  
                  {invoice.payment_status !== 'paid' && (
                    <button
                      onClick={() => {
                        const amount = prompt('Enter payment amount:', invoice.amount_due.toString());
                        if (amount) {
                          recordPayment(invoice.id, parseFloat(amount));
                        }
                      }}
                      style={{
                        padding: '4px var(--space-2)',
                        border: '2px solid var(--success)',
                        background: 'var(--success)',
                        color: '#ffffff',
                        fontSize: '9px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        borderRadius: 'var(--radius)',
                        transition: 'var(--transition)'
                      }}
                    >
                      RECORD PAYMENT
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview Modal */}
      {previewInvoice && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 'var(--space-4)'
          }}
          onClick={() => setPreviewInvoice(null)}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '2px solid var(--border)',
              borderRadius: 'var(--radius)',
              maxWidth: '900px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: 'var(--space-4)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: 'var(--space-3)',
              paddingBottom: 'var(--space-2)',
              borderBottom: '2px solid var(--border)'
            }}>
              <h2 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                Invoice Preview - {previewInvoice.invoice_number}
              </h2>
              <button
                onClick={() => setPreviewInvoice(null)}
                style={{
                  padding: '4px var(--space-2)',
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)'
                }}
              >
                CLOSE
              </button>
            </div>

            {/* Invoice HTML Preview */}
            {previewInvoice.html_content ? (
              <div
                style={{
                  background: 'var(--surface)',
                  padding: 'var(--space-4)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)'
                }}
                dangerouslySetInnerHTML={{ __html: previewInvoice.html_content }}
              />
            ) : (
              <div style={{ 
                padding: 'var(--space-4)', 
                textAlign: 'center',
                color: 'var(--text-secondary)',
                fontSize: '10px'
              }}>
                No HTML content generated yet
              </div>
            )}

            {/* Actions */}
            <div style={{ 
              marginTop: 'var(--space-4)',
              display: 'flex',
              gap: 'var(--space-2)',
              paddingTop: 'var(--space-3)',
              borderTop: '2px solid var(--border)'
            }}>
              <button
                onClick={() => {
                  // Future: Email functionality
                  alert('Email functionality coming soon');
                }}
                style={{
                  flex: 1,
                  padding: '6px var(--space-3)',
                  border: '2px solid var(--text)',
                  background: 'var(--text)',
                  color: 'var(--surface)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)',
                  transition: 'var(--transition)'
                }}
              >
                EMAIL TO CLIENT
              </button>
              <button
                onClick={() => {
                  // Future: PDF generation
                  alert('PDF generation coming soon');
                }}
                style={{
                  flex: 1,
                  padding: '6px var(--space-3)',
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)',
                  transition: 'var(--transition)'
                }}
              >
                DOWNLOAD PDF
              </button>
              <button
                onClick={() => {
                  // Future: QuickBooks export
                  alert('QuickBooks export coming soon');
                }}
                style={{
                  flex: 1,
                  padding: '6px var(--space-3)',
                  border: '2px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontSize: '9px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)',
                  transition: 'var(--transition)'
                }}
              >
                EXPORT TO QB
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceManager;

