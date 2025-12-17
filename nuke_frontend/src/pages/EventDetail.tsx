import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface TimelineEvent {
  id: string;
  vehicle_id: string | null;
  user_id: string | null;
  event_type: string;
  event_category: string;
  title: string;
  description: string | null;
  event_date: string;
  mileage_at_event: number | null;
  location: string | null;
  source_type: string;
  confidence_score: number | null;
  verification_status: string;
  documentation_urls: string[] | null;
  receipt_amount: number | null;
  receipt_currency: string | null;
  metadata: any;
  affects_value: boolean;
  affects_safety: boolean;
  affects_performance: boolean;
  created_at: string;
  updated_at: string;
}

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<TimelineEvent | null>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadEvent();
    }
  }, [id]);

  const loadEvent = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);

      // Load event from timeline_events table
      const { data: eventData, error: eventError } = await supabase
        .from('timeline_events')
        .select('*')
        .eq('id', id)
        .single();

      if (eventError) {
        // Try vehicle_timeline_events as fallback
        const { data: fallbackData, error: fallbackError } = await supabase
          .from('vehicle_timeline_events')
          .select('*')
          .eq('id', id)
          .single();

        if (fallbackError) {
          throw fallbackError;
        }
        setEvent(fallbackData as any);
      } else {
        setEvent(eventData as any);
      }

      // Load vehicle if vehicle_id exists
      if (eventData?.vehicle_id || (eventData as any)?.vehicle_id) {
        const vehicleId = eventData?.vehicle_id || (eventData as any)?.vehicle_id;
        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('id, year, make, model, color')
          .eq('id', vehicleId)
          .single();

        if (vehicleData) {
          setVehicle(vehicleData);

          // Load images for this event's date
          const eventDate = new Date(eventData.event_date || (eventData as any).event_date);
          const startOfDay = new Date(eventDate);
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date(eventDate);
          endOfDay.setHours(23, 59, 59, 999);

          const { data: imageData } = await supabase
            .from('vehicle_images')
            .select('id, image_url, taken_at, description')
            .eq('vehicle_id', vehicleId)
            .gte('taken_at', startOfDay.toISOString())
            .lte('taken_at', endOfDay.toISOString())
            .order('taken_at');

          if (imageData) {
            setImages(imageData);
          }
        }
      }
    } catch (err: any) {
      console.error('Error loading event:', err);
      setError(err.message || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="text text-muted">Loading event...</div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div className="text text-bold" style={{ marginBottom: '12px' }}>Event Not Found</div>
        <div className="text text-muted" style={{ marginBottom: '20px' }}>
          {error || 'The event you\'re looking for doesn\'t exist or has been removed.'}
        </div>
        <Link to="/discover" className="button button-primary">
          Go to Discovery
        </Link>
      </div>
    );
  }

  return (
      <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={() => {
              // Safe back navigation with fallback to homepage
              if (window.history.length > 1) {
                try {
                  navigate(-1);
                } catch (error) {
                  navigate('/');
                }
              } else {
                navigate('/');
              }
            }}
            className="button-win95"
            style={{ marginBottom: '12px', fontSize: '8pt' }}
          >
            ← Back
          </button>
          <h1 className="heading-1" style={{ marginBottom: '8px' }}>
            {event.title || `${event.event_type || 'Event'}`}
          </h1>
          {vehicle && (
            <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
              <Link to={`/vehicle/${vehicle.id}`} style={{ color: 'var(--text-primary)' }}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </Link>
            </div>
          )}
        </div>

        {/* Event Details */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">Event Details</div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div>
                <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>Date</div>
                <div className="text">{new Date(event.event_date || event.created_at).toLocaleDateString()}</div>
              </div>
              {event.mileage_at_event && (
                <div>
                  <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>Mileage</div>
                  <div className="text">{event.mileage_at_event.toLocaleString()} miles</div>
                </div>
              )}
              {event.location && (
                <div>
                  <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>Location</div>
                  <div className="text">{event.location}</div>
                </div>
              )}
              <div>
                <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>Type</div>
                <div className="text">{event.event_type || 'N/A'}</div>
              </div>
              <div>
                <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>Category</div>
                <div className="text">{event.event_category || 'N/A'}</div>
              </div>
              {event.confidence_score !== null && (
                <div>
                  <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>Confidence</div>
                  <div className="text">{event.confidence_score}%</div>
                </div>
              )}
              <div>
                <div className="text text-bold" style={{ fontSize: '8pt', marginBottom: '4px' }}>Status</div>
                <div className="text">{event.verification_status || 'unverified'}</div>
              </div>
            </div>

            {event.description && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <div className="text text-bold" style={{ fontSize: '9pt', marginBottom: '8px' }}>Description</div>
                <div className="text">{event.description}</div>
              </div>
            )}

            {event.receipt_amount && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <div className="text text-bold" style={{ fontSize: '9pt', marginBottom: '8px' }}>Cost</div>
                <div className="text">
                  {event.receipt_currency || 'USD'} ${event.receipt_amount.toFixed(2)}
                </div>
              </div>
            )}

            {event.documentation_urls && event.documentation_urls.length > 0 && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <div className="text text-bold" style={{ fontSize: '9pt', marginBottom: '8px' }}>Documents</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {event.documentation_urls.map((url, idx) => (
                    <a key={idx} href={url} target="_blank" rel="noopener noreferrer" className="text" style={{ color: 'var(--text-primary)' }}>
                      Document {idx + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Images */}
        {images.length > 0 && (
          <div className="card" style={{ marginBottom: '24px' }}>
            <div className="card-header">Images from this Event</div>
            <div className="card-body">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                {images.map((img) => (
                  <div key={img.id} style={{ position: 'relative' }}>
                    <img
                      src={img.image_url}
                      alt={img.description || 'Event image'}
                      style={{
                        width: '100%',
                        height: '200px',
                        objectFit: 'cover',
                        border: '1px solid var(--border)',
                        cursor: 'pointer'
                      }}
                      onClick={() => window.open(img.image_url, '_blank')}
                    />
                    {img.description && (
                      <div className="text text-muted" style={{ fontSize: '8pt', marginTop: '4px' }}>
                        {img.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Metadata */}
        {event.metadata && Object.keys(event.metadata).length > 0 && (
          <div className="card">
            <div className="card-header">Additional Information</div>
            <div className="card-body">
              <pre style={{ fontSize: '8pt', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
  );
}

