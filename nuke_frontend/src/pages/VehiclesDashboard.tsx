import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { useVehiclesDashboard } from '../hooks/useVehiclesDashboard';
import {
  DashboardStatsBar,
  MyVehiclesZone,
  ClientWorkZone,
  BusinessFleetZone
} from '../components/vehicles/dashboard';
import '../design-system.css';

const DashboardSkeleton: React.FC = () => (
  <div style={{ padding: '16px' }}>
    <h1 style={{ fontSize: '12pt', fontWeight: 700, margin: '0 0 16px 0' }}>
      Vehicles Dashboard
    </h1>
    <div style={{
      height: '80px',
      background: 'var(--surface)',
      border: '2px solid var(--border)',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <span style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
        Loading dashboard...
      </span>
    </div>
    {[1, 2, 3].map((i) => (
      <div
        key={i}
        style={{
          height: '120px',
          background: 'var(--surface)',
          border: '2px solid var(--border)',
          marginBottom: '16px',
          opacity: 0.5
        }}
      />
    ))}
  </div>
);

const EmptyDashboard: React.FC = () => (
  <div style={{
    padding: '48px 16px',
    textAlign: 'center'
  }}>
    <h1 style={{ fontSize: '12pt', fontWeight: 700, margin: '0 0 24px 0' }}>
      Vehicles Dashboard
    </h1>
    <div style={{
      fontSize: '11pt',
      fontWeight: 600,
      color: 'var(--text)',
      marginBottom: '8px'
    }}>
      No vehicles yet
    </div>
    <div style={{
      fontSize: '9pt',
      color: 'var(--text-muted)',
      marginBottom: '24px'
    }}>
      Add your first vehicle to start tracking your fleet.
    </div>
    <Link
      to="/vehicles/add"
      style={{
        display: 'inline-block',
        padding: '10px 20px',
        fontSize: '9pt',
        fontWeight: 600,
        background: 'var(--primary)',
        color: 'white',
        textDecoration: 'none',
        borderRadius: '4px'
      }}
    >
      + Add Vehicle
    </Link>
  </div>
);

const VehiclesDashboard: React.FC = () => {
  usePageTitle('Vehicles Dashboard');

  const { user, loading: authLoading } = useAuth();
  const { data, loading, error, refresh } = useVehiclesDashboard(user?.id);

  // Calculate aggregate stats
  const aggregateStats = useMemo(() => {
    if (!data) return { totalValue: 0, avgConfidence: 0, avgInteraction: 0 };

    const allMyVehicles = data.my_vehicles || [];
    const allClientVehicles = data.client_vehicles || [];
    const allFleetVehicles = (data.business_fleets || []).flatMap(f => f.vehicles || []);

    const allVehicles = [
      ...allMyVehicles.map(v => ({
        confidence: v.confidence_score,
        interaction: v.interaction_score,
        value: v.current_value || v.purchase_price || 0
      })),
      ...allClientVehicles.map(v => ({
        confidence: v.confidence_score,
        interaction: v.interaction_score,
        value: 0
      })),
      ...allFleetVehicles.map(v => ({
        confidence: v.confidence_score,
        interaction: v.interaction_score,
        value: 0
      }))
    ];

    if (allVehicles.length === 0) {
      return { totalValue: 0, avgConfidence: 0, avgInteraction: 0 };
    }

    const totalValue = allMyVehicles.reduce(
      (sum, v) => sum + (v.current_value || v.purchase_price || 0),
      0
    );

    const avgConfidence = Math.round(
      allVehicles.reduce((sum, v) => sum + v.confidence, 0) / allVehicles.length
    );

    const avgInteraction = Math.round(
      allVehicles.reduce((sum, v) => sum + v.interaction, 0) / allVehicles.length
    );

    return { totalValue, avgConfidence, avgInteraction };
  }, [data]);

  if (authLoading || loading) {
    return <DashboardSkeleton />;
  }

  if (error) {
    return (
      <div style={{ padding: '16px' }}>
        <h1 style={{ fontSize: '12pt', fontWeight: 700, margin: '0 0 16px 0' }}>
          Vehicles Dashboard
        </h1>
        <div style={{
          padding: '24px',
          background: '#fef2f2',
          border: '2px solid #fca5a5',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '9pt', fontWeight: 600, color: '#dc2626', marginBottom: '8px' }}>
            Failed to load dashboard
          </div>
          <div style={{ fontSize: '8pt', color: '#991b1b', marginBottom: '16px' }}>
            {error.message}
          </div>
          <button
            type="button"
            onClick={refresh}
            style={{
              padding: '8px 16px',
              fontSize: '8pt',
              fontWeight: 600,
              background: 'white',
              border: '1px solid #dc2626',
              color: '#dc2626',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) {
    return <DashboardSkeleton />;
  }

  const hasNoVehicles =
    data.my_vehicles.length === 0 &&
    data.client_vehicles.length === 0 &&
    data.business_fleets.every(f => f.vehicles.length === 0);

  if (hasNoVehicles) {
    return <EmptyDashboard />;
  }

  return (
    <div style={{ padding: '16px' }}>
      {/* Page Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '16px'
      }}>
        <h1 style={{
          fontSize: '12pt',
          fontWeight: 700,
          margin: 0
        }}>
          Vehicles Dashboard
        </h1>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Link
            to="/vehicles/list/legacy"
            style={{
              padding: '6px 12px',
              fontSize: '7pt',
              fontWeight: 600,
              background: 'var(--surface-hover)',
              color: 'var(--text-muted)',
              textDecoration: 'none',
              border: '1px solid var(--border)',
              borderRadius: '2px'
            }}
          >
            Legacy View
          </Link>
          <button
            type="button"
            onClick={refresh}
            style={{
              padding: '6px 12px',
              fontSize: '7pt',
              fontWeight: 600,
              background: 'var(--surface-hover)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: '2px',
              cursor: 'pointer'
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <DashboardStatsBar
        summary={data.summary}
        totalValue={aggregateStats.totalValue}
        avgConfidence={aggregateStats.avgConfidence}
        avgInteraction={aggregateStats.avgInteraction}
      />

      {/* Zone 1: My Vehicles */}
      <MyVehiclesZone
        vehicles={data.my_vehicles}
        defaultExpanded={true}
        onRefresh={refresh}
      />

      {/* Zone 2: Client Work */}
      <ClientWorkZone
        vehicles={data.client_vehicles}
        defaultExpanded={data.my_vehicles.length === 0}
      />

      {/* Zone 3: Business Fleet */}
      <BusinessFleetZone
        fleets={data.business_fleets}
        defaultExpanded={false}
      />
    </div>
  );
};

export default VehiclesDashboard;
