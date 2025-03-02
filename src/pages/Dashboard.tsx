
import React, { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GeoFencedDiscovery } from '@/components/discovery/GeoFencedDiscovery';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import StatsOverview from '@/components/dashboard/StatsOverview';
import DashboardContent from '@/components/dashboard/DashboardContent';

const Dashboard = () => {
  // Enhanced console logs for debugging
  console.log("Dashboard component initial render");
  
  useEffect(() => {
    console.log("Dashboard component mounted");
    
    // Check for DOM elements to see if they're rendering
    const container = document.querySelector('.dashboard-container');
    console.log("Dashboard container found:", !!container);
    
    return () => {
      console.log("Dashboard component unmounted");
    };
  }, []);
  
  return (
    <div className="min-h-screen bg-background dashboard-container">
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="container max-w-7xl mx-auto p-6 space-y-6">
          <DashboardHeader />
          <StatsOverview />

          <Card>
            <CardHeader>
              <CardTitle>Discover Nearby</CardTitle>
              <CardDescription>Find vehicles, garages, auctions and events in your area</CardDescription>
            </CardHeader>
            <CardContent>
              <GeoFencedDiscovery />
            </CardContent>
          </Card>

          <DashboardContent />
        </div>
      </ScrollArea>
    </div>
  );
};

export default Dashboard;
