
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface ShareableLinkProps {
  username: string;
}

export const ShareableLink: React.FC<ShareableLinkProps> = ({ username }) => {
  const { toast } = useToast();
  const [isCopied, setIsCopied] = useState(false);
  
  if (!username) return null;
  
  const twitchUrl = `https://twitch.tv/${username}`;
  
  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(twitchUrl);
      setIsCopied(true);
      
      toast({
        title: "Link copied!",
        description: "Twitch channel URL copied to clipboard",
      });
      
      // Reset the copied state after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      
      toast({
        title: "Copy failed",
        description: "Could not copy the URL to clipboard",
        variant: "destructive",
      });
    }
  };
  
  const openTwitchChannel = () => {
    window.open(twitchUrl, '_blank', 'noopener,noreferrer');
  };
  
  return (
    <div className="mt-4 p-3 border rounded-md bg-muted/50">
      <h3 className="text-sm font-medium mb-2">Share your channel</h3>
      <div className="flex gap-2">
        <Input 
          value={twitchUrl}
          readOnly
          className="text-sm font-mono"
        />
        <Button 
          variant="outline" 
          size="sm" 
          onClick={copyToClipboard}
          className="flex-shrink-0"
        >
          <Copy className="h-4 w-4 mr-1" />
          {isCopied ? "Copied!" : "Copy"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={openTwitchChannel}
          className="flex-shrink-0"
        >
          <ExternalLink className="h-4 w-4 mr-1" />
          Open
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Share this link with viewers so they can watch your stream
      </p>
    </div>
  );
};
