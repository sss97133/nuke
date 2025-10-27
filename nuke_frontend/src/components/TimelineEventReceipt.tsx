import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../lib/supabase';

interface TimelineEventReceiptProps {
  eventId: string;
  onClose: () => void;
}

interface Event {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  event_type: string;
  mileage_at_event?: number;
  cost_amount?: number;
  duration_hours?: number;
  service_provider_name?: string;
  service_provider_type?: string;
  location_name?: string;
  location_address?: string;
  parts_used?: any[];
  invoice_number?: string;
  metadata?: any;
  user_id?: string;
}

export const TimelineEventReceipt: React.FC<TimelineEventReceiptProps> = ({ eventId, onClose }) => {
  const [event, setEvent] = useState<Event | null>(null);
  const [images, setImages] = useState<any[]>([]);
  const [uploaderName, setUploaderName] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEventData();
  }, [eventId]);

  const loadEventData = async () => {
    const [eventResult, imagesResult] = await Promise.all([
      supabase
        .from('timeline_events')
        .select('*')
        .eq('id', eventId)
        .single(),
      supabase
        .from('vehicle_images')
        .select('*')
        .contains('event_id', eventId)
        .order('taken_at', { ascending: true })
    ]);

    if (eventResult.data) {
      setEvent(eventResult.data);
      
      // Load uploader name
      if (eventResult.data.user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, username')
          .eq('id', eventResult.data.user_id)
          .single();
        
        setUploaderName(profile?.full_name || profile?.username || 'Unknown');
      }
    }
    
    if (imagesResult.data) {
      setImages(imagesResult.data);
    }

    setLoading(false);
  };

  const formatCurrency = (amount?: number) => {
    if (!amount) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  if (loading || !event) {
    return createPortal(
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}>
        <div style={{ color: '#fff', fontSize: '10pt' }}>Loading...</div>
      </div>,
      document.body
    );
  }

  const partsTotal = event.parts_used?.reduce((sum: number, part: any) => sum + (part.cost || 0), 0) || 0;
  const laborCost = event.duration_hours && event.metadata?.labor_rate 
    ? event.duration_hours * event.metadata.labor_rate 
    : 0;
  const totalCost = event.cost_amount || partsTotal + laborCost;

  return (
    <div 
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: '#ffffff',
          width: '100%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid #000',
          borderRadius: '0px',
          fontFamily: 'Arial, sans-serif'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* RECEIPT HEADER */}
        <div style={{
          padding: '16px',
          borderBottom: '4px double #000',
          background: '#f5f5f5'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '12px' }}>
            <div style={{ fontSize: '14pt', fontWeight: 700, letterSpacing: '1px' }}>
              WORK ORDER / SERVICE RECEIPT
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '4px' }}>
              Event ID: {event.id.slice(0, 8).toUpperCase()}
            </div>
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '12px',
            fontSize: '8pt' 
          }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>DATE:</div>
              <div>{formatDate(event.event_date)}</div>
            </div>
            {event.mileage_at_event && (
              <div>
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>MILEAGE:</div>
                <div>{event.mileage_at_event.toLocaleString()} miles</div>
              </div>
            )}
          </div>
        </div>

        {/* SERVICE PROVIDER / WHO DID THE WORK */}
        <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
          <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
            PERFORMED BY:
          </div>
          <div style={{ fontSize: '8pt' }}>
            {event.service_provider_name || uploaderName || 'Owner/DIY'}
            {event.service_provider_type && (
              <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                {event.service_provider_type.replace('_', ' ').toUpperCase()}
              </div>
            )}
            {event.location_name && (
              <div style={{ marginTop: '4px' }}>
                📍 {event.location_name}
                {event.location_address && <div style={{ color: 'var(--text-secondary)' }}>{event.location_address}</div>}
              </div>
            )}
          </div>
        </div>

        {/* WORK PERFORMED */}
        <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
          <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
            WORK PERFORMED:
          </div>
          <div style={{ fontSize: '8pt', marginBottom: '8px', padding: '8px', background: '#f9f9f9' }}>
            <div style={{ fontWeight: 700 }}>{event.title}</div>
            {event.description && (
              <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
                {event.description}
              </div>
            )}
          </div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Type: {event.event_type.replace('_', ' ')}
          </div>
        </div>

        {/* PARTS & MATERIALS */}
        {event.parts_used && event.parts_used.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              PARTS & MATERIALS:
            </div>
            <table style={{ width: '100%', fontSize: '8pt', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #bdbdbd' }}>
                  <th style={{ textAlign: 'left', padding: '4px', fontWeight: 700 }}>QTY</th>
                  <th style={{ textAlign: 'left', padding: '4px', fontWeight: 700 }}>PART/ITEM</th>
                  <th style={{ textAlign: 'right', padding: '4px', fontWeight: 700 }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {event.parts_used.map((part: any, idx: number) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #ebebeb' }}>
                    <td style={{ padding: '4px' }}>{part.quantity || 1}</td>
                    <td style={{ padding: '4px' }}>
                      {part.name || part}
                      {part.part_number && <span style={{ color: 'var(--text-muted)' }}> #{part.part_number}</span>}
                    </td>
                    <td style={{ padding: '4px', textAlign: 'right' }}>
                      {formatCurrency(part.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #000', fontWeight: 700 }}>
                  <td colSpan={2} style={{ padding: '6px 4px' }}>PARTS SUBTOTAL:</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatCurrency(partsTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* LABOR */}
        {event.duration_hours && (
          <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              LABOR:
            </div>
            <div style={{ fontSize: '8pt', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span>Hours worked:</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{event.duration_hours.toFixed(1)} hrs</span>
            </div>
            {event.metadata?.labor_rate && (
              <>
                <div style={{ fontSize: '8pt', display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span>Shop rate:</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{formatCurrency(event.metadata.labor_rate)}/hr</span>
                </div>
                <div style={{ fontSize: '9pt', display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #bdbdbd' }}>
                  <span>LABOR SUBTOTAL:</span>
                  <span>{formatCurrency(laborCost)}</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* TOTAL */}
        <div style={{ padding: '16px', borderBottom: '4px double #000', background: '#f5f5f5' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            fontSize: '13pt', 
            fontWeight: 700,
            marginBottom: '8px'
          }}>
            <span>TOTAL COST:</span>
            <span>{formatCurrency(totalCost)}</span>
          </div>
          {event.metadata?.payment_method && (
            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Payment: {event.metadata.payment_method}
            </div>
          )}
          {event.invoice_number && (
            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Invoice #: {event.invoice_number}
            </div>
          )}
        </div>

        {/* VALUE IMPACT */}
        {event.metadata?.value_impact && (
          <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd', background: '#f9f9f9' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              VALUE IMPACT:
            </div>
            <div style={{ 
              fontSize: '10pt', 
              fontWeight: 700,
              color: event.metadata.value_impact > 0 ? '#10b981' : '#ef4444'
            }}>
              {event.metadata.value_impact > 0 ? '+' : ''}{formatCurrency(event.metadata.value_impact)}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
              {event.metadata.value_impact > 0 ? 'Increased' : 'Decreased'} vehicle value
            </div>
          </div>
        )}

        {/* PHOTOS */}
        {images.length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              DOCUMENTATION ({images.length} photos):
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))', 
              gap: '8px' 
            }}>
              {images.slice(0, 12).map((img) => (
                <div
                  key={img.id}
                  style={{
                    width: '100%',
                    paddingBottom: '100%',
                    background: `url(${img.image_url}) center/cover`,
                    border: '1px solid #bdbdbd',
                    borderRadius: '0px',
                    cursor: 'pointer'
                  }}
                  onClick={() => window.open(img.image_url, '_blank')}
                />
              ))}
            </div>
            {images.length > 12 && (
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '8px' }}>
                +{images.length - 12} more photos
              </div>
            )}
          </div>
        )}

        {/* NOTES */}
        {event.metadata?.notes && (
          <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              NOTES:
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {event.metadata.notes}
            </div>
          </div>
        )}

        {/* FOOTER / ACTIONS */}
        <div style={{ padding: '12px', background: '#f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
            Press ESC to close
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '6px 12px',
              border: '2px solid var(--text)',
              background: 'var(--surface)',
              color: 'var(--text)',
              fontSize: '9pt',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: '0px',
              transition: 'all 0.12s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--text)';
              e.currentTarget.style.color = 'var(--surface)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--surface)';
              e.currentTarget.style.color = 'var(--text)';
            }}
          >
            Close
          </button>
        </div>

        {/* Missing data prompts */}
        {(!event.cost_amount && !event.duration_hours && !event.parts_used) && (
          <div style={{
            padding: '16px',
            background: '#fffbeb',
            border: '2px solid #f59e0b',
            margin: '16px',
            borderRadius: '0px'
          }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '4px' }}>
              ⚠️ Incomplete Work Order
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)' }}>
              Add cost, labor hours, or parts to complete this receipt
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineEventReceipt;

