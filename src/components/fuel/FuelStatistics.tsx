
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropletIcon, TrendingDown, TrendingUp, Minus, Loader2 } from "lucide-react";
import { useFuelData } from "@/hooks/fuel/useFuelData";

interface FuelStatisticsProps {
  vehicleId?: string;
}

export const FuelStatistics = ({ vehicleId }: FuelStatisticsProps) => {
  const { statistics, isLoading } = useFuelData(vehicleId);
  const [timeRange, setTimeRange] = useState("month");
  
  // Function to get trend icon based on trend value
  const getTrendIcon = (trend?: 'up' | 'down' | 'stable') => {
    if (trend === 'up') return <TrendingUp className="h-4 w-4 text-green-500" />;
    if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-500" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  // Apply multipliers for different time ranges
  // This is a simplification - in a real app you would filter data by date
  const getMultiplier = () => {
    switch (timeRange) {
      case 'month': return 1;
      case 'year': return 12;
      case 'all': return 24; // Just an example - real data would be cumulative
      default: return 1;
    }
  };

  // Get adjusted statistics based on time range
  const getAdjustedStats = () => {
    if (!statistics) return null;
    
    const multiplier = getMultiplier();
    
    return {
      totalSpent: statistics.totalSpent * multiplier,
      avgMPG: statistics.avgMileage || 0,
      totalGallons: statistics.totalGallons * multiplier,
      lastFillupDate: statistics.lastRefuelDate || '',
      avgPrice: statistics.avgPrice,
      lowestPrice: statistics.lowestPrice || 0,
      highestPrice: statistics.highestPrice || 0,
      mileageTrend: statistics.mileageTrend,
      fillups: Math.round(statistics.totalGallons / 12) * multiplier // Rough estimate of fillups
    };
  };

  // If loading, show a loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <DropletIcon className="mr-2 h-5 w-5 text-blue-500" />
            Fuel Statistics
          </CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center items-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // If no statistics available, show placeholder
  if (!statistics) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <DropletIcon className="mr-2 h-5 w-5 text-blue-500" />
            Fuel Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground p-6">
            No fuel data available. Add your first fuel entry to see statistics.
          </div>
        </CardContent>
      </Card>
    );
  }

  const stats = getAdjustedStats();
  if (!stats) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center">
          <DropletIcon className="mr-2 h-5 w-5 text-blue-500" />
          Fuel Statistics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="month" onValueChange={setTimeRange}>
          <TabsList className="mb-4">
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
            <TabsTrigger value="all">All Time</TabsTrigger>
          </TabsList>
          
          <TabsContent value="month" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatCard title="Total Spent" value={`$${stats.totalSpent.toFixed(2)}`} />
              <StatCard 
                title="Average MPG" 
                value={stats.avgMPG.toFixed(1)} 
                icon={getTrendIcon(stats.mileageTrend)} 
              />
              <StatCard title="Gallons Used" value={stats.totalGallons.toFixed(1)} />
              <StatCard title="Avg. Price/Gal" value={`$${stats.avgPrice.toFixed(2)}`} />
            </div>
          </TabsContent>
          
          <TabsContent value="year" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatCard title="Total Spent" value={`$${stats.totalSpent.toFixed(2)}`} />
              <StatCard title="Fillups" value={`${stats.fillups}`} />
              <StatCard title="Lowest Price" value={`$${stats.lowestPrice.toFixed(2)}`} />
              <StatCard title="Highest Price" value={`$${stats.highestPrice.toFixed(2)}`} />
            </div>
          </TabsContent>
          
          <TabsContent value="all" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <StatCard title="Total Spent" value={`$${stats.totalSpent.toFixed(2)}`} />
              <StatCard title="Gallons Used" value={stats.totalGallons.toFixed(1)} />
              <StatCard title="Fillups" value={`${stats.fillups}`} />
              <StatCard title="Avg. Price/Gal" value={`$${stats.avgPrice.toFixed(2)}`} />
            </div>
          </TabsContent>
        </Tabs>
        
        {stats.lastFillupDate && (
          <div className="mt-4 pt-4 border-t text-xs text-center text-muted-foreground">
            Last fillup: {new Date(stats.lastFillupDate).toLocaleDateString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

interface StatCardProps {
  title: string;
  value: string;
  icon?: React.ReactNode;
}

const StatCard = ({ title, value, icon }: StatCardProps) => (
  <div className="bg-muted p-4 rounded-lg text-center">
    <h3 className="text-sm text-muted-foreground mb-1">{title}</h3>
    <div className="flex items-center justify-center">
      <p className="text-2xl font-bold">{value}</p>
      {icon && <span className="ml-2">{icon}</span>}
    </div>
  </div>
);
