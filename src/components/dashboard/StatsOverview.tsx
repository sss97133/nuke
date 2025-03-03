
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

  useEffect(() => {
    const fetchDashboardStats = async () => {
      try {
        setIsLoading(true);
        
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
        
        // Fetch total vehicles
        const { data: vehicles, error: vehiclesError } = await supabase
          .from('vehicles')
          .select('id, market_value')
          .eq('user_id', user.id)
          .eq('status', 'owned');
          
        if (vehiclesError) throw vehiclesError;
        
        // Fetch active services
        const { data: services, error: servicesError } = await supabase
          .from('service_tickets')
          .select('id')
          .eq('user_id', user.id)
          .in('status', ['pending', 'in_progress']);
          
        if (servicesError) throw servicesError;
        
        // Fetch team members
        const { data: members, error: membersError } = await supabase
          .from('team_members')
          .select('id')
          .eq('status', 'active');
          
        if (membersError) throw membersError;
        
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
        toast({
          title: "Failed to load dashboard data",
          description: "Please try again later",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchDashboardStats();
  }, [toast]);

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total Vehicles"
        value={isLoading ? "Loading..." : statsData.totalVehicles}
        description={isLoading ? "" : parseInt(statsData.totalVehicles) > 0 ? "Click to view your vehicles" : "No vehicles added yet"}
        icon={Car}
        onClick={() => handleNavigate('/vehicles')}
      />
      <StatCard
        title="Active Services"
        value={isLoading ? "Loading..." : statsData.activeServices}
        description={isLoading ? "" : parseInt(statsData.activeServices) > 0 ? "Click to view pending services" : "No active services"}
        icon={Wrench}
        onClick={() => handleNavigate('/service')}
      />
      <StatCard
        title="Team Members"
        value={isLoading ? "Loading..." : statsData.teamMembers}
        description={isLoading ? "" : parseInt(statsData.teamMembers) > 0 ? "Click to manage your team" : "No team members yet"}
        icon={Users}
        onClick={() => handleNavigate('/profile/team')}
      />
      <StatCard
        title="Market Value"
        value={isLoading ? "Loading..." : statsData.marketValue}
        description={isLoading ? "" : statsData.marketValue !== "$0" ? "Based on verified owned vehicles" : "No vehicle valuations yet"}
        icon={TrendingUp}
        onClick={() => handleNavigate('/market-analysis')}
      />
    </div>
  );
};

export default StatsOverview;
