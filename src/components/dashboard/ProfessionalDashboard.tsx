import React from 'react';
import { SkillTree } from '../skills/SkillTree';
import { UserProfile } from '../profile/UserProfile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRound, Tree } from 'lucide-react';

export const ProfessionalDashboard = () => {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="profile" className="w-full">
        <TabsList>
          <TabsTrigger value="profile" className="flex items-center gap-2">
            <UserRound className="w-4 h-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="skills" className="flex items-center gap-2">
            <Tree className="w-4 h-4" />
            Skill Tree
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="profile">
          <UserProfile />
        </TabsContent>
        
        <TabsContent value="skills">
          <SkillTree />
        </TabsContent>
      </Tabs>
    </div>
  );
};