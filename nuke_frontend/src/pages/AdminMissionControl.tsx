import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface SystemStats {
  totalVehicles: number;
  totalImages: number;
  totalOrganizations: number;
  totalUsers: number;
  pendingAnalysis: number;
  investmentOpportunities: number;
  todayUploads: number;
  activeProcessing: number;
}

const AdminMissionControl: React.FC = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [analysisQueue, setAnalysisQueue] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [vehicleImageQueue, setVehicleImageQueue] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics'>('overview');

  useEffect(() => {
    loadDashboard();
    // Refresh every 30 seconds
    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    try {
      // Load all stats in parallel
      const [
        vehiclesCount,
        imagesCount,
        orgsCount,
        usersCount,
        queueData,
        opportunitiesCount,
        todayData,
        recentData,
        vehicleQueueData
      ] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact', head: true }),
        supabase.from('vehicle_images').select('id', { count: 'exact', head: true }),
        supabase.from('organization_inventory').select('organization_id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('organization_analysis_queue').select('*'),
        supabase.from('organization_narratives').select('id', { count: 'exact', head: true }),
        supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
        supabase.from('timeline_events').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('vehicle_images').select('vehicle_id, created_at').is('ai_analysis', null).limit(100)
      ]);

      setStats({
        totalVehicles: vehiclesCount.count || 0,
        totalImages: imagesCount.count || 0,
        totalOrganizations: orgsCount.count || 0,
        totalUsers: usersCount.count || 0,
        pendingAnalysis: queueData.data?.reduce((sum, q) => sum + q.pending_count, 0) || 0,
        investmentOpportunities: opportunitiesCount.count || 0,
        todayUploads: todayData.count || 0,
        activeProcessing: 0
      });

      setAnalysisQueue(queueData.data || []);
      setRecentActivity(recentData.data || []);
      
      // Group vehicle images by vehicle
      const vehicleGroups = (vehicleQueueData.data || []).reduce((acc: any, img: any) => {
        if (!acc[img.vehicle_id]) {
          acc[img.vehicle_id] = { vehicle_id: img.vehicle_id, count: 0 };
        }
        acc[img.vehicle_id].count++;
        return acc;
      }, {});
      setVehicleImageQueue(Object.values(vehicleGroups));
      
    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async (orgId: string) => {
    setProcessing(orgId);
    try {
      const response = await fetch(`${supabase.supabaseUrl}/functions/v1/analyze-organization-images`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`
        },
        body: JSON.stringify({ organizationId: orgId, batch: true })
      });

      const result = await response.json();
      console.log('Analysis result:', result);
      alert(`✅ Analysis started: ${result.imagesAnalyzed || 0} images processed`);
      loadDashboard();
    } catch (err) {
      console.error('Error running analysis:', err);
      alert('Failed to run analysis');
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading mission control...
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Admin Mission Control
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Real-time system monitoring and control center
        </p>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px'
      }}>
        {[
          { label: 'Total Vehicles', value: stats?.totalVehicles.toLocaleString(), color: '#3b82f6' },
          { label: 'Total Images', value: stats?.totalImages.toLocaleString(), color: '#8b5cf6' },
          { label: 'Organizations', value: stats?.totalOrganizations.toLocaleString(), color: '#10b981' },
          { label: 'Users', value: stats?.totalUsers.toLocaleString(), color: '#f59e0b' },
          { label: 'Pending Analysis', value: stats?.pendingAnalysis.toLocaleString(), color: '#ef4444', alert: (stats?.pendingAnalysis || 0) > 0 },
          { label: 'Opportunities', value: stats?.investmentOpportunities.toLocaleString(), color: '#06b6d4' },
          { label: 'Today Uploads', value: stats?.todayUploads.toLocaleString(), color: '#84cc16' },
          { label: 'Processing', value: stats?.activeProcessing.toLocaleString(), color: '#6366f1' }
        ].map((stat, idx) => (
          <div
            key={idx}
            className="card"
            style={{
              border: stat.alert ? '2px solid ' + stat.color : '2px solid var(--border-light)',
              background: stat.alert ? stat.color + '10' : 'var(--white)'
            }}
          >
            <div className="card-body" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
              <div style={{ fontSize: '10pt', fontWeight: 700, color: stat.color, marginBottom: '4px' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '8pt', color: 'var(--text-muted)', fontWeight: 600 }}>
                {stat.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Analysis Queue */}
      {analysisQueue.length > 0 && (
        <div className="card" style={{ marginBottom: '24px', border: '2px solid var(--warning)' }}>
          <div className="card-header" style={{
            background: 'var(--warning-dim)',
            borderBottom: '2px solid var(--warning)',
            fontSize: '8pt',
            fontWeight: 700
          }}>
            Image Analysis Queue ({analysisQueue.reduce((sum, q) => sum + q.pending_count, 0)} images)
          </div>
          <div className="card-body">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {analysisQueue.map((queue) => (
                <div
                  key={queue.organization_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '6px',
                    border: '1px solid var(--border)'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '8pt', fontWeight: 600, marginBottom: '4px' }}>
                      Organization: {queue.organization_id.slice(0, 8)}...
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {queue.pending_count} images • Oldest: {new Date(queue.oldest_image).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => navigate(`/org/${queue.organization_id}`)}
                      className="button button-secondary cursor-button"
                      style={{ 
                        fontSize: '8pt', 
                        padding: '6px 12px',
                        border: '2px solid var(--border-light)',
                        transition: 'all 0.12s ease'
                      }}
                    >
                      View Org
                    </button>
                    <button
                      onClick={() => runAnalysis(queue.organization_id)}
                      className="button button-primary cursor-button"
                      style={{ 
                        fontSize: '8pt', 
                        padding: '6px 12px',
                        border: '2px solid var(--accent)',
                        transition: 'all 0.12s ease'
                      }}
                      disabled={processing === queue.organization_id}
                    >
                      {processing === queue.organization_id ? 'Processing...' : `Analyze Now (${queue.pending_count})`}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700 }}>
          Quick Actions
        </div>
        <div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '12px' }}>
            <button
              onClick={() => navigate('/admin/scripts')}
              className="button button-secondary cursor-button"
              style={{ 
                padding: '12px', 
                fontSize: '8pt', 
                textAlign: 'left', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                border: '2px solid var(--border-light)',
                transition: 'all 0.12s ease'
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Script Control</div>
                <div style={{ fontSize: '8pt', opacity: 0.7 }}>Run batch operations</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/admin/image-processing')}
              className="button button-secondary cursor-button"
              style={{ 
                padding: '12px', 
                fontSize: '8pt', 
                textAlign: 'left', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                border: '2px solid var(--border-light)',
                transition: 'all 0.12s ease'
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Image Processing</div>
                <div style={{ fontSize: '8pt', opacity: 0.7 }}>Monitor image pipeline</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/admin/batch-analysis')}
              className="button button-secondary cursor-button"
              style={{ 
                padding: '12px', 
                fontSize: '8pt', 
                textAlign: 'left', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px', 
                border: '2px solid var(--accent)', 
                background: 'var(--surface)',
                transition: 'all 0.12s ease'
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color: 'var(--accent)' }}>Batch Analysis</div>
                <div style={{ fontSize: '8pt', opacity: 0.7 }}>Analyze vehicle images with AI</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/admin/verifications')}
              className="button button-secondary cursor-button"
              style={{ 
                padding: '12px', 
                fontSize: '8pt', 
                textAlign: 'left', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                border: '2px solid var(--border-light)',
                transition: 'all 0.12s ease'
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Verifications</div>
                <div style={{ fontSize: '8pt', opacity: 0.7 }}>Review pending verifications</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/admin/merge-proposals')}
              className="button button-secondary cursor-button"
              style={{ 
                padding: '12px', 
                fontSize: '8pt', 
                textAlign: 'left', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                border: '2px solid var(--border-light)',
                transition: 'all 0.12s ease'
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Merge Proposals</div>
                <div style={{ fontSize: '8pt', opacity: 0.7 }}>Review duplicate vehicles</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/admin/price-editor')}
              className="button button-secondary cursor-button"
              style={{ 
                padding: '12px', 
                fontSize: '8pt', 
                textAlign: 'left', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                border: '2px solid var(--border-light)',
                transition: 'all 0.12s ease'
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Price Editor</div>
                <div style={{ fontSize: '8pt', opacity: 0.7 }}>Bulk edit vehicle prices</div>
              </div>
            </button>

            <button
              onClick={() => navigate('/investment-opportunities')}
              className="button button-secondary cursor-button"
              style={{ 
                padding: '12px', 
                fontSize: '8pt', 
                textAlign: 'left', 
                display: 'flex', 
                alignItems: 'center', 
                gap: '12px',
                border: '2px solid var(--border-light)',
                transition: 'all 0.12s ease'
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>Investment Opps</div>
                <div style={{ fontSize: '8pt', opacity: 0.7 }}>View opportunities</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Vehicle Image Analysis Queue */}
      {vehicleImageQueue.length > 0 && (
        <div className="card" style={{ marginBottom: '24px', border: '2px solid var(--accent)' }}>
          <div className="card-header" style={{
            background: 'var(--accent-dim)',
            borderBottom: '2px solid var(--accent)',
            fontSize: '8pt',
            fontWeight: 700,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>Vehicle Image Analysis Queue</span>
            <span style={{ fontSize: '8pt', color: 'var(--accent)' }}>
              {vehicleImageQueue.reduce((sum, v) => sum + v.count, 0)} unanalyzed vehicle images
            </span>
          </div>
          <div className="card-body">
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
              These vehicle images haven't been analyzed by AI yet. Click "Analyze Now" to trigger batch analysis.
            </div>
            <div style={{ display: 'grid', gap: '8px', maxHeight: '400px', overflow: 'auto' }}>
              {vehicleImageQueue.slice(0, 20).map((vehicle) => (
                <div
                  key={vehicle.vehicle_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    border: '1px solid var(--border-light)',
                    fontSize: '8pt'
                  }}
                >
                  <div>
                    <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                      {vehicle.vehicle_id.slice(0, 8)}...
                    </span>
                    <span style={{ marginLeft: '12px', fontWeight: 600 }}>
                      {vehicle.count} images
                    </span>
                  </div>
                  <button
                    onClick={() => navigate(`/admin/batch-analysis?vehicle=${vehicle.vehicle_id}`)}
                    className="button button-primary cursor-button"
                    style={{ 
                      fontSize: '8pt', 
                      padding: '6px 12px',
                      border: '2px solid var(--accent)',
                      transition: 'all 0.12s ease'
                    }}
                  >
                    Analyze Now
                  </button>
                </div>
              ))}
              {vehicleImageQueue.length > 20 && (
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', textAlign: 'center', padding: '8px' }}>
                  +{vehicleImageQueue.length - 20} more vehicles...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="card">
        <div className="card-header" style={{ fontSize: '8pt', fontWeight: 700 }}>
          Recent Activity (Last 10 events)
        </div>
        <div className="card-body">
          {recentActivity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)', fontSize: '8pt' }}>
              No recent activity
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentActivity.map((event, idx) => (
                <div
                  key={event.id || idx}
                  style={{
                    padding: '12px',
                    background: 'var(--bg-secondary)',
                    borderRadius: '4px',
                    border: '1px solid var(--border-light)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '8pt'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      {event.event_type?.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                      {event.description || 'No description'}
                    </div>
                  </div>
                  <div style={{ fontSize: '8pt', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminMissionControl;

