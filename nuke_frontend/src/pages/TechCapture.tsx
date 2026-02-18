/**
 * TechCapture - "Techs Take Photos, We Do the Rest"
 *
 * The entire tech UX. One page. Three elements:
 * - Vehicle selector (auto-detected via GPS or QR code URL param)
 * - Big camera button
 * - Real-time status feed via Supabase Realtime
 *
 * No forms. No fields. No typing.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ImageUploadService } from '../services/imageUploadService';

interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  vin: string | null;
}

interface ProcessingEvent {
  id: string;
  imageId: string;
  thumbnailUrl: string | null;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  message: string;
  timestamp: Date;
  details?: any;
}

export default function TechCapture() {
  const [searchParams] = useSearchParams();
  const [user, setUser] = useState<any>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [events, setEvents] = useState<ProcessingEvent[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get vehicle ID from QR code URL param
  const qrVehicleId = searchParams.get('v');

  // Auth + initial data load
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUser(user);

      // If QR code param, use that vehicle
      if (qrVehicleId) {
        setSelectedVehicleId(qrVehicleId);
      }

      // Load vehicles the tech has worked on recently
      const { data: recentImages } = await supabase
        .from('vehicle_images')
        .select('vehicle_id')
        .eq('user_id', user.id)
        .not('vehicle_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);

      const vehicleIds = [...new Set(recentImages?.map(i => i.vehicle_id).filter(Boolean) || [])];

      if (vehicleIds.length > 0) {
        const { data: vehicleData } = await supabase
          .from('vehicles')
          .select('id, year, make, model, trim, vin')
          .in('id', vehicleIds.slice(0, 10));

        if (vehicleData) {
          setVehicles(vehicleData);
          // Auto-select if only one or if QR matched
          if (!qrVehicleId && vehicleData.length === 1) {
            setSelectedVehicleId(vehicleData[0].id);
          }
        }
      }

      // Also load QR vehicle if not already in list
      if (qrVehicleId && !vehicleIds.includes(qrVehicleId)) {
        const { data: qrVehicle } = await supabase
          .from('vehicles')
          .select('id, year, make, model, trim, vin')
          .eq('id', qrVehicleId)
          .maybeSingle();

        if (qrVehicle) {
          setVehicles(prev => [qrVehicle, ...prev]);
        }
      }
    };

    init();
  }, [qrVehicleId]);

  // Supabase Realtime subscription for processing updates
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`tech-capture-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'vehicle_images',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const image = payload.new as any;
          const status = image.ai_processing_status;
          const metadata = image.ai_scan_metadata || {};

          if (status === 'processing') {
            updateEvent(image.id, {
              status: 'processing',
              message: 'AI analyzing...',
            });
          } else if (status === 'completed') {
            const classification = metadata?.classification;
            const summary = metadata?.route_result || '';
            const typeLabel = classification?.image_type?.replace(/_/g, ' ') || 'photo';
            updateEvent(image.id, {
              status: 'completed',
              message: `${typeLabel} - ${summary}`,
              details: metadata,
            });
          } else if (status === 'failed') {
            updateEvent(image.id, {
              status: 'failed',
              message: metadata?.pipeline_error || 'Processing failed',
            });
          }
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user?.id]);

  const updateEvent = useCallback((imageId: string, updates: Partial<ProcessingEvent>) => {
    setEvents(prev =>
      prev.map(e =>
        e.imageId === imageId ? { ...e, ...updates, timestamp: new Date() } : e,
      ),
    );
  }, []);

  const vehicleLabel = (v: Vehicle) => {
    const parts = [v.year, v.make, v.model, v.trim].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : 'Unknown Vehicle';
  };

  const handleCapture = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tempId = crypto.randomUUID();

      // Add uploading event immediately
      const thumbnailUrl = URL.createObjectURL(file);
      setEvents(prev => [
        {
          id: tempId,
          imageId: tempId,
          thumbnailUrl,
          status: 'uploading',
          message: 'Uploading...',
          timestamp: new Date(),
        },
        ...prev,
      ]);

      try {
        const result = await ImageUploadService.uploadImage(
          selectedVehicleId || undefined,
          file,
          'general',
        );

        if (result.success && result.imageId) {
          // Update event with real image ID
          setEvents(prev =>
            prev.map(e =>
              e.id === tempId
                ? {
                    ...e,
                    imageId: result.imageId!,
                    status: 'processing' as const,
                    message: 'Queued for AI processing...',
                  }
                : e,
            ),
          );
        } else {
          setEvents(prev =>
            prev.map(e =>
              e.id === tempId
                ? { ...e, status: 'failed' as const, message: result.error || 'Upload failed' }
                : e,
            ),
          );
        }
      } catch (error: any) {
        setEvents(prev =>
          prev.map(e =>
            e.id === tempId
              ? { ...e, status: 'failed' as const, message: error.message || 'Upload error' }
              : e,
          ),
        );
      }
    }

    setIsUploading(false);
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);

  // Status icon per event state
  const statusIcon = (status: ProcessingEvent['status']) => {
    switch (status) {
      case 'uploading': return '...';
      case 'processing': return '~';
      case 'completed': return '+';
      case 'failed': return 'x';
    }
  };

  const statusColor = (status: ProcessingEvent['status']) => {
    switch (status) {
      case 'uploading': return '#6b7280';
      case 'processing': return '#f59e0b';
      case 'completed': return '#10b981';
      case 'failed': return '#ef4444';
    }
  };

  if (!user) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'monospace', color: '#9ca3af' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>Marque</div>
        <div>Sign in to start capturing</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100dvh',
      backgroundColor: '#111',
      color: '#e5e7eb',
      fontFamily: 'monospace',
      display: 'flex',
      flexDirection: 'column',
      maxWidth: '480px',
      margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '1rem',
        borderBottom: '1px solid #333',
      }}>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
          Marque
        </div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
          {events.filter(e => e.status === 'processing').length > 0 && (
            <span style={{ color: '#f59e0b' }}>
              {events.filter(e => e.status === 'processing').length} processing
            </span>
          )}
        </div>
      </div>

      {/* Vehicle Selector */}
      <div style={{ padding: '1rem', borderBottom: '1px solid #222' }}>
        <label style={{ display: 'block', fontSize: '0.7rem', color: '#6b7280', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Vehicle
        </label>
        <select
          value={selectedVehicleId || ''}
          onChange={(e) => setSelectedVehicleId(e.target.value || null)}
          style={{
            width: '100%',
            padding: '0.75rem',
            backgroundColor: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: '0.5rem',
            color: '#e5e7eb',
            fontSize: '0.95rem',
            fontFamily: 'monospace',
            appearance: 'auto',
          }}
        >
          <option value="">Auto-detect from photo</option>
          {vehicles.map(v => (
            <option key={v.id} value={v.id}>{vehicleLabel(v)}</option>
          ))}
        </select>
        {selectedVehicle && (
          <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#6b7280' }}>
            {selectedVehicle.vin ? `VIN: ${selectedVehicle.vin}` : 'No VIN on file'}
          </div>
        )}
      </div>

      {/* Camera Button */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        <button
          onClick={handleCapture}
          disabled={isUploading}
          style={{
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            border: isUploading ? '3px solid #f59e0b' : '3px solid #e5e7eb',
            backgroundColor: isUploading ? '#1a1a1a' : 'transparent',
            color: isUploading ? '#f59e0b' : '#e5e7eb',
            fontSize: '1rem',
            fontFamily: 'monospace',
            fontWeight: 700,
            cursor: isUploading ? 'wait' : 'pointer',
            transition: 'all 0.2s',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
          }}
        >
          {isUploading ? (
            <>
              <span style={{ fontSize: '2rem' }}>...</span>
              <span style={{ fontSize: '0.75rem' }}>uploading</span>
            </>
          ) : (
            <>
              <span style={{ fontSize: '2rem' }}>[ ]</span>
              <span style={{ fontSize: '0.8rem' }}>TAKE PHOTO</span>
            </>
          )}
        </button>
      </div>

      {/* Status Feed */}
      {events.length > 0 && (
        <div style={{
          borderTop: '1px solid #333',
          maxHeight: '40dvh',
          overflowY: 'auto',
        }}>
          <div style={{
            padding: '0.75rem 1rem 0.25rem',
            fontSize: '0.7rem',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Recent ({events.length})
          </div>
          {events.map((event) => (
            <div
              key={event.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '0.5rem 1rem',
                borderBottom: '1px solid #1a1a1a',
              }}
            >
              {/* Thumbnail */}
              {event.thumbnailUrl ? (
                <img
                  src={event.thumbnailUrl}
                  alt=""
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '0.25rem',
                    objectFit: 'cover',
                    opacity: event.status === 'failed' ? 0.4 : 1,
                  }}
                />
              ) : (
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '0.25rem',
                  backgroundColor: '#1a1a1a',
                }} />
              )}

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '0.8rem',
                  color: statusColor(event.status),
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {statusIcon(event.status)} {event.message}
                </div>
                <div style={{ fontSize: '0.65rem', color: '#4b5563' }}>
                  {event.timestamp.toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
