
import React from 'react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  CartesianGrid 
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, TrendingUp, TrendingDown, Users, Clock } from 'lucide-react';

interface ActivityDataPoint {
  date: string;
  viewers: number;
  owners: number;
  technicians: number;
  investors: number;
}

interface UserActivityAnalyticsProps {
  userId: string;
  activityData: ActivityDataPoint[];
  isLoading?: boolean;
}

export const UserActivityAnalytics = ({ 
  userId, 
  activityData, 
  isLoading = false 
}: UserActivityAnalyticsProps) => {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Activity Analytics</CardTitle>
          <CardDescription>Loading your activity data...</CardDescription>
        </CardHeader>
        <CardContent className="h-80 flex items-center justify-center">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </CardContent>
      </Card>
    );
  }

  // Calculate growth metrics
  const calculateGrowth = (dataKey: keyof ActivityDataPoint) => {
    if (activityData.length < 2) return { value: 0, isPositive: true };
    
    const oldest = activityData[0][dataKey] as number;
    const newest = activityData[activityData.length - 1][dataKey] as number;
    
    if (oldest === 0) return { value: 100, isPositive: true };
    
    const growth = ((newest - oldest) / oldest) * 100;
    return {
      value: Math.abs(growth).toFixed(1),
      isPositive: growth >= 0
    };
  };

  const viewersGrowth = calculateGrowth('viewers');
  const ownersGrowth = calculateGrowth('owners');
  const techniciansGrowth = calculateGrowth('technicians');
  const investorsGrowth = calculateGrowth('investors');

  // Calculate activity level
  const calculateActivityLevel = () => {
    if (activityData.length === 0) return "Low";
    
    const latest = activityData[activityData.length - 1];
    const totalActivity = latest.viewers + latest.owners + latest.technicians + latest.investors;
    
    if (totalActivity > 100) return "Very High";
    if (totalActivity > 50) return "High";
    if (totalActivity > 20) return "Medium";
    return "Low";
  };

  const activityLevel = calculateActivityLevel();

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border p-3 rounded-md shadow-md">
          <p className="text-sm font-medium">{label}</p>
          <div className="space-y-1 mt-2">
            {payload.map((item: any, index: number) => (
              <div key={index} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                <span className="text-xs">{item.name}: {item.value}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Activity Analytics</CardTitle>
            <CardDescription>Your progression across different areas</CardDescription>
          </div>
          <div className="flex items-center gap-2 bg-muted px-3 py-1 rounded-full">
            <Activity className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{activityLevel} Activity</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-background/50 p-3 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Viewer</span>
              {viewersGrowth.isPositive ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-bold">{viewersGrowth.value}%</span>
              <span className="text-xs text-muted-foreground mb-1">growth</span>
            </div>
          </div>
          
          <div className="bg-background/50 p-3 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Owner</span>
              {ownersGrowth.isPositive ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-bold">{ownersGrowth.value}%</span>
              <span className="text-xs text-muted-foreground mb-1">growth</span>
            </div>
          </div>
          
          <div className="bg-background/50 p-3 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Technician</span>
              {techniciansGrowth.isPositive ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-bold">{techniciansGrowth.value}%</span>
              <span className="text-xs text-muted-foreground mb-1">growth</span>
            </div>
          </div>
          
          <div className="bg-background/50 p-3 rounded-lg border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Investor</span>
              {investorsGrowth.isPositive ? (
                <TrendingUp className="h-4 w-4 text-green-500" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-500" />
              )}
            </div>
            <div className="flex items-end gap-2 mt-1">
              <span className="text-2xl font-bold">{investorsGrowth.value}%</span>
              <span className="text-xs text-muted-foreground mb-1">growth</span>
            </div>
          </div>
        </div>
        
        <Tabs defaultValue="progression">
          <TabsList className="grid grid-cols-2 mb-4">
            <TabsTrigger value="progression" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Progression
            </TabsTrigger>
            <TabsTrigger value="comparison" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Platform Comparison
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="progression" className="mt-0">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={activityData}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickMargin={10}
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    tickMargin={10}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="viewers" 
                    name="Viewer" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ stroke: '#3b82f6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="owners" 
                    name="Owner" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    dot={{ stroke: '#10b981', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="technicians" 
                    name="Technician" 
                    stroke="#f59e0b" 
                    strokeWidth={2}
                    dot={{ stroke: '#f59e0b', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="investors" 
                    name="Investor" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    dot={{ stroke: '#8b5cf6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
          
          <TabsContent value="comparison" className="mt-0">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={activityData}
                  margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis 
                    dataKey="date" 
                    tick={{ fontSize: 12 }}
                    tickMargin={10}
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    tickMargin={10}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="viewers" 
                    name="Your Viewer Score" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ stroke: '#3b82f6', strokeWidth: 2, r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="owners" 
                    name="Platform Average" 
                    stroke="#d1d5db" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};
