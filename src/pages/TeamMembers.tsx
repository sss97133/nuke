
import React, { useState } from 'react';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamSection } from '@/components/profile/TeamSection';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, UserPlus } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { TechniciansList } from '@/components/team/TechniciansList';
import { ServiceBusinessesList } from '@/components/team/ServiceBusinessesList';
import { ConsultantsList } from '@/components/team/ConsultantsList';
import { BusinessPartnersList } from '@/components/team/BusinessPartnersList';
import { MediaList } from '@/components/team/MediaList';
import { OtherMembersList } from '@/components/team/OtherMembersList';
import { RoleReferenceTable } from '@/components/team/RoleReferenceTable';
import { AddTeamMemberForm } from '@/components/team/AddTeamMemberForm';
import { useQueryClient } from '@tanstack/react-query';

const TeamMembers = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const handleAddTeamMember = () => {
    setIsAddMemberDialogOpen(true);
  };

  const handleFormSuccess = () => {
    // Refresh the team members data
    queryClient.invalidateQueries(['team-members']);
    setIsAddMemberDialogOpen(false);
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container max-w-7xl mx-auto py-6 px-4 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">Team Members</h1>
            <p className="text-muted-foreground">Manage your network of professionals and collaborators</p>
          </div>
          <Button onClick={handleAddTeamMember}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Team Member
          </Button>
        </div>
        
        <Tabs defaultValue="all" onValueChange={setSelectedCategory}>
          <TabsList className="mb-4 flex flex-wrap h-auto">
            <TabsTrigger value="all">All Members</TabsTrigger>
            <TabsTrigger value="technicians">Technicians</TabsTrigger>
            <TabsTrigger value="garages">Service Businesses</TabsTrigger>
            <TabsTrigger value="consultants">Consultants</TabsTrigger>
            <TabsTrigger value="partners">Business Partners</TabsTrigger>
            <TabsTrigger value="media">Media & Documentation</TabsTrigger>
            <TabsTrigger value="other">Other</TabsTrigger>
          </TabsList>
          
          <TabsContent value="all" className="space-y-4">
            <TeamSection />
          </TabsContent>
          
          <TabsContent value="technicians" className="space-y-4">
            <TechniciansList />
          </TabsContent>
          
          <TabsContent value="garages" className="space-y-4">
            <ServiceBusinessesList />
          </TabsContent>
          
          <TabsContent value="consultants" className="space-y-4">
            <ConsultantsList />
          </TabsContent>
          
          <TabsContent value="partners" className="space-y-4">
            <BusinessPartnersList />
          </TabsContent>
          
          <TabsContent value="media" className="space-y-4">
            <MediaList />
          </TabsContent>
          
          <TabsContent value="other" className="space-y-4">
            <OtherMembersList />
          </TabsContent>
        </Tabs>

        {selectedCategory !== 'all' && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Category Reference Guide</CardTitle>
              <CardDescription>
                Standard roles that fall under the {selectedCategory} category
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RoleReferenceTable category={selectedCategory} />
            </CardContent>
          </Card>
        )}
        
        {/* Add Team Member Dialog */}
        <AddTeamMemberForm 
          open={isAddMemberDialogOpen} 
          onOpenChange={setIsAddMemberDialogOpen}
          onSuccess={handleFormSuccess} 
        />
      </div>
    </ScrollArea>
  );
};

export default TeamMembers;
