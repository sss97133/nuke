// Vehicle Discovery Card Component
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { VehicleDiscoveryService } from '../../services/vehicleDiscoveryService';
import type { VehicleStatusMetadata } from '../../types/vehicleDiscovery';
import { getVehicleIdentityParts } from '../../utils/vehicleIdentity';
import { 
  getStatusLabel, 
  getStatusColor, 
  getVerificationBadge,
  getActivityHeatLabel,
  getCompletenessLabel
} from '../../types/vehicleDiscovery';

interface VehicleDiscoveryCardProps {
  vehicle: {
    id: string;
    make: string;
    model: string;
    year: number;
    primary_image_url?: string | null;
    vin?: string | null;
    mileage?: number | null;
    color?: string | null;
    [key: string]: any; // Allow additional properties from VehicleSearchResult
  };
  compact?: boolean;
}

const VehicleDiscoveryCard: React.FC<VehicleDiscoveryCardProps> = ({ vehicle, compact = false }) => {
  const [metadata, setMetadata] = useState<VehicleStatusMetadata | null>(null);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    loadMetadata();
  }, [vehicle.id]);

  const loadMetadata = async () => {
    const data = await VehicleDiscoveryService.getVehicleMetadata(vehicle.id);
    setMetadata(data);
  };

  const verificationBadge = metadata ? getVerificationBadge(metadata.verification_level) : null;
  const activityHeat = metadata ? getActivityHeatLabel(metadata.activity_heat_score) : null;
  const completeness = metadata ? getCompletenessLabel(metadata.data_completeness_score) : null;

  // Determine primary call-to-action based on metadata
  const getCallToAction = () => {
    if (!metadata) return null;
    
    if (metadata.is_for_sale) {
      return { label: 'For Sale', color: '#10b981', icon: '$' };
    }
    if (metadata.owner_seeking_info) {
      return { label: 'Help Needed', color: '#f59e0b', icon: '?' };
    }
    if (metadata.needs_photos && metadata.photos_count === 0) {
      return { label: 'Add Photos', color: '#3b82f6', icon: '' };
    }
    if (metadata.data_completeness_score < 30) {
      return { label: 'Add Info', color: '#ef4444', icon: '+' };
    }
    if (metadata.needs_verification) {
      return { label: 'Verify Data', color: '#8b5cf6', icon: '✓' };
    }
    return null;
  };

  const callToAction = getCallToAction();

  return (
    <Link 
      to={`/vehicle/${vehicle.id}`} 
      className="vehicle-discovery-card"
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        overflow: 'hidden',
        transition: 'all 0.2s',
        backgroundColor: 'var(--surface)',
        cursor: 'pointer'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      {/* Image Section */}
      <div style={{ 
        position: 'relative',
        paddingBottom: compact ? '56.25%' : '66.67%', // 16:9 or 3:2 aspect ratio
        backgroundColor: 'var(--bg)',
        overflow: 'hidden'
      }}>
        {vehicle.primary_image_url && !imageError ? (
          <img
            src={vehicle.primary_image_url}
            alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
            onError={() => setImageError(true)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain'
            }}
          />
        ) : (
          <div style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: '#9ca3af',
            fontSize: '14px'
          }}>
            No Image
          </div>
        )}

        {/* Status Badge */}
        {metadata && (
          <div style={{
            position: 'absolute',
            top: '8px',
            left: '8px',
            backgroundColor: getStatusColor(metadata.status),
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            textTransform: 'uppercase'
          }}>
            {getStatusLabel(metadata.status)}
          </div>
        )}

        {/* Call to Action Badge */}
        {callToAction && (
          <div style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            backgroundColor: callToAction.color,
            color: 'white',
            padding: '4px 8px',
            borderRadius: '4px',
            fontSize: '11px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            <span>{callToAction.icon}</span>
            <span>{callToAction.label}</span>
          </div>
        )}

        {/* Activity Heat Indicator */}
        {metadata && metadata.activity_heat_score > 40 && (
          <div style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            backgroundColor: 'rgba(0,0,0,0.7)',
            color: activityHeat?.color,
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '10px',
            fontWeight: 600
          }}>
            🔥 {activityHeat?.label}
          </div>
        )}
      </div>

      {/* Content Section */}
      <div style={{ padding: compact ? '12px' : '16px' }}>
        {/* Title */}
        <h3 style={{ 
          margin: '0 0 4px 0',
          fontSize: compact ? '14px' : '16px',
          fontWeight: 600,
          lineHeight: 1.2
        }}>
          {(() => {
            const identity = getVehicleIdentityParts(vehicle as any);
            const primary = identity.primary.join(' ');
            const diffs = identity.differentiators;
            return `${primary || 'Vehicle'}${diffs.length > 0 ? ` • ${diffs.join(' • ')}` : ''}`;
          })()}
        </h3>

        {/* Quick Details */}
        <div style={{
          display: 'flex',
          gap: '12px',
          fontSize: '12px',
          color: '#6b7280',
          marginBottom: '8px'
        }}>
          {vehicle.mileage && (
            <span>{vehicle.mileage.toLocaleString()} mi</span>
          )}
          {vehicle.color && (
            <span>{vehicle.color}</span>
          )}
          {metadata && metadata.location_city && metadata.location_public && (
            <span>{metadata.location_city}, {metadata.location_state}</span>
          )}
        </div>

        {/* Metrics Row */}
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          flexWrap: 'wrap',
          marginTop: '8px'
        }}>
          {/* Verification Badge */}
          {verificationBadge && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
              padding: '2px 6px',
              backgroundColor: verificationBadge.color + '20',
              color: verificationBadge.color,
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: 600
            }}>
              {verificationBadge.icon && <span>{verificationBadge.icon}</span>}
              <span>{verificationBadge.label}</span>
            </div>
          )}

          {/* Completeness */}
          {completeness && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10px',
              color: '#6b7280'
            }}>
              <div style={{
                width: '40px',
                height: '4px',
                backgroundColor: '#e5e7eb',
                borderRadius: '2px',
                overflow: 'hidden'
              }}>
                <div style={{
                  width: `${metadata?.data_completeness_score || 0}%`,
                  height: '100%',
                  backgroundColor: completeness.color,
                  transition: 'width 0.3s'
                }} />
              </div>
              <span>{metadata?.data_completeness_score || 0}%</span>
            </div>
          )}

          {/* Contributors */}
          {metadata && metadata.contributor_count > 0 && (
            <div style={{
              fontSize: '10px',
              color: '#6b7280'
            }}>
              👥 {metadata.contributor_count} contributor{metadata.contributor_count !== 1 ? 's' : ''}
            </div>
          )}

          {/* Photos */}
          {metadata && metadata.photos_count > 0 && (
            <div style={{
              fontSize: '10px',
              color: '#6b7280'
            }}>
              {metadata.photos_count} photos
            </div>
          )}

          {/* Views */}
          {metadata && metadata.views_this_week > 0 && (
            <div style={{
              fontSize: '10px',
              color: '#6b7280'
            }}>
              👀 {metadata.views_this_week} this week
            </div>
          )}
        </div>

        {/* Contribution Needs */}
        {metadata && (metadata.needs_photos || metadata.needs_specifications || metadata.needs_history || metadata.needs_verification) && (
          <div style={{
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid #e5e7eb',
            fontSize: '11px',
            color: '#6b7280'
          }}>
            <div style={{ fontWeight: 600, marginBottom: '4px' }}>Can you help with:</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {metadata.needs_photos && <span>Photos needed</span>}
              {metadata.needs_specifications && <span>📋 Specs</span>}
              {metadata.needs_history && <span>📜 History</span>}
              {metadata.needs_verification && <span>✓ Verification</span>}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
};

export default VehicleDiscoveryCard;
