import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import type { WorkOrderReceipt, DealContact, BuildStatusTotals } from './hooks/useBuildStatus';

// ── Helpers ──

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtWhole = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDate = (d: string) => {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// ── Types ──

interface LineItemDetail {
  id: string;
  task_description: string;
  task_type: string;
  hours_labor: number | null;
  hourly_rate: number | null;
  parts_cost_cents: number | null;
  total_cost_cents: number | null;
  status: string;
  is_comped: boolean;
}

interface Props {
  vehicleId: string;
  workOrders: WorkOrderReceipt[];
  totals: BuildStatusTotals;
  contact: DealContact | null;
  vehicle: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    vin?: string | null;
  } | null;
  isOwnerView: boolean;
}

const GenerateBill: React.FC<Props> = ({ vehicleId, workOrders, totals, contact, vehicle, isOwnerView }) => {
  const [showInvoice, setShowInvoice] = useState(false);
  const [lineItems, setLineItems] = useState<Record<string, LineItemDetail[]>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<'idle' | 'sent' | 'error'>('idle');

  // Only show completed items on the bill
  const billableOrders = useMemo(
    () => workOrders.filter(wo => wo.invoice_total > 0),
    [workOrders]
  );

  const loadLineItems = useCallback(async () => {
    if (billableOrders.length === 0) return;
    setLoading(true);
    try {
      const woIds = billableOrders.map(wo => wo.work_order_id);
      const { data, error } = await supabase
        .from('work_order_line_items')
        .select('id, work_order_id, task_description, task_type, hours_labor, labor_rate_cents, parts_cost_cents, total_cost_cents, status')
        .in('work_order_id', woIds)
        .order('line_number');

      if (!error && data) {
        const grouped: Record<string, LineItemDetail[]> = {};
        for (const item of data) {
          const woId = (item as any).work_order_id;
          if (!grouped[woId]) grouped[woId] = [];
          grouped[woId].push({
            id: item.id,
            task_description: item.task_description || '',
            task_type: item.task_type,
            hours_labor: item.hours_labor != null ? Number(item.hours_labor) : null,
            hourly_rate: item.labor_rate_cents != null ? Number(item.labor_rate_cents) / 100 : null,
            parts_cost_cents: item.parts_cost_cents != null ? Number(item.parts_cost_cents) : null,
            total_cost_cents: item.total_cost_cents != null ? Number(item.total_cost_cents) : null,
            status: item.status,
            is_comped: Number(item.total_cost_cents || 0) === 0 && Number(item.parts_cost_cents || 0) === 0 && Number(item.hours_labor || 0) > 0,
          });
        }
        setLineItems(grouped);
      }
    } catch {
      // silently degrade
    } finally {
      setLoading(false);
    }
  }, [billableOrders]);

  const handleGenerate = useCallback(() => {
    setShowInvoice(true);
    loadLineItems();
  }, [loadLineItems]);

  const handleSend = useCallback(async () => {
    if (!contact?.email) return;
    setSending(true);
    setSentStatus('idle');

    try {
      // Build invoice HTML inline for the send
      const invoiceDate = new Date().toISOString().split('T')[0];
      const invoiceNumber = `INV-${(vehicle?.model || 'VEH').replace(/\s+/g, '').toUpperCase().slice(0, 8)}-${invoiceDate.replace(/-/g, '').slice(4)}`;

      // Upsert generated_invoices record
      const { error: invoiceError } = await supabase
        .from('generated_invoices')
        .upsert({
          work_order_id: billableOrders[0]?.work_order_id || null,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          due_date: invoiceDate,
          subtotal: totals.invoice,
          tax_amount: 0,
          tax_rate: 0,
          total_amount: totals.invoice,
          amount_paid: totals.paid,
          amount_due: totals.balance,
          payment_status: totals.balance > 0 ? 'partial' : 'paid',
          status: 'sent',
          sent_at: new Date().toISOString(),
        }, { onConflict: 'work_order_id' });

      if (invoiceError) throw invoiceError;

      // Send via edge function (Resend)
      const vehicleTitle = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ');
      const { error: sendError } = await supabase.functions.invoke('send-invoice-email', {
        body: {
          to: contact.email,
          subject: `Invoice: ${vehicleTitle} — ${fmtWhole(totals.balance)} Balance Due`,
          customer_name: contact.full_name,
          vehicle_title: vehicleTitle,
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate,
          total: totals.invoice,
          paid: totals.paid,
          balance: totals.balance,
          line_items: billableOrders.map(wo => ({
            description: wo.work_order_title,
            amount: wo.invoice_total,
          })),
        },
      });

      if (sendError) throw sendError;
      setSentStatus('sent');
    } catch (err: any) {
      console.error('Failed to send invoice:', err);
      setSentStatus('error');
    } finally {
      setSending(false);
    }
  }, [contact, vehicle, billableOrders, totals]);

  if (!isOwnerView || billableOrders.length === 0) return null;

  const vehicleTitle = [vehicle?.year, vehicle?.make, vehicle?.model].filter(Boolean).join(' ');
  const today = new Date().toISOString().split('T')[0];

  return (
    <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px' }}>
      {!showInvoice ? (
        <button
          onClick={handleGenerate}
          style={{
            display: 'block',
            width: '100%',
            padding: '8px 12px',
            fontFamily: 'var(--vp-font-sans)',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            border: '2px solid var(--vp-ink, #1a1a1a)',
            background: 'var(--vp-ink, #1a1a1a)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          GENERATE BILL
        </button>
      ) : (
        <div>
          {/* Invoice header */}
          <div style={{
            border: '2px solid var(--vp-ink)',
            padding: '12px',
          }}>
            {/* Top row: shop + invoice meta */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '12px',
              paddingBottom: '8px',
              borderBottom: '2px solid var(--vp-ink)',
            }}>
              <div>
                <div style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  fontFamily: 'var(--vp-font-sans)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}>
                  NUKE
                </div>
                <div style={{
                  fontSize: '7px',
                  color: 'var(--vp-pencil)',
                  fontFamily: 'var(--vp-font-mono)',
                  marginTop: '2px',
                }}>
                  Vehicle Build Services
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: '8px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}>
                  INVOICE
                </div>
                <div style={{
                  fontSize: '7px',
                  fontFamily: 'var(--vp-font-mono)',
                  color: 'var(--vp-pencil)',
                  marginTop: '2px',
                }}>
                  DATE: {fmtDate(today)}
                </div>
              </div>
            </div>

            {/* Vehicle + Customer info */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '12px',
              marginBottom: '12px',
              fontSize: '8px',
            }}>
              <div>
                <div style={{
                  fontSize: '7px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--vp-pencil)',
                  marginBottom: '2px',
                }}>
                  VEHICLE
                </div>
                <div style={{ fontWeight: 700 }}>{vehicleTitle}</div>
                {vehicle?.vin && (
                  <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '7px', color: 'var(--vp-pencil)' }}>
                    VIN: {vehicle.vin}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontSize: '7px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--vp-pencil)',
                  marginBottom: '2px',
                }}>
                  BILL TO
                </div>
                {contact ? (
                  <>
                    <div style={{ fontWeight: 700 }}>{contact.full_name}</div>
                    {contact.email && (
                      <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '7px', color: 'var(--vp-pencil)' }}>
                        {contact.email}
                      </div>
                    )}
                    {(contact.address || contact.city) && (
                      <div style={{ fontFamily: 'var(--vp-font-mono)', fontSize: '7px', color: 'var(--vp-pencil)' }}>
                        {[contact.address, contact.city, contact.state, contact.zip].filter(Boolean).join(', ')}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ color: 'var(--vp-pencil)' }}>No customer on file</div>
                )}
              </div>
            </div>

            {/* Line items table */}
            <div style={{ marginBottom: '12px' }}>
              {/* Table header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 50px 50px 60px',
                gap: '4px 8px',
                padding: '4px 0',
                borderBottom: '2px solid var(--vp-ink)',
                fontSize: '7px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--vp-pencil)',
              }}>
                <span>DESCRIPTION</span>
                <span style={{ textAlign: 'right' }}>HOURS</span>
                <span style={{ textAlign: 'right' }}>PARTS</span>
                <span style={{ textAlign: 'right' }}>TOTAL</span>
              </div>

              {/* Work order groups */}
              {billableOrders.map(wo => {
                const items = lineItems[wo.work_order_id] || [];
                return (
                  <React.Fragment key={wo.work_order_id}>
                    {/* WO section header */}
                    <div style={{
                      fontSize: '7px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      padding: '6px 0 2px',
                      color: 'var(--vp-ink)',
                      borderBottom: '1px solid var(--vp-ghost, #ddd)',
                    }}>
                      {wo.work_order_title}
                    </div>

                    {loading ? (
                      <div style={{ fontSize: '7px', color: 'var(--vp-pencil)', padding: '4px 0' }}>Loading items...</div>
                    ) : items.length > 0 ? (
                      items.filter(li => (li.total_cost_cents || 0) > 0 || li.is_comped).map(li => (
                        <div key={li.id} style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 50px 50px 60px',
                          gap: '2px 8px',
                          padding: '2px 0',
                          borderBottom: '1px solid var(--vp-ghost, #ddd)',
                          fontSize: '8px',
                          fontFamily: 'var(--vp-font-mono)',
                        }}>
                          <span style={{
                            fontFamily: 'var(--vp-font-sans)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {li.task_description}
                            {li.is_comped && (
                              <span style={{
                                marginLeft: '4px',
                                padding: '0 3px',
                                fontSize: '6px',
                                fontWeight: 700,
                                letterSpacing: '0.1em',
                                border: '1px solid var(--vp-gulf-orange)',
                                color: 'var(--vp-gulf-orange)',
                              }}>COMPED</span>
                            )}
                          </span>
                          <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>
                            {li.hours_labor ? `${li.hours_labor}h` : ''}
                          </span>
                          <span style={{ textAlign: 'right', color: 'var(--vp-pencil)' }}>
                            {li.parts_cost_cents ? fmt(li.parts_cost_cents / 100) : ''}
                          </span>
                          <span style={{ textAlign: 'right', fontWeight: 700 }}>
                            {li.total_cost_cents ? fmt(li.total_cost_cents / 100) : '\u2014'}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 50px 50px 60px',
                        gap: '2px 8px',
                        padding: '2px 0',
                        borderBottom: '1px solid var(--vp-ghost, #ddd)',
                        fontSize: '8px',
                      }}>
                        <span style={{ color: 'var(--vp-pencil)' }}>Work order services</span>
                        <span />
                        <span />
                        <span style={{ textAlign: 'right', fontFamily: 'var(--vp-font-mono)', fontWeight: 700 }}>
                          {fmt(wo.invoice_total)}
                        </span>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Totals */}
            <div style={{
              borderTop: '2px solid var(--vp-ink)',
              paddingTop: '8px',
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: '2px 20px',
                fontFamily: 'var(--vp-font-mono)',
                fontSize: '8px',
              }}>
                <span style={{
                  fontSize: '7px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--vp-pencil)',
                  fontWeight: 700,
                  fontFamily: 'var(--vp-font-sans)',
                }}>SUBTOTAL</span>
                <span style={{ textAlign: 'right' }}>{fmt(totals.invoice)}</span>

                {totals.comped > 0 && (
                  <>
                    <span style={{
                      fontSize: '7px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: 'var(--vp-gulf-orange)',
                      fontWeight: 700,
                      fontFamily: 'var(--vp-font-sans)',
                    }}>GOODWILL</span>
                    <span style={{ textAlign: 'right', color: 'var(--vp-gulf-orange)' }}>({fmt(totals.comped)})</span>
                  </>
                )}

                {totals.paid > 0 && (
                  <>
                    <span style={{
                      fontSize: '7px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: 'var(--vp-brg, #004225)',
                      fontWeight: 700,
                      fontFamily: 'var(--vp-font-sans)',
                    }}>PAYMENTS RECEIVED</span>
                    <span style={{ textAlign: 'right', color: 'var(--vp-brg, #004225)' }}>({fmt(totals.paid)})</span>
                  </>
                )}

                {/* Balance due - large */}
                <span style={{
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontFamily: 'var(--vp-font-sans)',
                  paddingTop: '4px',
                  borderTop: '1px solid var(--vp-ghost, #ddd)',
                  marginTop: '4px',
                }}>BALANCE DUE</span>
                <span style={{
                  textAlign: 'right',
                  fontSize: '12px',
                  fontWeight: 700,
                  paddingTop: '4px',
                  borderTop: '1px solid var(--vp-ghost, #ddd)',
                  marginTop: '4px',
                  color: totals.balance > 0 ? 'var(--vp-martini-red, #C8102E)' : 'var(--vp-brg, #004225)',
                }}>
                  {fmt(totals.balance)}
                </span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{
            display: 'flex',
            gap: '4px',
            marginTop: '6px',
          }}>
            <button
              onClick={() => setShowInvoice(false)}
              style={{
                flex: 1,
                padding: '6px 12px',
                fontFamily: 'var(--vp-font-sans)',
                fontSize: '7px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                border: '2px solid var(--vp-ghost, #ddd)',
                background: 'transparent',
                color: 'var(--vp-pencil)',
                cursor: 'pointer',
              }}
            >
              CLOSE
            </button>

            {contact?.email && totals.balance > 0 && (
              <button
                onClick={handleSend}
                disabled={sending || sentStatus === 'sent'}
                style={{
                  flex: 2,
                  padding: '6px 12px',
                  fontFamily: 'var(--vp-font-sans)',
                  fontSize: '7px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  border: '2px solid var(--vp-ink)',
                  background: sentStatus === 'sent' ? 'var(--vp-brg, #004225)' : 'var(--vp-ink, #1a1a1a)',
                  color: '#fff',
                  cursor: sending ? 'wait' : sentStatus === 'sent' ? 'default' : 'pointer',
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? 'SENDING...' : sentStatus === 'sent' ? 'SENT' : sentStatus === 'error' ? 'RETRY SEND' : 'SEND TO CUSTOMER'}
              </button>
            )}
          </div>

          {sentStatus === 'sent' && (
            <div style={{
              fontSize: '7px',
              fontFamily: 'var(--vp-font-mono)',
              color: 'var(--vp-brg, #004225)',
              marginTop: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Invoice sent to {contact?.email}
            </div>
          )}

          {sentStatus === 'error' && (
            <div style={{
              fontSize: '7px',
              fontFamily: 'var(--vp-font-mono)',
              color: 'var(--vp-martini-red)',
              marginTop: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Failed to send — check edge function logs
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GenerateBill;
