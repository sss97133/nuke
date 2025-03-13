
import React, { useState, useEffect } from 'react';
import { Car, Wrench, Users, TrendingUp } from "lucide-react";
import StatCard from './StatCard';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const StatsOverview = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [statsData, setStatsData] = useState({
    totalVehicles: '0',
    activeServices: '0',
    teamMembers: '0',
    marketValue: '$0'
  });
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        setIsLoading(true);
        setFetchError(false);
        
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) {
          toast({
            title: "Authentication error",
            description: "Please sign in to view your dashboard",
            variant: "destructive",
          });
          return;
        }
        
        // Use Promise.allSettled to handle potential failures in individual queries
        const [vehiclesResult, servicesResult, membersResult] = await Promise.allSettled([
          // Fetch total vehicles
          supabase
            .from('vehicles')
            .select('id, market_value')
            .eq('user_id', user.id)
            .eq('status', 'owned'),
            
          // Fetch active services  
          supabase
            .from('service_tickets')
            .select('id')
            .eq('user_id', user.id)
            .in('status', ['pending', 'in_progress']),
            
          // Fetch active team members with status filter
          supabase
            .from('team_members')
            .select('id')
            .eq('status', 'active')
        ]);
        
        // Extract data from results handling potential failures
        const vehicles = vehiclesResult.status === 'fulfilled' ? vehiclesResult.value.data : null;
        const services = servicesResult.status === 'fulfilled' ? servicesResult.value.data : null;
        const members = membersResult.status === 'fulfilled' ? membersResult.value.data : null;
        
        if (vehiclesResult.status === 'rejected' || servicesResult.status === 'rejected' || membersResult.status === 'rejected') {
          console.warn('Some dashboard queries failed to complete', { vehiclesResult, servicesResult, membersResult });
        }
        
        // Calculate total market value
        const totalMarketValue = vehicles
          ? vehicles.reduce((sum, vehicle) => sum + (vehicle.market_value || 0), 0)
          : 0;
        
        setStatsData({
          totalVehicles: vehicles ? vehicles.length.toString() : '0',
          activeServices: services ? services.length.toString() : '0',
          teamMembers: members ? members.length.toString() : '0',
          marketValue: `$${totalMarketValue.toLocaleString()}`
        });
      } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        setFetchError(true);
        toast({
          title: "Failed to load dashboard data",
          description: "We're experiencing some technical difficulties. Stats may be unavailable temporarily.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchDashboardStats();
  }, [toast]);

  const handleNavigate = (path: string) => {
    console.log(`Navigating to: ${path}`);
    navigate(path);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Vehicles"
        value={isLoading ? "Loading..." : statsData.totalVehicles}
        description={isLoading ? "" : parseInt(statsData.totalVehicles) > 0 ? "Click to view your vehicles" : "No vehicles added yet"}
        icon={Car}
        onClick={() => handleNavigate('/discovered-vehicles')}
        isError={fetchError}
      />
      <StatCard
        title="Active Services"
        value={isLoading ? "Loading..." : statsData.activeServices}
        description={isLoading ? "" : parseInt(statsData.activeServices) > 0 ? "Click to view pending services" : "No active services"}
        icon={Wrench}
        onClick={() => handleNavigate('/service')}
        isError={fetchError}
      />
      <StatCard
        title="Team Members"
        value={isLoading ? "Loading..." : statsData.teamMembers}
        description={isLoading ? "" : parseInt(statsData.teamMembers) > 0 ? "Click to manage your team" : "No team members yet"}
        icon={Users}
        onClick={() => handleNavigate('/team-members')}
        isError={fetchError}
      />
      <StatCard
        title="Market Value"
        value={isLoading ? "Loading..." : statsData.marketValue}
        description={isLoading ? "" : statsData.marketValue !== "$0" ? "Based on verified owned vehicles" : "No vehicle valuations yet"}
        icon={TrendingUp}
        onClick={() => handleNavigate('/market-analysis')}
        isError={fetchError}
      />
    </div>
  );
};

export default StatsOverview;
