import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { AutoSaveSettings } from "@/components/settings/AutoSaveSettings";
import { DataManagement } from "@/components/settings/DataManagement";
import { AlertSettings } from "@/components/settings/AlertSettings";
import { DisplaySettings } from "@/components/settings/DisplaySettings";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const Settings = () => {
  const { toast } = useToast();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [compactViewEnabled, setCompactViewEnabled] = useState(false);
  const [distanceUnit, setDistanceUnit] = useState('miles');
  const [currency, setCurrency] = useState('USD');
  const [defaultGarageView, setDefaultGarageView] = useState('list');
  const [serviceRemindersEnabled, setServiceRemindersEnabled] = useState(true);
  const [inventoryAlertsEnabled, setInventoryAlertsEnabled] = useState(true);
  const [priceAlertsEnabled, setPriceAlertsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      const { data: preferences, error } = await supabase
        .from('user_preferences')
        .select('*')
        .single();

      if (error && error.code !== 'PGRST116') {
        setError('Failed to load preferences. Please try again.');
        return;
      }

      if (preferences) {
        setNotificationsEnabled(preferences.notifications_enabled);
        setAutoSaveEnabled(preferences.auto_save_enabled);
        setCompactViewEnabled(preferences.compact_view_enabled);
        setDistanceUnit(preferences.distance_unit);
        setCurrency(preferences.currency);
        setDefaultGarageView(preferences.default_garage_view);
        setServiceRemindersEnabled(preferences.service_reminders_enabled);
        setInventoryAlertsEnabled(preferences.inventory_alerts_enabled);
        setPriceAlertsEnabled(preferences.price_alerts_enabled);
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

  const savePreferences = async (updates: Partial<{
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
  }>) => {
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

      setNotificationsEnabled(true);
      setAutoSaveEnabled(true);
      setCompactViewEnabled(false);
      
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

  if (error) {
    return (
      <div className="container mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 space-y-8">
        <Skeleton className="h-8 w-48" />
        <Card className="p-6 space-y-6">
          <Skeleton className="h-4 w-32" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-8">
      <h1 className="text-3xl font-bold">System Preferences</h1>
      
      <Card className="p-6 space-y-6">
        <AppearanceSettings
          compactViewEnabled={compactViewEnabled}
          onCompactViewChange={(checked) => {
            setCompactViewEnabled(checked);
            savePreferences({ compact_view_enabled: checked });
          }}
        />

        <DisplaySettings
          distanceUnit={distanceUnit}
          currency={currency}
          defaultGarageView={defaultGarageView}
          onDistanceUnitChange={(value) => {
            setDistanceUnit(value);
            savePreferences({ distance_unit: value });
          }}
          onCurrencyChange={(value) => {
            setCurrency(value);
            savePreferences({ currency: value });
          }}
          onDefaultGarageViewChange={(value) => {
            setDefaultGarageView(value);
            savePreferences({ default_garage_view: value });
          }}
        />

        <NotificationSettings
          notificationsEnabled={notificationsEnabled}
          onNotificationsChange={(checked) => {
            setNotificationsEnabled(checked);
            savePreferences({ notifications_enabled: checked });
          }}
        />

        <AlertSettings
          serviceRemindersEnabled={serviceRemindersEnabled}
          inventoryAlertsEnabled={inventoryAlertsEnabled}
          priceAlertsEnabled={priceAlertsEnabled}
          onServiceRemindersChange={(checked) => {
            setServiceRemindersEnabled(checked);
            savePreferences({ service_reminders_enabled: checked });
          }}
          onInventoryAlertsChange={(checked) => {
            setInventoryAlertsEnabled(checked);
            savePreferences({ inventory_alerts_enabled: checked });
          }}
          onPriceAlertsChange={(checked) => {
            setPriceAlertsEnabled(checked);
            savePreferences({ price_alerts_enabled: checked });
          }}
        />

        <AutoSaveSettings
          autoSaveEnabled={autoSaveEnabled}
          onAutoSaveChange={(checked) => {
            setAutoSaveEnabled(checked);
            savePreferences({ auto_save_enabled: checked });
          }}
        />
      </Card>

      <Card className="p-6">
        <DataManagement
          onResetPreferences={handleResetPreferences}
          onClearData={handleClearData}
        />
      </Card>
    </div>
  );
};

export default Settings;
