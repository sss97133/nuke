import type { Database } from '../types';
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { UserPreferences, DbUserPreferences } from "@/types/preferences";
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
    priceAlertsEnabled: true,
    primaryColor: '#9b87f5',
    secondaryColor: '#7E69AB',
    accentColor: '#8B5CF6',
    fontFamily: 'Inter',
    fontSize: 'medium'
  });

  const loadUserPreferences = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const { data: { user } } = await supabase.auth.getUser();
  if (error) console.error("Database query error:", error);
      
      if (!user) {
        console.log('No user found, using default preferences');
        setLoading(false);
        return;
      }
      
      const { data, error: fetchError } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (fetchError) {
        throw fetchError;
      }
      
      if (data) {
        setPreferences({
          notificationsEnabled: data.notifications_enabled ?? true,
          autoSaveEnabled: data.auto_save_enabled ?? true,
          compactViewEnabled: data.compact_view_enabled ?? false,
          theme: data.theme ?? 'system',
          distanceUnit: data.distance_unit ?? 'miles',
          currency: data.currency ?? 'USD',
          defaultGarageView: data.default_garage_view ?? 'list',
          serviceRemindersEnabled: data.service_reminders_enabled ?? true,
          inventoryAlertsEnabled: data.inventory_alerts_enabled ?? true,
          priceAlertsEnabled: data.price_alerts_enabled ?? true,
          primaryColor: data.primary_color ?? '#9b87f5',
          secondaryColor: data.secondary_color ?? '#7E69AB',
          accentColor: data.accent_color ?? '#8B5CF6',
          fontFamily: data.font_family ?? 'Inter',
          fontSize: data.font_size ?? 'medium'
        });
      }
    } catch (err) {
      console.error('Error loading preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
      toast({
        title: "Error",
        description: "Failed to load preferences. Using defaults.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadUserPreferences();
  }, [loadUserPreferences]);

  return {
    preferences,
    setPreferences,
    loading,
    error
  };
};
