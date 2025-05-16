import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { Vehicle } from "@/types/inventory";
import { Loader2 } from "lucide-react";
import { checkQueryError } from "@/utils/supabase-helpers";

interface WebsiteImportProps {
  onNormalizedData: (vehicles: Vehicle[]) => void;
}

export const WebsiteImport = ({ onNormalizedData }: WebsiteImportProps) => {
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleImport = async () => {
    if (!url) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('process-vehicle-import', {
        body: { data: url, fileType: 'url' }
      });

      checkQueryError(error);
      
      onNormalizedData(data.vehicles);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error occurred');
      toast({
        title: "Import Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="text-sm text-muted-foreground">
        Enter the URL of the website containing vehicle data
      </div>
      
      <div className="flex items-center gap-4">
        <Input
          type="url"
          placeholder="https://example.com/vehicles"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isLoading}
        />
        
        <Button 
          onClick={handleImport}
          disabled={!url || isLoading}
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            'Import'
          )}
        </Button>
      </div>
    </div>
  );
};
