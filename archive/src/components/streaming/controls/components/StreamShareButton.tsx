
import React from 'react';
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ShareableLink } from '../../settings/components/ShareableLink';

interface StreamShareButtonProps {
  username: string | null;
}

export const StreamShareButton: React.FC<StreamShareButtonProps> = ({ username }) => {
  if (!username) return null;
  
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <Share2 className="mr-2 h-4 w-4" />
          Share Link
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto">
        <ShareableLink username={username} />
      </PopoverContent>
    </Popover>
  );
};
