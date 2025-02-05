import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { 
  Car, Package, Wrench, Users, Activity, 
  Calendar, Video, Award, TrendingUp 
} from "lucide-react";

export const Home = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Fetch data for stats
  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('vehicles').select('*');
      if (error) throw error;
      return data;
    }
  });

  const { data: inventory } = useQuery({
    queryKey: ['inventory'],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory').select('*');
      if (error) throw error;
      return data;
    }
  });

  const { data: serviceTickets } = useQuery({
    queryKey: ['service_tickets'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_tickets').select('*');
      if (error) throw error;
      return data;
    }
  });

  // Fetch feed data
  const { data: feedItems } = useQuery({
    queryKey: ['feed'],
    queryFn: async () => {
      // Fetch multiple data sources for feed
      const [vehicles, inventory, services, auctions] = await Promise.all([
        supabase.from('vehicles').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('inventory').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('service_tickets').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('auctions').select('*').order('created_at', { ascending: false }).limit(5)
      ]);

      // Combine and sort by date
      const allItems = [
        ...(vehicles.data || []).map(v => ({ type: 'vehicle', data: v, date: v.created_at })),
        ...(inventory.data || []).map(i => ({ type: 'inventory', data: i, date: i.created_at })),
        ...(services.data || []).map(s => ({ type: 'service', data: s, date: s.created_at })),
        ...(auctions.data || []).map(a => ({ type: 'auction', data: a, date: a.created_at }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      return allItems;
    }
  });

  const handleCardClick = (section: string) => {
    navigate(`/${section}`);
    toast({
      title: `Viewing ${section}`,
      description: `Navigating to ${section} details`,
    });
  };

  return (
    <div className="space-y-6 p-6 pb-16">
      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card 
          className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => handleCardClick('vehicles')}
        >
          <div className="flex items-center gap-2">
            <Car className="h-4 w-4" />
            <h3 className="text-sm font-medium">Total Vehicles</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">{vehicles?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Click to view details</p>
        </Card>

        <Card 
          className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => handleCardClick('inventory')}
        >
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            <h3 className="text-sm font-medium">Inventory Items</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">{inventory?.length || 0}</p>
          <p className="text-xs text-muted-foreground">Click to view details</p>
        </Card>

        <Card 
          className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => handleCardClick('services')}
        >
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4" />
            <h3 className="text-sm font-medium">Active Services</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">
            {serviceTickets?.filter(t => t.status === 'active').length || 0}
          </p>
          <p className="text-xs text-muted-foreground">Click to view details</p>
        </Card>

        <Card 
          className="p-4 cursor-pointer hover:bg-accent/50 transition-colors"
          onClick={() => handleCardClick('team')}
        >
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            <h3 className="text-sm font-medium">Team Members</h3>
          </div>
          <p className="mt-2 text-2xl font-bold">12</p>
          <p className="text-xs text-muted-foreground">Click to view details</p>
        </Card>
      </div>

      {/* Activity Feed */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
          <Button variant="outline" size="sm" onClick={() => handleCardClick('activity')}>
            View All
          </Button>
        </div>
        <div className="space-y-4">
          {feedItems?.slice(0, 5).map((item, index) => (
            <div key={index} className="flex items-center gap-4 p-2 hover:bg-accent/50 rounded-sm cursor-pointer">
              {item.type === 'vehicle' && <Car className="h-4 w-4" />}
              {item.type === 'inventory' && <Package className="h-4 w-4" />}
              {item.type === 'service' && <Wrench className="h-4 w-4" />}
              {item.type === 'auction' && <TrendingUp className="h-4 w-4" />}
              <div>
                <p className="text-sm">
                  {item.type === 'vehicle' && `New vehicle added: ${item.data.make} ${item.data.model}`}
                  {item.type === 'inventory' && `Inventory updated: ${item.data.name}`}
                  {item.type === 'service' && `Service ticket: ${item.data.description}`}
                  {item.type === 'auction' && `New auction: ${item.data.title}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.date).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};