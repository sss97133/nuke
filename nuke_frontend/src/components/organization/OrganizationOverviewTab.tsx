import React from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  organization: any;
  stats: {
    totalVehicles: number;
    totalImages: number;
    totalEvents: number;
    totalMembers: number;
  };
  isOwner: boolean;
  canEdit: boolean;
}

const OrganizationOverviewTab: React.FC<Props> = ({ organization, stats, isOwner, canEdit }) => {
  const navigate = useNavigate();

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Quick Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px'
      }}>
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700, color: 'var(--accent)' }}>
              {stats.totalVehicles}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Vehicles
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700, color: 'var(--success)' }}>
              {stats.totalImages}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Images
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700, color: 'var(--warning)' }}>
              {stats.totalEvents}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Events
            </div>
          </div>
        </div>
        
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20pt', fontWeight: 700 }}>
              {stats.totalMembers}
            </div>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '4px' }}>
              Members
            </div>
          </div>
        </div>
      </div>

      {/* Business Details */}
      <div className="card">
        <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
          Business Information
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '12px', fontSize: '9pt' }}>
            {organization.business_type && (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Type</div>
                <div>{organization.business_type}</div>
              </>
            )}
            
            {organization.address && (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Address</div>
                <div>{organization.address}</div>
              </>
            )}
            
            {organization.phone && (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Phone</div>
                <div>
                  <a href={`tel:${organization.phone}`} style={{ color: 'var(--accent)' }}>
                    {organization.phone}
                  </a>
                </div>
              </>
            )}
            
            {organization.email && (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Email</div>
                <div>
                  <a href={`mailto:${organization.email}`} style={{ color: 'var(--accent)' }}>
                    {organization.email}
                  </a>
                </div>
              </>
            )}
            
            {organization.website && (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Website</div>
                <div>
                  <a href={organization.website} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                    {organization.website}
                  </a>
                </div>
              </>
            )}
            
            {organization.labor_rate && (
              <>
                <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>Labor Rate</div>
                <div>${organization.labor_rate}/hr</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions (Owner Only) */}
      {isOwner && (
        <div className="card">
          <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
            Quick Actions
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                onClick={() => navigate(`/dealer/${organization.id}/ai-assistant`)}
                className="button button-primary"
                style={{ fontSize: '9pt' }}
              >
                AI Assistant
              </button>
              <button
                onClick={() => navigate(`/dealer/${organization.id}/bulk-editor`)}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
              >
                Bulk Editor
              </button>
              <button
                onClick={() => {/* Open edit modal */}}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
              >
                Edit Details
              </button>
              <button
                onClick={() => {/* Open member manager */}}
                className="button button-secondary"
                style={{ fontSize: '9pt' }}
              >
                Manage Members
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Description */}
      {organization.description && (
        <div className="card">
          <div className="card-header" style={{ fontSize: '11pt', fontWeight: 700 }}>
            About
          </div>
          <div className="card-body">
            <p style={{ fontSize: '9pt', lineHeight: 1.6, margin: 0 }}>
              {organization.description}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrganizationOverviewTab;

