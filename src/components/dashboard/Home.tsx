
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Car, Package, Wrench, Users } from "lucide-react";
import { StatsCard } from "./quick-stats/StatsCard";
import { ActivityFeedItem } from "./activity/ActivityFeedItem";
import { useDashboardData } from "./hooks/useDashboardData";

export const Home = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { vehicles, assets, serviceTickets, feedItems } = useDashboardData();

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
        <StatsCard
          icon={Car}
          title="Total Vehicles"
          value={vehicles?.length || 0}
          onClick={() => handleCardClick('vehicles')}
        />
        <StatsCard
          icon={Package}
          title="Asset Items"
          value={assets?.length || 0}
          onClick={() => handleCardClick('assets')}
        />
        <StatsCard
          icon={Wrench}
          title="Active Services"
          value={serviceTickets?.filter(t => t.status === 'active').length || 0}
          onClick={() => handleCardClick('services')}
        />
        <StatsCard
          icon={Users}
          title="Team Members"
          value={12}
          onClick={() => handleCardClick('team')}
        />
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
            <ActivityFeedItem key={index} item={item} />
          ))}
        </div>
      </Card>
    </div>
  );
};
