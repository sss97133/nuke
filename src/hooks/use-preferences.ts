
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

interface UserPreferences {
  notificationsEnabled: boolean;
  autoSaveEnabled: boolean;
  compactViewEnabled: boolean;
  distanceUnit: string;
  currency: string;
  defaultGarageView: string;
  serviceRemindersEnabled: boolean;
  inventoryAlertsEnabled: boolean;
  priceAlertsEnabled: boolean;
}

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

export const usePreferences = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferences>({
    notificationsEnabled: true,
    autoSaveEnabled: true,
    compactViewEnabled: false,
    distanceUnit: 'miles',
    currency: 'USD',
    defaultGarageView: 'list',
    serviceRemindersEnabled: true,
    inventoryAlertsEnabled: true,
    priceAlertsEnabled: true
  });

  useEffect(() => {
    loadUserPreferences();
  }, []);

  const loadUserPreferences = async () => {
    try {
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('No user found. Please sign in again.');
        return;
      }

      const { data: preferencesData, error } = await supabase
        .from('user_preferences')
        .select('*')
        .single();

      if (error && error.code !== 'PGRST116') {
        setError('Failed to load preferences. Please try again.');
        return;
      }

      if (preferencesData) {
        setPreferences({
          notificationsEnabled: preferencesData.notifications_enabled,
          autoSaveEnabled: preferencesData.auto_save_enabled,
          compactViewEnabled: preferencesData.compact_view_enabled,
          distanceUnit: preferencesData.distance_unit,
          currency: preferencesData.currency,
          defaultGarageView: preferencesData.default_garage_view,
          serviceRemindersEnabled: preferencesData.service_reminders_enabled,
          inventoryAlertsEnabled: preferencesData.inventory_alerts_enabled,
          priceAlertsEnabled: preferencesData.price_alerts_enabled
        });
      } else {
        await supabase.from('user_preferences').insert({
          user_id: user.id,
          notifications_enabled: true,
          auto_save_enabled: true,
          compact_view_enabled: false,
          theme: 'system',
          distance_unit: 'miles',
          currency: 'USD',
          default_garage_view: 'list',
          service_reminders_enabled: true,
          inventory_alerts_enabled: true,
          price_alerts_enabled: true
        });
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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

      setPreferences(prev => ({
        ...prev,
        notificationsEnabled: true,
        autoSaveEnabled: true,
        compactViewEnabled: false
      }));
      
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

      await loadUserPreferences();

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
    preferences,
    loading,
    error,
    savePreferences,
    handleResetPreferences,
    handleClearData
  };
};
