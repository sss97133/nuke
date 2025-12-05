/**
 * Service Report Modal
 * 
 * Shows detailed service work report for a vehicle
 * - Work sessions timeline
 * - Photo gallery
 * - Cost breakdown
 * - Hours invested
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface WorkSession {
  id: string;
  date: string;
  title: string;
  duration_hours: number;
  image_count: number;
}

interface ServiceReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  vehicleId: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  organizationId: string;
  organizationName?: string;
  laborRate?: number;
}

export function ServiceReportModal({
  isOpen,
  onClose,
  vehicleId,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  organizationId,
  organizationName = 'Service Provider',
  laborRate = 125
}: ServiceReportModalProps) {
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadReportData();
    }
  }, [isOpen, vehicleId, organizationId]);

  const loadReportData = async () => {
    setLoading(true);
    try {
      // Get timeline events (work sessions)
      const { data: events } = await supabase
        .from('timeline_events')
        .select('id, event_date, title, metadata, duration_hours')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .order('event_date', { ascending: false });

      const workSessions: WorkSession[] = (events || []).map(e => ({
        id: e.id,
        date: e.event_date,
        title: e.title || 'Work Session',
        duration_hours: e.metadata?.duration_hours || e.duration_hours || 0,
        image_count: e.metadata?.image_count || 0
      }));
      setSessions(workSessions);

      // Get images
      const { data: imgs } = await supabase
        .from('vehicle_images')
        .select('image_url, thumbnail_url, taken_at')
        .eq('vehicle_id', vehicleId)
        .order('taken_at', { ascending: false })
        .limit(20);

      setImages((imgs || []).map(i => i.image_url));
    } catch (err) {
      console.error('Error loading report:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const totalHours = sessions.reduce((sum, s) => sum + s.duration_hours, 0);
  const totalImages = sessions.reduce((sum, s) => sum + s.image_count, 0);
  const estimatedCost = totalHours * laborRate;
  const firstDate = sessions.length ? sessions[sessions.length - 1].date : null;
  const lastDate = sessions.length ? sessions[0].date : null;

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatCurrency = (n: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.8)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: 'var(--card-bg, #fff)',
          borderRadius: '4px',
          width: '100%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid var(--border)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start'
        }}>
          <div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
              Service Report
            </div>
            <div style={{ fontSize: '8pt', fontWeight: 700 }}>
              {vehicleYear} {vehicleMake} {vehicleModel}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-secondary)', marginTop: '2px' }}>
              {organizationName}
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '8pt',
              cursor: 'pointer',
              padding: '4px 8px',
              color: 'var(--text-muted)'
            }}
          >
            CLOSE
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', fontSize: '8pt', color: 'var(--text-muted)' }}>
            Loading report...
          </div>
        ) : (
          <>
            {/* Stats Summary */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '1px',
              background: 'var(--border-light)',
              borderBottom: '1px solid var(--border-light)'
            }}>
              <div style={{ background: 'var(--card-bg)', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--accent)' }}>{sessions.length}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>SESSIONS</div>
              </div>
              <div style={{ background: 'var(--card-bg)', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700 }}>{Math.round(totalHours * 10) / 10}h</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>HOURS</div>
              </div>
              <div style={{ background: 'var(--card-bg)', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700, color: 'var(--success, #22c55e)' }}>{formatCurrency(estimatedCost)}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>EST. VALUE</div>
              </div>
              <div style={{ background: 'var(--card-bg)', padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: '8pt', fontWeight: 700 }}>{totalImages}</div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>PHOTOS</div>
              </div>
            </div>

            {/* Photo Gallery */}
            {images.length > 0 && (
              <div style={{ padding: '12px', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  WORK DOCUMENTATION
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(5, 1fr)',
                  gap: '4px'
                }}>
                  {images.slice(0, 10).map((url, idx) => (
                    <div 
                      key={idx}
                      style={{ aspectRatio: '1', cursor: 'pointer' }}
                      onClick={() => setSelectedImage(url)}
                    >
                      <img 
                        src={url} 
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '2px' }}
                      />
                    </div>
                  ))}
                </div>
                {images.length > 10 && (
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
                    +{images.length - 10} more photos
                  </div>
                )}
              </div>
            )}

            {/* Work Sessions Timeline */}
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '8px' }}>
                WORK SESSIONS ({formatDate(firstDate)} - {formatDate(lastDate)})
              </div>
              <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                {sessions.map((session, idx) => (
                  <div 
                    key={session.id}
                    style={{
                      padding: '8px',
                      borderLeft: '2px solid var(--accent)',
                      marginLeft: '8px',
                      marginBottom: '8px',
                      background: idx === 0 ? 'var(--accent-dim)' : 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '8pt', fontWeight: 600 }}>{session.title}</div>
                        <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                          {formatDate(session.date)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        {session.duration_hours > 0 && (
                          <div style={{ fontSize: '8pt', fontWeight: 600 }}>{session.duration_hours}h</div>
                        )}
                        {session.image_count > 0 && (
                          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>{session.image_count} photos</div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: '12px',
              borderTop: '1px solid var(--border-light)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                Labor rate: {formatCurrency(laborRate)}/hr
              </div>
              <button
                onClick={() => window.open(`/vehicle/${vehicleId}`, '_blank')}
                style={{
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  cursor: 'pointer',
                  borderRadius: '2px'
                }}
              >
                VIEW FULL PROFILE
              </button>
            </div>
          </>
        )}
      </div>

      {/* Full Image Viewer */}
      {selectedImage && (
        <div 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.95)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
          onClick={() => setSelectedImage(null)}
        >
          <img 
            src={selectedImage} 
            alt=""
            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
          />
        </div>
      )}
    </div>
  );
}

export default ServiceReportModal;

