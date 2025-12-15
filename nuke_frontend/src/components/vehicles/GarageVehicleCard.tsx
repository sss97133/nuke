import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import VehicleThumbnail from '../VehicleThumbnail';
import VehicleRelationshipMetrics from './VehicleRelationshipMetrics';
import '../../design-system.css';

interface GarageVehicleCardProps {
  vehicle: any;
  relationship?: {
    relationshipType: 'owned' | 'contributing' | 'interested' | 'discovered' | 'curated' | 'consigned' | 'previously_owned';
    role?: string;
    context?: string;
  };
  onRefresh?: () => void;
  onEditRelationship?: (vehicleId: string, currentRelationship: string | null) => void;
}

const GarageVehicleCard: React.FC<GarageVehicleCardProps> = ({ vehicle, relationship, onRefresh, onEditRelationship }) => {
  const [liveData, setLiveData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [organizationRelationships, setOrganizationRelationships] = useState<any[]>([]);
  const [session, setSession] = useState<any>(null);

  // Load actual metrics for this vehicle
  useEffect(() => {
    loadVehicleMetrics();
    loadOrganizationRelationships();
    loadSession();
  }, [vehicle.id]);

  const loadSession = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
  };

  const loadOrganizationRelationships = async () => {
    try {
      const { data, error } = await supabase
        .from('organization_vehicles')
        .select('organization_id, relationship_type, status')
        .eq('vehicle_id', vehicle.id)
        .eq('status', 'active');

      if (error) {
        console.error('Error loading org relationships:', error);
        return;
      }

      setOrganizationRelationships(data || []);
    } catch (error) {
      console.error('Error loading org relationships:', error);
    }
  };

  const loadVehicleMetrics = async () => {
    try {
      // Get real counts and data
      const [
        { count: imageCount },
        { count: eventCount },
        { data: latestEvent },
        { data: valuation },
        { count: viewCount }
      ] = await Promise.all([
        // Image count
        supabase
          .from('vehicle_images')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicle.id),
        
        // Timeline event count
        supabase
          .from('timeline_events')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicle.id),
        
        // Latest activity
        supabase
          .from('timeline_events')
          .select('event_date, event_type, title')
          .eq('vehicle_id', vehicle.id)
          .order('event_date', { ascending: false })
          .limit(1)
          .single(),
        
        // Latest valuation
        supabase
          .from('vehicle_valuations')
          .select('estimated_value, valuation_date, confidence_score')
          .eq('vehicle_id', vehicle.id)
          .order('valuation_date', { ascending: false })
          .limit(1)
          .single(),
        
        // View count (analytics)
        supabase
          .from('vehicle_analytics')
          .select('*', { count: 'exact', head: true })
          .eq('vehicle_id', vehicle.id)
          .eq('event_type', 'view')
      ]);

      setLiveData({
        imageCount: imageCount || 0,
        eventCount: eventCount || 0,
        latestEvent: latestEvent || null,
        valuation: valuation || null,
        viewCount: viewCount || 0
      });
    } catch (error) {
      console.error('Error loading vehicle metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
    
    if (diffInHours < 1) return 'Just now';
    if (diffInHours < 24) return `${diffInHours}h ago`;
    if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
    return `${Math.floor(diffInHours / 168)}w ago`;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const getStatusBadge = () => {
    if (!relationship) return null;
    
    const badges: Record<string, { text: string; color: string; bg: string }> = {
      owned: { text: relationship.role || 'Verified Owner', color: '#166534', bg: '#dcfce7' },
      contributing: { text: 'Contributor', color: '#1e40af', bg: '#dbeafe' },
      interested: { text: 'Watching', color: '#92400e', bg: '#fef3c7' },
      discovered: { text: 'Discovered', color: '#6b21a8', bg: '#f3e8ff' },
      curated: { text: 'Curated', color: '#b45309', bg: '#fed7aa' },
      consigned: { text: 'Consigned', color: '#0e7490', bg: '#cffafe' },
      previously_owned: { text: 'Previous Owner', color: '#4b5563', bg: '#e5e7eb' }
    };

    const badge = badges[relationship.relationshipType];
    if (!badge) return null;

    return (
      <span
        style={{
          fontSize: '7pt',
          fontWeight: 600,
          padding: '2px 6px',
          borderRadius: '2px',
          color: badge.color,
          background: badge.bg,
          border: `1px solid ${badge.color}40`,
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}
      >
        {badge.text}
      </span>
    );
  };

  // Calculate what action is most important
  const getPrimaryAction = () => {
    if (!liveData) return null;

    // Priority 1: No value set
    if (!vehicle.current_value && !vehicle.purchase_price) {
      return {
        text: 'Set Value',
        type: 'critical',
        icon: '$',
        reason: 'Track your investment'
      };
    }

    // Priority 2: No photos (but has events)
    if (liveData.eventCount > 0 && liveData.imageCount === 0) {
      return {
        text: 'Add Photos',
        type: 'high',
        icon: 'IMG',
        reason: `${liveData.eventCount} events need documentation`
      };
    }

    // Priority 3: No activity in 30+ days
    if (liveData.latestEvent) {
      const daysSinceActivity = Math.floor(
        (new Date().getTime() - new Date(liveData.latestEvent.event_date).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceActivity > 30) {
        return {
          text: 'Log Activity',
          type: 'medium',
          icon: 'TIME',
          reason: `${daysSinceActivity} days since last update`
        };
      }
    }

    // Priority 4: No activity at all
    if (liveData.eventCount === 0 && liveData.imageCount === 0) {
      return {
        text: 'Start Building',
        type: 'high',
        icon: 'NEW',
        reason: 'Document your first work'
      };
    }

    return null;
  };

  const primaryAction = getPrimaryAction();

  // Calculate health score (0-100)
  const getHealthScore = () => {
    let score = 0;
    if (!liveData) return 0;

    // Has value info: +25
    if (vehicle.current_value || vehicle.purchase_price) score += 25;

    // Has images: +25
    if (liveData.imageCount > 0) score += 25;

    // Has timeline events: +25
    if (liveData.eventCount > 0) score += 25;

    // Recent activity (within 30 days): +25
    if (liveData.latestEvent) {
      const daysSinceActivity = Math.floor(
        (new Date().getTime() - new Date(liveData.latestEvent.event_date).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceActivity <= 30) score += 25;
    }

    return score;
  };

  const healthScore = getHealthScore();

  return (
    <Link
      to={`/vehicle/${vehicle.id}`}
      style={{
        display: 'block',
        background: 'var(--surface)',
        border: '2px solid #c0c0c0',
        borderRadius: '2px',
        overflow: 'hidden',
        textDecoration: 'none',
        color: 'inherit',
        transition: 'all 0.12s ease',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#000';
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#c0c0c0';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Image with status overlay */}
      <div style={{ position: 'relative', width: '100%', height: '140px', overflow: 'hidden', background: '#f5f5f5' }}>
        <VehicleThumbnail vehicleId={vehicle.id} />
        
        {/* Relationship badge - top left */}
        <div style={{ position: 'absolute', top: '6px', left: '6px' }}>
          {getStatusBadge()}
        </div>

        {/* Health score - top right */}
        <div
          style={{
            position: 'absolute',
            top: '6px',
            right: '6px',
            background: healthScore >= 75 ? '#dcfce7' : healthScore >= 50 ? '#fef3c7' : '#fee2e2',
            border: `1px solid ${healthScore >= 75 ? '#166534' : healthScore >= 50 ? '#92400e' : '#991b1b'}`,
            color: healthScore >= 75 ? '#166534' : healthScore >= 50 ? '#92400e' : '#991b1b',
            padding: '2px 6px',
            borderRadius: '2px',
            fontSize: '7pt',
            fontWeight: 700
          }}
        >
          {healthScore}%
        </div>

        {/* Image count indicator - bottom left */}
        {liveData && liveData.imageCount > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '6px',
              left: '6px',
              background: 'rgba(0,0,0,0.7)',
              color: 'white',
              padding: '2px 6px',
              borderRadius: '2px',
              fontSize: '7pt',
              fontWeight: 600
            }}
          >
            {liveData.imageCount} photos
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: '10px' }}>
        {/* Vehicle name */}
        <h3
          style={{
            fontSize: '10pt',
            fontWeight: 700,
            margin: '0 0 6px 0',
            lineHeight: 1.2,
            color: '#000'
          }}
        >
          {vehicle.year} {vehicle.make} {vehicle.model}
        </h3>

        {/* Key metrics grid */}
        {!loading && liveData && (
          <div style={{ marginBottom: '8px' }}>
            {/* Value/ROI */}
            {vehicle.current_value && vehicle.purchase_price ? (
              <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                <span style={{ color: '#6b7280' }}>Value: </span>
                <span style={{ fontWeight: 700 }}>
                  {formatCurrency(vehicle.current_value)}
                </span>
                <span
                  style={{
                    marginLeft: '6px',
                    color: vehicle.current_value >= vehicle.purchase_price ? '#166534' : '#991b1b',
                    fontWeight: 600
                  }}
                >
                  {vehicle.current_value >= vehicle.purchase_price ? '+' : ''}
                  {formatCurrency(vehicle.current_value - vehicle.purchase_price)}
                </span>
              </div>
            ) : vehicle.current_value ? (
              <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                <span style={{ color: '#6b7280' }}>Value: </span>
                <span style={{ fontWeight: 700 }}>{formatCurrency(vehicle.current_value)}</span>
              </div>
            ) : null}

            {/* Latest activity */}
            {liveData.latestEvent ? (
              <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                <span style={{ color: '#6b7280' }}>Last: </span>
                <span style={{ color: '#000' }}>
                  {liveData.latestEvent.title || liveData.latestEvent.event_type}
                </span>
                <span style={{ color: '#9ca3af', marginLeft: '4px' }}>
                  {getTimeAgo(liveData.latestEvent.event_date)}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: '8pt', marginBottom: '4px', color: '#9ca3af' }}>
                No activity yet
              </div>
            )}

            {/* Stats row */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                fontSize: '7pt',
                color: '#6b7280',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '6px'
              }}
            >
              <span>{liveData.eventCount} events</span>
              <span>·</span>
              <span>{liveData.viewCount} views</span>
              {vehicle.mileage && (
                <>
                  <span>·</span>
                  <span>{(vehicle.mileage / 1000).toFixed(0)}k mi</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Primary action callout */}
        {primaryAction && (
          <div
            style={{
              marginTop: '8px',
              padding: '6px 8px',
              background: primaryAction.type === 'critical' ? '#fee2e2' : primaryAction.type === 'high' ? '#fef3c7' : '#f3f4f6',
              border: `1px solid ${primaryAction.type === 'critical' ? '#991b1b' : primaryAction.type === 'high' ? '#92400e' : '#9ca3af'}`,
              borderRadius: '2px'
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Navigate to specific action
              window.location.href = `/vehicle/${vehicle.id}`;
            }}
          >
            <div
              style={{
                fontSize: '7pt',
                fontWeight: 700,
                color: primaryAction.type === 'critical' ? '#991b1b' : primaryAction.type === 'high' ? '#92400e' : '#4b5563',
                marginBottom: '2px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              {primaryAction.icon} {primaryAction.text}
            </div>
            <div style={{ fontSize: '7pt', color: '#6b7280' }}>
              {primaryAction.reason}
            </div>
          </div>
        )}

        {/* Relationship edit link */}
        {relationship && onEditRelationship && (
          <div
            style={{
              marginTop: '6px',
              fontSize: '7pt',
              color: '#2563eb',
              textDecoration: 'underline',
              cursor: 'pointer'
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEditRelationship(vehicle.id, relationship.relationshipType);
            }}
          >
            Edit relationship
          </div>
        )}

        {/* Relationship-aware metrics */}
        {organizationRelationships.length > 0 && session?.user?.id && (
          <div onClick={(e) => e.stopPropagation()}>
            {organizationRelationships.map((orgRel) => (
              <VehicleRelationshipMetrics
                key={orgRel.organization_id}
                vehicleId={vehicle.id}
                organizationId={orgRel.organization_id}
                relationshipType={orgRel.relationship_type}
                userId={session.user.id}
              />
            ))}
          </div>
        )}
      </div>
    </Link>
  );
};

export default GarageVehicleCard;

