import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

export const ImportGarages = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const importLocalGarages = async () => {
    setLoading(true);
    try {
      // Get user's location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });

      const { data, error } = await supabase.functions.invoke('search-local-garages', {
        body: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          radius: 5000 // 5km radius
        },
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: `Imported ${data.garages.length} local garages`,
      });
    } catch (error) {
      console.error('Error importing garages:', error);
      toast({
        title: "Error",
        description: "Failed to import local garages. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      onClick={importLocalGarages}
      disabled={loading}
      className="h-7 bg-[#283845] hover:bg-[#1a2830] text-white text-xs"
    >
      {loading ? (
        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
      ) : (
        <MapPin className="w-3 h-3 mr-1" />
      )}
      Import Local Garages
    </Button>
  );
};