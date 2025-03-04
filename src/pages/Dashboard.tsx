
import React, { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import StatsOverview from '@/components/dashboard/StatsOverview';
import DashboardContent from '@/components/dashboard/DashboardContent';
import DashboardLayout from '@/components/dashboard/layout/DashboardLayout';

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
            {/* GeoFencedDiscovery will be rendered here */}
          </div>
        </CardContent>
      </Card>

      <DashboardContent />
    </DashboardLayout>
  );
};

export default Dashboard;
