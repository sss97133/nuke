/**
 * Attributed Data Indicator
 * Shows who contributed specific data to a vehicle profile
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import UserReputationBadge from './UserReputationBadge';

interface AttributedDataIndicatorProps {
  vehicleId: string;
  dataField?: string; // Optional: filter by specific field
  compact?: boolean;
}

interface Attribution {
  id: string;
  data_field: string;
  contributed_by: string;
  contributor_username?: string;
  contribution_value: number;
  verification_status: string;
  data_quality_score: number;
  source_url?: string;
  created_at: string;
}

const AttributedDataIndicator: React.FC<AttributedDataIndicatorProps> = ({ 
  vehicleId, 
  dataField,
  compact = false 
}) => {
  const [attributions, setAttributions] = useState<Attribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    loadAttributions();
  }, [vehicleId, dataField]);

  const loadAttributions = async () => {
    try {
      let query = supabase
        .from('attributed_data_sources')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('created_at', { ascending: false });

      if (dataField) {
        query = query.eq('data_field', dataField);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading attributions:', error);
        return;
      }

      // Enrich with usernames
      if (data && data.length > 0) {
        const userIds = Array.from(new Set(data.map(a => a.contributed_by)));
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', userIds);

        const usernameMap = new Map(profiles?.map(p => [p.id, p.username]) || []);

        const enriched = data.map(attr => ({
          ...attr,
          contributor_username: usernameMap.get(attr.contributed_by) || 'Anonymous'
        }));

        setAttributions(enriched);
      }
    } catch (err) {
      console.error('Error loading attributions:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading || attributions.length === 0) {
    return null;
  }

  const verificationIcon = (status: string) => {
    switch (status) {
      case 'auto_verified': return '✓';
      case 'peer_verified': return '✓✓';
      case 'expert_verified': return '✓✓✓';
      case 'disputed': return '⚠';
      case 'rejected': return '✗';
      default: return '○';
    }
  };

  const verificationColor = (status: string) => {
    switch (status) {
      case 'auto_verified': return '#10b981';
      case 'peer_verified': return '#3b82f6';
      case 'expert_verified': return '#8b5cf6';
      case 'disputed': return '#f59e0b';
      case 'rejected': return '#ef4444';
      default: return '#9ca3af';
    }
  };

  if (compact) {
    // Show just a count badge
    return (
      <button
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 8px',
          background: 'var(--white)',
          border: '2px solid var(--border)',
          color: 'var(--gray-700)',
          fontSize: '11px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: '0.12s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--gray-900)';
          e.currentTarget.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
        onClick={() => setExpanded(!expanded)}
        title="View data contributors"
      >
        <span>👥</span>
        {attributions.length} contribution{attributions.length !== 1 ? 's' : ''}
      </button>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '12px',
        background: 'var(--white)',
        border: '2px solid var(--border)'
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--gray-700)' }}>
          Data Contributors ({attributions.length})
        </div>
        <div style={{ fontSize: '18px', color: 'var(--gray-400)' }}>
          {expanded ? '−' : '+'}
        </div>
      </div>

      {/* Contributions List */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {attributions.map((attr) => (
            <div
              key={attr.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px',
                background: 'var(--gray-50)',
                border: '2px solid var(--border)',
                fontSize: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1 }}>
                <span
                  style={{
                    color: verificationColor(attr.verification_status),
                    fontSize: '14px',
                    fontWeight: 'bold'
                  }}
                  title={attr.verification_status}
                >
                  {verificationIcon(attr.verification_status)}
                </span>
                
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
                    {attr.contributor_username}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--gray-600)' }}>
                    {attr.data_field.replace(/_/g, ' ')} • {attr.contribution_value} pts
                  </div>
                  {attr.source_url && (
                    <a
                      href={attr.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontSize: '10px',
                        color: 'var(--blue-600)',
                        textDecoration: 'none'
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      View source →
                    </a>
                  )}
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    fontSize: '10px',
                    color: 'var(--gray-500)'
                  }}
                >
                  <div>
                    Quality: {Math.round(attr.data_quality_score * 100)}%
                  </div>
                  <div>
                    {new Date(attr.created_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AttributedDataIndicator;

