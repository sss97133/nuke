
import React, { useState } from 'react';
import { TeamMemberDisplay, TeamMemberDisplayProps } from './TeamMemberDisplay';
import { TeamMemberDetails } from './TeamMemberDetails';

interface TeamMemberGridProps {
  members: TeamMemberDisplayProps[];
  emptyState?: React.ReactNode;
}

export const TeamMemberGrid: React.FC<TeamMemberGridProps> = ({ 
  members, 
  emptyState 
}) => {
  const [selectedMember, setSelectedMember] = useState<TeamMemberDisplayProps | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const handleMemberClick = (member: TeamMemberDisplayProps) => {
    setSelectedMember(member);
    setDetailsOpen(true);
  };

  if (!members || members.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <>
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
            onClick={() => handleMemberClick(member)}
          />
        ))}
      </div>

      <TeamMemberDetails 
        member={selectedMember} 
        open={detailsOpen} 
        onOpenChange={setDetailsOpen} 
      />
    </>
  );
};
