import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const ImportGarages = () => {
  const [importing, setImporting] = useState(false);
  const { toast } = useToast();

  const importGarages = async () => {
    setImporting(true);
    try {
      // First show a toast to indicate we're requesting location
      toast({
        title: "Location Required",
        description: "Please allow location access to import nearby garages",
      });

      // Get user's location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });

      // Show searching toast
      toast({
        title: "Searching",
        description: "Looking for garages within 5km...",
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
        description: `Found and imported ${data?.garages?.length || 0} garages`,
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
      {importing ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : (
        <Download className="w-3 h-3 mr-1" />
      )}
      {importing ? "IMPORTING..." : "IMPORT"}
    </Button>
  );
};