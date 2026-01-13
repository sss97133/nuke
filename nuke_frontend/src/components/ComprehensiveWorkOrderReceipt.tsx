/**
 * COMPREHENSIVE WORK ORDER RECEIPT
 * 
 * Full forensic accounting display showing:
 * - Multi-participant attribution (who documented vs who performed)
 * - Detailed cost breakdown (parts, labor, materials, tools, overhead)
 * - Quality ratings and confidence scores
 * - Industry standard comparisons
 * - Flagged concerns
 * 
 * This is the complete "receipt" that shows where every dollar went
 * and gives credit to everyone involved.
 */

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';
import { FaviconIcon } from './common/FaviconIcon';
import { generateEventSummary } from '../utils/timelineSummary';

interface ComprehensiveWorkOrderReceiptProps {
  eventId: string;
  onClose: () => void;
  onNavigate?: (newEventId: string) => void;
}

interface WorkOrder {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  vehicle_id?: string;
  event_type?: string;
  duration_hours?: number;
  cost_amount?: number;
  
  // Attribution
  documented_by?: string;
  primary_technician?: string;
  service_provider_name?: string;
  created_by?: string;
  
  // Quality
  quality_rating?: number;
  quality_justification?: string;
  value_impact?: number;
  ai_confidence_score?: number;
  concerns?: string[];
  industry_standard_comparison?: any;
  
  // Counts
  participant_count?: number;
  parts_count?: number;
  labor_tasks_count?: number;
  materials_count?: number;
  tools_count?: number;
  evidence_count?: number;
  
  // Totals
  parts_total?: number;
  labor_total?: number;
  labor_hours_total?: number;
  materials_total?: number;
  tools_total?: number;
  overhead_total?: number;
  calculated_total?: number;
}

interface Participant {
  id: string;
  role: string;
  name?: string;
  user_id?: string;
  company?: string;
}

interface Part {
  id: string;
  name: string;
  brand?: string;
  part_number?: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  supplier?: string;
  ai_extracted?: boolean;
}

interface LaborTask {
  id: string;
  task: string;
  category?: string;
  hours: number;
  rate: number; // Final rate used (reported if available, otherwise calculated)
  reported_rate?: number | null; // User-reported rate
  calculated_rate?: number | null; // System-calculated rate with multipliers
  rate_source?: string; // 'contract', 'user', 'organization', 'system_default'
  total: number;
  difficulty?: number;
  industry_standard?: number;
  ai_estimated?: boolean;
  calculation_metadata?: any; // Full calculation breakdown
}

interface Material {
  id: string;
  name: string;
  category?: string;
  quantity: number;
  unit?: string;
  unit_cost: number;
  total_cost: number;
}

interface Tool {
  id: string;
  tool_id?: string;
  duration_minutes?: number;
  depreciation_cost: number;
  usage_context?: string;
}

interface Overhead {
  facility_hours?: number;
  facility_rate?: number;
  facility_cost?: number;
  utilities_cost?: number;
  total_overhead?: number;
}

interface DeviceAttribution {
  device_fingerprint: string;
  uploaded_by?: string;
  contributor?: string;
  ghost_user_id?: string;
}

interface Evidence {
  id: string;
  image_url: string;
  taken_at?: string;
  created_at?: string;
}

interface EventDocument {
  document_id: string;
  document_type: string | null;
  file_url: string | null;
  vendor_name: string | null;
  amount: number | null;
}

interface ReceiptHeader {
  id: string;
  vendor_name: string | null;
  receipt_date: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  invoice_number: string | null;
  purchase_order: string | null;
  status: string | null;
  source_document_id: string | null;
}

interface ReceiptItemRow {
  id: string;
  receipt_id: string;
  line_number: number | null;
  description: string | null;
  part_number: string | null;
  vendor_sku: string | null;
  category: string | null;
  quantity: number | null;
  unit_price: number | null;
  total_price: number | null;
}

interface InvoiceDraft {
  id: string;
  event_id: string;
  invoice_number: string;
  invoice_date: string | null;
  due_date: string | null;
  total_amount: number | null;
  status: string | null;
  payment_status: string | null;
  html_content: string | null;
}

