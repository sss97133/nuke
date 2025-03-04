
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useNavigate } from 'react-router-dom';

const Dashboard = () => {
  const navigate = useNavigate();
  
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container px-4 md:px-6 py-4 md:py-6 space-y-6 max-w-screen-xl mx-auto">
        <div className="space-y-2">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm md:text-base text-muted-foreground">
            Welcome to your vehicle management dashboard
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="p-6 border rounded-lg shadow-sm bg-card">
            <h3 className="text-xl font-semibold mb-2">Vehicles</h3>
            <p className="text-muted-foreground mb-4">Manage your discovered vehicles</p>
            <Button onClick={() => navigate('/dashboard/discovered-vehicles')}>
              Go to Vehicles
            </Button>
          </div>
          
          <div className="p-6 border rounded-lg shadow-sm bg-card">
            <h3 className="text-xl font-semibold mb-2">Profile</h3>
            <p className="text-muted-foreground mb-4">Manage your account information</p>
            <Button onClick={() => navigate('/profile')}>
              View Profile
            </Button>
          </div>
          
          <div className="p-6 border rounded-lg shadow-sm bg-card">
            <h3 className="text-xl font-semibold mb-2">Analytics</h3>
            <p className="text-muted-foreground mb-4">View insights about your vehicles</p>
            <Button onClick={() => navigate('/analytics')}>
              View Analytics
            </Button>
          </div>
        </div>
      </div>
    </ScrollArea>
  );
};

export default Dashboard;
