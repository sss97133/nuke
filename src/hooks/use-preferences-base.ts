
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UserPreferences } from "@/types/preferences";

export const usePreferencesBase = () => {
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

  return {
    preferences,
    setPreferences,
    loading,
    error
  };
};
