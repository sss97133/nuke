import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { GeoFencedDiscovery } from '@/components/discovery/GeoFencedDiscovery';
import { VehicleCentricLayout } from '@/components/layout/vehicle-centric-layout';
import { TrustIndicator } from '@/components/ui/trust-indicator';
import { Vehicle, VehicleGrid, VehicleMarketplaceGrid } from '@/components/vehicle/vehicle-grid';
import { trackInteraction } from '@/utils/adaptive-ui';
import { supabase } from '@/lib/supabase-client';
import { useAuth } from '@/providers/AuthProvider';
import { useUserStore } from '@/stores/userStore';
import { useVehicle } from '@/providers/VehicleProvider';
import VehicleImport from '@/components/vehicle/VehicleImport';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Dashboard Page
 * 
 * Modern vehicle-centric dashboard that showcases the user's vehicles,
 * nearby discoveries, and marketplace items with an emphasis on trust
 * mechanisms and verification levels.
 */
const Dashboard = () => {
  const [error, setError] = useState<Error | null>(null);
  const [localLoading, setLocalLoading] = useState(true);
  const [marketplaceVehicles, setMarketplaceVehicles] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState('vehicles');
  const { isAuthenticated } = useAuth();
  const userState = useUserStore(state => state.user);
  const navigate = useNavigate();
  
  // Use our VehicleProvider for real vehicle data
  const {
    vehicles,
    loading,
    hasVehicles,
    trustScore,
    verificationLevel,
    addVehicle,
    user,
    ensureVehicleExists
  } = useVehicle();
  
  // Check connection and load marketplace data
  useEffect(() => {
    const loadDashboardData = async () => {
      try {
        setLocalLoading(true);
        
        // Check database connection
        console.info('Checking Supabase connection...');
        const { error: connectionError } = await supabase.from('vehicles').select('count').single();
        if (connectionError) throw connectionError;
        console.info('Supabase connection successful');
        
        // Track this dashboard view for adaptive UI
        if (user?.id) {
          trackInteraction({
            type: 'PAGE_VIEW',
            itemId: 'dashboard',
            timestamp: new Date().toISOString(),
            metadata: {
              userId: user.id || '',
            },
          });
        }
        
        // Ensure user has at least one vehicle
        if (user && !hasVehicles && !loading) {
          console.info('Ensuring user has at least one vehicle...');
          await ensureVehicleExists();
        }
        
        // Load marketplace vehicles - this could come from a real endpoint in production
        const { data: marketData, error: marketError } = await supabase
          .from('vehicles')
          .select('*')
          .neq('user_id', user?.id || '') // Exclude user's own vehicles
          .order('created_at', { ascending: false })
          .limit(5);
          
        if (marketError) throw marketError;
        setMarketplaceVehicles(marketData || []);
        
        setError(null);
      } catch (err: any) {
        console.error('Error loading dashboard data:', err);
        setError(err);
      } finally {
        setLocalLoading(false);
      }
    };
    
    // Only load dashboard data when we have user information
    if (!loading) {
      loadDashboardData();
    }
  }, [user?.id, loading, hasVehicles]);

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
  if (error && !isAuthenticated) {
    return (
      <VehicleCentricLayout>
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Authentication Error</AlertTitle>
          <AlertDescription>
            {error.message || 'You need to be logged in to view this page.'}
          </AlertDescription>
        </Alert>
        <Button onClick={() => navigate('/auth')}>Sign In</Button>
      </VehicleCentricLayout>
    );
  }

  return (
    <VehicleCentricLayout>
      {/* Error display if needed */}
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error.message || 'An error occurred. Please try again later.'}
          </AlertDescription>
        </Alert>
      )}
      
      {/* Trust Score Card */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Trust Dashboard</CardTitle>
          <CardDescription>Your vehicle trust metrics and verification status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6">
            <p className="mb-2 text-sm text-neutral-500 dark:text-neutral-400">Overall Trust Score</p>
            <div className="flex items-center">
              <TrustIndicator score={Number(trustScore) || 0} size="lg" />
              <p className="ml-4 text-3xl font-bold text-neutral-900 dark:text-white">{Number(trustScore) || 0}</p>
            </div>
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Verified Vehicles</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-white">
                {!loading && hasVehicles ? vehicles.filter(v => 
                  v.verification_level === 'PTZ_VERIFIED' || 
                  v.verification_level === 'BLOCKCHAIN'
                ).length : 0}
              </p>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Total Vehicles</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-white">
                {!loading && hasVehicles ? vehicles.length : 0}
              </p>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm dark:bg-neutral-800">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Verification Level</p>
              <p className="text-2xl font-bold text-neutral-900 dark:text-white">
                {verificationLevel || 'SELF_REPORTED'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Tabs: Vehicles and Import */}
      <div className="mb-12">
        <Tabs defaultValue="vehicles" onValueChange={setActiveTab}>
          <div className="mb-4 flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="vehicles">Your Vehicles</TabsTrigger>
              <TabsTrigger value="import">Import Vehicle</TabsTrigger>
            </TabsList>
            
            {activeTab === 'vehicles' && (
              <Button onClick={() => setActiveTab('import')}>
                Add Vehicle
              </Button>
            )}
          </div>
          
          <TabsContent value="vehicles" className="mt-0">
            {loading ? (
              <div className="flex justify-center items-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500"></div>
              </div>
            ) : hasVehicles ? (
              <VehicleGrid 
                vehicles={vehicles.map(v => ({
                  id: v.id || '',
                  make: v.make || 'Unknown',
                  model: v.model || 'Unknown',
                  year: v.year || 0,
                  trustScore: v.trust_score || 0,
                  verificationLevel: v.verification_level || 'SELF_REPORTED',
                  imageUrl: '/images/placeholder-car.jpg',
                  ownershipType: 'FULL'
                }))}
                emptyStateMessage="You haven't added any vehicles yet"
                gridType="portfolio"
              />
            ) : (
              <Card className="p-8 text-center">
                <p className="text-neutral-500">You haven't added any vehicles yet</p>
                <Button onClick={() => setActiveTab('import')} className="mt-4">
                  Add Your First Vehicle
                </Button>
              </Card>
            )}
          </TabsContent>
          
          <TabsContent value="import" className="mt-0">
            <VehicleImport 
              onComplete={(vehicleId) => {
                setActiveTab('vehicles');
                toast({
                  title: 'Vehicle Added',
                  description: 'Your vehicle has been added successfully!',
                });
              }}
            />
          </TabsContent>
        </Tabs>
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
          vehicles={marketplaceVehicles.map(v => ({
            id: v.id || '',
            make: v.make || 'Unknown',
            model: v.model || 'Unknown',
            year: v.year || 0,
            trustScore: v.trust_score || 0,
            verificationLevel: v.verification_level || 'SELF_REPORTED',
            imageUrl: '/images/placeholder-car.jpg',
            ownershipType: 'FULL'
          }))}
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
