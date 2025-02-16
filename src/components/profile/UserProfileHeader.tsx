
import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

interface UserProfileHeaderProps {
  fullName: string | null;
  username: string | null;
  avatarUrl?: string | null;
}

export const UserProfileHeader = ({ fullName, username, avatarUrl }: UserProfileHeaderProps) => {
  return (
    <div className="flex items-start gap-4 mb-6">
      <Avatar className="h-12 w-12">
        <AvatarImage src={avatarUrl || undefined} alt={fullName || 'User avatar'} />
        <AvatarFallback>
          {fullName ? fullName.charAt(0).toUpperCase() : 'U'}
        </AvatarFallback>
      </Avatar>
      <div className="text-left">
        <h2 className="text-lg font-semibold">{fullName || 'USER_NAME_NOT_FOUND'}</h2>
        <p className="text-sm text-muted-foreground">@{username || 'username_404'}</p>
      </div>
    </div>
  );
};
