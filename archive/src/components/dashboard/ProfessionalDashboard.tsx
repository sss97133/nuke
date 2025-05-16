
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UserProfile from '@/components/profile/UserProfile';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

export const ProfessionalDashboard = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [clientCount, setClientCount] = useState<number | null>(null);
  const [activeJobsCount, setActiveJobsCount] = useState<number | null>(null);
  const [completedMonthlyCount, setCompletedMonthlyCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Check if Supabase client is available
        if (!supabase) {
          setError('Database connection not available');
          return;
        }
        
        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setError('User not authenticated');
          return;
        }

        // Get client count (vehicles associated with this professional)
        const { count: clientCount, error: clientError } = await supabase
          .from('vehicles')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id);

        if (clientError) throw new Error(clientError.message);
        setClientCount(clientCount);

        // Get active jobs count
        const { count: activeCount, error: activeError } = await supabase
          .from('service_tickets')
          .select('id', { count: 'exact', head: true })
          .eq('professional_id', user.id)
          .eq('status', 'in_progress');

        if (activeError) throw new Error(activeError.message);
        setActiveJobsCount(activeCount);

        // Get completed jobs this month
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

        const { count: completedCount, error: completedError } = await supabase
          .from('service_tickets')
          .select('id', { count: 'exact', head: true })
          .eq('professional_id', user.id)
          .eq('status', 'completed')
          .gte('completed_at', firstDayOfMonth)
          .lte('completed_at', lastDayOfMonth);

        if (completedError) throw new Error(completedError.message);
        setCompletedMonthlyCount(completedCount);

      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        toast({
          title: 'Error loading dashboard',
          description: err instanceof Error ? err.message : 'Failed to load dashboard data',
          variant: 'destructive'
        });
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [toast]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Professional Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview">
            <TabsList className="mb-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="clients">Clients</TabsTrigger>
              <TabsTrigger value="appointments">Appointments</TabsTrigger>
              <TabsTrigger value="services">Services</TabsTrigger>
              <TabsTrigger value="analytics">Analytics</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview">
              {error ? (
                <div className="p-4 text-red-500">{error}</div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loading ? (
                        <div className="flex items-center space-x-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Loading...</span>
                        </div>
                      ) : (
                        <div className="text-2xl font-bold">{clientCount || 0}</div>
                      )}
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loading ? (
                        <div className="flex items-center space-x-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Loading...</span>
                        </div>
                      ) : (
                        <div className="text-2xl font-bold">{activeJobsCount || 0}</div>
                      )}
                    </CardContent>
                  </Card>
                  
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium">Completed This Month</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {loading ? (
                        <div className="flex items-center space-x-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Loading...</span>
                        </div>
                      ) : (
                        <div className="text-2xl font-bold">{completedMonthlyCount || 0}</div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="clients">
              <p>Client management content will be displayed here.</p>
            </TabsContent>
            
            <TabsContent value="appointments">
              <p>Appointments calendar and scheduling will be displayed here.</p>
            </TabsContent>
            
            <TabsContent value="services">
              <p>Service offerings and pricing will be displayed here.</p>
            </TabsContent>
            
            <TabsContent value="analytics">
              <p>Business performance metrics will be displayed here.</p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProfessionalDashboard;
