import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import DiscoveryFeed from '../components/feed/DiscoveryFeed';
import QuickVehicleAdd from '../components/feed/QuickVehicleAdd';
import DiscoveryHighlights from '../components/feed/DiscoveryHighlights';
import '../design-system.css';

interface BuildAnalysisResult {
  vehicle_id: string;
  year: number;
  make: string;
  model: string;
  last_activity?: string;
  days_since_activity?: number;
  total_events: number;
  stagnation_risk: number;
  build_health_score: number;
  detected_issues: string[];
  events_last_30_days?: number;
  activity_trend?: string;
  current_build_stage?: string;
  photos_uploaded?: number;
  receipts_uploaded?: number;
  money_spent_documented?: number;
}

const Discovery: React.FC = () => {
  const [session, setSession] = useState<any>(null);
  const [stats, setStats] = useState({
    totalVehicles: 0,
    totalUsers: 0,
    vehiclesForSale: 0,
    recentlyAdded: 0
  });
  const [viewMode, setViewMode] = useState<'gallery' | 'compact' | 'technical'>('gallery');
  const [denseModeEnabled, setDenseModeEnabled] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number; lng: number} | undefined>();

  // Check authentication status
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
  }, []);

  // Load platform statistics
  useEffect(() => {
    loadPlatformStats();
    getCurrentLocation();
  }, []);

  const getCurrentLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.log('Location access denied:', error);
        }
      );
    }
  };

  // Analysis UI removed per Windows 95 compact design

  const loadPlatformStats = async () => {
    try {
      const [vehicleCount, userCount, recentCount] = await Promise.all([
        supabase.from('vehicles').select('id', { count: 'exact' }),
        supabase.from('profiles').select('id', { count: 'exact' }),
        supabase.from('vehicles').select('id', { count: 'exact' })
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      ]);

      setStats({
        totalVehicles: vehicleCount.count || 0,
        totalUsers: userCount.count || 0,
        vehiclesForSale: 0, // Remove non-existent field
        recentlyAdded: recentCount.count || 0
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  return (
    <AppLayout>
      <div className="fade-in">
        {/* Header */}
        <section className="section">
          <div className="card">
            <div className="card-body" style={{ padding: '6px 8px' }}>
              <div className="flex items-center justify-between">
                <div className="text-small text-muted">
                  {stats.totalVehicles} vehicles • {stats.totalUsers} members • {stats.recentlyAdded} added this week
                </div>
                <div className="flex items-center" style={{ gap: '2px' }}>
                  <button
                    className={`button ${viewMode === 'gallery' ? 'button-primary' : 'button-secondary'}`}
                    onClick={() => {
                      if (viewMode === 'gallery') {
                        setDenseModeEnabled(!denseModeEnabled);
                      } else {
                        setViewMode('gallery');
                        setDenseModeEnabled(false);
                      }
                    }}
                    style={{ 
                      padding: '3px 6px',
                      fontSize: '8pt',
                      minWidth: '24px',
                      height: '20px'
                    }}
                    title={viewMode === 'gallery' && denseModeEnabled ? "Gallery (Dense)" : "Gallery"}
                  >
                    {viewMode === 'gallery' ? (denseModeEnabled ? 'Gallery*' : 'Gallery') : 'Gallery'}
                  </button>
                  <button
                    className={`button ${viewMode === 'compact' ? 'button-primary' : 'button-secondary'}`}
                    onClick={() => {
                      if (viewMode === 'compact') {
                        setDenseModeEnabled(!denseModeEnabled);
                      } else {
                        setViewMode('compact');
                        setDenseModeEnabled(false);
                      }
                    }}
                    style={{ 
                      padding: '3px 6px',
                      fontSize: '8pt',
                      minWidth: '24px',
                      height: '20px'
                    }}
                    title={viewMode === 'compact' && denseModeEnabled ? "Compact (Dense)" : "Compact"}
                  >
                    {viewMode === 'compact' ? (denseModeEnabled ? 'Compact*' : 'Compact') : 'Compact'}
                  </button>
                  <button
                    className={`button ${viewMode === 'technical' ? 'button-primary' : 'button-secondary'}`}
                    onClick={() => {
                      if (viewMode === 'technical') {
                        setDenseModeEnabled(!denseModeEnabled);
                      } else {
                        setViewMode('technical');
                        setDenseModeEnabled(false);
                      }
                    }}
                    style={{ 
                      padding: '3px 6px',
                      fontSize: '8pt',
                      minWidth: '24px',
                      height: '20px'
                    }}
                    title={viewMode === 'technical' && denseModeEnabled ? "Technical (Dense)" : "Technical"}
                  >
                    {viewMode === 'technical' ? (denseModeEnabled ? 'Technical*' : 'Technical') : 'Technical'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* Content Area */}
        <section className="section">
          {/* Highlights */}
          <div style={{ marginBottom: '12px' }}>
            <DiscoveryHighlights />
          </div>

          <DiscoveryFeed
            viewMode={viewMode}
            denseMode={denseModeEnabled}
            initialLocation={userLocation}
          />
        </section>

        {/* Quick Add Vehicle Floating Button */}
        {session && (
          <QuickVehicleAdd
            onVehicleAdded={() => {
              // Refresh the feed when a new vehicle is added
              window.location.reload();
            }}
          />
        )}

      </div>
    </AppLayout>
  );
};

export default Discovery;
