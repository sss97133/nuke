
import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, Copy } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface ShareableLinkProps {
  username: string;
}

export const ShareableLink: React.FC<ShareableLinkProps> = ({ username }) => {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  
  // Create the app URL instead of Twitch URL
  const appUrl = `${window.location.origin}/streaming/watch/${username}`;

  const copyLink = () => {
    navigator.clipboard.writeText(appUrl);
    setCopied(true);
    toast({
      title: "Link copied",
      description: "Stream link has been copied to clipboard"
    });
    
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-4 p-4 border rounded-md">
      <h4 className="text-sm font-medium mb-2">Share your stream</h4>
      <p className="text-xs text-muted-foreground mb-3">
        Share this link with others so they can watch your stream directly in the app:
      </p>
      <div className="flex gap-2">
        <Input 
          value={appUrl} 
          readOnly 
          className="text-xs"
        />
        <Button 
          size="sm" 
          onClick={copyLink}
          variant={copied ? "default" : "outline"}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
};
