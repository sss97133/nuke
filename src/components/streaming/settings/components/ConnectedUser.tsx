
import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { TwitchUserData } from '../../services/types';
import { ShareableLink } from './ShareableLink';

interface ConnectedUserProps {
  userData: TwitchUserData | null;
  onDisconnect: () => void;
}

export const ConnectedUser: React.FC<ConnectedUserProps> = ({ 
  userData, 
  onDisconnect 
}) => {
  if (!userData) return null;
  
  return (
    <div className="p-4 border rounded-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Avatar>
            <AvatarImage src={userData.profileImageUrl} alt={userData.displayName} />
            <AvatarFallback>{userData.displayName.substring(0, 2)}</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-medium">{userData.displayName}</h3>
            <p className="text-sm text-muted-foreground">@{userData.login}</p>
          </div>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onDisconnect}
        >
          Disconnect
        </Button>
      </div>
      
      <ShareableLink username={userData.login} />
    </div>
  );
};
