
import React from 'react';
import { Button } from "@/components/ui/button";
import { Twitch } from "lucide-react";
import { TwitchUserData } from '../../services/types';

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
    <div className="flex items-center gap-2 mb-4 text-sm">
      <Twitch className="h-4 w-4 text-purple-600" />
      <span>Connected as:</span>
      <span className="font-medium">{userData.displayName}</span>
      <Button 
        variant="outline" 
        size="sm" 
        className="ml-auto"
        onClick={onDisconnect}
      >
        Disconnect
      </Button>
    </div>
  );
};
