import React, { useEffect, useState } from 'react';
import { ZoneLayout } from '../shared/ZoneLayout';
import { supabase } from '../../lib/supabaseClient';
import '../styles/verification-zone.css';

interface VerificationZoneProps {
  vehicleId: string;
  className?: string;
}

interface Verification {
  id: string;
  vehicle_id: string;
  verification_type: string;
  verification_date: string;
  verified_by: string;
  verified_by_id: string;
  ptz_center_id: string | null;
  ptz_center_name: string | null;
  documentation_urls: string[];
  verification_notes: string;
  status: 'pending' | 'verified' | 'rejected';
}

/**
 * Verification Zone Component
 * 
 * Displays and manages the verification aspects of a vehicle:
 * - PTZ verification documentation
 * - Professional recognition elements
 * - Multi-angle video documentation
 * - Trust indicators and confidence scoring
 */
export const VerificationZone: React.FC<VerificationZoneProps> = ({
  vehicleId,
  className = ''
}) => {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchVerificationData() {
      try {
        setLoading(true);
        
        // Real data approach using the Supabase client
        const { data, error } = await supabase
          .from('vehicle_verifications')
          .select('*')
          .eq('vehicle_id', vehicleId)
          .order('verification_date', { ascending: false });
          
        if (error) throw error;
        
        setVerifications(data || []);
      } catch (err: any) {
        console.error('Error fetching verification data:', err);
        setError(err.message || 'Failed to load verification data');
      } finally {
        setLoading(false);
      }
    }
    
    if (vehicleId) {
      fetchVerificationData();
    }
  }, [vehicleId]);

  // Format date for display
  const formatDate = (dateString: string) => {
    const options: Intl.DateTimeFormatOptions = { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    };
    return new Date(dateString).toLocaleDateString(undefined, options);
  };

  // Get icon for verification type
  const getVerificationIcon = (type: string) => {
    switch (type) {
      case 'physical_inspection': return '🔍';
      case 'document_validation': return '📋';
      case 'professional_assessment': return '👨‍🔧';
      case 'ptz_verification': return '📹';
      case 'ownership_transfer': return '🔄';
      case 'restoration_validation': return '🛠️';
      case 'third_party_certification': return '🏅';
      default: return '✓';
    }
  };

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'verified': return 'var(--ios-green)';
      case 'pending': return 'var(--ios-yellow)';
      case 'rejected': return 'var(--ios-red)';
      default: return 'var(--ios-gray)';
    }
  };

  return (
    <ZoneLayout 
      title="Physical Verification" 
      className={`verification-zone ${className}`}
    >
      <div className="verification-content">
        <div className="verification-header">
          <div className="verification-summary">
            <div className="verification-counts">
              <div className="count-item">
                <span className="count-value">{verifications.filter(v => v.status === 'verified').length}</span>
                <span className="count-label">Verified</span>
              </div>
              <div className="count-item">
                <span className="count-value">{verifications.filter(v => v.status === 'pending').length}</span>
                <span className="count-label">Pending</span>
              </div>
              <div className="count-item">
                <span className="count-value">{verifications.filter(v => v.ptz_center_id).length}</span>
                <span className="count-label">PTZ Verified</span>
              </div>
            </div>
            
            <div className="verification-actions">
              <button className="verification-action-btn primary">
                Schedule Verification
              </button>
              <button className="verification-action-btn secondary">
                Upload Documentation
              </button>
            </div>
          </div>
        </div>
        
        {loading ? (
          <div className="verification-loading">
            <div className="verification-loading-spinner"></div>
            <p>Loading verification data...</p>
          </div>
        ) : error ? (
          <div className="verification-error">
            <p>Error: {error}</p>
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        ) : verifications.length > 0 ? (
          <div className="verification-records">
            {verifications.map((verification) => (
              <div key={verification.id} className="verification-record">
                <div className="verification-icon">
                  {getVerificationIcon(verification.verification_type)}
                </div>
                
                <div className="verification-details">
                  <div className="verification-record-header">
                    <h3 className="verification-type">
                      {verification.verification_type.split('_').map(
                        word => word.charAt(0).toUpperCase() + word.slice(1)
                      ).join(' ')}
                    </h3>
                    
                    <div 
                      className="verification-status"
                      style={{ '--status-color': getStatusColor(verification.status) } as React.CSSProperties}
                    >
                      {verification.status.charAt(0).toUpperCase() + verification.status.slice(1)}
                    </div>
                  </div>
                  
                  <div className="verification-meta">
                    <div className="verification-date">
                      {formatDate(verification.verification_date)}
                    </div>
                    
                    <div className="verification-verifier">
                      Verified by: <strong>{verification.verified_by}</strong>
                      {verification.ptz_center_name && (
                        <span className="ptz-badge">
                          PTZ Center: {verification.ptz_center_name}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {verification.verification_notes && (
                    <div className="verification-notes">
                      {verification.verification_notes}
                    </div>
                  )}
                  
                  {verification.documentation_urls && verification.documentation_urls.length > 0 && (
                    <div className="verification-docs">
                      <h4 className="docs-title">Documentation</h4>
                      <div className="docs-grid">
                        {verification.documentation_urls.map((url, index) => (
                          <div key={index} className="doc-item">
                            <div className="doc-preview">
                              <img src={url} alt={`Verification document ${index + 1}`} />
                            </div>
                            <button className="doc-view-btn">View</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="verification-empty">
            <p>No verification records found for this vehicle.</p>
            <p className="verification-suggestion">
              Physical verification helps establish trust and authenticity.
              Schedule a verification at a PTZ center to enhance your vehicle's digital profile.
            </p>
          </div>
        )}
      </div>
    </ZoneLayout>
  );
};

export default VerificationZone;
