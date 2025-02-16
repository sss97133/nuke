
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { AutoSaveSettings } from "@/components/settings/AutoSaveSettings";
import { DataManagement } from "@/components/settings/DataManagement";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

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

  useEffect(() => {
    loadUserPreferences();
  }, []);

  const loadUserPreferences = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { data: preferences, error } = await supabase
        .from('user_preferences')
        .select('*')
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
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
      toast({
        title: "Error",
        description: "Failed to load preferences",
        variant: "destructive",
      });
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
      if (!user) throw new Error('No user found');

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

  if (loading) {
    return <div className="container mx-auto p-6">Loading preferences...</div>;
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

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Display Settings</h2>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Distance Unit</Label>
              <Select value={distanceUnit} onValueChange={(value) => {
                setDistanceUnit(value);
                savePreferences({ distance_unit: value });
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="miles">Miles</SelectItem>
                  <SelectItem value="kilometers">Kilometers</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(value) => {
                setCurrency(value);
                savePreferences({ currency: value });
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD ($)</SelectItem>
                  <SelectItem value="EUR">EUR (€)</SelectItem>
                  <SelectItem value="GBP">GBP (£)</SelectItem>
                  <SelectItem value="CAD">CAD ($)</SelectItem>
                  <SelectItem value="AUD">AUD ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Default Garage View</Label>
              <Select value={defaultGarageView} onValueChange={(value) => {
                setDefaultGarageView(value);
                savePreferences({ default_garage_view: value });
              }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="list">List</SelectItem>
                  <SelectItem value="grid">Grid</SelectItem>
                  <SelectItem value="map">Map</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <NotificationSettings
          notificationsEnabled={notificationsEnabled}
          onNotificationsChange={(checked) => {
            setNotificationsEnabled(checked);
            savePreferences({ notifications_enabled: checked });
          }}
        />

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Alert Settings</h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="service-reminders">Service Reminders</Label>
              <Switch
                id="service-reminders"
                checked={serviceRemindersEnabled}
                onCheckedChange={(checked) => {
                  setServiceRemindersEnabled(checked);
                  savePreferences({ service_reminders_enabled: checked });
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="inventory-alerts">Inventory Alerts</Label>
              <Switch
                id="inventory-alerts"
                checked={inventoryAlertsEnabled}
                onCheckedChange={(checked) => {
                  setInventoryAlertsEnabled(checked);
                  savePreferences({ inventory_alerts_enabled: checked });
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="price-alerts">Price Alerts</Label>
              <Switch
                id="price-alerts"
                checked={priceAlertsEnabled}
                onCheckedChange={(checked) => {
                  setPriceAlertsEnabled(checked);
                  savePreferences({ price_alerts_enabled: checked });
                }}
              />
            </div>
          </div>
        </div>

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
