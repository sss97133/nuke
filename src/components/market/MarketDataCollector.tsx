import { useState } from 'react';
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

interface MarketData {
  id: string;
  timestamp: string;
  price: number;
  condition: string;
  mileage: number;
  location: string;
  source: string;
  url: string;
  metadata: Record<string, unknown>;
}

interface CrawlResult {
  success: boolean;
  status?: string;
  completed?: number;
  total?: number;
  creditsUsed?: number;
  expiresAt?: string;
  data?: any[];
}

interface MarketDataCollectorProps {
  data?: MarketData[];
  onDataUpdate: (data: MarketData[]) => void;
  // ... rest of the props
}

export const MarketDataCollector = () => {
  const { toast } = useToast();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [crawlResult, setCrawlResult] = useState<CrawlResult | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setProgress(0);
    setCrawlResult(null);
    
    try {
      console.log('Starting crawl for URL:', url);
      const { data, error } = await supabase.functions.invoke('crawl-market-data', {
  if (error) console.error("Database query error:", error);
        body: { url }
      });

      if (error) throw error;

      if (data.success) {
        toast({
          title: "Success",
          description: "Data collected successfully",
          duration: 3000,
        });
        setCrawlResult(data);
      } else {
        toast({
          title: "Error",
          description: data.error || "Failed to collect data",
          variant: "destructive",
          duration: 3000,
        });
      }
    } catch (error) {
      console.error('Error collecting market data:', error);
      toast({
        title: "Error",
        description: "Failed to collect market data",
        variant: "destructive",
        duration: 3000,
      });
    } finally {
      setIsLoading(false);
      setProgress(100);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-6">
      <Card className="p-6 backdrop-blur-sm bg-white/30 dark:bg-black/30 rounded-lg shadow-lg border border-gray-200 dark:border-gray-800">
        <h2 className="text-2xl font-bold mb-6">Market Data Collector</h2>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="url" className="text-sm font-medium">
              Source URL
            </label>
            <Input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full"
              placeholder="https://bringatrailer.com"
              required
            />
          </div>
          {isLoading && (
            <Progress value={progress} className="w-full" />
          )}
          <Button
            type="submit"
            disabled={isLoading}
            className="w-full"
          >
            {isLoading ? "Collecting Data..." : "Start Collection"}
          </Button>
        </form>

        {crawlResult && (
          <div className="mt-6 space-y-4">
            <h3 className="text-lg font-semibold">Collection Results</h3>
            <div className="space-y-2 text-sm">
              <p>Status: {crawlResult.status}</p>
              <p>Completed Items: {crawlResult.completed}</p>
              <p>Total Items: {crawlResult.total}</p>
              {crawlResult.data && (
                <div className="mt-4">
                  <p className="font-semibold mb-2">Sample Data:</p>
                  <pre className="bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-auto max-h-60">
                    {JSON.stringify(crawlResult.data.slice(0, 5), null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};