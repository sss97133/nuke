
import React from 'react';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface UrlInputProps {
  url: string;
  setUrl: (url: string) => void;
}

export const UrlInput: React.FC<UrlInputProps> = ({ url, setUrl }) => {
  const { toast } = useToast();

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const handleFetch = () => {
    if (!url) {
      toast({
        title: "URL required",
        description: "Please enter a valid URL to fetch data from",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Fetching data",
      description: `Retrieving data from ${url}`,
    });
    // Additional fetch logic would go here
  };

  return (
    <div className="space-y-2">
      <Label htmlFor="url">Website URL</Label>
      <div className="flex gap-2">
        <Input 
          id="url" 
          placeholder="https://example.com/data-source" 
          value={url}
          onChange={handleUrlChange}
        />
        <Button type="button" onClick={handleFetch}>Fetch</Button>
      </div>
    </div>
  );
};
