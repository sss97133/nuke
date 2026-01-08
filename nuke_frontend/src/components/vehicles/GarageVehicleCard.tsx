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
  const [showValueTooltip, setShowValueTooltip] = useState(false);

  const FEATURE_VEHICLE_ANALYTICS_UNAVAILABLE_KEY = 'featureVehicleAnalyticsUnavailable';

  function isMissingResourceError(err: any): boolean {
    const code = err?.code ? String(err.code) : '';
    const status = typeof err?.status === 'number' ? err.status : undefined;
    const message = err?.message ? String(err.message) : '';
    return (
      status === 404 ||
      code === 'PGRST116' ||
      code === 'PGRST301' ||
      code === '42P01' ||
      message.toLowerCase().includes('does not exist') ||
      message.toLowerCase().includes('not found')
    );
  }

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

      // De-duplicate organization relationships to prevent duplicate keys
      const unique = new Map<string, any>();
      (data || []).forEach((rel: any) => {
        const key = `${rel.organization_id || 'null'}-${rel.relationship_type || 'default'}`;
        if (!unique.has(key)) {
          unique.set(key, rel);
        }
      });

      setOrganizationRelationships(Array.from(unique.values()));
    } catch (error) {
      console.error('Error loading org relationships:', error);
    }
  };

  const loadVehicleMetrics = async () => {
    try {
      const analyticsUnavailable = typeof window !== 'undefined' && localStorage.getItem(FEATURE_VEHICLE_ANALYTICS_UNAVAILABLE_KEY) === '1';

      // Get real counts and data
      const [
        { count: imageCount, error: imageCountError },
        { count: eventCount, error: eventCountError },
        { data: latestEventRows, error: latestEventError },
        { data: valuationRows, error: valuationError },
        { count: viewCount, error: viewCountError }
      ] = await Promise.all([
        // Image count
        supabase
          .from('vehicle_images')
          .select('id', { count: 'estimated', head: true })
          .eq('vehicle_id', vehicle.id),
        
        // Timeline event count
        supabase
          .from('timeline_events')
          .select('id', { count: 'estimated', head: true })
          .eq('vehicle_id', vehicle.id),
        
        // Latest activity
        supabase
          .from('timeline_events')
          .select('event_date, event_type, title')
          .eq('vehicle_id', vehicle.id)
          .order('event_date', { ascending: false })
          .limit(1),
        
        // Latest valuation
        supabase
          .from('vehicle_valuations')
          .select('estimated_value, valuation_date, confidence_score')
          .eq('vehicle_id', vehicle.id)
          .order('valuation_date', { ascending: false })
          .limit(1),
        
        // View count (analytics)
        analyticsUnavailable
          ? Promise.resolve({ count: 0, error: null } as any)
          : supabase
              .from('vehicle_analytics')
              .select('id', { count: 'estimated', head: true })
              .eq('vehicle_id', vehicle.id)
              .eq('event_type', 'view')
      ]);

      if (imageCountError) console.warn('[GarageVehicleCard] image count unavailable:', imageCountError.message || imageCountError);
      if (eventCountError) console.warn('[GarageVehicleCard] event count unavailable:', eventCountError.message || eventCountError);
      if (latestEventError) console.warn('[GarageVehicleCard] latest event unavailable:', latestEventError.message || latestEventError);
      if (valuationError) console.warn('[GarageVehicleCard] valuation unavailable:', valuationError.message || valuationError);
      if (viewCountError) {
        if (isMissingResourceError(viewCountError)) {
          try {
            localStorage.setItem(FEATURE_VEHICLE_ANALYTICS_UNAVAILABLE_KEY, '1');
          } catch {
            // ignore
          }
        } else {
          console.warn('[GarageVehicleCard] view count unavailable:', viewCountError.message || viewCountError);
        }
      }

      const latestEvent = Array.isArray(latestEventRows) ? latestEventRows[0] : null;
      const valuation = Array.isArray(valuationRows) ? valuationRows[0] : null;

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
          fontWeight: 700,
          padding: '4px 8px',
          borderRadius: '3px',
          color: badge.color,
          background: badge.bg,
          border: `2px solid ${badge.color}`,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          backdropFilter: 'blur(4px)'
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
      {/* Image with status overlay - 16:9 aspect ratio */}
      <div style={{ 
        position: 'relative', 
        width: '100%', 
        aspectRatio: '16 / 9',
        overflow: 'hidden', 
        background: '#f3f4f6'
      }}>
        {(() => {
          // Try to get image URL from multiple sources
          let imageUrl: string | null = null;
          
          // First try: pre-loaded primaryImageUrl
          if (vehicle.primaryImageUrl && typeof vehicle.primaryImageUrl === 'string') {
            imageUrl = vehicle.primaryImageUrl;
          }
          // Second try: extract from vehicle_images array
          else if (vehicle.vehicle_images && Array.isArray(vehicle.vehicle_images) && vehicle.vehicle_images.length > 0) {
            const primaryImage = vehicle.vehicle_images.find((img: any) => img?.is_primary) || vehicle.vehicle_images[0];
            if (primaryImage) {
              imageUrl = primaryImage.variants?.large || primaryImage.variants?.medium || primaryImage.image_url || null;
            }
          }
          // Third try: fallback to vehicle.primary_image_url or vehicle.image_url
          else if (vehicle.primary_image_url && typeof vehicle.primary_image_url === 'string') {
            imageUrl = vehicle.primary_image_url;
          } else if (vehicle.image_url && typeof vehicle.image_url === 'string') {
            imageUrl = vehicle.image_url;
          }
          
          // Transform Supabase storage URLs for optimized rendering
          if (imageUrl && typeof imageUrl === 'string') {
            if (imageUrl.includes('/storage/v1/object/public/')) {
              imageUrl = imageUrl.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=632&height=356&quality=85&resize=cover';
            }
            
            return (
              <img
                src={imageUrl}
                alt={`${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''}`.trim() || 'Vehicle'}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center'
                }}
                onError={(e) => {
                  // Hide broken image - VehicleThumbnail will render as fallback
                  const target = e.target as HTMLImageElement;
                  target.style.display = 'none';
                }}
                loading="lazy"
              />
            );
          }
          
          // No image found - use VehicleThumbnail component
          return <VehicleThumbnail vehicleId={vehicle.id} />;
        })()}
        
        {/* Relationship badge - top left */}
        <div style={{ position: 'absolute', top: '6px', left: '6px' }}>
          {getStatusBadge()}
        </div>

        {/* Health score - top right */}
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            background: healthScore >= 75 ? '#dcfce7' : healthScore >= 50 ? '#fef3c7' : '#fee2e2',
            border: `2px solid ${healthScore >= 75 ? '#15803d' : healthScore >= 50 ? '#d97706' : '#dc2626'}`,
            color: healthScore >= 75 ? '#15803d' : healthScore >= 50 ? '#b45309' : '#991b1b',
            padding: '4px 8px',
            borderRadius: '3px',
            fontSize: '7pt',
            fontWeight: 700,
            backdropFilter: 'blur(4px)'
          }}
        >
          {healthScore}%
        </div>

        {/* Image count indicator - bottom left */}
        {liveData && liveData.imageCount > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              left: '8px',
              background: 'rgba(0,0,0,0.75)',
              color: '#fff',
              padding: '4px 8px',
              borderRadius: '3px',
              fontSize: '7pt',
              fontWeight: 600,
              backdropFilter: 'blur(4px)'
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
            fontSize: '11pt',
            fontWeight: 700,
            margin: '0 0 8px 0',
            lineHeight: 1.3,
            color: '#111827'
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
                <span style={{ color: '#4b5563', fontWeight: 500 }}>Value: </span>
                <span style={{ fontWeight: 700, color: '#111827' }}>
                  {formatCurrency(vehicle.current_value)}
                </span>
                <span
                  style={{
                    marginLeft: '6px',
                    color: vehicle.current_value >= vehicle.purchase_price ? '#15803d' : '#dc2626',
                    fontWeight: 700
                  }}
                >
                  {vehicle.current_value >= vehicle.purchase_price ? '+' : ''}
                  {formatCurrency(vehicle.current_value - vehicle.purchase_price)}
                </span>
              </div>
            ) : vehicle.current_value ? (
              <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                <span style={{ color: '#4b5563', fontWeight: 500 }}>Value: </span>
                <span style={{ fontWeight: 700, color: '#111827' }}>{formatCurrency(vehicle.current_value)}</span>
              </div>
            ) : null}

            {/* Latest activity */}
            {liveData.latestEvent ? (
              <div style={{ fontSize: '8pt', marginBottom: '4px' }}>
                <span style={{ color: '#4b5563', fontWeight: 500 }}>Last: </span>
                <span style={{ color: '#111827', fontWeight: 500 }}>
                  {liveData.latestEvent.title || liveData.latestEvent.event_type}
                </span>
                <span style={{ color: '#6b7280', marginLeft: '4px' }}>
                  {getTimeAgo(liveData.latestEvent.event_date)}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: '8pt', marginBottom: '4px', color: '#6b7280' }}>
                No activity yet
              </div>
            )}

            {/* Stats row */}
            <div
              style={{
                display: 'flex',
                gap: '8px',
                fontSize: '7pt',
                color: '#4b5563',
                borderTop: '1px solid #e5e7eb',
                paddingTop: '8px',
                marginTop: '6px'
              }}
            >
              <span style={{ fontWeight: 500 }}>{liveData.eventCount} events</span>
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
              position: 'relative',
              marginTop: '8px',
              padding: '8px 10px',
              background: primaryAction.type === 'critical' ? '#fff5f5' : primaryAction.type === 'high' ? '#fffbeb' : '#f9fafb',
              border: `2px solid ${primaryAction.type === 'critical' ? '#dc2626' : primaryAction.type === 'high' ? '#d97706' : '#6b7280'}`,
              borderRadius: '2px'
            }}
            onMouseEnter={(e) => {
              if (primaryAction.text === 'Set Value') {
                setShowValueTooltip(true);
              }
            }}
            onMouseLeave={() => setShowValueTooltip(false)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Navigate to specific action
              window.location.href = `/vehicle/${vehicle.id}`;
            }}
          >
            <div
              style={{
                fontSize: '8pt',
                fontWeight: 700,
                color: primaryAction.type === 'critical' ? '#991b1b' : primaryAction.type === 'high' ? '#92400e' : '#1f2937',
                marginBottom: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              {primaryAction.icon} {primaryAction.text}
            </div>
            <div style={{ 
              fontSize: '7pt', 
              color: primaryAction.type === 'critical' ? '#7f1d1d' : primaryAction.type === 'high' ? '#78350f' : '#374151',
              lineHeight: 1.4
            }}>
              {primaryAction.reason}
            </div>
            
            {/* Tooltip for Set Value / Track Investment */}
            {showValueTooltip && primaryAction.text === 'Set Value' && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: '8px',
                  padding: '10px 12px',
                  background: '#1f2937',
                  color: '#fff',
                  borderRadius: '4px',
                  fontSize: '7pt',
                  lineHeight: 1.5,
                  whiteSpace: 'nowrap',
                  zIndex: 1000,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  border: '1px solid #374151'
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '4px' }}>Track Your Investment</div>
                <div style={{ color: '#d1d5db' }}>
                  Set purchase price and current value to see your vehicle's ROI over time
                </div>
                <div
                  style={{
                    position: 'absolute',
                    bottom: '-4px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: 0,
                    height: 0,
                    borderLeft: '4px solid transparent',
                    borderRight: '4px solid transparent',
                    borderTop: '4px solid #1f2937'
                  }}
                />
              </div>
            )}
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
            {organizationRelationships.map((orgRel, orgIndex) => {
              // Create a unique composite key that handles all edge cases
              const orgId = orgRel.organization_id || `null-org-${orgIndex}`;
              const relType = orgRel.relationship_type || 'default';
              const uniqueKey = `metrics-${vehicle.id}-${orgId}-${relType}-${orgIndex}`;
              return (
                <VehicleRelationshipMetrics
                  key={uniqueKey}
                  vehicleId={vehicle.id}
                  organizationId={orgRel.organization_id}
                  relationshipType={orgRel.relationship_type}
                  userId={session.user.id}
                />
              );
            })}
          </div>
        )}
      </div>
    </Link>
  );
};

export default GarageVehicleCard;

