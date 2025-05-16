
import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";

interface ProfilePreviewProps {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  avatarUrl: string;
}

export const ProfilePreview = ({ firstName, lastName, username, email, avatarUrl }: ProfilePreviewProps) => {
  return (
    <Card className="p-6 mb-4">
      <div className="flex items-start space-x-4">
        <Avatar className="h-20 w-20">
          <AvatarImage src={avatarUrl} alt={username} />
          <AvatarFallback>
            {firstName.charAt(0)}
            {lastName.charAt(0)}
          </AvatarFallback>
        </Avatar>
        <div className="space-y-1">
          <h3 className="text-xl font-semibold">
            {firstName} {lastName}
          </h3>
          <p className="text-sm text-muted-foreground">@{username}</p>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>
      </div>
    </Card>
  );
};
