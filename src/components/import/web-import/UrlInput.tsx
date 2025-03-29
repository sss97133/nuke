import React, { useState } from 'react';
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from '@/lib/supabase';

interface UrlInputProps {
  url: string;
  setUrl: (url: string) => void;
  onDataScraped?: (data: any) => void;
}

export const UrlInput: React.FC<UrlInputProps> = ({ url, setUrl, onDataScraped }) => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrl(e.target.value);
  };

  const handleFetch = async () => {
    if (!url || !url.startsWith('http')) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid HTTP(S) URL to fetch data from",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    toast({
      title: "Fetching data",
      description: `Attempting to scrape ${url}`,
    });

    try {
      const { data, error } = await supabase.functions.invoke('scrape-craigslist', {
        body: { url },
      });

      if (error) {
        throw error;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      console.log('Scraped Data:', data);
      toast({
        title: "Scraping Successful",
        description: `Successfully scraped data for: ${data?.title || 'Unknown Title'}`,
      });
      
      if (onDataScraped) {
        onDataScraped(data);
      }

    } catch (error) {
      console.error('Error invoking scrape function:', error);
      toast({
        title: "Scraping Failed",
        description: error instanceof Error ? error.message : 'An unknown error occurred.',
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
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
          disabled={isLoading}
        />
        <Button type="button" onClick={handleFetch} disabled={isLoading}>
          {isLoading ? 'Fetching...' : 'Fetch'}
        </Button>
      </div>
    </div>
  );
};
