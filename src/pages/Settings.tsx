
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Settings = () => {
  const { theme, setTheme } = useTheme();
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

      if (error && error.code !== 'PGRST116') { // PGRST116 means no rows found
        throw error;
      }

      if (preferences) {
        setNotificationsEnabled(preferences.notifications_enabled);
        setAutoSaveEnabled(preferences.auto_save_enabled);
        setCompactViewEnabled(preferences.compact_view_enabled);
        setTheme(preferences.theme);
      } else {
        // Create default preferences if none exist
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
      setTheme('system');
      
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

      // Reload preferences to create new default ones
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
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Appearance</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="theme">Dark Mode</Label>
            <Switch
              id="theme"
              checked={theme === 'dark'}
              onCheckedChange={(checked) => {
                const newTheme = checked ? 'dark' : 'light';
                setTheme(newTheme);
                savePreferences({ theme: newTheme });
              }}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="compact">Compact View</Label>
            <Switch
              id="compact"
              checked={compactViewEnabled}
              onCheckedChange={(checked) => {
                setCompactViewEnabled(checked);
                savePreferences({ compact_view_enabled: checked });
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Notifications</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="notifications">Enable Notifications</Label>
            <Switch
              id="notifications"
              checked={notificationsEnabled}
              onCheckedChange={(checked) => {
                setNotificationsEnabled(checked);
                savePreferences({ notifications_enabled: checked });
              }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Auto-Save</h2>
          <div className="flex items-center justify-between">
            <Label htmlFor="autosave">Enable Auto-Save</Label>
            <Switch
              id="autosave"
              checked={autoSaveEnabled}
              onCheckedChange={(checked) => {
                setAutoSaveEnabled(checked);
                savePreferences({ auto_save_enabled: checked });
              }}
            />
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="text-xl font-semibold">Data Management</h2>
        <div className="space-x-4">
          <Button variant="outline" onClick={handleResetPreferences}>
            Reset to Defaults
          </Button>
          <Button variant="destructive" onClick={handleClearData}>
            Clear All Data
          </Button>
        </div>
      </Card>
    </div>
  );
};

export default Settings;
