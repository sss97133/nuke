
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppearanceSettings } from "@/components/settings/AppearanceSettings";
import { NotificationSettings } from "@/components/settings/NotificationSettings";
import { AutoSaveSettings } from "@/components/settings/AutoSaveSettings";
import { DataManagement } from "@/components/settings/DataManagement";

export const Settings = () => {
  const { toast } = useToast();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);
  const [compactViewEnabled, setCompactViewEnabled] = useState(false);
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
      } else {
        await supabase.from('user_preferences').insert({
          user_id: user.id,
          notifications_enabled: true,
          auto_save_enabled: true,
          compact_view_enabled: false,
          theme: 'system'
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
        <NotificationSettings
          notificationsEnabled={notificationsEnabled}
          onNotificationsChange={(checked) => {
            setNotificationsEnabled(checked);
            savePreferences({ notifications_enabled: checked });
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
