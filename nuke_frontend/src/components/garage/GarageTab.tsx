import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useVehiclesDashboard } from '../../hooks/useVehiclesDashboard';
import GarageVehicleCard from '../vehicles/GarageVehicleCard';
import '../../design-system.css';

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);

export default function GarageTab() {
  const { user, loading: authLoading } = useAuth();
  const { data, loading, error, refresh } = useVehiclesDashboard(user?.id);
  const [showMissingFields, setShowMissingFields] = useState(true);

  const handleRefresh = useCallback(() => { refresh(); }, [refresh]);

  if (authLoading) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--text-muted)', fontSize: 'var(--font-size)' }}>Loading...</div>;
  }

  if (!user) {
    return (
      <div style={{ padding: 'var(--space-10)', textAlign: 'center', fontFamily: 'var(--font-family)' }}>
        <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Sign in to see your garage</div>
        <div style={{ fontSize: 'var(--font-size)', color: 'var(--text-muted)', marginBottom: 'var(--space-5)' }}>
          Track your vehicles, monitor health scores, and manage your collection.
        </div>
        <Link to="/login" style={{
          display: 'inline-block',
          padding: '6px 16px',
          background: 'var(--primary)',
          color: 'var(--white)',
          textDecoration: 'none',
          fontSize: 'var(--font-size)',
          fontFamily: 'var(--font-family)',
          border: '1px solid var(--border-dark)',
        }}>
          Sign In
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-5)' }}>
        {/* Skeleton rows */}
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              height: 80,
              marginBottom: 'var(--space-4)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 2,
              opacity: 0.8,
            }}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 'var(--space-5)', fontSize: 'var(--font-size)' }}>
        <span style={{ color: 'var(--error)' }}>Error loading garage: {error.message}</span>
        <button onClick={handleRefresh} style={{ marginLeft: 'var(--space-3)', padding: '2px 8px', fontSize: 'var(--font-size)', fontFamily: 'var(--font-family)', cursor: 'pointer' }}>
          Retry
        </button>
      </div>
    );
  }

  const vehicles = data?.my_vehicles || [];
  const summary = data?.summary;
  const totalValue = vehicles.reduce((sum, v) => sum + (v.current_value || v.purchase_price || 0), 0);

  return (
    <div style={{ padding: 'var(--space-4)', fontFamily: 'var(--font-family)' }}>
      {/* Stats row */}
      <div style={{
        display: 'flex',
        gap: 'var(--space-5)',
        alignItems: 'center',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--grey-100)',
        border: '1px solid var(--border-light)',
        marginBottom: 'var(--space-4)',
        flexWrap: 'wrap',
      }}>
        <Stat label="Vehicles" value={String(summary?.total_my_vehicles || vehicles.length)} />
        {totalValue > 0 && <Stat label="Est. Value" value={formatCurrency(totalValue)} />}
        <Stat label="Active (30d)" value={String(summary?.recent_activity_30d || 0)} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <label style={{ fontSize: 'var(--font-size)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showMissingFields} onChange={e => setShowMissingFields(e.target.checked)} />
            Show missing
          </label>
          <Link to="/vehicle/add" style={{
            padding: '3px 10px',
            background: 'var(--primary)',
            color: 'var(--white)',
            textDecoration: 'none',
            fontSize: 'var(--font-size)',
            fontFamily: 'var(--font-family)',
            border: '1px solid var(--border-dark)',
          }}>
            + Add Vehicle
          </Link>
        </div>
      </div>

      {/* Vehicle grid */}
      {vehicles.length === 0 ? (
        <div style={{ padding: 'var(--space-10)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--font-size)' }}>
          No vehicles yet. <Link to="/vehicle/add" style={{ color: 'var(--text)' }}>Add your first vehicle</Link>.
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 'var(--space-4)',
        }}>
          {vehicles.map(v => (
            <GarageVehicleCard
              key={v.vehicle_id}
              vehicle={{
                id: v.vehicle_id,
                year: v.year,
                make: v.make,
                model: v.model,
                vin: v.vin,
                primary_image_url: v.primary_image_url,
                current_value: v.current_value,
                purchase_price: v.purchase_price,
              }}
              relationship={{ relationshipType: (v.ownership_role as any) || 'owned' }}
              onRefresh={handleRefresh}
              showMissingFields={showMissingFields}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '4px', alignItems: 'baseline' }}>
      <span style={{ fontSize: 'var(--font-size)', color: 'var(--text-muted)' }}>{label}:</span>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text)' }}>{value}</span>
    </div>
  );
}
