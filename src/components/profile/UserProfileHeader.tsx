import React from 'react';
import { UserRound } from 'lucide-react';

interface UserProfileHeaderProps {
  fullName: string | null;
  username: string | null;
}

export const UserProfileHeader = ({ fullName, username }: UserProfileHeaderProps) => {
  return (
    <div className="flex items-start gap-4 mb-6 bg-white p-3 border border-[#999]">
      <div className="bg-[#eee] p-2 border border-[#ccc]">
        <UserRound className="w-6 h-6 text-[#000066]" />
      </div>
      <div className="text-left">
        <h2 className="text-doc font-mono text-[#000066]">{fullName || 'USER_NAME_NOT_FOUND'}</h2>
        <p className="text-tiny text-[#555555] font-mono">@{username || 'username_404'}</p>
      </div>
    </div>
  );
};