
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { GeoFencedDiscovery } from '@/components/discovery/GeoFencedDiscovery';
import { VehicleCentricLayout } from '@/components/layout/vehicle-centric-layout';
import { TrustIndicator } from '@/components/ui/trust-indicator';
import { Vehicle, VehicleGrid, VehicleMarketplaceGrid } from '@/components/vehicle/vehicle-grid';
import { trackInteraction } from '@/utils/adaptive-ui';
import { supabase } from '@/lib/supabase-client';
import { useAuth } from '@/providers/AuthProvider';
import { useUserStore } from '@/stores/userStore';
import { tokens } from '@/styles/design-tokens';

/**
 * Dashboard Page
 * 
 * Modern vehicle-centric dashboard that showcases the user's vehicles,
 * nearby discoveries, and marketplace items with an emphasis on trust
 * mechanisms and verification levels.
 */
const Dashboard = () => {
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [marketplaceVehicles, setMarketplaceVehicles] = useState<Vehicle[]>([]);
  const [trustScore, setTrustScore] = useState<number>(0);
  const { isAuthenticated } = useAuth();
  const userState = useUserStore(state => state.user);
  const navigate = useNavigate();
  
  // Check connection and load data
  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setLoading(true);
        
        // Check database connection
        console.info('Checking Supabase connection...');
        const { error: connectionError } = await supabase.from('vehicles').select('count').single();
        if (connectionError) throw connectionError;
        console.info('Supabase connection successful');
        
        // Track this dashboard view for adaptive UI
        trackInteraction({
          type: 'PAGE_VIEW',
          itemId: 'dashboard',
          timestamp: new Date().toISOString(),
          metadata: {
            userId: userState?.id?.toString() || '',
          },
        });
        
        // Load user's vehicles
        // In a real implementation, this would fetch actual vehicle data
        // For now, we'll use sample data
        const userVehicles: Vehicle[] = [
          {
            id: '1',
            make: 'Toyota',
            model: 'Supra',
            year: 1998,
            trustScore: 87,
            verificationLevel: 'PTZ_VERIFIED',
            imageUrl: '/images/placeholder-car.jpg',
            ownershipType: 'FULL',
          },
          {
            id: '2',
            make: 'BMW',
            model: 'M3',
            year: 2003,
            trustScore: 92,
            verificationLevel: 'BLOCKCHAIN',
            imageUrl: '/images/placeholder-car.jpg',
            ownershipType: 'FULL',
          },
        ];
        
        // Load marketplace vehicles
        const marketVehicles: Vehicle[] = [
          {
            id: '3',
            make: 'Porsche',
            model: '911',
            year: 1989,
            trustScore: 79,
            verificationLevel: 'PROFESSIONAL',
            imageUrl: '/images/placeholder-car.jpg',
            ownershipType: 'FRACTIONAL',
            fractions: {
              available: 75,
              total: 100,
              pricePerFraction: 350,
            }
          },
          {
            id: '4',
            make: 'Ferrari',
            model: 'F40',
            year: 1992,
            trustScore: 95,
            verificationLevel: 'BLOCKCHAIN',
            imageUrl: '/images/placeholder-car.jpg',
            ownershipType: 'FRACTIONAL',
            fractions: {
              available: 12,
              total: 1000,
              pricePerFraction: 1200,
            }
          },
          {
            id: '5',
            make: 'Nissan',
            model: 'Skyline GT-R',
            year: 1998,
            trustScore: 82,
            verificationLevel: 'MULTI_SOURCE',
            imageUrl: '/images/placeholder-car.jpg',
            ownershipType: 'FULL',
            price: 120000,
          },
        ];
        
        // Calculate user's overall trust score
        const avgTrustScore = userVehicles.reduce((sum, vehicle) => 
          sum + (vehicle.trustScore || 0), 0) / (userVehicles.length || 1);
        
        setVehicles(userVehicles);
        setMarketplaceVehicles(marketVehicles);
        setTrustScore(Math.round(avgTrustScore));
        
      } catch (err) {
        console.error('Dashboard loading error:', err);
        setError(err instanceof Error ? err : new Error('Failed to load dashboard data'));
      } finally {
        setLoading(false);
      }
    };

    if (isAuthenticated) {
      loadDashboardData();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, userState?.id]);

  // Loading state
  if (loading) {
    return (
      <VehicleCentricLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-pulse text-lg">Loading your vehicles...</div>
        </div>
      </VehicleCentricLayout>
    );
  }

  // Error state
  if (error) {
    return (
      <VehicleCentricLayout>
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Error Loading Dashboard</AlertTitle>
          <AlertDescription className="mt-2">
            {error.message}
            <div className="mt-4">
              <Button onClick={() => window.location.reload()} variant="outline" className="mr-2">
                Retry
              </Button>
              <Button onClick={() => navigate('/explore')} variant="ghost">
                Go to Explore
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </VehicleCentricLayout>
    );
  }

  return (
    <VehicleCentricLayout>
      {/* Dashboard Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-neutral-900 dark:text-white">
          Welcome back, {userState?.email?.split('@')[0] || 'User'}
        </h1>
        <p className="mt-2 text-neutral-500 dark:text-neutral-400">
          Manage your vehicle digital identities and discover new opportunities.
        </p>
      </div>

      {/* Trust Score Overview */}
      <Card className="mb-8 bg-gradient-to-r from-primary-50 to-neutral-50 dark:from-primary-950/30 dark:to-neutral-950">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <CardTitle>Your Trust Profile</CardTitle>
              <CardDescription className="mt-1">
                Your overall verification score based on your vehicles
              </CardDescription>
            </div>
            <div className="flex items-center">
              <TrustIndicator score={trustScore} size="lg" />
              <div className="ml-4">
                <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">
                  Trust Level
                </p>
                <p className="text-lg font-bold text-neutral-900 dark:text-white">
                  {trustScore >= 90 ? 'Exceptional' :
                    trustScore >= 80 ? 'Verified' :
                    trustScore >= 70 ? 'Trusted' :
                    trustScore >= 50 ? 'Building' : 'New User'}
                </p>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 sm:gap-6">
            <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Your Vehicles</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-white">{vehicles.length}</p>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Verified Events</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-white">
                {vehicles.reduce((sum, v) => sum + (v.events?.filter(e => 
                  e.verificationLevel === 'BLOCKCHAIN' || 
                  e.verificationLevel === 'PTZ_VERIFIED' || 
                  e.verificationLevel === 'PROFESSIONAL'
                )?.length || 0), 0)}
              </p>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Blockchain Records</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-white">
                {vehicles.reduce((sum, v) => sum + (v.events?.filter(e => 
                  e.verificationLevel === 'BLOCKCHAIN'
                )?.length || 0), 0)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* User's Vehicles */}
      <div className="mb-12">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">Your Vehicles</h2>
          <Button onClick={() => navigate('/add-vehicle')}>
            Add Vehicle
          </Button>
        </div>
        <VehicleGrid 
          vehicles={vehicles}
          emptyStateMessage="You haven't added any vehicles yet"
          gridType="portfolio"
        />
      </div>

      {/* Discover Nearby */}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>Discover Nearby</CardTitle>
          <CardDescription>Find vehicles, garages, auctions and events in your area</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <GeoFencedDiscovery contentType="all" />
          </div>
        </CardContent>
      </Card>

      {/* Marketplace Preview */}
      <div className="mb-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Marketplace Highlights
          </h2>
          <Button 
            variant="outline" 
            onClick={() => navigate('/marketplace')}
          >
            View All
          </Button>
        </div>
        <VehicleMarketplaceGrid 
          vehicles={marketplaceVehicles}
        />
      </div>
      
      {/* Trust Mechanism Explanation */}
      <Card className="mb-8 border-2 border-primary-100 dark:border-primary-900/30">
        <CardHeader>
          <CardTitle className="text-primary-500">
            Understanding Trust Levels
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-status-blockchain/10 p-4">
              <div className={`mb-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-status-blockchain text-white`}>
                BLOCKCHAIN VERIFIED
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                The highest level of verification. Records stored on blockchain with cryptographic proof.
              </p>
            </div>
            <div className="rounded-lg bg-status-verified/10 p-4">
              <div className={`mb-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-status-verified text-white`}>
                PTZ VERIFIED
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                Physically verified at a Professional Trust Zone with documentation and inspection.
              </p>
            </div>
            <div className="rounded-lg bg-status-success/10 p-4">
              <div className={`mb-2 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium bg-status-success text-white`}>
                PROFESSIONAL
              </div>
              <p className="text-sm text-neutral-700 dark:text-neutral-300">
                Verified by recognized professionals in the industry with supporting documentation.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </VehicleCentricLayout>
  );
};

export default Dashboard;
