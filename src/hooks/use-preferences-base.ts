
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UserPreferences } from "@/types/preferences";
import { useToast } from "@/hooks/use-toast";

export const usePreferencesBase = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const [preferences, setPreferences] = useState<UserPreferences>({
    notificationsEnabled: true,
    autoSaveEnabled: true,
    compactViewEnabled: false,
    theme: 'system',
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
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError) {
        setError('Authentication error. Please sign in again.');
        setLoading(false);
        return;
      }
      
      if (!user) {
        setError('No user found. Please sign in again.');
        setLoading(false);
        return;
      }

      const { data: preferencesData, error: preferencesError } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (preferencesError) {
        console.error('Error loading preferences:', preferencesError);
        setError('Failed to load preferences');
        setLoading(false);
        return;
      }

      if (preferencesData) {
        setPreferences({
          notificationsEnabled: preferencesData.notifications_enabled,
          autoSaveEnabled: preferencesData.auto_save_enabled,
          compactViewEnabled: preferencesData.compact_view_enabled,
          theme: preferencesData.theme || 'system', // Added the theme property
          distanceUnit: preferencesData.distance_unit,
          currency: preferencesData.currency,
          defaultGarageView: preferencesData.default_garage_view,
          serviceRemindersEnabled: preferencesData.service_reminders_enabled,
          inventoryAlertsEnabled: preferencesData.inventory_alerts_enabled,
          priceAlertsEnabled: preferencesData.price_alerts_enabled
        });
      } else {
        // Insert default preferences if none exist
        const { error: insertError } = await supabase.from('user_preferences').insert({
          user_id: user.id,
          notifications_enabled: true,
          auto_save_enabled: true,
          compact_view_enabled: false,
          theme: 'system', // Make sure theme is included here as well
          distance_unit: 'miles',
          currency: 'USD',
          default_garage_view: 'list',
          service_reminders_enabled: true,
          inventory_alerts_enabled: true,
          price_alerts_enabled: true
        });

        if (insertError) {
          console.error('Error inserting default preferences:', insertError);
          setError('Failed to create default preferences');
          setLoading(false);
          return;
        }
      }
      
      setLoading(false);
      setError(null);
      
    } catch (error) {
      console.error('Unexpected error loading preferences:', error);
      setError('An unexpected error occurred. Please try again.');
      setLoading(false);
      toast({
        title: "Error",
        description: "Failed to load preferences. Please refresh the page.",
        variant: "destructive"
      });
    }
  };

  return {
    preferences,
    setPreferences,
    loading,
    error
  };
};
