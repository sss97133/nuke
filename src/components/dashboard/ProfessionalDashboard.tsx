
import React from 'react';
import { SkillTree } from '../skills/SkillTree';
import { UserProfile } from '../profile/UserProfile';
import { CertificationsList } from '../certifications/CertificationsList';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, BadgeCheck } from 'lucide-react';
import { QuantumIcon } from './quantum/QuantumIcon';

export const ProfessionalDashboard = () => {
  return (
    <div className="space-y-6 animate-fade-in">
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="w-full bg-sidebar-accent border border-sidebar-border">
          <TabsTrigger 
            value="profile" 
            className="flex items-center gap-2 data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground"
          >
            <UserRound className="w-4 h-4" />
            Professional Profile
          </TabsTrigger>
          <TabsTrigger 
            value="skills" 
            className="flex items-center gap-2 data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground"
          >
            <QuantumIcon className="w-4 h-4" />
            Development Tree
          </TabsTrigger>
          <TabsTrigger 
            value="certifications" 
            className="flex items-center gap-2 data-[state=active]:bg-sidebar-primary data-[state=active]:text-sidebar-primary-foreground"
          >
            <BadgeCheck className="w-4 h-4" />
            Certifications
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="profile" className="mt-6">
          <UserProfile />
        </TabsContent>
        
        <TabsContent value="skills" className="mt-6">
          <SkillTree />
        </TabsContent>

        <TabsContent value="certifications" className="mt-6">
          <CertificationsList />
        </TabsContent>
      </Tabs>
    </div>
  );
};
