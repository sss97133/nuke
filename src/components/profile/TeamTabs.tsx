
import React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TeamMemberGrid } from '@/components/team/components/TeamMemberGrid';
import { TeamMemberDisplayProps } from '@/components/team/components/TeamMemberDisplay';
import { EmptyTeamState } from '@/components/team/components/EmptyTeamState';
import { Building2, UserCog, Wrench } from 'lucide-react';

interface TeamTabsProps {
  memberTypeFilter: string;
  setMemberTypeFilter: (value: string) => void;
  memberTypeCount: Record<string, number>;
  filteredMembers: TeamMemberDisplayProps[];
  getEmptyStateForType: (type: string) => React.ReactNode;
}

export const TeamTabs: React.FC<TeamTabsProps> = ({
  memberTypeFilter,
  setMemberTypeFilter,
  memberTypeCount,
  filteredMembers,
  getEmptyStateForType
}) => {
  return (
    <Tabs defaultValue="all" value={memberTypeFilter} onValueChange={setMemberTypeFilter}>
      <TabsList>
        <TabsTrigger value="all">
          All ({memberTypeCount['all'] || 0})
        </TabsTrigger>
        <TabsTrigger value="technician">
          Technicians ({memberTypeCount['technician'] || 0})
        </TabsTrigger>
        <TabsTrigger value="garage">
          Garages ({memberTypeCount['garage'] || 0})
        </TabsTrigger>
        <TabsTrigger value="consultant">
          Consultants ({memberTypeCount['consultant'] || 0})
        </TabsTrigger>
        <TabsTrigger value="other">
          Other ({memberTypeCount['other'] || 0})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="all">
        <TeamMemberGrid 
          members={filteredMembers}
          emptyState={getEmptyStateForType('all')}
        />
      </TabsContent>
      
      <TabsContent value="technician">
        <TeamMemberGrid 
          members={filteredMembers}
          emptyState={getEmptyStateForType('technician')}
        />
      </TabsContent>
      
      <TabsContent value="garage">
        <TeamMemberGrid 
          members={filteredMembers}
          emptyState={getEmptyStateForType('garage')}
        />
      </TabsContent>
      
      <TabsContent value="consultant">
        <TeamMemberGrid 
          members={filteredMembers}
          emptyState={getEmptyStateForType('consultant')}
        />
      </TabsContent>
      
      <TabsContent value="other">
        <TeamMemberGrid 
          members={filteredMembers}
          emptyState={getEmptyStateForType('other')}
        />
      </TabsContent>
    </Tabs>
  );
};