export const ComprehensiveWorkOrderReceipt: React.FC<ComprehensiveWorkOrderReceiptProps> = ({ eventId, onClose, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [deviceAttribution, setDeviceAttribution] = useState<DeviceAttribution[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [eventDocuments, setEventDocuments] = useState<EventDocument[]>([]);
  const [receiptHeaders, setReceiptHeaders] = useState<ReceiptHeader[]>([]);
  const [receiptItems, setReceiptItems] = useState<ReceiptItemRow[]>([]);
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceDraft | null>(null);
  const [showInvoiceHtml, setShowInvoiceHtml] = useState(false);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [baseEvent, setBaseEvent] = useState<any>(null);
  const [runningContextual, setRunningContextual] = useState(false);
  const [contextualError, setContextualError] = useState<string | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<{
    parts: { items: Part[], total: number },
    labor: { tasks: LaborTask[], total: number, hours: number },
    materials: { items: Material[], total: number },
    tools: { items: Tool[], total: number },
    overhead: Overhead
  } | null>(null);
  const [adjacentEvents, setAdjacentEvents] = useState<{ prev: string | null, next: string | null }>({ prev: null, next: null });
  const [auctionData, setAuctionData] = useState<{
    seller?: string;
    seller_username?: string;
    seller_profile_url?: string;
    buyer?: string;
    buyer_username?: string;
    buyer_profile_url?: string;
    lot_number?: string;
    sale_price?: number;
  } | null>(null);
  const [minimalEvent, setMinimalEvent] = useState<any>(null); // Store minimal event data for fallback summary

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    setLoading(true);
    setContextualError(null);
    setEventDocuments([]);
    setReceiptHeaders([]);
    setReceiptItems([]);
    setInvoiceDraft(null);
    setShowInvoiceHtml(false);
    setInvoiceError(null);
    setBaseEvent(null);
    try {
      // 1. Try comprehensive view first, fallback to timeline_events
      let wo: WorkOrder | null = null;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
      
      const { data: viewData, error: viewError } = await supabase
        .from('work_order_comprehensive_receipt')
        .select('*')
        .eq('event_id', eventId)
        .single();

      if (viewError || !viewData) {
        // Fallback to timeline_events table directly
        console.warn('Comprehensive view failed, falling back to timeline_events:', viewError?.message);
        const { data: eventData, error: eventError } = await supabase
          .from('timeline_events')
          .select('*')
          .eq('id', eventId)
          .single();
        
        if (eventError || !eventData) {
          console.error('Failed to load event:', eventError?.message);
          // Store minimal event data for fallback summary
          setMinimalEvent({ id: eventId, error: eventError?.message || 'Event not found' });
          setLoading(false);
          return;
        }
        
        // Store minimal event for summary generation
        setMinimalEvent(eventData);
        
        // Map timeline_events to WorkOrder shape
        wo = {
          id: eventData.id,
          title: eventData.title,
          description: eventData.description,
          event_date: eventData.event_date,
          event_type: (eventData as any).event_type,
          duration_hours: eventData.duration_hours,
          cost_amount: eventData.cost_amount,
          service_provider_name: eventData.service_provider_name,
          quality_rating: eventData.quality_rating,
          value_impact: eventData.value_impact,
          ai_confidence_score: eventData.ai_confidence_score,
          concerns: eventData.concerns,
          vehicle_id: eventData.vehicle_id,
          // Set defaults for computed fields
          parts_count: 0,
          labor_tasks_count: 0,
          calculated_total: eventData.cost_amount || 0,
          // Preserve metadata for auction events
          calculation_metadata: (eventData as any).metadata
        } as WorkOrder;
      } else {
        wo = viewData;
        // Store minimal event for summary generation
        setMinimalEvent(viewData);
      }
      
      setWorkOrder(wo);

      // 1a. Load base event metadata for contextual analysis + receipt totals (best-effort)
      if (isUuid) {
        try {
          const { data: evRow, error: evErr } = await supabase
            .from('timeline_events')
            .select('id, vehicle_id, event_date, metadata, contextual_analysis_status, receipt_amount, receipt_currency')
            .eq('id', eventId)
            .maybeSingle();
          if (!evErr && evRow) setBaseEvent(evRow);
        } catch {
          // ignore
        }
      }

      // 1c. Load generated invoice draft (best-effort)
      if (isUuid) {
        try {
          const { data: inv, error: invErr } = await supabase
            .from('generated_invoices')
            .select('id,event_id,invoice_number,invoice_date,due_date,total_amount,status,payment_status,html_content')
            .eq('event_id', eventId)
            .maybeSingle();
          if (!invErr && inv) setInvoiceDraft(inv as any);
        } catch {
          // ignore
        }
      }

      // 1b. Extract auction data if this is an auction_sold event
      if (wo.event_type === 'auction_sold' || wo.title?.includes('sold') || wo.title?.includes('Auction')) {
        const metadata = wo.calculation_metadata || (wo as any).metadata;
        if (metadata) {
          setAuctionData({
            seller: metadata.seller || metadata.seller_username,
            seller_username: metadata.seller_username || metadata.seller,
            seller_profile_url: metadata.seller_profile_url,
            buyer: metadata.buyer || metadata.buyer_username,
            buyer_username: metadata.buyer_username || metadata.buyer,
            buyer_profile_url: metadata.buyer_profile_url,
            lot_number: metadata.lot_number,
            sale_price: wo.cost_amount || metadata.sale_price || metadata.final_price
          });
        }
        
        // Also try to get from external_listings if we have vehicle_id
        if (wo.vehicle_id) {
          const { data: listing } = await supabase
            .from('external_listings')
            .select('metadata, final_price')
            .eq('vehicle_id', wo.vehicle_id)
            .eq('platform', 'bat')
            .order('sold_at', { ascending: false, nullsLast: true })
            .limit(1)
            .maybeSingle();
          
          if (listing?.metadata) {
            const sellerUsername = listing.metadata?.seller_username || listing.metadata?.seller;
            const buyerUsername = listing.metadata?.buyer_username || listing.metadata?.buyer;
            setAuctionData(prev => ({
              ...prev,
              seller: prev?.seller || sellerUsername,
              seller_username: prev?.seller_username || sellerUsername,
              seller_profile_url: prev?.seller_profile_url || listing.metadata?.seller_profile_url || (sellerUsername ? `https://bringatrailer.com/member/${sellerUsername}/` : undefined),
              buyer: prev?.buyer || buyerUsername,
              buyer_username: prev?.buyer_username || buyerUsername,
              buyer_profile_url: prev?.buyer_profile_url || listing.metadata?.buyer_profile_url || (buyerUsername ? `https://bringatrailer.com/member/${buyerUsername}/` : undefined),
              lot_number: prev?.lot_number || listing.metadata?.lot_number,
              sale_price: prev?.sale_price || listing.final_price || listing.metadata?.sale_price
            }));
          }
        }
      }

      // 2. Get participants
      const { data: partsData } = await supabase
        .rpc('get_event_participants_detailed', { p_event_id: eventId });
      
      if (partsData) {
        setParticipants(partsData);
      }

      // 2b. Load event-linked documents + receipt ledger (best-effort)
      if (isUuid) {
        try {
          const { data: docs } = await supabase.rpc('get_event_documents', { p_event_id: eventId });
          const docRows = (docs || []) as EventDocument[];
          setEventDocuments(docRows);

          const docIds = docRows.map(d => d.document_id).filter(Boolean);
          if (docIds.length > 0) {
            const { data: recs, error: recErr } = await supabase
              .from('receipts')
              .select('id,vendor_name,receipt_date,currency,subtotal,tax,total,invoice_number,purchase_order,status,source_document_id')
              .eq('source_document_table', 'vehicle_documents')
              .in('source_document_id', docIds);

            if (!recErr && Array.isArray(recs) && recs.length > 0) {
              const receiptRows = recs as ReceiptHeader[];
              setReceiptHeaders(receiptRows);

              const receiptIds = receiptRows.map(r => r.id).filter(Boolean);
              if (receiptIds.length > 0) {
                const { data: items, error: itemsErr } = await supabase
                  .from('receipt_items')
                  .select('id,receipt_id,line_number,description,part_number,vendor_sku,category,quantity,unit_price,total_price')
                  .in('receipt_id', receiptIds)
                  .order('receipt_id', { ascending: true })
                  .order('line_number', { ascending: true });
                if (!itemsErr && Array.isArray(items)) {
                  setReceiptItems(items as ReceiptItemRow[]);
                }
              }
            }
          }
        } catch {
          // ignore receipt/doc loading failures (RLS, missing schema, etc.)
        }
      }

      // 3. Get device attribution
      if (wo?.vehicle_id && wo?.event_date) {
        const { data: devData } = await supabase
          .rpc('get_event_device_attribution', { 
            p_vehicle_id: wo.vehicle_id, 
            p_event_date: wo.event_date 
          });
        
        if (devData) {
          setDeviceAttribution(devData);
        }
      }

      // 4. Get adjacent events for date navigation
      if (wo?.vehicle_id && wo?.event_date) {
        const { data: adjacent } = await supabase
          .from('timeline_events')
          .select('id, event_date')
          .eq('vehicle_id', wo.vehicle_id)
          .order('event_date', { ascending: false });
        
        if (adjacent) {
          const currentIndex = adjacent.findIndex(e => e.id === eventId);
          setAdjacentEvents({
            prev: currentIndex > 0 ? adjacent[currentIndex - 1].id : null,
            next: currentIndex < adjacent.length - 1 ? adjacent[currentIndex + 1].id : null
          });
        }
      }

      // 5. Get evidence (photos)
      if (wo?.vehicle_id) {
        let imgs: Evidence[] = [];

        // Prefer explicit image->event links (supports evidence-set invoices)
        if (isUuid) {
          const { data: linked } = await supabase
            .from('vehicle_images')
            .select('id, image_url, taken_at, created_at')
            .eq('vehicle_id', wo.vehicle_id)
            .eq('timeline_event_id', eventId)
            .order('taken_at', { ascending: true });
          if (Array.isArray(linked) && linked.length > 0) {
            imgs = linked as Evidence[];
          }
        }

        // Fallback: day-range by taken_at / created_at
        if (imgs.length === 0 && wo?.event_date) {
          const startIso = new Date(`${String(wo.event_date).slice(0, 10)}T00:00:00.000Z`).toISOString();
          const endIso = new Date(new Date(startIso).getTime() + 24 * 60 * 60 * 1000).toISOString();

          const byTaken = await supabase
            .from('vehicle_images')
            .select('id, image_url, taken_at, created_at')
            .eq('vehicle_id', wo.vehicle_id)
            .gte('taken_at', startIso)
            .lt('taken_at', endIso)
            .order('taken_at', { ascending: true });

          const byCreated = await supabase
            .from('vehicle_images')
            .select('id, image_url, taken_at, created_at')
            .eq('vehicle_id', wo.vehicle_id)
            .gte('created_at', startIso)
            .lt('created_at', endIso)
            .order('created_at', { ascending: true });

          const seen = new Set<string>();
          const merged: Evidence[] = [];
          for (const row of [...(byTaken.data || []), ...(byCreated.data || [])] as Evidence[]) {
            if (!row?.id) continue;
            if (seen.has(row.id)) continue;
            seen.add(row.id);
            merged.push(row);
          }

          imgs = merged;
        }

        setEvidence(imgs);
      }

      // 5. Get comprehensive cost breakdown
      const { data: costs } = await supabase
        .rpc('get_event_cost_breakdown', { p_event_id: eventId });
      
      if (costs) {
        setCostBreakdown(costs);
      }

    } catch (error) {
      console.error('Error loading work order:', error);
    } finally {
      setLoading(false);
    }
  };

  const runContextualBatchAnalysis = async () => {
    try {
      setContextualError(null);
      setRunningContextual(true);

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
      if (!isUuid) throw new Error('This event cannot be analyzed (not a database event).');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      const vehicleId = workOrder?.vehicle_id || baseEvent?.vehicle_id;
      if (!vehicleId) throw new Error('Missing vehicle context');

      const imageIds = (evidence || []).map((e) => e.id).filter(Boolean).slice(0, 20);
      if (imageIds.length === 0) throw new Error('No evidence images linked to this event');

      const { error } = await supabase.functions.invoke('analyze-batch-contextual', {
        body: {
          event_id: eventId,
          vehicle_id: vehicleId,
          user_id: user.id,
          image_ids: imageIds
        }
      });

      if (error) throw error;
      await loadData();
    } catch (e: any) {
      setContextualError(e?.message || 'Failed to run analysis');
    } finally {
      setRunningContextual(false);
    }
  };

  const generateDraftInvoice = async () => {
    try {
      setInvoiceError(null);
      setGeneratingInvoice(true);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId);
      if (!isUuid) throw new Error('This event cannot generate an invoice (not a database event).');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Authentication required');

      const { error } = await supabase.functions.invoke('backfill-invoice-drafts', {
        body: { event_id: eventId, dry_run: false }
      });
      if (error) throw error;

      await loadData();
    } catch (e: any) {
      setInvoiceError(e?.message || 'Failed to generate invoice draft');
    } finally {
      setGeneratingInvoice(false);
    }
  };

  if (loading) {
    return createPortal(
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}>
        <div style={{ color: '#fff', fontSize: '14pt' }}>Loading receipt...</div>
      </div>,
      document.body
    );
  }

  if (!workOrder) {
    // Generate contextual summary from minimal event data if available
    const summary = minimalEvent ? generateEventSummary(minimalEvent) : null;
    
    return createPortal(
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}
        onClick={onClose}
      >
        <div 
          style={{ 
            background: 'var(--surface)', 
            padding: '24px', 
            border: '2px solid var(--border)',
            maxWidth: '500px',
            borderRadius: '8px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '12px' }}>
            Work Order Summary
          </div>
          
          {summary ? (
            <>
              <div style={{ fontSize: '10pt', marginBottom: '12px', lineHeight: 1.5 }}>
                <div style={{ fontWeight: 600, marginBottom: '8px' }}>
                  {summary.primary}
                </div>
                {summary.details.length > 0 && (
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    {summary.details.map((detail, idx) => (
                      <div key={idx} style={{ marginBottom: '4px' }}>
                        {detail}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ 
                fontSize: '8pt', 
                color: 'var(--text-muted)', 
                fontStyle: 'italic',
                marginBottom: '16px',
                padding: '8px',
                background: 'var(--grey-50)',
                borderRadius: '4px'
              }}>
                Note: Full receipt details are not available. This is a summary based on available event data.
              </div>
            </>
          ) : (
            <div style={{ fontSize: '10pt', marginBottom: '16px', color: 'var(--text-muted)' }}>
              Could not load work order data. The event may not exist or you may not have permission to view it.
            </div>
          )}
          
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            style={{
              padding: '8px 16px',
              fontSize: '9pt',
              fontWeight: 'bold',
              backgroundColor: 'var(--surface)',
              border: '2px solid var(--border)',
              color: 'var(--text)',
              cursor: 'pointer',
              borderRadius: '4px',
              transition: 'var(--transition)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--grey-100)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--surface)';
            }}
          >
            CLOSE
          </button>
        </div>
      </div>,
      document.body
    );
  }

  const formatCurrency = (amount?: number | null) => {
    if (amount == null) return '$0.00';
    return `$${amount.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', { 
      month: '2-digit', 
      day: '2-digit', 
      year: 'numeric' 
    });
  };

  const navigateToEvent = (newEventId: string | null) => {
    if (newEventId) {
      if (onNavigate) {
        onNavigate(newEventId);
      } else {
        // Fallback: use custom event to notify parent
        window.dispatchEvent(new CustomEvent('receipt-navigate', { detail: { eventId: newEventId } }));
      }
    }
  };

  return createPortal(
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
        overflow: 'auto'
      }}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      tabIndex={-1}
    >
      <div 
        style={{
          background: 'var(--surface)',
          width: '100%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid var(--border)',
          fontFamily: 'Arial, sans-serif'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* DATE NAVIGATION - Wireframe Top */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px',
          borderBottom: '2px solid #000',
          backgroundColor: 'var(--bg)'
        }}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (adjacentEvents.prev) {
                navigateToEvent(adjacentEvents.prev);
              }
            }}
            disabled={!adjacentEvents.prev}
            style={{
              padding: '4px 12px',
              fontSize: '7pt',
              fontWeight: 'bold',
              border: '2px solid #000',
              background: adjacentEvents.prev ? '#fff' : '#f0f0f0',
              cursor: adjacentEvents.prev ? 'pointer' : 'not-allowed',
              textTransform: 'uppercase',
              color: adjacentEvents.prev ? '#000' : '#999'
            }}
          >
            ← PREV DAY
          </button>
          
          <div style={{ fontSize: '9pt', fontWeight: 'bold', letterSpacing: '0.5px' }}>
            {workOrder.event_date ? new Date(workOrder.event_date).toLocaleDateString('en-US', { 
              month: '2-digit', 
              day: '2-digit', 
              year: 'numeric' 
            }) : 'Date unknown'}
          </div>
          
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (adjacentEvents.next) {
                navigateToEvent(adjacentEvents.next);
              }
            }}
            disabled={!adjacentEvents.next}
            style={{
              padding: '4px 12px',
              fontSize: '7pt',
              fontWeight: 'bold',
              border: '2px solid #000',
              background: adjacentEvents.next ? '#fff' : '#f0f0f0',
              cursor: adjacentEvents.next ? 'pointer' : 'not-allowed',
              textTransform: 'uppercase',
              color: adjacentEvents.next ? '#000' : '#999'
            }}
          >
            NEXT DAY →
          </button>
        </div>

        {/* WORK ORDER HEADER - Wireframe */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '3px double #000',
          background: 'var(--bg)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px'
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '10pt', fontWeight: 700, letterSpacing: '0.5px', marginBottom: '4px' }}>
              WORK ORDER #{workOrder.id?.slice(0, 8).toUpperCase() || 'N/A'}
            </div>
            <div style={{ fontSize: '7pt', color: '#666', marginBottom: '6px' }}>
              {workOrder.event_date ? new Date(workOrder.event_date).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric'
              }) : 'Date unknown'}
            </div>
            <div style={{ fontSize: '7pt', color: '#666' }}>
              {workOrder.service_provider_name || 'Owner/DIY'}
            </div>
          </div>
          
          {/* IMAGE THUMBNAILS IN HEADER */}
          {evidence.length > 0 && (
            <div style={{ 
              display: 'flex', 
              gap: '4px',
              flexShrink: 0
            }}>
              {evidence.slice(0, 4).map((img, idx) => (
                <img
                  key={img.id}
                  src={img.image_url}
                  alt={`Evidence ${idx + 1}`}
                  onClick={() => window.open(img.image_url, '_blank')}
                  style={{
                    width: '48px',
                    height: '48px',
                    objectFit: 'cover',
                    border: '1px solid #ccc',
                    cursor: 'pointer',
                    borderRadius: '2px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.border = '2px solid #000';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.border = '1px solid #ccc';
                  }}
                />
              ))}
              {evidence.length > 4 && (
                <div
                  onClick={() => {
                    const imagesSection = document.querySelector('[data-images-section]');
                    imagesSection?.scrollIntoView({ behavior: 'smooth' });
                  }}
                  style={{
                    width: '48px',
                    height: '48px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface)',
                    border: '1px solid #ccc',
                    borderRadius: '2px',
                    fontSize: '7pt',
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  +{evidence.length - 4}
                </div>
              )}
            </div>
          )}
        </div>

        {/* EVIDENCE SET - Wireframe */}
        {evidence.length > 0 && (
          <div 
            data-images-section
            style={{ 
              padding: '12px', 
              borderBottom: '2px solid #000',
              backgroundColor: 'var(--bg)' 
            }}
          >
            <div style={{ 
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px'
            }}>
              <div style={{ 
                fontSize: '8pt', 
                fontWeight: 'bold', 
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                EVIDENCE SET ({evidence.length} photos)
              </div>
              <div style={{ 
                fontSize: '7pt', 
                color: '#666',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                {(() => {
                  const status = (baseEvent as any)?.contextual_analysis_status;
                  const has = Boolean((baseEvent as any)?.metadata?.contextual_analysis);
                  const done = status === 'completed' || has;

                  return (
                    <>
                      <span>{done ? 'Analyzed' : 'AI pending'}</span>
                      {!done && (
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); runContextualBatchAnalysis(); }}
                          disabled={runningContextual}
                          style={{
                            marginLeft: '8px',
                            padding: '2px 6px',
                            fontSize: '7pt',
                            fontWeight: 'bold',
                            border: '1px solid #000',
                            background: runningContextual ? '#f0f0f0' : '#fff',
                            cursor: runningContextual ? 'not-allowed' : 'pointer',
                            textTransform: 'uppercase',
                            color: '#000'
                          }}
                          title="Run AI analysis on this evidence set"
                        >
                          {runningContextual ? 'Analyzing…' : 'Analyze'}
                        </button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
            {contextualError && (
              <div style={{ marginTop: '8px', fontSize: '7pt', color: '#a00' }}>
                {contextualError}
              </div>
            )}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: '8px'
            }}>
              {evidence.map(img => (
                <div 
                  key={img.id}
                  onClick={() => window.open(img.image_url, '_blank')}
                  style={{
                    aspectRatio: '1',
                    border: '1px solid #ccc',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    borderRadius: '2px',
                    transition: 'border 0.12s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.border = '2px solid #000';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.border = '1px solid #ccc';
                  }}
                >
                  <img 
                    src={img.image_url} 
                    alt="Evidence" 
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* WORK PERFORMED - Wireframe */}
        <div style={{ padding: '12px', borderBottom: '2px solid #000' }}>
          <div style={{ 
            fontSize: '8pt', 
            fontWeight: 'bold', 
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            WORK PERFORMED
          </div>
          <div style={{ fontSize: '9pt', lineHeight: '1.5' }}>
            {workOrder.title || workOrder.description || `${evidence.length} photos from ${workOrder.event_date ? new Date(workOrder.event_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'date unknown'}`}
          </div>
          {workOrder.description && workOrder.title && (
            <div style={{ fontSize: '8pt', marginTop: '4px', color: '#666', lineHeight: '1.5' }}>
              {workOrder.description}
            </div>
          )}
        </div>

        {/* CONTEXTUAL ANALYSIS (5 W's) */}
        {(() => {
          const ca = (baseEvent as any)?.metadata?.contextual_analysis;
          if (!ca) return null;

          const totalValue = typeof ca?.value_assessment?.total_event_value === 'number' ? ca.value_assessment.total_event_value : null;
          const valueConf = typeof ca?.value_assessment?.value_confidence === 'number' ? ca.value_assessment.value_confidence : null;
          const estHours =
            typeof ca?.when?.estimated_duration_hours === 'number' ? ca.when.estimated_duration_hours :
            typeof ca?.value_assessment?.labor_value?.estimated_hours === 'number' ? ca.value_assessment.labor_value.estimated_hours :
            null;

          return (
            <div style={{ padding: '12px', borderBottom: '2px solid #000', background: 'var(--bg)' }}>
              <div style={{
                fontSize: '8pt',
                fontWeight: 'bold',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                CONTEXTUAL ANALYSIS
              </div>

              <div style={{ fontSize: '8pt', lineHeight: 1.5 }}>
                {ca?.who?.primary_actor && (
                  <div><strong>WHO:</strong> {String(ca.who.primary_actor)}{ca?.who?.skill_level ? ` (${String(ca.who.skill_level)})` : ''}</div>
                )}
                {ca?.what?.work_performed && (
                  <div><strong>WHAT:</strong> {String(ca.what.work_performed)}</div>
                )}
                {(ca?.where?.work_location || ca?.where?.environment_quality) && (
                  <div><strong>WHERE:</strong> {[ca?.where?.work_location, ca?.where?.environment_quality].filter(Boolean).join(' • ')}</div>
                )}
                {(ca?.why?.primary_motivation || ca?.why?.preventive_vs_reactive) && (
                  <div><strong>WHY:</strong> {[ca?.why?.primary_motivation, ca?.why?.preventive_vs_reactive].filter(Boolean).join(' • ')}</div>
                )}
                {(estHours != null || totalValue != null) && (
                  <div style={{ marginTop: '6px' }}>
                    <strong>VALUE:</strong>{' '}
                    {estHours != null ? `${estHours.toFixed(1)}h` : ''}
                    {estHours != null && totalValue != null ? ' • ' : ''}
                    {totalValue != null ? `${formatCurrency(totalValue)}` : ''}
                    {valueConf != null ? ` • confidence ${Math.round(valueConf)}%` : ''}
                  </div>
                )}
              </div>

              {ca?.narrative_summary && (
                <div style={{ marginTop: '8px', fontSize: '8pt', color: '#666', lineHeight: 1.5 }}>
                  {String(ca.narrative_summary)}
                </div>
              )}
            </div>
          );
        })()}

        {/* AUCTION RECEIPT FORMAT - Special format for auction_sold events */}
        {((workOrder.event_type === 'auction_sold' || workOrder.event_type === 'sale') && auctionData?.sale_price) ? (
          <div style={{ padding: '12px', borderBottom: '2px solid #000' }}>
            <div style={{ 
              fontSize: '8pt', 
              fontWeight: 'bold', 
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              AUCTION SALE RECEIPT
            </div>

            {/* Parties Section */}
            <div style={{ marginBottom: '16px', padding: '8px', background: 'var(--bg)', border: '1px solid #ddd' }}>
              <div style={{ fontSize: '7pt', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase', color: '#666' }}>
                Parties
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '8pt' }}>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Seller</div>
                  <div style={{ color: '#666', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {auctionData.seller_profile_url ? (
                      <a 
                        href={auctionData.seller_profile_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ color: 'var(--primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <FaviconIcon url={auctionData.seller_profile_url} size={12} preserveAspectRatio={true} />
                        {auctionData.seller_username || auctionData.seller || 'Unknown'}
                      </a>
                    ) : (
                      <span>{auctionData.seller_username || auctionData.seller || 'Unknown'}</span>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>Buyer</div>
                  <div style={{ color: '#666', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {auctionData.buyer_profile_url ? (
                      <a 
                        href={auctionData.buyer_profile_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ color: 'var(--primary)', textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                      >
                        <FaviconIcon url={auctionData.buyer_profile_url} size={12} preserveAspectRatio={true} />
                        {auctionData.buyer_username || auctionData.buyer || 'Unknown'}
                      </a>
                    ) : (
                      <span>{auctionData.buyer_username || auctionData.buyer || 'Unknown'}</span>
                    )}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: '8px', fontSize: '7pt', color: '#666', display: 'flex', alignItems: 'center', gap: '4px' }}>
                Platform: 
                <FaviconIcon url="https://bringatrailer.com" size={12} preserveAspectRatio={true} />
                <strong>Bring a Trailer</strong>
                {auctionData.lot_number && ` • Lot #${auctionData.lot_number}`}
              </div>
            </div>

            {/* Financial Breakdown */}
            <div style={{ 
              fontSize: '8pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              FINANCIAL BREAKDOWN
            </div>
            
            {/* Table Header */}
            <div style={{ 
              display: 'grid',
              gridTemplateColumns: '2fr 120px',
              gap: '8px',
              paddingBottom: '4px',
              borderBottom: '1px solid #000',
              fontSize: '7pt',
              fontWeight: 'bold',
              marginBottom: '4px'
            }}>
              <div>Description</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
            </div>

            {/* Sale Price */}
            <div style={{ 
              display: 'grid',
              gridTemplateColumns: '2fr 120px',
              gap: '8px',
              padding: '6px 0',
              fontSize: '8pt',
              borderBottom: '1px dotted #ddd'
            }}>
              <div style={{ fontWeight: 'bold' }}>Sale Price</div>
              <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(auctionData.sale_price)}</div>
            </div>

            {/* Buyer's Fee (5% of sale price) */}
            {auctionData.sale_price && (() => {
              const buyerFee = auctionData.sale_price * 0.05;
              return (
                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: '2fr 120px',
                  gap: '8px',
                  padding: '6px 0',
                  fontSize: '8pt',
                  borderBottom: '1px dotted #ddd'
                }}>
                  <div>
                    Buyer's Fee (5% * est.)
                    <span style={{ fontSize: '6pt', color: '#666', marginLeft: '4px' }}>*estimated</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>{formatCurrency(buyerFee)}</div>
                </div>
              );
            })()}

            {/* Buyer's Total */}
            {auctionData.sale_price && (() => {
              const buyerFee = auctionData.sale_price * 0.05;
              const buyerTotal = auctionData.sale_price + buyerFee;
              return (
                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: '2fr 120px',
                  gap: '8px',
                  padding: '8px 0',
                  marginTop: '4px',
                  borderTop: '1px solid #000',
                  fontSize: '9pt',
                  fontWeight: 'bold'
                }}>
                  <div>BUYER'S TOTAL</div>
                  <div style={{ textAlign: 'right' }}>{formatCurrency(buyerTotal)}</div>
                </div>
              );
            })()}

            {/* Seller's Fee (BaT fee structure: 5% of first $5000, then 0%) */}
            {auctionData.sale_price && (() => {
              const sellerFee = Math.min(auctionData.sale_price, 5000) * 0.05;
              const sellerNet = auctionData.sale_price - sellerFee;
              return (
                <>
                  <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: '2fr 120px',
                    gap: '8px',
                    padding: '6px 0',
                    marginTop: '12px',
                    fontSize: '8pt',
                    borderBottom: '1px dotted #ddd'
                  }}>
                    <div>
                      Seller's Fee (BaT: 5% of first $5,000)
                      <span style={{ fontSize: '6pt', color: '#666', marginLeft: '4px' }}>*estimated</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>{formatCurrency(sellerFee)}</div>
                  </div>

                  {/* Seller's Net */}
                  <div style={{ 
                    display: 'grid',
                    gridTemplateColumns: '2fr 120px',
                    gap: '8px',
                    padding: '8px 0',
                    marginTop: '4px',
                    borderTop: '2px solid #000',
                    fontSize: '9pt',
                    fontWeight: 'bold'
                  }}>
                    <div>SELLER'S NET PROCEEDS</div>
                    <div style={{ textAlign: 'right' }}>{formatCurrency(sellerNet)}</div>
                  </div>
                </>
              );
            })()}
          </div>
        ) : (
          /* STANDARD COST BREAKDOWN - For non-auction events */
          (costBreakdown?.parts?.items?.length > 0 || costBreakdown?.labor?.tasks?.length > 0 || workOrder.cost_amount) && (
            <div style={{ padding: '12px', borderBottom: '2px solid #000' }}>
              <div style={{ 
                fontSize: '8pt', 
                fontWeight: 'bold', 
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                COST BREAKDOWN
              </div>
            
            {/* Table Header */}
            <div style={{ 
              display: 'grid',
              gridTemplateColumns: '2fr 60px 80px 100px',
              gap: '8px',
              paddingBottom: '4px',
              borderBottom: '1px solid #000',
              fontSize: '7pt',
              fontWeight: 'bold',
              marginBottom: '4px'
            }}>
              <div>Item</div>
              <div style={{ textAlign: 'right' }}>Qty</div>
              <div style={{ textAlign: 'right' }}>Unit</div>
              <div style={{ textAlign: 'right' }}>Total</div>
            </div>

            {/* Parts Items */}
            {costBreakdown?.parts?.items?.map(part => (
              <div 
                key={part.id}
                style={{ 
                  display: 'grid',
                  gridTemplateColumns: '2fr 60px 80px 100px',
                  gap: '8px',
                  padding: '4px 0',
                  fontSize: '8pt',
                  borderBottom: '1px dotted #ddd'
                }}
              >
                <div>
                  <div style={{ fontWeight: 'bold' }}>{part.name}</div>
                  {part.brand && (
                    <div style={{ fontSize: '6pt', color: '#666' }}>
                      {part.brand}{part.part_number && ` #${part.part_number}`}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>{part.quantity}</div>
                <div style={{ textAlign: 'right' }}>{formatCurrency(part.unit_price)}</div>
                <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(part.total_price)}</div>
              </div>
            ))}

            {/* Labor Items */}
            {costBreakdown?.labor?.tasks?.map(task => {
              const hasBothRates = task.reported_rate != null && task.calculated_rate != null && task.reported_rate !== task.calculated_rate;
              const rateSourceLabel = task.rate_source === 'contract' ? 'Contract' : 
                                     task.rate_source === 'user' ? 'User Rate' :
                                     task.rate_source === 'organization' ? 'Org Rate' : 'Estimate';
              
              return (
                <div 
                  key={task.id}
                  style={{ 
                    display: 'grid',
                    gridTemplateColumns: '2fr 60px 80px 100px',
                    gap: '8px',
                    padding: '4px 0',
                    fontSize: '8pt',
                    borderBottom: '1px dotted #ddd'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 'bold' }}>
                      {task.task} ({task.hours.toFixed(1)} hrs @ {formatCurrency(task.rate)}/hr)
                    </div>
                    {hasBothRates && (
                      <div style={{ fontSize: '6pt', color: '#666', marginTop: '2px' }}>
                        Reported: {formatCurrency(task.reported_rate)}/hr • Calculated: {formatCurrency(task.calculated_rate)}/hr ({rateSourceLabel})
                      </div>
                    )}
                    {!hasBothRates && task.rate_source && (
                      <div style={{ fontSize: '6pt', color: '#666', marginTop: '2px' }}>
                        {rateSourceLabel}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>{task.hours.toFixed(1)}</div>
                  <div style={{ textAlign: 'right' }}>{formatCurrency(task.rate)}</div>
                  <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(task.total)}</div>
                </div>
              );
            })}

            {/* Fallback if no detailed breakdown */}
            {(!costBreakdown?.parts?.items?.length && !costBreakdown?.labor?.tasks?.length) && workOrder.cost_amount && (
              <div style={{ 
                display: 'grid',
                gridTemplateColumns: '2fr 60px 80px 100px',
                gap: '8px',
                padding: '4px 0',
                fontSize: '8pt',
                borderBottom: '1px dotted #ddd'
              }}>
                <div>Work performed</div>
                <div style={{ textAlign: 'right' }}>-</div>
                <div style={{ textAlign: 'right' }}>-</div>
                <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{formatCurrency(workOrder.cost_amount)}</div>
              </div>
            )}

            {/* Total Row */}
            <div style={{ 
              display: 'grid',
              gridTemplateColumns: '2fr 60px 80px 100px',
              gap: '8px',
              paddingTop: '8px',
              marginTop: '8px',
              borderTop: '2px solid #000',
              fontSize: '9pt',
              fontWeight: 'bold'
            }}>
              <div>TOTAL</div>
              <div></div>
              <div></div>
              <div style={{ textAlign: 'right' }}>
                {formatCurrency(
                  costBreakdown?.calculated_total || 
                  workOrder.cost_amount || 
                  (costBreakdown?.parts?.total || 0) + (costBreakdown?.labor?.total || 0)
                )}
              </div>
            </div>
          </div>
          )
        )}


        {/* MATERIALS */}
        {costBreakdown?.materials?.items && costBreakdown.materials.items.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              MATERIALS & CONSUMABLES
            </div>
            {costBreakdown.materials.items.map(mat => (
              <div key={mat.id} style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                fontSize: '8pt',
                marginBottom: '4px'
              }}>
                <div>
                  {mat.name}
                  {mat.quantity && mat.unit && (
                    <span style={{ color: '#666', fontSize: '7pt' }}>
                      {' '}({mat.quantity} {mat.unit})
                    </span>
                  )}
                </div>
                <div>{formatCurrency(mat.total_cost)}</div>
              </div>
            ))}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              fontWeight: 'bold',
              paddingTop: '8px',
              borderTop: '1px solid #000',
              fontSize: '9pt'
            }}>
              <div>SUBTOTAL (Materials):</div>
              <div>{formatCurrency(costBreakdown.materials.total)}</div>
            </div>
          </div>
        )}

        {/* TOOLS */}
        {costBreakdown?.tools?.items && costBreakdown.tools.items.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              TOOLS USED (Depreciation)
            </div>
            {costBreakdown.tools.items.map(tool => (
              <div key={tool.id} style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                fontSize: '8pt',
                marginBottom: '4px'
              }}>
                <div>
                  Tool {tool.tool_id?.substring(0, 8) || 'Unknown'}
                  {tool.duration_minutes && (
                    <span style={{ color: '#666', fontSize: '7pt' }}>
                      {' '}({Math.floor(tool.duration_minutes / 60)}h {tool.duration_minutes % 60}m)
                    </span>
                  )}
                </div>
                <div>{formatCurrency(tool.depreciation_cost)}</div>
              </div>
            ))}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              fontWeight: 'bold',
              paddingTop: '8px',
              borderTop: '1px solid #000',
              fontSize: '9pt'
            }}>
              <div>SUBTOTAL (Tools):</div>
              <div>{formatCurrency(costBreakdown.tools.total)}</div>
            </div>
          </div>
        )}

        {/* OVERHEAD */}
        {costBreakdown?.overhead && costBreakdown.overhead.total_overhead && costBreakdown.overhead.total_overhead > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              OVERHEAD & FACILITY
            </div>
            {costBreakdown.overhead.facility_cost && costBreakdown.overhead.facility_cost > 0 && (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                fontSize: '8pt',
                marginBottom: '4px'
              }}>
                <div>
                  Facility Usage
                  {costBreakdown.overhead.facility_hours && costBreakdown.overhead.facility_rate && (
                    <span style={{ color: '#666', fontSize: '7pt' }}>
                      {' '}({costBreakdown.overhead.facility_hours.toFixed(1)} hrs @ {formatCurrency(costBreakdown.overhead.facility_rate)}/hr)
                    </span>
                  )}
                </div>
                <div>{formatCurrency(costBreakdown.overhead.facility_cost)}</div>
              </div>
            )}
            {costBreakdown.overhead.utilities_cost && costBreakdown.overhead.utilities_cost > 0 && (
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between',
                fontSize: '8pt',
                marginBottom: '4px'
              }}>
                <div>Utilities Allocation</div>
                <div>{formatCurrency(costBreakdown.overhead.utilities_cost)}</div>
              </div>
            )}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between',
              fontWeight: 'bold',
              paddingTop: '8px',
              borderTop: '1px solid #000',
              fontSize: '9pt'
            }}>
              <div>SUBTOTAL (Overhead):</div>
              <div>{formatCurrency(costBreakdown.overhead.total_overhead)}</div>
            </div>
          </div>
        )}

        {/* GENERATED INVOICE (drafts) */}
        <div style={{ padding: '16px', borderBottom: '1px solid #ddd', background: 'var(--bg)' }}>
          <div style={{
            fontSize: '9pt',
            fontWeight: 'bold',
            marginBottom: '8px',
            borderBottom: '1px solid #000',
            paddingBottom: '4px'
          }}>
            INVOICE (Draft)
          </div>

          {invoiceDraft ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', fontSize: '8pt' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800 }}>{invoiceDraft.invoice_number}</div>
                  <div style={{ fontSize: '7pt', color: '#666', marginTop: 2 }}>
                    {invoiceDraft.invoice_date ? `Date ${String(invoiceDraft.invoice_date).slice(0, 10)}` : 'Date unknown'}
                    {invoiceDraft.status ? ` • ${invoiceDraft.status}` : ''}
                    {invoiceDraft.payment_status ? ` • ${invoiceDraft.payment_status}` : ''}
                  </div>
                </div>
                <div style={{ fontWeight: 800, textAlign: 'right' }}>
                  {typeof (invoiceDraft as any).total_amount === 'number'
                    ? formatCurrency((invoiceDraft as any).total_amount)
                    : formatCurrency(invoiceDraft.total_amount as any)}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowInvoiceHtml((v) => !v); }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '8pt',
                    fontWeight: 'bold',
                    border: '1px solid #000',
                    background: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  {showInvoiceHtml ? 'Hide preview' : 'Preview'}
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open('/invoices', '_blank', 'noopener,noreferrer'); }}
                  style={{
                    padding: '4px 10px',
                    fontSize: '8pt',
                    fontWeight: 'bold',
                    border: '1px solid #000',
                    background: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  Open Invoice Manager
                </button>
              </div>

              {showInvoiceHtml && (
                <div style={{ marginTop: 12, border: '1px solid #ddd', background: '#fff', padding: 12 }}>
                  {invoiceDraft.html_content ? (
                    <div dangerouslySetInnerHTML={{ __html: invoiceDraft.html_content }} />
                  ) : (
                    <div style={{ fontSize: '8pt', color: '#666' }}>No HTML content generated yet.</div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: '8pt', color: '#666' }}>
                No invoice draft exists for this event yet.
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); generateDraftInvoice(); }}
                  disabled={generatingInvoice}
                  style={{
                    padding: '4px 10px',
                    fontSize: '8pt',
                    fontWeight: 'bold',
                    border: '1px solid #000',
                    background: generatingInvoice ? '#f0f0f0' : '#fff',
                    cursor: generatingInvoice ? 'not-allowed' : 'pointer'
                  }}
                >
                  {generatingInvoice ? 'Generating…' : 'Generate draft invoice (deterministic)'}
                </button>
              </div>
              {invoiceError && (
                <div style={{ marginTop: 8, fontSize: '7pt', color: '#a00' }}>
                  {invoiceError}
                </div>
              )}
            </>
          )}
        </div>

        {/* RECEIPT / INVOICE LINE ITEMS (uploaded documents) */}
        {receiptHeaders.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
            <div style={{
              fontSize: '9pt',
              fontWeight: 'bold',
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              UPLOADED RECEIPTS / INVOICES
            </div>

            {receiptHeaders.map((r) => {
              const items = receiptItems.filter((it) => it.receipt_id === r.id);
              const doc = eventDocuments.find((d) => d.document_id === (r.source_document_id || ''));
              const toNum = (v: any) => (typeof v === 'number' ? v : (v ? Number(v) : 0));
              const itemsTotal = items.reduce((sum, it) => sum + toNum(it.total_price), 0);
              const headerTotal = toNum(r.total) > 0 ? toNum(r.total) : itemsTotal;

              return (
                <div key={r.id} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '8pt', fontWeight: 'bold' }}>
                    <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.vendor_name || 'Receipt'}
                    </div>
                    <div style={{ textAlign: 'right' }}>{formatCurrency(headerTotal)}</div>
                  </div>

                  <div style={{ fontSize: '7pt', color: '#666', marginTop: '2px', lineHeight: 1.4 }}>
                    {[r.receipt_date ? `Date ${r.receipt_date}` : null, r.invoice_number ? `Invoice #${r.invoice_number}` : null].filter(Boolean).join(' • ')}
                    {doc?.file_url ? (
                      <>
                        {' • '}
                        <a href={doc.file_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>
                          View document
                        </a>
                      </>
                    ) : null}
                  </div>

                  {items.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 60px 80px 100px',
                        gap: '8px',
                        paddingBottom: '4px',
                        borderBottom: '1px solid #000',
                        fontSize: '7pt',
                        fontWeight: 'bold',
                        marginBottom: '4px'
                      }}>
                        <div>Item</div>
                        <div style={{ textAlign: 'right' }}>Qty</div>
                        <div style={{ textAlign: 'right' }}>Unit</div>
                        <div style={{ textAlign: 'right' }}>Total</div>
                      </div>

                      {items.map((it) => (
                        <div
                          key={it.id}
                          style={{
                            display: 'grid',
                            gridTemplateColumns: '2fr 60px 80px 100px',
                            gap: '8px',
                            padding: '4px 0',
                            fontSize: '8pt',
                            borderBottom: '1px dotted #ddd'
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 'bold' }}>{it.description || 'Line item'}</div>
                            {(it.category || it.part_number) && (
                              <div style={{ fontSize: '6pt', color: '#666' }}>
                                {[it.category, it.part_number ? `#${it.part_number}` : null].filter(Boolean).join(' ')}
                              </div>
                            )}
                          </div>
                          <div style={{ textAlign: 'right' }}>{it.quantity ?? '-'}</div>
                          <div style={{ textAlign: 'right' }}>{it.unit_price != null ? formatCurrency(Number(it.unit_price)) : '-'}</div>
                          <div style={{ textAlign: 'right', fontWeight: 'bold' }}>{it.total_price != null ? formatCurrency(Number(it.total_price)) : '-'}</div>
                        </div>
                      ))}

                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: '2fr 60px 80px 100px',
                        gap: '8px',
                        paddingTop: '8px',
                        marginTop: '8px',
                        borderTop: '2px solid #000',
                        fontSize: '9pt',
                        fontWeight: 'bold'
                      }}>
                        <div>SUBTOTAL (Receipt)</div>
                        <div></div>
                        <div></div>
                        <div style={{ textAlign: 'right' }}>{formatCurrency(headerTotal)}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TOTAL */}
        <div style={{ padding: '16px', borderBottom: '2px solid #000', backgroundColor: 'var(--bg)' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: '12pt',
            fontWeight: 'bold'
          }}>
            <div>TOTAL:</div>
            {(() => {
              const toNum = (v: any) => (typeof v === 'number' ? v : (v ? Number(v) : 0));
              const estimateTotal = toNum(costBreakdown?.calculated_total) || toNum(workOrder.cost_amount) || toNum(workOrder.calculated_total);
              const ledgerTotal = receiptHeaders.reduce((sum, r) => {
                const t = toNum((r as any).total);
                if (t > 0) return sum + t;
                const itemsFor = receiptItems.filter((it) => it.receipt_id === r.id);
                const itemsTotal = itemsFor.reduce((s, it) => s + toNum((it as any).total_price), 0);
                return sum + itemsTotal;
              }, 0);
              const eventReceiptTotal = toNum((baseEvent as any)?.receipt_amount);
              const actualTotal = ledgerTotal > 0 ? ledgerTotal : eventReceiptTotal;
              const primary = actualTotal > 0 ? actualTotal : estimateTotal;
              return <div>{formatCurrency(primary)}</div>;
            })()}
          </div>
          {(() => {
            const toNum = (v: any) => (typeof v === 'number' ? v : (v ? Number(v) : 0));
            const estimateTotal = toNum(costBreakdown?.calculated_total) || toNum(workOrder.cost_amount) || toNum(workOrder.calculated_total);
            const ledgerTotal = receiptHeaders.reduce((sum, r) => {
              const t = toNum((r as any).total);
              if (t > 0) return sum + t;
              const itemsFor = receiptItems.filter((it) => it.receipt_id === r.id);
              const itemsTotal = itemsFor.reduce((s, it) => s + toNum((it as any).total_price), 0);
              return sum + itemsTotal;
            }, 0);
            const eventReceiptTotal = toNum((baseEvent as any)?.receipt_amount);
            const actualTotal = ledgerTotal > 0 ? ledgerTotal : eventReceiptTotal;
            if (estimateTotal <= 0 && actualTotal <= 0) return null;

            const hasBoth = estimateTotal > 0 && actualTotal > 0;
            const delta = hasBoth ? (actualTotal - estimateTotal) : 0;

            return (
              <div style={{ marginTop: '6px', fontSize: '7pt', color: '#666', textAlign: 'right', lineHeight: 1.5 }}>
                {estimateTotal > 0 && <div>Estimate: {formatCurrency(estimateTotal)}</div>}
                {actualTotal > 0 && <div>Actual: {formatCurrency(actualTotal)}</div>}
                {hasBoth && delta !== 0 && <div>Delta: {formatCurrency(delta)}</div>}
              </div>
            );
          })()}
          {workOrder.ai_confidence_score && (
            <div style={{ fontSize: '7pt', color: '#666', marginTop: '4px', textAlign: 'right' }}>
              Confidence: {(workOrder.ai_confidence_score * 100).toFixed(0)}%
            </div>
          )}
        </div>

        {/* QUALITY & VALUE */}
        {(workOrder.quality_rating || workOrder.value_impact) && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              QUALITY ASSESSMENT
            </div>
            {workOrder.quality_rating && (
              <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                <strong>Rating:</strong> {workOrder.quality_rating}/10
              </div>
            )}
            {workOrder.quality_justification && (
              <div style={{ fontSize: '8pt', marginBottom: '8px', color: '#666' }}>
                {workOrder.quality_justification}
              </div>
            )}
            {workOrder.value_impact && (
              <div style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                Estimated Value Added: {formatCurrency(workOrder.value_impact)}
              </div>
            )}
          </div>
        )}

        {/* CONCERNS */}
        {workOrder.concerns && workOrder.concerns.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd', backgroundColor: '#fff3cd' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px',
              color: '#856404'
            }}>
              CONCERNS FLAGGED
            </div>
            {workOrder.concerns.map((concern, idx) => (
              <div key={idx} style={{ fontSize: '8pt', marginBottom: '4px', color: '#856404' }}>
                • {concern}
              </div>
            ))}
          </div>
        )}

        {/* FOOTER */}
        {/* ESC TO CLOSE - Wireframe Footer */}
        <div style={{ 
          padding: '12px', 
          textAlign: 'center',
          borderTop: '2px solid #000',
          backgroundColor: 'var(--bg)',
          fontSize: '7pt',
          color: '#666'
        }}>
          [ESC TO CLOSE]
        </div>
      </div>
    </div>,
    document.body
  );
};

