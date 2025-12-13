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
}

export const ComprehensiveWorkOrderReceipt: React.FC<ComprehensiveWorkOrderReceiptProps> = ({ eventId, onClose, onNavigate }) => {
  const [loading, setLoading] = useState(true);
  const [workOrder, setWorkOrder] = useState<WorkOrder | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [deviceAttribution, setDeviceAttribution] = useState<DeviceAttribution[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [costBreakdown, setCostBreakdown] = useState<{
    parts: { items: Part[], total: number },
    labor: { tasks: LaborTask[], total: number, hours: number },
    materials: { items: Material[], total: number },
    tools: { items: Tool[], total: number },
    overhead: Overhead
  } | null>(null);
  const [adjacentEvents, setAdjacentEvents] = useState<{ prev: string | null, next: string | null }>({ prev: null, next: null });

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    setLoading(true);
    try {
      // 1. Try comprehensive view first, fallback to timeline_events
      let wo: WorkOrder | null = null;
      
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
          setLoading(false);
          return;
        }
        
        // Map timeline_events to WorkOrder shape
        wo = {
          id: eventData.id,
          title: eventData.title,
          description: eventData.description,
          event_date: eventData.event_date,
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
          calculated_total: eventData.cost_amount || 0
        } as WorkOrder;
      } else {
        wo = viewData;
      }
      
      setWorkOrder(wo);

      // 2. Get participants
      const { data: partsData } = await supabase
        .rpc('get_event_participants_detailed', { p_event_id: eventId });
      
      if (partsData) {
        setParticipants(partsData);
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
      if (wo?.vehicle_id && wo?.event_date) {
        const { data: imgs } = await supabase
          .from('vehicle_images')
          .select('id, image_url, taken_at')
          .eq('vehicle_id', wo.vehicle_id)
          .gte('taken_at', new Date(wo.event_date).toISOString().split('T')[0])
          .lte('taken_at', new Date(new Date(wo.event_date).getTime() + 24*60*60*1000).toISOString().split('T')[0])
          .order('taken_at', { ascending: true });
        
        setEvidence(imgs || []);
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
        <div style={{ 
          background: '#fff', 
          padding: '24px', 
          border: '2px solid #000',
          maxWidth: '400px'
        }}>
          <div style={{ fontSize: '10pt', marginBottom: '16px' }}>
            Could not load work order data. Please try again.
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 'bold',
              backgroundColor: '#fff',
              border: '2px solid #000',
              cursor: 'pointer'
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
          background: '#fff',
          width: '100%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid #000',
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
          backgroundColor: '#f5f5f5'
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
          background: '#fafafa',
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
                    background: '#f0f0f0',
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
              backgroundColor: '#fafafa' 
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
                {workOrder.ai_confidence_score ? (
                  <>
                    <span>✓</span>
                    <span>Analyzed</span>
                  </>
                ) : (
                  <>
                    <span>Processing</span>
                    <span>AI pending</span>
                  </>
                )}
              </div>
            </div>
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

        {/* COST BREAKDOWN - Wireframe Table Format */}
        {(costBreakdown?.parts?.items?.length > 0 || costBreakdown?.labor?.tasks?.length > 0 || workOrder.cost_amount) && (
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

        {/* TOTAL */}
        <div style={{ padding: '16px', borderBottom: '2px solid #000', backgroundColor: '#f5f5f5' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: '12pt',
            fontWeight: 'bold'
          }}>
            <div>TOTAL:</div>
            <div>{formatCurrency(workOrder.calculated_total)}</div>
          </div>
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
              ⚠ CONCERNS FLAGGED
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
          backgroundColor: '#f5f5f5',
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

