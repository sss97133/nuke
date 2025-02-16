
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type PreferenceUpdates = Partial<{
  notifications_enabled: boolean;
  auto_save_enabled: boolean;
  compact_view_enabled: boolean;
  theme: string;
  distance_unit: string;
  currency: string;
  default_garage_view: string;
  service_reminders_enabled: boolean;
  inventory_alerts_enabled: boolean;
  price_alerts_enabled: boolean;
}>;

export const usePreferencesSave = () => {
  const { toast } = useToast();

  const savePreferences = async (updates: PreferenceUpdates) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast({
          title: "Error",
          description: "No user found. Please sign in again.",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase
        .from('user_preferences')
        .update(updates)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Preferences Saved",
        description: "Your preferences have been updated",
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast({
        title: "Error",
        description: "Failed to save preferences",
        variant: "destructive",
      });
    }
  };

  return { savePreferences };
};
