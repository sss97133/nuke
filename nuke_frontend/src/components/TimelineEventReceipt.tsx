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
  const [documentUrl, setDocumentUrl] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<string>('pending');
  const [extractionConfidence, setExtractionConfidence] = useState<number | null>(null);
  const [showPerformerCard, setShowPerformerCard] = useState(false);
  const [performerProfile, setPerformerProfile] = useState<any>(null);
  const [showLocationCard, setShowLocationCard] = useState(false);
  const [locationDetails, setLocationDetails] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [vehicleOwnerId, setVehicleOwnerId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [comments, setComments] = useState<any[]>([]);

  useEffect(() => {
    loadEventData();
    loadCurrentUser();
  }, [eventId]);

  const loadCurrentUser = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, username, full_name')
        .eq('id', session.user.id)
        .single();
      setCurrentUser(profile);
    }
  };

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
      
      // Load vehicle owner
      const { data: vehicle } = await supabase
        .from('vehicles')
        .select('owner_id')
        .eq('id', eventResult.data.vehicle_id)
        .single();
      if (vehicle?.owner_id) {
        setVehicleOwnerId(vehicle.owner_id);
      }
      
      // Load comments
      const { CommentService } = await import('../services/CommentService');
      const commentsResult = await CommentService.getEventComments(eventId);
      if (commentsResult.success && commentsResult.data) {
        setComments(commentsResult.data);
      }
      
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

        // Load document processing status from unified documents table
        const { data: document } = await supabase
          .from('documents')
          .select('ai_processing_status, ai_extraction_confidence, file_url')
          .eq('id', docId)
          .single();

        if (document) {
          setProcessingStatus(document.ai_processing_status || 'pending');
          setExtractionConfidence(document.ai_extraction_confidence);
          setDocumentUrl(document.file_url);
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
        {/* COMPACT RECEIPT HEADER WITH IMAGES */}
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
              WORK ORDER #{event.id.slice(0, 8).toUpperCase()}
            </div>
            <div style={{ fontSize: '7pt', color: '#666', marginBottom: '6px' }}>
              {formatDate(event.event_date)}
              {event.mileage_at_event && ` • ${event.mileage_at_event.toLocaleString()} mi`}
            </div>
            <div style={{ fontSize: '7pt', color: '#666' }}>
              {event.service_provider_name || uploaderName || 'Owner/DIY'}
            </div>
          </div>
          
          {/* IMAGE THUMBNAILS IN HEADER */}
          {images.length > 0 && (
            <div style={{ 
              display: 'flex', 
              gap: '4px',
              flexShrink: 0
            }}>
              {images.slice(0, 4).map((img, idx) => (
                <img
                  key={img.id}
                  src={img.image_url}
                  alt={`Receipt ${idx + 1}`}
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
              {images.length > 4 && (
                <div
                  onClick={() => {
                    // Scroll to images section
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
                    color: '#666',
                    cursor: 'pointer',
                    fontWeight: 700
                  }}
                >
                  +{images.length - 4}
                </div>
              )}
            </div>
          )}
        </div>

        {/* SERVICE PROVIDER / WHO DID THE WORK - COMPACT */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd', position: 'relative' }}>
          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '4px', color: '#666', textTransform: 'uppercase' }}>
            Performed By:
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

        {/* WORK PERFORMED - COMPACT */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd' }}>
          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '4px', color: '#666', textTransform: 'uppercase' }}>
            Work Performed:
          </div>
          <div style={{ fontSize: '8pt', marginBottom: '4px', padding: '6px', background: '#f9f9f9', borderRadius: '2px' }}>
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
            background: 'var(--bg-secondary)',
            border: '1px solid var(--accent)',
            margin: '0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            fontSize: '8pt'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div className="spinner" style={{ width: '12px', height: '12px', border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontWeight: 600, color: 'var(--accent)' }}>AI PROCESSING RECEIPT DATA...</span>
            </div>
            {documentUrl && (
              <button
                onClick={() => window.open(documentUrl, '_blank')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: '8pt'
                }}
              >
                VIEW SOURCE
              </button>
            )}
          </div>
        )}

        {documentId && processingStatus === 'completed' && extractionConfidence && (
          <div style={{
            padding: '12px 16px',
            background: 'var(--success-light)',
            border: '1px solid var(--success)',
            margin: '0',
            fontSize: '8pt',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span style={{ fontWeight: 600, color: 'var(--success)' }}>AI EXTRACTION COMPLETE</span>
            <div style={{ display: 'flex', gap: '12px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Confidence: {Math.round(extractionConfidence * 100)}%</span>
              {documentUrl && (
                <button
                  onClick={() => window.open(documentUrl, '_blank')}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--success)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    fontSize: '8pt'
                  }}
                >
                  VIEW SOURCE
                </button>
              )}
            </div>
          </div>
        )}

        {/* PARTS & MATERIALS - AI EXTRACTED */}
        {receiptItems.filter(item => item.category === 'part').length > 0 && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: '#666', textTransform: 'uppercase' }}>
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
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: '#666', textTransform: 'uppercase' }}>
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
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: '#666', textTransform: 'uppercase' }}>
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
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: '#666', textTransform: 'uppercase' }}>
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

        {/* TOTAL - COMPACT */}
        <div style={{ padding: '8px 12px', borderBottom: '3px double #000', background: '#f5f5f5' }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            fontSize: '11pt', 
            fontWeight: 700,
            marginBottom: '4px'
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
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd', background: '#f9f9f9' }}>
            <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '4px', color: '#666', textTransform: 'uppercase' }}>
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

        {/* PHOTOS - COMPACT GRID */}
        {images.length > 0 && (
          <div data-images-section style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd', background: '#fafafa' }}>
            <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: '#666', textTransform: 'uppercase' }}>
              Documentation ({images.length})
            </div>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(60px, 1fr))', 
              gap: '4px' 
            }}>
              {images.map((img) => (
                <div
                  key={img.id}
                  style={{
                    width: '100%',
                    paddingBottom: '100%',
                    background: `url(${img.image_url}) center/cover`,
                    border: '1px solid #ccc',
                    borderRadius: '2px',
                    cursor: 'pointer',
                    position: 'relative'
                  }}
                  onClick={() => window.open(img.image_url, '_blank')}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.border = '2px solid #000';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.border = '1px solid #ccc';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* NOTES */}
        {event.metadata?.notes && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd' }}>
            <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '4px', color: '#666', textTransform: 'uppercase' }}>
              Notes:
            </div>
            <div style={{ fontSize: '8pt', color: '#333', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
              {event.metadata.notes}
            </div>
          </div>
        )}

        {/* USER COMMENTS / INPUT SECTION */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #bdbdbd', background: '#f9f9f9' }}>
          <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '6px', color: '#666', textTransform: 'uppercase' }}>
            Comments ({comments.length})
          </div>
          
          {/* Existing Comments */}
          {comments.length > 0 && (
            <div style={{ marginBottom: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {comments.map((comment: any) => (
                <div key={comment.id} style={{ 
                  marginBottom: '6px', 
                  padding: '6px',
                  background: '#fff',
                  border: '1px solid #e0e0e0',
                  borderRadius: '2px',
                  fontSize: '7pt'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 700, color: '#333' }}>
                      {comment.user_profile?.username || comment.user_profile?.full_name || 'User'}
                    </span>
                    <span style={{ color: '#999', fontSize: '6pt' }}>
                      {new Date(comment.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div style={{ color: '#555', lineHeight: 1.3 }}>
                    {comment.comment_text}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add Comment Input */}
          {currentUser && (
            <div style={{ display: 'flex', gap: '4px', alignItems: 'flex-start' }}>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment or note..."
                disabled={submittingComment}
                style={{
                  flex: 1,
                  fontSize: '7pt',
                  padding: '4px 6px',
                  border: '1px solid #ccc',
                  borderRadius: '2px',
                  resize: 'none',
                  minHeight: '40px',
                  fontFamily: 'inherit'
                }}
                rows={2}
              />
              <button
                onClick={async () => {
                  if (!newComment.trim() || submittingComment || !currentUser) return;
                  
                  setSubmittingComment(true);
                  const { CommentService } = await import('../services/CommentService');
                  const result = await CommentService.addComment(eventId, newComment, currentUser.id);
                  
                  if (result.success) {
                    setNewComment('');
                    const commentsResult = await CommentService.getEventComments(eventId);
                    if (commentsResult.success && commentsResult.data) {
                      setComments(commentsResult.data);
                    }
                  } else {
                    alert(result.error || 'Failed to add comment');
                  }
                  setSubmittingComment(false);
                }}
                disabled={submittingComment || !newComment.trim()}
                style={{
                  padding: '4px 8px',
                  fontSize: '7pt',
                  fontWeight: 700,
                  border: '1px solid #000',
                  background: submittingComment || !newComment.trim() ? '#ccc' : '#fff',
                  color: submittingComment || !newComment.trim() ? '#999' : '#000',
                  cursor: submittingComment || !newComment.trim() ? 'not-allowed' : 'pointer',
                  borderRadius: '2px',
                  whiteSpace: 'nowrap'
                }}
              >
                {submittingComment ? '...' : 'POST'}
              </button>
            </div>
          )}
          
          {!currentUser && (
            <div style={{ fontSize: '7pt', color: '#999', fontStyle: 'italic', padding: '4px' }}>
              Sign in to add comments
            </div>
          )}
        </div>

        {/* FOOTER / ACTIONS - COMPACT */}
        <div style={{ padding: '6px 12px', background: '#f5f5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '7pt', color: '#999' }}>
            ESC to close
          </div>
          <button
            onClick={onClose}
            style={{
              padding: '4px 8px',
              border: '1px solid #000',
              background: '#fff',
              color: '#000',
              fontSize: '7pt',
              fontWeight: 700,
              cursor: 'pointer',
              borderRadius: '2px',
              transition: 'all 0.12s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#000';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fff';
              e.currentTarget.style.color = '#000';
            }}
          >
            Close
          </button>
        </div>

        {/* Missing data prompts */}
        {receiptItems.length === 0 && !event.cost_amount && !event.duration_hours && !event.parts_used && (
          <div style={{
            padding: '8px 12px',
            background: '#fff3cd',
            border: '1px solid #ffc107',
            margin: '8px 12px',
            borderRadius: '2px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: '7pt', fontWeight: 700, marginBottom: '2px', color: '#856404', textTransform: 'uppercase' }}>
                  Incomplete Work Order
                </div>
                <div style={{ fontSize: '7pt', color: '#856404' }}>
                  {documentId && processingStatus === 'pending' 
                    ? 'AI extraction pending - refresh to see extracted data'
                    : 'Add cost, labor hours, or parts to complete this receipt'
                  }
                </div>
              </div>
              {documentUrl && (
                <button
                  onClick={() => window.open(documentUrl, '_blank')}
                  className="button button-secondary cursor-button"
                  style={{
                    fontSize: '8pt',
                    padding: '4px 8px',
                    height: 'auto'
                  }}
                >
                  VIEW SOURCE
                </button>
              )}
            </div>
            
            {documentId && processingStatus === 'pending' && (
              <button
                onClick={async () => {
                  setProcessingStatus('processing');
                  try {
                    const { data: doc } = await supabase
                      .from('documents')
                      .select('file_url, entity_id')
                      .eq('id', documentId)
                      .single();
                    
                    if (doc) {
                      await supabase.functions.invoke('smart-receipt-linker', {
                        body: {
                          documentId,
                          vehicleId: doc.entity_id,
                          documentUrl: doc.file_url
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
                className="button cursor-button"
                style={{
                  marginTop: '12px',
                  padding: '6px 12px',
                  border: '2px solid var(--warning)',
                  background: 'var(--surface)',
                  color: 'var(--warning-dark)',
                  fontSize: '8pt',
                  fontWeight: 700,
                  width: '100%'
                }}
              >
                EXTRACT RECEIPT DATA NOW
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

