/**
 * LivePhotoProcessor - Real-time photo processing viewer
 *
 * Shows photos being analyzed by AI in real-time.
 * User watches their day's photos get categorized and assigned to vehicles.
 */

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';

interface ProcessingImage {
  id: string;
  image_url: string;
  status: 'queued' | 'processing' | 'done' | 'error';
  progress: number;
  reasoning?: string;
  suggested_vehicle?: {
    id: string;
    name: string;
  };
  confidence?: number;
  detected_features?: {
    color?: string;
    model_badge?: string;
    is_receipt?: boolean;
  };
  error?: string;
}

interface Vehicle {
  id: string;
  year: number | null;
  make: string | null;
  model: string | null;
}

export default function LivePhotoProcessor() {
  const [images, setImages] = useState<ProcessingImage[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState({ processed: 0, queued: 0, errors: 0 });
  const [greeting, setGreeting] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Set greeting based on time of day
  useEffect(() => {
    const hour = new Date().getHours();
    if (hour < 12) setGreeting('Good morning');
    else if (hour < 17) setGreeting('Good afternoon');
    else setGreeting('Welcome back');
  }, []);

  // Load vehicles
  useEffect(() => {
    loadVehicles();
  }, []);

  const loadVehicles = async () => {
    const { data } = await supabase
      .from('vehicles')
      .select('id, year, make, model')
      .or('source.eq.telegram,source.eq.telegram_technician')
      .order('updated_at', { ascending: false })
      .limit(20);
    setVehicles(data || []);
  };

  // Load pending images and start processing
  const startProcessing = async () => {
    setIsProcessing(true);

    // Get unprocessed telegram images
    const { data: pending } = await supabase
      .from('vehicle_images')
      .select('id, image_url, vehicle_id, created_at')
      .eq('source', 'telegram')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!pending?.length) {
      setIsProcessing(false);
      return;
    }

    // Initialize queue
    const queue: ProcessingImage[] = pending.map(img => ({
      id: img.id,
      image_url: img.image_url,
      status: 'queued',
      progress: 0
    }));

    setImages(queue);
    setStats({ processed: 0, queued: queue.length, errors: 0 });

    // Process one at a time with visual feedback
    for (let i = 0; i < queue.length; i++) {
      const img = queue[i];

      // Update to processing
      setImages(prev => prev.map(p =>
        p.id === img.id ? { ...p, status: 'processing', progress: 10 } : p
      ));

      // Simulate progress while calling API
      const progressInterval = setInterval(() => {
        setImages(prev => prev.map(p =>
          p.id === img.id && p.status === 'processing'
            ? { ...p, progress: Math.min(p.progress + 10, 90) }
            : p
        ));
      }, 200);

      try {
        // Call auto-sort API
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-sort-photos`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({
              action: 'classify',
              image_ids: [img.id],
              auto_apply: true
            })
          }
        );

        const result = await response.json();
        clearInterval(progressInterval);

        if (result.results?.[0]) {
          const classification = result.results[0];
          const vehicle = vehicles.find(v => v.id === classification.suggested_vehicle_id);

          setImages(prev => prev.map(p =>
            p.id === img.id ? {
              ...p,
              status: 'done',
              progress: 100,
              reasoning: classification.reasoning,
              suggested_vehicle: vehicle ? {
                id: vehicle.id,
                name: `${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim()
              } : undefined,
              confidence: classification.confidence,
              detected_features: classification.detected_features
            } : p
          ));

          setStats(prev => ({ ...prev, processed: prev.processed + 1, queued: prev.queued - 1 }));
        }
      } catch (err) {
        clearInterval(progressInterval);
        setImages(prev => prev.map(p =>
          p.id === img.id ? { ...p, status: 'error', progress: 0, error: String(err) } : p
        ));
        setStats(prev => ({ ...prev, errors: prev.errors + 1, queued: prev.queued - 1 }));
      }

      // Small delay between images for visual effect
      await new Promise(r => setTimeout(r, 500));
    }

    setIsProcessing(false);
  };

  // Scroll to bottom as new items complete
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [images]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'queued': return '⏳';
      case 'processing': return '🔄';
      case 'done': return '✓';
      case 'error': return '✗';
      default: return '?';
    }
  };

  const getTimeOfDay = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'this morning';
    if (hour < 17) return 'today';
    return 'today';
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Header */}
      <div className="card" style={{ marginBottom: 'var(--space-3)' }}>
        <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
          <h2 style={{ fontSize: '12pt', marginBottom: 'var(--space-2)' }}>
            {greeting}, Skylar
          </h2>
          <p className="text-muted" style={{ marginBottom: 'var(--space-3)' }}>
            {stats.queued > 0
              ? `${stats.queued + stats.processed} photos from ${getTimeOfDay()}`
              : 'Ready to process your photos'
            }
          </p>

          {!isProcessing && stats.processed === 0 && (
            <button
              className="button button-primary"
              onClick={startProcessing}
              style={{ fontSize: '10pt', padding: 'var(--space-2) var(--space-4)' }}
            >
              Start Processing
            </button>
          )}

          {isProcessing && (
            <div className="text-small text-muted">
              Processing... {stats.processed}/{stats.processed + stats.queued}
            </div>
          )}

          {!isProcessing && stats.processed > 0 && (
            <div style={{ color: 'var(--success)' }}>
              ✓ All done! {stats.processed} photos organized
            </div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      {(isProcessing || stats.processed > 0) && (
        <div style={{
          display: 'flex',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
          justifyContent: 'center'
        }}>
          <div className="text-small">
            <span style={{ color: 'var(--success)' }}>✓ {stats.processed}</span> processed
          </div>
          <div className="text-small">
            <span style={{ color: 'var(--warning)' }}>⏳ {stats.queued}</span> queued
          </div>
          {stats.errors > 0 && (
            <div className="text-small">
              <span style={{ color: 'var(--danger)' }}>✗ {stats.errors}</span> errors
            </div>
          )}
        </div>
      )}

      {/* Processing feed */}
      <div
        ref={containerRef}
        style={{
          maxHeight: '60vh',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)'
        }}
      >
        {images.map((img) => (
          <div
            key={img.id}
            className="card"
            style={{
              opacity: img.status === 'queued' ? 0.5 : 1,
              transition: 'all 0.3s ease',
              border: img.status === 'done'
                ? '1px solid var(--success)'
                : img.status === 'error'
                ? '1px solid var(--danger)'
                : '1px solid var(--border)'
            }}
          >
            <div className="card-body" style={{
              display: 'flex',
              gap: 'var(--space-3)',
              padding: 'var(--space-2)'
            }}>
              {/* Thumbnail */}
              <div style={{
                width: '80px',
                height: '80px',
                flexShrink: 0,
                borderRadius: '4px',
                overflow: 'hidden',
                background: 'var(--surface-hover)'
              }}>
                <img
                  src={img.image_url}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: img.status === 'queued' ? 'grayscale(100%)' : 'none'
                  }}
                />
              </div>

              {/* Details */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {/* Status line */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  marginBottom: 'var(--space-1)'
                }}>
                  <span style={{
                    fontSize: '14px',
                    color: img.status === 'done' ? 'var(--success)' :
                           img.status === 'error' ? 'var(--danger)' :
                           'var(--text-muted)'
                  }}>
                    {getStatusIcon(img.status)}
                  </span>
                  <span className="text-small font-bold">
                    {img.status === 'queued' && 'Queued...'}
                    {img.status === 'processing' && 'Analyzing...'}
                    {img.status === 'done' && img.suggested_vehicle?.name}
                    {img.status === 'error' && 'Error'}
                  </span>
                  {img.confidence && (
                    <span className="text-small text-muted">
                      ({Math.round(img.confidence * 100)}%)
                    </span>
                  )}
                </div>

                {/* Progress bar */}
                {img.status === 'processing' && (
                  <div style={{
                    height: '4px',
                    background: 'var(--surface-hover)',
                    borderRadius: '2px',
                    marginBottom: 'var(--space-1)',
                    overflow: 'hidden'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${img.progress}%`,
                      background: 'var(--primary)',
                      transition: 'width 0.2s ease'
                    }} />
                  </div>
                )}

                {/* Reasoning */}
                {img.reasoning && (
                  <div className="text-small text-muted" style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    "{img.reasoning}"
                  </div>
                )}

                {/* Detected features */}
                {img.detected_features && (
                  <div style={{
                    display: 'flex',
                    gap: 'var(--space-1)',
                    marginTop: 'var(--space-1)',
                    flexWrap: 'wrap'
                  }}>
                    {img.detected_features.color && (
                      <span className="text-small" style={{
                        background: 'var(--surface-hover)',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}>
                        {img.detected_features.color}
                      </span>
                    )}
                    {img.detected_features.model_badge && (
                      <span className="text-small" style={{
                        background: 'var(--surface-hover)',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}>
                        {img.detected_features.model_badge}
                      </span>
                    )}
                    {img.detected_features.is_receipt && (
                      <span className="text-small" style={{
                        background: 'var(--warning-bg)',
                        padding: '2px 6px',
                        borderRadius: '4px'
                      }}>
                        Receipt
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {images.length === 0 && !isProcessing && (
        <div className="card">
          <div className="card-body text-center" style={{ padding: 'var(--space-6)' }}>
            <div style={{ fontSize: '32px', marginBottom: 'var(--space-2)' }}>📸</div>
            <div className="text-muted">
              Click "Start Processing" to analyze your photos
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
