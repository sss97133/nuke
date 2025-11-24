import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import '../design-system.css';

interface Vehicle {
  id: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  created_at: string;
  image_count: number;
  primary_image_url: string | null;
}

interface RecentActivity {
  id: string;
  vehicle_id: string;
  event_type: string;
  title: string;
  event_date: string;
  created_at: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
}

interface Stats {
  totalVehicles: number;
  totalImages: number;
  totalEvents: number;
  recentActivity: number; // Activity in last 7 days
}

export default function Dashboard() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [recentActivity, setRecentActivity] = useState<RecentActivity[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalVehicles: 0,
    totalImages: 0,
    totalEvents: 0,
    recentActivity: 0
  });
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboard();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;

      // Load user's vehicles - try both uploaded_by and user_id for compatibility
      const { data: vehiclesData, error: vehiclesError } = await supabase
        .from('vehicles')
        .select(`
          id,
          year,
          make,
          model,
          vin,
          created_at,
          image_count,
          primary_image_url
        `)
        .or(`uploaded_by.eq.${session.user.id},user_id.eq.${session.user.id}`)
        .order('created_at', { ascending: false });

      if (vehiclesError) {
        console.error('Error loading vehicles:', vehiclesError);
        throw vehiclesError;
      }
      
      console.log('Loaded vehicles:', vehiclesData?.length || 0, vehiclesData);
      setVehicles(vehiclesData || []);

      // Load recent activity from timeline_events
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: activityData } = await supabase
        .from('vehicle_timeline_events')
        .select(`
          id,
          vehicle_id,
          event_type,
          title,
          event_date,
          created_at,
          vehicles!inner(
            year,
            make,
            model
          )
        `)
        .eq('vehicles.uploaded_by', session.user.id)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(10);

      // Transform the nested data
      const transformedActivity = (activityData || []).map((item: any) => ({
        id: item.id,
        vehicle_id: item.vehicle_id,
        event_type: item.event_type,
        title: item.title,
        event_date: item.event_date,
        created_at: item.created_at,
        vehicle_year: item.vehicles?.year,
        vehicle_make: item.vehicles?.make,
        vehicle_model: item.vehicles?.model
      }));

      setRecentActivity(transformedActivity);

      // Calculate stats
      const totalImages = vehiclesData?.reduce((sum, v) => sum + (v.image_count || 0), 0) || 0;

      const { count: eventCount } = await supabase
        .from('vehicle_timeline_events')
        .select('*', { count: 'exact', head: true })
        .in('vehicle_id', (vehiclesData || []).map(v => v.id));

      setStats({
        totalVehicles: vehiclesData?.length || 0,
        totalImages,
        totalEvents: eventCount || 0,
        recentActivity: transformedActivity.length
      });

    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getEventTypeLabel = (eventType: string) => {
    const labels: Record<string, string> = {
      'maintenance': 'MAINT',
      'repair': 'REPAIR',
      'modification': 'MOD',
      'purchase': 'BOUGHT',
      'sale': 'SOLD',
      'inspection': 'INSPECT',
      'registration': 'REG',
      'insurance': 'INS',
      'note': 'NOTE',
      'image_upload': 'PHOTO'
    };
    return labels[eventType] || eventType.toUpperCase().slice(0, 6);
  };

  if (loading) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div style={{ padding: 'var(--space-8)', textAlign: 'center' }}>
        <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Please log in to view your dashboard
        </div>
        <button
          onClick={() => navigate('/auth')}
          style={{
            background: 'var(--text)',
            color: 'var(--white)',
            border: '2px outset var(--border)',
            padding: '8px 16px',
            fontSize: '9pt',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          Log In
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '14pt', fontWeight: 'bold', marginBottom: '4px' }}>
            Dashboard
          </h1>
          <p style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
          Welcome back, {session.user.email?.split('@')[0]}
          </p>
        </div>

      {/* Stats Bar */}
        <div style={{
          display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '24px'
        }}>
          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
          padding: '12px'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
            MY VEHICLES
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
            {stats.totalVehicles}
            </div>
          </div>

          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
          padding: '12px'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
            TOTAL PHOTOS
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
            {stats.totalImages}
            </div>
          </div>

          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
          padding: '12px'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
            TIMELINE EVENTS
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
            {stats.totalEvents}
            </div>
          </div>

          <div style={{
            background: 'var(--white)',
            border: '2px solid var(--border)',
          padding: '12px'
          }}>
            <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginBottom: '4px' }}>
            RECENT ACTIVITY
            </div>
            <div style={{ fontSize: '18pt', fontWeight: 'bold' }}>
            {stats.recentActivity}
            </div>
          <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '2px' }}>
            Last 7 days
            </div>
          </div>
        </div>

      {/* Quick Actions */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
          Quick Actions
          </h2>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            onClick={() => navigate('/add-vehicle')}
            style={{
              background: 'var(--text)',
              color: 'var(--white)',
              border: '2px outset var(--border)',
              padding: '8px 12px',
              fontSize: '9pt',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            ADD VEHICLE
          </button>
          <button
            onClick={() => navigate('/vehicles')}
            style={{
                background: 'var(--white)',
              color: 'var(--text)',
                border: '2px solid var(--border)',
              padding: '8px 12px',
              fontSize: '9pt',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            VIEW ALL VEHICLES
          </button>
          <button
            onClick={() => navigate('/')}
                    style={{
                      background: 'var(--white)',
              color: 'var(--text)',
              border: '2px solid var(--border)',
              padding: '8px 12px',
              fontSize: '9pt',
                      cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            EXPLORE PLATFORM
          </button>
                    </div>
          </div>

      {/* Main Content */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        {/* My Vehicles */}
          <div>
          <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
            My Vehicles
            </h2>
            <div style={{
              background: 'var(--white)',
              border: '2px solid var(--border)',
            maxHeight: '400px',
            overflowY: 'auto'
            }}>
            {vehicles.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center' }}>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)', marginBottom: '12px' }}>
                  No vehicles yet
                </div>
                  <button
                    onClick={() => navigate('/add-vehicle')}
                    style={{
                      background: 'var(--text)',
                      color: 'var(--white)',
                      border: '2px outset var(--border)',
                    padding: '6px 12px',
                    fontSize: '8pt',
                      cursor: 'pointer',
                    fontWeight: 'bold'
                    }}
                  >
                  ADD YOUR FIRST VEHICLE
                  </button>
                </div>
              ) : (
              vehicles.map(vehicle => (
                    <div
                  key={vehicle.id}
                  onClick={() => navigate(`/vehicle/${vehicle.id}`)}
                      style={{
                        padding: '12px',
                    borderBottom: '1px solid var(--border)',
                        cursor: 'pointer',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                  {vehicle.primary_image_url ? (
                    <div style={{
                      width: '60px',
                      height: '45px',
                      background: `url(${vehicle.primary_image_url}) center/cover`,
                      border: '1px solid var(--border)',
                      flexShrink: 0
                    }} />
                  ) : (
                    <div style={{
                      width: '60px',
                      height: '45px',
                      background: 'var(--grey-100)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '8pt',
                      color: 'var(--text-muted)',
                      flexShrink: 0
                    }}>
                      NO IMAGE
                      </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '9pt', fontWeight: 'bold' }}>
                      {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                    <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '2px' }}>
                      {vehicle.image_count || 0} photos
                      {vehicle.vin && ` • VIN: ${vehicle.vin.slice(-6)}`}
                    </div>
                  </div>
                </div>
              ))
              )}
          </div>
            </div>

        {/* Recent Activity */}
        <div>
          <h2 style={{ fontSize: '10pt', fontWeight: 'bold', marginBottom: '8px' }}>
            Recent Activity
                </h2>
                <div style={{
                  background: 'var(--white)',
                  border: '2px solid var(--border)',
            maxHeight: '400px',
            overflowY: 'auto'
          }}>
            {recentActivity.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center' }}>
                <div style={{ fontSize: '9pt', color: 'var(--text-muted)' }}>
                  No recent activity
                </div>
                <div style={{ fontSize: '8pt', color: 'var(--text-muted)', marginTop: '8px' }}>
                  Add events to your vehicle timelines to see them here
                </div>
              </div>
            ) : (
              recentActivity.map(activity => (
                    <div
                  key={activity.id}
                  onClick={() => navigate(`/vehicle/${activity.vehicle_id}`)}
                      style={{
                        padding: '12px',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--grey-100)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <div style={{
                      background: 'var(--text)',
                      color: 'var(--white)',
                      padding: '2px 4px',
                      fontSize: '7pt',
                      fontWeight: 'bold',
                      border: '1px solid var(--border)',
                      flexShrink: 0
                    }}>
                      {getEventTypeLabel(activity.event_type)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '9pt', fontWeight: 'bold', marginBottom: '2px' }}>
                        {activity.title}
                      </div>
                      <div style={{ fontSize: '8pt', color: 'var(--text-muted)' }}>
                        {activity.vehicle_year} {activity.vehicle_make} {activity.vehicle_model}
                      </div>
                      <div style={{ fontSize: '7pt', color: 'var(--text-muted)', marginTop: '4px' }}>
                        {formatDate(activity.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
