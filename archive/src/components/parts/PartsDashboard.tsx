
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Database, Box, Tag, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';

const PartsDashboard = () => {
  const [stats, setStats] = useState({
    totalParts: 0,
    lowStock: 0,
    categories: 0,
    totalValue: 0
  });
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        // In a real implementation, this would fetch from your parts database
        // For demo purposes, we're using mock data
        
        // Simulate API call delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock data
        setStats({
          totalParts: 247,
          lowStock: 18,
          categories: 12,
          totalValue: 15820
        });
      } catch (error) {
        console.error('Error fetching parts stats:', error);
        toast({
          title: "Error",
          description: "Could not load parts dashboard data",
          variant: "destructive"
        });
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [toast]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Parts Dashboard</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total Parts" 
          value={stats.totalParts}
          icon={<Database className="h-6 w-6" />}
          loading={loading}
        />
        <StatCard 
          title="Low Stock Items" 
          value={stats.lowStock}
          icon={<Box className="h-6 w-6" />}
          loading={loading}
          alert={true}
        />
        <StatCard 
          title="Categories" 
          value={stats.categories}
          icon={<Tag className="h-6 w-6" />}
          loading={loading}
        />
        <StatCard 
          title="Inventory Value" 
          value={`$${stats.totalValue.toLocaleString()}`}
          icon={<DollarSign className="h-6 w-6" />}
          loading={loading}
        />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (
              <ul className="space-y-2">
                <li className="py-2 border-b">Added 4 new brake pads to inventory</li>
                <li className="py-2 border-b">Updated oil filter pricing</li>
                <li className="py-2 border-b">Marked 2 air filters as low stock</li>
                <li className="py-2">Created new category: "Electrical Components"</li>
              </ul>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Parts Due for Replacement</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
              </div>
            ) : (
              <ul className="space-y-2">
                <li className="py-2 border-b">Engine air filter (Toyota Camry) - Due in 2 weeks</li>
                <li className="py-2 border-b">Brake fluid (Honda Civic) - Due now</li>
                <li className="py-2 border-b">Spark plugs (Ford F-150) - Due in 1 month</li>
                <li className="py-2">Transmission fluid (Chevrolet Malibu) - Due in 3 weeks</li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, loading, alert = false }) => {
  return (
    <Card className={alert ? "border-red-500" : ""}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="h-8 w-20 mt-1" />
            ) : (
              <h3 className={`text-2xl font-bold mt-1 ${alert ? "text-red-500" : ""}`}>{value}</h3>
            )}
          </div>
          <div className={`p-2 rounded-full ${alert ? "bg-red-100" : "bg-muted"}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default PartsDashboard;
