import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface EventDetailModalProps {
  eventId: string;
  onClose: () => void;
}

interface TimelineEvent {
  id: string;
  title: string;
  description?: string;
  event_date: string;
  event_type: string;
  labor_hours?: number;
  metadata?: any;
}

export const EventDetailModal: React.FC<EventDetailModalProps> = ({ eventId, onClose }) => {
  const [event, setEvent] = useState<TimelineEvent | null>(null);
  const [images, setImages] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [shoppableProducts, setShoppableProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);

  useEffect(() => {
    loadEventDetails();
  }, [eventId]);

  const loadEventDetails = async () => {
    // Load event
    const { data: eventData } = await supabase
      .from('vehicle_timeline_events')
      .select('*')
      .eq('id', eventId)
      .single();

    if (eventData) {
      setEvent(eventData);

      // Load images for this event's date
      const eventDate = new Date(eventData.event_date);
      const startOfDay = new Date(eventDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(eventDate);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: imageData } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', eventData.vehicle_id)
        .gte('taken_at', startOfDay.toISOString())
        .lte('taken_at', endOfDay.toISOString())
        .order('taken_at');

      if (imageData) {
        setImages(imageData);

        // Load SHOPPABLE tags for these images
        const imageIds = imageData.map(img => img.id);
        const { data: tagData } = await supabase
          .from('image_tags')
          .select('*')
          .in('image_id', imageIds)
          .eq('is_shoppable', true)
          .order('lowest_price_cents', { ascending: false });

        if (tagData) {
          setTags(tagData);
          
          // Extract unique shoppable products
          const products = tagData
            .filter((t: any) => t.tag_type === 'part' || t.tag_type === 'tool')
            .map((t: any) => ({
              id: t.id,
              name: t.tag_name,
              brand: t.metadata?.brand || 'Unknown',
              partNumber: t.oem_part_number,
              price: t.lowest_price_cents ? (t.lowest_price_cents / 100) : null,
              buyLinks: typeof t.affiliate_links === 'string' ? JSON.parse(t.affiliate_links) : (t.affiliate_links || []),
              confidence: t.confidence
            }))
            .filter((p: any) => p.buyLinks.length > 0);
          
          setShoppableProducts(products);
        }
      }
    }

    setLoading(false);
  };

  if (loading || !event) {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000
      }}>
        <div style={{ color: '#fff', fontSize: '14px' }}>Loading...</div>
      </div>
    );
  }

  const parts = tags.filter(t => t.tag_type === 'part');
  const tools = tags.filter(t => t.tag_type === 'tool');
  const estimatedValue = shoppableProducts.reduce((sum, p) => sum + (p.price || 0), 0);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 10000,
        overflowY: 'auto',
        padding: '40px 20px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        background: '#c0c0c0',
        border: '2px solid',
        borderColor: '#ffffff #808080 #808080 #ffffff',
        fontFamily: 'MS Sans Serif, sans-serif'
      }}>
        {/* Title Bar */}
        <div style={{
          background: '#000080',
          color: '#ffffff',
          padding: '4px 8px',
          fontSize: '11px',
          fontWeight: 'bold',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>{event.title}</span>
          <button
            onClick={onClose}
            style={{
              background: '#c0c0c0',
              border: '1px solid #fff',
              color: '#000',
              width: '18px',
              height: '18px',
              cursor: 'pointer',
              fontSize: '12px',
              lineHeight: '1'
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '16px' }}>
          {/* Event Info */}
          <div style={{
            background: '#ffffff',
            border: '2px solid',
            borderColor: '#808080 #ffffff #ffffff #808080',
            padding: '12px',
            marginBottom: '16px',
            fontSize: '11px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '9px', color: '#808080', marginBottom: '4px' }}>DATE</div>
                <div style={{ fontWeight: 'bold' }}>
                  {new Date(event.event_date).toLocaleDateString()}
                </div>
              </div>
              <div>
                <div style={{ fontSize: '9px', color: '#808080', marginBottom: '4px' }}>TYPE</div>
                <div style={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                  {event.event_type}
                </div>
              </div>
              {event.labor_hours && (
                <div>
                  <div style={{ fontSize: '9px', color: '#808080', marginBottom: '4px' }}>LABOR</div>
                  <div style={{ fontWeight: 'bold' }}>{event.labor_hours} hrs</div>
                </div>
              )}
              <div>
                <div style={{ fontSize: '9px', color: '#808080', marginBottom: '4px' }}>PHOTOS</div>
                <div style={{ fontWeight: 'bold' }}>{images.length}</div>
              </div>
            </div>

            {event.description && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #808080' }}>
                <div style={{ fontSize: '9px', color: '#808080', marginBottom: '4px' }}>DESCRIPTION</div>
                <div>{event.description}</div>
              </div>
            )}
          </div>

          {/* SHOPPABLE PRODUCTS - BUY LINKS */}
          {shoppableProducts.length > 0 && (
            <div style={{
              background: '#ffffff',
              border: '2px solid',
              borderColor: '#808080 #ffffff #ffffff #808080',
              padding: '12px',
              marginBottom: '16px',
              fontSize: '11px'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#000080' }}>
                  PRODUCTS USED ({shoppableProducts.length}) - ${estimatedValue.toFixed(2)} VALUE
                </div>
                <button
                  onClick={() => setBookmarked(!bookmarked)}
                  style={{
                    background: bookmarked ? '#000' : 'transparent',
                    border: '1px solid #000',
                    color: bookmarked ? '#fff' : '#000',
                    padding: '4px 8px',
                    fontSize: '9px',
                    cursor: 'pointer'
                  }}
                >
                  {bookmarked ? '■ SAVED' : '□ SAVE'}
                </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {shoppableProducts.map(product => (
                  <div
                    key={product.id}
                    style={{
                      background: '#f5f5f5',
                      border: '1px solid #ccc',
                      padding: '8px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '2px' }}>
                        {product.name}
                      </div>
                      <div style={{ fontSize: '9px', color: '#666' }}>
                        {product.brand} {product.partNumber ? `• ${product.partNumber}` : ''}
                        {product.price && ` • $${product.price.toFixed(2)}`}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {product.buyLinks.map((link: any, idx: number) => (
                        <a
                          key={idx}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            background: link.provider === 'amazon' ? '#FF9900' : '#0066CC',
                            color: '#fff',
                            padding: '4px 8px',
                            fontSize: '9px',
                            fontWeight: 'bold',
                            textDecoration: 'none',
                            borderRadius: '2px',
                            textTransform: 'uppercase'
                          }}
                        >
                          BUY {link.provider}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Images Grid */}
          {images.length > 0 && (
            <div style={{
              background: '#ffffff',
              border: '2px solid',
              borderColor: '#808080 #ffffff #ffffff #808080',
              padding: '12px',
              fontSize: '11px'
            }}>
              <div style={{
                fontSize: '10px',
                fontWeight: 'bold',
                marginBottom: '12px',
                color: '#000080'
              }}>
                PHOTOS ({images.length})
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                gap: '8px'
              }}>
                {images.map(img => (
                  <img
                    key={img.id}
                    src={img.image_url}
                    alt={img.filename}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      objectFit: 'cover',
                      cursor: 'pointer',
                      border: '1px solid #808080'
                    }}
                    onClick={() => {
                      // TODO: Open in lightbox
                      window.open(img.image_url, '_blank');
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventDetailModal;

