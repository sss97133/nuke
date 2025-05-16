
import React from 'react';
import { Button } from "@/components/ui/button";
import { Twitch } from "lucide-react";

interface TwitchConnectProps {
  onConnectTwitch: () => void;
}

export const TwitchConnect: React.FC<TwitchConnectProps> = ({ 
  onConnectTwitch 
}) => {
  return (
    <div className="flex justify-center p-4">
      <Button 
        className="bg-purple-700 hover:bg-purple-800" 
        onClick={onConnectTwitch}
      >
        <Twitch className="mr-2 h-4 w-4" />
        Connect Twitch Account
      </Button>
    </div>
  );
};
