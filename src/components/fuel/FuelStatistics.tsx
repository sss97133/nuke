
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropletIcon } from "lucide-react";

interface FuelStatisticsProps {
  refreshTrigger: number;
}

export const FuelStatistics = ({ refreshTrigger }: FuelStatisticsProps) => {
  const [stats, setStats] = useState({
    totalSpent: 0,
    avgMPG: 0,
    lastFillupCost: 0,
    avgCostPerMile: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        // This would normally calculate based on data from Supabase
        // For now, let's use mock data
        setStats({
          totalSpent: 235.84,
          avgMPG: 28.5,
          lastFillupCost: 43.63,
          avgCostPerMile: 0.15
        });
      } catch (error) {
        console.error("Error fetching fuel statistics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [refreshTrigger]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <DropletIcon className="mr-2 h-5 w-5 text-blue-500" />
          Fuel Statistics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="month">
          <TabsList className="mb-4">
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
            <TabsTrigger value="all">All Time</TabsTrigger>
          </TabsList>
          
          <TabsContent value="month" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatCard title="Total Spent" value={`$${stats.totalSpent.toFixed(2)}`} />
              <StatCard title="Average MPG" value={stats.avgMPG.toFixed(1)} />
              <StatCard title="Last Fillup" value={`$${stats.lastFillupCost.toFixed(2)}`} />
              <StatCard title="Cost Per Mile" value={`$${stats.avgCostPerMile.toFixed(2)}`} />
            </div>
          </TabsContent>
          
          <TabsContent value="year" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatCard title="Total Spent" value="$1,248.92" />
              <StatCard title="Average MPG" value="27.8" />
              <StatCard title="Fillups" value="32" />
              <StatCard title="Cost Per Mile" value="$0.16" />
            </div>
          </TabsContent>
          
          <TabsContent value="all" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatCard title="Total Spent" value="$3,587.45" />
              <StatCard title="Average MPG" value="28.1" />
              <StatCard title="Fillups" value="87" />
              <StatCard title="Cost Per Mile" value="$0.17" />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

const StatCard = ({ title, value }: { title: string; value: string }) => (
  <div className="bg-muted p-4 rounded-lg text-center">
    <h3 className="text-sm text-muted-foreground mb-1">{title}</h3>
    <p className="text-2xl font-bold">{value}</p>
  </div>
);
