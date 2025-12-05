/**
 * Rich Service Vehicle Card
 * 
 * Shows actual useful info for people shopping around:
 * - Work photos grid (not just primary image)
 * - Total hours invested
 * - Estimated cost
 * - Work sessions count
 * - Timeline span
 * - Work type summary
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface ServiceStats {
  totalSessions: number;
  totalImages: number;
  totalHours: number;
  estimatedCost: number;
  firstSession: string | null;
  lastSession: string | null;
  recentImages: string[];
  workTypes: string[];
}

interface ServiceVehicleCardRichProps {
  vehicleId: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleVin?: string;
  organizationId: string;
  laborRate?: number;
}

export function ServiceVehicleCardRich({
  vehicleId,
  vehicleYear = 0,
  vehicleMake = '',
  vehicleModel = '',
  vehicleVin,
  organizationId,
  laborRate = 125
}: ServiceVehicleCardRichProps) {
  const navigate = useNavigate();
  const [stats, setStats] = useState<ServiceStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadServiceStats();
  }, [vehicleId, organizationId]);

  const loadServiceStats = async () => {
    try {
      // Get timeline events for this vehicle from this org
      const { data: events, error: eventsError } = await supabase
        .from('timeline_events')
        .select('id, event_date, title, metadata, duration_hours, cost_amount')
        .eq('vehicle_id', vehicleId)
        .eq('organization_id', organizationId)
        .order('event_date', { ascending: false });

      if (eventsError) throw eventsError;

      // Get recent images
      const { data: images, error: imagesError } = await supabase
        .from('vehicle_images')
        .select('id, image_url, thumbnail_url, taken_at')
        .eq('vehicle_id', vehicleId)
        .not('taken_at', 'is', null)
        .order('taken_at', { ascending: false })
        .limit(6);

      if (imagesError) throw imagesError;

      // Calculate stats
      let totalSessions = events?.length || 0;
      let totalImages = 0;
      let totalHours = 0;
      let workTypes = new Set<string>();

      events?.forEach(event => {
        const meta = event.metadata || {};
        totalImages += meta.image_count || 0;
        totalHours += meta.duration_hours || event.duration_hours || 0;
        
        // Extract work type from title
        if (event.title?.includes('Paint') || event.title?.includes('paint')) workTypes.add('Paint');
        if (event.title?.includes('Body') || event.title?.includes('body')) workTypes.add('Body Work');
        if (event.title?.includes('Interior') || event.title?.includes('interior')) workTypes.add('Interior');
        if (event.title?.includes('Engine') || event.title?.includes('engine')) workTypes.add('Mechanical');
        if (event.title?.includes('Upholster')) workTypes.add('Upholstery');
      });

      const estimatedCost = totalHours * laborRate;

      setStats({
        totalSessions,
        totalImages,
        totalHours: Math.round(totalHours * 10) / 10,
        estimatedCost,
        firstSession: events?.length ? events[events.length - 1]?.event_date : null,
        lastSession: events?.length ? events[0]?.event_date : null,
        recentImages: images?.map(img => img.thumbnail_url || img.image_url) || [],
        workTypes: Array.from(workTypes)
      });

    } catch (err) {
      console.error('Error loading service stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
  };

  if (loading) {
    return (
      <div style={{ 
        padding: '16px', 
        marginBottom: '12px', 
        border: '2px solid var(--border)', 
        borderRadius: '4px',
        background: 'var(--card-bg)'
      }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '10pt' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div 
      style={{ 
        padding: '0', 
        marginBottom: '12px', 
        border: '2px solid var(--border)', 
        borderRadius: '4px',
        background: 'var(--card-bg)',
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.12s ease'
      }}
      onClick={() => navigate(`/vehicle/${vehicleId}`)}
      onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent)'}
      onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      {/* Image Grid - Top */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(6, 1fr)', 
        gap: '2px',
        background: 'var(--border)'
      }}>
        {stats?.recentImages.slice(0, 6).map((url, idx) => (
          <div key={idx} style={{ aspectRatio: '1', overflow: 'hidden' }}>
            <img 
              src={url} 
              alt=""
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'cover'
              }}
            />
          </div>
        ))}
        {/* Fill empty slots */}
        {Array.from({ length: Math.max(0, 6 - (stats?.recentImages.length || 0)) }).map((_, idx) => (
          <div key={`empty-${idx}`} style={{ 
            aspectRatio: '1', 
            background: 'var(--surface-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: '12pt', opacity: 0.3 }}>+</span>
          </div>
        ))}
      </div>

      {/* Content */}
      <div style={{ padding: '12px' }}>
        {/* Vehicle Name */}
        <div style={{ 
          fontSize: '10pt', 
          fontWeight: 700, 
          color: 'var(--text-primary)',
          marginBottom: '4px'
        }}>
          {vehicleYear || ''} {vehicleMake || ''} {vehicleModel || 'Unknown Vehicle'}
        </div>

        {/* Work Type Tags */}
        {stats?.workTypes && stats.workTypes.length > 0 && (
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
            {stats.workTypes.map(type => (
              <span key={type} style={{
                fontSize: '8pt',
                padding: '2px 6px',
                borderRadius: '2px',
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                fontWeight: 600
              }}>
                {type}
              </span>
            ))}
          </div>
        )}

        {/* Stats Grid */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(3, 1fr)', 
          gap: '8px',
          marginBottom: '8px'
        }}>
          <div>
            <div style={{ fontSize: '12pt', fontWeight: 700, color: 'var(--accent)' }}>
              {stats?.totalSessions || 0}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Sessions
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12pt', fontWeight: 700, color: 'var(--text-primary)' }}>
              {stats?.totalHours || 0}h
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Hours
            </div>
          </div>
          <div>
            <div style={{ fontSize: '12pt', fontWeight: 700, color: 'var(--success, #22c55e)' }}>
              {formatCurrency(stats?.estimatedCost || 0)}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
              Est. Value
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div style={{ 
          fontSize: '9pt', 
          color: 'var(--text-secondary)',
          display: 'flex',
          justifyContent: 'space-between',
          borderTop: '1px solid var(--border-light)',
          paddingTop: '8px'
        }}>
          <span>{stats?.totalImages || 0} photos documented</span>
          <span>
            {stats?.firstSession && stats?.lastSession 
              ? `${formatDate(stats.firstSession)} - ${formatDate(stats.lastSession)}`
              : 'No dates'
            }
          </span>
        </div>
      </div>
    </div>
  );
}

export default ServiceVehicleCardRich;

