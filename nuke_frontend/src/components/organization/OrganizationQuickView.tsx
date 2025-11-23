import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import '../../design-system.css';

interface OrganizationQuickViewProps {
  organizationId: string;
  isOpen: boolean;
  onClose: () => void;
}

interface OrganizationData {
  id: string;
  business_name: string;
  business_type?: string;
  city?: string;
  state?: string;
  logo_url?: string;
  description?: string;
  website?: string;
  phone?: string;
  email?: string;
}

const OrganizationQuickView = ({ organizationId, isOpen, onClose }: OrganizationQuickViewProps) => {
  const navigate = useNavigate();
  const [organization, setOrganization] = useState<OrganizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [vehicleCount, setVehicleCount] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen && organizationId) {
      loadOrganizationData();
    }
  }, [isOpen, organizationId]);

  const loadOrganizationData = async () => {
    try {
      setLoading(true);

      // Fetch organization data
      const { data: orgData, error: orgError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', organizationId)
        .single();

      if (orgError) throw orgError;
      setOrganization(orgData as any);

      // Fetch vehicle count
      const { count, error: countError } = await supabase
        .from('organization_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'active');

      if (!countError) {
        setVehicleCount(count);
      }
    } catch (error) {
      console.error('Error loading organization data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleViewFullProfile = () => {
    navigate(`/org/${organizationId}`);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
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
          background: 'white',
          borderRadius: '4px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          border: '2px solid #000'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div className="text text-muted">Loading organization...</div>
          </div>
        ) : organization ? (
          <>
            {/* Header */}
            <div style={{
              padding: '20px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: '16px'
            }}>
              {organization.logo_url ? (
                <img
                  src={organization.logo_url}
                  alt={organization.business_name}
                  style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '4px',
                    objectFit: 'cover',
                    border: '1px solid var(--border)'
                  }}
                />
              ) : (
                <div style={{
                  width: '60px',
                  height: '60px',
                  borderRadius: '4px',
                  background: 'var(--grey-100)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px',
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)'
                }}>
                  {organization.business_name.charAt(0).toUpperCase()}
                </div>
              )}
              <div style={{ flex: 1 }}>
                <h2 style={{ fontSize: '16pt', fontWeight: 700, margin: '0 0 4px 0' }}>
                  {organization.business_name}
                </h2>
                {organization.business_type && (
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                    {organization.business_type}
                  </div>
                )}
                {(organization.city || organization.state) && (
                  <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {[organization.city, organization.state].filter(Boolean).join(', ')}
                  </div>
                )}
              </div>
              <button
                onClick={onClose}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: '24px',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  color: 'var(--text-muted)',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div style={{ padding: '20px' }}>
              {organization.description && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '4px', color: 'var(--text-muted)' }}>
                    Description
                  </div>
                  <div style={{ fontSize: '10pt', lineHeight: 1.5 }}>
                    {organization.description}
                  </div>
                </div>
              )}

              {/* Contact Info */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '8px', color: 'var(--text-muted)' }}>
                  Contact Information
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '10pt' }}>
                  {organization.phone && (
                    <div>Phone: {organization.phone}</div>
                  )}
                  {organization.email && (
                    <div>Email: {organization.email}</div>
                  )}
                  {organization.website && (
                    <div>
                      Website:{' '}
                      <a
                        href={organization.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--accent)', textDecoration: 'none' }}
                      >
                        {organization.website}
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* Stats */}
              {vehicleCount !== null && (
                <div style={{
                  padding: '12px',
                  background: 'var(--grey-50)',
                  borderRadius: '4px',
                  marginBottom: '16px'
                }}>
                  <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '4px', color: 'var(--text-muted)' }}>
                    Vehicles
                  </div>
                  <div style={{ fontSize: '14pt', fontWeight: 700 }}>
                    {vehicleCount}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                <button
                  onClick={handleViewFullProfile}
                  className="button button-primary"
                  style={{ flex: 1 }}
                >
                  View Full Profile
                </button>
                <button
                  onClick={onClose}
                  className="button"
                  style={{ flex: 1 }}
                >
                  Close
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div className="text text-muted">Organization not found</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrganizationQuickView;

