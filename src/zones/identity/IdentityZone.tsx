import React, { useEffect, useState } from 'react';
import { ZoneLayout } from '../shared/ZoneLayout';
import { supabase } from '../../lib/supabaseClient';
import '../styles/identity-zone.css';

interface IdentityZoneProps {
  vehicleId: string;
  className?: string;
}

/**
 * Identity Zone Component
 * 
 * Displays the core identity information for a vehicle including:
 * - Make, model, year
 * - VIN and registration information
 * - Digital identity verification status
 * - Primary vehicle image
 * - Key attributes and specifications
 */
export const IdentityZone: React.FC<IdentityZoneProps> = ({ 
  vehicleId,
  className = ''
}) => {
  const [vehicle, setVehicle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVehicleData() {
      try {
        setLoading(true);
        
        // Real data approach - following the multi-source connector framework
        const { data, error } = await supabase
          .from('vehicles')
          .select(`
            *,
            vehicle_attributes(*),
            vehicle_images(url, primary, verified),
            verification_status(*),
            ownership_history(*)
          `)
          .eq('id', vehicleId)
          .single();
          
        if (error) throw error;
        setVehicle(data);
      } catch (err: any) {
        console.error('Error fetching vehicle data:', err);
        setError(err.message || 'Failed to load vehicle data');
      } finally {
        setLoading(false);
      }
    }
    
    if (vehicleId) {
      fetchVehicleData();
    }
  }, [vehicleId]);

  // Format the confidence score into a percentage
  const confidenceScore = vehicle?.verification_status?.confidence_score || 0;
  const formattedConfidence = `${Math.round(confidenceScore * 100)}%`;
  
  // Get the primary image or the first available image
  const primaryImage = vehicle?.vehicle_images?.find((img: any) => img.primary) || 
                       (vehicle?.vehicle_images?.length > 0 ? vehicle.vehicle_images[0] : null);

  return (
    <ZoneLayout 
      title="Vehicle Identity" 
      className={`identity-zone ${className}`}
    >
      {loading ? (
        <div className="identity-loading">
          <div className="identity-loading-spinner"></div>
          <p>Loading vehicle identity...</p>
        </div>
      ) : error ? (
        <div className="identity-error">
          <p>Error: {error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      ) : vehicle ? (
        <div className="identity-content">
          <div className="identity-header">
            <h1 className="identity-title">
              {vehicle.year} {vehicle.make} {vehicle.model}
              {vehicle.trim && <span className="identity-trim">{vehicle.trim}</span>}
            </h1>
            
            <div className="identity-confidence">
              <div className="confidence-indicator" style={{ 
                '--confidence': formattedConfidence 
              } as React.CSSProperties}>
                <span className="confidence-label">Trust Score</span>
                <span className="confidence-value">{formattedConfidence}</span>
              </div>
            </div>
          </div>
          
          <div className="identity-image-container">
            {primaryImage ? (
              <img 
                src={primaryImage.url} 
                alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                className="identity-image"
                loading="eager"
              />
            ) : (
              <div className="identity-image-placeholder">
                <span>No image available</span>
              </div>
            )}
            {primaryImage?.verified && (
              <div className="identity-image-verified">
                <span className="verified-badge">Verified</span>
              </div>
            )}
          </div>
          
          <div className="identity-details">
            <div className="identity-detail-item">
              <span className="detail-label">VIN</span>
              <span className="detail-value">{vehicle.vin || 'Not available'}</span>
            </div>
            
            <div className="identity-detail-item">
              <span className="detail-label">Engine</span>
              <span className="detail-value">
                {vehicle.vehicle_attributes?.engine_type || 'Not specified'}
              </span>
            </div>
            
            <div className="identity-detail-item">
              <span className="detail-label">Transmission</span>
              <span className="detail-value">
                {vehicle.vehicle_attributes?.transmission || 'Not specified'}
              </span>
            </div>
            
            <div className="identity-detail-item">
              <span className="detail-label">Exterior Color</span>
              <span className="detail-value">
                {vehicle.vehicle_attributes?.exterior_color || 'Not specified'}
              </span>
            </div>
            
            <div className="identity-detail-item">
              <span className="detail-label">Interior Color</span>
              <span className="detail-value">
                {vehicle.vehicle_attributes?.interior_color || 'Not specified'}
              </span>
            </div>
            
            <div className="identity-detail-item">
              <span className="detail-label">Current Owner</span>
              <span className="detail-value">
                {vehicle.ownership_history?.length > 0
                  ? vehicle.ownership_history[0].owner_name || 'Current owner'
                  : 'Not available'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="identity-not-found">
          <p>Vehicle not found</p>
        </div>
      )}
    </ZoneLayout>
  );
};

export default IdentityZone;
