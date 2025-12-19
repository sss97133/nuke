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
    <div style={{ padding: 'var(--space-5)', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: '8pt', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Pending Vehicle Profiles - Admin View</h1>
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button onClick={loadAnalysis} disabled={loading} style={{ fontSize: '8pt' }}>
            {loading ? 'Loading...' : 'Refresh Analysis'}
          </button>
          <button onClick={sourceAllMissing} disabled={sourcing} style={{ fontSize: '8pt', background: 'var(--success)', color: 'var(--white)', border: '2px solid var(--success)' }}>
            {sourcing ? 'Sourcing...' : 'Source All Missing Data'}
          </button>
        </div>
      </div>

      {/* Summary */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 'var(--space-3)',
        marginBottom: 'var(--space-6)'
      }}>
        <div style={{ padding: 'var(--space-4)', background: 'var(--bg)', borderRadius: '0px', border: '2px solid var(--border-light)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>{analysis.summary.total_pending}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Total Pending</div>
        </div>
        <div style={{ padding: 'var(--space-4)', background: 'var(--warning-dim)', borderRadius: '0px', border: '2px solid var(--border-light)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>{analysis.summary.missing_vin}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Missing VIN</div>
        </div>
        <div style={{ padding: 'var(--space-4)', background: 'var(--bg)', borderRadius: '0px', border: '2px solid var(--border-light)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>{analysis.summary.missing_images}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Missing Images</div>
        </div>
        <div style={{ padding: 'var(--space-4)', background: 'var(--bg)', borderRadius: '0px', border: '2px solid var(--border-light)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>{analysis.summary.missing_description}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Missing Description</div>
        </div>
        <div style={{ padding: 'var(--space-4)', background: 'var(--bg)', borderRadius: '0px', border: '2px solid var(--border-light)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>{analysis.summary.missing_price}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Missing Price</div>
        </div>
        <div style={{ padding: 'var(--space-4)', background: 'var(--bg)', borderRadius: '0px', border: '2px solid var(--border-light)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>{analysis.summary.missing_mileage}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Missing Mileage</div>
        </div>
        <div style={{ padding: 'var(--space-4)', background: 'var(--bg)', borderRadius: '0px', border: '2px solid var(--border-light)' }}>
          <div style={{ fontSize: '8pt', fontWeight: 700 }}>{analysis.summary.missing_color}</div>
          <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>Missing Color</div>
        </div>
      </div>

      {/* Vehicle List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {analysis.needs_analysis.map((vehicle) => (
          <div
            key={vehicle.vehicle_id}
            style={{
              padding: 'var(--space-4)',
              border: '2px solid var(--border-light)',
              borderRadius: '0px',
              background: 'var(--surface)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 'var(--space-3)' }}>
              <div>
                <h3 style={{ margin: 0, marginBottom: 'var(--space-1)', fontSize: '8pt', fontWeight: 700 }}>{vehicle.vehicle_name}</h3>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                  ID: {vehicle.vehicle_id.slice(0, 8)}...
                </div>
                {vehicle.discovery_url && (
                  <a
                    href={vehicle.discovery_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: '8pt', color: 'var(--accent)' }}
                  >
                    {vehicle.discovery_url}
                  </a>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  onClick={() => navigate(`/vehicle/${vehicle.vehicle_id}`)}
                  style={{ padding: 'var(--space-2) var(--space-3)', fontSize: '8pt' }}
                >
                  View
                </button>
                {vehicle.can_source && (
                  <button
                    onClick={() => sourceVehicle(vehicle.vehicle_id)}
                    disabled={sourcing}
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      fontSize: '8pt',
                      background: 'var(--success)',
                      color: 'var(--white)',
                      border: '2px solid var(--success)',
                      borderRadius: '0px',
                      cursor: sourcing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Source Data
                  </button>
                )}
              </div>
            </div>

            {/* Needs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {vehicle.needs.map((need) => (
                <div
                  key={need}
                  style={{
                    padding: 'var(--space-1) var(--space-2)',
                    background: getNeedColor(need),
                    borderRadius: '0px',
                    fontSize: '8pt',
                    fontWeight: 500
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

