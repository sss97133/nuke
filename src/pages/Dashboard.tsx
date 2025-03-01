
import React, { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Users, Car, Wrench, TrendingUp } from "lucide-react";

const StatCard = ({ 
  title, 
  value, 
  description, 
  icon: Icon 
}: { 
  title: string; 
  value: string | number; 
  description: string; 
  icon: React.ElementType 
}) => {
  // Add console log to verify StatCard renders
  console.log(`Rendering StatCard: ${title}`);
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
};

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
    <div className="min-h-screen bg-background dashboard-container">
      <ScrollArea className="h-[calc(100vh-4rem)]">
        <div className="container max-w-7xl mx-auto p-6 space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Welcome to your vehicle management dashboard.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Vehicles"
              value="12"
              description="2 added this month"
              icon={Car}
            />
            <StatCard
              title="Active Services"
              value="4"
              description="1 pending completion"
              icon={Wrench}
            />
            <StatCard
              title="Team Members"
              value="8"
              description="3 online now"
              icon={Users}
            />
            <StatCard
              title="Market Value"
              value="$143,250"
              description="↑2.1% from last month"
              icon={TrendingUp}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="col-span-2">
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Your latest actions and updates</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {["Vehicle service completed", "New team member added", "Market value updated", "Certification earned"].map((activity, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <Activity className="h-4 w-4 text-primary" />
                      <span>{activity}</span>
                      <span className="ml-auto text-muted-foreground">{`${i + 1}d ago`}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common tasks and shortcuts</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {["Add new vehicle", "Schedule service", "View achievements", "Import data", "Team management"].map((action, i) => (
                    <button 
                      key={i} 
                      className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-primary/10 transition-colors"
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default Dashboard;
