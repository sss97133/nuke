
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const usePreferencesData = () => {
  const { toast } = useToast();

  const handleResetPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const defaultPreferences = {
        notifications_enabled: true,
        auto_save_enabled: true,
        compact_view_enabled: false,
        theme: 'system'
      };

      const { error } = await supabase
        .from('user_preferences')
        .update(defaultPreferences)
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Preferences Reset",
        description: "Your preferences have been reset to default values",
      });
    } catch (error) {
      console.error('Error resetting preferences:', error);
      toast({
        title: "Error",
        description: "Failed to reset preferences",
        variant: "destructive",
      });
    }
  };

  const handleClearData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { error } = await supabase
        .from('user_preferences')
        .delete()
        .eq('user_id', user.id);

      if (error) throw error;

      toast({
        title: "Data Cleared",
        description: "Your preferences have been cleared and reset to defaults",
      });
    } catch (error) {
      console.error('Error clearing data:', error);
      toast({
        title: "Error",
        description: "Failed to clear data",
        variant: "destructive",
      });
    }
  };

  return {
    handleResetPreferences,
    handleClearData
  };
};
