import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AppLayout from '../components/layout/AppLayout';
import DiscoveryFeed from '../components/feed/DiscoveryFeed';
import AddVehicle from './add-vehicle/AddVehicle';
import { MobileAddVehicle } from '../components/mobile/MobileAddVehicle';
import { useIsMobile } from '../hooks/useIsMobile';
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
  const isMobile = useIsMobile();
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
  const [showAddVehicle, setShowAddVehicle] = useState(false);

  // Optimize mobile UX: default to compact, enable dense mode
  React.useEffect(() => {
    if (isMobile) {
      setViewMode('compact');
      setDenseModeEnabled(true);
    }
  }, [isMobile]);

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
      <div className="fade-in">
        {/* Header */}
        <section className="section">
          <div className="card">
            <div className="card-body" style={{ padding: '6px 8px' }}>
              <div className="flex items-center justify-between">
                <div className="text-small text-muted">
                  {stats.totalVehicles} vehicles • {stats.totalUsers} members • {stats.recentlyAdded} added this week
                </div>
                <div />
              </div>
            </div>
          </div>
        </section>


        {/* Content Area */}
        <section className="section">

          <DiscoveryFeed
            viewMode={viewMode}
            denseMode={denseModeEnabled}
            initialLocation={userLocation}
          />
        </section>

        {/* Add Vehicle Floating Button */}
        {session && !showAddVehicle && (
          <button
            type="button"
            onClick={() => setShowAddVehicle(true)}
            className="fixed w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center text-2xl z-40"
            title="Add Vehicle"
            aria-label="Add Vehicle"
            aria-haspopup="dialog"
            aria-expanded={showAddVehicle}
            style={{
              position: 'fixed',
              bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
              right: 'calc(16px + env(safe-area-inset-right, 0px))',
              touchAction: 'manipulation'
            }}
          >
            +
          </button>
        )}

        {/* Add Vehicle Modal */}
        {session && showAddVehicle && (
          isMobile ? (
            <MobileAddVehicle
              onClose={() => setShowAddVehicle(false)}
              onSuccess={() => {
                setShowAddVehicle(false);
                // Refresh the feed when a new vehicle is added
                window.location.reload();
              }}
            />
          ) : (
            <AddVehicle
              mode="modal"
              onClose={() => setShowAddVehicle(false)}
              onSuccess={() => {
                setShowAddVehicle(false);
                // Refresh the feed when a new vehicle is added
                window.location.reload();
              }}
            />
          )
        )}

      </div>
  );
};

export default Discovery;
