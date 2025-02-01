import React from 'react';
import { UserRound } from 'lucide-react';

interface UserProfileHeaderProps {
  fullName: string | null;
  username: string | null;
}

export const UserProfileHeader = ({ fullName, username }: UserProfileHeaderProps) => {
  return (
    <div className="flex items-start gap-4 mb-6 bg-[#FFFFFF] p-3 border border-[#403E43]">
      <div className="bg-[#C8C8C9] p-2 border border-[#8A898C]">
        <UserRound className="w-4 h-4 text-[#222222]" />
      </div>
      <div className="text-left">
        <h2 className="text-tiny font-mono text-[#222222]">{fullName || 'USER_NAME_NOT_FOUND'}</h2>
        <p className="text-[10px] text-[#403E43] font-mono">@{username || 'username_404'}</p>
      </div>
    </div>
  );
};