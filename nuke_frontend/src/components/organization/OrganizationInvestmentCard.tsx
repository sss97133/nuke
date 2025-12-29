import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { getOrgInvestorMetrics, type OrgMetricData } from '../../utils/orgInvestorMetrics';
import { FaviconIcon } from '../common/FaviconIcon';

interface OrganizationInvestmentCardProps {
  organizationId: string;
  organizationName: string;
  relationshipType: string;
  onClose: () => void;
  anchorElement?: HTMLElement | null;
}

const OrganizationInvestmentCard: React.FC<OrganizationInvestmentCardProps> = ({
  organizationId,
  organizationName,
  relationshipType,
  onClose,
  anchorElement
}) => {
  const [loading, setLoading] = useState(true);
  const [orgData, setOrgData] = useState<any | null>(null);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    loadOrganizationData();
  }, [organizationId]);

  useEffect(() => {
    if (anchorElement) {
      const rect = anchorElement.getBoundingClientRect();
      setPosition({
        top: rect.bottom + 8,
        left: rect.left
      });
    }
  }, [anchorElement]);

  const loadOrganizationData = async () => {
    try {
      setLoading(true);

      // Load organization with intelligence data
      const { data: org, error: orgError } = await supabase
        .from('businesses')
        .select('*')
        .eq('id', organizationId)
        .single();

      if (orgError) throw orgError;

      // Load organization intelligence
      const { data: intelligence } = await supabase
        .from('organization_intelligence')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

      // Use business table totals (more accurate) + count from organization_vehicles as fallback
      const { count: orgVehicleCount } = await supabase
        .from('organization_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId);

      // Use the higher of the two counts (businesses.total_vehicles vs org_vehicles count)
      const totalVehicles = Math.max(
        org.total_vehicles || 0,
        orgVehicleCount || 0
      );
      
      // Get sold count from organization_vehicles
      const { count: soldCount } = await supabase
        .from('organization_vehicles')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .in('relationship_type', ['sold_by', 'sold', 'auctioned_by']);

      // Build metric data using the org's denormalized fields where available
      const metricData: OrgMetricData = {
        business_type: org.business_type,
        primary_focus: intelligence?.effective_primary_focus || org.primary_focus,
        total_vehicles: totalVehicles,
        total_sales: org.total_sold || soldCount || 0,
        total_revenue: org.total_revenue || 0,
        total_inventory: org.total_listings || 0,
        ...(intelligence || {}),
      };

      // Get investor metrics
      const investorMetrics = getOrgInvestorMetrics(metricData, { type: 'investor' });

      setOrgData(org);
      setMetrics(investorMetrics);
    } catch (error) {
      console.error('Error loading organization data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(0)}K`;
    }
    return `$${value.toLocaleString()}`;
  };

  const formatRelationship = (rel: string) => {
    return rel
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (!position) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          background: 'transparent'
        }}
        onClick={onClose}
      />
      
      {/* Card */}
      <div
        className="card"
        style={{
          position: 'fixed',
          top: `${position.top}px`,
          left: `${position.left}px`,
          zIndex: 1000,
          width: '320px',
          maxHeight: '500px',
          overflowY: 'auto',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
          border: '1px solid var(--border)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link 
            to={`/org/${organizationId}`}
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, textDecoration: 'none', color: 'inherit' }}
          >
            {orgData?.logo_url ? (
              <img
                src={orgData.logo_url}
                alt={organizationName}
                style={{ width: '24px', height: '24px', borderRadius: '3px', objectFit: 'cover' }}
              />
            ) : orgData?.website_url ? (
              <FaviconIcon url={orgData.website_url} size={24} />
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '11pt', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {organizationName}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                {formatRelationship(relationshipType)}
              </div>
            </div>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {orgData?.phone && (
              <a
                href={`tel:${orgData.phone.replace(/\D/g, '')}`}
                style={{
                  background: 'var(--accent)',
                  color: 'var(--bg)',
                  border: 'none',
                  borderRadius: '3px',
                  padding: '4px 8px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  textDecoration: 'none',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  transition: '0.12s'
                }}
                title={`Call ${orgData.phone}`}
              >
                CONTACT
              </a>
            )}
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                fontSize: '14px',
                color: 'var(--text-muted)',
                lineHeight: 1
              }}
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="card-body">
          {/* Contact info row */}
          {orgData?.phone && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px', 
              marginBottom: '12px',
              padding: '8px 10px',
              background: 'var(--bg-secondary)',
              borderRadius: '4px',
              border: '1px solid var(--border)'
            }}>
              <a
                href={`tel:${orgData.phone.replace(/\D/g, '')}`}
                style={{
                  fontSize: '10pt',
                  fontWeight: 600,
                  color: 'var(--accent)',
                  textDecoration: 'none'
                }}
              >
                {orgData.phone}
              </a>
              {orgData?.email && (
                <>
                  <span style={{ color: 'var(--border)' }}>|</span>
                  <a
                    href={`mailto:${orgData.email}`}
                    style={{
                      fontSize: '9pt',
                      color: 'var(--text-muted)',
                      textDecoration: 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {orgData.email}
                  </a>
                </>
              )}
            </div>
          )}
          
          {loading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)' }}>
              Loading investment snapshot...
            </div>
          ) : metrics.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '9pt' }}>
              <div style={{ marginBottom: '8px' }}>No investment metrics available</div>
              <div style={{ fontSize: '8pt' }}>
                This organization needs more data to generate investment insights.
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '9pt', fontWeight: 700, marginBottom: '12px', color: 'var(--text-muted)' }}>
                INVESTMENT SNAPSHOT
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '16px' }}>
                {metrics.map((metric, idx) => (
                  <div
                    key={idx}
                    style={{
                      padding: '10px',
                      background: 'var(--bg-secondary)',
                      borderRadius: '4px',
                      border: '1px solid var(--border)'
                    }}
                  >
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
                      {metric.label}
                    </div>
                    <div style={{ fontSize: '14pt', fontWeight: 700, color: 'var(--text)' }}>
                      {metric.value}
                    </div>
                    {metric.description && (
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {metric.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>

            </>
          )}
        </div>
      </div>
    </>
  );
};

export default OrganizationInvestmentCard;

