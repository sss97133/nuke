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

      // Load vehicle stats
      const { data: vehicleStats } = await supabase
        .from('organization_vehicles')
        .select(`
          relationship_type,
          sale_price,
          sale_date,
          vehicles!inner(
            current_value,
            sale_price,
            sale_date
          )
        `)
        .eq('organization_id', organizationId);

      // Calculate metrics
      const totalVehicles = vehicleStats?.length || 0;
      const soldVehicles = vehicleStats?.filter((v: any) => 
        v.relationship_type === 'sold' || v.sale_price || v.vehicles?.sale_price
      ).length || 0;
      
      const totalRevenue = vehicleStats?.reduce((sum: number, v: any) => {
        const salePrice = v.sale_price || v.vehicles?.sale_price || 0;
        return sum + (typeof salePrice === 'number' ? salePrice : 0);
      }, 0) || 0;

      const totalValue = vehicleStats?.reduce((sum: number, v: any) => {
        const value = v.vehicles?.current_value || 0;
        return sum + (typeof value === 'number' ? value : 0);
      }, 0) || 0;

      // Build metric data
      const metricData: OrgMetricData = {
        business_type: org.business_type,
        primary_focus: intelligence?.effective_primary_focus,
        total_vehicles: totalVehicles,
        total_sales: soldVehicles,
        total_revenue: totalRevenue,
        total_inventory: vehicleStats?.filter((v: any) => 
          v.relationship_type === 'in_stock' || v.relationship_type === 'for_sale'
        ).length || 0,
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
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
          </div>
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

        <div className="card-body">
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

              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
                <Link
                  to={`/org/${organizationId}`}
                  onClick={onClose}
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    padding: '8px 16px',
                    background: 'var(--accent)',
                    color: 'white',
                    textDecoration: 'none',
                    borderRadius: '4px',
                    fontSize: '9pt',
                    fontWeight: 700,
                    transition: 'opacity 0.12s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '0.9';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                >
                  View Full Profile →
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default OrganizationInvestmentCard;

