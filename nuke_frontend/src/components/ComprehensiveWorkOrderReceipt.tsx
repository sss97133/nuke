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
  rate: number;
  total: number;
  difficulty?: number;
  industry_standard?: number;
  ai_estimated?: boolean;
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

export const ComprehensiveWorkOrderReceipt: React.FC<ComprehensiveWorkOrderReceiptProps> = ({ eventId, onClose }) => {
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

      // 4. Get evidence (photos)
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
    >
      <div 
        style={{
          background: '#fff',
          width: '100%',
          maxWidth: '900px',
          maxHeight: '95vh',
          overflow: 'auto',
          border: '2px solid #000',
          fontFamily: 'Courier New, monospace',
          fontSize: '9pt'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER */}
        <div style={{
          padding: '16px',
          borderBottom: '2px solid #000',
          backgroundColor: '#f5f5f5'
        }}>
          <div style={{ 
            fontSize: '14pt', 
            fontWeight: 'bold', 
            marginBottom: '8px',
            textAlign: 'center' 
          }}>
            WORK ORDER RECEIPT
          </div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: '8pt'
          }}>
            <div>
              <div>Order #{workOrder.id?.substring(0, 12).toUpperCase() || 'N/A'}</div>
              <div>{workOrder.event_date ? formatDate(workOrder.event_date) : 'Date unknown'}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {workOrder.service_provider_name && (
                <div style={{ fontWeight: 'bold' }}>{workOrder.service_provider_name}</div>
              )}
            </div>
          </div>
        </div>

        {/* ATTRIBUTION SECTION */}
        <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
          <div style={{ 
            fontSize: '9pt', 
            fontWeight: 'bold', 
            marginBottom: '8px',
            borderBottom: '1px solid #000',
            paddingBottom: '4px'
          }}>
            ATTRIBUTION
          </div>

          {deviceAttribution.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '7pt', color: '#666' }}>DOCUMENTED BY:</div>
              {deviceAttribution.map((dev, idx) => (
                <div key={idx} style={{ fontSize: '8pt', marginLeft: '8px' }}>
                  Device: {dev.device_fingerprint}
                  {dev.uploaded_by && ` | Uploaded by User ${dev.uploaded_by.substring(0, 8)}`}
                </div>
              ))}
            </div>
          )}

          {workOrder.service_provider_name && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '7pt', color: '#666' }}>PERFORMED BY:</div>
              <div style={{ fontSize: '8pt', marginLeft: '8px', fontWeight: 'bold' }}>
                {workOrder.service_provider_name}
              </div>
            </div>
          )}

          {participants.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '7pt', color: '#666' }}>PARTICIPANTS:</div>
              {participants.map(p => (
                <div key={p.id} style={{ fontSize: '8pt', marginLeft: '8px' }}>
                  • {p.name || 'Unknown'} ({p.role})
                  {p.company && ` - ${p.company}`}
                </div>
              ))}
            </div>
          )}

          {participants.length === 0 && !deviceAttribution.length && (
            <div style={{ fontSize: '8pt', color: '#999', fontStyle: 'italic' }}>
              ⚠ Attribution incomplete - no documented participants
            </div>
          )}
        </div>

        {/* EVIDENCE SET */}
        {evidence.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd', backgroundColor: '#fafafa' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              EVIDENCE SET ({evidence.length} photos)
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
              gap: '8px'
            }}>
              {evidence.map(img => (
                <div 
                  key={img.id}
                  style={{
                    aspectRatio: '1',
                    border: '1px solid #ccc',
                    overflow: 'hidden',
                    cursor: 'pointer'
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

        {/* WORK PERFORMED */}
        <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
          <div style={{ 
            fontSize: '9pt', 
            fontWeight: 'bold', 
            marginBottom: '8px',
            borderBottom: '1px solid #000',
            paddingBottom: '4px'
          }}>
            WORK PERFORMED
          </div>
          <div style={{ fontSize: '9pt' }}>
            {workOrder.title || 'Untitled work order'}
          </div>
          {workOrder.description && (
            <div style={{ fontSize: '8pt', marginTop: '4px', color: '#666' }}>
              {workOrder.description}
            </div>
          )}
        </div>

        {/* PARTS & MATERIALS */}
        {costBreakdown?.parts?.items && costBreakdown.parts.items.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              PARTS & COMPONENTS
            </div>
            {costBreakdown.parts.items.map(part => (
              <div key={part.id} style={{ 
                marginBottom: '8px',
                paddingBottom: '8px',
                borderBottom: '1px dotted #ddd'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  fontSize: '8pt'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{part.name}</div>
                    {part.brand && (
                      <div style={{ fontSize: '7pt', color: '#666' }}>
                        {part.brand}
                        {part.part_number && ` #${part.part_number}`}
                      </div>
                    )}
                    {part.supplier && (
                      <div style={{ fontSize: '7pt', color: '#666' }}>
                        {part.supplier} | Qty: {part.quantity}
                      </div>
                    )}
                    {part.ai_extracted && (
                      <div style={{ fontSize: '6pt', color: '#999', marginTop: '2px' }}>
                        ⚙ AI-extracted
                      </div>
                    )}
                  </div>
                  <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', marginLeft: '16px' }}>
                    {formatCurrency(part.total_price)}
                  </div>
                </div>
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
              <div>SUBTOTAL (Parts):</div>
              <div>{formatCurrency(costBreakdown.parts.total)}</div>
            </div>
          </div>
        )}

        {/* LABOR BREAKDOWN */}
        {costBreakdown?.labor?.tasks && costBreakdown.labor.tasks.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #ddd' }}>
            <div style={{ 
              fontSize: '9pt', 
              fontWeight: 'bold', 
              marginBottom: '8px',
              borderBottom: '1px solid #000',
              paddingBottom: '4px'
            }}>
              LABOR BREAKDOWN
            </div>
            {costBreakdown.labor.tasks.map(task => (
              <div key={task.id} style={{ 
                marginBottom: '8px',
                paddingBottom: '8px',
                borderBottom: '1px dotted #ddd'
              }}>
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between',
                  fontSize: '8pt'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 'bold' }}>{task.task}</div>
                    <div style={{ fontSize: '7pt', color: '#666' }}>
                      {task.hours.toFixed(1)} hrs @ {formatCurrency(task.rate)}/hr
                      {task.category && ` | ${task.category}`}
                      {task.difficulty && ` | Difficulty: ${task.difficulty}/10`}
                    </div>
                    {task.industry_standard && (
                      <div style={{ fontSize: '7pt', color: task.hours <= task.industry_standard * 1.1 ? '#090' : '#c60' }}>
                        Industry Standard: {task.industry_standard.toFixed(1)} hrs
                        {task.hours > task.industry_standard * 1.1 && ' ⚠'}
                      </div>
                    )}
                    {task.ai_estimated && (
                      <div style={{ fontSize: '6pt', color: '#999', marginTop: '2px' }}>
                        ⚙ AI-estimated
                      </div>
                    )}
                  </div>
                  <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', marginLeft: '16px' }}>
                    {formatCurrency(task.total)}
                  </div>
                </div>
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
              <div>SUBTOTAL (Labor): {costBreakdown.labor.hours.toFixed(1)} hrs</div>
              <div>{formatCurrency(costBreakdown.labor.total)}</div>
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
        <div style={{ 
          padding: '12px', 
          display: 'flex', 
          justifyContent: 'flex-end',
          backgroundColor: '#f5f5f5'
        }}>
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
      </div>
    </div>,
    document.body
  );
};

