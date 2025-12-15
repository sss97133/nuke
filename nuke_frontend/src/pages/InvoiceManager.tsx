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
}

const InvoiceManager: React.FC = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'sent' | 'unpaid' | 'paid'>('all');
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadInvoices();
  }, [filter]);

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

      const formatted = (data || []).map((inv: any) => ({
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
        html_content: inv.html_content
      }));

      setInvoices(formatted);
    } catch (error) {
      console.error('Error loading invoices:', error);
    } finally {
      setLoading(false);
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

