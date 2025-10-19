import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import EnhancedVehicleCard from '../components/discovery/EnhancedVehicleCard';
import '../design-system.css';

type ViewMode = 'gallery' | 'compact' | 'technical';
type PerspectiveMode = 'all' | 'investor' | 'tech' | 'hobbyist';

interface VehicleWithProfile {
  id: string;
  make: string | null;
  model: string | null;
  year: number | null;
  vin: string | null;
  created_at: string;
  sale_price: number | null;
  current_value: number | null;
  purchase_price: number | null;
  msrp: number | null;
  is_for_sale: boolean | null;
  uploaded_by: string;
  profiles: any;
}

const Dashboard: React.FC = () => {
  const [vehicles, setVehicles] = useState<VehicleWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('compact');
  const [denseMode, setDenseMode] = useState(false);
  const [perspective, setPerspective] = useState<PerspectiveMode>('all');
  const [session, setSession] = useState<any>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadVehicles();
  }, [perspective]);

  const loadVehicles = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);

      // Load all vehicles with their profile info
      let query = supabase
        .from('vehicles')
        .select(`
          id,
          make,
          model,
          year,
          vin,
          created_at,
          sale_price,
          current_value,
          purchase_price,
          msrp,
          is_for_sale,
          uploaded_by,
          uploader:uploaded_by (
            username,
            full_name
          )
        `)
        .order('created_at', { ascending: false });

      // Apply perspective-based filtering/sorting
      switch (perspective) {
        case 'investor':
          // Show vehicles with best ROI potential
          query = query
            .not('purchase_price', 'is', null)
            .not('current_value', 'is', null);
          break;
        case 'tech':
          // Show vehicles that need work or have build systems
          // We'll sort these after loading
          break;
        case 'hobbyist':
          // Show interesting/cool vehicles
          query = query.order('current_value', { ascending: false });
          break;
        default:
          // All vehicles, newest first
          break;
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading vehicles:', error);
        return;
      }

      let processedVehicles = data || [];

      // Post-process based on perspective
      if (perspective === 'investor' && processedVehicles.length > 0) {
        // Sort by ROI
        processedVehicles = processedVehicles
          .map(v => ({
            ...v,
            roi: v.current_value && v.purchase_price 
              ? (v.current_value - v.purchase_price) / v.purchase_price 
              : 0
          }))
          .sort((a, b) => (b as any).roi - (a as any).roi);
      }

      setVehicles(processedVehicles);
    } catch (error) {
      console.error('Error loading vehicles:', error);
    } finally {
      setLoading(false);
    }
  };

  const getGridStyle = () => {
    switch (viewMode) {
      case 'gallery':
        return {
          display: 'grid',
          gap: denseMode ? '6px' : '12px',
          gridTemplateColumns: denseMode 
            ? 'repeat(auto-fill, minmax(180px, 1fr))' 
            : 'repeat(auto-fill, minmax(240px, 1fr))'
        };
      case 'compact':
        return {
          display: 'grid',
          gap: denseMode ? '6px' : '12px',
          gridTemplateColumns: denseMode 
            ? 'repeat(auto-fill, minmax(220px, 1fr))' 
            : 'repeat(auto-fill, minmax(280px, 1fr))'
        };
      case 'technical':
        return {
          display: 'flex',
          flexDirection: 'column' as const,
          gap: denseMode ? '4px' : '8px'
        };
    }
  };

  const getPerspectiveDescription = () => {
    switch (perspective) {
      case 'investor':
        return 'Vehicles sorted by ROI potential and investment opportunity';
      case 'tech':
        return 'Vehicles sorted by documentation quality and technical data';
      case 'hobbyist':
        return 'Vehicles sorted by coolness factor and desirability';
      default:
        return 'All vehicles in the system';
    }
  };

  const buttonStyle = (isActive: boolean): React.CSSProperties => ({
    background: isActive ? '#2563eb' : '#f3f4f6',
    color: isActive ? 'white' : '#374151',
    border: '1px solid #c0c0c0',
    padding: '4px 8px',
    borderRadius: '2px',
    fontSize: '8pt',
    cursor: 'pointer',
    transition: 'all 0.15s'
  });

  return (
    <>
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicles...</p>
        </div>
      ) : (
        <div className="fade-in">
          {/* Header with Controls */}
          <div style={{ 
            marginBottom: '16px',
            padding: '12px',
            background: 'white',
            border: '1px solid #c0c0c0',
            borderRadius: '2px'
          }}>
            {/* Title and Stats */}
            <div style={{ marginBottom: '12px' }}>
              <h1 className="heading-1" style={{ fontSize: '14pt', margin: '0 0 4px 0' }}>
                Vehicle Explorer
              </h1>
              <div className="text-muted" style={{ fontSize: '8pt' }}>
                {vehicles.length} vehicles · {getPerspectiveDescription()}
              </div>
            </div>

            {/* Perspective Filter */}
            <div style={{ marginBottom: '12px' }}>
              <div className="text" style={{ fontSize: '8pt', marginBottom: '4px', fontWeight: 'bold' }}>
                Perspective:
              </div>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => setPerspective('all')}
                  style={buttonStyle(perspective === 'all')}
                >
                  All Vehicles
                </button>
                <button
                  onClick={() => setPerspective('investor')}
                  style={buttonStyle(perspective === 'investor')}
                  title="Show vehicles with best ROI potential"
                >
                  💼 Investor POV
                </button>
                <button
                  onClick={() => setPerspective('tech')}
                  style={buttonStyle(perspective === 'tech')}
                  title="Show vehicles with best documentation"
                >
                  🔧 Tech POV
                </button>
                <button
                  onClick={() => setPerspective('hobbyist')}
                  style={buttonStyle(perspective === 'hobbyist')}
                  title="Show coolest/most desirable vehicles"
                >
                  🏁 Hobbyist POV
                </button>
              </div>
            </div>

            {/* View Mode Controls */}
            <div style={{ 
              display: 'flex', 
              gap: '8px', 
              alignItems: 'center',
              flexWrap: 'wrap'
            }}>
              <div className="text" style={{ fontSize: '8pt', fontWeight: 'bold' }}>
                View:
              </div>
              <button
                onClick={() => setViewMode('gallery')}
                style={buttonStyle(viewMode === 'gallery')}
              >
                Gallery
              </button>
              <button
                onClick={() => setViewMode('compact')}
                style={buttonStyle(viewMode === 'compact')}
              >
                Compact
              </button>
              <button
                onClick={() => setViewMode('technical')}
                style={buttonStyle(viewMode === 'technical')}
              >
                Technical
              </button>
              
              <div style={{ width: '1px', height: '16px', background: '#c0c0c0', margin: '0 4px' }} />
              
              <button
                onClick={() => setDenseMode(!denseMode)}
                style={buttonStyle(denseMode)}
                title="Toggle dense mode"
              >
                {denseMode ? '📦 Dense' : '📦 Normal'}
              </button>

              <div style={{ flex: 1 }} />

              <button
                onClick={() => navigate('/add-vehicle')}
                className="button button-primary"
                style={{ fontSize: '8pt', padding: '4px 12px' }}
              >
                + Add Vehicle
              </button>
            </div>
          </div>

          {/* Vehicle Grid */}
          {vehicles.length === 0 ? (
            <div style={{
              padding: '48px 24px',
              textAlign: 'center',
              background: 'white',
              border: '1px solid #c0c0c0',
              borderRadius: '2px'
            }}>
              <h2 className="text font-bold" style={{ marginBottom: '12px', fontSize: '11pt' }}>
                No vehicles found
              </h2>
              <p className="text-small text-muted" style={{ marginBottom: '24px', fontSize: '8pt' }}>
                {perspective !== 'all' 
                  ? 'Try switching to a different perspective or adding more vehicle data.'
                  : 'Start by adding your first vehicle to the system.'
                }
              </p>
              <button 
                className="button button-primary"
                onClick={() => navigate('/add-vehicle')}
              >
                Add Vehicle
              </button>
            </div>
          ) : (
            <div style={getGridStyle()}>
              {vehicles.map((vehicle) => (
                <EnhancedVehicleCard
                  key={vehicle.id}
                  vehicle={vehicle}
                  viewMode={viewMode}
                  denseMode={denseMode}
                />
              ))}
            </div>
          )}

          {/* Quick Stats Footer */}
          {vehicles.length > 0 && (
            <div style={{ 
              marginTop: '16px',
              padding: '12px',
              background: 'white',
              border: '1px solid #c0c0c0',
              borderRadius: '2px',
              display: 'flex',
              gap: '16px',
              flexWrap: 'wrap',
              fontSize: '8pt'
            }}>
              <div>
                <span className="text-muted">Total Vehicles:</span>{' '}
                <span className="text-bold">{vehicles.length}</span>
              </div>
              <div>
                <span className="text-muted">For Sale:</span>{' '}
                <span className="text-bold">{vehicles.filter(v => v.is_for_sale).length}</span>
              </div>
              <div>
                <span className="text-muted">With Pricing:</span>{' '}
                <span className="text-bold">
                  {vehicles.filter(v => v.current_value || v.sale_price || v.purchase_price).length}
                </span>
              </div>
              <div>
                <span className="text-muted">Avg Est Value:</span>{' '}
                <span className="text-bold">
                  ${Math.round(
                    vehicles
                      .map(v => v.current_value || v.sale_price || v.purchase_price || 0)
                      .reduce((sum, val) => sum + val, 0) / vehicles.length
                  ).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default Dashboard;
