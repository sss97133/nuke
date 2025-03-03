
import React from 'react';
import { TeamMemberDisplay, TeamMemberDisplayProps } from './TeamMemberDisplay';

interface TeamMemberGridProps {
  members: TeamMemberDisplayProps[];
  emptyState?: React.ReactNode;
}

export const TeamMemberGrid: React.FC<TeamMemberGridProps> = ({ 
  members, 
  emptyState 
}) => {
  if (!members || members.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {members.map((member, index) => (
        <TeamMemberDisplay
          key={index}
          memberType={member.memberType}
          department={member.department}
          position={member.position}
          startDate={member.startDate}
          status={member.status}
          profile={member.profile}
        />
      ))}
    </div>
  );
};
