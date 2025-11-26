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
  const [scanProgress, setScanProgress] = useState<any>(null);
  const [imageScanStats, setImageScanStats] = useState<any>(null);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 5000); // Refresh every 5 seconds for scanning
    return () => clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    try {
      const [
        vehiclesCount,
        imagesCount,
        orgsCount,
        usersCount,
        queueData,
        opportunitiesCount,
        todayData,
        recentData,
        vehicleQueueData,
        scanProgressData,
        imageScanData
      ] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact', head: true }),
        supabase.from('vehicle_images').select('id', { count: 'exact', head: true }),
        supabase.from('organization_inventory').select('organization_id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('organization_analysis_queue').select('*'),
        supabase.from('organization_narratives').select('id', { count: 'exact', head: true }),
        supabase.from('vehicle_images').select('id', { count: 'exact', head: true }).gte('created_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
        supabase.from('timeline_events').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('vehicle_images').select('vehicle_id, created_at').is('ai_analysis', null).limit(100),
        supabase.from('ai_scan_progress').select('*').order('created_at', { ascending: false }).limit(1).single(),
        supabase.rpc('get_image_scan_stats')
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
      setScanProgress(scanProgressData.data);
      setImageScanStats(imageScanData.data);
      
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
      alert(`Analysis started: ${result.imagesAnalyzed || 0} images processed`);
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
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '8pt' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '32px', borderBottom: '2px solid var(--border)', paddingBottom: '16px' }}>
        <h1 style={{ fontSize: '12pt', fontWeight: 700, marginBottom: '4px' }}>
          ADMIN MISSION CONTROL
        </h1>
        <p style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
          Real-time system monitoring and control
        </p>
      </div>

      {/* AI SCANNING STATUS - PROMINENT */}
      {(scanProgress || imageScanStats) && (
        <div style={{ marginBottom: '24px', border: '2px solid #000', background: '#f8f8f8' }}>
          <div style={{
            background: '#000',
            color: '#fff',
            padding: '12px 16px',
            fontSize: '8pt',
            fontWeight: 700,
            letterSpacing: '0.5px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>AI IMAGE SCANNING</span>
            {scanProgress?.status === 'running' && (
              <span style={{ background: '#10b981', color: '#000', padding: '4px 8px', fontSize: '8pt', fontWeight: 700 }}>
                ACTIVE
              </span>
            )}
          </div>
          <div style={{ padding: '20px' }}>
            {/* Overall Progress Bar */}
            {imageScanStats && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '8pt', fontWeight: 600 }}>OVERALL PROGRESS</span>
                  <span style={{ fontSize: '10pt', fontWeight: 700 }}>
                    {imageScanStats.scan_percentage || 0}%
                  </span>
                </div>
                <div style={{
                  width: '100%',
                  height: '24px',
                  background: '#e0e0e0',
                  border: '2px solid #000',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: `${imageScanStats.scan_percentage || 0}%`,
                    height: '100%',
                    background: '#000',
                    transition: 'width 0.5s ease',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    <span style={{ color: '#fff', fontSize: '8pt', fontWeight: 700 }}>
                      {imageScanStats.scan_percentage > 10 && `${imageScanStats.scan_percentage}%`}
                    </span>
                  </div>
      </div>

      {/* Stats Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '24px' }}>
                  <div style={{ border: '2px solid #000', padding: '16px', background: '#fff' }}>
                    <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px', fontWeight: 600 }}>
                      VEHICLE IMAGES
                    </div>
                    <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px' }}>
                      {imageScanStats.scanned_vehicle_images?.toLocaleString()} / {imageScanStats.total_vehicle_images?.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {imageScanStats.unscanned_vehicle_images?.toLocaleString()} REMAINING
                    </div>
                  </div>
                  <div style={{ border: '2px solid #000', padding: '16px', background: '#fff' }}>
                    <div style={{ fontSize: '8pt', color: '#666', marginBottom: '8px', fontWeight: 600 }}>
                      ORGANIZATION IMAGES
                    </div>
                    <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px' }}>
                      {imageScanStats.scanned_org_images?.toLocaleString()} / {imageScanStats.total_org_images?.toLocaleString()}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {imageScanStats.unscanned_org_images?.toLocaleString()} REMAINING
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Current Scan Details */}
            {scanProgress && scanProgress.status === 'running' && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                background: '#10b98110',
                border: '2px solid #10b981'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px' }}>
                      CURRENT SCAN: {scanProgress.scan_type?.toUpperCase().replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      Started: {new Date(scanProgress.started_at).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '12pt', fontWeight: 700 }}>
                      {scanProgress.processed_images}/{scanProgress.total_images}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#ef4444', fontWeight: 600 }}>
                      {scanProgress.failed_images} FAILED
                    </div>
                  </div>
                </div>
                {scanProgress.total_images > 0 && (
                  <div style={{
                    width: '100%',
                    height: '6px',
                    background: '#e0e0e0',
                    border: '1px solid #000'
                  }}>
                    <div style={{
                      width: `${(scanProgress.processed_images / scanProgress.total_images) * 100}%`,
                      height: '100%',
                      background: '#10b981',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Stats */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          SYSTEM STATISTICS
        </h2>
      <div style={{
        display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '12px'
      }}>
        {[
            { label: 'VEHICLES', value: stats?.totalVehicles.toLocaleString() },
            { label: 'IMAGES', value: stats?.totalImages.toLocaleString() },
            { label: 'ORGANIZATIONS', value: stats?.totalOrganizations.toLocaleString() },
            { label: 'USERS', value: stats?.totalUsers.toLocaleString() },
            { label: 'PENDING ANALYSIS', value: stats?.pendingAnalysis.toLocaleString(), alert: (stats?.pendingAnalysis || 0) > 0 },
            { label: 'OPPORTUNITIES', value: stats?.investmentOpportunities.toLocaleString() },
            { label: 'TODAY UPLOADS', value: stats?.todayUploads.toLocaleString() },
            { label: 'PROCESSING', value: stats?.activeProcessing.toLocaleString() }
        ].map((stat, idx) => (
          <div
            key={idx}
            style={{
                border: '2px solid #000',
                background: stat.alert ? '#fef2f2' : '#fff',
                padding: '12px',
                textAlign: 'center'
              }}
            >
              <div style={{ fontSize: '16pt', fontWeight: 700, marginBottom: '4px', color: stat.alert ? '#ef4444' : '#000' }}>
                {stat.value}
              </div>
              <div style={{ fontSize: '8pt', color: '#666', fontWeight: 600 }}>
                {stat.label}
              </div>
            </div>
          ))}
            </div>
          </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          QUICK ACTIONS
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
          {[
            { label: 'SCRIPT CONTROL', sublabel: 'Batch operations', path: '/admin/scripts' },
            { label: 'IMAGE PROCESSING', sublabel: 'Monitor pipeline', path: '/admin/image-processing' },
            { label: 'BATCH ANALYSIS', sublabel: 'AI vehicle analysis', path: '/admin/batch-analysis', primary: true },
            { label: 'EXTRACTION MONITOR', sublabel: 'Image extraction progress', path: '/admin/extraction-monitor', primary: true },
            { label: 'VERIFICATIONS', sublabel: 'Review pending', path: '/admin/verifications' },
            { label: 'MERGE PROPOSALS', sublabel: 'Duplicate vehicles', path: '/admin/merge-proposals' },
            { label: 'PRICE EDITOR', sublabel: 'Bulk price edits', path: '/admin/price-editor' }
          ].map((action, idx) => (
            <button
              key={idx}
              onClick={() => navigate(action.path)}
              style={{
                padding: '16px',
                fontSize: '8pt',
                textAlign: 'left',
                border: action.primary ? '2px solid #000' : '2px solid #ccc',
                background: action.primary ? '#000' : '#fff',
                color: action.primary ? '#fff' : '#000',
                cursor: 'pointer',
                transition: 'all 0.12s ease',
                fontWeight: 600
              }}
              onMouseEnter={(e) => {
                if (!action.primary) {
                  e.currentTarget.style.borderColor = '#000';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }
              }}
              onMouseLeave={(e) => {
                if (!action.primary) {
                  e.currentTarget.style.borderColor = '#ccc';
                  e.currentTarget.style.transform = 'translateY(0)';
                }
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '4px' }}>{action.label}</div>
              <div style={{ fontSize: '8pt', opacity: 0.7 }}>{action.sublabel}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Analysis Queue */}
      {analysisQueue.length > 0 && (
        <div style={{ marginBottom: '24px', border: '2px solid #f59e0b', background: '#fffbeb' }}>
          <div style={{
            background: '#f59e0b',
            color: '#000',
            padding: '12px 16px',
            fontSize: '8pt',
            fontWeight: 700,
            letterSpacing: '0.5px'
          }}>
            PENDING ANALYSIS ({analysisQueue.reduce((sum, q) => sum + q.pending_count, 0)} IMAGES)
          </div>
          <div style={{ padding: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {analysisQueue.map((queue) => (
                <div
                  key={queue.organization_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    background: '#fff',
                    border: '2px solid #e5e5e5'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '8pt', fontWeight: 700, marginBottom: '4px', fontFamily: 'monospace' }}>
                      ORG: {queue.organization_id.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {queue.pending_count} images | Oldest: {new Date(queue.oldest_image).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => navigate(`/org/${queue.organization_id}`)}
                      style={{ 
                        fontSize: '8pt', 
                        padding: '8px 12px',
                        border: '2px solid #000',
                        background: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      VIEW
                    </button>
                    <button
                      onClick={() => runAnalysis(queue.organization_id)}
                      style={{ 
                        fontSize: '8pt', 
                        padding: '8px 12px',
                        border: '2px solid #000',
                        background: '#000',
                        color: '#fff',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                      disabled={processing === queue.organization_id}
                    >
                      {processing === queue.organization_id ? 'PROCESSING...' : `ANALYZE (${queue.pending_count})`}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div style={{ border: '2px solid #000' }}>
        <div style={{
          background: '#000',
          color: '#fff',
          padding: '12px 16px',
          fontSize: '8pt',
          fontWeight: 700,
          letterSpacing: '0.5px'
        }}>
          RECENT ACTIVITY
        </div>
        <div style={{ padding: '16px', background: '#fff' }}>
          {recentActivity.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#999', fontSize: '8pt' }}>
              NO RECENT ACTIVITY
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {recentActivity.map((event, idx) => (
                <div
                  key={event.id || idx}
                  style={{
                    padding: '12px',
                    background: '#f8f8f8',
                    border: '1px solid #e5e5e5',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '8pt'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px', textTransform: 'uppercase' }}>
                      {event.event_type?.replace(/_/g, ' ')}
                    </div>
                    <div style={{ fontSize: '8pt', color: '#666' }}>
                      {event.description || 'No description'}
                    </div>
                  </div>
                  <div style={{ fontSize: '8pt', color: '#999', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
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
