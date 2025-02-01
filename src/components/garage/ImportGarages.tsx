import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const ImportGarages = () => {
  const [importing, setImporting] = useState(false);
  const { toast } = useToast();

  const importGarages = async () => {
    setImporting(true);
    try {
      // Get user's location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });

      const { data, error } = await supabase.functions.invoke('search-local-garages', {
        body: {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          radius: 5000 // 5km radius
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: data.message,
      });

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to import garages",
        variant: "destructive"
      });
    } finally {
      setImporting(false);
    }
  };

  return (
    <Button
      onClick={importGarages}
      size="sm"
      className="h-7 bg-[#283845] hover:bg-[#1a2830] text-white text-xs"
      disabled={importing}
    >
      <Download className="w-3 h-3 mr-1" />
      {importing ? "IMPORTING..." : "IMPORT"}
    </Button>
  );
};