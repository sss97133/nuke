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
  const [receiptItems, setReceiptItems] = useState<any[]>([]);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('pending');
  const [extractionConfidence, setExtractionConfidence] = useState<number | null>(null);
  const [showPerformerCard, setShowPerformerCard] = useState(false);
  const [performerProfile, setPerformerProfile] = useState<any>(null);
  const [showLocationCard, setShowLocationCard] = useState(false);
  const [locationDetails, setLocationDetails] = useState<any>(null);

  useEffect(() => {
    loadEventData();
  }, [eventId]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const loadEventData = async () => {
    const [eventResult, imagesResult] = await Promise.all([
      supabase
        .from('vehicle_timeline_events')
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
          .select('full_name, username, avatar_url, bio')
          .eq('id', eventResult.data.user_id)
          .single();
        
        setUploaderName(profile?.full_name || profile?.username || 'Unknown');
        setPerformerProfile({ ...profile, id: eventResult.data.user_id, type: 'user' });
      }

      // Load shop/location details if present
      if (eventResult.data.service_provider_name || eventResult.data.location_name) {
        // Try to find matching shop
        const { data: shop } = await supabase
          .from('shops')
          .select('id, business_name, name, phone, email, address_line1, city, state, latitude, longitude, logo_url')
          .or(`business_name.ilike.%${eventResult.data.service_provider_name}%,name.ilike.%${eventResult.data.service_provider_name}%`)
          .limit(1)
          .maybeSingle();

        if (shop) {
          setLocationDetails({ ...shop, type: 'shop' });
        } else {
          setLocationDetails({
            type: 'location',
            name: eventResult.data.location_name || eventResult.data.service_provider_name,
            address: eventResult.data.location_address
          });
        }
      }

      // Check if this event has an associated document (receipt)
      if (eventResult.data.metadata?.document_id) {
        const docId = eventResult.data.metadata.document_id;
        setDocumentId(docId);

        // Load document processing status
        const { data: document } = await supabase
          .from('vehicle_documents')
          .select('ai_processing_status, ai_extraction_confidence')
          .eq('id', docId)
          .single();

        if (document) {
          setProcessingStatus(document.ai_processing_status || 'pending');
          setExtractionConfidence(document.ai_extraction_confidence);
        }

        // Load extracted receipt items via receipts table
        const { data: receipt } = await supabase
          .from('receipts')
          .select('id')
          .eq('document_id', docId)
          .maybeSingle();

        if (receipt) {
          const { data: items } = await supabase
            .from('receipt_items')
            .select('*')
            .eq('receipt_id', receipt.id)
            .order('created_at', { ascending: true });

          if (items && items.length > 0) {
            setReceiptItems(items);
          }
        }
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

  // Calculate totals from extracted receipt items OR fallback to event data
  const extractedPartsTotal = receiptItems
    .filter(item => item.category === 'part')
    .reduce((sum, item) => sum + (item.line_total || item.total_price || 0), 0);
  const extractedLaborTotal = receiptItems
    .filter(item => item.category === 'labor')
    .reduce((sum, item) => sum + (item.line_total || item.total_price || 0), 0);
  const extractedTaxTotal = receiptItems
    .filter(item => item.category === 'tax')
    .reduce((sum, item) => sum + (item.line_total || item.total_price || 0), 0);
  const extractedTotal = receiptItems.reduce((sum, item) => sum + (item.line_total || item.total_price || 0), 0);

  // Fallback to manual event data if no extraction
  const manualPartsTotal = event.parts_used?.reduce((sum: number, part: any) => sum + (part.cost || 0), 0) || 0;
  const manualLaborCost = event.duration_hours && event.metadata?.labor_rate 
    ? event.duration_hours * event.metadata.labor_rate 
    : 0;
  
  const partsTotal = receiptItems.length > 0 ? extractedPartsTotal : manualPartsTotal;
  const laborCost = receiptItems.length > 0 ? extractedLaborTotal : manualLaborCost;
  const totalCost = receiptItems.length > 0 ? extractedTotal : (event.cost_amount || manualPartsTotal + manualLaborCost);

  return createPortal(
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
        <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd', position: 'relative' }}>
          <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
            PERFORMED BY:
          </div>
          <div style={{ fontSize: '8pt' }}>
            <span
              onClick={() => performerProfile && setShowPerformerCard(!showPerformerCard)}
              style={{
                cursor: performerProfile ? 'pointer' : 'default',
                textDecoration: performerProfile ? 'underline' : 'none',
                textDecorationStyle: 'dotted',
                fontWeight: 700
              }}
            >
              {event.service_provider_name || uploaderName || 'Owner/DIY'}
            </span>
            {event.service_provider_type && (
              <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                {event.service_provider_type.replace('_', ' ').toUpperCase()}
              </div>
            )}
            {event.location_name && (
              <div style={{ marginTop: '4px' }}>
                <span
                  onClick={() => locationDetails && setShowLocationCard(!showLocationCard)}
                  style={{
                    cursor: locationDetails ? 'pointer' : 'default',
                    textDecoration: locationDetails ? 'underline' : 'none',
                    textDecorationStyle: 'dotted'
                  }}
                >
                  📍 {event.location_name}
                </span>
                {event.location_address && <div style={{ color: 'var(--text-secondary)' }}>{event.location_address}</div>}
              </div>
            )}

            {/* Performer Mini-Profile Card */}
            {showPerformerCard && performerProfile && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '16px',
                zIndex: 10001,
                background: 'var(--white)',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                boxShadow: 'var(--shadow)',
                padding: '12px',
                minWidth: '240px',
                marginTop: '4px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <img
                    src={performerProfile.avatar_url || performerProfile.logo_url || '/default-avatar.png'}
                    alt={performerProfile.full_name || performerProfile.business_name}
                    style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '9pt' }}>
                      {performerProfile.full_name || performerProfile.business_name || performerProfile.name}
                    </div>
                    {performerProfile.username && (
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>@{performerProfile.username}</div>
                    )}
                  </div>
                </div>
                {performerProfile.bio && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginBottom: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '8px' }}>
                    {performerProfile.bio}
                  </div>
                )}
                {performerProfile.phone && (
                  <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                    📞 {performerProfile.phone}
                  </div>
                )}
                {performerProfile.email && (
                  <div style={{ fontSize: '8pt', marginBottom: '8px' }}>
                    ✉️ {performerProfile.email}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '8px' }}>
                  <button
                    onClick={() => {
                      window.location.href = performerProfile.type === 'shop' 
                        ? `/org/${performerProfile.id}`
                        : `/profile/${performerProfile.id}`;
                    }}
                    className="button button-primary button-small"
                    style={{ fontSize: '8pt', flex: 1 }}
                  >
                    View Profile
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowPerformerCard(false);
                    }}
                    className="button button-secondary button-small"
                    style={{ fontSize: '8pt' }}
                  >
                    Close
                  </button>
                </div>
              </div>
            )}

            {/* Location Mini-Profile Card */}
            {showLocationCard && locationDetails && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '16px',
                zIndex: 10001,
                background: 'var(--white)',
                border: '2px solid var(--border)',
                borderRadius: '4px',
                boxShadow: 'var(--shadow)',
                padding: '12px',
                minWidth: '240px',
                marginTop: '4px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  {locationDetails.logo_url && (
                    <img
                      src={locationDetails.logo_url}
                      alt={locationDetails.business_name || locationDetails.name}
                      style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '9pt' }}>
                      {locationDetails.business_name || locationDetails.name}
                    </div>
                    {locationDetails.type === 'shop' && (
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Business</div>
                    )}
                  </div>
                </div>
                {locationDetails.address_line1 && (
                  <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                    📍 {locationDetails.address_line1}
                    {locationDetails.city && locationDetails.state && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        {locationDetails.city}, {locationDetails.state}
                      </div>
                    )}
                  </div>
                )}
                {locationDetails.phone && (
                  <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                    📞 {locationDetails.phone}
                  </div>
                )}
                {locationDetails.email && (
                  <div style={{ fontSize: '8pt', marginBottom: '8px' }}>
                    ✉️ {locationDetails.email}
                  </div>
                )}
                {locationDetails.type === 'shop' && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px', borderTop: '1px solid var(--border-light)', paddingTop: '8px' }}>
                    <button
                      onClick={() => window.location.href = `/org/${locationDetails.id}`}
                      className="button button-primary button-small"
                      style={{ fontSize: '8pt', flex: 1 }}
                    >
                      View Shop
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowLocationCard(false);
                      }}
                      className="button button-secondary button-small"
                      style={{ fontSize: '8pt' }}
                    >
                      Close
                    </button>
                  </div>
                )}
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

        {/* AI EXTRACTION STATUS */}
        {documentId && processingStatus === 'processing' && (
          <div style={{
            padding: '12px 16px',
            background: '#e0f2fe',
            border: '1px solid #0ea5e9',
            margin: '0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '8pt'
          }}>
            <div className="spinner" style={{ width: '12px', height: '12px', border: '2px solid #0ea5e9', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span>🤖 AI is extracting receipt data...</span>
          </div>
        )}

        {documentId && processingStatus === 'completed' && extractionConfidence && (
          <div style={{
            padding: '12px 16px',
            background: '#d1fae5',
            border: '1px solid #10b981',
            margin: '0',
            fontSize: '8pt',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>✅ AI extraction complete</span>
            <span style={{ color: 'var(--text-muted)' }}>Confidence: {Math.round(extractionConfidence * 100)}%</span>
          </div>
        )}

        {/* PARTS & MATERIALS - AI EXTRACTED */}
        {receiptItems.filter(item => item.category === 'part').length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              PARTS & MATERIALS:
              {receiptItems.some(item => item.extracted_by_ai) && (
                <span style={{ fontSize: '7pt', marginLeft: '8px', padding: '2px 6px', background: '#dbeafe', border: '1px solid #3b82f6', borderRadius: '2px' }}>
                  🤖 AI-extracted
                </span>
              )}
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
                {receiptItems
                  .filter(item => item.category === 'part')
                  .map((item: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #ebebeb' }}>
                      <td style={{ padding: '4px' }}>{item.quantity || 1}</td>
                      <td style={{ padding: '4px' }}>
                        {item.description}
                        {item.part_number && <span style={{ color: 'var(--text-muted)' }}> #{item.part_number}</span>}
                        {item.brand && <div style={{ fontSize: '7pt', color: 'var(--text-muted)' }}>{item.brand}</div>}
                      </td>
                      <td style={{ padding: '4px', textAlign: 'right' }}>
                        {formatCurrency(item.line_total || item.total_price || item.unit_price || 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #000', fontWeight: 700 }}>
                  <td colSpan={2} style={{ padding: '6px 4px' }}>PARTS SUBTOTAL:</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatCurrency(extractedPartsTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* PARTS & MATERIALS - FALLBACK TO MANUAL */}
        {receiptItems.length === 0 && event.parts_used && event.parts_used.length > 0 && (
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
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatCurrency(manualPartsTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* LABOR - AI EXTRACTED */}
        {receiptItems.filter(item => item.category === 'labor').length > 0 && (
          <div style={{ padding: '16px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px' }}>
              LABOR:
            </div>
            <table style={{ width: '100%', fontSize: '8pt', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #bdbdbd' }}>
                  <th style={{ textAlign: 'left', padding: '4px', fontWeight: 700 }}>DESCRIPTION</th>
                  <th style={{ textAlign: 'right', padding: '4px', fontWeight: 700 }}>AMOUNT</th>
                </tr>
              </thead>
              <tbody>
                {receiptItems
                  .filter(item => item.category === 'labor')
                  .map((item: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #ebebeb' }}>
                      <td style={{ padding: '4px' }}>{item.description}</td>
                      <td style={{ padding: '4px', textAlign: 'right' }}>
                        {formatCurrency(item.line_total || item.total_price || 0)}
                      </td>
                    </tr>
                  ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid #000', fontWeight: 700 }}>
                  <td style={{ padding: '6px 4px' }}>LABOR SUBTOTAL:</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{formatCurrency(extractedLaborTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* LABOR - FALLBACK TO MANUAL */}
        {receiptItems.length === 0 && event.duration_hours && (
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
                  <span>{formatCurrency(manualLaborCost)}</span>
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
        {receiptItems.length === 0 && !event.cost_amount && !event.duration_hours && !event.parts_used && (
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
              {documentId && processingStatus === 'pending' 
                ? '🤖 AI extraction pending - refresh to see extracted data'
                : 'Add cost, labor hours, or parts to complete this receipt'
              }
            </div>
            {documentId && processingStatus === 'pending' && (
              <button
                onClick={async () => {
                  setProcessingStatus('processing');
                  try {
                    const { data: doc } = await supabase
                      .from('vehicle_documents')
                      .select('document_url, vehicle_id')
                      .eq('id', documentId)
                      .single();
                    
                    if (doc) {
                      await supabase.functions.invoke('smart-receipt-linker', {
                        body: {
                          documentId,
                          vehicleId: doc.vehicle_id,
                          documentUrl: doc.document_url
                        }
                      });
                      
                      // Reload data after 3 seconds
                      setTimeout(() => {
                        loadEventData();
                      }, 3000);
                    }
                  } catch (error) {
                    console.error('Error triggering receipt processing:', error);
                    setProcessingStatus('failed');
                  }
                }}
                style={{
                  marginTop: '8px',
                  padding: '4px 8px',
                  border: '1px solid #f59e0b',
                  background: '#ffffff',
                  color: '#f59e0b',
                  fontSize: '8pt',
                  fontWeight: 700,
                  cursor: 'pointer',
                  borderRadius: '2px'
                }}
              >
                🤖 Extract Receipt Data Now
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default TimelineEventReceipt;

