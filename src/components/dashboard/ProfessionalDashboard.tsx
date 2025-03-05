
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import UserProfile from '@/components/profile/UserProfile';

export const ProfessionalDashboard = () => {
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
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Total Clients</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">42</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">12</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Completed This Month</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">23</div>
                  </CardContent>
                </Card>
              </div>
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
