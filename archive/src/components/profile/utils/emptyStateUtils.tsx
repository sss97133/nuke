
import React from 'react';
import { EmptyTeamState } from '@/components/team/components/EmptyTeamState';
import { Building2, UserCog, Wrench, Users } from 'lucide-react';

export const getEmptyStateForType = (type: string, handleAddMember: () => void) => {
  switch (type) {
    case 'technician':
      return (
        <EmptyTeamState
          icon={<Wrench className="w-12 h-12 mb-4" />}
          title="No technicians added yet"
          description="Add technicians who work on your vehicles"
          onAddMember={handleAddMember}
          buttonText="Add Technician"
        />
      );
    case 'garage':
      return (
        <EmptyTeamState
          icon={<Building2 className="w-12 h-12 mb-4" />}
          title="No garages added yet"
          description="Connect with service centers and repair shops"
          onAddMember={handleAddMember}
          buttonText="Add Garage"
        />
      );
    case 'consultant':
      return (
        <EmptyTeamState
          icon={<UserCog className="w-12 h-12 mb-4" />}
          title="No consultants added yet"
          description="Add specialized advisors for your vehicle projects"
          onAddMember={handleAddMember}
          buttonText="Add Consultant"
        />
      );
    default:
      return (
        <EmptyTeamState
          icon={<Users className="w-12 h-12 mb-4" />}
          title="No team members found"
          description="Add team members to collaborate on your vehicle projects"
          onAddMember={handleAddMember}
        />
      );
  }
};
