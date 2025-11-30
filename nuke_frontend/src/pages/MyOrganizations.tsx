import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { MyOrganizationsService, type MyOrganization } from '../services/myOrganizationsService';
import OrganizationCard from '../components/organization/OrganizationCard';
import '../design-system.css';

const MyOrganizations: React.FC = () => {
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<MyOrganization[]>([]);
  const [loading, setLoading] = useState(true);
  const [summaryStats, setSummaryStats] = useState({
    total_organizations: 0,
    active_organizations: 0,
    total_vehicles: 0,
    total_value: 0,
    total_contributions: 0,
  });
  const [filters, setFilters] = useState<{
    status: 'active' | 'inactive' | 'all';
    role?: string;
    sortBy: 'recent' | 'name' | 'value' | 'contributions';
  }>({
    status: 'all',
    sortBy: 'recent',
  });

  useEffect(() => {
    loadOrganizations();
    loadSummaryStats();
  }, [filters]);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const data = await MyOrganizationsService.getMyOrganizations(filters);
      
      // Sort pinned organizations first
      const sorted = data.sort((a, b) => {
        const aPinned = a.preferences?.is_pinned ? 1 : 0;
        const bPinned = b.preferences?.is_pinned ? 1 : 0;
        if (aPinned !== bPinned) return bPinned - aPinned;
        return (b.preferences?.display_order || 0) - (a.preferences?.display_order || 0);
      });

      setOrganizations(sorted);
    } catch (error) {
      console.error('Error loading organizations:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSummaryStats = async () => {
    const stats = await MyOrganizationsService.getSummaryStats();
    setSummaryStats(stats);
  };

  const handlePinToggle = async (organizationId: string, isPinned: boolean) => {
    const result = await MyOrganizationsService.togglePin(organizationId, isPinned);
    if (result.success) {
      await loadOrganizations();
    } else {
      alert(result.error || 'Failed to toggle pin');
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

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
        Loading organizations...
      </div>
    );
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="heading-1" style={{ marginBottom: 'var(--space-2)' }}>
          My Organizations
        </h1>
        <p style={{ color: '#666', fontSize: '14px' }}>
          Manage your organizational affiliations and access
        </p>
      </div>

      {/* Summary Stats */}
      <div
        className="card"
        style={{
          marginBottom: 'var(--space-4)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 'var(--space-3)',
          padding: 'var(--space-4)',
        }}
      >
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Total Organizations
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {summaryStats.total_organizations}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Active
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {summaryStats.active_organizations}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Total Vehicles
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {summaryStats.total_vehicles}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Total Value
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {formatCurrency(summaryStats.total_value)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>
            Contributions
          </div>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>
            {summaryStats.total_contributions}
          </div>
        </div>
      </div>

      {/* Filters & Sort */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <select
          value={filters.status}
          onChange={(e) =>
            setFilters({ ...filters, status: e.target.value as 'active' | 'inactive' | 'all' })
          }
          style={{
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="inactive">Past</option>
        </select>

        <select
          value={filters.sortBy}
          onChange={(e) =>
            setFilters({
              ...filters,
              sortBy: e.target.value as 'recent' | 'name' | 'value' | 'contributions',
            })
          }
          style={{
            padding: '6px 12px',
            border: '1px solid var(--border)',
            borderRadius: '4px',
            fontSize: '12px',
          }}
        >
          <option value="recent">Recently Active</option>
          <option value="name">Alphabetical</option>
          <option value="value">Highest Value</option>
          <option value="contributions">Most Contributions</option>
        </select>

        <div style={{ flex: 1 }} />

        <button
          className="cursor-button"
          onClick={() => navigate('/organizations')}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            backgroundColor: '#0000ff',
          }}
        >
          Browse Organizations
        </button>
      </div>

      {/* Organizations Grid */}
      {organizations.length === 0 ? (
        <div className="card" style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
          <div style={{ fontSize: '18px', marginBottom: '10px' }}>
            No Organizations Found
          </div>
          <div style={{ fontSize: '14px', marginBottom: '20px' }}>
            {filters.status === 'active'
              ? 'You are not currently affiliated with any active organizations.'
              : 'Join or create an organization to get started.'}
          </div>
          <button
            className="cursor-button"
            onClick={() => navigate('/organizations')}
            style={{ padding: '10px 20px' }}
          >
            Browse Organizations
          </button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 'var(--space-4)',
          }}
        >
          {organizations.map((org) => (
            <OrganizationCard
              key={org.id}
              organization={org}
              isOwnProfile={true}
              onPinToggle={handlePinToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default MyOrganizations;



