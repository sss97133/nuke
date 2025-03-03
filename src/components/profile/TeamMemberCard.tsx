
import React from 'react';
import { TeamMemberDisplay } from '@/components/team/components/TeamMemberDisplay';

interface Profile {
  username?: string;
  full_name?: string;
  avatar_url?: string;
}

interface TeamMemberCardProps {
  memberType: string;
  department?: string;
  position?: string;
  startDate: string;
  status: string;
  profile?: Profile;
}

export const TeamMemberCard = (props: TeamMemberCardProps) => {
  return <TeamMemberDisplay {...props} />;
};
