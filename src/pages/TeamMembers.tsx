
import React from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamSection } from '@/components/profile/TeamSection';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Briefcase, Building2, Wrench, UserPlus } from 'lucide-react';
import { Button } from "@/components/ui/button";

const TeamMembers = () => {
  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl mx-auto py-6 px-4 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Team Members</h1>
            <p className="text-muted-foreground">Manage your network of professionals and collaborators</p>
          </div>
          <Button>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Team Member
          </Button>
        </div>
        
        <Tabs defaultValue="all">
          <TabsList className="mb-4">
            <TabsTrigger value="all">All Members</TabsTrigger>
            <TabsTrigger value="technicians">Technicians</TabsTrigger>
            <TabsTrigger value="garages">Garages</TabsTrigger>
            <TabsTrigger value="consultants">Consultants</TabsTrigger>
            <TabsTrigger value="other">Other</TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="space-y-4">
            <TeamSection />
          </TabsContent>
          
          <TabsContent value="technicians" className="space-y-4">
            <TechniciansList />
          </TabsContent>
          
          <TabsContent value="garages" className="space-y-4">
            <GaragesList />
          </TabsContent>
          
          <TabsContent value="consultants" className="space-y-4">
            <ConsultantsList />
          </TabsContent>
          
          <TabsContent value="other" className="space-y-4">
            <OtherMembersList />
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
};

// For now, these are placeholder components that we'll implement fully
const TechniciansList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Wrench className="h-5 w-5 text-primary" />
        <CardTitle>Technicians</CardTitle>
      </div>
      <CardDescription>Professionals who service your vehicles</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No technicians added yet. Add technicians to track service history and schedule maintenance.</p>
    </CardContent>
  </Card>
);

const GaragesList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-primary" />
        <CardTitle>Garages</CardTitle>
      </div>
      <CardDescription>Service centers and repair shops you work with</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No garages added yet. Connect with garages to streamline your vehicle maintenance.</p>
    </CardContent>
  </Card>
);

const ConsultantsList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Briefcase className="h-5 w-5 text-primary" />
        <CardTitle>Consultants</CardTitle>
      </div>
      <CardDescription>Advisors and specialists for vehicle projects</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No consultants added yet. Add specialized professionals to enhance your projects.</p>
    </CardContent>
  </Card>
);

const OtherMembersList = () => (
  <Card>
    <CardHeader>
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <CardTitle>Other Members</CardTitle>
      </div>
      <CardDescription>Additional team members and collaborators</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-muted-foreground">No other team members added yet.</p>
    </CardContent>
  </Card>
);

export default TeamMembers;
