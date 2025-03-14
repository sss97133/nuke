
import type { Database } from '../types';
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import StatsOverview from '@/components/dashboard/StatsOverview';
import DashboardContent from '@/components/dashboard/DashboardContent';
import DashboardLayout from '@/components/dashboard/layout/DashboardLayout';
import { GeoFencedDiscovery } from '@/components/discovery/GeoFencedDiscovery';
import { useAuthState } from '@/hooks/auth/use-auth-state';
import { supabase } from '@/integrations/supabase/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

const Dashboard = () => {
  const [error, setError] = useState<Error | null>(null);
  const { session, loading } = useAuthState();
  const navigate = useNavigate();

  useEffect(() => {
    const checkConnection = async () => {
      try {
        console.info('Checking Supabase connection...');
        const { error } = await supabase.from('vehicles').select('count').single();
        if (error) throw error;
        console.info('Supabase connection successful');
      } catch (err) {
        console.error('Supabase connection error:', err);
        setError(err instanceof Error ? err : new Error('Failed to connect to database'));
      }
    };

    if (session && !loading) {
      checkConnection();
    }
  }, [session, loading]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-screen">
          <div className="animate-pulse text-lg">Loading dashboard...</div>
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
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
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <DashboardHeader />
      <StatsOverview />

      <Card>
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

      <DashboardContent />
    </DashboardLayout>
  );
};

export default Dashboard;
