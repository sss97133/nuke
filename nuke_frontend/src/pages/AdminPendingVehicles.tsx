import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

interface VehicleNeeds {
  vehicle_id: string;
  vehicle_name: string;
  discovery_url: string | null;
  needs: string[];
  priorities: { [key: string]: number };
  sources: { [key: string]: string[] };
  can_source: boolean;
}

interface AnalysisResult {
  success: boolean;
  vehicles_analyzed: number;
  needs_analysis: VehicleNeeds[];
  sourcing_results?: any[];
  summary: {
    total_pending: number;
    missing_vin: number;
    missing_images: number;
    missing_description: number;
    missing_price: number;
    missing_mileage: number;
    missing_color: number;
  };
}

export default function AdminPendingVehicles() {
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [sourcing, setSourcing] = useState(false);

  useEffect(() => {
    loadAnalysis();
  }, []);

  const loadAnalysis = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-and-source-pending', {
        body: { batch_size: 50, auto_source: false }
      });

      if (error) throw error;
      setAnalysis(data);
    } catch (error: any) {
      console.error('Failed to load analysis:', error);
      alert(`Failed to load: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const sourceAllMissing = async () => {
    if (!confirm('Source missing data for all pending vehicles? This will scrape discovery URLs and backfill images.')) {
      return;
    }

    setSourcing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-and-source-pending', {
        body: { batch_size: 50, auto_source: true }
      });

      if (error) throw error;
      setAnalysis(data);
      alert(`Sourcing complete! Check results below.`);
    } catch (error: any) {
      console.error('Failed to source data:', error);
      alert(`Failed to source: ${error.message}`);
    } finally {
      setSourcing(false);
    }
  };

  const sourceVehicle = async (vehicleId: string) => {
    setSourcing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-and-source-pending', {
        body: { vehicle_id: vehicleId, auto_source: true }
      });

      if (error) throw error;
      await loadAnalysis(); // Reload to see updated results
      alert('Vehicle sourced successfully!');
    } catch (error: any) {
      console.error('Failed to source vehicle:', error);
      alert(`Failed to source: ${error.message}`);
    } finally {
      setSourcing(false);
    }
  };

  if (loading && !analysis) {
    return (
      <div style={{ padding: '20px' }}>
        <div className="loading-spinner"></div>
        <p>Analyzing pending vehicles...</p>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div style={{ padding: '20px' }}>
        <p>No analysis data available.</p>
        <button onClick={loadAnalysis}>Reload</button>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1>Pending Vehicle Profiles - Admin View</h1>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={loadAnalysis} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh Analysis'}
          </button>
          <button onClick={sourceAllMissing} disabled={sourcing} style={{ background: '#10b981', color: 'white' }}>
            {sourcing ? 'Sourcing...' : 'Source All Missing Data'}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '24px'
      }}>
        <div style={{ padding: '16px', background: 'var(--bg)', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{analysis.summary.total_pending}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Total Pending</div>
        </div>
        <div style={{ padding: '16px', background: '#fef3c7', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{analysis.summary.missing_vin}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Missing VIN</div>
        </div>
        <div style={{ padding: '16px', background: '#dbeafe', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{analysis.summary.missing_images}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Missing Images</div>
        </div>
        <div style={{ padding: '16px', background: '#e0e7ff', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{analysis.summary.missing_description}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Missing Description</div>
        </div>
        <div style={{ padding: '16px', background: '#fce7f3', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{analysis.summary.missing_price}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Missing Price</div>
        </div>
        <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{analysis.summary.missing_mileage}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Missing Mileage</div>
        </div>
        <div style={{ padding: '16px', background: '#fff7ed', borderRadius: '8px' }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{analysis.summary.missing_color}</div>
          <div style={{ fontSize: '12px', color: '#666' }}>Missing Color</div>
        </div>
      </div>

      {/* Vehicle List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {analysis.needs_analysis.map((vehicle) => (
          <div
            key={vehicle.vehicle_id}
            style={{
              padding: '16px',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              background: 'var(--surface)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
              <div>
                <h3 style={{ margin: 0, marginBottom: '4px' }}>{vehicle.vehicle_name}</h3>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  ID: {vehicle.vehicle_id.slice(0, 8)}...
                </div>
                {vehicle.discovery_url && (
                  <a
                    href={vehicle.discovery_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '12px', color: '#3b82f6' }}
                  >
                    {vehicle.discovery_url}
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  View
                </button>
                {vehicle.can_source && (
                  <button
                    onClick={() => sourceVehicle(vehicle.vehicle_id)}
                    disabled={sourcing}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      background: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: sourcing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Source Data
                  </button>
                )}
              </div>
            </div>

            {/* Needs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {vehicle.needs.map((need) => (
                <div
                  key={need}
                  style={{
                    padding: '4px 8px',
                    background: getNeedColor(need),
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '500'
                  }}
                >
                  {need}
                  {vehicle.sources[need] && (
                    <span style={{ marginLeft: '4px', opacity: 0.7 }}>
                      ({vehicle.sources[need].join(', ')})
                    </span>
                  )}
                </div>
              ))}
              {vehicle.needs.length === 0 && (
                <span style={{ color: '#10b981', fontSize: '12px' }}>✅ Complete</span>
              )}
            </div>

            {/* Sourcing Result */}
            {analysis.sourcing_results && (
              <div style={{ marginTop: '8px', fontSize: '12px' }}>
                {analysis.sourcing_results
                  .find(r => r.vehicle_id === vehicle.vehicle_id)
                  ?.sourced_fields && (
                  <div style={{ color: '#10b981' }}>
                    ✅ Sourced: {analysis.sourcing_results
                      .find(r => r.vehicle_id === vehicle.vehicle_id)
                      ?.sourced_fields.join(', ')}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function getNeedColor(need: string): string {
  const colors: { [key: string]: string } = {
    vin: '#fef3c7',
    images: '#dbeafe',
    description: '#e0e7ff',
    price: '#fce7f3',
    mileage: '#f0fdf4',
    color: '#fff7ed'
  };
  return colors[need] || '#f3f4f6';
}

