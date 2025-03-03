
import React from 'react';
import { Button } from '@/components/ui/button';
import { UserPlus } from 'lucide-react';

interface TeamSectionHeaderProps {
  onAddMember: () => void;
}

export const TeamSectionHeader: React.FC<TeamSectionHeaderProps> = ({ onAddMember }) => {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-2xl font-bold tracking-tight">Team Members</h2>
      <Button onClick={onAddMember}>
        <UserPlus className="w-4 h-4 mr-2" />
        Add Member
      </Button>
    </div>
  );
};
