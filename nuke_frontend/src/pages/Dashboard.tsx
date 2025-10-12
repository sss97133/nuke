import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import { NotificationService, type Notification } from '../services/notificationService';
import { AdminNotificationService } from '../services/adminNotificationService';
import NotificationCenter from '../components/NotificationCenter';
import OwnershipVerificationDashboard from '../components/admin/OwnershipVerificationDashboard';
import '../design-system.css';


interface DashboardData {
  notifications: Notification[];
  pendingRequests: number;
  recentActivity: any[];
  userStats: {
    vehicleCount: number;
    contributionCount: number;
    verificationScore: number;
  };
}

const Dashboard: React.FC = () => {
  const [dashboardData, setDashboardData] = useState<DashboardData>({
    notifications: [],
    pendingRequests: 0,
    recentActivity: [],
    userStats: {
      vehicleCount: 0,
      contributionCount: 0,
      verificationScore: 0
    }
  });
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboardData();
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    try {
      const adminStatus = await AdminNotificationService.isCurrentUserAdmin();
      setIsAdmin(adminStatus);
    } catch (error) {
      console.error('Error checking admin status:', error);
      setIsAdmin(false);
    } finally {
      setAdminLoading(false);
    }
  };

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      
      if (!session) {
        setLoading(false);
        return;
      }

      // Try to load real notifications, fall back to empty array if tables don't exist yet
      let notifications: Notification[] = [];
      let userStats = {
        vehicleCount: 0,
        contributionCount: 0,
        verificationScore: 85,
        pendingRequests: 0
      };

      try {
        notifications = await NotificationService.getUserNotifications(session.user.id);
        userStats = await NotificationService.getUserStats(session.user.id);
      } catch (error) {
        console.log('Notification tables not yet available, using fallback data');
        
        // Load basic vehicle count
        const { data: vehicles } = await supabase
          .from('vehicles')
          .select('id')
          .eq('uploaded_by', session.user.id);
        
        userStats.vehicleCount = vehicles?.length || 0;
      }

      setDashboardData({
        notifications,
        pendingRequests: userStats.pendingRequests,
        recentActivity: [],
        userStats
      });
    } catch (error) {
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };


  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  return (
    <AppLayout>
      {loading ? (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading dashboard...</p>
        </div>
      ) : (
        <div className="fade-in">
          {/* User Stats Overview */}
          <section className="section">
            <div className="card">
              <div className="card-header">Your Activity</div>
              <div className="card-body">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px' }}>
                  <div className="stat-item">
                    <div className="stat-value">{dashboardData.userStats.vehicleCount}</div>
                    <div className="stat-label">Vehicles</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{dashboardData.userStats.contributionCount}</div>
                    <div className="stat-label">Contributions</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{dashboardData.userStats.verificationScore}%</div>
                    <div className="stat-label">Trust Score</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{dashboardData.pendingRequests}</div>
                    <div className="stat-label">Pending Requests</div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Ownership Verification Dashboard (only for admins) */}
          {isAdmin && !adminLoading && (
            <section className="section">
              <div className="card">
                <div className="card-header" style={{ borderLeft: '4px solid #2563eb' }}>
                  Admin: Ownership Verifications
                </div>
                <div className="card-body" style={{ padding: '0' }}>
                  <OwnershipVerificationDashboard />
                </div>
              </div>
            </section>
          )}

          {/* Regular User Notifications */}
          <section className="section">
            <div className="card">
              <div className="card-header">
                Notifications 
                {dashboardData.pendingRequests > 0 && (
                  <span className="badge badge-warning" style={{ marginLeft: '8px' }}>
                    {dashboardData.pendingRequests}
                  </span>
                )}
              </div>
              <div className="card-body">
                <NotificationCenter 
                  userId={session?.user?.id || ''} 
                  onNotificationUpdate={loadDashboardData}
                />
              </div>
            </div>
          </section>


          {/* Empty State */}
          {dashboardData.userStats.vehicleCount === 0 && (
            <section className="section">
              <div className="card">
                <div className="card-body text-center" style={{ padding: '48px 24px' }}>
                  <h2 className="text font-bold" style={{ marginBottom: '12px' }}>Welcome to Nuke</h2>
                  <p className="text-small text-muted" style={{ marginBottom: '24px' }}>
                    Your vehicle command center. Start by adding your first vehicle or importing from Dropbox.
                  </p>
                  <button 
                    className="button button-primary"
                    onClick={() => navigate('/add-vehicle')}
                  >
                    Add Vehicle
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </AppLayout>
  );
};

export default Dashboard;
