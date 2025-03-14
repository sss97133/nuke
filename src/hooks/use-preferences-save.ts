
import type { Database } from '../types';
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { DbUserPreferences } from "@/types/preferences";

export const usePreferencesSave = () => {
  const { toast } = useToast();

  const savePreferences = async (updates: Partial<DbUserPreferences>) => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      
      if (!user || userError) {
        toast({
          title: "Error",
          description: "No user found. Please sign in again.",
          variant: "destructive",
        });
        throw new Error('No user found');
      }

      const { error } = await supabase
  if (error) console.error("Database query error:", error);
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
      throw error;
    }
  };

  return { savePreferences };
};
